/**
 * OCCRP Aleph Enricher
 *
 * Cross-references every entity in our DB against the OCCRP Aleph
 * open investigative data platform (aleph.occrp.org). Aleph aggregates
 * beneficial-ownership data, sanctions lists, company registers, and
 * leaked documents from 200+ datasets.
 *
 * No API key required. Rate-limited to 1 req/s to be a good citizen.
 *
 * For each entity, if Aleph returns a hit:
 *   - Adds aleph metadata (id, datasets, url) to entity.metadata
 *   - Sets isHot=true if entity appears in a sanctions/watchlist dataset
 *
 * API: https://aleph.occrp.org/api/2/
 */

import { db, entitiesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { updateJob, appendJobLog } from "./job-queue";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OccrpEnrichParams {
  jobId: string;
  limit?: number; // max entities to enrich (default 500)
}

export interface OccrpEnrichResult {
  inserted: number;    // entities enriched
  skipped: number;     // no Aleph hit
  errors: number;
  durationMs: number;
}

interface AlephEntity {
  id: string;
  caption: string;
  schema: string;
  properties: Record<string, string[]>;
  datasets: string[];
  score?: number;
}

interface AlephSearchResponse {
  results: AlephEntity[];
  total: { value: number };
}

// Dataset names containing "sanction" or "watchlist" signal high-risk entities
const SANCTIONS_SIGNAL = /sanction|watchlist|ofac|interpol|fatf|pep|oligarch|crimea|russia/i;

const ALEPH_BASE = "https://aleph.occrp.org/api/2";
const RATE_LIMIT_MS = 1_100; // 1 req/s + buffer

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function searchAleph(name: string): Promise<AlephEntity[]> {
  const url = new URL(`${ALEPH_BASE}/entities`);
  url.searchParams.set("q", name);
  url.searchParams.set("filter:schema", "Thing");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("OCCRP rate limit hit");
    throw new Error(`Aleph HTTP ${res.status}`);
  }

  const data = (await res.json()) as AlephSearchResponse;
  return data.results ?? [];
}

/**
 * Fuzzy name match — require ≥ 75% word overlap to avoid false positives.
 * Aleph returns many unrelated entities; we need a confidence gate.
 */
function nameOverlap(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const wa = new Set(normalize(a));
  const wb = new Set(normalize(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.max(wa.size, wb.size);
}

// ── Main enrichment function ──────────────────────────────────────────────────

export async function runOccrpEnrichment(
  params: OccrpEnrichParams,
): Promise<OccrpEnrichResult> {
  const { jobId, limit = 500 } = params;
  const startTime = Date.now();
  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  // Load entities (HNWI + Corporation) up to limit
  await updateJob(jobId, { message: "Loading entities from DB…", progress: 2 });

  const entities = await db
    .select({
      id: entitiesTable.id,
      name: entitiesTable.name,
      type: entitiesTable.type,
      metadata: entitiesTable.metadata,
      isHot: entitiesTable.isHot,
    })
    .from(entitiesTable)
    .limit(limit);

  await updateJob(jobId, {
    total: entities.length,
    message: `Enriching ${entities.length} entities against OCCRP Aleph…`,
    progress: 5,
  });
  await appendJobLog(jobId, `🔍 Loaded ${entities.length} entities. Starting Aleph cross-reference…`);

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;

    try {
      const hits = await searchAleph(entity.name);
      await sleep(RATE_LIMIT_MS);

      // Filter by name similarity
      const match = hits.find((h) => {
        const overlap = nameOverlap(entity.name, h.caption);
        return overlap >= 0.75;
      });

      if (!match) {
        skipped++;
      } else {
        const isSanctioned = match.datasets.some((d) => SANCTIONS_SIGNAL.test(d));
        const existingMeta = (() => {
          try { return JSON.parse(entity.metadata ?? "{}"); } catch { return {}; }
        })();

        const updatedMeta = {
          ...existingMeta,
          aleph: {
            id: match.id,
            caption: match.caption,
            schema: match.schema,
            datasets: match.datasets.slice(0, 10),
            url: `https://aleph.occrp.org/entities/${match.id}`,
            enrichedAt: new Date().toISOString(),
          },
        };

        await db
          .update(entitiesTable)
          .set({
            metadata: JSON.stringify(updatedMeta),
            isHot: entity.isHot || isSanctioned,
            sourceRegistries: sql`
              CASE
                WHEN ${entitiesTable.sourceRegistries} IS NULL THEN '["OCCRP Aleph"]'
                WHEN ${entitiesTable.sourceRegistries} NOT LIKE '%OCCRP Aleph%'
                  THEN json_concat_array(${entitiesTable.sourceRegistries}, '["OCCRP Aleph"]')
                ELSE ${entitiesTable.sourceRegistries}
              END`,
          })
          .where(sql`${entitiesTable.id} = ${entity.id}`);

        enriched++;

        if (isSanctioned) {
          await appendJobLog(
            jobId,
            `🚨 SANCTIONS HIT: ${entity.name} — datasets: ${match.datasets.slice(0, 3).join(", ")}`,
          );
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message, entity: entity.name }, "Aleph lookup failed");
      errors++;
    }

    // Progress update every 25 entities
    if ((i + 1) % 25 === 0 || i === entities.length - 1) {
      const progress = Math.min(5 + Math.floor(((i + 1) / entities.length) * 90), 95);
      await updateJob(jobId, {
        progress,
        inserted: enriched,
        skipped,
        errors,
        message: `Processed ${i + 1}/${entities.length} entities — ${enriched} enriched, ${skipped} no match…`,
      });
      await appendJobLog(
        jobId,
        `📡 ${i + 1}/${entities.length} checked — ${enriched} enriched, ${errors} errors`,
      );
    }
  }

  await appendJobLog(
    jobId,
    `🏁 OCCRP enrichment complete: ${enriched} entities enriched, ${skipped} no match, ${errors} errors.`,
  );

  return {
    inserted: enriched,
    skipped,
    errors,
    durationMs: Date.now() - startTime,
  };
}
