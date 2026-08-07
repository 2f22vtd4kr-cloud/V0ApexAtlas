/**
 * Semantic Engine — Phase G1
 *
 * Provides true sentence-embedding semantic search using
 * @huggingface/transformers (Xenova/all-MiniLM-L6-v2, ONNX, 384-dim).
 *
 * Runs fully server-side in Node.js — no external AI API calls.
 * Model is ~23 MB, downloaded once to /tmp/hf-cache and cached.
 *
 * Architecture:
 *   1. Background job (POST /api/ingest/compute-embeddings) embeds every entity
 *      and stores Float32Array in Redis key `emb:v1:{id}` (base64).
 *   2. In-memory cache (module Map) is populated from Redis at startup and
 *      incrementally by the background job.
 *   3. At search time: embed query → cosine sim against in-memory cache → top-K.
 *
 * If cache is empty (cold start), the semantic signal returns [] gracefully.
 */

import { env, pipeline } from "@huggingface/transformers";
import { getRedisClient } from "./redis";

// Cache model files locally in /tmp so they survive Replit container restarts
env.cacheDir = "/tmp/hf-cache";
env.allowLocalModels = false;

// ── Model singleton ───────────────────────────────────────────────────────────

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;
let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
let _pipelineLoaded = false;

async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!_pipelinePromise) {
    console.log("[semantic-engine] Loading all-MiniLM-L6-v2 (first time, ~23 MB download)...");
    _pipelinePromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "fp32" },
    ).then((p) => {
      _pipelineLoaded = true;
      console.log("[semantic-engine] Model ready.");
      return p;
    }).catch((err) => {
      _pipelinePromise = null; // allow retry
      throw err;
    });
  }
  return _pipelinePromise;
}

export function isModelLoaded(): boolean {
  return _pipelineLoaded;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

/**
 * Embed a string → normalised 384-dim Float32Array.
 * Truncates to 512 chars to keep latency under 20 ms post-load.
 */
export async function embedText(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();
  // @ts-expect-error — dynamic pipeline call
  const output = await pipe(text.slice(0, 512), { pooling: "mean", normalize: true });
  // output.data is already a Float32Array
  return output.data as Float32Array;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── In-memory embedding cache ─────────────────────────────────────────────────

const _embCache = new Map<number, Float32Array>();

export function getEmbeddingCacheSize(): number {
  return _embCache.size;
}

/** Build the text to embed for an entity — same fields as BM25 for consistency */
export function entityToEmbedText(entity: {
  name: string;
  notes?: string | null;
  nationality?: string | null;
  knownResidences?: string | null;
  metadata?: string | null;
}): string {
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(entity.metadata ?? "{}"); } catch { /* */ }

  return [
    entity.name, entity.name, // doubled for weight
    entity.notes ?? "",
    entity.nationality ?? "",
    entity.knownResidences ?? "",
    meta["engineLabel"] ?? "",
    meta["state"] ?? "",
    meta["nNumber"] ?? "",
    meta["formType"] ?? "",
    meta["bizLocation"] ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 512);
}

// ── Redis persistence ─────────────────────────────────────────────────────────

const EMB_KEY_PREFIX = "emb:v1:";
const EMB_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function float32ToBase64(arr: Float32Array): string {
  return Buffer.from(arr.buffer).toString("base64");
}

function base64ToFloat32(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Store one embedding in Redis + in-memory cache */
export async function storeEmbedding(entityId: number, emb: Float32Array): Promise<void> {
  _embCache.set(entityId, emb);
  try {
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(`${EMB_KEY_PREFIX}${entityId}`, float32ToBase64(emb), "EX", EMB_TTL_SECONDS);
    }
  } catch {
    // Redis failure is non-fatal — in-memory cache still works
  }
}

/**
 * Load all embeddings from Redis into the in-memory cache.
 * Called at startup — may load 0 entries on fresh import (run compute-embeddings to populate).
 */
export async function loadEmbeddingsFromRedis(): Promise<number> {
  try {
    const redis = await getRedisClient();
    if (!redis) return 0;

    let cursor = "0";
    let loaded = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${EMB_KEY_PREFIX}*`, "COUNT", 500);
      cursor = nextCursor;
      if (keys.length === 0) continue;

      const values = await redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = values[i];
        if (!key || !val) continue;
        const idStr = key.replace(EMB_KEY_PREFIX, "");
        const entityId = parseInt(idStr, 10);
        if (isNaN(entityId)) continue;
        _embCache.set(entityId, base64ToFloat32(val));
        loaded++;
      }
    } while (cursor !== "0");

    if (loaded > 0) {
      console.log(`[semantic-engine] Loaded ${loaded} embeddings from Redis.`);
    }
    return loaded;
  } catch (err) {
    console.warn("[semantic-engine] Redis load failed:", (err as Error).message);
    return 0;
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SemanticEngineResult {
  id: number;
  score: number;
}

/**
 * Semantic search against the in-memory embedding cache.
 * Returns [] if cache is empty (model not yet warmed up).
 */
export async function semanticEngineSearch(
  query: string,
  topK = 100,
): Promise<SemanticEngineResult[]> {
  if (_embCache.size < 100) {
    // Not enough embeddings yet — skip gracefully
    return [];
  }

  let queryEmb: Float32Array;
  try {
    queryEmb = await embedText(query);
  } catch {
    return [];
  }

  const scored: SemanticEngineResult[] = [];
  for (const [id, emb] of _embCache) {
    scored.push({ id, score: cosineSim(queryEmb, emb) });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── Expose embedding cache for cross-module use (e.g. entity resolution) ─────

/**
 * Returns the full in-memory embedding cache (entityId → Float32Array).
 * Callers must not mutate the map.
 */
export function getAllEmbeddings(): ReadonlyMap<number, Float32Array> {
  return _embCache;
}

// ── Warm-up: preload model in background (non-blocking) ───────────────────────

export function warmUpSemanticEngine(): void {
  getEmbeddingPipeline()
    .then(() => loadEmbeddingsFromRedis())
    .catch((err) =>
      console.warn("[semantic-engine] Warm-up failed (non-fatal):", (err as Error).message),
    );
}
