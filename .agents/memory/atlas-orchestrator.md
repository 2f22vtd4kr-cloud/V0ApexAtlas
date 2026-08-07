---
name: Atlas orchestrator architecture
description: Full 10-phase investor discovery pipeline — endpoint, phases, options, how to trigger and poll.
---

# Apex Atlas Orchestrator

## Entry point
`POST /api/ingest/atlas-run` — fires all 10 phases in background, returns jobId immediately.
`GET  /api/ingest/atlas-status` — current Atlas job.
`DELETE /api/ingest/atlas-lock` — clear ghost lock.

## Files
- `artifacts/api-server/src/lib/atlas-orchestrator.ts` — `runAtlasPipeline(jobId, opts)` — the full pipeline
- `artifacts/api-server/src/routes/atlas.ts` — HTTP wrappers
- `artifacts/api-server/src/routes/phase-j.ts` — exports `runPhaseJBatch(jobId, batchSize)` for Atlas

## Options (AtlasOptions)
- `targetCount` — western HNWI target (default 15 000)
- `faaMaxRecords` — FAA aircraft max (default 60 000)
- `includeLandRegistry` — UK HMLR OCOD 300MB download (default false)
- `batchSize` — per-entity batch size (default 200)
- `phaseJBatchSize` — Phase J batch (default 50)
- `skipIngestion` — skip Phase 0 if data already imported
- `hotLeadsOnly` — only bayesianScore ≥ 0.5
- `runResearch` — MCTS at end (default true)
- `researchLimit` — max MCTS sessions (default 10)

## 10 Phases
0. FAA (60k) + Western HNWI/EDGAR/CH/BRREG (15k) — PARALLEL
1. OCCRP Aleph + OpenSky live flights + CH Company Officers — PARALLEL
2. CH contact enrichment + OpenOwnership BODS + Foundation filings — PARALLEL
3. Notes population + EDGAR stock assets + live-source markers
4. In-house OSINT: Wikidata, GitHub, RDAP, DNS, Gravatar, ProPublica 990 — concurrency 5
5. Social discovery (LinkedIn/Twitter/Instagram) + Messenger (Telegram) + Broad discovery (new HNWIs from web)
6. AI OSINT: Perplexity + Gemini + Tavily + Exa + Groq → Maigret (3k sites) + Holehe (120 services) → flexible re-run
7. Forensic: ICIJ Offshore Leaks + Whoxy WHOIS + Equasis vessels + ADSB flight history — PARALLEL
8. Phase J (J4-J9): domain resolution + digital footprint + J6 geometric-mean attribution + J7 cooldowns + J8 graph-assisted
9. Semantic embeddings + net worth backfill + contact outcomes + confidence recompute
10. MCTS research on top hot leads (batches of 5, max 5 parallel)

## Key design decisions
**Why:** Manually triggering 30+ separate jobs missed cross-pollination. Orchestrating all in one call enables:
- Phase 0 ingestion → Phase 1 can cross-ref against all fresh data
- Phase 4 in-house → builds domain info that Phase 8 J4 uses
- Phase 6 Maigret handles → feed back into Phase 7 Whoxy WHOIS for domain discovery
- Phase 8 Phase J graph context → built from relationship edges computed across earlier phases

**How to apply:**
- For a fresh DB: run with `skipIngestion: false` (default)
- For re-enrichment only: `skipIngestion: true`
- For fast hot-lead pass: `skipIngestion: true, hotLeadsOnly: true, runResearch: true`
- MCTS runs in batches of 5 (OOM limit); never exceed 5 parallel
