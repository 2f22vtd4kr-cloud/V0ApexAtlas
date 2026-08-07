/**
 * Durable contact-research coordinator.
 *
 * This is intentionally a coordinator, not a second enrichment implementation:
 * it reuses the existing web-OSINT route and Phase J runner, while making the
 * order, cursor, failures, and restart behavior durable in the Redis job state.
 */

import {
  db,
  entitiesTable,
  improvementLogsTable,
  type Entity,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  appendJobLog,
  createJob,
  getActiveJob,
  getJob,
  getLatestJob,
  setActiveJob,
  updateJob,
  clearActiveJobIfOwned,
  ownsActiveJob,
  type JobState,
} from "./job-queue";
import { runPersonasForEntity } from "./persona-engine";
import { runPhaseJBatch } from "../routes/phase-j";
import { logger } from "./logger";

export const CONTACT_RESEARCH_JOB_TYPE = "contact-research";
const WEB_OSINT_JOB_TYPE = "web-osint";
const PHASE_J_JOB_TYPE = "phase-j-pass";
const DEFAULT_TARGET_LIMIT = 25;
const SLOT_WAIT_MS = 10 * 60_000;
const NESTED_JOB_TIMEOUT_MS = 20 * 60_000;
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 30 * 60_000;
const MAX_TARGET_ATTEMPTS = 3;

type ContactResearchPhase = "selecting" | "personas" | "web-osint" | "phase-j" | "complete";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIds(value: string | undefined): number[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.map(Number).filter(id => Number.isInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

function parseRetryCounts(value: string | undefined): Record<string, number> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

function jsonIds(ids: number[]): string {
  return JSON.stringify([...new Set(ids)]);
}

function retryDelayMs(retryCounts: string | undefined, failedIds: number[]): number {
  const counts = parseRetryCounts(retryCounts);
  const attempts = failedIds.map(id => counts[String(id)] ?? 1);
  const exponent = Math.max(0, Math.min(Math.max(...attempts, 1) - 1, 5));
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** exponent));
}

function isRetryable(entityId: number, retryCounts: string | undefined): boolean {
  return (parseRetryCounts(retryCounts)[String(entityId)] ?? 0) < MAX_TARGET_ATTEMPTS;
}

function scheduleContactResearchRetry(jobId: string, delayMs: number): void {
  setTimeout(() => {
    launchContactResearch(jobId);
  }, delayMs).unref?.();
}

function launchContactResearch(jobId: string): void {
  void runContactResearchJob(jobId).catch(async error => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, err: message }, "Durable contact-research coordinator crashed");
    const current = await getJob(jobId);
    await updateJob(jobId, {
      status: "queued",
      outcome: "incomplete",
      resumable: "true",
      errors: 1,
      currentPhase: "retry-wait",
      message: `Coordinator paused unexpectedly; retrying automatically: ${message}`,
    });
    scheduleContactResearchRetry(
      jobId,
      retryDelayMs(current?.retryCounts, parseIds(current?.failedTargetIds)),
    );
  });
}

function currentRetryCount(job: JobState, entityId: number): number {
  return parseRetryCounts(job.retryCounts)[String(entityId)] ?? 0;
}

async function persistPersonaFindings(entity: Entity): Promise<number> {
  const suggestions = await runPersonasForEntity(entity);
  let inserted = 0;

  for (const suggestion of suggestions) {
    const existing = await db
      .select({ id: improvementLogsTable.id })
      .from(improvementLogsTable)
      .where(sql`
        ${improvementLogsTable.entityId} = ${suggestion.entityId}
        AND ${improvementLogsTable.persona} = ${suggestion.persona}
        AND ${improvementLogsTable.title} = ${suggestion.title}
        AND ${improvementLogsTable.status} = 'pending'
      `)
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(improvementLogsTable).values({
      entityId: suggestion.entityId,
      persona: suggestion.persona,
      category: suggestion.category,
      priority: suggestion.priority,
      title: suggestion.title,
      description: suggestion.description,
      actionTaken: suggestion.actionTaken,
      status: "pending",
    });
    inserted += 1;
  }

  return inserted;
}

async function waitForSlot(
  parentJobId: string,
  type: string,
  label: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < SLOT_WAIT_MS) {
    const activeId = await getActiveJob(type);
    if (!activeId) return;
    const active = await getJob(activeId);
    if (!active || active.status === "done" || active.status === "failed") return;
    await updateJob(parentJobId, {
      message: `Waiting for ${label} to become available — another ${label} job is active.`,
    });
    await sleep(2_000);
  }
  throw new Error(`${label} slot remained busy for ${Math.round(SLOT_WAIT_MS / 60_000)} minutes`);
}

