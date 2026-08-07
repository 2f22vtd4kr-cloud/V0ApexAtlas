/**
 * Ingest Enrichment Routes
 *
 * Contact enrichment, OSINT, and data-quality backfill jobs.
 *
 * POST   /ingest/companies-house-enrich     — CH officer address lookup + confidence recompute
 * POST   /ingest/ch-company-officers        — CH company officer lists for Corporation entities
 * POST   /ingest/populate-notes             — Derive notes text from entity metadata
 * POST   /ingest/create-edgar-stock-assets  — Create StockHolding assets for EDGAR entities
 * POST   /ingest/web-osint-enrich           — Layer 1 web OSINT contact discovery
 * DELETE /ingest/web-osint-lock             — Clear ghost web-osint lock
 * POST   /ingest/in-house-enrich            — Layer 2 in-house OSINT enricher (7 free sources)
 * DELETE /ingest/in-house-enrich-lock       — Clear ghost in-house-enrich lock
 * POST   /ingest/recompute-contact-confidence — Recompute contactConfidence for all entities
 * POST   /ingest/sync-livesource-markers    — Backfill liveSource=true for live-registry entities
 * POST   /ingest/backfill-net-worth         — Set estimatedNetWorth = 3× asset value
 * POST   /ingest/backfill-edgar-net-worth   — EDGAR net worth from SEC sharesOwned × price
 * DELETE /ingest/dedup                      — Clear dedup set for re-ingest
 * POST   /ingest/hunter-enrich              — DEPRECATED stub (removed)
 * DELETE /ingest/hunter-enrich-lock         — Clear ghost hunter lock
 */

import { Router, type Request, type Response } from "express";
import { db, assetsTable, entitiesTable, contactEvidenceTable } from "@workspace/db";
import { sql, eq, and, desc, inArray, type SQL } from "drizzle-orm";
import {
  createJob, updateJob, getJob,
  setActiveJob, getActiveJob, clearDedup,
} from "../lib/job-queue";
import { runCompaniesHouseEnrichment } from "../lib/enrichment/structured-verification";
import { deepWebOsintEnrich } from "../lib/enrichment/web-discovery";
import { enrichInHouse } from "../lib/enrichment/contact-enrichment";
import { runMaigret, runHolehe } from "../lib/python-tools";
import { discoverSocialPresence } from "../lib/enrichment/social-discovery";
import { discoverMessengerPresence } from "../lib/enrichment/messenger-discovery";
import { discoverViaFoundationFilings } from "../lib/enrichment/foundation-filings";
import { runBroadDiscovery } from "../lib/enrichment/broad-discovery";
import { computeContactConfidence, computeContactOutcome } from "../lib/contact-confidence";
import {
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  isValidPublicSocialHandle,
  sanitizePublicSocialHandle,
} from "../lib/contact-validation";
import { contactCacheSet, contactCacheScanAll, contactCacheCount, type CachedContact } from "../lib/redis";
import { logger } from "../lib/logger";
import { backfillWealthLLM } from "../lib/wealth-estimator";

const router = Router();

function safeParseJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

// ── POST /ingest/companies-house-enrich ───────────────────────────────────────
router.post("/ingest/companies-house-enrich", async (req, res): Promise<void> => {
  const {
    entityIds,
    batchSize = 50,
    force = false,
  } = req.body as { entityIds?: number[]; batchSize?: number; force?: boolean };

  if (!force) {
    const existingJobId = await getActiveJob("companies-house-enrich");
    if (existingJobId) {
      const existing = await getJob(existingJobId);
      if (existing && existing.status === "running") {
        res.status(409).json({ error: "A Companies House enrichment job is already running.", jobId: existingJobId });
        return;
      }
    }
  }

  const safeEntityIds = Array.isArray(entityIds) ? entityIds.slice(0, 1_000) : undefined;
  const safeBatch = Math.min(Math.max(Number(batchSize) || 50, 1), 500);

  const jobId = await createJob("companies-house-enrich");
  await setActiveJob("companies-house-enrich", jobId);

  (async () => {
    try {
      await updateJob(jobId, { status: "running", message: "Starting Companies House contact enrichment…" });
      const result = await runCompaniesHouseEnrichment({ jobId, entityIds: safeEntityIds, batchSize: safeBatch });
      await updateJob(jobId, {
        status: "done",
        progress: 100,
        inserted: result.enriched,
        skipped: result.skipped,
        errors: result.errors,
        finishedAt: new Date().toISOString(),
        message: `Done — ${result.enriched} entities enriched in ${(result.durationMs / 1000).toFixed(1)}s`,
      });
    } catch (err: any) {
      logger.error({ err: err.message }, "Companies House enrichment failed");
      await updateJob(jobId, { status: "failed", message: err.message ?? "Enrichment failed" });
    }
  })();

  res.status(202).json({
    jobId,
    message: `Contact enrichment started for ${safeEntityIds ? safeEntityIds.length : "all un-enriched"} entities.`,
    pollUrl: `/api/ingest/job/${jobId}`,
    note: process.env.COMPANIES_HOUSE_API_KEY
      ? "COMPANIES_HOUSE_API_KEY detected — will query CH officer search for addresses."
      : "COMPANIES_HOUSE_API_KEY not set — will recompute contactConfidence only.",
  });
});

// ── POST /ingest/ch-company-officers ─────────────────────────────────────────
router.post("/ingest/ch-company-officers", async (req: Request, res: Response): Promise<void> => {
  const { batchSize = 100 } = (req.body as { batchSize?: number } | undefined) ?? {};
  const existingJobId = await getActiveJob("ch-officers");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running") {
      res.status(409).json({ error: "CH officers job already running.", jobId: existingJobId });
      return;
    }
  }
  const jobId = await createJob("ch-officers");
  await setActiveJob("ch-officers", jobId);
  await updateJob(jobId, { status: "running", total: 0, message: "CH company officers enrichment starting…" });

  (async () => {
    try {
      const { runCompanyOfficersEnrichment } = await import("../lib/registry-enricher");
      const result = await runCompanyOfficersEnrichment({ jobId, batchSize });
      await updateJob(jobId, {
        status: "done", progress: 100, inserted: result.enriched,
        message: `Done — ${result.enriched} corps enriched with officer data, ${result.skipped} skipped.`,
      });
    } catch (err: any) {
      await updateJob(jobId, { status: "failed", message: err.message ?? "Unknown error" });
    }
  })();

  res.status(202).json({ jobId, message: "CH company officers job started.", pollUrl: `/api/ingest/job/${jobId}` });
});

// ── POST /ingest/populate-notes ───────────────────────────────────────────────
router.post("/ingest/populate-notes", async (_req: Request, res: Response): Promise<void> => {
  const PAGE = 2000;
  let offset = 0;
  let updated = 0;
  let total = 0;

  while (true) {
    const rows = await db
      .select({
        id: entitiesTable.id,
        notes: entitiesTable.notes,
        metadata: entitiesTable.metadata,
        sourceRegistries: entitiesTable.sourceRegistries,
        type: entitiesTable.type,
        nationality: entitiesTable.nationality,
        knownResidences: entitiesTable.knownResidences,
      })
      .from(entitiesTable)
      .where(sql`${entitiesTable.metadata} IS NOT NULL AND ${entitiesTable.metadata} != '{}'`)
      .limit(PAGE)
      .offset(offset);

    if (rows.length === 0) break;
    total += rows.length;
    offset += PAGE;

    const updates: Array<{ id: number; notes: string }> = [];
    for (const row of rows) {
      let meta: Record<string, any> = {};
      try { meta = JSON.parse(row.metadata ?? "{}"); } catch {}
      const sources: string[] = (() => { try { return JSON.parse(row.sourceRegistries ?? "[]"); } catch { return []; } })();

      const parts: string[] = [];
      if (sources.length > 0) parts.push(`Source: ${sources.join("; ")}.`);
      if (meta.formType) parts.push(`Filing: ${meta.formType}${meta.fileDate ? ` (${meta.fileDate})` : ""}.`);
      if (meta.companyName) parts.push(`Company: ${meta.companyName}.`);
      if (meta.orgnr) parts.push(`Org number: ${meta.orgnr}.`);
      if (meta.roleDesc) parts.push(`Role: ${meta.roleDesc}.`);
      if (meta.chOfficers && Array.isArray(meta.chOfficers) && meta.chOfficers.length > 0) {
        parts.push(`CH directors: ${meta.chOfficers.slice(0, 5).map((o: any) => o.name).join(", ")}.`);
      }
      if (row.nationality) parts.push(`Nationality: ${row.nationality}.`);
      if (row.knownResidences) {
        const loc = (() => { try { const r = JSON.parse(row.knownResidences!); return Array.isArray(r) ? r[0] : r; } catch { return row.knownResidences; } })();
        if (loc) parts.push(`Location: ${loc}.`);
      }
      if (row.type) parts.push(`Entity type: ${row.type}.`);
      if (meta.edgarUrl) parts.push(`EDGAR: ${meta.edgarUrl}.`);

      const newNotes = parts.join(" ");
      if (newNotes && newNotes !== row.notes) {
        updates.push({ id: row.id, notes: newNotes });
      }
    }

    for (const u of updates) {
      await db.update(entitiesTable).set({ notes: u.notes }).where(eq(entitiesTable.id, u.id));
    }
    updated += updates.length;
  }

  res.json({ updated, total, message: `Notes enriched for ${updated} entities.` });
});

