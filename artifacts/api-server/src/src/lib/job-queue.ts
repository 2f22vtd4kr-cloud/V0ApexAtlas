/**
 * Redis-backed background job queue — uses PERMANENT client (Upstash)
 * so job state survives container restarts.
 *
 * Jobs: apex:job:<jobId>  (HASH)
 * Log:  apex:job:<jobId>:log  (LIST, newest first, capped at 200)
 * Active job per type: apex:activejob:<type>  (STRING)
 * Dedup set: apex:dedup:hnwi  (SET — stored on Upstash for permanence)
 */

import { randomUUID } from "crypto";
import { withPermanentClient, permSadd, permSismember, permScard } from "./redis";
import { logger } from "./logger";

/**
 * Execute a Redis command with automatic quota-exhaustion retry.
 * If the first client throws "max requests limit exceeded", marks it exhausted
 * immediately (before the ioredis error event fires) and retries with the next
 * healthy slot.  Falls back to `fallback` if all slots are exhausted.
 */
async function safeRedis<T>(fn: (rc: import("ioredis").Redis) => Promise<T>, fallback: T): Promise<T> {
  return withPermanentClient(fn, fallback);
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobState {
  jobId: string;
  type: string;
  status: JobStatus;
  progress: number;   // 0–100
  inserted: number;
  skipped: number;    // deduped
  errors: number;
  total: number;
  startedAt: string;
  finishedAt?: string;
  message: string;
  /** Optional structured progress for the Atlas reactor. */
  atlasPhase?: number;
  atlasPhaseTotal?: number;
  entityProgress?: number;
  entityTotal?: number;
  entityNames?: string;
  /** Structured, target-scoped telemetry for the Intelligence Reactor inspector. */
  atlasTelemetry?: string;
  /** Process may finish while the research outcome remains incomplete. */
  outcome?: "complete" | "incomplete";
  /** Durable resumable contact-research coordinator state. */
  resumable?: string;
  targetIds?: string;
  targetIndex?: number;
  targetTotal?: number;
  currentTargetId?: number;
  currentPhase?: string;
  completedTargetIds?: string;
  failedTargetIds?: string;
  retryCounts?: string;
  /** JSON-encoded result for bounded provider jobs such as Deep Research. */
  result?: string;
}

export type AutoPipelineSchedulerStatus = {
  enabled: boolean;
  active: boolean;
  activatedAt?: string;
  lastTriggerAt?: string;
  nextTriggerAt?: string;
  lastLabel?: string;
  lastStatus?: "triggered" | "completed" | "skipped_lock" | "no_targets" | "error";
  lastJobId?: string;
  lastMessage?: string;
  cycles: number;
  skippedDueToLock: number;
  providerNoTarget: number;
};

const JOB_TTL = 60 * 60 * 24 * 7; // 7 days on Upstash
const LOG_CAP = 200;
const AUTO_PIPELINE_SCHEDULER_KEY = "apex:autopipeline:scheduler";

function jk(jobId: string) { return `apex:job:${jobId}`; }
function lk(jobId: string) { return `apex:job:${jobId}:log`; }

export async function createJob(type: string): Promise<string> {
  const jobId = randomUUID();
  const state: JobState = {
    jobId, type, status: "queued",
    progress: 0, inserted: 0, skipped: 0, errors: 0, total: 0,
    startedAt: new Date().toISOString(),
    message: "Queued",
  };
  await safeRedis(async rc => {
    await rc.hset(jk(jobId), state as any);
    await rc.expire(jk(jobId), JOB_TTL);
    await rc.set(`apex:latestjob:${type}`, jobId, "EX", JOB_TTL);
  }, undefined);
  return jobId;
}

export async function updateJob(jobId: string, patch: Partial<JobState>): Promise<void> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) flat[k] = String(v);
  await safeRedis(async rc => {
    await rc.hset(jk(jobId), flat);
    await rc.expire(jk(jobId), JOB_TTL);
  }, undefined);
}

/** Remove optional structured fields when a job moves to a new phase. */
export async function clearJobFields(jobId: string, fields: string[]): Promise<void> {
  if (fields.length === 0) return;
  await safeRedis(async rc => {
    await rc.hdel(jk(jobId), ...fields);
    await rc.expire(jk(jobId), JOB_TTL);
  }, undefined);
}

