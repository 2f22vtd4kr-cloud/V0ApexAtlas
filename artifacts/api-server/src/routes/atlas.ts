/**
 * Atlas Routes
 *
 * POST /api/ingest/atlas-run   — Launch the full 10-phase Apex Atlas pipeline
 * DELETE /api/ingest/atlas-lock — Clear ghost Atlas lock
 * GET  /api/ingest/atlas-status — Current Atlas job status
 */

import { Router, type Request, type Response } from "express";
import { createJob, getActiveJob, getLatestJob, getJob, setActiveJob, updateJob, clearActiveJobIfOwned } from "../lib/job-queue";
import { runAtlasPipeline, type AtlasOptions } from "../lib/atlas-orchestrator";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ── POST /ingest/atlas-run ────────────────────────────────────────────────────
router.post("/ingest/atlas-run", async (req: Request, res: Response): Promise<void> => {
  const existing = await getActiveJob("atlas-run");
  if (existing) {
    const job = await getJob(existing);
    if (job?.status === "running") {
      res.status(409).json({ error: "Atlas pipeline already running.", jobId: existing, status: job });
      return;
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  const discoveryFirst = Boolean(body.discoveryFirst);
  const opts: AtlasOptions = {
    targetCount:        Number(body.targetCount)       || (discoveryFirst ? 500 : 15_000),
    faaMaxRecords:      Number(body.faaMaxRecords)     || 60_000,
    includeLandRegistry: Boolean(body.includeLandRegistry),
    batchSize:          Number(body.batchSize)         || 200,
    phaseJBatchSize:    Number(body.phaseJBatchSize)   || 50,
    skipIngestion:      Boolean(body.skipIngestion),
    hotLeadsOnly:       Boolean(body.hotLeadsOnly),
    runResearch:        body.runResearch !== false,
    researchLimit:      Number(body.researchLimit)     || 10,
    // ── Discovery-first diversified mode ──────────────────────────────────────
    discoveryFirst,
    skipFaa:            body.skipFaa !== undefined ? Boolean(body.skipFaa) : discoveryFirst,
    broadCategories:    Number(body.broadCategories)   || (discoveryFirst ? 3 : 1),
  };

  const atlasJobId = await createJob("atlas-run");
  await setActiveJob("atlas-run", atlasJobId);
  await updateJob(atlasJobId, {
    status: "running",
    progress: 0, total: 10,
    atlasPhase: 0, atlasPhaseTotal: 10,
    message: "Atlas pipeline initializing — 10 phases queued…",
  });

  // Immediately repair isHot only for validated person-level direct contacts.
  // Wealth/registry signals and organisation switchboards are not access signals.
  db.execute(sql`
    UPDATE entities
    SET is_hot = (
      (
        (email IS NOT NULL AND email !~* '^(info|contact|hello|sales|support|office|admin|press|media|enquiries|inquiries|reservations|booking|investor|ir)@')
        OR (phone IS NOT NULL AND COALESCE(phone_source, '') NOT IN ('EDGAR-Phone', 'CompaniesHouse-Phone'))
      )
      AND entity_type NOT IN ('Corporation', 'Corp', 'Trust')
    )
    WHERE is_hot IS DISTINCT FROM (
      (
        (email IS NOT NULL AND email !~* '^(info|contact|hello|sales|support|office|admin|press|media|enquiries|inquiries|reservations|booking|investor|ir)@')
        OR (phone IS NOT NULL AND COALESCE(phone_source, '') NOT IN ('EDGAR-Phone', 'CompaniesHouse-Phone'))
      )
      AND entity_type NOT IN ('Corporation', 'Corp', 'Trust')
    )
  `).catch(() => {});

  // Fire and forget — run fully in background
  void (async () => {
    try {
      await runAtlasPipeline(atlasJobId, opts);
    } catch (err: any) {
      logger.error({ err: err.message }, "[Atlas] Pipeline crashed");
      await updateJob(atlasJobId, {
        status: "failed",
        message: err.message ?? "Atlas pipeline crashed",
        finishedAt: new Date().toISOString(),
      });
      await clearActiveJobIfOwned("atlas-run", atlasJobId);
    }
  })();

  res.status(202).json({
    jobId: atlasJobId,
    pollUrl: `/api/ingest/job/${atlasJobId}`,
    // There are eleven numbered checkpoints (0 through 10). `total: 10`
    // remains the phase maximum, while the UI renders all eleven checkpoints.
    phases: [
      "0 — Pre-run cross-references (OCCRP, OpenSky, Companies House, ownership)",
      "1 — Discovery + full-circle entity enrichment loop",
      "2 — Identity and contact evidence",
      "3 — Metadata, notes, and registry assets",
      "4 — In-house OSINT",
      "5 — Social and messenger discovery",
      "6 — AI OSINT + Maigret + Holehe",
      "7 — Forensic cross-reference and asset discovery",
      "8 — Phase J attribution and graph-assisted analysis",
      "9 — Semantic embeddings, wealth, and confidence recompute",
      "10 — MCTS research on reachable hot leads",
    ],
    options: opts,
    message: `Atlas pipeline started (job: ${atlasJobId}). Poll ${`/api/ingest/job/${atlasJobId}`} for progress.`,
  });
});

// ── DELETE /ingest/atlas-lock ─────────────────────────────────────────────────
router.delete("/ingest/atlas-lock", async (_req: Request, res: Response): Promise<void> => {
  const activeJobId = await getActiveJob("atlas-run");
  const requestedJobId = Array.isArray(_req.query.jobId)
    ? String(_req.query.jobId[0] ?? "")
    : String(_req.query.jobId ?? "");
  const jobId = activeJobId ?? requestedJobId;
  if (!jobId) { res.json({ cleared: false, message: "No active Atlas lock or jobId supplied." }); return; }
  await updateJob(jobId, { status: "failed", message: "Killed manually.", finishedAt: new Date().toISOString() } as any);
  await clearActiveJobIfOwned("atlas-run", jobId);
  res.json({ cleared: true, jobId, message: activeJobId ? "Atlas cancellation requested." : "Stale Atlas job marked failed." });
});

router.delete("/ingest/atlas-lock/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params.jobId ?? "");
  if (!jobId) { res.json({ cleared: false, message: "No Atlas job ID supplied." }); return; }
  await updateJob(jobId, { status: "failed", message: "Killed manually.", finishedAt: new Date().toISOString() } as any);
  await clearActiveJobIfOwned("atlas-run", jobId);
  res.json({ cleared: true, jobId, message: "Atlas job marked failed." });
});

// ── GET /ingest/atlas-status ──────────────────────────────────────────────────
router.get("/ingest/atlas-status", async (_req: Request, res: Response): Promise<void> => {
  const jobId = await getActiveJob("atlas-run");
  if (!jobId) {
    const latest = await getLatestJob("atlas-run");
    if (latest) {
      res.json({ ...latest, active: false, latest: true });
      return;
    }
    res.json({ status: "idle", message: "No Atlas run in progress." });
    return;
  }
  const job = await getJob(jobId);
  res.json({ ...job, jobId, active: true });
});

export default router;