// ── POST /ingest/create-edgar-stock-assets ────────────────────────────────────
router.post("/ingest/create-edgar-stock-assets", async (_req: Request, res: Response): Promise<void> => {
  const edgarEntities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata, knownResidences: entitiesTable.knownResidences })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata} LIKE '%sec-edgar%' AND ${entitiesTable.metadata} NOT LIKE '%sec-edgar-def14a%'`);

  const existingAssetEntityIds = new Set(
    (await db.select({ ownerEntityId: assetsTable.ownerEntityId }).from(assetsTable).where(sql`${assetsTable.ownerEntityId} IS NOT NULL`))
      .map((r) => r.ownerEntityId!)
  );

  const toCreate = edgarEntities.filter((e) => !existingAssetEntityIds.has(e.id));

  let created = 0;
  const CHUNK = 500;
  const assetRows: (typeof assetsTable.$inferInsert)[] = [];

  for (const e of toCreate) {
    let meta: Record<string, any> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const formType: string = meta.formType ?? "SC 13G";
    const fileDate: string = meta.fileDate ?? null;
    const location: string = meta.bizLocation ?? ((() => { try { const r = JSON.parse(e.knownResidences ?? "null"); return Array.isArray(r) ? r[0] : r; } catch { return null; } })()) ?? "US";

    assetRows.push({
      category: "StockHolding",
      identifier: `EDGAR-${formType.replace(/\s/g, "")}-${e.id}`,
      jurisdiction: "SEC EDGAR",
      description: `Large-shareholder position per ${formType} filing${fileDate ? ` (${fileDate})` : ""}. Beneficial owner: ${e.name}.`,
      address: location || null,
      sourceRegistry: `SEC EDGAR — ${formType}`,
      ownerEntityId: e.id,
      lastActivityDate: fileDate || null,
    });
  }

  for (let i = 0; i < assetRows.length; i += CHUNK) {
    await db.insert(assetsTable).values(assetRows.slice(i, i + CHUNK));
    created += Math.min(CHUNK, assetRows.length - i);
  }

  res.json({ created, skipped: edgarEntities.length - toCreate.length, total: edgarEntities.length, message: `Created ${created} StockHolding assets for SEC EDGAR entities.` });
});

// ── POST /ingest/web-osint-enrich ─────────────────────────────────────────────
router.post("/ingest/web-osint-enrich", async (req: Request, res: Response): Promise<void> => {
  const existing = await getActiveJob("web-osint");
  if (existing) {
    res.status(409).json({ error: "A web OSINT enrichment job is already running.", jobId: existing });
    return;
  }

  const batchSize  = Math.min(parseInt((req.body as any)?.batchSize ?? "100", 10), 500);
  const entityType = (req.body as any)?.entityType as string | undefined;
  const force      = Boolean((req.body as any)?.force);
  const entityIds  = Array.isArray((req.body as any)?.entityIds)
    ? ((req.body as any).entityIds as unknown[]).map(Number).filter(n => Number.isFinite(n) && n > 0)
    : null;

  const conditions: any[] = [];
  if (entityIds && entityIds.length > 0) {
    conditions.push(inArray(entitiesTable.id, entityIds));
    if (!force) conditions.push(sql`${entitiesTable.contactConfidence} = 0`);
  } else {
    if (!force) conditions.push(sql`${entitiesTable.contactConfidence} = 0`);
    if (entityType) conditions.push(eq(entitiesTable.type, entityType as any));
  }

  const entities = await db
    .select({
      id:               entitiesTable.id,
      name:             entitiesTable.name,
      type:             entitiesTable.type,
      nationality:      entitiesTable.nationality,
      sourceRegistries: entitiesTable.sourceRegistries,
      knownResidences:  entitiesTable.knownResidences,
      metadata:         entitiesTable.metadata,
      bayesianScore:    entitiesTable.bayesianScore,
      instagramHandle:  entitiesTable.instagramHandle,
      twitterHandle:    entitiesTable.twitterHandle,
      notes:            entitiesTable.notes,
      email:            entitiesTable.email,
    })
    .from(entitiesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${entitiesTable.bayesianScore} desc`)
    .limit(batchSize);

  if (entities.length === 0) {
    res.json({ message: "No entities to enrich.", jobId: null });
    return;
  }

  const jobId = await createJob("web-osint");
  await setActiveJob("web-osint", jobId);

  res.status(202).json({
    jobId,
    pollUrl: `/api/ingest/job/${jobId}`,
    total: entities.length,
    message: `Web OSINT enrichment started for ${entities.length} entities.`,
  });

  (async () => {
    let enriched = 0;
    let skipped  = 0;
    let errors   = 0;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      try {
        await updateJob(jobId, {
          progress: i, total: entities.length,
          inserted: enriched, skipped, errors,
          message: `Enriching ${entity.name}…`,
        });

        const result = await deepWebOsintEnrich(entity);
        const cleanEmail = sanitizePublicEmail(result.email);
        const cleanPhone = sanitizePublicPhone(result.phone);
        const cleanLinkedIn = sanitizePublicSocialUrl(result.linkedinUrl, "linkedin", "person");
        const cleanInstagram = sanitizePublicSocialUrl(result.instagramUrl, "instagram", "person");
        const cleanTwitter = sanitizePublicSocialUrl(result.twitterUrl, "twitter", "person");
        const cleanInstagramHandle = sanitizePublicSocialHandle(result.instagramUrl, "instagram");
        const cleanTwitterHandle = sanitizePublicSocialHandle(result.twitterUrl, "twitter");

        const hasSignal = cleanLinkedIn || cleanEmail || cleanPhone
          || cleanInstagram || cleanTwitter || result.evidence.length > 0;
        if (!hasSignal) {
          skipped++;
          continue;
        }

        const confidence = computeContactConfidence({
          type: entity.type,
          email: cleanEmail,
          phone: cleanPhone,
          linkedinUrl: cleanLinkedIn,
          instagramHandle: cleanInstagramHandle,
          twitterHandle: cleanTwitterHandle,
          knownResidences: entity.knownResidences,
        });

        await db.update(entitiesTable)
          .set({
            // When force=true, always write the new result (even null) to wipe stale/garbage
            // values from a previous run that passed invalid data (wrong phone country, bad LinkedIn).
            ...(cleanEmail       ? { email: cleanEmail }             : force ? { email:       null } : {}),
            ...(cleanPhone       ? { phone: cleanPhone }             : force ? { phone:       null } : {}),
            ...(cleanLinkedIn    ? { linkedinUrl: cleanLinkedIn }     : force ? { linkedinUrl: null } : {}),
            // Corp/Trust: social handles from web scraping belong to persons, not the org
            ...(cleanInstagramHandle && !entity.instagramHandle && !["Corporation","Corp","Trust"].includes(entity.type) ? { instagramHandle: cleanInstagramHandle } : {}),
            ...(cleanTwitterHandle   && !entity.twitterHandle   && !["Corporation","Corp","Trust"].includes(entity.type) ? { twitterHandle:   cleanTwitterHandle   } : {}),
            contactConfidence: confidence,
            updatedAt: new Date(),
          })
          .where(eq(entitiesTable.id, entity.id));

        enriched++;
        logger.info({ entityId: entity.id, name: entity.name, confidence, sources: result.sources, queriesFired: result.queriesFired, pagesScraped: result.pagesScraped }, "Web OSINT enriched");

        // ── Phase 2: Maigret — cross-platform social dossier ───────────────────
        // Extract the best handle found by web-OSINT or already on the entity.
        // Flexible re-entry: Maigret runs AFTER web-OSINT within the same job,
        // and if it finds 3+ platforms, web-OSINT fires again with the new context.
          const rawHandle =
          (cleanTwitterHandle ?? "") ||
          (entity.twitterHandle   ?? "").replace(/^@/, "") ||
          (cleanInstagramHandle ?? "") ||
          (entity.instagramHandle ?? "").replace(/^@/, "");
        const cleanHandle = rawHandle.replace(/[^a-zA-Z0-9._\-]/g, "").trim();
         const emailForHolehe = cleanEmail ?? sanitizePublicEmail(entity.email);

        if (cleanHandle || emailForHolehe) {
          await updateJob(jobId, { progress: i, total: entities.length, inserted: enriched, skipped, errors,
            message: `Maigret + Holehe: expanding ${entity.name}…` });

          const [maigretResult, holeheResult] = await Promise.all([
            cleanHandle    ? runMaigret(cleanHandle)       : Promise.resolve(null),
            emailForHolehe ? runHolehe(emailForHolehe)     : Promise.resolve(null),
          ]);

          // Save Maigret cross-platform profiles as social evidence
          if (maigretResult?.found.length) {
            logger.info({ entityId: entity.id, handle: cleanHandle, found: maigretResult.found.length }, "[Maigret] cross-platform profiles found");
            const maigretRows = maigretResult.found.slice(0, 15).map(p => ({
              entityId: entity.id,
              vectorType: "social" as const,
              value: p.url ?? p.siteName,
              source: "maigret",
              sourceUrl: p.url ?? null,
              extractionMethod: "maigret-username-search",
              sourceReliability: 0.7,
              identityMatch: 0.65,
              recencyScore: 0.5,
              directnessScore: 0.6,
              independentCorroboration: 1,
              validationStatus: "candidate" as const,
              metadata: JSON.stringify({ siteName: p.siteName, tags: p.tags ?? [] }),
            }));
            await db.insert(contactEvidenceTable).values(maigretRows).onConflictDoNothing().catch(() => {});

            // Web-OSINT re-run: Maigret found 3+ platforms but no email yet — give the AI extra context
            if (maigretResult.found.length >= 3 && !result.email) {
              const platformList = maigretResult.found.slice(0, 6).map(p => p.siteName).join(", ");
              await updateJob(jobId, { progress: i, total: entities.length, inserted: enriched, skipped, errors,
                message: `Web-OSINT re-run (${maigretResult.found.length} Maigret signals): ${entity.name}…` });
              const result2 = await deepWebOsintEnrich({
                ...entity,
                notes: [`${entity.notes ?? ""}`, `Active on: ${platformList}`].filter(Boolean).join(" — ").trim(),
              });
              if (result2.email) {
                await db.update(entitiesTable).set({ email: result2.email, updatedAt: new Date() }).where(eq(entitiesTable.id, entity.id));
                logger.info({ entityId: entity.id, email: result2.email }, "[Web-OSINT re-run] found email after Maigret expansion");
              }
            }
          }

          // Save Holehe email-platform presence as social evidence
          if (holeheResult?.found.length) {
            logger.info({ entityId: entity.id, email: emailForHolehe, platforms: holeheResult.found.length }, "[Holehe] email platform presence confirmed");
            const holeheRows = holeheResult.found.slice(0, 10).map(p => ({
              entityId: entity.id,
              vectorType: "social" as const,
              value: p.url ?? p.name,
              source: "holehe",
              sourceUrl: p.url ?? null,
              extractionMethod: "holehe-email-check",
              sourceReliability: 0.8,
              identityMatch: 0.8,
              recencyScore: 0.5,
              directnessScore: 0.7,
              independentCorroboration: 1,
              validationStatus: "candidate" as const,
              metadata: JSON.stringify({ platform: p.name }),
            }));
            await db.insert(contactEvidenceTable).values(holeheRows).onConflictDoNothing().catch(() => {});
          }
        }
        // ── End Maigret/Holehe ──────────────────────────────────────────────────

      } catch (err: any) {
        errors++;
        logger.warn({ entityId: entity.id, err: err.message }, "Web OSINT enrichment failed");
      }
    }

    await updateJob(jobId, {
      progress: entities.length, total: entities.length,
      inserted: enriched, skipped, errors,
      status: "done",
      message: `Done — ${enriched} enriched, ${skipped} no-match, ${errors} errors.`,
    });
    await setActiveJob("web-osint", "");
    logger.info({ enriched, skipped, errors }, "Web OSINT enrichment complete");
  })().catch(err => logger.error({ err: err.message }, "Web OSINT enrichment crashed"));
});