export async function appendJobLog(jobId: string, line: string): Promise<void> {
  const ts = `${new Date().toISOString()} ${line}`;
  await safeRedis(async rc => {
    await rc.lpush(lk(jobId), ts);
    await rc.ltrim(lk(jobId), 0, LOG_CAP - 1);
    await rc.expire(lk(jobId), JOB_TTL);
  }, undefined);
}

export async function getJob(jobId: string): Promise<JobState | null> {
  const raw = await safeRedis(rc => rc.hgetall(jk(jobId)), null);
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    jobId: raw["jobId"] ?? jobId,
    type: raw["type"] ?? "unknown",
    status: (raw["status"] ?? "queued") as JobStatus,
    progress: Number(raw["progress"] ?? 0),
    inserted: Number(raw["inserted"] ?? 0),
    skipped: Number(raw["skipped"] ?? 0),
    errors: Number(raw["errors"] ?? 0),
    total: Number(raw["total"] ?? 0),
    startedAt: raw["startedAt"] ?? "",
    finishedAt: raw["finishedAt"],
    message: raw["message"] ?? "",
    atlasPhase: raw["atlasPhase"] !== undefined ? Number(raw["atlasPhase"]) : undefined,
    atlasPhaseTotal: raw["atlasPhaseTotal"] !== undefined ? Number(raw["atlasPhaseTotal"]) : undefined,
    entityProgress: raw["entityProgress"] !== undefined ? Number(raw["entityProgress"]) : undefined,
    entityTotal: raw["entityTotal"] !== undefined ? Number(raw["entityTotal"]) : undefined,
    entityNames: raw["entityNames"],
    atlasTelemetry: raw["atlasTelemetry"],
    outcome: raw["outcome"] === "incomplete" || raw["outcome"] === "complete"
      ? raw["outcome"]
      : undefined,
    resumable: raw["resumable"],
    targetIds: raw["targetIds"],
    targetIndex: raw["targetIndex"] !== undefined ? Number(raw["targetIndex"]) : undefined,
    targetTotal: raw["targetTotal"] !== undefined ? Number(raw["targetTotal"]) : undefined,
    currentTargetId: raw["currentTargetId"] !== undefined ? Number(raw["currentTargetId"]) : undefined,
    currentPhase: raw["currentPhase"],
    completedTargetIds: raw["completedTargetIds"],
    failedTargetIds: raw["failedTargetIds"],
    retryCounts: raw["retryCounts"],
    result: raw["result"],
  };
}

export async function getJobLog(jobId: string): Promise<string[]> {
  return safeRedis(rc => rc.lrange(lk(jobId), 0, LOG_CAP - 1), []);
}

// ── Deduplication (Upstash SET — permanent across restarts) ──────────────────

const DEDUP_KEY = "apex:dedup:hnwi";

/** Returns true if this key has already been ingested */
export async function isDuplicate(key: string): Promise<boolean> {
  return permSismember(DEDUP_KEY, key);
}

/** Mark a key as ingested */
export async function markSeen(key: string): Promise<void> {
  await permSadd(DEDUP_KEY, key);
}

/** How many unique records have been seen */
export async function getDedupCount(): Promise<number> {
  return permScard(DEDUP_KEY);
}

/** Clear dedup set — use before a full re-ingest */
export async function clearDedup(): Promise<void> {
  // batchMarkSeen and preloadDedupPrefix both use `apex:${DEDUP_KEY}` as the raw key
  // (because permSadd applies PERM_PREFIX "apex:" → actual Upstash key = "apex:apex:dedup:hnwi").
  const FULL_KEY = `apex:${DEDUP_KEY}`;
  await withPermanentClient(async rc => {
    await rc.del(FULL_KEY);
    logger.info({ key: FULL_KEY }, "Dedup set cleared");
  }, undefined);
}

/**
 * Pre-load dedup set members matching a prefix into a local in-memory Set.
 * Use this at the start of an ingestor to avoid per-record Upstash round-trips.
 * The caller can then check/update the returned Set locally and call batchMarkSeen()
 * after each batch flush.
 */
export async function preloadDedupPrefix(prefix: string): Promise<Set<string>> {
  const seen = new Set<string>();
  await withPermanentClient(async rc => {
    // The actual Redis key has the PERM_PREFIX applied by permSadd/permSismember
    const fullKey = `apex:${DEDUP_KEY}`;
    let cursor = "0";
    do {
      const [next, members] = await rc.sscan(fullKey, cursor, "MATCH", `${prefix}*`, "COUNT", 2000);
      cursor = next;
      for (const m of members) seen.add(m);
    } while (cursor !== "0");
    logger.info({ prefix, count: seen.size }, "Dedup prefix pre-loaded");
  }, undefined);
  return seen;
}

