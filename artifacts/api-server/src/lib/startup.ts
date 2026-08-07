/**
 * Cold-Start Recovery — runs once at API server boot.
 *
 * 1. Clears ghost active-job locks from any prior process that was killed
 *    (job metadata lives in Upstash; the actual async function dies with the process).
 * 2. Checks DB entity count; if 0, auto-starts all three ingestion pipelines.
 *
 * This makes every cold-start from a GitHub import fully automatic:
 * the user just waits a few minutes for data to appear.
 */

import { db, entitiesTable, assetsTable } from "@workspace/db";
import { count, gte, eq, and, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  createJob, updateJob, setActiveJob, getActiveJob, getJob, clearActiveJob,
  clearDedup, getDedupCount,
} from "./job-queue";
import { runFaaIngestion, US_STATE_CENTROIDS, normalizeFaaName } from "./faa-ingestor";
import { runLandRegistryIngestion } from "./land-registry-ingestor";
import { runWesternHnwiIngestion, classifyEntityType } from "./western-hnwi-ingestion";
import { logger } from "./logger";
import { contactCacheScanAll, contactCacheCount, contactCacheSet, type CachedContact, delCachePattern } from "./redis";
import { warmUpSemanticEngine } from "./semantic-engine";
import { computeContactConfidence } from "./contact-confidence";
import {
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  sanitizePublicSocialHandle,
  sanitizePublicTelegramHandle,
} from "./contact-validation";

const INGESTOR_TYPES = ["faa", "land-registry", "western-hnwi", "companies-house-enrich", "occrp", "opensky", "improve", "web-osint", "bulk-hybrid-research", "in-house-enrich", "deep-web-osint", "compute-embeddings", "social-discovery", "messenger-discovery", "foundation-filings", "broad-discovery", "atlas-run"] as const;

/**
 * Mark jobs whose worker process is dead as failed, clear their locks.
 *
 * A queued job is also stale after a restart: the bulk research route creates
 * its Redis job before entering the async worker, so a process killed in that
 * tiny window leaves a queued lock forever. Treat both queued and running
 * active jobs as process-owned state that cannot survive a server restart.
 */
async function clearGhostJobs(): Promise<void> {
  for (const type of INGESTOR_TYPES) {
    try {
      const jobId = await getActiveJob(type);
      if (!jobId) continue;
      const job = await getJob(jobId);
      if (job?.status === "running" || job?.status === "queued") {
        await updateJob(jobId, {
          status: "failed",
          message: "Process was killed before the job completed — restart job to continue.",
          finishedAt: new Date().toISOString(),
        });
        await clearActiveJob(type);
        logger.warn({ type, jobId }, "Cleared ghost active-job lock from previous process");
      }
    } catch (err: any) {
      logger.warn({ type, err: err?.message }, "Error clearing ghost job (non-fatal)");
    }
  }
}

/**
 * Remove search-engine diagnostics and placeholder emails that were persisted
 * before the shared public-contact validator existed. This is intentionally
 * idempotent and runs before Redis restore so the cache cannot reintroduce a
 * known false positive after a database re-import.
 */
