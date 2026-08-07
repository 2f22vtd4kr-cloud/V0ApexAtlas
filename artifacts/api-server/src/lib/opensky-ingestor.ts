/**
 * OpenSky Network — Live Private Jet Tracking Enricher
 *
 * Fetches the live aircraft state vectors from the OpenSky Network REST API
 * and matches them against aviation assets already in our database (ingested
 * via the FAA registry). When a match is found, it updates the asset's
 * lastActivityDate and enriches its metadata with the latest flight position,
 * altitude, and speed.
 *
 * This is a *live enrichment* pass, not a bulk ingest. Run it periodically
 * to keep the "last seen flying" intelligence current.
 *
 * API: https://opensky-network.org/api/states/all
 *      No authentication required for public aircraft states.
 *      Returns ~9000 state vectors for all aircraft currently in the air.
 *
 * Matching strategy:
 *   OpenSky callsign (trimmed) === our aviation asset identifier (N-number)
 *   e.g. callsign "N12345  " ↔ identifier "N12345"
 *
 * State vector fields (array index):
 *   0=icao24, 1=callsign, 2=origin_country, 3=time_position,
 *   4=last_contact, 5=longitude, 6=latitude, 7=baro_altitude,
 *   8=on_ground, 9=velocity (m/s), 10=true_track (deg),
 *   11=vertical_rate (m/s), 13=geo_altitude, 14=squawk
 */

import { db, assetsTable, entitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { updateJob, appendJobLog } from "./job-queue";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenSkyEnrichParams {
  jobId: string;
}

export interface OpenSkyEnrichResult {
  inserted: number;   // assets updated with fresh flight data
  skipped: number;    // no live match found
  errors: number;
  liveAircraft: number; // total aircraft in the air at query time
  durationMs: number;
}

type StateVector = (string | number | boolean | null)[];

interface OpenSkyResponse {
  time: number;
  states: StateVector[] | null;
}

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

// ── Helper ────────────────────────────────────────────────────────────────────

function mpsToKnots(mps: number | null): number | null {
  return mps == null ? null : Math.round(mps * 1.944);
}

function metersToFt(m: number | null): number | null {
  return m == null ? null : Math.round(m * 3.281);
}

// ── Main enrichment function ──────────────────────────────────────────────────

export async function runOpenSkyEnrichment(
  params: OpenSkyEnrichParams,
): Promise<OpenSkyEnrichResult> {
  const { jobId } = params;
  const startTime = Date.now();
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // ── Step 1: Fetch live state vectors ──────────────────────────────────────
  await updateJob(jobId, { message: "Querying OpenSky Network for live aircraft positions…", progress: 5 });
  await appendJobLog(jobId, "✈️  Fetching live state vectors from opensky-network.org…");

  let states: StateVector[] = [];

  try {
    const res = await fetch(OPENSKY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`OpenSky API returned HTTP ${res.status}. The free tier may be rate-limited (60 requests/hour). Try again shortly.`);
    }

    const data = (await res.json()) as OpenSkyResponse;
    states = data.states ?? [];
    await appendJobLog(jobId, `📡 ${states.length.toLocaleString()} aircraft currently in the air globally.`);
  } catch (err: any) {
    throw new Error(`OpenSky fetch failed: ${err.message}`);
  }

  // ── Step 2: Build callsign lookup map ────────────────────────────────────
  await updateJob(jobId, { message: `Building callsign index (${states.length} live aircraft)…`, progress: 15, total: states.length });

  const callsignMap = new Map<string, StateVector>();
  for (const sv of states) {
    const raw = sv[1];
    if (typeof raw === "string") {
      const cs = raw.trim().toUpperCase();
      if (cs) callsignMap.set(cs, sv);
    }
  }

  // ── Step 3: Load our aviation assets ─────────────────────────────────────
  await updateJob(jobId, { message: "Loading aviation assets from DB…", progress: 20 });

  const assets = await db
    .select({
      id: assetsTable.id,
      identifier: assetsTable.identifier,
      ownerEntityId: assetsTable.ownerEntityId,
      metadata: assetsTable.metadata,
    })
    .from(assetsTable)
    .where(eq(assetsTable.category, "Aviation"));

  await updateJob(jobId, {
    total: assets.length,
    message: `Cross-referencing ${assets.length} aviation assets against ${callsignMap.size} live callsigns…`,
    progress: 25,
  });
  await appendJobLog(jobId, `🗂  ${assets.length} aviation assets loaded. Matching against live traffic…`);

  // ── Step 4: Match and update ──────────────────────────────────────────────
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!;
    const identifier = (asset.identifier ?? "").toUpperCase();
    if (!identifier) { skipped++; continue; }

    const sv = callsignMap.get(identifier);
    if (!sv) { skipped++; continue; }

    try {
      const icao24        = String(sv[0] ?? "");
      const originCountry = String(sv[2] ?? "");
      const longitude     = typeof sv[5] === "number" ? sv[5] : null;
      const latitude      = typeof sv[6] === "number" ? sv[6] : null;
      const baroAlt       = typeof sv[7] === "number" ? sv[7] : null;
      const onGround      = Boolean(sv[8]);
      const velocity      = typeof sv[9] === "number" ? sv[9] : null;
      const track         = typeof sv[10] === "number" ? sv[10] : null;
      const squawk        = sv[14] != null ? String(sv[14]) : null;

      const existingMeta = (() => {
        try { return JSON.parse(asset.metadata ?? "{}"); } catch { return {}; }
      })();

      const flightData = {
        icao24,
        originCountry,
        longitude,
        latitude,
        altitudeFt: metersToFt(baroAlt),
        onGround,
        speedKnots: mpsToKnots(velocity),
        trackDeg: track != null ? Math.round(track) : null,
        squawk,
        lastSeenAt: new Date().toISOString(),
        source: "opensky-network",
      };

      await db
        .update(assetsTable)
        .set({
          lastActivityDate: new Date().toISOString().split("T")[0],
          metadata: JSON.stringify({ ...existingMeta, opensky: flightData }),
        })
        .where(sql`${assetsTable.id} = ${asset.id}`);

      // Live flight activity contributes to Signal only. It must not create an
      // Access-hot lead without a validated person-level contact vector.

      updated++;

      await appendJobLog(
        jobId,
        `✈️  ${identifier} is AIRBORNE — ${latitude?.toFixed(2)}°N ${longitude?.toFixed(2)}°E @ ${metersToFt(baroAlt)?.toLocaleString() ?? "?"}ft / ${mpsToKnots(velocity) ?? "?"}kts`,
      );
    } catch (err: any) {
      logger.warn({ err: err.message, asset: asset.identifier }, "OpenSky update error");
      errors++;
    }

    // Progress update every 500 assets
    if ((i + 1) % 500 === 0) {
      const progress = Math.min(25 + Math.floor(((i + 1) / assets.length) * 70), 95);
      await updateJob(jobId, {
        progress,
        inserted: updated,
        skipped,
        errors,
        message: `Checked ${i + 1}/${assets.length} assets — ${updated} aircraft live right now…`,
      });
    }
  }

  await appendJobLog(
    jobId,
    `🏁 OpenSky enrichment complete: ${updated} jets actively tracked, ${skipped} on ground or not flying, ${errors} errors.`,
  );

  return {
    inserted: updated,
    skipped,
    errors,
    liveAircraft: states.length,
    durationMs: Date.now() - startTime,
  };
}
