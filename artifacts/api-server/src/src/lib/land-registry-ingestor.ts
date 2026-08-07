/**
 * UK Land Registry — Price Paid Data (PPD) CSV Ingestor
 *
 * Source: HM Land Registry bulk CSV (open data, OGL licence)
 * https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
 *
 * Downloads the annual PPD CSV files, filters for £1M+ transactions, and
 * inserts them as Corporation entities + Real Estate assets.
 *
 * The SPARQL endpoint is unreliable for bulk queries; the S3-hosted CSV is
 * the official download route and supports streaming at ~160MB/year.
 *
 * NO synthetic data. Every record is a real HMLR transaction.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, entitiesTable, assetsTable } from "@workspace/db";
import type { InsertEntity, InsertAsset } from "@workspace/db";
import { preloadDedupPrefix, batchMarkSeen, updateJob, appendJobLog } from "./job-queue";
import { logger } from "./logger";

const execAsync = promisify(exec);

// ── Constants ─────────────────────────────────────────────────────────────────

// Annual PPD CSV — redirects to prod2 S3 bucket
const PPD_BASE_URL = "http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com";
const TMP_DIR = join(tmpdir(), "apexfinder-hmlr");

// Cache TTL — re-download if file is older than 30 days
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MIN_PRICE_GBP = 1_000_000; // £1M+

// PPD CSV column indices (0-based, comma-delimited, no header row)
const F_TX_ID        = 0;   // {GUID}
const F_PRICE        = 1;   // numeric string
const F_DATE         = 2;   // "YYYY-MM-DD 00:00"
const F_POSTCODE     = 3;
const F_PROP_TYPE    = 4;   // D/S/T/F/O
const F_DURATION     = 6;   // F=Freehold, L=Leasehold, U=Unknown
const F_PAON         = 7;   // primary addressable object name
const F_SAON         = 8;   // secondary addressable object name
const F_STREET       = 9;
const F_LOCALITY     = 10;
const F_TOWN         = 11;
const F_DISTRICT     = 12;
const F_COUNTY       = 13;
const F_PPD_CAT      = 14;  // A=standard, B=additional (skip B for cleaner data)
const F_REC_STATUS   = 15;  // A=Addition, C=Change, D=Delete

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LandRegIngestionParams {
  jobId: string;
  maxRecords?: number;
  forceRefresh?: boolean;
  downloadUrl?: string; // legacy — unused
}

export interface LandRegIngestionResult {
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function csvPath(year: number): string {
  return join(TMP_DIR, `pp-${year}.csv`);
}

async function isCacheStale(path: string): Promise<boolean> {
  if (!existsSync(path)) return true;
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs > CACHE_TTL_MS;
  } catch { return true; }
}

function bayesianFromPrice(price: number): number {
  if (price >= 10_000_000) return 0.88;
  if (price >= 5_000_000)  return 0.78;
  if (price >= 2_000_000)  return 0.68;
  return 0.58;
}

/** Strip surrounding quotes from a CSV field (PPD uses "" quoting) */
function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1").trim();
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
      .onConflictDoNothing()
      .returning({ id: entitiesTable.id });

    const assetRows = rows.map((r, i) => ({ ...assets[i]!, ownerEntityId: r.id })).filter((a) => a.ownerEntityId);
    if (assetRows.length > 0) {
      await db.insert(assetsTable).values(assetRows).onConflictDoNothing();
    }
    return { inserted: rows.length, errors: 0 };
  } catch (err: any) {
    logger.warn({ err: err.message }, "Land Registry batch insert error");
    return { inserted: 0, errors: entities.length };
  }
}

// ── Main ingestion function ───────────────────────────────────────────────────

