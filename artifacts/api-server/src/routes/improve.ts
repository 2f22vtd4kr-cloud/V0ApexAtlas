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
import {
  createJob, updateJob, getJob, appendJobLog, setActiveJob, getActiveJob, clearActiveJob,
} from "../lib/job-queue";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
          if (suggestions.length > 0) {
            await db.insert(improvementLogsTable).values(
              suggestions.map(s => ({
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
            inserted += suggestions.length;
          }
          await appendJobLog(jobId, `[${i + 1}/${entities.length}] ${entity.name}: ${suggestions.length} suggestions`);
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
    let inserted = 0;
    if (suggestions.length > 0) {
      await db.insert(improvementLogsTable).values(
        suggestions.map(s => ({
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
      inserted = suggestions.length;
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
            if (suggestions.length > 0) {
              await db.insert(improvementLogsTable).values(
                suggestions.map(s => ({
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
              batchInserted += suggestions.length;
              totalInserted += suggestions.length;
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