async function sanitizePersistedContactData(): Promise<void> {
  let scrubbedCache = 0;
  let scrubbedEntities = 0;

  try {
    const cached = await contactCacheScanAll();
    for (const { key, data } of cached) {
      const email = sanitizePublicEmail(data.email);
      const phone = sanitizePublicPhone(data.phone);
      const linkedinUrl = sanitizePublicSocialUrl(data.linkedinUrl, "linkedin", "person");
      const twitterHandle = sanitizePublicSocialHandle(data.twitterHandle ?? data.twitter, "twitter");
      const instagramHandle = sanitizePublicSocialHandle(data.instagramHandle, "instagram");
      const telegramHandle = sanitizePublicTelegramHandle(data.telegramHandle);
      const changed =
        email !== (data.email ?? null) ||
        phone !== (data.phone ?? null) ||
        linkedinUrl !== (data.linkedinUrl ?? null) ||
        twitterHandle !== (data.twitterHandle ?? data.twitter ?? null) ||
        instagramHandle !== (data.instagramHandle ?? null) ||
        telegramHandle !== (data.telegramHandle ?? null);
      if (!changed) continue;
      const cleaned: CachedContact = {
        ...data,
        email,
        phone,
        linkedinUrl,
        twitterHandle,
        twitter: twitterHandle,
        instagramHandle,
        telegramHandle,
        contactConfidence: computeContactConfidence({
          email,
          phone,
          linkedinUrl,
          twitterHandle,
          instagramHandle,
          telegramHandle,
        }),
      };
      await contactCacheSet(key, cleaned);
      scrubbedCache++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Contact cache email sanitation failed (non-fatal)");
  }

  try {
    const rows = await db
      .select({
        id: entitiesTable.id,
        type: entitiesTable.type,
        email: entitiesTable.email,
        phone: entitiesTable.phone,
        linkedinUrl: entitiesTable.linkedinUrl,
        twitterHandle: entitiesTable.twitterHandle,
        instagramHandle: entitiesTable.instagramHandle,
        telegramHandle: entitiesTable.telegramHandle,
        knownResidences: entitiesTable.knownResidences,
      })
      .from(entitiesTable)
      .where(or(
        isNotNull(entitiesTable.email),
        isNotNull(entitiesTable.phone),
        isNotNull(entitiesTable.linkedinUrl),
        isNotNull(entitiesTable.twitterHandle),
        isNotNull(entitiesTable.instagramHandle),
        isNotNull(entitiesTable.telegramHandle),
      ));

    for (const entity of rows) {
      const email = sanitizePublicEmail(entity.email);
      const phone = sanitizePublicPhone(entity.phone);
      const linkedinUrl = sanitizePublicSocialUrl(entity.linkedinUrl, "linkedin", "person");
      const twitterHandle = sanitizePublicSocialHandle(entity.twitterHandle, "twitter");
      const instagramHandle = sanitizePublicSocialHandle(entity.instagramHandle, "instagram");
      const telegramHandle = sanitizePublicTelegramHandle(entity.telegramHandle);
      const changed =
        email !== entity.email ||
        phone !== entity.phone ||
        linkedinUrl !== entity.linkedinUrl ||
        twitterHandle !== entity.twitterHandle ||
        instagramHandle !== entity.instagramHandle ||
        telegramHandle !== entity.telegramHandle;
      if (!changed) continue;
      const contactConfidence = computeContactConfidence({
        type: entity.type,
        email,
        phone,
        linkedinUrl,
        twitterHandle,
        instagramHandle,
        telegramHandle,
        knownResidences: entity.knownResidences,
      });
      await db.update(entitiesTable)
        .set({
          email,
          phone,
          linkedinUrl,
          twitterHandle,
          instagramHandle,
          telegramHandle,
          contactConfidence,
          updatedAt: new Date(),
        })
        .where(eq(entitiesTable.id, entity.id));
      scrubbedEntities++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "PostgreSQL email sanitation failed (non-fatal)");
  }

  if (scrubbedCache || scrubbedEntities) {
    await delCachePattern("entities:list:*");
    await delCachePattern("dashboard:*");
  }
  logger.info({ scrubbedCache, scrubbedEntities }, "Persisted contact data sanitation complete");
}

/** Fire-and-forget background ingestor. */
function startIngestor(
  type: string,
  runner: (opts: any) => Promise<any>,
  opts: Record<string, unknown>,
): void {
  (async () => {
    const jobId = await createJob(type);
    await setActiveJob(type, jobId);
    try {
      await updateJob(jobId, { status: "running", message: "Auto-started on cold boot…" });
      const result = await runner({ ...opts, jobId });
      await updateJob(jobId, {
        status: "done",
        progress: 100,
        inserted: result.inserted ?? 0,
        skipped: result.skipped ?? 0,
        errors: result.errors ?? 0,
        finishedAt: new Date().toISOString(),
        message: `Done — ${(result.inserted ?? 0).toLocaleString()} inserted`,
      });
      logger.info({ type, inserted: result.inserted }, "Auto-ingestion complete");
    } catch (err: any) {
      logger.error({ type, err: err?.message }, "Auto-ingestion failed");
      await updateJob(jobId, { status: "failed", message: err?.message ?? "Unknown error", finishedAt: new Date().toISOString() });
      await clearActiveJob(type);
    }
  })();
}

/**
 * Runs background maintenance tasks when the DB is already populated.
 * All steps are idempotent and fire-and-forget (non-fatal if they fail).
 */
async function runPopulatedDbMaintenance(): Promise<void> {
  logger.info("Running populated-DB maintenance tasks…");

  // Remove known false positives before Redis restore and cache backfill.
  await sanitizePersistedContactData();

  // 0. Restore contact data from Redis slot 2 (REDIS_URL_2) — runs first so downstream
  //    steps (isHot sync, enricher, etc.) see the restored contact confidence values.
  try {
    const cacheCount = await contactCacheCount();
    logger.info({ cacheCount }, "Maintenance: contact cache entries in Redis slot 2");
    if (cacheCount > 0) {
      const cached = await contactCacheScanAll();
      logger.info({ total: cached.length }, "Maintenance: restoring contacts from Redis cache…");
      let restored = 0;
      const CHUNK = 100;
      for (let i = 0; i < cached.length; i += CHUNK) {
        await Promise.all(cached.slice(i, i + CHUNK).map(async ({ key, data }) => {
          try {
            // Match by entity-unique stable key prefix → targeted JSONB lookup per source
            type EntityRow = { id: number; email: string | null; phone: string | null; linkedinUrl: string | null; metadata: string | null };
            const SEL = { id: entitiesTable.id, email: entitiesTable.email, phone: entitiesTable.phone, linkedinUrl: entitiesTable.linkedinUrl, metadata: entitiesTable.metadata };
            let entity: EntityRow | undefined;
            if (key.startsWith("faa:")) {
              const nNum = key.slice(4);
              entity = await db.select(SEL).from(entitiesTable).where(sql`${entitiesTable.metadata}::jsonb->>'nNumber' = ${nNum}`).limit(1).then(r => r[0]);
            } else if (key.startsWith("edgar:")) {
              const slug = key.slice(6);
              entity = await db.select(SEL).from(entitiesTable).where(sql`regexp_replace(lower(coalesce(${entitiesTable.metadata}::jsonb->>'entityName','')), '[^a-z0-9]+', '_', 'g') = ${slug}`).limit(1).then(r => r[0]);
            } else if (key.startsWith("brreg:")) {
              const orgnr = key.slice(6);
              entity = await db.select(SEL).from(entitiesTable).where(sql`${entitiesTable.metadata}::jsonb->>'orgnr' = ${orgnr}`).limit(1).then(r => r[0]);
            } else if (key.startsWith("ch:")) {
              const num = key.slice(3);
              entity = await db.select(SEL).from(entitiesTable).where(sql`${entitiesTable.metadata}::jsonb->>'companyNumber' = ${num}`).limit(1).then(r => r[0]);
            } else if (key.startsWith("name:")) {
              const normalized = key.slice(5).replace(/_/g, " ");
              entity = await db.select(SEL).from(entitiesTable).where(sql`lower(${entitiesTable.name}) = ${normalized}`).limit(1).then(r => r[0]);
            } else {
              return; // Legacy key format (e.g. "FAA Releasable Aircraft Database") — skip
            }
            if (!entity) return;
            // Only restore if entity has no contact data currently
            if (entity.email || entity.phone || entity.linkedinUrl) return;
            const updates: Record<string, unknown> = { updatedAt: new Date() };
            if (data.email)      updates["email"]      = data.email;
            if (data.phone)      updates["phone"]      = data.phone;
            if (data.linkedinUrl) updates["linkedinUrl"] = data.linkedinUrl;
            updates["contactConfidence"] = data.contactConfidence;
            // Restore metadata fields
            let meta: Record<string, unknown> = {};
            try { meta = JSON.parse(entity.metadata ?? "{}"); } catch { /* */ }
            if (data.website)    meta["website"]    = data.website;
            if (data.twitter)    meta["twitter"]    = data.twitter;
            if (data.enrichmentSources?.length) meta["enrichmentSources"] = data.enrichmentSources;
            if (data.enrichedAt) meta["enrichedAt"] = data.enrichedAt;
            if (data.emailConfidence != null) meta["emailConfidence"] = data.emailConfidence;
            if (data.phoneConfidence != null) meta["phoneConfidence"] = data.phoneConfidence;
            if (data.sourceHits) meta["sourceHits"] = data.sourceHits;
            meta["enricherVersion"] = "v2";
            meta["needsEnrichment"] = false;
            meta["restoredFromCache"] = true;
            updates["metadata"] = JSON.stringify(meta);
            updates["liveSource"] = true;
            await db.update(entitiesTable).set(updates as any).where(eq(entitiesTable.id, entity.id));
            restored++;
          } catch { /* skip malformed entry */ }
        }));
      }
      logger.info({ restored, total: cached.length }, "Maintenance: contact cache restore complete");
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: contact cache restore failed (non-fatal)");
  }

  // 0b. Backfill Redis contact cache from PostgreSQL — captures enrichments done before
  //     the Redis-mirror code was deployed. Skips keys already present in cache.
  try {
    const enriched = await db
      .select({
        id: entitiesTable.id,
        name: entitiesTable.name,
        email: entitiesTable.email,
        phone: entitiesTable.phone,
        linkedinUrl: entitiesTable.linkedinUrl,
        sourceRegistries: entitiesTable.sourceRegistries,
        contactConfidence: entitiesTable.contactConfidence,
        metadata: entitiesTable.metadata,
      })
      .from(entitiesTable)
      .where(sql`(${entitiesTable.email} IS NOT NULL OR ${entitiesTable.phone} IS NOT NULL OR ${entitiesTable.linkedinUrl} IS NOT NULL) AND ${entitiesTable.contactConfidence} > 0`);

    if (enriched.length > 0) {
      logger.info({ count: enriched.length }, "Maintenance: backfilling Redis contact cache from PostgreSQL…");
      let backfilled = 0;
      const BCHUNK = 50;
      for (let i = 0; i < enriched.length; i += BCHUNK) {
        await Promise.all(enriched.slice(i, i + BCHUNK).map(async (e) => {
          try {
            let meta: Record<string, unknown> = {};
            try { meta = JSON.parse(e.metadata ?? "{}"); } catch { /* */ }
            // Entity-unique stable key — survives DB resets; same logic as ingest.ts enrichers
            const stableKey = (() => {
              if (meta["nNumber"])       return `faa:${meta["nNumber"]}`;
              if (meta["entityName"])    return `edgar:${String(meta["entityName"]).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
              if (meta["orgnr"])         return `brreg:${meta["orgnr"]}`;
              if (meta["companyNumber"]) return `ch:${meta["companyNumber"]}`;
              return `name:${e.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
            })();
            const data: CachedContact = {
              name: e.name,
              email: e.email ?? undefined,
              phone: e.phone ?? undefined,
              linkedinUrl: e.linkedinUrl ?? undefined,
              website: meta["website"] as string | undefined,
              twitter: meta["twitter"] as string | undefined,
              contactConfidence: e.contactConfidence ?? 0,
              enrichmentSources: Array.isArray(meta["enrichmentSources"]) ? meta["enrichmentSources"] as string[] : [],
              enrichedAt: meta["enrichedAt"] as string ?? new Date().toISOString(),
              emailConfidence: meta["emailConfidence"] as number | undefined,
              phoneConfidence: meta["phoneConfidence"] as number | undefined,
              sourceHits: meta["sourceHits"] as Record<string, number> | undefined,
            };
            await contactCacheSet(stableKey, data);
            backfilled++;
          } catch { /* skip */ }
        }));
      }
      logger.info({ backfilled, total: enriched.length }, "Maintenance: Redis contact cache backfill complete");
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: Redis contact cache backfill failed (non-fatal)");
  }

  // 1. Do not derive isHot from wealth/registry score. Hot is an access flag,
  // and is set only by validated person-level direct-contact paths.
  try {
    logger.info("Maintenance: skipped wealth-score hot flag promotion");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: hot flag sync failed (non-fatal)");
  }

  // 1a. Normalize FAA individual names: stored as "Last First" → fix to "First Last"
  // Idempotent — skips records where metadata.nameMigrated === true
  try {
    const faaRows = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
      .from(entitiesTable)
      .where(sql`${entitiesTable.sourceRegistries}::text LIKE '%FAA%' AND (${entitiesTable.metadata}::jsonb->>'nameMigrated') IS NULL`);
    const faaUpdates: { id: number; name: string }[] = [];
    for (const row of faaRows) {
      const meta = (typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {})) as Record<string, unknown>;
      const typeReg = (meta["typeRegistrant"] as string) ?? "";
      const newName = normalizeFaaName(row.name, typeReg);
      if (newName !== row.name) faaUpdates.push({ id: row.id, name: newName });
    }
    const FCHUNK = 100;
    for (let i = 0; i < faaUpdates.length; i += FCHUNK) {
      const chunk = faaUpdates.slice(i, i + FCHUNK);
      await Promise.all(chunk.map(u =>
        db.update(entitiesTable)
          .set({ name: u.name, metadata: sql`jsonb_set(COALESCE(${entitiesTable.metadata}::jsonb, '{}'::jsonb), '{nameMigrated}', 'true'::jsonb)`, updatedAt: new Date() })
          .where(eq(entitiesTable.id, u.id))
      ));
    }
    // Mark all remaining FAA records as migrated (those that didn't need renaming)
    await db.execute(sql`UPDATE entities SET metadata = jsonb_set(COALESCE(metadata::jsonb, '{}'::jsonb), '{nameMigrated}', 'true'::jsonb) WHERE metadata::text LIKE '%FAA%' AND (metadata::jsonb->>'nameMigrated') IS NULL`);
    logger.info({ renamed: faaUpdates.length, total: faaRows.length }, "Maintenance: FAA names normalized to First Last order");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: FAA name normalization failed (non-fatal)");
  }

  // 1b. Normalize EDGAR ALL-CAPS "LAST FIRST" names to "First Last" (title-cased)
  // Targets HNWI/Gatekeeper entities where name is ≥85% uppercase characters.
  // Idempotent — skips records where metadata.edgarNameMigrated === true
  try {
    const edgarRows = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
      .from(entitiesTable)
      .where(sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper') AND (${entitiesTable.metadata}::jsonb->>'edgarNameMigrated') IS NULL`);
    const edgarUpdates: { id: number; name: string }[] = [];
    for (const row of edgarRows) {
      const name = row.name.trim();
      const letters = name.replace(/[^a-zA-Z]/g, "");
      const upperRatio = letters.length > 0 ? (name.match(/[A-Z]/g) ?? []).length / letters.length : 0;
      if (upperRatio < 0.85 || !name.includes(" ")) continue;
      const stripped = name.replace(/\s+ET\s+AL\.?\s*$/i, "").trim();
      const titled = stripped.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      const spaceIdx = titled.indexOf(" ");
      if (spaceIdx === -1) continue;
      const normalized = `${titled.slice(spaceIdx + 1)} ${titled.slice(0, spaceIdx)}`;
      if (normalized !== row.name) edgarUpdates.push({ id: row.id, name: normalized });
    }
    const ECHUNK = 100;
    for (let i = 0; i < edgarUpdates.length; i += ECHUNK) {
      const chunk = edgarUpdates.slice(i, i + ECHUNK);
      await Promise.all(chunk.map(u =>
        db.update(entitiesTable)
          .set({ name: u.name, metadata: sql`jsonb_set(COALESCE(${entitiesTable.metadata}::jsonb, '{}'::jsonb), '{edgarNameMigrated}', 'true'::jsonb)`, updatedAt: new Date() })
          .where(eq(entitiesTable.id, u.id))
      ));
    }
    // Mark all remaining HNWI/Gatekeeper as migrated
    await db.execute(sql`UPDATE entities SET metadata = jsonb_set(COALESCE(metadata::jsonb, '{}'::jsonb), '{edgarNameMigrated}', 'true'::jsonb) WHERE type IN ('HNWI', 'Gatekeeper') AND (metadata::jsonb->>'edgarNameMigrated') IS NULL`);
    logger.info({ renamed: edgarUpdates.length, total: edgarRows.length }, "Maintenance: EDGAR names normalized to First Last order");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: EDGAR name normalization failed (non-fatal)");
  }

  // 2. Reclassify entity types (Corporation/Trust by name pattern)
  try {
    const rows = await db.select({ id: entitiesTable.id, name: entitiesTable.name }).from(entitiesTable);
    const corps: number[] = [];
    const trusts: number[] = [];
    for (const row of rows) {
      const t = classifyEntityType(row.name);
      if (t === "Corporation") corps.push(row.id);
      else if (t === "Trust") trusts.push(row.id);
    }
    const CHUNK = 500;
    for (let i = 0; i < corps.length; i += CHUNK) {
      await db.update(entitiesTable)
        .set({ type: "Corporation", updatedAt: new Date() })
        .where(inArray(entitiesTable.id, corps.slice(i, i + CHUNK)));
    }
    for (let i = 0; i < trusts.length; i += CHUNK) {
      await db.update(entitiesTable)
        .set({ type: "Trust", updatedAt: new Date() })
        .where(inArray(entitiesTable.id, trusts.slice(i, i + CHUNK)));
    }
    logger.info({ corps: corps.length, trusts: trusts.length }, "Maintenance: entity types reclassified");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: reclassify failed (non-fatal)");
  }

  // 3. Backfill lat/lon for FAA aviation assets that are missing coordinates
  try {
    const nullCoords = await db
      .select({ id: assetsTable.id, jurisdiction: assetsTable.jurisdiction })
      .from(assetsTable)
      .where(and(eq(assetsTable.category, "Aviation"), sql`${assetsTable.latitude} IS NULL`));

    const byState = new Map<string, number[]>();
    for (const row of nullCoords) {
      const code = row.jurisdiction?.split(",")[0]?.trim().toUpperCase() ?? "";
      if (!US_STATE_CENTROIDS[code]) continue;
      const arr = byState.get(code) ?? [];
      arr.push(row.id);
      byState.set(code, arr);
    }
    let coordsUpdated = 0;
    for (const [code, ids] of byState.entries()) {
      const c = US_STATE_CENTROIDS[code]!;
      for (let i = 0; i < ids.length; i += 500) {
        await db.update(assetsTable)
          .set({ latitude: c[0], longitude: c[1] })
          .where(inArray(assetsTable.id, ids.slice(i, i + 500)));
      }
      coordsUpdated += ids.length;
    }
    logger.info({ updated: coordsUpdated, total: nullCoords.length }, "Maintenance: FAA coordinates synced");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: FAA coordinate sync failed (non-fatal)");
  }

  // 4. Backfill liveSource provenance marker in metadata
  try {
    const LIVE_PATTERNS = ["faa", "land registry", "hmlr", "sec edgar", "companies house", "brreg"];
    const entities = await db
      .select({ id: entitiesTable.id, sourceRegistries: entitiesTable.sourceRegistries, metadata: entitiesTable.metadata })
      .from(entitiesTable);
    // Collect all updates first, then write in parallel chunks (avoids sequential awaits per row)
    const liveUpdates: Array<{ id: number; metadata: string }> = [];
    for (const e of entities) {
      const sources: string[] = (() => { try { return JSON.parse(e.sourceRegistries ?? "[]"); } catch { return []; } })();
      const meta: Record<string, unknown> = (() => { try { return JSON.parse(e.metadata ?? "{}"); } catch { return {}; } })();
      const isLive = sources.some(s => LIVE_PATTERNS.some(p => s.toLowerCase().includes(p)))
        || !!meta.source || !!meta.nNumber || !!meta.formType || !!meta.orgnr || !!meta.titleNumber;
      if (!isLive || meta.liveSource === true) continue;
      meta.liveSource = true;
      liveUpdates.push({ id: e.id, metadata: JSON.stringify(meta) });
    }
    const PCHUNK = 100;
    for (let i = 0; i < liveUpdates.length; i += PCHUNK) {
      await Promise.all(
        liveUpdates.slice(i, i + PCHUNK).map(u =>
          db.update(entitiesTable).set({ metadata: u.metadata }).where(eq(entitiesTable.id, u.id))
        )
      );
    }
    logger.info({ updated: liveUpdates.length, total: entities.length }, "Maintenance: liveSource markers synced");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Maintenance: liveSource sync failed (non-fatal)");
  }

  logger.info("Populated-DB maintenance complete (steps 1-4). Steps 5-7 running in background…");

  // Steps 5-7 run in parallel as true background tasks — heavy write work,
  // don't block the main maintenance chain or the delayed HTTP triggers.
  Promise.all([

    // 5. Populate sparse notes from filing metadata (batch: 2000 per boot to avoid OOM)
    (async () => {
      try {
        const sparseRows = await db
          .select({ id: entitiesTable.id, notes: entitiesTable.notes, metadata: entitiesTable.metadata,
                    sourceRegistries: entitiesTable.sourceRegistries, type: entitiesTable.type,
                    nationality: entitiesTable.nationality, knownResidences: entitiesTable.knownResidences })
          .from(entitiesTable)
          .where(sql`(${entitiesTable.notes} IS NULL OR length(${entitiesTable.notes}) < 50) AND ${entitiesTable.metadata} IS NOT NULL AND ${entitiesTable.metadata} != '{}'`)
          .limit(2000); // cap per-boot to avoid long-running lock

        // Collect all note updates first, then write in parallel chunks
        const noteUpdates: Array<{ id: number; notes: string }> = [];
        for (const row of sparseRows) {
          let meta: Record<string, any> = {};
          try { meta = JSON.parse(row.metadata ?? "{}"); } catch {}
          const sources: string[] = (() => { try { return JSON.parse(row.sourceRegistries ?? "[]"); } catch { return []; } })();
          const parts: string[] = [];
          if (sources.length > 0) parts.push(`Source: ${sources.join("; ")}.`);
          if (meta.formType) parts.push(`Filing: ${meta.formType}${meta.fileDate ? ` (${meta.fileDate})` : ""}.`);
          if (meta.companyName) parts.push(`Company: ${meta.companyName}.`);
          if (meta.orgnr) parts.push(`Org number: ${meta.orgnr}.`);
          if (meta.roleDesc) parts.push(`Role: ${meta.roleDesc}.`);
          if (row.nationality) parts.push(`Nationality: ${row.nationality}.`);
          if (row.knownResidences) {
            const loc = (() => { try { const r = JSON.parse(row.knownResidences!); return Array.isArray(r) ? r[0] : r; } catch { return row.knownResidences; } })();
            if (loc) parts.push(`Location: ${loc}.`);
          }
          if (row.type) parts.push(`Entity type: ${row.type}.`);
          const newNotes = parts.join(" ");
          if (newNotes && newNotes !== row.notes) noteUpdates.push({ id: row.id, notes: newNotes });
        }
        const PCHUNK = 50;
        for (let i = 0; i < noteUpdates.length; i += PCHUNK) {
          await Promise.all(
            noteUpdates.slice(i, i + PCHUNK).map(u =>
              db.update(entitiesTable).set({ notes: u.notes }).where(eq(entitiesTable.id, u.id))
            )
          );
        }
        logger.info({ updated: noteUpdates.length, total: sparseRows.length }, "Maintenance bg: sparse notes populated");
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Maintenance bg: sparse notes population failed (non-fatal)");
      }
    })(),

    // 6. Create StockHolding assets for EDGAR entities that have none
    (async () => {
      try {
        const edgarEntities = await db
          .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata, knownResidences: entitiesTable.knownResidences })
          .from(entitiesTable)
          .where(sql`${entitiesTable.metadata}::text LIKE '%sec-edgar%' AND ${entitiesTable.metadata}::text NOT LIKE '%sec-edgar-def14a%'`);

        const existingIds = new Set(
          (await db.select({ ownerEntityId: assetsTable.ownerEntityId }).from(assetsTable)
            .where(sql`${assetsTable.ownerEntityId} IS NOT NULL`)).map(r => r.ownerEntityId!)
        );
        const toCreate = edgarEntities.filter(e => !existingIds.has(e.id));
        if (toCreate.length === 0) { logger.info("Maintenance bg: all EDGAR entities already have assets"); return; }

        const assetRows: (typeof assetsTable.$inferInsert)[] = toCreate.map(e => {
          let meta: Record<string, any> = {};
          try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
          const formType = meta.formType ?? "SC 13G";
          const fileDate = meta.fileDate ?? null;
          const location = meta.bizLocation
            ?? ((() => { try { const r = JSON.parse(e.knownResidences ?? "null"); return Array.isArray(r) ? r[0] : r; } catch { return null; } })())
            ?? "US";
          return {
            category: "StockHolding" as const,
            identifier: `EDGAR-${formType.replace(/\s/g, "")}-${e.id}`,
            jurisdiction: "SEC EDGAR",
            description: `Large-shareholder position per ${formType} filing${fileDate ? ` (${fileDate})` : ""}. Beneficial owner: ${e.name}.`,
            address: location || null,
            sourceRegistry: `SEC EDGAR — ${formType}`,
            ownerEntityId: e.id,
            lastActivityDate: fileDate || null,
          };
        });
        const CHUNK = 500;
        for (let i = 0; i < assetRows.length; i += CHUNK) {
          await db.insert(assetsTable).values(assetRows.slice(i, i + CHUNK));
        }
        logger.info({ created: toCreate.length }, "Maintenance bg: EDGAR StockHolding assets created");
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Maintenance bg: EDGAR stock asset creation failed (non-fatal)");
      }
    })(),

    // 7. Clear needsEnrichment=true flags for entities that have been enriched
    (async () => {
      try {
        const flagged = await db
          .select({ id: entitiesTable.id, metadata: entitiesTable.metadata })
          .from(entitiesTable)
          .where(sql`${entitiesTable.metadata}::text LIKE '%"needsEnrichment":true%'`);
        // Collect updates first, then write in parallel chunks
        const toUpdate: Array<{ id: number; metadata: string }> = [];
        for (const row of flagged) {
          const meta: Record<string, unknown> = (() => { try { return JSON.parse(row.metadata ?? "{}"); } catch { return {}; } })();
          if (meta.needsEnrichment !== true) continue;
          const enriched = !!meta.enricherVersion || !!meta.enrichedAt || !!meta.enrichmentSources;
          if (enriched) {
            meta.needsEnrichment = false;
            toUpdate.push({ id: row.id, metadata: JSON.stringify(meta) });
          }
        }
        const PCHUNK = 50;
        for (let i = 0; i < toUpdate.length; i += PCHUNK) {
          await Promise.all(
            toUpdate.slice(i, i + PCHUNK).map(u =>
              db.update(entitiesTable).set({ metadata: u.metadata }).where(eq(entitiesTable.id, u.id))
            )
          );
        }
        logger.info({ cleared: toUpdate.length, total: flagged.length }, "Maintenance bg: needsEnrichment flags cleared");
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Maintenance bg: needsEnrichment clear failed (non-fatal)");
      }
    })(),

  ]).catch(err => logger.warn({ err: err?.message }, "Maintenance bg tasks error (non-fatal)"));

  // 8. After maintenance — fire delayed HTTP triggers for relationship edges, enrichment, and research.
  //    Server is already listening by this point (coldStartRecovery runs fire-and-forget).
  const hasCH = !!process.env["COMPANIES_HOUSE_API_KEY"];

  // ─── Phase-based pipeline scheduler ───────────────────────────────────────
  // All delayed HTTP triggers are declared as a typed array so phases are easy
  // to add, remove, or reorder without hunting through scattered setTimeout calls.

  type Phase = {
    delayMs: number;
    label:   string;
    path:    string;
    body?:   Record<string, unknown>;
    onlyIf?: boolean; // when false the phase is skipped (e.g. optional API key required)
  };

  const phases: Phase[] = [
    // ── PHASE 1: BROAD WEB DISCOVERY (15s–60s) ──────────────────────────────
    // Web OSINT fires FIRST — discover HNWIs from the open internet before any
    // registry work. Social media domains are no longer blocked (web-enricher.ts).
    { delayMs:    15_000, label: "web discovery — deep web (hot leads pass 1)",      path: "/api/ingest/deep-web-osint",        body: { batchSize: 500,  hotOnly: true } },
    { delayMs:    45_000, label: "web discovery — social presence (pass 1)",         path: "/api/ingest/social-discovery",      body: { batchSize: 500,  hotOnly: true } },
    { delayMs:    60_000, label: "web discovery — messenger/Telegram (pass 1)",      path: "/api/ingest/messenger-discovery",   body: { batchSize: 200,  hotOnly: true } },

    // ── PHASE 2: HYBRID ANALYSIS (90s–150s) ─────────────────────────────────
    // Score and rank the discovered candidates.
    { delayMs:    90_000, label: "auto Hybrid Research bulk run (pass 1)",            path: "/api/research/bulk-run",            body: { batchSize: 300, skipExisting: true } },
    { delayMs:   120_000, label: "auto semantic embeddings (G1 — pass 1)",            path: "/api/ingest/compute-embeddings",    body: { batchSize: 2_000 } },
    { delayMs:   150_000, label: "auto semantic entity resolution (dedup pass 1)",    path: "/api/relationships/semantic-dedup" },

    // ── PHASE 3: REGISTRY ENRICHMENT (180s–200s) ────────────────────────────
    // Registry data verifies and augments discovered entities.
    { delayMs:   180_000, label: "auto CH enrichment (needsEnrichment)",              path: "/api/ingest/companies-house-enrich", body: { batchSize: 500 }, onlyIf: hasCH },
    { delayMs:   185_000, label: "auto net worth backfill (asset-based)",             path: "/api/ingest/backfill-net-worth" },
    { delayMs:   190_000, label: "auto EDGAR net worth backfill (shares × price)",    path: "/api/ingest/backfill-edgar-net-worth" },
    { delayMs:   195_000, label: "auto populate-notes from asset descriptions",       path: "/api/ingest/populate-notes" },
    { delayMs:   200_000, label: "auto Wikidata associate seeding",                   path: "/api/relationships/seed-wikidata-associates" },

    // ── PHASE 3b: CONTACT QUALITY BACKFILL (K4/N2 — 210s–215s) ─────────────
    // Run AFTER enrichment so freshly-classified org contacts get correct outcomes.
    { delayMs:   210_000, label: "contact outcome backfill (K4 — classify org vs personal)", path: "/api/ingest/backfill-contact-outcomes" },
    { delayMs:   215_000, label: "flag shared emails (K3 — cross-entity inbox dedup)",       path: "/api/ingest/flag-shared-emails" },

    // ── PHASE 4: RELATIONSHIP GRAPH (240s–300s) ──────────────────────────────
    // Build edges now that both web and registry data exist.
    { delayMs:   240_000, label: "cluster auto-detection",              path: "/api/relationships/auto-detect-clusters" },
    { delayMs:   250_000, label: "shared-address associate detection",  path: "/api/relationships/auto-detect" },
    { delayMs:   260_000, label: "EDGAR co-filer edge detection",       path: "/api/relationships/auto-detect-edgar-cofilers" },
    { delayMs:   270_000, label: "CH co-director edge detection",       path: "/api/relationships/auto-detect-ch-codirectors", onlyIf: hasCH },
    { delayMs:   280_000, label: "EDGAR associate seeding",             path: "/api/relationships/seed-edgar-associates" },
    { delayMs:   290_000, label: "FAA geo-proximity edges",             path: "/api/relationships/auto-detect-faa-geo" },
    { delayMs:   295_000, label: "HMLR postcode-proximity edges",       path: "/api/relationships/auto-detect-hmlr-postcode" },
    { delayMs:   300_000, label: "EDGAR co-shareholder edges",          path: "/api/relationships/auto-detect-edgar-coshareholder" },
    { delayMs:   305_000, label: "EDGAR co-investor edges (I3-A — warm paths)", path: "/api/relationships/auto-detect-edgar-coinvestor" },
    { delayMs:   310_000, label: "name-exact cross-registry dedup (I2)",        path: "/api/relationships/name-exact-dedup" },

    // ── PHASE 5: DEEP CONTACT ENRICHMENT (360s–660s) ─────────────────────────
    // In-depth enrichment on verified, scored, graphed entities.
    { delayMs:   360_000, label: "auto in-house enricher (pass 1 — edgar)",           path: "/api/ingest/in-house-enrich",       body: { batchSize: 5000, targetMode: "edgar" } },
    { delayMs:   420_000, label: "auto foundation filings (IRS 990 — pass 1)",        path: "/api/ingest/foundation-filings",    body: { batchSize: 500 } },
    { delayMs:   425_000, label: "foundation colleague edges (I3-B — co-directors)",  path: "/api/relationships/foundation-colleagues" },
    { delayMs:   480_000, label: "auto in-house enricher (pass 2 — faa)",             path: "/api/ingest/in-house-enrich",       body: { batchSize: 5000, targetMode: "faa" } },
    { delayMs:   540_000, label: "auto social discovery (pass 2 — all HNWI)",         path: "/api/ingest/social-discovery",      body: { batchSize: 1000, hotOnly: false } },
    { delayMs:   600_000, label: "auto in-house enricher (pass 3 — edgar force)",     path: "/api/ingest/in-house-enrich",       body: { batchSize: 5000, targetMode: "edgar", force: true } },
    { delayMs:   660_000, label: "auto pitch backfill",                               path: "/api/research/backfill-pitches" },

    // ── PHASE 6: RESEARCH + SCORING (900s–2700s) ─────────────────────────────
    { delayMs:   900_000, label: "auto persona improvement loop (pass 1)",            path: "/api/improve/run-all",              body: { chunkSize: 500, resume: true } },
    { delayMs: 1_200_000, label: "auto semantic embeddings (G1 — pass 2)",            path: "/api/ingest/compute-embeddings",    body: { batchSize: 5_000, force: true } },
    { delayMs: 1_260_000, label: "auto Hybrid Research bulk run (pass 2)",            path: "/api/research/bulk-run",            body: { batchSize: 300, skipExisting: true } },
    { delayMs: 1_500_000, label: "auto Hybrid Research bulk run (pass 3)",            path: "/api/research/bulk-run",            body: { batchSize: 300, skipExisting: true } },
    { delayMs: 1_800_000, label: "auto semantic entity resolution (G2b — pass 2)",   path: "/api/relationships/semantic-dedup" },
    { delayMs: 1_920_000, label: "auto in-house enricher (pass 4 — faa force)",      path: "/api/ingest/in-house-enrich",       body: { batchSize: 5000, targetMode: "faa", force: true } },
    { delayMs: 2_100_000, label: "auto deep web OSINT (pass 2 — hot leads)",         path: "/api/ingest/deep-web-osint",        body: { batchSize: 500,  hotOnly: true } },
    { delayMs: 2_700_000, label: "auto deep web OSINT (pass 3 — all HNWI)",          path: "/api/ingest/deep-web-osint",        body: { batchSize: 1_000, hotOnly: false } },
    { delayMs: 2_700_000, label: "auto persona improvement loop (pass 2 — force)",   path: "/api/improve/run-all",              body: { chunkSize: 500, resume: false } },
  ];

  // Gate: skip mass auto-pipeline unless explicitly enabled — preserves API credits for targeted runs
  if (process.env["ENABLE_AUTO_PIPELINE"] !== "true") {
    logger.info("Auto pipeline scheduler disabled — set ENABLE_AUTO_PIPELINE=true to enable mass background research");
    return;
  }

  for (const phase of phases) {
    if (phase.onlyIf === false) continue;
    setTimeout(() => triggerHttp(phase.label, phase.path, phase.body), phase.delayMs);
  }

  // ── H2: Recurring background scheduler ───────────────────────────────────────
  // After the one-shot pipeline finishes (~45 min), enter continuous mode.
  // 5 recurring jobs keep the app searching for new HNWIs forever.
  const RECURRING_JOBS = [
    { intervalMs:  30 * 60 * 1_000, label: "recurring broad discovery (rotated templates)", path: "/api/ingest/broad-discovery",     body: { maxQueries: 10, rotateTemplates: true } },
    { intervalMs:  30 * 60 * 1_000, label: "recurring deep web OSINT (hot leads)",          path: "/api/ingest/deep-web-osint",      body: { batchSize: 300, hotOnly: true } },
    { intervalMs:  30 * 60 * 1_000, label: "recurring social discovery (gap-fill)",         path: "/api/ingest/social-discovery",    body: { batchSize: 300, onlyMissingContact: true } },
    { intervalMs:   2 * 60 * 60 * 1_000, label: "recurring Hybrid Engine re-score",         path: "/api/research/bulk-run",          body: { batchSize: 200, skipExisting: false } },
    { intervalMs:   4 * 60 * 60 * 1_000, label: "recurring messenger discovery",            path: "/api/ingest/messenger-discovery", body: { batchSize: 200, onlyMissingContact: true } },
    { intervalMs:   6 * 60 * 60 * 1_000, label: "recurring registry re-verification",      path: "/api/ingest/western-hnwi",        body: { targetCount: 500 } },
    { intervalMs:  24 * 60 * 60 * 1_000, label: "recurring persona loop",                  path: "/api/improve/run-all",            body: { chunkSize: 500, resume: true } },
  ];

  setTimeout(() => {
    for (const job of RECURRING_JOBS) {
      // Fire once immediately when scheduler activates, then on interval
      triggerHttp(job.label, job.path, job.body);
      setInterval(() => triggerHttp(job.label, job.path, job.body), job.intervalMs);
    }
    logger.info("Recurring background scheduler activated (H2)");
  }, 2_800_000); // 46 min — after initial pipeline completes
}

/** Fire a POST to a local API route; log result. Non-fatal. */
async function triggerHttp(label: string, path: string, body?: Record<string, unknown>): Promise<void> {
  const port = process.env["PORT"] ?? "8080";
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      logger.info({ message: (d as any).message ?? d, jobId: (d as any).jobId }, `Maintenance: ${label} triggered`);
    } else {
      logger.info({ status: res.status }, `Maintenance: ${label} — already running or no targets`);
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, `Maintenance: ${label} trigger failed (non-fatal)`);
  }
}