export async function runLandRegistryIngestion(params: LandRegIngestionParams): Promise<LandRegIngestionResult> {
  const { jobId, maxRecords = 2_000, forceRefresh = false } = params;
  const startTime = Date.now();
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  await mkdir(TMP_DIR, { recursive: true });

  // Process years newest-first until we hit maxRecords
  const years = [2025, 2024, 2023, 2022];

  // Pre-load existing dedup keys into memory (avoids per-record Upstash calls)
  await updateJob(jobId, { message: "Loading dedup index…", progress: 2 });
  const seenKeys = await preloadDedupPrefix("lr:");
  await appendJobLog(jobId, `📋 ${seenKeys.size.toLocaleString()} previously-ingested Land Registry records in dedup set.`);

  for (const year of years) {
    if (inserted >= maxRecords) break;

    const filePath = csvPath(year);
    const csvUrl = `${PPD_BASE_URL}/pp-${year}.csv`;

    // ── Download if needed ────────────────────────────────────────────────────
    const needsDownload = forceRefresh || await isCacheStale(filePath);
    if (needsDownload) {
      await updateJob(jobId, { message: `Downloading HMLR PPD ${year} CSV…`, progress: 5 });
      await appendJobLog(jobId, `⬇️  Fetching ${csvUrl}`);
      try {
        // -L follows the S3 redirect; --max-time 600 allows for large files
        await execAsync(
          `curl -L --max-time 600 --retry 2 --retry-delay 5 \
            -H "User-Agent: Mozilla/5.0" \
            -o "${filePath}" "${csvUrl}"`,
          { timeout: 620_000 },
        );
        const sizeMB = ((await stat(filePath)).size / 1_048_576).toFixed(1);
        await appendJobLog(jobId, `✅ Download complete (${sizeMB} MB). Scanning records…`);
      } catch (err: any) {
        await appendJobLog(jobId, `⚠️  Download failed for ${year}: ${err.message}. Trying next year.`);
        try { await unlink(filePath); } catch { /* ignore */ }
        continue;
      }
    } else {
      await appendJobLog(jobId, `📦 Using cached PPD ${year} CSV.`);
    }

    // ── Count lines for progress ──────────────────────────────────────────────
    let totalLines = 0;
    try {
      const r = await execAsync(`wc -l < "${filePath}"`, { timeout: 10_000 });
      totalLines = parseInt(r.stdout.trim(), 10) || 0;
    } catch { /* non-fatal */ }

    await updateJob(jobId, { message: `Parsing PPD ${year} (${totalLines.toLocaleString()} records)…`, progress: 8 });

    // ── Stream parse CSV ──────────────────────────────────────────────────────
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    const entityBatch: InsertEntity[] = [];
    const assetBatch: InsertAsset[] = [];
    const pendingDedup: string[] = [];
    let lineNum = 0;
    let lastProgressLine = 0;

    for await (const line of rl) {
      lineNum++;
      if (inserted + entityBatch.length >= maxRecords) break;

      // Unconditional progress heartbeat every 10,000 lines
      if (lineNum - lastProgressLine >= 10_000) {
        lastProgressLine = lineNum;
        const pct = totalLines > 0
          ? Math.min(8 + Math.floor((lineNum / totalLines) * 85), 94)
          : Math.min(8 + Math.floor((inserted / maxRecords) * 85), 94);
        await updateJob(jobId, {
          message: `PPD ${year}: scanned ${lineNum.toLocaleString()} lines — ${inserted.toLocaleString()} records matched…`,
          progress: pct,
          inserted,
        });
      }

      // PPD CSV: fields are quoted with "" — split by comma then unquote
      const raw = line.split(",");
      if (raw.length < 15) continue;

      const txId       = unquote(raw[F_TX_ID] ?? "");
      const priceStr   = unquote(raw[F_PRICE] ?? "");
      const date       = unquote(raw[F_DATE] ?? "").split(" ")[0] ?? "";
      const postcode   = unquote(raw[F_POSTCODE] ?? "");
      const propType   = unquote(raw[F_PROP_TYPE] ?? "");
      const duration   = unquote(raw[F_DURATION] ?? "");
      const paon       = unquote(raw[F_PAON] ?? "");
      const saon       = unquote(raw[F_SAON] ?? "");
      const street     = unquote(raw[F_STREET] ?? "");
      const locality   = unquote(raw[F_LOCALITY] ?? "");
      const town       = unquote(raw[F_TOWN] ?? "");
      const county     = unquote(raw[F_COUNTY] ?? "");
      const ppdCat     = unquote(raw[F_PPD_CAT] ?? "");
      const recStatus  = unquote(raw[F_REC_STATUS] ?? "");

      // Skip deletes and additional category (B = repo/auction sales)
      if (recStatus === "D" || ppdCat === "B") continue;

      const price = parseInt(priceStr, 10);
      if (isNaN(price) || price < MIN_PRICE_GBP) continue;
      if (!txId || !date) continue;

      // Dedup by transaction ID (in-memory — no Upstash per-record call)
      const dkey = `lr:${txId}`;
      if (seenKeys.has(dkey)) { skipped++; continue; }
      seenKeys.add(dkey);
      pendingDedup.push(dkey);

      const tenureLabel = duration === "F" ? "Freehold" : duration === "L" ? "Leasehold" : "Unknown";
      const propLabel   = { D: "Detached", S: "Semi-Detached", T: "Terraced", F: "Flat/Maisonette", O: "Other" }[propType] ?? "Property";
      const address     = [paon, saon, street, locality, town, county, postcode].filter(Boolean).join(", ");
      const priceStr2   = `£${price.toLocaleString("en-GB")}`;
      const score       = bayesianFromPrice(price);

      const entityName = address
        ? `UK Property — ${[paon, street, town].filter(Boolean).join(", ")}`
        : `UK Property — ${postcode}`;

      const entity: InsertEntity = {
        name: entityName,
        type: "Corp",
        nationality: "UK",
        knownResidences: address || undefined,
        sourceRegistries: JSON.stringify(["UK HM Land Registry (PPD)"]),
        bayesianScore: score,
        // Property value is wealth evidence only; it is not a direct contact.
        isHot: false,
        // B2: net worth heuristic — property price × 5 (conservative wealth floor)
        estimatedNetWorth: price * 5,
        notes: `High-value UK property: ${propLabel} (${tenureLabel}). Paid ${priceStr2} on ${date}.`,
        metadata: JSON.stringify({
          source: "hmlr-ppd-csv",
          txId,
          price,
          propType,
          tenure: tenureLabel,
          county,
          postcode,
          date,
          year,
        }),
      };

      const asset: InsertAsset = {
        category: "RealEstate",
        identifier: txId,
        jurisdiction: county ? `${county}, England & Wales` : "England & Wales",
        description: `${propLabel} ${tenureLabel} — ${priceStr2} (${date})`,
        address: address || undefined,
        sourceRegistry: "UK HM Land Registry (PPD)",
        lastActivityDate: date || undefined,
        estimatedValue: price,
      };

      entityBatch.push(entity);
      assetBatch.push(asset);

      if (entityBatch.length >= 50) {
        const res = await flushBatch(entityBatch, assetBatch);
        inserted += res.inserted;
        errors += res.errors;
        entityBatch.length = 0;
        assetBatch.length = 0;

        // Batch-write dedup keys to Upstash (one round-trip per flush)
        await batchMarkSeen(pendingDedup);
        pendingDedup.length = 0;

        const pct = Math.min(8 + Math.floor((inserted / maxRecords) * 85), 95);
        await updateJob(jobId, { message: `${inserted.toLocaleString()} high-value UK properties matched…`, progress: pct, inserted });

        if (inserted % 500 === 0) {
          await appendJobLog(jobId, `🏠 ${inserted.toLocaleString()} £1M+ UK property records ingested…`);
        }
      }
    }

    // Flush remaining
    if (entityBatch.length > 0) {
      const res = await flushBatch(entityBatch, assetBatch);
      inserted += res.inserted;
      errors += res.errors;
      await batchMarkSeen(pendingDedup);
    }
  }

  await appendJobLog(
    jobId,
    `🏁 HMLR PPD complete: ${inserted.toLocaleString()} inserted, ${skipped.toLocaleString()} skipped (dedup), ${errors} errors.`,
  );

  return { inserted, skipped, errors, durationMs: Date.now() - startTime };
}
