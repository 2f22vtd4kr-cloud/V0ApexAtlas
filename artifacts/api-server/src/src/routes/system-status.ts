/**
 * GET /api/system/status
 *
 * Returns a unified health snapshot covering:
 *   - All AI provider key pools (Perplexity, Gemini, Tavily, Exa, Groq)
 *     with per-slot active / exhausted / missing state
 *   - PostgreSQL reachability + round-trip latency
 *   - Local Redis reachability + latency
 *   - All Upstash permanent-client slots with exhaustion state
 *
 * Results are cached for 15 s so rapid UI polling doesn't hammer the DB.
 */

import { Router, type IRouter } from "express";
import { sql }                  from "drizzle-orm";
import { db }                   from "@workspace/db";
import { getAIKeyStatus }       from "../lib/ai-extractor";
import { checkPythonToolsAvailability } from "../lib/python-tools";
import {
  getLocalRedisStatus,
  getPermanentClientStatuses,
  pingRedis,
}                               from "../lib/redis";
import { getMistralWebSearchStatus } from "../lib/mistral-web-search";
import { getGeminiBossStatus } from "../lib/case-bureau";
import { getNvidiaNimCaseReasoningStatus } from "../lib/nvidia-nim-case-reasoning";

const router: IRouter = Router();

const CACHE_TTL_MS = 15_000;
let _cached:   unknown = null;
let _cachedAt  = 0;

router.get("/system/status", async (_req, res) => {
  try {
    if (_cached && Date.now() - _cachedAt < CACHE_TTL_MS) {
      return res.json({ ...(typeof _cached === "object" ? _cached : {}), cached: true, cachedAgoMs: Date.now() - _cachedAt });
    }

    // ── AI providers ──────────────────────────────────────────────────────────
    const ai = getAIKeyStatus();
    const pythonTools = await checkPythonToolsAvailability();
    const huggingFaceConfigured = Boolean(process.env.HF_TOKEN);
    const serperConfigured = Boolean(process.env.SERPER_API_KEY);
    const openResearchReady = huggingFaceConfigured && serperConfigured && pythonTools.openDeepResearch;
    const openResearch = {
      state: openResearchReady
        ? "ready"
        : huggingFaceConfigured || serperConfigured || pythonTools.openDeepResearch
          ? "incomplete"
          : "unavailable",
      huggingFace: { configured: huggingFaceConfigured },
      serper: { configured: serperConfigured },
      adapter: {
        available: pythonTools.openDeepResearch,
        model: process.env.HF_DEEP_RESEARCH_MODEL || "Qwen/Qwen2.5-7B-Instruct",
      },
      mistral: getMistralWebSearchStatus(),
    } as const;
    const bureauReasoning = getNvidiaNimCaseReasoningStatus();
    const geminiBoss = await getGeminiBossStatus();

    // ── PostgreSQL ────────────────────────────────────────────────────────────
    let pgStatus: "ok" | "error" = "ok";
    let pgLatencyMs: number | null = null;
    try {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      pgLatencyMs = Date.now() - t0;
    } catch {
      pgStatus = "error";
    }

    // ── Local Redis ───────────────────────────────────────────────────────────
    const localInfo = getLocalRedisStatus();
    const localLatencyMs = localInfo.status === "ready" ? await pingRedis() : null;

    // ── Upstash slots ─────────────────────────────────────────────────────────
    const upstash = getPermanentClientStatuses();

    const payload = {
      ai,
      openResearch,
      geminiBoss,
      bureauReasoning,
      databases: {
        postgres:   { status: pgStatus, latencyMs: pgLatencyMs },
        localRedis: { ...localInfo, latencyMs: localLatencyMs },
        upstash,
      },
      generatedAt: new Date().toISOString(),
      cached: false,
      cachedAgoMs: 0,
    };

    _cached   = payload;
    _cachedAt = Date.now();

    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Unknown error" });
  }
});

export default router;
