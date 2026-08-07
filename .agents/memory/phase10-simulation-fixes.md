---
name: Phase 10 Simulation Fixes
description: All 11 issues found during full-persona simulation run; fix approaches, one-time migration endpoints, and remaining gaps.
---

## Fixed issues (Phase 10)

### Entity type misclassification (CRITICAL)
- SEC EDGAR 13D/13G filers were ALL tagged `type: "HNWI"` including LPs, funds, corps
- Fix: `classifyEntityType(name)` added to `lib/western-hnwi-ingestion.ts` (exported)
- One-time migration: `POST /ingest/reclassify-entity-types` — ran once, reclassified 22,935 → Corporation, 589 → Trust, 9,476 remain HNWI
- Edge cases NOT caught: "Sofinnova Crossover I" (VC fund, Roman numeral I suffix) — needs name + Roman numeral heuristic for future improvement

### isHot flag propagation (CRITICAL)
- Entities with bayesianScore ≥ 0.70 from SEC EDGAR had `isHot = false` (only FAA jets set it)
- Fix: `POST /ingest/sync-hot-flags` endpoint — ran once, flagged 8,167 entities
- Should be run after any new ingestion pass

### Pitch template null gatekeeper (CRITICAL)
- `"Dear ,"` and `"via )"` when gatekeeper is null
- Fix: `"Dear ${gatekeeper?.label ?? "Sir/Madam"}"` + `pathDesc ? \`(via ${pathDesc})\` : ""`

### Hybrid algorithm branding (HIGH)
- UI called everything "MCTS Terminal" — misrepresents 5-algorithm system
- Renamed: sidebar "Intel Terminal", `UCT_FORMULA` → `HYBRID_PIPELINE` string
- Buttons: "Initialize MCTS" → "Run Analysis"
- Research export renamed `IntelTerminal` (router.tsx updated)
- `algorithmPipeline` field added to `/research/run` response

### Research route — all 5 algorithms now wired (HIGH)
- Was missing: Hybrid Search (BM25+TF-IDF+RRF) and Agent Critique
- Fix: `hybridSearch(targetEntity.name, undefined, 15)` called in research.ts (non-blocking, try/catch)
- Agent Critique: deterministic summary added post-MCTS (not full `orchestrate()` call — too slow)
- `algorithmPipeline` array returned in response, displayed in research.tsx

### Score badge disambiguation (HIGH)
- Two quality metrics with no labels: ScoreBadge (Bayesian) vs confidence breakdown
- Fix: "SIGNAL" label under ScoreBadge on profile header
- "Confidence Breakdown" section renamed to "PROFILE DEPTH"
- Profile INTEL button replaces MCTS button

### CRM empty-state (MEDIUM)
- "Run MCTS on a target" → "Run Intel Analysis" (2 locations in crm.tsx)

### FAA lat/lon (MEDIUM)
- All 30k aviation assets had `latitude: null, longitude: null`
- Fix: `US_STATE_CENTROIDS` map added to `faa-ingestor.ts` (exported)
- One-time backfill: `POST /ingest/sync-faa-coordinates` — ran once: 29,936/30,000 assets now have coordinates (~64 with non-US or unknown state remain null)
- Future FAA ingestions will auto-populate centroid from state field

## Remaining gaps (not code bugs)
- Zero contact vectors: `contactConfidence = 0` for all 33k entities — CH enrichment has never been bulk-triggered. Must run "Companies House Contact Enricher" from Data Sources page.
- Zero relationship edges: depends on CH enrichment producing officer cross-references. Same trigger.
- FAA ~64 non-US/unknown-state aircraft remain without coordinates.

**Why:** Both contact and edge gaps are WORKFLOW gaps not code bugs — the CH enricher exists and works but requires the user to pull the trigger. The Data Sources page prompts for this clearly.
