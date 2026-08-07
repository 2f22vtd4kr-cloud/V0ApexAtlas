import { Router, type Request, type Response } from "express";
import {
  getActiveJob,
  getJob,
  getLatestJob,
} from "../lib/job-queue";
import {
  CONTACT_RESEARCH_JOB_TYPE,
  cancelContactResearch,
  startContactResearch,
} from "../lib/contact-research-orchestrator";

const router = Router();

router.post("/ingest/contact-research", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body ?? {};
    const entityIds = Array.isArray(body.entityIds)
      ? body.entityIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : undefined;
    const result = await startContactResearch({
      limit: Number(body.limit) || undefined,
      entityIds,
      resumeJobId: typeof body.resumeJobId === "string" ? body.resumeJobId : undefined,
    });
    res.status(202).json({
      ...result,
      pollUrl: `/api/ingest/job/${result.jobId}`,
      message: result.resumed
        ? "Durable contact-research job resumed."
        : "Durable contact-research job started.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(/already running/i.test(message) ? 409 : 400).json({ error: message });
  }
});

router.get("/ingest/contact-research/status", async (_req: Request, res: Response): Promise<void> => {
  const activeId = await getActiveJob(CONTACT_RESEARCH_JOB_TYPE);
  const active = activeId ? await getJob(activeId) : null;
  const latest = await getLatestJob(CONTACT_RESEARCH_JOB_TYPE);
  res.json({
    active: active ? {
      jobId: active.jobId,
      status: active.status,
      progress: active.progress,
      total: active.total,
      targetIndex: active.targetIndex,
      targetTotal: active.targetTotal,
      currentTargetId: active.currentTargetId,
      currentPhase: active.currentPhase,
      errors: active.errors,
      message: active.message,
    } : null,
    latest: latest ? {
      jobId: latest.jobId,
      status: latest.status,
      outcome: latest.outcome,
      progress: latest.progress,
      total: latest.total,
      targetIndex: latest.targetIndex,
      targetTotal: latest.targetTotal,
      completedTargetIds: latest.completedTargetIds,
      failedTargetIds: latest.failedTargetIds,
      currentPhase: latest.currentPhase,
      message: latest.message,
    } : null,
  });
});

router.post("/ingest/contact-research/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await cancelContactResearch(
      typeof req.body?.jobId === "string" ? req.body.jobId : undefined,
    );
    res.json({
      jobId: job.jobId,
      status: job.status,
      outcome: job.outcome,
      message: job.message,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;