async function startWebOsintTarget(
  parentJobId: string,
  entityId: number,
): Promise<JobState> {
  await waitForSlot(parentJobId, WEB_OSINT_JOB_TYPE, "web OSINT");
  const port = Number(process.env["PORT"] ?? 8080) || 8080;
  const response = await fetch(`http://127.0.0.1:${port}/api/ingest/web-osint-enrich`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityIds: [entityId], force: true, batchSize: 1 }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as { jobId?: string; error?: string };
  if (!response.ok || !payload.jobId) {
    throw new Error(payload.error ?? `web OSINT start failed (${response.status})`);
  }

  const nestedJobId = payload.jobId;
  const started = Date.now();
  while (Date.now() - started < NESTED_JOB_TIMEOUT_MS) {
    const nested = await getJob(nestedJobId);
    if (!nested) throw new Error("web OSINT job state disappeared");
    if (nested.status === "done") return nested;
    if (nested.status === "failed") {
      throw new Error(nested.message || "web OSINT job failed");
    }
    await updateJob(parentJobId, {
      message: `Web OSINT ${nested.progress}/${nested.total || 1}: ${nested.message}`,
    });
    await sleep(2_000);
  }
  throw new Error("web OSINT nested job timed out");
}

async function runPhaseJTarget(
  parentJobId: string,
  entityId: number,
): Promise<JobState> {
  await waitForSlot(parentJobId, PHASE_J_JOB_TYPE, "Phase J");
  const nestedJobId = await createJob(PHASE_J_JOB_TYPE);
  await setActiveJob(PHASE_J_JOB_TYPE, nestedJobId);
  await updateJob(nestedJobId, {
    status: "queued",
    total: 1,
    message: `Phase J queued for entity ${entityId}`,
  });

  try {
    const result = await runPhaseJBatch(nestedJobId, 1, undefined, [entityId]);
    const nested = await getJob(nestedJobId);
    if (nested?.status === "failed") {
      throw new Error(nested.message || "Phase J job failed");
    }
    if (result.ran === 0) {
      await updateJob(nestedJobId, {
        status: "done",
        progress: 1,
        total: 1,
        message: "Phase J found no due target; checkpoint retained for the next pass.",
      });
    }
    return (await getJob(nestedJobId)) ?? {
      jobId: nestedJobId,
      type: PHASE_J_JOB_TYPE,
      status: "done",
      progress: 1,
      inserted: 0,
      skipped: 1,
      errors: 0,
      total: 1,
      startedAt: new Date().toISOString(),
      message: result.message,
    };
  } catch (error) {
    await updateJob(nestedJobId, {
      status: "failed",
      errors: 1,
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
    await clearActiveJobIfOwned(PHASE_J_JOB_TYPE, nestedJobId);
    throw error;
  }
}

async function selectTargets(limit: number): Promise<Entity[]> {
  return db
    .select()
    .from(entitiesTable)
    .where(sql`
      ${entitiesTable.type} IN ('HNWI', 'Gatekeeper')
      AND COALESCE(${entitiesTable.contactOutcome}, 'none') <> 'direct_contact_verified'
    `)
    .orderBy(
      desc(entitiesTable.isHot),
      desc(entitiesTable.bayesianScore),
      desc(entitiesTable.contactConfidence),
      entitiesTable.id,
    )
    .limit(limit);
}

export async function startContactResearch(options?: {
  limit?: number;
  entityIds?: number[];
  resumeJobId?: string;
}): Promise<{ jobId: string; total: number; resumed: boolean }> {
  const existingId = await getActiveJob(CONTACT_RESEARCH_JOB_TYPE);
  if (existingId) {
    const existing = await getJob(existingId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      throw new Error(`A contact-research job is already running: ${existingId}`);
    }
  }

  if (options?.resumeJobId) {
    const existing = await getJob(options.resumeJobId);
    if (!existing) throw new Error("The requested contact-research job no longer exists");
    if (existing.type !== CONTACT_RESEARCH_JOB_TYPE) {
      throw new Error("The requested job is not a contact-research job");
    }
    if (existing.status === "running" || existing.status === "queued") {
      throw new Error(`The requested contact-research job is already active: ${existing.jobId}`);
    }
    await setActiveJob(CONTACT_RESEARCH_JOB_TYPE, existing.jobId);
    await updateJob(existing.jobId, {
      status: "queued",
      resumable: "true",
      message: "Resuming durable contact-research job…",
    });
    launchContactResearch(existing.jobId);
    return {
      jobId: existing.jobId,
      total: existing.targetTotal ?? parseIds(existing.targetIds).length,
      resumed: true,
    };
  }

  const requestedIds = options?.entityIds?.filter(id => Number.isInteger(id) && id > 0) ?? [];
  const entities = requestedIds.length
    ? await db.select().from(entitiesTable).where(and(
      inArray(entitiesTable.id, requestedIds),
      sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper')`,
      sql`COALESCE(${entitiesTable.contactOutcome}, 'none') <> 'direct_contact_verified'`,
    ))
    : await selectTargets(Math.min(Math.max(options?.limit ?? DEFAULT_TARGET_LIMIT, 1), 100));
  const targetIds = entities.map(entity => entity.id);
  if (targetIds.length === 0) throw new Error("No eligible HNWI or Gatekeeper targets are available");

  const jobId = await createJob(CONTACT_RESEARCH_JOB_TYPE);
  await setActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId);
  await updateJob(jobId, {
    status: "queued",
    total: targetIds.length,
    targetTotal: targetIds.length,
    targetIndex: 0,
    targetIds: jsonIds(targetIds),
    completedTargetIds: "[]",
    failedTargetIds: "[]",
    retryCounts: "{}",
    resumable: "true",
    currentPhase: "selecting",
    message: `Queued durable contact research for ${targetIds.length} eligible targets.`,
  });
  launchContactResearch(jobId);
  return { jobId, total: targetIds.length, resumed: false };
}

export async function runContactResearchJob(jobId: string): Promise<void> {
  const lock = await getActiveJob(CONTACT_RESEARCH_JOB_TYPE);
  if (lock !== jobId) {
    await setActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId);
  }
  const initial = await getJob(jobId);
  if (!initial) return;

  const targetIds = parseIds(initial.targetIds);
  const completed = [...new Set(parseIds(initial.completedTargetIds))];
  let failed = [...new Set(parseIds(initial.failedTargetIds))];
  let errors = initial.errors;
  let personaFindings = Number(initial.inserted ?? 0);

  await updateJob(jobId, {
    status: "running",
    total: targetIds.length,
    targetTotal: targetIds.length,
    message: `Contact research running — ${completed.length}/${targetIds.length} targets complete.`,
  });

  for (let index = 0; index < targetIds.length; index++) {
    const entityId = targetIds[index]!;
    if (completed.includes(entityId)) continue;
    const current = await getJob(jobId);
    if (!current || current.status === "cancelled" || !(await ownsActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId))) {
      logger.info({ jobId, entityId }, "Contact-research worker stopped after losing coordinator ownership");
      return;
    }
    if (!isRetryable(entityId, current.retryCounts)) continue;

    const [entity] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
    if (!entity) {
      if (!failed.includes(entityId)) failed.push(entityId);
      errors += 1;
      await updateJob(jobId, {
        targetIndex: index + 1,
        currentTargetId: entityId,
        currentPhase: "missing-target",
        failedTargetIds: jsonIds(failed),
        errors,
        message: `Target ${entityId} disappeared; continuing with the next target.`,
      });
      continue;
    }

    const updateProgress = async (phase: ContactResearchPhase, message: string) => {
      await updateJob(jobId, {
        targetIndex: index,
        currentTargetId: entityId,
        currentPhase: phase,
        entityProgress: completed.length,
        entityTotal: targetIds.length,
        progress: Math.round((completed.length / targetIds.length) * 100),
        inserted: personaFindings,
        errors,
        message,
      });
    };

    try {
      await updateProgress("personas", `Personas reviewing ${entity.name} before contact research…`);
      personaFindings += await persistPersonaFindings(entity);
      if (!(await ownsActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId))) return;

      await updateProgress("web-osint", `Running web OSINT for ${entity.name}…`);
      await startWebOsintTarget(jobId, entityId);
      if (!(await ownsActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId))) return;

      await updateProgress("phase-j", `Running Phase J attribution for ${entity.name}…`);
      await runPhaseJTarget(jobId, entityId);
      if (!(await ownsActiveJob(CONTACT_RESEARCH_JOB_TYPE, jobId))) return;

      completed.push(entityId);
      failed = failed.filter(id => id !== entityId);
      await updateJob(jobId, {
        targetIndex: index + 1,
        completedTargetIds: jsonIds(completed),
        failedTargetIds: jsonIds(failed),
        inserted: personaFindings,
        progress: Math.round((completed.length / targetIds.length) * 100),
        entityProgress: completed.length,
        entityTotal: targetIds.length,
        message: `Completed ${entity.name} — ${completed.length}/${targetIds.length} targets.`,
      });
    } catch (error) {
      errors += 1;
      if (!failed.includes(entityId)) failed.push(entityId);
      const retries = parseRetryCounts((await getJob(jobId))?.retryCounts);
      retries[String(entityId)] = (retries[String(entityId)] ?? 0) + 1;
      await appendJobLog(
        jobId,
        `Target ${entity.name} failed attempt ${retries[String(entityId)]}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await updateJob(jobId, {
        targetIndex: index + 1,
        currentTargetId: entityId,
        currentPhase: "target-error",
        failedTargetIds: jsonIds(failed),
        retryCounts: JSON.stringify(retries),
        errors,
        message: `Target ${entity.name} failed safely; continuing with the next target.`,
      });
    }
  }

  const final = await getJob(jobId);
  const remainingFailed = final?.failedTargetIds
    ? parseIds(final.failedTargetIds)
    : failed;
  const retryableFailed = remainingFailed.filter(id => isRetryable(id, final?.retryCounts));
  if (retryableFailed.length > 0) {
    const delayMs = retryDelayMs(final?.retryCounts, retryableFailed);
    await updateJob(jobId, {
      status: "queued",
      progress: Math.round((completed.length / targetIds.length) * 100),
      targetIndex: targetIds.length,
      currentPhase: "retry-wait",
      entityProgress: completed.length,
      entityTotal: targetIds.length,
      outcome: "incomplete",
      resumable: "true",
      message: `Contact research will retry ${retryableFailed.length} failed target(s) in ${Math.ceil(delayMs / 1000)} seconds.`,
    });
    scheduleContactResearchRetry(jobId, delayMs);
    return;
  }

  const exhausted = remainingFailed.length > 0;
  await updateJob(jobId, {
    status: "done",
    progress: 100,
    targetIndex: targetIds.length,
    currentPhase: "complete",
    entityProgress: completed.length,
    entityTotal: targetIds.length,
    outcome: exhausted ? "incomplete" : "complete",
    resumable: "true",
    message: exhausted
      ? `Contact research stopped with ${remainingFailed.length} target(s) after ${MAX_TARGET_ATTEMPTS} attempts; resume explicitly after review.`
      : `Contact research complete — ${completed.length} targets processed with personas, web OSINT, and Phase J.`,
    finishedAt: new Date().toISOString(),
  });
  await clearActiveJobIfOwned(CONTACT_RESEARCH_JOB_TYPE, jobId);
}

export async function cancelContactResearch(jobId?: string): Promise<JobState> {
  const targetJobId = jobId ?? await getActiveJob(CONTACT_RESEARCH_JOB_TYPE);
  if (!targetJobId) throw new Error("No contact-research job is active");
  const job = await getJob(targetJobId);
  if (!job || job.type !== CONTACT_RESEARCH_JOB_TYPE) {
    throw new Error("The requested job is not a contact-research job");
  }
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return job;
  }
  await updateJob(targetJobId, {
    status: "cancelled",
    outcome: "incomplete",
    currentPhase: "cancelled",
    message: "Contact research canceled by operator; completed target checkpoints are retained.",
    finishedAt: new Date().toISOString(),
  });
  await clearActiveJobIfOwned(CONTACT_RESEARCH_JOB_TYPE, targetJobId);
  return (await getJob(targetJobId)) ?? job;
}

export async function resumeContactResearchAfterRestart(): Promise<void> {
  const latest = await getLatestJob(CONTACT_RESEARCH_JOB_TYPE);
  if (!latest) return;
  if (
    (latest.status === "failed" || latest.status === "queued")
    && latest.resumable === "true"
    && latest.outcome === "incomplete"
  ) {
    await startContactResearch({ resumeJobId: latest.jobId });
    logger.warn({ jobId: latest.jobId }, "Resumed durable contact-research job after restart");
  }
}