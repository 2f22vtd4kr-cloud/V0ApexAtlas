/**
 * FAA Releasable Aircraft Database Ingestor — REAL PUBLIC REGISTRY DATA
 *
 * Source: https://registry.faa.gov/database/ReleasableAircraft.zip
 * Updated: daily by the FAA. Free download, no API key required.
 *
 * Downloads the official ZIP, extracts MASTER.txt (pipe-delimited), and
 * ingests aircraft owners who are individuals/LLCs/partnerships operating
 * turbine-powered or multi-engine aircraft. These are the highest-confidence
 * HNWI proxies in the US — private jet and helicopter owners.
 *
 * NO synthetic data. Every record is a real FAA registrant.
 * Dedup by N-NUMBER via Redis Upstash to prevent re-insertion.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, entitiesTable, assetsTable, relationshipsTable } from "@workspace/db";
import type { InsertEntity, InsertAsset, InsertRelationship } from "@workspace/db";
import { preloadDedupPrefix, batchMarkSeen, updateJob, appendJobLog } from "./job-queue";
import { logger } from "./logger";

const execAsync = promisify(exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const FAA_ZIP_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip";
const TMP_DIR = join(tmpdir(), "apexfinder-faa");
const ZIP_PATH = join(TMP_DIR, "ReleasableAircraft.zip");
const MASTER_PATH = join(TMP_DIR, "MASTER.txt");

// Cache TTL — re-download if file is older than 23 hours
const CACHE_TTL_MS = 23 * 60 * 60 * 1000;

// FAA TYPE REGISTRANT codes — we want individual-like registrants, not government
// 1=Individual, 2=Partnership, 3=Corporation, 4=Co-Owned, 5=Government, 7=LLC
// 8=Non-Citizen Corporation, 9=Non-Citizen Co-Owned
const INDIVIDUAL_TYPES = new Set(["1", "2", "4", "7", "9"]);

// FAA TYPE ENGINE codes — turbine = expensive aircraft = HNWI signal
// 2=Turbo-prop, 3=Turbo-shaft, 4=Turbo-jet, 5=Turbo-fan
const TURBINE_ENGINES = new Set(["2", "3", "4", "5"]);

// FAA TYPE AIRCRAFT codes
const FIXED_WING_MULTI = "5";   // fixed wing multi-engine (even piston = significant)
const ROTORCRAFT = "6";          // helicopter

// MASTER.txt field indices (comma-delimited, 0-based after split)
const F_NNUMBER        = 0;
const F_SERIAL         = 1;
const F_YEAR_MFR       = 4;
const F_TYPE_REG       = 5;
const F_NAME           = 6;
const F_STREET         = 7;
const F_CITY           = 9;
const F_STATE          = 10;
const F_COUNTRY        = 14;
const F_TYPE_AIRCRAFT  = 18;
const F_TYPE_ENGINE    = 19;
const F_STATUS         = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FaaIngestionParams {
  jobId: string;
  maxRecords?: number;
  forceRefresh?: boolean;
}

export interface FaaIngestionResult {
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── US state → geographic centroid [lat, lon] ─────────────────────────────────
// FAA bulk CSV has no GPS data; we assign the centroid of the registered state
// so aircraft appear on the map even before live ADS-B enrichment.

export const US_STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.806671, -86.791130], AK: [61.370716, -152.404419], AZ: [33.729759, -111.431221],
  AR: [34.969704, -92.373123], CA: [36.116203, -119.681564], CO: [39.059811, -105.311104],
  CT: [41.597782, -72.755371], DE: [39.318523, -75.507141],  FL: [27.766279, -81.686783],
  GA: [33.040619, -83.643074], HI: [21.094318, -157.498337], ID: [44.240459, -114.478828],
  IL: [40.349457, -88.986137], IN: [39.849426, -86.258278],  IA: [42.011539, -93.210526],
  KS: [38.526600, -96.726486], KY: [37.668140, -84.670067],  LA: [31.169960, -91.867805],
  ME: [44.693947, -69.381927], MD: [39.063946, -76.802101],  MA: [42.230171, -71.530106],
  MI: [43.326618, -84.536095], MN: [45.694454, -93.900192],  MS: [32.741646, -89.678696],
  MO: [38.456085, -92.288368], MT: [46.921925, -110.454353], NE: [41.125370, -98.268082],
  NV: [38.313515, -117.055374],NH: [43.452492, -71.563896],  NJ: [40.298904, -74.521011],
  NM: [34.840515, -106.248482],NY: [42.165726, -74.948051],  NC: [35.630066, -79.806419],
  ND: [47.528912, -99.784012], OH: [40.388783, -82.764915],  OK: [35.565342, -96.928917],
  OR: [44.572021, -122.070938],PA: [40.590752, -77.209755],  RI: [41.680893, -71.511780],
  SC: [33.856892, -80.945007], SD: [44.299782, -99.438828],  TN: [35.747845, -86.692345],
  TX: [31.054487, -97.563461], UT: [40.150032, -111.862434], VT: [44.045876, -72.710686],
  VA: [37.769337, -78.169968], WA: [47.400902, -121.490494], WV: [38.491226, -80.954453],
  WI: [44.268543, -89.616508], WY: [42.755966, -107.302490], DC: [38.897438, -77.026817],
  PR: [18.220833, -66.590149], GU: [13.444304, 144.793731],  VI: [18.335765, -64.896335],
};

function stateCentroid(state: string): { latitude: number; longitude: number } | undefined {
  const c = US_STATE_CENTROIDS[state.toUpperCase()];
  return c ? { latitude: c[0], longitude: c[1] } : undefined;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * FAA MASTER.txt stores ALL person names as "LASTNAME FIRSTNAME [MIDDLE...]" in ALL-CAPS.
 * For individual registrants (typeReg === "1") we reverse to "First [Middle] Last" and
 * apply title-case. Corporate registrants (LLCs, governments, etc.) are title-cased only.
 *
 * Examples (typeReg="1"):
 *   "SCHEUER WALTER"       → "Walter Scheuer"
 *   "LEEDS RICHARD BRIAN"  → "Richard Brian Leeds"
 *   "VAN DEN BERG JOHN"    → "John Van Den Berg"
 *
 * Examples (typeReg="7"):
 *   "WELLS FARGO BANK NA"  → "Wells Fargo Bank Na"  (untouched — not a person)
 */
