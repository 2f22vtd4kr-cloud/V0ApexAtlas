/**
 * Hybrid Search Engine — Phase 5 + G1
 *
 * Combines four independent relevance signals via Reciprocal Rank Fusion (RRF):
 *   1. BM25 keyword search
 *   2. TF-IDF cosine similarity (bigram-aware, bag-of-words)
 *   3. Graph/Bayesian signal (existing score + asset count + hot flag)
 *   4. TRUE Semantic embeddings (all-MiniLM-L6-v2 via @huggingface/transformers)
 *
 * Signal 4 is progressive — activates when ≥100 entity embeddings are cached.
 * Embeddings are computed by POST /api/ingest/compute-embeddings and cached in Redis.
 *
 * RRF formula: score(d) = Σ 1/(k + rank(d, signal))    k=60 (standard)
 *
 * Returns unified ranked candidates with per-signal score breakdown.
 */

import { db, entitiesTable, assetsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { bm25Search } from "./bm25";
import { semanticSearch } from "./tfidf-embedder";
import { semanticEngineSearch, getEmbeddingCacheSize } from "./semantic-engine";

const RRF_K = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HybridResult {
  id: number;
  name: string;
  type: string;
  nationality: string | null;
  bayesianScore: number | null;
  estimatedNetWorth: number | null;
  knownResidences: string | null;
  isHot: boolean | null;
  notes: string | null;
  assetCount: number;
  assetTypes: string[];
  sourceRegistries: string[];
  metadata: Record<string, unknown>;
  scores: {
    bm25: number;       // normalised 0–1
    semantic: number;   // TF-IDF cosine similarity 0–1
    graph: number;      // normalised 0–1
    embedding: number;  // true semantic similarity 0–1 (all-MiniLM-L6-v2)
    rrf: number;        // final RRF score
  };
  rank: number;
}

export interface HybridSearchMeta {
  bm25Hits: number;
  semanticHits: number;
  embeddingHits: number;
  graphHits: number;
  embeddingCacheSize: number;
  totalCandidates: number;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function hybridSearch(
  query: string,
  filterIds?: number[],
  topK = 30,
): Promise<{ results: HybridResult[]; meta: HybridSearchMeta }> {
  const t0 = Date.now();

  // ── Signals 1, 2, 4 in parallel ──────────────────────────────────────────
  const [bm25Results, semanticResults, embeddingResults] = await Promise.all([
    bm25Search(query, 100),
    semanticSearch(query, 100),
    semanticEngineSearch(query, 100), // signal 4: true sentence embeddings
  ]);

  // Collect all candidate IDs
  const allIds = new Set<number>();
  for (const r of bm25Results) allIds.add(r.id);
  for (const r of semanticResults) allIds.add(r.id);
  for (const r of embeddingResults) allIds.add(r.id);

  let candidateIds = [...allIds];
  if (filterIds && filterIds.length > 0) {
    const filterSet = new Set(filterIds);
    candidateIds = candidateIds.filter((id) => filterSet.has(id));
  }

  if (candidateIds.length === 0) {
    return {
      results: [],
      meta: {
        bm25Hits: bm25Results.length,
        semanticHits: semanticResults.length,
        embeddingHits: embeddingResults.length,
        embeddingCacheSize: getEmbeddingCacheSize(),
        graphHits: 0,
        totalCandidates: 0,
        durationMs: Date.now() - t0,
      },
    };
  }

  // ── Fetch entity + asset data for candidates ──────────────────────────────
  const ids200 = candidateIds.slice(0, 200);
  const [entities, assets] = await Promise.all([
    db.select().from(entitiesTable).where(inArray(entitiesTable.id, ids200)),
    db
      .select({ ownerId: assetsTable.ownerEntityId, category: assetsTable.category })
      .from(assetsTable)
      .where(inArray(assetsTable.ownerEntityId, ids200)),
  ]);

  // Asset maps
  const assetCounts: Record<number, number> = {};
  const assetTypeMap: Record<number, string[]> = {};
  for (const a of assets) {
    if (!a.ownerId) continue;
    assetCounts[a.ownerId] = (assetCounts[a.ownerId] ?? 0) + 1;
    if (!assetTypeMap[a.ownerId]) assetTypeMap[a.ownerId] = [];
    if (!assetTypeMap[a.ownerId]!.includes(a.category))
      assetTypeMap[a.ownerId]!.push(a.category);
  }

  // ── Signal 3: graph/Bayesian ──────────────────────────────────────────────
  const graphSignal = entities
    .map((e) => ({
      id: e.id,
      score:
        (e.bayesianScore ?? 0.05) +
        (assetCounts[e.id] ?? 0) * 0.05 +
        (e.isHot ? 0.1 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  // ── Build rank maps ───────────────────────────────────────────────────────
  const bm25RankMap    = new Map(bm25Results.map((r, i) => [r.id, i]));
  const semRankMap     = new Map(semanticResults.map((r, i) => [r.id, i]));
  const graphRankMap   = new Map(graphSignal.map((r, i) => [r.id, i]));
  const embRankMap     = new Map(embeddingResults.map((r, i) => [r.id, i]));

  const bm25ScoreMap   = new Map(bm25Results.map((r) => [r.id, r.score]));
  const semScoreMap    = new Map(semanticResults.map((r) => [r.id, r.score]));
  const graphScoreMap  = new Map(graphSignal.map((r) => [r.id, r.score]));
  const embScoreMap    = new Map(embeddingResults.map((r) => [r.id, r.score]));

  const hasEmbeddings = embeddingResults.length > 0;

  // ── RRF fusion ────────────────────────────────────────────────────────────
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const maxBm25  = Math.max(...bm25Results.map((r) => r.score), 1);
  const maxGraph = Math.max(...graphSignal.map((r) => r.score), 1);

  const fused = candidateIds
    .map((id) => ({
      id,
      bm25:      bm25ScoreMap.get(id) ?? 0,
      semantic:  semScoreMap.get(id) ?? 0,
      graph:     graphScoreMap.get(id) ?? 0,
      embedding: embScoreMap.get(id) ?? 0,
      rrf:
        rrfScore(bm25RankMap.get(id) ?? 9999) +
        rrfScore(semRankMap.get(id)  ?? 9999) +
        rrfScore(graphRankMap.get(id) ?? 9999) +
        // Signal 4 only contributes when embedding cache is populated
        (hasEmbeddings ? rrfScore(embRankMap.get(id) ?? 9999) : 0),
    }))
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, topK);

  const results = fused
    .map((r, i) => {
      const e = entityMap.get(r.id);
      if (!e) return null;
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(e.metadata ?? "{}"); } catch { /* */ }
      let srcs: string[] = [];
      try { srcs = JSON.parse(e.sourceRegistries ?? "[]"); } catch { /* */ }

      return {
        id: e.id,
        name: e.name,
        type: e.type,
        nationality: e.nationality,
        bayesianScore: e.bayesianScore,
        estimatedNetWorth: e.estimatedNetWorth,
        knownResidences: e.knownResidences,
        isHot: e.isHot,
        notes: e.notes,
        assetCount: assetCounts[e.id] ?? 0,
        assetTypes: assetTypeMap[e.id] ?? [],
        sourceRegistries: srcs,
        metadata: meta,
        scores: {
          bm25:      r.bm25 / maxBm25,
          semantic:  r.semantic,
          graph:     r.graph / maxGraph,
          embedding: r.embedding,
          rrf:       r.rrf,
        },
        rank: i + 1,
      };
    })
    .filter((r) => r !== null) as HybridResult[];

  return {
    results,
    meta: {
      bm25Hits:          bm25Results.length,
      semanticHits:      semanticResults.length,
      embeddingHits:     embeddingResults.length,
      graphHits:         graphSignal.length,
      embeddingCacheSize: getEmbeddingCacheSize(),
      totalCandidates:   candidateIds.length,
      durationMs:        Date.now() - t0,
    },
  };
}