/**
 * Verify Python OSINT tools (Holehe, Maigret) are installed; auto-install if missing.
 *
 * MANDATORY — runs on every boot so tools survive GitHub re-imports.
 * Apex Atlas must not run research without these tools in place.
 */
async function verifyAndInstallPythonTools(): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const check = async (module: string): Promise<boolean> => {
    try { await execFileAsync("python3", ["-c", `import ${module}`], { timeout: 5_000 }); return true; }
    catch { return false; }
  };

  const [holehe, maigret] = await Promise.all([check("holehe"), check("maigret")]);

  if (!holehe || !maigret) {
    logger.warn({ holehe, maigret }, "⚠️  Python OSINT tools missing — auto-installing (Holehe + Maigret)…");
    try {
      // Resolve from workspace root: dist/index.mjs → dist/ → api-server/ → artifacts/ → workspace/
      const wsRoot = new URL("../../..", import.meta.url).pathname;
      await execFileAsync("bash", ["scripts/install-python-tools.sh"], { timeout: 120_000, cwd: wsRoot });
      logger.info("✅ Python OSINT tools installed successfully");
    } catch (err: any) {
      logger.error({ err: err?.message }, "❌ Python OSINT tools installation FAILED — Maigret/Holehe unavailable this session");
    }
  } else {
    logger.info("✅ Python OSINT tools verified: holehe ✓  maigret ✓");
  }
}