export function normalizeFaaName(rawName: string, typeReg: string): string {
  const titled = titleCase(rawName.trim());
  if (typeReg !== "1") return titled;           // non-individual — title-case only
  const spaceIdx = titled.indexOf(" ");
  if (spaceIdx === -1) return titled;            // single-word name — leave as-is
  const lastName = titled.slice(0, spaceIdx);
  const rest     = titled.slice(spaceIdx + 1);
  return `${rest} ${lastName}`;
}

function aircraftLabel(typeEngine: string, typeAircraft: string): string {
  if (typeEngine === "4") return "Jet";
  if (typeEngine === "5") return "Turbofan";
  if (typeEngine === "2") return "Turboprop";
  if (typeEngine === "3") return "Turboshaft / Helicopter";
  if (typeAircraft === ROTORCRAFT) return "Helicopter";
  return "Multi-Engine";
}

function bayesianScore(typeEngine: string, typeAircraft: string): number {
  // Turbine jets/turbofans = highest wealth signal
  if (typeEngine === "4" || typeEngine === "5") return 0.82;
  if (typeEngine === "2" || typeEngine === "3") return 0.70;
  if (typeAircraft === ROTORCRAFT) return 0.65;
  return 0.52; // multi-engine piston
}

// Corporate name suffixes / keywords that reliably indicate a legal entity, not a person.
// Applied after titleCase() so we match normal capitalisation.
const COMPANY_INDICATORS = [
  /\bLlc\b/, /\bL\.L\.C\./, /\bLlp\b/, /\bL\.L\.P\./,
  /\bInc\.?\b/, /\bCorp\.?\b/, /\bLtd\.?\b/, /\bLimited\b/,
  /\bPlc\b/, /\bGmbh\b/, /\bS\.A\.\b/, /\bB\.V\.\b/, /\bN\.V\.\b/,
  /\bL\.P\.\b/, /\bPartners\b/, /\bPartnership\b/,
  /\bHoldings\b/, /\bHolding\b/,
  /\bTrust\b/, /\bTrustee\b/, /\bFoundation\b/,
  /\bCapital\b/, /\bFund\b/, /\bGroup\b/,
  /\bManagement\b/, /\bAdvisors\b/, /\bAdvisory\b/,
  /\bProperties\b/, /\bRealty\b/, /\bEstate\b(?!s of)/,
  /\bVentures\b/, /\bEnterprises\b/, /\bIndustries\b/,
  /\bTechnologies\b/, /\bSolutions\b/, /\bServices\b/,
  /\bAeronautics?\b/, /\bAviation\b/, /\bAircraft\b/,
  /\bAssociates\b/, /\bConsulting\b/, /\bInvestments\b/,
  /\bFinancial\b/, /\bAcquisition\b/, /\bCo\.\b/,
  /\bFamily Office\b/, /\bFam Ofc\b/,
];