// ── DELETE /ingest/web-osint-lock ─────────────────────────────────────────────
router.delete("/ingest/web-osint-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("web-osint");
  if (!jobId) { res.json({ cleared: false, message: "No active web-osint lock found." }); return; }
  await updateJob(jobId, {
    status: "failed",
    message: "Process was killed (server restart). Clear the lock and restart.",
    finishedAt: new Date().toISOString(),
  } as any);
  await setActiveJob("web-osint", "");
  res.json({ cleared: true, jobId, message: "Web-OSINT lock cleared. You can now restart the enrichment." });
});

// ── POST /ingest/in-house-enrich ──────────────────────────────────────────────
router.post("/ingest/in-house-enrich", async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const batchSize = Math.min(Number(body.batchSize) || 100, 10_000);
  const force = Boolean(body.force);
  const entityIds: number[] | undefined = Array.isArray(body.entityIds) ? body.entityIds : undefined;

  // Single-entity force requests (e.g. from a profile page Enrich button) bypass the
  // batch-job lock so they can run even while the scheduler's batch job is in progress.
  // They must also not claim the shared active-job pointer: doing so would replace the
  // scheduler's lock and let the short profile job clear it when it finishes.
  const bypassLock = force && !!entityIds?.length && entityIds.length <= 5;
  if (!bypassLock) {
    const existing = await getActiveJob("in-house-enrich");
    if (existing) {
      res.status(409).json({ error: "An in-house enrichment job is already running.", jobId: existing });
      return;
    }
  }
  const targetMode: string = (body.targetMode as string) ?? "all";

  const conditions: SQL[] = [
    sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper', 'Corporation')`,
  ];
  if (!force) conditions.push(sql`${entitiesTable.contactConfidence} < 40`);
  if (entityIds?.length) conditions.push(inArray(entitiesTable.id, entityIds));
  if (targetMode === "edgar") {
    conditions.push(sql`${entitiesTable.metadata}::text LIKE '%westernIngest%'`);
  } else if (targetMode === "faa") {
    conditions.push(sql`${entitiesTable.metadata}::text NOT LIKE '%westernIngest%'`);
  }
  if (!force) conditions.push(sql`${entitiesTable.metadata}::text NOT LIKE '%enricherVersion%'`);

  const entities = await db
    .select({
      id: entitiesTable.id, name: entitiesTable.name, type: entitiesTable.type,
      nationality: entitiesTable.nationality,
      sourceRegistries: entitiesTable.sourceRegistries,
      knownResidences: entitiesTable.knownResidences,
      metadata: entitiesTable.metadata,
      notes: entitiesTable.notes,
      email: entitiesTable.email,
      phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl,
      twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle,
      telegramHandle: entitiesTable.telegramHandle,
    })
    .from(entitiesTable)
    .where(and(...conditions))
    .orderBy(desc(entitiesTable.bayesianScore))
    .limit(batchSize);

  if (!entities.length) {
    res.json({ message: "No entities need in-house enrichment.", jobId: null });
    return;
  }

  const jobId = await createJob("in-house-enrich");
  if (!bypassLock) await setActiveJob("in-house-enrich", jobId);
  await updateJob(jobId, { status: "running", total: entities.length, message: "In-house OSINT enrichment starting…" });

  res.json({
    jobId, total: entities.length,
    message: `In-house OSINT enrichment started for ${entities.length} entities.`,
  });

  (async () => {
    let enriched = 0, evidenceOnly = 0, skipped = 0, errors = 0;
    const globalSourceHits: Record<string, number> = {};
    const CONCURRENCY = 5;

    const processEntity = async (entity: typeof entities[number]): Promise<"enriched" | "evidence-only" | "skipped" | "error"> => {
      try {
        const entityMeta = safeParseJson<Record<string, unknown>>(entity.metadata, {});
        const enrichInput = {
          ...entity,
          bizLocation: (entityMeta["bizLocation"] as string | null) ?? null,
          entityName:  (entityMeta["entityName"] as string | null) ?? null,
        };
        const result = await enrichInHouse(enrichInput);
        const cleanEmail = sanitizePublicEmail(result.email);
        const cleanPhone = sanitizePublicPhone(result.phone);
        const cleanLinkedIn = sanitizePublicSocialUrl(result.linkedinUrl, "linkedin", "person");
        const cleanTwitter = sanitizePublicSocialHandle(result.twitter, "twitter");
        // J1: Separate direct-contact signals from social presence.
        // Only email/phone are terminal enrichment states; LinkedIn/Twitter keep entity eligible.
        const hasDirectContact = Boolean(cleanEmail || cleanPhone);
        const hasSocialSignal  = Boolean(cleanLinkedIn || cleanTwitter);
        const hasContactSignal = hasDirectContact || hasSocialSignal;
        const hasEvidence = Boolean(hasContactSignal || result.website || result.address);
        if (!hasEvidence) return "skipped";

        for (const [src, hit] of Object.entries(result.sourceHits)) {
          if (hit) globalSourceHits[src] = (globalSourceHits[src] ?? 0) + 1;
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (cleanEmail && !entity.email) updates["email"] = cleanEmail;
        if (cleanLinkedIn && !entity.linkedinUrl) updates["linkedinUrl"] = cleanLinkedIn;
        if (cleanPhone && !entity.phone) updates["phone"] = cleanPhone;
        // Write twitter handle to entity column so it contributes to contactConfidence
        if (cleanTwitter && !entity.twitterHandle) updates["twitterHandle"] = cleanTwitter;
        // M1: promote to direct_contact_verified when SMTP handshake confirmed deliverability
        if (result.smtpVerified) updates["validatedDirectContact"] = true;

        const confidence = computeContactConfidence({
          type: entity.type,
          email:           (updates["email"] as string | null) ?? entity.email ?? null,
          phone:           (updates["phone"] as string | null) ?? entity.phone ?? null,
          linkedinUrl:     (updates["linkedinUrl"] as string | null) ?? entity.linkedinUrl ?? null,
          twitterHandle:   (updates["twitterHandle"] as string | null) ?? entity.twitterHandle ?? null,
          instagramHandle: entity.instagramHandle ?? null,
          telegramHandle:  entity.telegramHandle ?? null,
          knownResidences: entity.knownResidences,
        });
        updates["contactConfidence"] = confidence;

        const meta = safeParseJson<Record<string, unknown>>(entity.metadata, {});
        if (result.website && !meta["website"]) meta["website"] = result.website;
        if (cleanTwitter && !meta["twitter"]) meta["twitter"] = cleanTwitter;
        if (result.address && !meta["bizLocation"]) meta["bizLocation"] = result.address;
        // L1: persist source labels so backfill can classify org vs personal contacts
        if (result.emailSource) meta["emailSource"] = result.emailSource;
        if (result.phoneSource) meta["phoneSource"] = result.phoneSource;
        meta["enrichmentSources"] = [
          ...(Array.isArray(meta["enrichmentSources"]) ? meta["enrichmentSources"] as string[] : []),
          ...result.sources.filter(s => !(meta["enrichmentSources"] as string[] | undefined)?.includes(s)),
        ];
        meta["enrichedAt"]      = new Date().toISOString();
        meta["emailConfidence"] = result.emailConfidence;
        meta["phoneConfidence"] = result.phoneConfidence;
        meta["sourceHits"]      = { ...(meta["sourceHits"] as object ?? {}), ...result.sourceHits };
        // J0 + L1: Compute and store outcome label for funnel measurement.
        // Pass enricher-computed source metadata so org contacts are correctly classified.
        const outcome = computeContactOutcome({
          email:       (updates["email"]       as string | null | undefined) ?? entity.email,
          phone:       (updates["phone"]       as string | null | undefined) ?? entity.phone,
          linkedinUrl: (updates["linkedinUrl"] as string | null | undefined) ?? entity.linkedinUrl,
          twitterHandle: (updates["twitterHandle"] as string | null | undefined) ?? entity.twitterHandle,
          instagramHandle: entity.instagramHandle,
          telegramHandle:  entity.telegramHandle,
          website:     result.website ?? (meta["website"] as string | null | undefined),
          bizLocation: result.address ?? (meta["bizLocation"] as string | null | undefined),
          // L1 additions
          isGenericPrefix:       result.hasGenericEmail,
          emailSource:           result.emailSource ?? null,
          phoneSource:           result.phoneSource ?? null,
          validatedDirectContact: result.smtpVerified === true,
        });
        updates["contactOutcome"] = outcome;
        meta["contactOutcome"]    = outcome;

        // J1: Only direct contact vectors (email/phone) are terminal enrichment completion.
        // Social handles (LinkedIn/Twitter) are valuable but keep entity eligible for direct-contact passes.
        if (hasDirectContact) {
          meta["enricherVersion"] = "v2";
          meta["needsEnrichment"] = false;
        } else {
          // Social-only and evidence-only remain eligible for follow-up passes (J1)
          delete meta["enricherVersion"];
          meta["needsEnrichment"] = true;
        }
        updates["metadata"]     = JSON.stringify(meta);
        updates["liveSource"]   = true;

        await db.update(entitiesTable)
          .set(updates as any)
          .where(eq(entitiesTable.id, entity.id));

        // Persist structured evidence rows so the profile audit panel shows
        // the real source URL, method, and timestamp for each contact vector.
        if (result.evidence.length > 0) {
          try {
            const evidenceRows = result.evidence.filter((ev) => {
              if (ev.vectorType === "email") return Boolean(sanitizePublicEmail(ev.value));
              if (ev.vectorType === "phone") return Boolean(sanitizePublicPhone(ev.value));
              if (ev.vectorType === "social") {
                const network = (ev.details as Record<string, unknown> | undefined)?.network;
                return network === "linkedin"
                  ? Boolean(sanitizePublicSocialUrl(ev.value, "linkedin", "person"))
                  : network === "twitter"
                    ? Boolean(sanitizePublicSocialHandle(ev.value, "twitter"))
                    : network === "instagram"
                      ? Boolean(sanitizePublicSocialHandle(ev.value, "instagram"))
                      : false;
              }
              return true;
            }).map((ev) => ({
              entityId: entity.id,
              vectorType: ev.vectorType,
              value: ev.value,
              source: ev.source,
              sourceUrl: ev.sourceUrl ?? null,
              extractionMethod: ev.extractionMethod,
              sourceReliability: Math.min(1, Math.max(0, ev.confidence / 100)),
              identityMatch: 0.75,
              recencyScore: 0.70,
              directnessScore:
                ev.vectorType === "email" ? 0.80 :
                ev.vectorType === "phone" ? 0.75 :
                ev.vectorType === "social" ? 0.20 : 0.10,
              independentCorroboration: 1,
              validationStatus: ev.confidence >= 80 ? "verified" : "candidate",
              metadata: JSON.stringify(ev.details ?? {}),
              observedAt: new Date(ev.observedAt),
            }));
            await db.insert(contactEvidenceTable).values(evidenceRows).onConflictDoNothing();
          } catch (evidenceErr: any) {
            logger.warn({ entityId: entity.id, err: evidenceErr.message }, "Failed to write evidence rows (non-fatal)");
          }
        }

        const stableKey = (() => {
          if (meta["nNumber"])       return `faa:${meta["nNumber"]}`;
          if (meta["entityName"])    return `edgar:${String(meta["entityName"]).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
          if (meta["orgnr"])         return `brreg:${meta["orgnr"]}`;
          if (meta["companyNumber"]) return `ch:${meta["companyNumber"]}`;
          return `name:${entity.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
        })();
        if (hasContactSignal) {
          await contactCacheSet(stableKey, {
            name:               entity.name,
            email:              (updates["email"] as string | null | undefined) ?? sanitizePublicEmail(entity.email) ?? undefined,
            phone:              (updates["phone"] as string | null | undefined) ?? sanitizePublicPhone(entity.phone) ?? undefined,
            linkedinUrl:        (updates["linkedinUrl"] as string | null | undefined) ?? sanitizePublicSocialUrl(entity.linkedinUrl, "linkedin", "person") ?? undefined,
            website:            result.website ?? undefined,
            twitter:            cleanTwitter ?? undefined,
            contactConfidence:  confidence,
            enrichmentSources:  meta["enrichmentSources"] as string[] ?? result.sources,
            enrichedAt:         new Date().toISOString(),
            emailConfidence:    cleanEmail ? result.emailConfidence ?? undefined : undefined,
            phoneConfidence:    result.phoneConfidence ?? undefined,
            sourceHits:         (result.sourceHits as unknown) as Record<string, number> | undefined,
          });

          logger.info({ entityId: entity.id, name: entity.name, confidence, sources: result.sources }, "In-house OSINT v2 enriched");
          return "enriched";
        }

        logger.info({ entityId: entity.id, name: entity.name, sources: result.sources }, "In-house OSINT evidence found; keeping entity eligible for contact enrichment");
        return "evidence-only";
      } catch (err: any) {
        logger.warn({ entityId: entity.id, err: err.message }, "In-house enrichment failed");
        return "error";
      }
    };

    for (let i = 0; i < entities.length; i += CONCURRENCY) {
      const batch = entities.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.allSettled(batch.map(e => processEntity(e)));
      for (const o of outcomes) {
        const outcome = o.status === "fulfilled" ? o.value : "error";
        if (outcome === "enriched")          enriched++;
        else if (outcome === "evidence-only") evidenceOnly++;
        else if (outcome === "skipped")      skipped++;
        else                                 errors++;
      }
      await updateJob(jobId, {
        status: "running",
        progress: enriched + evidenceOnly + skipped + errors,
        total: entities.length,
        inserted: enriched,
        message: `In-house OSINT v2: ${enriched} contactable, ${evidenceOnly} evidence-only, ${skipped} no-match, ${errors} errors | Sources: ${JSON.stringify(globalSourceHits)}`,
      });
    }

    logger.info({ globalSourceHits }, "In-house OSINT v2 source hit breakdown");

    await updateJob(jobId, {
      status: "done", progress: entities.length, total: entities.length,
      inserted: enriched,
      message: `Done — ${enriched} contactable, ${evidenceOnly} evidence-only, ${skipped} no-match, ${errors} errors.`,
    });
    if (!bypassLock) await setActiveJob("in-house-enrich", "");
    logger.info({ enriched, evidenceOnly, skipped, errors }, "In-house OSINT enrichment complete");
  })().catch(async err => {
    logger.error({ err: err.message }, "In-house enrichment crashed");
    await updateJob(jobId, { status: "failed", message: err.message ?? "Crashed" });
    if (!bypassLock) await setActiveJob("in-house-enrich", "");
  });
});

// ── DELETE /ingest/in-house-enrich-lock ──────────────────────────────────────
router.delete("/ingest/in-house-enrich-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("in-house-enrich");
  if (!jobId) { res.json({ cleared: false, message: "No active lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Lock cleared manually.", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("in-house-enrich", "");
  res.json({ cleared: true, jobId, message: "In-house-enrich lock cleared." });
});

// ── POST /ingest/recompute-contact-confidence ─────────────────────────────────
router.post("/ingest/recompute-contact-confidence", async (_req: Request, res: Response): Promise<void> => {
  const entities = await db
    .select({
      id: entitiesTable.id,
      email: entitiesTable.email,
      phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl,
      knownResidences: entitiesTable.knownResidences,
      contactConfidence: entitiesTable.contactConfidence,
    })
    .from(entitiesTable);

  let updated = 0;
  let skipped = 0;
  const BATCH = 1000;

  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH);
    for (const e of batch) {
      const confidence = computeContactConfidence({
        email: e.email, phone: e.phone,
        linkedinUrl: e.linkedinUrl, knownResidences: e.knownResidences,
      });
      if (confidence === (e.contactConfidence ?? 0)) { skipped++; continue; }
      await db.update(entitiesTable)
        .set({ contactConfidence: confidence })
        .where(eq(entitiesTable.id, e.id));
      updated++;
    }
  }

  res.json({ updated, skipped, total: entities.length, message: `Contact confidence recomputed: ${updated} updated, ${skipped} already correct.` });
});

// ── POST /ingest/sync-livesource-markers ──────────────────────────────────────
router.post("/ingest/sync-livesource-markers", async (_req: Request, res: Response): Promise<void> => {
  const LIVE_REGISTRY_PATTERNS = ["faa", "land registry", "hmlr", "sec edgar", "companies house", "brreg"];

  const entities = await db
    .select({ id: entitiesTable.id, sourceRegistries: entitiesTable.sourceRegistries, metadata: entitiesTable.metadata })
    .from(entitiesTable);

  let updated = 0;
  let skipped = 0;
  const BATCH = 500;

  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH);
    for (const e of batch) {
      const sources: string[] = (() => { try { return JSON.parse(e.sourceRegistries ?? "[]"); } catch { return []; } })();
      const meta: Record<string, unknown> = (() => { try { return JSON.parse(e.metadata ?? "{}"); } catch { return {}; } })();

      const isLive = sources.some(s => LIVE_REGISTRY_PATTERNS.some(p => s.toLowerCase().includes(p)))
        || !!meta.source || !!meta.nNumber || !!meta.formType || !!meta.orgnr || !!meta.titleNumber;

      if (!isLive || meta.liveSource === true) { skipped++; continue; }

      meta.liveSource = true;
      await db.update(entitiesTable)
        .set({ metadata: JSON.stringify(meta) })
        .where(eq(entitiesTable.id, e.id));
      updated++;
    }
  }

  res.json({ updated, skipped, total: entities.length, message: `liveSource marker synced: ${updated} updated, ${skipped} skipped.` });
});