/** Main cold-start entry point — call once after Upstash connects. */
export async function coldStartRecovery(): Promise<void> {
  logger.info("Cold-start recovery: checking for ghost jobs…");
  await clearGhostJobs();

  // Always verify/install Python OSINT tools — survives re-imports automatically.
  // This runs regardless of ENABLE_AUTO_PIPELINE so tools are ready before research.
  verifyAndInstallPythonTools().catch((err: any) =>
    logger.warn({ err: err?.message }, "Python tool verification error (non-fatal)")
  );

  // G1: Pre-warm the semantic embedding model and load Redis embedding cache in background.
  // Non-blocking — starts model download (~23 MB on first boot) and cache hydration.
  warmUpSemanticEngine();

  // Research is intentionally opt-in. A fresh import must not begin broad
  // discovery or registry ingestion merely because the database is empty.
  // This also allows a controlled single-target run before any bulk pipeline.
  if (process.env["ENABLE_AUTO_PIPELINE"] !== "true") {
    logger.info("Automatic broad ingestion is disabled (ENABLE_AUTO_PIPELINE is not true)");
    return;
  }

  // Check entity count — retry up to 3× with backoff to handle transient PG startup lag.
  // Previously this returned immediately on any error, causing cold-start to abort
  // and leaving the DB empty with no ingestion triggered.
  let entityCount = 0;
  let countFetched = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [row] = await db.select({ count: count() }).from(entitiesTable);
      entityCount = Number(row?.count ?? 0);
      countFetched = true;
      break;
    } catch (err: any) {
      logger.warn({ err: err?.message, attempt }, `Entity count query failed (attempt ${attempt}/3)${attempt < 3 ? " — retrying in 10s" : " — aborting cold start"}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 10_000));
    }
  }
  if (!countFetched) return;

  if (entityCount > 0) {
    logger.info({ entityCount }, "DB already populated — skipping auto-ingestion; running maintenance…");
    // Fire-and-forget maintenance (isHot sync, reclassify, geocoding, liveSource)
    runPopulatedDbMaintenance().catch((err: any) =>
      logger.warn({ err: err?.message }, "Populated-DB maintenance error (non-fatal)")
    );
    return;
  }

  // DB is empty but Upstash dedup may hold entries from a prior session.
  // If dedup is non-zero, the ingestors will see every record as "already seen"
  // and insert nothing. Clear the stale dedup so ingestors can re-populate from scratch.
  const dedupCount = await getDedupCount();
  if (dedupCount > 0) {
    logger.warn({ dedupCount }, "DB empty but dedup set is non-zero (stale from prior session) — clearing dedup for fresh ingest");
    await clearDedup();
  }

  // DB is empty — fire broad web discovery FIRST, then registries as verification anchors
  logger.info("DB empty — starting broad web discovery (web-first cold start)…");

  // Phase 0: Broad discovery — find HNWIs from the open web immediately
   triggerHttp("broad discovery (cold-start)", "/api/ingest/broad-discovery", { maxQueries: 15, rotateTemplates: true });

  // Phase 1: Registry ingestion (runs in parallel — provides verification data)
  startIngestor("faa",            runFaaIngestion,           { force: false });
  startIngestor("land-registry",  runLandRegistryIngestion,  { force: false });
  startIngestor("western-hnwi",   runWesternHnwiIngestion,   { targetCount: 5_000, batchSize: 100 });

  // Post-ingestion watcher: polls until data arrives, then fires the full maintenance +
  // relationship pipeline. This fixes the cold-start sequencing bug where all relationship
  // triggers (15s–42s) fired on an empty table because the DB takes ~90s to populate.
  (async () => {
    const MAX_WAIT_MS   = 20 * 60 * 1_000; // 20 min ceiling
    const POLL_INTERVAL = 30_000;           // check every 30s
    const THRESHOLD     = 1_000;            // FAA alone inserts 30k — 1k means ingest is well underway
    const started       = Date.now();
    logger.info("Post-ingestion watcher started — maintenance will fire once data arrives");

    while (Date.now() - started < MAX_WAIT_MS) {
      await new Promise<void>(r => setTimeout(r, POLL_INTERVAL));
      try {
        const [row] = await db.select({ count: count() }).from(entitiesTable);
        const current = Number(row?.count ?? 0);
        logger.info(
          { entityCount: current, elapsedSec: Math.round((Date.now() - started) / 1_000) },
          "Post-ingestion watcher: checking…"
        );
        if (current >= THRESHOLD) {
          logger.info({ entityCount: current }, "Cold-start: data arrived — running post-ingestion maintenance & pipeline");
          await runPopulatedDbMaintenance();
          return;
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Post-ingestion watcher: DB check failed (non-fatal)");
      }
    }
    logger.warn("Post-ingestion watcher timed out — manual relationship trigger may be needed");
  })().catch((err: any) =>
    logger.warn({ err: err?.message }, "Post-ingestion watcher error (non-fatal)")
  );
}