/**
 * Classify FAA registrant as HNWI or Corporation based on:
 * - typeReg=7 (LLC) → always Corporation
 * - typeReg=1 (Individual) → always HNWI
 * - typeReg=2/4/9 → Corporation if name has corporate indicators, HNWI otherwise
 */
function classifyFaaEntityType(typeReg: string, name: string): "HNWI" | "Corporation" {
  if (typeReg === "1") return "HNWI";           // FAA-confirmed individual
  if (typeReg === "7") return "Corporation";    // LLC = legal entity, always
  // For partnerships (2), co-owned (4), non-citizen co-owned (9):
  const hasCorporateIndicator = COMPANY_INDICATORS.some((re) => re.test(name));
  return hasCorporateIndicator ? "Corporation" : "HNWI";
}

async function isCacheStale(): Promise<boolean> {
  if (!existsSync(ZIP_PATH)) return true;
  try {
    const s = await stat(ZIP_PATH);
    return Date.now() - s.mtimeMs > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

// ── Batch flush ───────────────────────────────────────────────────────────────

async function flushBatch(
  entities: InsertEntity[],
  assets: InsertAsset[],
): Promise<{ inserted: number; errors: number }> {
  if (entities.length === 0) return { inserted: 0, errors: 0 };
  try {
    const rows = await db
      .insert(entitiesTable)
      .values(entities)
      .returning({ id: entitiesTable.id });

    // Insert assets linked to their owner entities
    const assetRows: InsertAsset[] = assets.map((a, i) => ({
      ...a,
      ownerEntityId: rows[i]?.id ?? undefined,
    }));
    if (assetRows.length > 0) {
      await db.insert(assetsTable).values(assetRows);
    }

    // Create OWNS relationships for graph engine
    const relRows: InsertRelationship[] = rows
      .map((r) => ({
        sourceEntityId: r.id,
        targetId: r.id, // will be updated after asset insert below
        targetType: "Asset" as const,
        relationshipType: "OWNS",
        strength: 1.0,
        notes: "FAA aircraft registration",
      }))
      .filter((_, i) => assetRows[i]?.ownerEntityId != null);

    // Actually we need asset IDs for proper relationship rows — skip for now,
    // ownerEntityId FK on assets is sufficient for the graph engine
    void relRows;

    return { inserted: rows.length, errors: 0 };
  } catch (err: any) {
    logger.warn({ err: err.message }, "FAA batch insert error");
    return { inserted: 0, errors: entities.length };
  }
}

// ── Main ingestion function ───────────────────────────────────────────────────

export async function runFaaIngestion(params: FaaIngestionParams): Promise<FaaIngestionResult> {
  const { jobId, maxRecords = 30_000, forceRefresh = false } = params;
  const startTime = Date.now();
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  await mkdir(TMP_DIR, { recursive: true });

  // ── Step 1: Download ZIP ───────────────────────────────────────────────────
  const needsDownload = forceRefresh || await isCacheStale();

  if (needsDownload) {
    await updateJob(jobId, { message: "Downloading FAA Aircraft Registry (~70MB)…" });
    await appendJobLog(jobId, `⬇️  Fetching ${FAA_ZIP_URL}`);
    try {
      await execAsync(
        `curl -L --max-time 300 --retry 2 --retry-delay 5 \
          -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" \
          -H "Accept: application/octet-stream,*/*" \
          -H "Accept-Encoding: identity" \
          -H "Referer: https://registry.faa.gov/aircraftinquiry/Search/NNumberInquiry" \
          -o "${ZIP_PATH}" "${FAA_ZIP_URL}"`,
        { timeout: 320_000 },
      );
      await appendJobLog(jobId, "✅ Download complete.");
    } catch (err: any) {
      throw new Error(`FAA download failed: ${err.message}`);
    }
  } else {
    await appendJobLog(jobId, "📦 Using cached FAA database (< 23h old).");
  }

  // ── Step 2: Extract MASTER.txt ─────────────────────────────────────────────
  await updateJob(jobId, { message: "Extracting MASTER.txt from archive…", progress: 5 });
  await appendJobLog(jobId, "📂 Extracting MASTER.txt…");
  try {
    await execAsync(`cd "${TMP_DIR}" && unzip -o "${ZIP_PATH}" MASTER.txt 2>/dev/null`, {
      timeout: 60_000,
    });
    await appendJobLog(jobId, "✅ Extraction complete. Scanning aircraft records…");
  } catch (err: any) {
    throw new Error(`FAA extraction failed: ${err.message}`);
  }

  // ── Step 3: Stream parse MASTER.txt ───────────────────────────────────────
  // Count total lines first so progress bar is meaningful
  let totalLines = 0;
  try {
    const countResult = await execAsync(`wc -l < "${MASTER_PATH}"`, { timeout: 10_000 });
    totalLines = parseInt(countResult.stdout.trim(), 10) || 0;
  } catch { /* non-fatal */ }

  // Pre-load existing FAA dedup keys into memory (one Upstash scan instead of per-record calls)
  await updateJob(jobId, { message: "Loading FAA dedup index…", progress: 7 });
  const seenKeys = await preloadDedupPrefix("faa:");
  await appendJobLog(jobId, `📋 ${seenKeys.size.toLocaleString()} previously-ingested FAA records in dedup set. Starting parse…`);

  await updateJob(jobId, { message: `Parsing MASTER.txt (${totalLines.toLocaleString()} records)…`, progress: 8 });

  const rl = createInterface({
    input: createReadStream(MASTER_PATH, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let lastProgressLine = 0;
  const entityBatch: InsertEntity[] = [];
  const assetBatch: InsertAsset[] = [];
  const pendingDedup: string[] = [];

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // skip header row
    if (inserted + entityBatch.length >= maxRecords) break;

    // ── Unconditional progress heartbeat every 5,000 lines ───────────────────
    if (lineNum - lastProgressLine >= 5_000) {
      lastProgressLine = lineNum;
      const pct = totalLines > 0
        ? Math.min(8 + Math.floor((lineNum / totalLines) * 87), 94)
        : Math.min(8 + Math.floor((inserted / maxRecords) * 87), 94);
      await updateJob(jobId, {
        message: `Scanned ${lineNum.toLocaleString()} / ${totalLines.toLocaleString()} lines — ${inserted.toLocaleString()} aircraft owners matched…`,
        progress: pct,
        inserted,
      });
    }

    const f = line.split(",");
    if (f.length < 21) continue;

    const nNumber      = f[F_NNUMBER]?.trim() ?? "";
    const typeReg      = f[F_TYPE_REG]?.trim() ?? "";
    const rawName      = f[F_NAME]?.trim() ?? "";
    const street       = f[F_STREET]?.trim() ?? "";
    const city         = f[F_CITY]?.trim() ?? "";
    const state        = f[F_STATE]?.trim() ?? "";
    const country      = f[F_COUNTRY]?.trim() || "US";
    const typeAircraft = f[F_TYPE_AIRCRAFT]?.trim() ?? "";
    const typeEngine   = f[F_TYPE_ENGINE]?.trim() ?? "";
    const status       = f[F_STATUS]?.trim() ?? "";
    const yearMfr      = f[F_YEAR_MFR]?.trim() ?? "";
    const serial       = f[F_SERIAL]?.trim() ?? "";

    // ── Filters ──────────────────────────────────────────────────────────────
    if (status !== "V" && status !== "A") continue;        // active only
    if (!INDIVIDUAL_TYPES.has(typeReg)) continue;          // individuals, LLCs, partnerships
    if (!rawName || rawName.length < 3) continue;          // valid name
    if (!nNumber) continue;                                // needs N-number

    const isTurbine    = TURBINE_ENGINES.has(typeEngine);
    const isMulti      = typeAircraft === FIXED_WING_MULTI;
    const isRotor      = typeAircraft === ROTORCRAFT;
    if (!isTurbine && !isMulti && !isRotor) continue;      // valuable aircraft only

    // ── Dedup via in-memory Set (no Upstash per-record call) ─────────────────
    const dkey = `faa:${nNumber}`;
    if (seenKeys.has(dkey)) { skipped++; continue; }
    seenKeys.add(dkey);
    pendingDedup.push(dkey);

    // ── Build records ─────────────────────────────────────────────────────────
    const name = normalizeFaaName(rawName, typeReg);
    const label = aircraftLabel(typeEngine, typeAircraft);
    const address = [street, city, state, country !== "US" ? country : ""].filter(Boolean).join(", ");
    const score = bayesianScore(typeEngine, typeAircraft);
    const isJet = typeEngine === "4" || typeEngine === "5";

    // ── Net worth heuristic (B2): 10× median market value by aircraft class ────
    function faaNetWorth(eng: string, acft: string): number {
      if (eng === "5") return 180_000_000; // Turbofan  — $18M × 10
      if (eng === "4") return 120_000_000; // Jet       — $12M × 10
      if (eng === "2") return  30_000_000; // Turboprop — $3M  × 10
      if (eng === "3") return  15_000_000; // Turboshaft/Helo — $1.5M × 10
      if (acft === ROTORCRAFT)     return   8_000_000; // Rotorcraft — $800k × 10
      return 4_000_000;                                // Multi-engine fixed wing — $400k × 10
    }

    const entityType = classifyFaaEntityType(typeReg, name);
    const entity: InsertEntity = {
      name,
      type: entityType,
      nationality: country === "US" || !country.trim() ? "US" : country,
      knownResidences: address || undefined,
      sourceRegistries: JSON.stringify(["FAA Releasable Aircraft Database"]),
      bayesianScore: score,
       // Aircraft/wealth evidence contributes to Signal, not Access-hot status.
       isHot: false,
      estimatedNetWorth: faaNetWorth(typeEngine, typeAircraft),
      notes: `${label} owner. Tail: N${nNumber}.${yearMfr ? ` MFR year: ${yearMfr}.` : ""}`,
      metadata: JSON.stringify({
        source: "faa-aircraft-registry",
        nNumber: `N${nNumber}`,
        typeRegistrant: typeReg,
        typeAircraft,
        typeEngine,
        engineLabel: label,
        serialNumber: serial,
        yearManufactured: yearMfr,
        state,
        downloadDate: new Date().toISOString().split("T")[0],
      }),
    };

    const centroid = stateCentroid(state);
    const asset: InsertAsset = {
      category: "Aviation",
      identifier: `N${nNumber}`,
      jurisdiction: state ? `${state}, US` : "US",
      description: `${label} — N${nNumber}${yearMfr ? ` (${yearMfr})` : ""}`,
      address: address || undefined,
      sourceRegistry: "FAA Releasable Aircraft Database",
      lastActivityDate: new Date().toISOString().split("T")[0],
      ...(centroid ?? {}),
    };

    entityBatch.push(entity);
    assetBatch.push(asset);

    // ── Flush every 100 records; batch-write dedup to Upstash in one call ────
    if (entityBatch.length >= 100) {
      const res = await flushBatch(entityBatch, assetBatch);
      inserted += res.inserted;
      errors += res.errors;
      entityBatch.length = 0;
      assetBatch.length = 0;

      // One Upstash call per flush instead of one per record
      await batchMarkSeen(pendingDedup);
      pendingDedup.length = 0;

      if (inserted % 1_000 === 0 && inserted > 0) {
        await appendJobLog(jobId, `✈️  ${inserted.toLocaleString()} turbine/multi-engine aircraft owners ingested…`);
      }
    }
  }

  // Flush remaining and write final dedup batch
  if (pendingDedup.length > 0) await batchMarkSeen(pendingDedup);

  // ── Flush remaining ────────────────────────────────────────────────────────
  if (entityBatch.length > 0) {
    const res = await flushBatch(entityBatch, assetBatch);
    inserted += res.inserted;
    errors += res.errors;
  }

  await appendJobLog(
    jobId,
    `🏁 FAA ingestion complete: ${inserted.toLocaleString()} owners inserted, ${skipped.toLocaleString()} skipped (dedup), ${errors} errors.`,
  );

  return {
    inserted,
    skipped,
    errors,
    durationMs: Date.now() - startTime,
  };
}