// ── POST /ingest/backfill-wealth-llm ─────────────────────────────────────────
// Forces a calibrated LLM wealth estimate for every entity lacking estimatedNetWorth.
// Models are prompted so they cannot respond with "I don't know" — they must
// derive a figure from role, company, registry, assets, and sector norms.
router.post("/ingest/backfill-wealth-llm", async (req: Request, res: Response): Promise<void> => {
  const onlyMissing = req.body?.onlyMissing !== false; // default true
  const batchSize   = Math.min(Number(req.body?.batchSize ?? 8), 15);

  // Stream progress via chunked response
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Accel-Buffering", "no");

  let progressSent = 0;
  const jobId = `wealth-llm-${Date.now()}`;
  logger.info({ jobId, onlyMissing, batchSize }, "[WealthBackfill] Starting LLM wealth estimation");

  try {
    const result = await backfillWealthLLM({
      onlyMissing,
      batchSize,
      onProgress: (done, total) => {
        progressSent++;
        if (progressSent % 3 === 0) {
          logger.info({ done, total }, "[WealthBackfill] Progress");
        }
      },
    });
    res.json({
      ...result,
      message: `LLM wealth backfill complete: ${result.updated} entities updated, ${result.skipped} skipped, ${result.errors} errors.`,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[WealthBackfill] Fatal error");
    res.status(500).json({ error: err?.message ?? "LLM wealth backfill failed" });
  }
});

// ── POST /ingest/backfill-net-worth ───────────────────────────────────────────
router.post("/ingest/backfill-net-worth", async (_req: Request, res: Response): Promise<void> => {
  try {
    const candidates = await db.execute(sql`
      SELECT e.id, SUM(a.estimated_value) AS total_value
      FROM entities e
      JOIN assets a ON a.owner_entity_id = e.id
      WHERE e.estimated_net_worth IS NULL
        AND a.estimated_value IS NOT NULL
        AND a.estimated_value > 0
      GROUP BY e.id
      HAVING SUM(a.estimated_value) >= 1000000
    `);

    const rows = candidates.rows as { id: number; total_value: string }[];
    if (rows.length === 0) {
      res.json({ updated: 0, message: "No entities need net worth backfill." });
      return;
    }

    let updated = 0;
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      for (const row of slice) {
        const totalValue = Number(row.total_value);
        const estimatedNetWorth = Math.round(totalValue * 3);
        await db.update(entitiesTable)
          .set({ estimatedNetWorth, updatedAt: new Date() })
          .where(eq(entitiesTable.id, Number(row.id)));
        updated++;
      }
    }

    res.json({
      updated, total: rows.length,
      message: `Net worth backfilled: ${updated} entities updated (3× registered asset value as floor).`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Backfill failed" });
  }
});

// ── POST /ingest/backfill-edgar-net-worth ─────────────────────────────────────
router.post("/ingest/backfill-edgar-net-worth", async (_req: Request, res: Response): Promise<void> => {
  try {
    const candidates = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
      .from(entitiesTable)
      .where(sql`${entitiesTable.estimatedNetWorth} IS NULL
        AND ${entitiesTable.metadata}::text LIKE '%sec-edgar%'
        AND ${entitiesTable.metadata}::text LIKE '%sharesOwned%'
        AND ${entitiesTable.metadata}::text LIKE '%ticker%'`);

    if (candidates.length === 0) {
      res.json({ updated: 0, errors: 0, message: "No EDGAR entities with sharesOwned+ticker found." });
      return;
    }

    let updated = 0;
    let errors = 0;
    const priceCache = new Map<string, number>();

    for (const entity of candidates) {
      try {
        let meta: Record<string, any> = {};
        try { meta = JSON.parse(entity.metadata ?? "{}"); } catch {}
        const sharesOwned = Number(meta.sharesOwned ?? 0);
        const ticker = (meta.ticker as string | undefined)?.trim().toUpperCase();
        if (!sharesOwned || !ticker) continue;

        let price = priceCache.get(ticker);
        if (!price) {
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "Mozilla/5.0" } });
            if (r.ok) {
              const d = await r.json() as any;
              const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
              const lastClose = closes.filter(Boolean).at(-1);
              if (lastClose && lastClose > 0) { price = lastClose; priceCache.set(ticker, price); }
            }
          } catch { /* ignore */ }
        }
        if (!price) continue;

        const estimatedNetWorth = Math.round(sharesOwned * price);
        if (estimatedNetWorth <= 0) continue;
        await db.update(entitiesTable).set({ estimatedNetWorth, updatedAt: new Date() }).where(eq(entitiesTable.id, entity.id));
        updated++;
      } catch { errors++; }
    }

    res.json({
      updated, errors, candidates: candidates.length,
      message: `EDGAR net worth backfill: ${updated}/${candidates.length} entities updated (${errors} errors). Uses Yahoo Finance closing price × sharesOwned.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "EDGAR net worth backfill failed" });
  }
});

// ── DELETE /ingest/dedup ──────────────────────────────────────────────────────
router.delete("/ingest/dedup", async (_req, res): Promise<void> => {
  await clearDedup();
  res.json({ status: "ok", message: "Dedup set cleared. Next ingestion will re-insert all records." });
});

// ── POST /ingest/hunter-enrich — DEPRECATED ───────────────────────────────────
router.post("/ingest/hunter-enrich", async (_req: Request, res: Response): Promise<void> => {
  res.status(410).json({
    error: "Hunter.io/Apollo enrichment removed. Use POST /api/ingest/in-house-enrich instead — free, no API keys required.",
    replacement: "/api/ingest/in-house-enrich",
  });
});

// ── DELETE /ingest/hunter-enrich-lock ─────────────────────────────────────────
router.delete("/ingest/hunter-enrich-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("hunter-enrich");
  if (!jobId) { res.json({ cleared: false, message: "No active hunter-enrich lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Process killed (server restart).", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("hunter-enrich", "");
  res.json({ cleared: true, jobId });
});

// ── POST /ingest/social-discovery (H3-A) ──────────────────────────────────────
// Discovers LinkedIn URL, Twitter handle, Instagram handle, personal website via
// DuckDuckGo HTML search + Nitter. No API key required.
router.post("/ingest/social-discovery", async (req: Request, res: Response): Promise<void> => {
  const { batchSize = 200, hotOnly = false, onlyMissingContact = false, force = false, entityIds } = req.body ?? {};
  const existing = await getActiveJob("social-discovery");
  if (existing) { res.json({ jobId: existing, status: "already_running" }); return; }
  const jobId = await createJob("social-discovery");
  await setActiveJob("social-discovery", jobId);
  res.json({ jobId });

  (async () => {
    try {
      let processed = 0; let enriched = 0;
      const safeIds: number[] | undefined = Array.isArray(entityIds) ? entityIds.map(Number) : undefined;

      // Build query conditions
      const conditions = [sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper')`];
      if (hotOnly) conditions.push(sql`${entitiesTable.isHot} = true`);
      if (onlyMissingContact && !force) conditions.push(sql`${entitiesTable.linkedinUrl} IS NULL AND ${entitiesTable.twitterHandle} IS NULL AND ${entitiesTable.instagramHandle} IS NULL`);
      if (safeIds?.length) conditions.push(inArray(entitiesTable.id, safeIds));

      const rows = await db.select({
        id: entitiesTable.id, name: entitiesTable.name,
        type: entitiesTable.type, sourceRegistries: entitiesTable.sourceRegistries,
        email: entitiesTable.email, phone: entitiesTable.phone,
        linkedinUrl: entitiesTable.linkedinUrl,
        twitterHandle: entitiesTable.twitterHandle,
        instagramHandle: entitiesTable.instagramHandle,
        telegramHandle: entitiesTable.telegramHandle,
        knownResidences: entitiesTable.knownResidences,
      }).from(entitiesTable).where(and(...conditions as [SQL, ...SQL[]])).limit(Number(batchSize));

      await updateJob(jobId, { status: "running", message: `Social discovery: 0/${rows.length} processed`, progress: 0, total: rows.length } as any);

      for (const row of rows) {
        // Skip only if ALL social fields are already populated (not just LinkedIn)
        if (!force && row.linkedinUrl && row.twitterHandle && row.instagramHandle) { processed++; continue; }
        try {
          const result = await discoverSocialPresence({ name: row.name, type: row.type });
          if (result.confidence > 0) {
            const update: Record<string, any> = {};
            const cleanLinkedIn = sanitizePublicSocialUrl(result.linkedinUrl, "linkedin", "person");
            const cleanTwitter = isValidPublicSocialHandle(result.twitterHandle, "twitter")
              ? result.twitterHandle!.replace(/^@/, "")
              : null;
            const cleanInstagram = isValidPublicSocialHandle(result.instagramHandle, "instagram")
              ? result.instagramHandle!.replace(/^@/, "")
              : null;
            if (cleanLinkedIn)           update.linkedinUrl      = cleanLinkedIn;
            if (result.linkedinHeadline) update.linkedinHeadline = result.linkedinHeadline;
            if (cleanTwitter)            update.twitterHandle    = cleanTwitter;
            if (result.twitterBio)       update.twitterBio       = result.twitterBio;
            if (cleanInstagram)          update.instagramHandle  = cleanInstagram;
            if (result.personalWebsite)  update.personalWebsite  = result.personalWebsite;
            if (Object.keys(update).length) {
              // Recompute contactConfidence with newly discovered social signals
              update.contactConfidence = computeContactConfidence({
                type: row.type,
                email: row.email, phone: row.phone,
                linkedinUrl: cleanLinkedIn ?? row.linkedinUrl,
                twitterHandle: cleanTwitter ?? row.twitterHandle,
                instagramHandle: cleanInstagram ?? row.instagramHandle,
                telegramHandle: row.telegramHandle,
                knownResidences: row.knownResidences,
              });
              await db.update(entitiesTable).set(update).where(eq(entitiesTable.id, row.id));
              // Mirror to Redis contact cache
              const stableKey = (() => { try { return JSON.parse(row.sourceRegistries ?? "[]")[0] ?? `name:${row.name}`; } catch { return `name:${row.name}`; } })();
              await contactCacheSet(stableKey, {
                name: row.name, linkedinUrl: cleanLinkedIn,
                linkedinHeadline: result.linkedinHeadline,
                twitterHandle: cleanTwitter, twitterBio: result.twitterBio,
                instagramHandle: cleanInstagram, personalWebsite: result.personalWebsite,
                contactConfidence: update.contactConfidence, // recomputed from all signals, not module-internal score
                enrichmentSources: result.sources,
                enrichedAt: new Date().toISOString(),
              } as any);
              enriched++;
            }
          }
        } catch (err: any) { logger.warn({ err: err?.message, name: row.name }, "social-discovery entity error"); }
        processed++;
        if (processed % 10 === 0) await updateJob(jobId, { message: `Social discovery: ${processed}/${rows.length} processed, ${enriched} enriched`, progress: processed, total: rows.length } as any);
        // Polite delay between entities
        await new Promise(r => setTimeout(r, 3_500));
      }

      await updateJob(jobId, { status: "completed", message: `Social discovery complete: ${enriched}/${rows.length} entities enriched`, progress: rows.length, total: rows.length, finishedAt: new Date().toISOString() } as any);
    } catch (err: any) {
      await updateJob(jobId, { status: "failed", message: err?.message ?? "Unknown error", finishedAt: new Date().toISOString() } as any);
    } finally {
      await setActiveJob("social-discovery", "");
    }
  })();
});

