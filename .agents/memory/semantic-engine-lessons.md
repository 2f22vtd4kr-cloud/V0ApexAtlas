---
name: Semantic Engine (Phase G)
description: all-MiniLM-L6-v2 ONNX embedding engine — config quirks, batch caps, registry normalization
---

# Semantic Engine — Phase G Lessons

## Model loading
- Uses `@huggingface/transformers` WASM backend (not native onnxruntime-node — pnpm blocks native postinstall scripts)
- `env.cacheDir = "/tmp/hf-cache"` — survives container restarts; ~23 MB download on first boot
- Model ready in ~2–3s after first HTTP request triggers warm-up; `isModelLoaded()` tracks state

## Compute-embeddings route fix (critical)
- Original cap was `batchSize max 2000` — caused all calls to silently cap at 2000 regardless of input
- Fixed: cap raised to 50,000; added `offset` param for pagination; `force=false` skips already-cached entities
- To embed all 32k entities: `POST /api/ingest/compute-embeddings` with `{"batchSize": 32000, "force": true}`
- Takes ~8 minutes (32k × ~15ms per embedding)

## Redis persistence
- Key format: `emb:v1:{entityId}` (local Redis, 14-day TTL)
- Loaded back into `_embCache` Map at startup via `loadEmbeddingsFromRedis()`
- As of 2026-07-22 boot: 7,374 embeddings restored from Redis

## Registry prefix normalization (semantic-dedup)
- `sourceRegistries` stores human-readable strings: "FAA Releasable Aircraft Database", "SEC EDGAR — SC 13G", etc.
- NOT the short `faa:N12345` format used for dedup keys
- `registryPrefix()` normalizer in `routes/relationships.ts` maps these to short keys: faa, edgar, hmlr, brreg, ch, gleif, occrp
- Without normalization, all FAA entities group under "FAA Releasable Aircraft Database" → no cross-registry pairs found

## Cross-registry similarity results
- 1,746,938 pairs compared (faa:5045 × hmlr:342 + faa:5045 × edgar:4) → 0 LIKELY_SAME_PERSON edges
- Expected: FAA entities are individual names; HMLR entities are property addresses → low cosine sim
- Expected to find matches when full EDGAR individual dataset is loaded (not just 4 entities)
- Threshold: cosine sim > 0.93 (very strict — prevents false positives)

**Why:** The embedding approach is sound but EDGAR only has ~4 individual entities with embeddings currently (rest are corporate). Value increases as more EDGAR individuals and BRREG/CH entries are ingested.
