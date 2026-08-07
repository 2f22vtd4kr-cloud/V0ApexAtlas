/**
 * Persona Improvement Loop Routes — Phase 7
 *
 * POST /improve/run              — run improvement loop (all entities or subset)
 * POST /improve/run/:entityId    — run loop for one entity
 * GET  /improve/jobs/:jobId      — poll job status
 * GET  /improve/logs             — list all improvement logs (paginated + filtered)
 * GET  /improve/logs/:entityId   — logs for a specific entity
 * PATCH /improve/logs/:logId     — update log status (applied / dismissed)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, entitiesTable, improvementLogsTable } from "@workspace/db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { runPersonasForEntity } from "../lib/persona-engine";
import { computeContactState } from "../lib/contact-confidence";
import {
  createJob, updateJob, getJob, appendJobLog, setActiveJob, getActiveJob, clearActiveJob,
} from "../lib/job-queue";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SAFE_REMEDIATION_TITLES = new Set([
  "Hot-state invariant is inconsistent with verified contact outcome",
  "L5 contactConfidence stale — physical address exists but score not recomputed",
  "Organization evidence must not inflate personal access",
  "Contact email matches synthetic / generated pattern",
  "Phone number is a known fake pattern",
  "Synthetic-data flag in metadata — integrity violation",
]);

const PLACEHOLDER_NAME_RE = /^(test(\s+entity)?|sample(\s+entity)?|example(\s+entity)?|placeholder|mock(\s+entity)?|dummy(\s+entity)?|foo|bar|baz|john\s+doe|jane\s+doe|n\/a|unknown|entity\s+\d+|lorem ipsum|temp\s*\d*)$/i;

function isSafeFindingTitle(title: string, entityName: string): boolean {
  return SAFE_REMEDIATION_TITLES.has(title)
    || (title === `Entity name "${entityName}" is a known placeholder`);
}

function isSyntheticMetadata(metadata: string | null): boolean {
  const raw = (metadata ?? "").toLowerCase();
  return [
    "\"ismock\"", "\"synthetic\"", "\"fake\":", "\"placeholder\"",
    "\"testdata\"", "\"mockdata\"", "\"generated\":", "\"is_mock\"",
    "\"is_fake\"", "\"is_synthetic\"",
  ].some(key => raw.includes(key));
}

function fakeEmail(value: string | null): boolean {
  return Boolean(value && (
    /^(test@|fake@|example@|placeholder@|noreply@|no-reply@|dummy@|sample@|mock@|admin@example|user@test|info@test)/i.test(value)
    || /@(example\.|test\.|fake\.|localhost|placeholder\.|dummy\.|invalid\.)/i.test(value)
  ));
}

function fakePhone(value: string | null): boolean {
  if (!value) return false;
  const stripped = value.replace(/[\s\-().+]/g, "");
  return /^(555\d{7}|0{7,}|1{7,}|9{7,}|1234567|0000000|9999999)/.test(stripped)
    || /^(\d)\1{6,}$/.test(stripped);
}

function contactStateInput(entity: typeof entitiesTable.$inferSelect) {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = entity.metadata ? JSON.parse(entity.metadata) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
  } catch {
    // Preserve malformed metadata for review; safe remediation must not erase it.
  }
  return {
    type: entity.type,
    email: entity.email,
    phone: entity.phone,
    phoneSource: entity.phoneSource,
    linkedinUrl: entity.linkedinUrl,
    telegramHandle: entity.telegramHandle,
    twitterHandle: entity.twitterHandle,
    instagramHandle: entity.instagramHandle,
    knownResidences: entity.knownResidences,
    website: typeof metadata.website === "string" ? metadata.website : null,
    bizLocation: typeof metadata.bizLocation === "string" ? metadata.bizLocation : null,
    emailSource: typeof metadata.emailSource === "string" ? metadata.emailSource : null,
    metadata: entity.metadata,
    validatedDirectContact: metadata.validatedDirectContact === true,
    isGenericPrefix: metadata.isGenericPrefix === true,
  };
}

type PersonaSuggestion = Awaited<ReturnType<typeof runPersonasForEntity>>[number];

async function onlyNovelSuggestions(
  entityId: number,
  suggestions: PersonaSuggestion[],
): Promise<PersonaSuggestion[]> {
  if (suggestions.length === 0) return [];
  const existing = await db
    .select({
      persona: improvementLogsTable.persona,
      title: improvementLogsTable.title,
    })
    .from(improvementLogsTable)
    .where(eq(improvementLogsTable.entityId, entityId));
  const seen = new Set(existing.map((row) => `${row.persona}\u0000${row.title}`));
  const novel: PersonaSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = `${suggestion.persona}\u0000${suggestion.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    novel.push(suggestion);
  }
  return novel;
}

async function reconcilePersonaFindings(
  entity: typeof entitiesTable.$inferSelect,
  suggestions: PersonaSuggestion[],
): Promise<{ novel: PersonaSuggestion[]; dismissed: number }> {
  const entityId = entity.id;
  const existing = await db
    .select({
      id: improvementLogsTable.id,
      persona: improvementLogsTable.persona,
      title: improvementLogsTable.title,
      status: improvementLogsTable.status,
    })
    .from(improvementLogsTable)
    .where(eq(improvementLogsTable.entityId, entityId));

  const currentKeys = new Set(
    suggestions.map((suggestion) => `${suggestion.persona}\u0000${suggestion.title}`),
  );
  const seen = new Set(existing.map((row) => `${row.persona}\u0000${row.title}`));
  const organizationStateIsSafe =
    (entity.type === "Corporation" || entity.type === "Trust")
    && entity.contactOutcome === "organization_contact"
    && Number(entity.contactConfidence ?? 0) === 0
    && entity.isHot !== true;
  const resolvedOrganizationOperatorTitles = new Set([
    "Operator safety gate violated — organization route looks personal",
    "Operator gate blocked — direct outcome conflicts with attribution",
  ]);
  const stalePendingIds = existing
    .filter((row) =>
      row.status === "pending"
      && (
        !currentKeys.has(`${row.persona}\u0000${row.title}`)
        || (
          organizationStateIsSafe
          && row.persona === "user_operator"
          && resolvedOrganizationOperatorTitles.has(row.title)
        )
      ),
    )
    .map((row) => row.id);

  let dismissed = 0;
  if (stalePendingIds.length > 0) {
    const rows = await db
      .update(improvementLogsTable)
      .set({
        status: "dismissed",
        actionTaken: "Superseded by a later persona review; the current entity state no longer reproduces this finding.",
        updatedAt: new Date(),
      })
      .where(and(
        eq(improvementLogsTable.status, "pending"),
        inArray(improvementLogsTable.id, stalePendingIds),
      ))
      .returning({ id: improvementLogsTable.id });
    dismissed = rows.length;
  }

  const novel: PersonaSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = `${suggestion.persona}\u0000${suggestion.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    novel.push(suggestion);
  }
  return { novel, dismissed };
}

// ── POST /improve/apply-safe — apply deterministic, fail-closed findings ─────
//
// Recommendations that require new public evidence remain pending. This job
// applies only state reconciliations that can be proven from fields already
// stored on the entity, in bounded batches so it can safely run beside Atlas.
router.post("/improve/apply-safe", async (_req: Request, res: Response): Promise<void> => {
  const existingJobId = await getActiveJob("improve-apply");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running") {
      res.status(409).json({ error: "A safe remediation batch is already running.", jobId: existingJobId });
      return;
    }
  }

  const entities = await db.select().from(entitiesTable);
  if (entities.length === 0) {
    res.status(400).json({ error: "No entities found to remediate." });
    return;
  }

  const jobId = await createJob("improve-apply");
  await setActiveJob("improve-apply", jobId);
  await updateJob(jobId, {
    status: "running",
    total: entities.length,
    progress: 0,
    message: "Applying deterministic contact-state reconciliations…",
  });
  res.status(202).json({
    jobId,
    entityCount: entities.length,
    message: "Safe remediation started.",
    pollUrl: `/api/improve/jobs/${jobId}`,
  });

  (async () => {
    let updated = 0;
    let applied = 0;
    let errors = 0;
    try {
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        try {
          const patch: Record<string, unknown> = {};
          const pendingLogs = await db
            .select({ id: improvementLogsTable.id, title: improvementLogsTable.title })
            .from(improvementLogsTable)
            .where(and(
              eq(improvementLogsTable.entityId, entity.id),
              eq(improvementLogsTable.status, "pending"),
            ));
          const safeTitles = pendingLogs
            .filter(log => isSafeFindingTitle(log.title, entity.name))
            .map(log => log.title);
          const integrityPatch: Record<string, unknown> = {};
          if (safeTitles.includes("Contact email matches synthetic / generated pattern") && fakeEmail(entity.email)) {
            integrityPatch.email = null;
          }
          if (safeTitles.includes("Phone number is a known fake pattern") && fakePhone(entity.phone)) {
            integrityPatch.phone = null;
            integrityPatch.phoneSource = null;
          }
          const quarantine = isSyntheticMetadata(entity.metadata)
            || safeTitles.includes("Synthetic-data flag in metadata — integrity violation")
            || safeTitles.includes(`Entity name "${entity.name}" is a known placeholder`)
            || PLACEHOLDER_NAME_RE.test(entity.name.trim());
          if (quarantine) {
            integrityPatch.isHidden = true;
            integrityPatch.isHot = false;
            integrityPatch.contactConfidence = 0;
            integrityPatch.contactOutcome = "none";
            integrityPatch.email = null;
            integrityPatch.phone = null;
            integrityPatch.phoneSource = null;
          }
          Object.assign(patch, integrityPatch);
          // Recompute state from the post-remediation vectors. A fake email or
          // phone must not be removed while its old outcome is retained.
          const stateInput = contactStateInput(entity);
          if (integrityPatch.email === null) stateInput.email = null;
          if (integrityPatch.phone === null) {
            stateInput.phone = null;
            stateInput.phoneSource = null;
          }
          const state = computeContactState(stateInput);
          if (!quarantine && state.contactConfidence !== entity.contactConfidence) {
            patch.contactConfidence = state.contactConfidence;
          }
          if (!quarantine && state.contactOutcome !== entity.contactOutcome) {
            patch.contactOutcome = state.contactOutcome;
          }
          if (!quarantine && state.isHot !== entity.isHot) {
            patch.isHot = state.isHot;
          }
          const stateChanged =
            state.contactConfidence !== entity.contactConfidence
            || state.contactOutcome !== entity.contactOutcome
            || state.isHot !== entity.isHot;
          const applicableSafeTitles = new Set<string>();
          if (stateChanged) {
            applicableSafeTitles.add("Hot-state invariant is inconsistent with verified contact outcome");
            applicableSafeTitles.add("L5 contactConfidence stale — physical address exists but score not recomputed");
            applicableSafeTitles.add("Organization evidence must not inflate personal access");
          }
          if (fakeEmail(entity.email)) applicableSafeTitles.add("Contact email matches synthetic / generated pattern");
          if (fakePhone(entity.phone)) applicableSafeTitles.add("Phone number is a known fake pattern");
          if (isSyntheticMetadata(entity.metadata)) {
            applicableSafeTitles.add("Synthetic-data flag in metadata — integrity violation");
          }
          if (PLACEHOLDER_NAME_RE.test(entity.name.trim())) {
            applicableSafeTitles.add(`Entity name "${entity.name}" is a known placeholder`);
          }
          const safeLogIds = pendingLogs
            .filter(log => applicableSafeTitles.has(log.title) && isSafeFindingTitle(log.title, entity.name))
            .map(log => log.id);
          if (Object.keys(patch).length > 0) {
            patch.updatedAt = new Date();
            await db.update(entitiesTable).set(patch as any).where(eq(entitiesTable.id, entity.id));
            updated++;
          }
          if (Object.keys(patch).length > 0 && safeLogIds.length > 0) {
            const rows = await db
              .update(improvementLogsTable)
              .set({ status: "applied", updatedAt: new Date() })
              .where(and(
                eq(improvementLogsTable.entityId, entity.id),
                eq(improvementLogsTable.status, "pending"),
                inArray(improvementLogsTable.id, safeLogIds),
              ))
              .returning({ id: improvementLogsTable.id });
            applied += rows.length;
          }
        } catch (err: any) {
          errors++;
          logger.warn({ entityId: entity.id, err: err.message }, "Safe persona remediation skipped entity");
        }
        if ((i + 1) % 50 === 0 || i === entities.length - 1) {
          await updateJob(jobId, {
            progress: Math.round(((i + 1) / entities.length) * 100),
            inserted: updated,
            skipped: applied,
            errors,
            message: `Remediating ${i + 1}/${entities.length} entities…`,
          });
        }
      }
      await updateJob(jobId, {
        status: "done",
        progress: 100,
        inserted: updated,
        skipped: applied,
        errors,
        finishedAt: new Date().toISOString(),
        message: `Safe remediation complete — ${updated} entities reconciled, ${applied} findings applied.`,
      });
      await appendJobLog(jobId, `✓ Safe remediation complete: ${updated} entities updated, ${applied} findings applied, ${errors} errors.`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Safe persona remediation failed");
      await updateJob(jobId, { status: "failed", errors: errors + 1, message: err.message ?? "Safe remediation failed." });
    } finally {
      await clearActiveJob("improve-apply");
    }
  })();
});

// ── POST /improve/deduplicate — collapse repeated persona findings ────────────
router.post("/improve/deduplicate", async (_req: Request, res: Response): Promise<void> => {
  const existingJobId = await getActiveJob("improve-deduplicate");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running") {
      res.status(409).json({ error: "A persona finding cleanup is already running.", jobId: existingJobId });
      return;
    }
  }

  const jobId = await createJob("improve-deduplicate");
  await setActiveJob("improve-deduplicate", jobId);
  await updateJob(jobId, { status: "running", progress: 0, message: "Finding cleanup starting…" });
  res.status(202).json({ jobId, pollUrl: `/api/improve/jobs/${jobId}` });

  (async () => {
    let dismissed = 0;
    let errors = 0;
    try {
      const rows = await db
        .select({
          id: improvementLogsTable.id,
          entityId: improvementLogsTable.entityId,
          persona: improvementLogsTable.persona,
          title: improvementLogsTable.title,
          status: improvementLogsTable.status,
        })
        .from(improvementLogsTable)
        .orderBy(desc(improvementLogsTable.createdAt), desc(improvementLogsTable.id));
      const seen = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const key = `${row.entityId}\u0000${row.persona}\u0000${row.title}`;
        if (seen.has(key) && row.status === "pending") {
          try {
            await db
              .update(improvementLogsTable)
              .set({ status: "dismissed", updatedAt: new Date() })
              .where(and(eq(improvementLogsTable.id, row.id), eq(improvementLogsTable.status, "pending")));
            dismissed++;
          } catch {
            errors++;
          }
        } else {
          seen.add(key);
        }
        if ((i + 1) % 500 === 0 || i === rows.length - 1) {
          await updateJob(jobId, {
            progress: Math.round(((i + 1) / Math.max(rows.length, 1)) * 100),
            inserted: dismissed,
            errors,
            message: `Cleaning findings ${i + 1}/${rows.length}…`,
          });
        }
      }
      await updateJob(jobId, {
        status: "done",
        progress: 100,
        inserted: dismissed,
        errors,
        finishedAt: new Date().toISOString(),
        message: `Finding cleanup complete — ${dismissed} duplicate pending findings dismissed.`,
      });
    } catch (err: any) {
      logger.error({ err: err.message }, "Persona finding cleanup failed");
      await updateJob(jobId, { status: "failed", errors: errors + 1, message: err.message ?? "Finding cleanup failed." });
    } finally {
      await clearActiveJob("improve-deduplicate");
    }
  })();
});

// ── POST /improve/run  — fire improvement loop for all (or N) entities ────────
router.post("/improve/run", async (req: Request, res: Response): Promise<void> => {
  const { limit = 50, entityIds } = req.body as {
    limit?: number;
    entityIds?: number[];
  };

  const existingJobId = await getActiveJob("improve");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing && existing.status === "running") {
      res.status(409).json({
        error: "An improvement loop job is already running.",
        jobId: existingJobId,
      });
      return;
    }
  }

  // Fetch entities to process
  // Default: HNWI and Gatekeeper only — Corp/Trust are property vehicles that never get
  // MCTS sessions or contact enrichment, and would dominate suggestions with unfixable noise.
  let entities;
  if (Array.isArray(entityIds) && entityIds.length > 0) {
    entities = await db
      .select()
      .from(entitiesTable)
      .where(inArray(entitiesTable.id, entityIds));
  } else {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    entities = await db
      .select()
      .from(entitiesTable)
      .where(inArray(entitiesTable.type, ["HNWI", "Gatekeeper"]))
      .orderBy(desc(entitiesTable.bayesianScore))
      .limit(safeLimit);
  }

  if (entities.length === 0) {
    res.status(400).json({ error: "No entities found to improve. Ingest data first." });
    return;
  }

  const jobId = await createJob("improve");
  await setActiveJob("improve", jobId);
  await updateJob(jobId, { status: "running", total: entities.length, message: "Persona loop starting…" });

  // Fire-and-forget
  (async () => {
    let inserted = 0;
    let errors = 0;
    try {
      await appendJobLog(jobId, `Starting improvement loop for ${entities.length} entities…`);

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        try {
          const suggestions = await runPersonasForEntity(entity);
          const { novel: novelSuggestions, dismissed } = await reconcilePersonaFindings(entity, suggestions);
          if (novelSuggestions.length > 0) {
            await db.insert(improvementLogsTable).values(
              novelSuggestions.map(s => ({
                entityId: s.entityId,
                persona: s.persona,
                category: s.category,
                priority: s.priority,
                title: s.title,
                description: s.description,
                actionTaken: s.actionTaken,
                status: "pending",
              }))
            );
            inserted += novelSuggestions.length;
          }
          await appendJobLog(jobId, `[${i + 1}/${entities.length}] ${entity.name}: ${novelSuggestions.length} new suggestions, ${dismissed} resolved findings`);
        } catch (err: any) {
          errors++;
          await appendJobLog(jobId, `[ERROR] ${entity.name}: ${err.message}`);
        }
        const progress = Math.round(((i + 1) / entities.length) * 100);
        await updateJob(jobId, { progress, inserted, errors, message: `Processing ${entity.name}…` });
      }

      await updateJob(jobId, {
        status: "done",
        progress: 100,
        inserted,
        errors,
        finishedAt: new Date().toISOString(),
        message: `Done — ${inserted} improvement suggestions generated across ${entities.length} entities`,
      });
      await appendJobLog(jobId, `✓ Complete: ${inserted} logs written, ${errors} errors.`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Improvement loop job failed");
      await updateJob(jobId, { status: "failed", message: err.message ?? "Unknown error" });
    }
  })();

  res.status(202).json({
    jobId,
    entityCount: entities.length,
    message: `Improvement loop started for ${entities.length} entities.`,
    pollUrl: `/api/improve/jobs/${jobId}`,
  });
});

// ── POST /improve/run/:entityId — run loop for one entity ─────────────────────
router.post("/improve/run/:entityId", async (req: Request, res: Response): Promise<void> => {
  const entityId = parseInt(req.params.entityId as string, 10);
  if (isNaN(entityId)) {
    res.status(400).json({ error: "entityId must be a number." });
    return;
  }

  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);

  if (!entity) {
    res.status(404).json({ error: `Entity ${entityId} not found.` });
    return;
  }

  try {
    const suggestions = await runPersonasForEntity(entity);
    const { novel: novelSuggestions } = await reconcilePersonaFindings(entity, suggestions);
    let inserted = 0;
    if (novelSuggestions.length > 0) {
      await db.insert(improvementLogsTable).values(
        novelSuggestions.map(s => ({
          entityId: s.entityId,
          persona: s.persona,
          category: s.category,
          priority: s.priority,
          title: s.title,
          description: s.description,
          actionTaken: s.actionTaken,
          status: "pending",
        }))
      );
      inserted = novelSuggestions.length;
    }

    res.status(201).json({
      entityId,
      entityName: entity.name,
      inserted,
      message: `${inserted} improvement suggestions generated for "${entity.name}".`,
    });
  } catch (err: any) {
    logger.error({ err: err.message, entityId }, "Improvement run failed for entity");
    res.status(500).json({ error: err.message ?? "Improvement run failed." });
  }
});

// ── GET /improve/jobs/:jobId — poll job status ─────────────────────────────────
router.get("/improve/jobs/:jobId", async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;
  const job = await getJob(jobId as string);
  if (!job) {
    res.status(404).json({ error: `Job ${jobId} not found.` });
    return;
  }
  res.json(job);
});

// ── GET /improve/logs — list all improvement logs ─────────────────────────────
router.get("/improve/logs", async (req: Request, res: Response): Promise<void> => {
  const {
    limit = 100,
    offset = 0,
    persona,
    status,
    priority,
    entityId,
  } = req.query as Record<string, string | undefined>;

  const safeLimit = Math.min(Number(limit) || 100, 500);
  const safeOffset = Number(offset) || 0;

  const conditions = [];
  if (persona) conditions.push(eq(improvementLogsTable.persona, persona));
  if (status) conditions.push(eq(improvementLogsTable.status, status));
  if (priority) conditions.push(eq(improvementLogsTable.priority, priority));
  if (entityId) conditions.push(eq(improvementLogsTable.entityId, parseInt(entityId, 10)));

  const rows = await db
    .select({
      log: improvementLogsTable,
      entityName: entitiesTable.name,
      entityType: entitiesTable.type,
    })
    .from(improvementLogsTable)
    .leftJoin(entitiesTable, eq(improvementLogsTable.entityId, entitiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      sql`CASE ${improvementLogsTable.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      desc(improvementLogsTable.createdAt)
    )
    .limit(safeLimit)
    .offset(safeOffset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(improvementLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({
    logs: rows.map(r => ({ ...r.log, entityName: r.entityName, entityType: r.entityType })),
    total: Number(totalRow?.count ?? 0),
    limit: safeLimit,
    offset: safeOffset,
  });
});

// ── GET /improve/logs/:entityId — logs for a specific entity ──────────────────
router.get("/improve/logs/:entityId", async (req: Request, res: Response): Promise<void> => {
  const entityId = parseInt(req.params.entityId as string, 10);
  if (isNaN(entityId)) {
    res.status(400).json({ error: "entityId must be a number." });
    return;
  }

  const logs = await db
    .select()
    .from(improvementLogsTable)
    .where(eq(improvementLogsTable.entityId, entityId))
    .orderBy(
      sql`CASE ${improvementLogsTable.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      desc(improvementLogsTable.createdAt)
    );

  res.json(logs);
});

// ── PATCH /improve/logs/:logId — update status ────────────────────────────────
router.patch("/improve/logs/:logId", async (req: Request, res: Response): Promise<void> => {
  const logId = parseInt(req.params.logId as string, 10);
  if (isNaN(logId)) {
    res.status(400).json({ error: "logId must be a number." });
    return;
  }

  const { status } = req.body as { status: "pending" | "applied" | "dismissed" };
  const validStatuses = ["pending", "applied", "dismissed"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}.` });
    return;
  }

  const [updated] = await db
    .update(improvementLogsTable)
    .set({ status })
    .where(eq(improvementLogsTable.id, logId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: `Log ${logId} not found.` });
    return;
  }

  res.json(updated);
});

// ── GET /improve/stats — summary counts by persona + status ───────────────────
router.get("/improve/stats", async (_req: Request, res: Response): Promise<void> => {
  const byPersona = await db
    .select({
      persona: improvementLogsTable.persona,
      status: improvementLogsTable.status,
      count: sql<number>`count(*)`,
    })
    .from(improvementLogsTable)
    .groupBy(improvementLogsTable.persona, improvementLogsTable.status);

  const byPriority = await db
    .select({
      priority: improvementLogsTable.priority,
      count: sql<number>`count(*)`,
    })
    .from(improvementLogsTable)
    .groupBy(improvementLogsTable.priority);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(improvementLogsTable);

  res.json({
    total: Number(totalRow?.count ?? 0),
    byPersona: byPersona.map(r => ({ ...r, count: Number(r.count) })),
    byPriority: byPriority.map(r => ({ ...r, count: Number(r.count) })),
  });
});

// ── POST /improve/run-all — self-chaining full sweep (server-side daemon) ─────
//
// Processes ALL entities not yet in improvement_logs, in chunks of 500, entirely
// within this process. Survives shell/session exits because it runs in the API
// server's own event loop (managed workflow).
//
// Poll: GET /improve/jobs/:jobId  (same as normal batches)
// The returned jobId is the "meta" job that tracks overall progress.
router.post("/improve/run-all", async (req: Request, res: Response): Promise<void> => {
  const { chunkSize = 500, resume = true } = (req.body ?? {}) as {
    chunkSize?: number;
    resume?: boolean; // default true = skip already-processed entities
  };

  // Check no active improve job
  const existingJobId = await getActiveJob("improve");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing && existing.status === "running") {
      res.status(409).json({
        error: "An improvement loop job is already running.",
        jobId: existingJobId,
      });
      return;
    }
  }

  const safeChunk = Math.min(Math.max(Number(chunkSize) || 500, 50), 500);

  // Count total scope
  const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(entitiesTable);
  const totalEntities = Number(totalRow?.count ?? 0);

  if (totalEntities === 0) {
    res.status(400).json({ error: "No entities found. Ingest data first." });
    return;
  }

  const metaJobId = await createJob("improve");
  await setActiveJob("improve", metaJobId);
  await updateJob(metaJobId, {
    status: "running",
    total: totalEntities,
    progress: 0,
    message: "Full sweep starting…",
  });

  res.status(202).json({
    jobId: metaJobId,
    totalEntities,
    chunkSize: safeChunk,
    message: `Full persona sweep started for up to ${totalEntities} entities (chunk=${safeChunk}, resume=${resume}).`,
    pollUrl: `/api/improve/jobs/${metaJobId}`,
  });

  // ── Fire-and-forget: runs entirely within this process ──────────────────────
  (async () => {
    let totalInserted = 0;
    let totalErrors = 0;
    let batchNum = 0;

    try {
      await appendJobLog(metaJobId, `Sweep starting. Total entities: ${totalEntities}, chunkSize: ${safeChunk}, resume: ${resume}`);

      while (true) {
        // Always re-query to get the next unprocessed chunk (skip if resume=true)
        let chunkEntities;
        if (resume) {
          chunkEntities = await db
            .select()
            .from(entitiesTable)
            .where(
              sql`${entitiesTable.id} NOT IN (
                SELECT DISTINCT entity_id FROM improvement_logs
              )`
            )
            .orderBy(entitiesTable.id)
            .limit(safeChunk);
        } else {
          chunkEntities = await db
            .select()
            .from(entitiesTable)
            .orderBy(entitiesTable.id)
            .limit(safeChunk)
            .offset(batchNum * safeChunk);
        }

        if (chunkEntities.length === 0) {
          await appendJobLog(metaJobId, `✓ All entities processed. Total inserted: ${totalInserted}, errors: ${totalErrors}`);
          break;
        }

        batchNum++;
        const [doneRow] = await db
          .select({ count: sql<number>`count(distinct entity_id)` })
          .from(improvementLogsTable);
        const doneCount = Number(doneRow?.count ?? 0);
        const pct = Math.round((doneCount / totalEntities) * 100);

        await appendJobLog(
          metaJobId,
          `Batch #${batchNum}: ${chunkEntities.length} entities (${doneCount}/${totalEntities} done, ${pct}%)`
        );
        await updateJob(metaJobId, {
          progress: pct,
          inserted: totalInserted,
          errors: totalErrors,
          message: `Batch #${batchNum}: ${chunkEntities.length} entities (${pct}% complete)`,
        });

        let batchInserted = 0;
        let batchErrors = 0;

        for (let i = 0; i < chunkEntities.length; i++) {
          const entity = chunkEntities[i];
          try {
            const suggestions = await runPersonasForEntity(entity);
            const { novel: novelSuggestions } = await reconcilePersonaFindings(entity, suggestions);
            if (novelSuggestions.length > 0) {
              await db.insert(improvementLogsTable).values(
                novelSuggestions.map(s => ({
                  entityId: s.entityId,
                  persona: s.persona,
                  category: s.category,
                  priority: s.priority,
                  title: s.title,
                  description: s.description,
                  actionTaken: s.actionTaken,
                  status: "pending",
                }))
              );
              batchInserted += novelSuggestions.length;
              totalInserted += novelSuggestions.length;
            }
          } catch (err: any) {
            batchErrors++;
            totalErrors++;
            logger.error({ err: err.message, entityId: entity.id }, "Persona sweep entity error");
          }

          // Update progress every 50 entities within batch
          if ((i + 1) % 50 === 0) {
            const innerPct = Math.round(((doneCount + i + 1) / totalEntities) * 100);
            await updateJob(metaJobId, {
              progress: innerPct,
              inserted: totalInserted,
              errors: totalErrors,
              message: `Batch #${batchNum} [${i + 1}/${chunkEntities.length}]: ${entity.name}`,
            });
          }
        }

        await appendJobLog(
          metaJobId,
          `Batch #${batchNum} done: ${batchInserted} logs, ${batchErrors} errors`
        );
      }

      await updateJob(metaJobId, {
        status: "done",
        progress: 100,
        inserted: totalInserted,
        errors: totalErrors,
        finishedAt: new Date().toISOString(),
        message: `Full sweep complete — ${totalInserted} suggestions across all entities`,
      });
      await clearActiveJob("improve");
    } catch (err: any) {
      logger.error({ err: err.message }, "Full persona sweep failed");
      await updateJob(metaJobId, { status: "failed", message: err.message ?? "Unknown error" });
      await clearActiveJob("improve");
    }
  })();
});

// ── DELETE /improve/lock — manually clear ghost active-job lock ──────────────
router.delete("/improve/lock", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("improve");
  if (!jobId) {
    res.json({ cleared: false, message: "No active improve lock found." });
    return;
  }
  await clearActiveJob("improve");
  res.json({ cleared: true, jobId, message: "Ghost improve lock cleared. You can now restart the persona loop." });
});

export default router;