// ── DELETE /ingest/social-discovery-lock ──────────────────────────────────────
router.delete("/ingest/social-discovery-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("social-discovery");
  if (!jobId) { res.json({ cleared: false, message: "No active social-discovery lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Process killed (server restart).", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("social-discovery", "");
  res.json({ cleared: true, jobId });
});

// ── POST /ingest/messenger-discovery (H3-B) ───────────────────────────────────
// Finds Telegram handles via t.me public username lookup.
// Most valuable for Russian/CIS HNWIs who use Telegram as primary messenger.
router.post("/ingest/messenger-discovery", async (req: Request, res: Response): Promise<void> => {
  const { batchSize = 100, hotOnly = false, onlyMissingContact = false, force = false, entityIds } = req.body ?? {};
  const existing = await getActiveJob("messenger-discovery");
  if (existing) { res.json({ jobId: existing, status: "already_running" }); return; }
  const jobId = await createJob("messenger-discovery");
  await setActiveJob("messenger-discovery", jobId);
  res.json({ jobId });

  (async () => {
    try {
      let processed = 0; let enriched = 0;
      const safeIds: number[] | undefined = Array.isArray(entityIds) ? entityIds.map(Number) : undefined;

      const conditions = [sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper')`];
      if (hotOnly) conditions.push(sql`${entitiesTable.isHot} = true`);
      if (onlyMissingContact && !force) conditions.push(sql`${entitiesTable.telegramHandle} IS NULL`);
      if (safeIds?.length) conditions.push(inArray(entitiesTable.id, safeIds));

      const rows = await db.select({
        id: entitiesTable.id, name: entitiesTable.name,
        type: entitiesTable.type, sourceRegistries: entitiesTable.sourceRegistries,
        email: entitiesTable.email, phone: entitiesTable.phone,
        linkedinUrl: entitiesTable.linkedinUrl,
        twitterHandle: entitiesTable.twitterHandle,
        instagramHandle: entitiesTable.instagramHandle,
        telegramHandle: entitiesTable.telegramHandle,
        knownResidences: entitiesTable.knownResidences,
      }).from(entitiesTable).where(and(...conditions as [SQL, ...SQL[]])).limit(Number(batchSize));

      await updateJob(jobId, { status: "running", message: `Messenger discovery: 0/${rows.length} processing`, progress: 0, total: rows.length } as any);

      for (const row of rows) {
        if (!force && row.telegramHandle) { processed++; continue; }
        try {
          const result = await discoverMessengerPresence({ name: row.name, type: row.type });
          if (result.telegramHandle) {
            // Recompute contactConfidence with newly found Telegram signal
            const newConfidence = computeContactConfidence({
              email: row.email, phone: row.phone,
              linkedinUrl: row.linkedinUrl, twitterHandle: row.twitterHandle,
              instagramHandle: row.instagramHandle,
              telegramHandle: result.telegramHandle,
              knownResidences: row.knownResidences,
            });
            await db.update(entitiesTable).set({
              telegramHandle:    result.telegramHandle,
              telegramBio:       result.telegramBio,
              contactConfidence: newConfidence,
            }).where(eq(entitiesTable.id, row.id));
            const stableKey = (() => { try { return JSON.parse(row.sourceRegistries ?? "[]")[0] ?? `name:${row.name}`; } catch { return `name:${row.name}`; } })();
            await contactCacheSet(stableKey, {
              name: row.name, telegramHandle: result.telegramHandle, telegramBio: result.telegramBio,
              contactConfidence: newConfidence, // recomputed from all signals, not module-internal score
              enrichmentSources: result.sources,
              enrichedAt: new Date().toISOString(),
            } as any);
            enriched++;
          }
        } catch (err: any) { logger.warn({ err: err?.message, name: row.name }, "messenger-discovery entity error"); }
        processed++;
        if (processed % 10 === 0) await updateJob(jobId, { message: `Messenger discovery: ${processed}/${rows.length} processed, ${enriched} found`, progress: processed, total: rows.length } as any);
        await new Promise(r => setTimeout(r, 1_000));
      }

      await updateJob(jobId, { status: "completed", message: `Messenger discovery complete: ${enriched}/${rows.length} Telegram handles found`, progress: rows.length, total: rows.length, finishedAt: new Date().toISOString() } as any);
    } catch (err: any) {
      await updateJob(jobId, { status: "failed", message: err?.message ?? "Unknown error", finishedAt: new Date().toISOString() } as any);
    } finally {
      await setActiveJob("messenger-discovery", "");
    }
  })();
});

// ── DELETE /ingest/messenger-discovery-lock ───────────────────────────────────
router.delete("/ingest/messenger-discovery-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("messenger-discovery");
  if (!jobId) { res.json({ cleared: false, message: "No active messenger-discovery lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Process killed (server restart).", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("messenger-discovery", "");
  res.json({ cleared: true, jobId });
});

// ── POST /ingest/foundation-filings (H3-C) ────────────────────────────────────
// IRS 990 filings via ProPublica Nonprofit Explorer API (free, no auth).
// Finds HNWIs listed as trustees/officers of private foundations.
router.post("/ingest/foundation-filings", async (req: Request, res: Response): Promise<void> => {
  const { batchSize = 200, force = false, entityIds } = req.body ?? {};
  const existing = await getActiveJob("foundation-filings");
  if (existing) { res.json({ jobId: existing, status: "already_running" }); return; }
  const jobId = await createJob("foundation-filings");
  await setActiveJob("foundation-filings", jobId);
  res.json({ jobId });

  (async () => {
    try {
      let processed = 0; let enriched = 0;
      const safeIds: number[] | undefined = Array.isArray(entityIds) ? entityIds.map(Number) : undefined;

      const conditions = [sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper')`];
      if (!force) conditions.push(sql`${entitiesTable.foundationName} IS NULL`);
      if (safeIds?.length) conditions.push(inArray(entitiesTable.id, safeIds));

      const rows = await db.select({
        id: entitiesTable.id, name: entitiesTable.name,
        type: entitiesTable.type, sourceRegistries: entitiesTable.sourceRegistries,
        email: entitiesTable.email, phone: entitiesTable.phone,
        linkedinUrl: entitiesTable.linkedinUrl,
        twitterHandle: entitiesTable.twitterHandle,
        instagramHandle: entitiesTable.instagramHandle,
        telegramHandle: entitiesTable.telegramHandle,
        knownResidences: entitiesTable.knownResidences,
      }).from(entitiesTable).where(and(...conditions as [SQL, ...SQL[]])).limit(Number(batchSize));

      await updateJob(jobId, { status: "running", message: `Foundation filings: 0/${rows.length} processing`, progress: 0, total: rows.length } as any);

      for (const row of rows) {
        try {
          const result = await discoverViaFoundationFilings({ name: row.name, type: row.type });
          if (result.foundationName) {
            const update: Record<string, any> = { foundationName: result.foundationName };
            // Only fill email if entity has none
            const cleanEmail = sanitizePublicEmail(result.email);
            if (cleanEmail && !row.email) update.email = cleanEmail;
            // Persist address into knownResidences JSON array (was previously dropped)
            if (result.address) {
              const existing: string[] = (() => { try { const r = JSON.parse(row.knownResidences ?? "[]"); return Array.isArray(r) ? r : [String(r)]; } catch { return []; } })();
              if (!existing.some(r => r === result.address)) {
                update.knownResidences = JSON.stringify([...existing, result.address]);
              }
            }
            // Recompute contactConfidence — foundation may have added an email or address
            update.contactConfidence = computeContactConfidence({
              type: row.type,
              email: sanitizePublicEmail(update.email as string | null | undefined) ?? sanitizePublicEmail(row.email),
              phone: sanitizePublicPhone(row.phone),
              linkedinUrl: row.linkedinUrl,
              twitterHandle: row.twitterHandle,
              instagramHandle: row.instagramHandle,
              telegramHandle: row.telegramHandle,
              knownResidences: update.knownResidences ?? row.knownResidences,
            });
            await db.update(entitiesTable).set(update).where(eq(entitiesTable.id, row.id));
            const stableKey = (() => { try { return JSON.parse(row.sourceRegistries ?? "[]")[0] ?? `name:${row.name}`; } catch { return `name:${row.name}`; } })();
            await contactCacheSet(stableKey, {
              name: row.name, email: cleanEmail ?? undefined,
              foundationName: result.foundationName,
              contactConfidence: update.contactConfidence, // recomputed from all signals
              enrichmentSources: result.sources,
              enrichedAt: new Date().toISOString(),
            } as any);
            enriched++;
          }
        } catch (err: any) { logger.warn({ err: err?.message, name: row.name }, "foundation-filings entity error"); }
        processed++;
        if (processed % 10 === 0) await updateJob(jobId, { message: `Foundation filings: ${processed}/${rows.length} processed, ${enriched} found`, progress: processed, total: rows.length } as any);
        await new Promise(r => setTimeout(r, 600));
      }

      await updateJob(jobId, { status: "completed", message: `Foundation filings complete: ${enriched}/${rows.length} foundations found`, progress: rows.length, total: rows.length, finishedAt: new Date().toISOString() } as any);
    } catch (err: any) {
      await updateJob(jobId, { status: "failed", message: err?.message ?? "Unknown error", finishedAt: new Date().toISOString() } as any);
    } finally {
      await setActiveJob("foundation-filings", "");
    }
  })();
});

// ── DELETE /ingest/foundation-filings-lock ────────────────────────────────────
router.delete("/ingest/foundation-filings-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("foundation-filings");
  if (!jobId) { res.json({ cleared: false, message: "No active foundation-filings lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Process killed (server restart).", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("foundation-filings", "");
  res.json({ cleared: true, jobId });
});

// ── POST /ingest/broad-discovery ──────────────────────────────────────────────
// Discovers NEW HNWIs from the open web without requiring existing entity IDs.
// Fires broad DuckDuckGo queries across 5 HNWI-signal categories and creates
// new entity rows from extracted names. Template rotation tracked in Redis.
router.post("/ingest/broad-discovery", async (req: Request, res: Response): Promise<void> => {
  const { templateSet, rotateTemplates = true, maxQueries = 10 } = req.body ?? {};
  const existing = await getActiveJob("broad-discovery");
  if (existing) { res.json({ jobId: existing, status: "already_running" }); return; }
  const jobId = await createJob("broad-discovery");
  await setActiveJob("broad-discovery", jobId);
  res.json({ jobId });

  (async () => {
    try {
      await updateJob(jobId, { status: "running", message: "Broad discovery: querying open web…" } as any);
      const result = await runBroadDiscovery({ templateSet, rotateTemplates, maxQueries });
      await updateJob(jobId, {
        status: "completed",
        message: `Broad discovery complete: ${result.entitiesDiscovered} new entities from ${result.queriesFired} queries (${result.entitiesSkipped} duplicates skipped)`,
        progress: result.queriesFired,
        total: result.queriesFired,
        finishedAt: new Date().toISOString(),
        result,
      } as any);
    } catch (err: any) {
      await updateJob(jobId, { status: "failed", message: err?.message ?? "Unknown error", finishedAt: new Date().toISOString() } as any);
    } finally {
      await setActiveJob("broad-discovery", "");
    }
  })();
});

// ── DELETE /ingest/broad-discovery-lock ───────────────────────────────────────
router.delete("/ingest/broad-discovery-lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("broad-discovery");
  if (!jobId) { res.json({ cleared: false, message: "No active broad-discovery lock." }); return; }
  await updateJob(jobId, { status: "failed", message: "Process killed (server restart).", finishedAt: new Date().toISOString() } as any);
  await setActiveJob("broad-discovery", "");
  res.json({ cleared: true, jobId });
});

// ── POST /ingest/edgar-issuer-backfill ────────────────────────────────────────
// Retroactively populate metadata.companyName (the issuer) for EDGAR entities that
// were ingested before the harvester stored it. Fetches EFTS for each entity by name.
router.post("/ingest/edgar-issuer-backfill", async (_req: Request, res: Response): Promise<void> => {
  const edgarEntities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`(${entitiesTable.sourceRegistries}::text ILIKE '%edgar%' OR ${entitiesTable.metadata}::text ILIKE '%sec-edgar%') AND ${entitiesTable.metadata}::text NOT LIKE '%companyName%'`);

  if (!edgarEntities.length) {
    res.json({ updated: 0, total: 0, message: "All EDGAR entities already have companyName set." });
    return;
  }

  const EDGAR_HEADERS = {
    Accept: "application/json",
    "User-Agent": "ApexFinder/1.0 OSINT-Research research@apexfinder.private",
  };
  const normalizeForComparison = (n: string) =>
    n.toLowerCase().replace(/\s*\(.*?\)\s*$/g, "").replace(/[^a-z0-9]/g, "");
  const isCorporate = (n: string) => {
    const normalized = n.replace(/[.,/&()-]+/g, " ");
    return /\b(inc|llc|lp|ltd|corp|co|fund|trust|capital|management|advisors|partners|holdings|group|associates|company|gmbh|ag|sa|bv|nv|plc|asa|ab|oy|as)\b/i.test(normalized);
  };

  let updated = 0;

  res.json({
    total: edgarEntities.length,
    message: `EDGAR issuer backfill started for ${edgarEntities.length} entities — runs in background.`,
  });

  (async () => {
    for (const entity of edgarEntities) {
      try {
        const meta = safeParseJson<Record<string, unknown>>(entity.metadata, {});
        const formType = String(meta["formType"] ?? "SC 13D").trim();
        // Preserve the original EDGAR filing name. Maintenance may normalize
        // the display name to First Last, which is useful in the UI but loses
        // the registry's exact search token order.
        const name = String(meta["entityName"] ?? entity.name ?? "").trim();
        const normalizedEntityName = normalizeForComparison(name);

        const params = new URLSearchParams({
          q: `"${name}"`,
          forms: formType,
          from: "0",
        });
        const url = `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;

        const resp = await fetch(url, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) continue;
        const data = await resp.json() as any;
        const hits: any[] = data?.hits?.hits ?? [];

        for (const hit of hits) {
          const displayNames: string[] = hit?._source?.display_names ?? [];
          const cleanNames = displayNames.map((d: string) => d.replace(/\s*\(CIK\s*\d+\)\s*$/i, "").trim());
          // The EFTS result includes both the filer and the subject company.
          // Never write the queried filer back as its own companyName.
          const issuer = cleanNames.find((n: string) =>
            n &&
            n.length > 2 &&
            normalizeForComparison(n) !== normalizedEntityName &&
            isCorporate(n),
          );
          if (issuer) {
            meta["companyName"] = issuer;
            await db.update(entitiesTable)
              .set({ metadata: JSON.stringify(meta) })
              .where(eq(entitiesTable.id, entity.id));
            updated++;
            logger.info({ entityId: entity.id, name, issuer }, "EDGAR issuer backfill: companyName set");
            break;
          }
        }

        await new Promise(r => setTimeout(r, 150)); // EDGAR: ~6 req/s max
      } catch (err: any) {
        logger.warn({ entityId: entity.id, err: err.message }, "EDGAR issuer backfill: fetch failed");
      }
    }
    logger.info({ updated, total: edgarEntities.length }, "EDGAR issuer backfill complete");
  })();
});

// ── POST /ingest/restore-contact-cache ────────────────────────────────────────
// Re-runs the Upstash slot-2 → PostgreSQL contact restore. Safe to call any
// time after ingestion has populated the DB; the startup restore often runs
// before entities exist and misses most records.
router.post("/ingest/restore-contact-cache", async (_req: Request, res: Response): Promise<void> => {
  const cacheCount = await contactCacheCount().catch(() => 0);
  if (cacheCount === 0) {
    res.json({ restored: 0, total: 0, message: "No entries in contact cache (REDIS_URL_2)." });
    return;
  }

  res.json({ message: `Contact cache restore started — ${cacheCount} entries to match against DB.` });

  (async () => {
    const cached = await contactCacheScanAll().catch(() => [] as { key: string; data: CachedContact }[]);
    let restored = 0;
    const CHUNK = 100;

    for (let i = 0; i < cached.length; i += CHUNK) {
      await Promise.all(cached.slice(i, i + CHUNK).map(async ({ key, data }) => {
        try {
          type EntityRow = {
            id: number; type: string | null; email: string | null; phone: string | null;
            linkedinUrl: string | null; twitterHandle: string | null; instagramHandle: string | null;
            knownResidences: string | null; metadata: string | null;
          };
          const SEL = {
            id: entitiesTable.id, type: entitiesTable.type, email: entitiesTable.email,
            phone: entitiesTable.phone, linkedinUrl: entitiesTable.linkedinUrl,
            twitterHandle: entitiesTable.twitterHandle, instagramHandle: entitiesTable.instagramHandle,
            knownResidences: entitiesTable.knownResidences, metadata: entitiesTable.metadata,
          };
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
            return;
          }

          if (!entity) return;
          // Only restore if the entity has no contact data yet
          if (entity.email || entity.phone || entity.linkedinUrl) return;

           const cleanEmail = sanitizePublicEmail(data.email);
           const cleanPhone = sanitizePublicPhone(data.phone);
           const cleanLinkedIn = sanitizePublicSocialUrl(data.linkedinUrl, "linkedin", "person");
           const cleanTwitter = sanitizePublicSocialHandle(data.twitter, "twitter");
           const cleanInstagram = sanitizePublicSocialHandle(data.instagramHandle, "instagram");
           const updates: Record<string, unknown> = { updatedAt: new Date() };
           if (cleanEmail)       updates["email"]       = cleanEmail;
           if (cleanPhone)       updates["phone"]       = cleanPhone;
           if (cleanLinkedIn)    updates["linkedinUrl"] = cleanLinkedIn;
           if (cleanTwitter)     updates["twitterHandle"] = cleanTwitter;
           if (cleanInstagram)   updates["instagramHandle"] = cleanInstagram;
           updates["contactConfidence"] = computeContactConfidence({
             type: entity.type,
             email: cleanEmail, phone: cleanPhone, linkedinUrl: cleanLinkedIn,
             twitterHandle: cleanTwitter, instagramHandle: cleanInstagram,
             knownResidences: entity.knownResidences,
           });

          let meta: Record<string, unknown> = {};
          try { meta = JSON.parse(entity.metadata ?? "{}"); } catch { /* */ }
          if (data.website)    meta["website"]    = data.website;
           if (cleanTwitter)    meta["twitter"]    = cleanTwitter;
          if (data.enrichmentSources?.length) meta["enrichmentSources"] = data.enrichmentSources;
          if (data.enrichedAt) meta["enrichedAt"] = data.enrichedAt;
          if (data.emailConfidence != null) meta["emailConfidence"] = data.emailConfidence;
          if (data.phoneConfidence != null) meta["phoneConfidence"] = data.phoneConfidence;
          if (data.sourceHits) meta["sourceHits"] = data.sourceHits;
          meta["enricherVersion"]   = "v2";
          // J1: only mark enrichment complete when a direct contact was restored
           meta["needsEnrichment"]   = Boolean(cleanEmail || cleanPhone) ? false : true;
          meta["restoredFromCache"] = true;
          // J0: set outcome on restored entities
          meta["contactOutcome"] = computeContactOutcome({
             email: cleanEmail, phone: cleanPhone,
             linkedinUrl: cleanLinkedIn, twitterHandle: cleanTwitter,
             instagramHandle: cleanInstagram,
            website: data.website,
          });
          updates["contactOutcome"] = meta["contactOutcome"];
          updates["metadata"]  = JSON.stringify(meta);
          updates["liveSource"] = true;

          await db.update(entitiesTable).set(updates as any).where(eq(entitiesTable.id, entity.id));
          restored++;
        } catch { /* skip malformed entry */ }
      }));
    }

    logger.info({ restored, total: cached.length }, "Manual contact cache restore complete");
  })();
});

// ── POST /ingest/backfill-contact-outcomes — J0 + L1 ─────────────────────────
// Recomputes contactOutcome for all existing entities from their current columns.
// Now passes emailSource/phoneSource from metadata so L1 org-contact detection
// correctly classifies EDGAR phones and generic prefixes. Safe to run multiple
// times — idempotent.
router.post("/ingest/backfill-contact-outcomes", async (_req: Request, res: Response): Promise<void> => {
  const entities = await db
    .select({
      id:              entitiesTable.id,
      type:            entitiesTable.type,
      email:           entitiesTable.email,
      phone:           entitiesTable.phone,
      linkedinUrl:     entitiesTable.linkedinUrl,
      twitterHandle:   entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle,
      telegramHandle:  entitiesTable.telegramHandle,
      metadata:        entitiesTable.metadata,
    })
    .from(entitiesTable);

  let updated = 0;
  const BATCH = 500;

  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH);
    for (const e of batch) {
      const meta = safeParseJson<Record<string, unknown>>(e.metadata, {});
      const computedOutcome = computeContactOutcome({
        email:           e.email,
        phone:           e.phone,
        linkedinUrl:     e.linkedinUrl,
        twitterHandle:   e.twitterHandle,
        instagramHandle: e.instagramHandle,
        telegramHandle:  e.telegramHandle,
        website:         meta["website"] as string | null | undefined,
        bizLocation:     meta["bizLocation"] as string | null | undefined,
        // L1: read persisted source labels so org contacts are classified correctly
        emailSource:           meta["emailSource"] as string | null | undefined,
        phoneSource:           meta["phoneSource"] as string | null | undefined,
        // M1: derive verified status from enrichmentSources (SMTP-Verified tag)
        validatedDirectContact: Array.isArray(meta["enrichmentSources"]) &&
          (meta["enrichmentSources"] as string[]).includes("SMTP-Verified"),
      });
      const outcome =
        e.type === "Corporation" || e.type === "Corp" || e.type === "Trust"
          ? (computedOutcome === "none" ? "none" : "organization_contact")
          : computedOutcome;
      // Also fix needsEnrichment: only false when direct contact exists (J1)
      const hasDirectContact = Boolean(e.email || e.phone);
      const needsMeta: Record<string, unknown> = { ...meta, contactOutcome: outcome };
      if (hasDirectContact) {
        needsMeta["needsEnrichment"] = false;
      } else if (meta["needsEnrichment"] === false && !hasDirectContact) {
        // Was incorrectly marked complete (social-only) — re-open it
        needsMeta["needsEnrichment"] = true;
      }
      await db.update(entitiesTable)
        .set({
          contactOutcome: outcome,
          metadata: JSON.stringify(needsMeta),
        } as any)
        .where(eq(entitiesTable.id, e.id));
      updated++;
    }
    if (i % 5000 === 0 && i > 0) {
      logger.info({ progress: i, total: entities.length }, "Backfill contact outcomes progress");
    }
  }

  const byOutcome: Record<string, number> = {};
  const outcomeRows = await db.execute(
    sql`SELECT COALESCE(contact_outcome, 'none') AS outcome, COUNT(*)::int AS count FROM entities GROUP BY contact_outcome`
  );
  for (const row of outcomeRows.rows as any[]) byOutcome[row.outcome] = row.count;

  logger.info({ updated, byOutcome }, "Contact outcome backfill complete (J0 + L1)");
  res.json({
    updated, total: entities.length,
    byOutcome,
    message: `contactOutcome backfilled for ${updated} entities (J0 + L1 org-contact detection). needsEnrichment corrected per J1 rule.`,
  });
});

// ── POST /ingest/flag-shared-emails — K3 ─────────────────────────────────────
// Finds email addresses that appear on 3+ distinct entities (almost certainly a
// shared corporate inbox) and flags them as organization_contact. Idempotent.
router.post("/ingest/flag-shared-emails", async (_req: Request, res: Response): Promise<void> => {
  try {
    // Find emails shared across ≥ 3 distinct entities
    const sharedRows = await db.execute(sql`
      SELECT email, COUNT(DISTINCT id)::int AS entity_count
      FROM entities
      WHERE email IS NOT NULL AND email != ''
      GROUP BY email
      HAVING COUNT(DISTINCT id) >= 3
    `);
    const sharedEmails = (sharedRows.rows as any[]).map(r => r.email as string);

    if (sharedEmails.length === 0) {
      res.json({ flagged: 0, emails: [], message: "No shared emails found." });
      return;
    }

    // Bulk-update: mark as organization_contact
    let flagged = 0;
    const CHUNK = 100;
    for (let i = 0; i < sharedEmails.length; i += CHUNK) {
      const chunk = sharedEmails.slice(i, i + CHUNK);
      const placeholders = chunk.map((_, j) => `$${j + 1}`).join(", ");
      await db.execute(sql.raw(
        `UPDATE entities SET contact_outcome = 'organization_contact' WHERE email = ANY(ARRAY[${chunk.map(e => `'${e.replace(/'/g, "''")}'`).join(",")}]::text[])`
      ));
      flagged += chunk.length;
    }

    logger.info({ flaggedEmails: sharedEmails.length, sharedEmails: sharedEmails.slice(0, 10) }, "K3: Shared-email flag complete");
    res.json({
      flagged: sharedEmails.length,
      emails: sharedEmails.slice(0, 20),
      message: `${sharedEmails.length} shared email(s) flagged as organization_contact across ≥3 entities.`,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "K3: flag-shared-emails failed");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /ingest/normalize-phones — K5 migration ─────────────────────────────
// One-time migration: re-normalizes all stored phone strings to E.164 format
// and rejects any that fail the 8–15 digit range. Idempotent.
router.post("/ingest/normalize-phones", async (_req: Request, res: Response): Promise<void> => {
  // Import at call time to avoid circular dependency issues at module load
  const { normalizePhone } = await import("../lib/contact-validation");
  const entities = await db
    .select({ id: entitiesTable.id, phone: entitiesTable.phone })
    .from(entitiesTable)
    .where(sql`${entitiesTable.phone} IS NOT NULL`);

  let normalized = 0;
  let rejected = 0;
  const BATCH = 500;

  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH);
    await Promise.all(batch.map(async (e) => {
      const cleaned = normalizePhone(e.phone);
      if (cleaned === e.phone) return; // already clean
      if (!cleaned) {
        // Invalid — clear the phone
        await db.update(entitiesTable)
          .set({ phone: null, updatedAt: new Date() } as any)
          .where(eq(entitiesTable.id, e.id));
        rejected++;
      } else {
        await db.update(entitiesTable)
          .set({ phone: cleaned, updatedAt: new Date() } as any)
          .where(eq(entitiesTable.id, e.id));
        normalized++;
      }
    }));
  }

  logger.info({ normalized, rejected, total: entities.length }, "K5: Phone normalization complete");
  res.json({
    normalized, rejected, total: entities.length,
    message: `Phone normalization: ${normalized} normalized, ${rejected} invalid and cleared out of ${entities.length} total.`,
  });
});

export default router;