/**
 * Batch-write multiple keys into the permanent dedup set in one round-trip.
 * Use after each successful batch flush.
 */
export async function batchMarkSeen(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const fullKey = `apex:${DEDUP_KEY}`;
  await withPermanentClient(async rc => {
    await rc.sadd(fullKey, ...keys);
  }, undefined);
}

// ── Active job tracking ───────────────────────────────────────────────────────

export async function setActiveJob(type: string, jobId: string): Promise<void> {
  await safeRedis(rc => rc.set(`apex:activejob:${type}`, jobId, "EX", JOB_TTL), null);
}

export async function getActiveJob(type: string): Promise<string | null> {
  return safeRedis(rc => rc.get(`apex:activejob:${type}`), null);
}

export async function getLatestJob(type: string): Promise<JobState | null> {
  return safeRedis(async rc => {
    const pointerKey = `apex:latestjob:${type}`;
    const jobId = await rc.get(pointerKey);
    if (jobId) return getJob(jobId);

    // One-time migration for jobs created before the latest-job pointer existed.
    let cursor = "0";
    let latestId = "";
    let latestStarted = "";
    do {
      const [next, keys] = await rc.scan(cursor, "MATCH", "apex:job:*", "COUNT", 500);
      cursor = next;
      const candidates = keys.filter(key => !key.endsWith(":log"));
      if (!candidates.length) continue;
      const pipeline = rc.pipeline();
      candidates.forEach(key => pipeline.hmget(key, "jobId", "type", "startedAt"));
      const rows = await pipeline.exec();
      rows?.forEach((entry, index) => {
        const values = entry?.[1] as string[] | null;
        if (!values || values[1] !== type) return;
        if (values[2] > latestStarted) {
          latestStarted = values[2];
          latestId = values[0] || candidates[index]!.slice("apex:job:".length);
        }
      });
    } while (cursor !== "0");
    if (!latestId) return null;
    await rc.set(pointerKey, latestId, "EX", JOB_TTL);
    return getJob(latestId);
  }, null);
}

/** Durable scheduler telemetry used by the Reactor and startup recovery. */
export async function updateAutoPipelineScheduler(
  patch: Partial<AutoPipelineSchedulerStatus>,
): Promise<void> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) flat[key] = String(value);
  }
  if (Object.keys(flat).length === 0) return;
  await safeRedis(async rc => {
    await rc.hset(AUTO_PIPELINE_SCHEDULER_KEY, flat);
    await rc.expire(AUTO_PIPELINE_SCHEDULER_KEY, JOB_TTL);
  }, undefined);
}

export async function getAutoPipelineScheduler(): Promise<AutoPipelineSchedulerStatus> {
  const raw = await safeRedis(rc => rc.hgetall(AUTO_PIPELINE_SCHEDULER_KEY), {});
  return {
    enabled: raw["enabled"] === "true",
    active: raw["active"] === "true",
    activatedAt: raw["activatedAt"],
    lastTriggerAt: raw["lastTriggerAt"],
    nextTriggerAt: raw["nextTriggerAt"],
    lastLabel: raw["lastLabel"],
    lastStatus: ["triggered", "completed", "skipped_lock", "no_targets", "error"].includes(raw["lastStatus"] ?? "")
      ? raw["lastStatus"] as AutoPipelineSchedulerStatus["lastStatus"]
      : undefined,
    lastJobId: raw["lastJobId"],
    lastMessage: raw["lastMessage"],
    cycles: Number(raw["cycles"] ?? 0),
    skippedDueToLock: Number(raw["skippedDueToLock"] ?? 0),
    providerNoTarget: Number(raw["providerNoTarget"] ?? 0),
  };
}

export async function clearActiveJob(type: string): Promise<void> {
  await safeRedis(rc => rc.del(`apex:activejob:${type}`), null);
}

/** True only while this worker still owns the active job slot for its type. */
export async function ownsActiveJob(type: string, jobId: string): Promise<boolean> {
  return (await getActiveJob(type)) === jobId;
}

/**
 * Clear an active slot only if it still points at this worker's job.
 * A stale worker must never clear a newer replacement job's lock.
 */
export async function clearActiveJobIfOwned(type: string, jobId: string): Promise<boolean> {
  if (!(await ownsActiveJob(type, jobId))) return false;
  await clearActiveJob(type);
  return true;
}
