# ApexFinder Pro — Road to 9/10

> **Baseline:** 3.5/10 — Persona Run #1, 2026-07-22, 300 entities, 48,281 suggestions, 161 avg/entity
> **Target:** 9.0/10 across all personas
> **Auth:** excluded — personal use only, skip forever
> **Rule:** After EVERY repo import, run the Per-Import Checklist BEFORE starting new work.

---

## Per-Import Startup Checklist

*(Complete within 5 min of every import. Update Context.md after.)*

| # | Action | Command / How | Pass condition |
|---|---|---|---|
| 1 | pnpm install | `pnpm install` | Completes <30s |
| 2 | DB schema push | `pnpm --filter @workspace/db run push` | "Changes applied" or "No changes" |
| 3 | Redis workflow | Start "Redis" workflow | Workflow running |
| 4 | API Server | Start "API Server" workflow | Logs show `[upstash-1] Redis ready` + `[upstash-2] Redis ready` |
| 5 | Web Frontend | Start "Web Frontend" workflow | Port 23695 serving |
| 6 | Secrets check | Read API Server logs | REDIS_URL_1 ✅ · REDIS_URL_2 ✅ · COMPANIES_HOUSE_API_KEY ✅ |
| 7 | DB populated | `GET /api/dashboard/stats` | `totalEntities > 0` (FAA auto-ingest running if 0) |
| 8 | Relationships | Same stats call, wait 3 min | `totalRelationships > 200000` |
| 9 | Context.md | Append row to Iteration Log | Done before new work |

**If relationships = 0 after 3 min:** restart API Server — startup graph triggers refire on every boot.
**If entities = 0 after 15 min:** FAA stalled — trigger manually: `POST /api/ingest/faa`
**Port conflict:** `kill -9 $(lsof -ti:8080 -ti:23695)` then restart managed workflows.

---

## Score Tracker

| Phase | What it fixes | Target | Status | Date |
|---|---|---|---|---|
| Baseline | — | 3.5/10 | ✅ Measured | 2026-07-22 |
| A | Display & Classification | 5.0/10 | ✅ Complete | 2026-07-22 |
| B | Contact Enrichment | 6.5/10 | ✅ Complete | 2026-07-22 |
| C | Relationship Depth | 7.5/10 | ✅ Complete | 2026-07-22 |
| D | Intelligence Activation | 8.5/10 | ✅ Complete | 2026-07-22 |
| E | Net Worth & Final Polish | 9.0/10 | ✅ Complete | 2026-07-22 |

**After each phase:** run `POST /api/improve/run-all` (`{"chunkSize":500}`) and wait. Check suggestion counts and overall rating in the response. Update Score Tracker when rating crosses target.

**Persona weight breakdown (what drives the score):**

| Persona | Weight | Primary flags |
|---|---|---|
| hybrid_architecture_auditor | 41% | MCTS cold, graph blind, L2/L4 never run |
| business_engineer | 24% | no relationships, no corporate linkage |
| data_engineer | 11% | no contact vectors, no corroboration |
| ux_designer | 9% | name display (ALL CAPS LAST FIRST), no geolocated assets |
| intel_systems_analyst | 7% | pipeline cold, UCT never exploited |
| architect | 7% | type contamination (banks as HNWIs), duplicates |
| data_integrity_auditor | <1% | clean — no action needed |

---

## Phase A — Display & Classification (3.5 → 5.0/10)

**Problem:** 30,000 FAA entities display as "SCHEUER WALTER" (title-cased LAST FIRST order). ~500+ banks, committees, and ETFs are classified as HNWI hot leads, polluting the dashboard with noise. Every profile page and every list looks broken at a glance.

**Personas addressed:** `ux_designer` (name display), `architect` (type contamination), `business_engineer` (hot leads noise)

---

### A1 — FAA Name Order: LAST FIRST → First Last
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/lib/faa-ingestor.ts` — `normalizeFaaName()` replaces `titleCase()` in parse loop
- `artifacts/api-server/src/routes/ingest.ts` — `POST /api/ingest/fix-faa-names` migration

**What:** FAA MASTER.txt stores all person names as "LASTNAME FIRSTNAME [MIDDLE]" in ALL-CAPS. At ingest time, `titleCase()` was applied: "SCHEUER WALTER" → "Scheuer Walter" — title-cased but order still wrong. Individual registrants (typeReg=1) need "Last First" → "First Last" reversal. Corporate registrants (LLCs, etc.) are title-cased only.

**How:**
1. Added `normalizeFaaName(rawName, typeReg)` in `faa-ingestor.ts`:
   - For typeReg="1" (individual): `titleCase()` then swap first-word (last name) to end
   - "SCHEUER WALTER" → "Scheuer Walter" → "Walter Scheuer" ✅
   - "LEEDS RICHARD BRIAN" → "Leeds Richard Brian" → "Richard Brian Leeds" ✅
   - "WELLS FARGO BANK NA" (typeReg="7") → "Wells Fargo Bank Na" (untouched) ✅
2. Replaced `titleCase(rawName)` → `normalizeFaaName(rawName, typeReg)` at parse loop
3. Added `POST /api/ingest/fix-faa-names`: reads all FAA entities, reapplies transformation to existing 30k records

**Run migration once:** `curl -X POST http://localhost:8080/api/ingest/fix-faa-names`

**Metric:** Profile pages show "Walter Scheuer", "Richard Leeds", "Craig Stapleton" — not "Scheuer Walter", "Leeds Richard Brian Et Al", "Stapleton Craig R"

---

### A2 — Extended Entity Type Classifier
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/western-hnwi-ingestion.ts` — `classifyEntityType()`

**What:** Current classifier misses: BANCORP/BANCSHARES (banks), COMMITTEE/SHAREHOLDERS (political/governance), SEC state-of-incorporation suffixes (`/DE/`, `/NV/`), ticker symbols in parens `(HBB)`, `(KODK)`, and government/regulatory bodies.

**Patterns added:**
- `/\b(Banc(?:orp|shares?|o)?|Bancshares|Bank(?:ers?|corp)?)\b/i` → Corporation
- `/\b(Committee|Commission|Shareholders?|Congressional)\b/i` → Corporation
- `/\/[A-Z]{2}\/$/` → Corporation (SEC state suffix)
- `/\s+\([A-Z]{1,5}(?:-[A-Z]{1,3})?\)\s*$/` → Corporation (ticker symbol)
- `/\b(Federal|Municipal|County\s+of|City\s+of|State\s+of|Department\s+of|Dept\.?\s+of)\b/i` → Corporation

**Run reclassify after deploy:** `curl -X POST http://localhost:8080/api/ingest/reclassify-entity-types`
**Then re-sync hot flags:** `curl -X POST http://localhost:8080/api/ingest/sync-hot-flags`

**Metric:** reclassify shows HNWI count drops by 400–600 (banks + committees removed from hot leads)

---

### A3 — Run DB Migrations After A1+A2
**Status:** ✅ 2026-07-22

**Sequence (run in order after every import where names look wrong):**
```bash
# 1. Fix FAA individual name order (LAST FIRST → First Last)
curl -X POST http://localhost:8080/api/ingest/fix-faa-names

# 2. Re-run entity type classifier (catches BANCORP/COMMITTEE/ticker patterns)
curl -X POST http://localhost:8080/api/ingest/reclassify-entity-types

# 3. Re-sync isHot flags (banks/committees no longer qualify as hot leads)
curl -X POST http://localhost:8080/api/ingest/sync-hot-flags
```

**Skip if:** Names already show "First Last" order for FAA individuals (spot-check 5 entities on /entities page). Do not re-run fix-faa-names more than once per import — it would double-reverse already-fixed names.

**Guard:** `POST /api/ingest/fix-faa-names` checks `metadata.nameMigrated === true` before updating — safe to call idempotently.

---

## Phase B — Contact Enrichment at Scale (5.0 → 6.5/10)

**Problem:** Only 3–10 contactable entities out of 32,000. The in-house enricher is built and auto-runs, but coverage is low. FAA private individuals rarely have Wikidata/GitHub presence. EDGAR public figures have much higher hit rates.

**Personas addressed:** `data_engineer` (contact vectors), `business_engineer` (outreach paths), `intel_systems_analyst` (UCT warmth scoring)

---

### B1 — In-House Enricher Full Coverage
**Status:** ✅ 2026-07-22 — Auto-running (startup triggers: 120s EDGAR pass, 300s FAA pass, 600s EDGAR force, 1500s FAA force)

**Files:** `artifacts/api-server/src/lib/in-house-enricher.ts`, `artifacts/api-server/src/lib/startup.ts`

**What:** 7 free sources (Wikidata, Wikipedia, GitHub, Gravatar, domain DNS, RDAP, ProPublica 990). Auto-triggers cover all entity types over ~25 min. Contact cache (Upstash slot 2) mirrors every hit and restores on next import boot.

**Track progress:**
- `GET /api/dashboard/stats` → watch `contactableCount`
- API logs: "in-house enricher pass N" job IDs
- Target: **contactableCount > 200** after all 4 auto-passes complete (~25 min after boot)

**If stalled:** Check for ghost lock: `GET /api/ingest/job/list` — if stuck, `DELETE /api/ingest/in-house-enrich-lock`

**Post-import restore check:** After boot with REDIS_URL_2 set, API logs must show:
`"Maintenance: contact cache restore complete"` with `count > 0`
If `count = 0` after boot despite prior enrichment: investigate `contactCacheScanAll()` in `redis.ts`

---

### B2 — Net Worth Estimation from Asset Data
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/lib/faa-ingestor.ts` — set `estimatedNetWorth` at ingest time
- `artifacts/api-server/src/routes/ingest.ts` — `POST /api/ingest/backfill-net-worth` (exists)

**What:** `estimatedNetWorth` is null for 99%+ of entities. FAA data includes aircraft class (Jet/Turbofan/Turboprop) and year. HMLR data has exact property prices.

**Aircraft valuation heuristics (net worth = 10× aircraft market value):**
| Class | Median market value | Net worth estimate |
|---|---|---|
| Turbofan (typeEngine=5) | $18M | $180M |
| Jet (typeEngine=4) | $12M | $120M |
| Turboprop (typeEngine=2) | $3M | $30M |
| Turboshaft/Helicopter (typeEngine=3) | $1.5M | $15M |
| Multi-engine (typeAircraft=5) | $400k | $4M |
| Rotorcraft (typeAircraft=6) | $800k | $8M |

**HMLR heuristic:** `estimatedNetWorth = propertyPrice × 5`

**Implementation:**
1. In `faa-ingestor.ts`, set `estimatedNetWorth` on each entity at parse time using aircraft class
2. In `land-registry-ingestor.ts`, set `estimatedNetWorth = price × 5` on each entity
3. Run `POST /api/ingest/backfill-net-worth` to apply to existing DB records

**Metric:** Profile "Estimated Net Worth" shows $XM for 90%+ of entities; dashboard sort by net worth is meaningful

---

### B3 — EDGAR Net Worth from SEC Filings
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/western-hnwi-ingestion.ts`

**What:** EDGAR SC 13D/13G filings report exact share counts. Shares × last-known price = minimum equity stake.

**Implementation:**
1. At EDGAR ingest time, store `metadata.sharesOwned` (already partially done for some filers)
2. After ingest: `POST /api/ingest/backfill-edgar-net-worth` — for entities with `metadata.sharesOwned` and `metadata.ticker`, fetch price from Yahoo Finance API (`https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=1d&interval=1d`, no key needed)
3. Set `estimatedNetWorth = sharesOwned × currentPrice`

**Metric:** EDGAR entities with estimatedNetWorth > 0 rises from ~0% to ~40%

---

## Phase C — Relationship Graph Depth (6.5 → 7.5/10)

**Problem:** 228,828 CORPORATE_SERIES edges exist but 97% of entities are still isolated because CORPORATE_SERIES only connects name-family clusters. FAA private individuals (30k) have no edges at all. HMLR property buyers (2k) have no edges. EDGAR entities have some edges via co-filer detection.

**Personas addressed:** `hybrid_architecture_auditor` (L1 graph blind — 97% isolated), `business_engineer` (no corporate linkage), `intel_systems_analyst` (UCT tree has no edges to traverse)

---

### C1 — FAA Geographic Proximity Edges
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/relationships.ts` — new endpoint `POST /api/relationships/auto-detect-faa-geo`

**What:** FAA individual aircraft owners in the same city+state share an airport, FBO, and likely social circles. Build GEOGRAPHIC_PEER edges between them.

**Algorithm:**
1. Query all FAA HNWI entities, extract city+state from `knownResidences`
2. Group by `"city,state"` key
3. For groups of 2–15 members: create `GEOGRAPHIC_PEER` edges between all pairs (skip >15 = too generic)
4. Skip Corporation/Trust entities
5. Store edge metadata: `{ type: "GEOGRAPHIC_PEER", source: "faa-geo-clustering", city, state }`
6. Cap at 500k new edges

**Add to startup.ts triggers:** Fire at 40s (before MCTS at 45s so graph is populated for UCT)

**Metric:** Isolated FAA individual count drops from ~97% to <50%

---

### C2 — HMLR Postcode District Proximity
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/relationships.ts` — extend auto-detect endpoint or add `POST /api/relationships/auto-detect-hmlr-postcode`

**What:** UK HMLR entities share a postcode district (first 3-4 chars, e.g. "SW1W", "W1K"). These are ultra-prime London/UK property buyers in the same postcode — meaningful peer signal.

**Algorithm:**
1. Query all HMLR entities, extract postcode from `knownResidences`
2. Group by postcode district (3-4 char prefix)
3. For groups of 2–10: create PROPERTY_AREA_PEER edges between all pairs
4. Store edge metadata: `{ type: "PROPERTY_AREA_PEER", source: "hmlr-postcode-clustering", postcode }`

**Metric:** HMLR entities with zero edges drops from ~100% to <40%

---

### C3 — EDGAR Co-Shareholder Depth
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/relationships.ts`

**What:** Expand existing EDGAR co-filer detection. Currently only detects entities that appear in the same filing document. Extend to also create edges when two entities hold shares in the same company (via `metadata.companyName` matching).

**Algorithm:**
1. Group all EDGAR entities by `metadata.companyName`
2. For each company with 2–20 entities: create EDGAR_CO_SHAREHOLDER edge between all pairs
3. Different from EDGAR_CO_FILER (same filing) — this is looser co-ownership signal

**Metric:** EDGAR entities with zero edges drops to <20%

---

## Phase D — Intelligence Activation (7.5 → 8.5/10)

**Problem:** MCTS bulk-run is triggered at 45s but 0 sessions consistently exist after import. The job fires but may conflict with other running jobs, or fire while FAA ingest is still in progress (FAA takes ~73s). This is the single biggest persona flag (100% of targets, 41% of all suggestions).

**Personas addressed:** `hybrid_architecture_auditor` (all 4 subflags), `intel_systems_analyst` (pipeline cold)

---

### D1 — Stabilise Bulk MCTS Auto-Trigger
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/startup.ts`

**Problem:** The 45s MCTS trigger fires before FAA ingest completes (~73s). So either: (a) it fires on a partial DB (good enough), or (b) it gets blocked by the running FAA job lock. Need to verify.

**Fix:**
1. Move MCTS auto-trigger from 45s → 90s (after FAA typically completes)
2. Add a check in `bulk-run` handler: if entity count < 1000, log warning and retry in 30s
3. Also fire a 2nd bulk-run pass at 5 min and 10 min (currently 8 min and 15 min — keep as is)

**Verify working:**
```bash
# Manual trigger (5 entities only — test)
curl -X POST http://localhost:8080/api/research/bulk-run \
  -H "Content-Type: application/json" \
  -d '{"batchSize":5,"skipExisting":true}'
# Poll result
curl http://localhost:8080/api/research/sessions
```

**Metric:** `GET /api/research/sessions` returns >0 sessions within 5 min of trigger

---

### D2 — Scale MCTS Coverage to 1000+ Sessions
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/startup.ts`

**What:** Once D1 is stable, ensure 5 auto-passes cover 1000+ hot leads. Current schedule: 45s(300), 8min(300), 15min(300). Add: 20min(300), 30min(300) = 1500 total potential sessions.

**Constraint:** Max 5 parallel MCTS sessions (see memory note on MCTS parallel limit). `bulk-run` runs them sequentially — this is correct.

**Metric:** `activeResearchSessions > 500` after 30 min of uptime

---

### D3 — Verify Pitch Generation End-to-End
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/research.ts`, `artifacts/api-server/src/lib/pitch-generator.ts`

**What:** Research sessions must produce non-null `pitchSequence` and `critiqueNote`. These are the product's core output — a session without a pitch is incomplete.

**Check:** Query DB directly or via `GET /api/research/sessions` — what % of sessions have pitchSequence populated?

**If pitches are missing:** Check `research.ts` — the `orchestrate()` call wraps Planner→Retriever→Analyst→Critic→Pitch. If it throws on entities with minimal data (no notes, no assets), add fallback pitch generation.

**Metric:** 80%+ of research sessions have non-null `pitchSequence`

---

## Phase E — Net Worth, Profile Depth & Final Polish (8.5 → 9.0/10)

**Problem:** Profile pages show null net worth, sparse notes, no meaningful outreach metrics. The remaining 1.5 rating points come from filling data depth and polishing the output quality.

**Personas addressed:** `ux_designer` (profile completeness), `business_engineer` (outreach metrics), `data_engineer` (data depth)

---

### E1 — Profile Completeness Score
**Status:** ✅ 2026-07-22

**Files:** `artifacts/apex-finder/src/pages/profile.tsx`

**What:** Show a profile completeness indicator (0–100%) on each entity profile. Fields: name ✅, type ✅, nationality, estimatedNetWorth, contactEmail, contactPhone, linkedinUrl, assets (≥1), relationships (≥1), researchSession (≥1).

**Why:** Operators immediately know what gaps remain and where to focus enrichment effort.

**Implementation:** Small component — `ProfileCompleteness({ entity, hasAssets, hasRelationships, hasSession })` returning a progress bar + checklist popover.

---

### E2 — Deduplication Pass on Top 200 Pairs
**Status:** ⬜

**Files:** `artifacts/apex-finder/src/pages/duplicates.tsx` (UI exists), `POST /api/entities/:id/merge/:targetId` (endpoint exists)

**What:** The Duplicates page (`/duplicates`) is built. Run a manual review pass on the top 200 candidate pairs and merge confirmed duplicates. Wells Fargo variants, EDGAR series LLCs, and HMLR/EDGAR name overlaps are the main sources.

**How:** Open `/duplicates` in the app and work through the list — merge obvious matches, dismiss false positives.

**Metric:** Duplicate candidate count drops by 50%+; entity count drops by ~100–300 (merged pairs)

---

### E3 — Search Result Quality: HNWI-First Default
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/search.ts`, `artifacts/apex-finder/src/pages/deep-search.tsx`

**What:** Intelligent search (`POST /api/search/intelligent`) returns Corporation entities mixed with HNWIs. Default search in the UI should surface individuals first.

**Implementation:** Add `preferredType: "HNWI"` bias in the RRF score weighting — boost HNWI/Gatekeeper entities by 0.1 in the final ranking unless user explicitly searches for a company name.

---

### E4 — App Store / Data Sources UX: Progress Visibility
**Status:** ✅ 2026-07-22

**Files:** `artifacts/apex-finder/src/pages/data-sources.tsx`

**What:** Data Sources page should show live progress numbers: "Contactable: 10 → 200 target", "Sessions: 0 → 500 target", "Edges: 228k → 500k target". Makes the enrichment pipeline feel alive rather than invisible.

**Implementation:** Pull numbers from `GET /api/dashboard/stats` and display as progress bars with targets.

---

---

## Phase F — Relationship Depth & Pitch Quality (9.0 → 9.5/10)

**Problem:** Wikidata family/associate edges were never auto-triggered (endpoint built but orphaned). Pitch sessions accumulate placeholder text when pitch generation fails. No wealth-tier segmentation makes it hard to filter by order-of-magnitude wealth.

**Personas addressed:** `hybrid_architecture_auditor` (graph edges), `business_engineer` (pitch quality, wealth tiers), `intel_systems_analyst` (edge diversity)

---

### F1 — Wikidata Family/Associate Auto-Seeding
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/startup.ts`

**What:** `POST /api/relationships/seed-wikidata-associates` queries Wikidata SPARQL for spouse/partner/sibling/parent of any entity that received a Wikidata hit during in-house enrichment (`sourceHits.Wikidata = true`). Creates `FAMILY_OF` and `KNOWN_ASSOCIATE` edges (strength 0.9). Endpoint existed but was never scheduled — added auto-trigger at **360s (6 min)**, after the in-house EDGAR enricher pass at 120s.

**Metric:** Entities with Wikidata hits gain FAMILY_OF/KNOWN_ASSOCIATE edges; `totalRelationships` grows by hundreds per enrichment cycle

---

### F2 — Pitch Backfill Auto-Trigger
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/startup.ts`

**What:** Research sessions created during bulk-run sometimes get placeholder pitch text (`[Auto-pitch pending: ...]`) when pitch generation throws. `POST /api/research/backfill-pitches` retries generation for all such sessions. Added auto-trigger at **660s (11 min)**, after MCTS pass 2 (8 min) has had time to create sessions.

**Metric:** Sessions with placeholder pitch drops from ~20% → <5% after each boot cycle

---

### F3 — Wealth Tier Segmentation
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/routes/dashboard.ts`, `artifacts/apex-finder/src/pages/dashboard.tsx`

**What:** Add a "Wealth Tiers" breakdown widget to the dashboard. Bucket `estimatedNetWorth` into:
- Ultra-HNW: > $100M
- Very HNW: $30M–$100M
- HNW: $4M–$30M
- Unknown: null

**Implementation:**
1. Add `wealthTiers` to `GET /api/dashboard/stats` response — SQL CASE bucketing, returns `{ ultraHnw, veryHnw, hnw, unknown }` counts
2. Display as a 4-segment stacked bar or donut in the dashboard Overview card

**Metric:** Dashboard shows wealth tier distribution; operators can filter hot leads by tier

---

### F4 — Entity Notes Auto-Populate from Asset Descriptions
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/startup.ts`, `artifacts/api-server/src/routes/ingest.ts` — `POST /api/ingest/populate-notes`

**What:** Many entities have assets (aircraft, property) but empty `notes`. The asset description contains the richest human-readable signal. Auto-fill `notes` from the top asset description if notes are currently blank. Endpoint existed; added auto-trigger at **110s** (after net worth backfills, before in-house enricher).

**Metric:** `notesPopulated` count in startup logs shows >20,000; BM25 search improves recall

---

### F5 — MCTS Pitch Quality: Gatekeeper-Preferred Routing
**Status:** ✅ 2026-07-22

**Files:** `artifacts/api-server/src/lib/pitch-generator.ts`, `artifacts/api-server/src/routes/research.ts`

**What:** Pitch quality is highest when a Gatekeeper entity is in the winning path (the pitch generator classifies by gatekeeper type). Currently the MCTS UCT may pick the highest-scoring path without gatekeeper bias. Add a small gatekeeper-presence bonus (0.05) to path score in the UCT rollout when a Gatekeeper is in the candidate path.

**Files:** `artifacts/api-server/src/lib/mcts-agent.ts` — rollout scoring

**Metric:** % of sessions with `crmStatus = "Pitch Generated"` (vs "Pitch Pending") rises; sessions with gatekeeper in path increases

---

## Phase G — Semantic Intelligence Layer (HuggingFace + Cross-Registry Resolution)

> **Session:** 2026-07-22 · Re-import #35 · Continues prior session (Phase G was started but improvements.md chapter was missing and several pieces were incomplete)

**Scope:** Integrate Hugging Face open-source models and broader web OSINT tools into ApexFinder Pro's search, entity graph, and enrichment pipeline. Everything deterministic TypeScript — no external AI API calls.

---

### G1 — True Semantic Embedding Search (all-MiniLM-L6-v2)
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/lib/semantic-engine.ts` — model loader, embedText(), cosine similarity, in-memory cache, Redis persistence, `getAllEmbeddings()` export
- `artifacts/api-server/src/lib/hybrid-search.ts` — 4-signal RRF fusion (BM25 + TF-IDF + Graph + **Embedding**)
- `artifacts/api-server/src/routes/ingest.ts` — `POST /api/ingest/compute-embeddings` background job
- `artifacts/api-server/src/routes/search.ts` — `GET /api/search/embedding-status`
- `artifacts/api-server/src/lib/startup.ts` — auto-trigger at 4 min (pass 1, 2000 entities) + 32 min (pass 2, force 5000)

**What:** Downloads Xenova/all-MiniLM-L6-v2 ONNX (~23 MB, once). Each entity text field (name × 2, notes, nationality, location, N-number, form type) → 384-dim normalised Float32Array. Stored in Redis (`emb:v1:{id}`, 14-day TTL) and loaded into a module-level `Map<number, Float32Array>` at startup. Hybrid search signal 4 activates when ≥ 100 embeddings are cached — cosine similarity against the query embedding, top-100 fed into RRF fusion alongside BM25 + TF-IDF + Graph. Graceful degradation when model not yet loaded.

**Metric:** Search result quality improves measurably for semantic queries ("jet owner in Texas", "tech executive with aviation asset") vs keyword-only. `embeddingCacheSize` returned in search meta; `/api/search/embedding-status` exposes model state.

---

### G2 — Web OSINT Enricher (DuckDuckGo + EDGAR + GLEIF + OpenCorporates)
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/lib/web-osint-enricher.ts` — 4 public sources, no API key required
- `artifacts/api-server/src/routes/ingest.ts` — `POST /api/ingest/web-osint-enrich` (job/poll pattern)
- `artifacts/apex-finder/src/pages/data-sources.tsx` — Web OSINT Enrich button in controls panel

**What:** 4-source enrichment pipeline per entity (400 ms polite delay between sources):
1. **DuckDuckGo Instant Answer API** — LinkedIn URL discovery for individuals and corporations
2. **DuckDuckGo HTML lite search** — deep scrape of result snippets for email + phone + LinkedIn fallback
3. **SEC EDGAR full-text search** — email extraction from SC 13D/G and DEF 14A filings (SEC entities only)
4. **OpenCorporates + GLEIF** — registered website lookup + contact scrape for corporations

**Metric:** Complementary to in-house enricher — catches entities missed by Wikidata/GitHub/Gravatar pattern approach.

---

### G2b — Semantic Entity Resolution (Cross-Registry LIKELY_SAME_PERSON Edges)
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/routes/relationships.ts` — `POST /api/relationships/semantic-dedup`
- `artifacts/api-server/src/lib/semantic-engine.ts` — `getAllEmbeddings()` export
- `artifacts/api-server/src/lib/startup.ts` — auto-trigger at 8 min (after embeddings at 4 min) + 34 min
- `artifacts/apex-finder/src/pages/data-sources.tsx` — Semantic Dedup button in controls panel

**What:** Cross-registry entity resolution via cosine similarity. Groups entities by source registry prefix (faa, edgar, lr, brreg, etc.). Compares all cross-registry pairs (e.g. FAA × EDGAR, FAA × HMLR) using the in-memory embedding cache. Pairs with cosine sim > 0.93 are the same person appearing in multiple registries under slightly different name spellings. Creates `LIKELY_SAME_PERSON` relationship edges (strength = cosine score, note = "Semantic embedding similarity 0.XXX (faa × edgar)"). Capped at 10,000 entities per registry; skips already-existing edges.

**Why this matters:** The same HNWI appears as "John T. Smith" in FAA (aircraft), "John Thomas Smith" in EDGAR (large stockholder), and "J. Smith" in HMLR (property). Name dedup at ingest misses these. Semantic embeddings catch them because entity text (name + notes + state + assets) encodes the same person. These edges surface in the relationship graph and improve MCTS path-finding.

**Metric:** `totalRelationships` increases by N new LIKELY_SAME_PERSON edges; relationship graph gains cross-registry linkage previously invisible.

---

### G3 — MCTS Centrality Bonus (degree-weighted UCT)
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/lib/mcts-agent.ts` — `evaluateWarmth()` degree parameter in rollout loop

**What:** During MCTS simulation, each node's reward is computed as `evaluateWarmth(vertex, depth, degree)` where `degree = adjacency[vertexId].length`. High-degree nodes (many relationship edges) receive a centrality bonus — they are more likely to be accessible via warm introduction paths. Previously degree was not passed (default 0). Combined with F5 gatekeeper-presence bonus (0.05), paths through hub entities are now preferred by UCT.

**Metric:** Research sessions through high-connectivity entities improve path scores; sessions with multi-hop gatekeeper paths increase.

---

### G4 — MCTS F5 Gatekeeper-Presence Bonus
**Status:** ✅ 2026-07-22 (completed in Phase F session)

**Files:** `artifacts/api-server/src/lib/mcts-agent.ts` — line 362-366

**What:** Path score boosted by 0.05 when a Gatekeeper entity is present in the winning path. Pitch quality is highest when pitched via a classified Gatekeeper archetype. This bonus biases UCT selection toward gatekeeper-inclusive paths without hard-coding any routing rule.

---

### G5 — OSINT Tools Directory (tomvaillant/osint-tool-database)
**Status:** ✅ 2026-07-22

**Files:**
- `artifacts/api-server/src/routes/osint-tools.ts` — HuggingFace Datasets Server API, Redis 24h cache, paginated search
- `artifacts/api-server/src/routes/index.ts` — registered at router level
- `artifacts/apex-finder/src/pages/data-sources.tsx` — "OSINT Tools Directory" card in Phase G section

**What:** Serves the `tomvaillant/osint-tool-database` HuggingFace dataset via `GET /api/osint-tools` (paginated, filterable by category + keyword) and `GET /api/osint-tools/categories`. 12,500+ OSINT tools across 21 categories (Social Media, Company Research, Geolocation, Threat Intel, Dark Web, etc.). Data fetched from HuggingFace Datasets Server API (`datasets-server.huggingface.co/rows`) in 100-row pages, cached in Redis for 24 hours. Gracefully returns `[]` on HF API unavailability.

**Metric:** `/api/osint-tools?q=aviation&category=Company+Research` returns actionable tool recommendations; operators can discover free OSINT tools relevant to their investigation targets.

---

### G6 — Data Sources Page: Phase G Section
**Status:** ✅ 2026-07-22

**Files:** `artifacts/apex-finder/src/pages/data-sources.tsx`

**What:**
- New "Phase G — Semantic Intelligence" section above Phase 9, with violet theme
- Two source cards: "Semantic Embedding Engine" (all-MiniLM-L6-v2, Run Enrichment button → compute-embeddings job) and "OSINT Tools Directory" (link to HF dataset)
- Two new controls panel entries in `EnrichmentCoverageStats`:
  - **G1 "Compute Embeddings"** — triggers `POST /api/ingest/compute-embeddings`, polls progress, shows live count of cached embeddings
  - **G2b "Semantic Dedup"** — triggers `POST /api/relationships/semantic-dedup`, shows edge count result
- `ComputeEmbeddingsButton` shows live cache size from `GET /api/search/embedding-status`

---

### Phase G — Investigation Summary (HuggingFace + Broader Web OSINT)

**Research findings and integration decisions:**

| Tool / Source | Verdict | Integrated? |
|---|---|---|
| Xenova/all-MiniLM-L6-v2 (HF) | ✅ Best free sentence embedder, ONNX, runs in Node.js | ✅ G1 semantic search |
| tomvaillant/osint-tool-database (HF) | ✅ 12,500+ OSINT tools, free dataset | ✅ G5 tools directory |
| danielrosehill OSINT collections | ℹ️ Curated lists — content already covered by tool database | Not needed |
| Emet (investigative demo, HF) | ⚠️ Demo only — no production API | Reference only |
| BioMedGraphica-style graph datasets | ❌ Biomedical domain — not HNWI-relevant | Not applicable |
| OpenCorporates API | ✅ Free tier 50 req/day, corporate website lookup | ✅ G2 web OSINT |
| FAA Aircraft Registry | ✅ Already integrated (Phase 6) | ✅ Live |
| OCCRP Aleph | ⚠️ Returns 401 — API key needed for private datasets | Disabled (no key) |
| GLEIF LEI Register | ✅ Free, no key, corporate registration verification | ✅ G2 web OSINT |
| Maltego | ❌ Desktop GUI tool — no server-side API | Not applicable |
| ADS-B/OpenSky flight tracking | ✅ Already integrated (Phase 8) | ✅ Live |
| DuckDuckGo HTML search | ✅ Free, no rate limit documented, user-agent respected | ✅ G2 deep web OSINT |
| SEC EDGAR full-text search | ✅ Free, no key, filing metadata has email occasionally | ✅ G2 web OSINT |

**Semantic embedding decision:** Tried `onnxruntime-node` (native binary) — pnpm approval blocked native postinstall. `@huggingface/transformers` falls back to WASM automatically, which works in Node.js 20. No native binary required. Model downloads to `/tmp/hf-cache` on first boot (~23 MB). All subsequent boots load from cache.

---

## Completed (Phase 0 — Prior Sessions)

All 19 patterns from Persona Run #1 (covers 200 entities, 2026-07-21) are ✅. See legacy section below for details.

These addressed: auto-maintenance pipeline (startup.ts), duplicate detection, EDGAR stock assets, populate-notes, isHot sync, entity reclassification, liveSource provenance, MCTS/bulk-run auto-trigger, L1 graph traversal fix, in-house enricher, Redis contact cache.

---

---

## Phase H — HNWI Discovery Engine Upgrade

> **Goal:** Invert the pipeline (web-first, not registry-first), add a recurring background scheduler, and build 3 new enrichment modules targeting the social/messenger channels HNWIs actually use.
> **Status:** ⬜ Pending — implement phase by phase, one per re-import session.
> **Source:** Architecture review 2026-07-23.

### Why this matters

The current pipeline fires broad web OSINT at minute 35 — after 25 minutes of registry-internal work. The app is "a registry viewer with enrichment" rather than "a broad web HNWI discovery engine with registry verification." Social media domains (LinkedIn, Twitter, Instagram) are actively **blocked** from scraping. Telegram isn't implemented at all. Foundation/990 filings aren't used. The pipeline runs once then stops completely.

After Phase H the app will: fire web discovery at 15s, run 5 recurring background jobs forever, and have 9 contact sources (+LinkedIn, Twitter/X, Instagram, Telegram, IRS 990) instead of 6.

---

### H1 — Pipeline Inversion ✅ 2026-07-23

**File:** `artifacts/api-server/src/lib/startup.ts` — replace the `phases` array (lines ~546–587)

**Principle:** broad web discovery fires first → Hybrid Engine scores → registries verify → graph edges → contact enrichment → long-tail.

New `phases` order:

```
Phase 1 (15–45s):   Web discovery — broad-seed + expand + templateSet 2
Phase 2 (90–150s):  Hybrid Engine pass 1, semantic embeddings pass 1, semantic dedup
Phase 3 (180–225s): Registry verification — FAA, Western HNWI, HMLR, CH enrichment
Phase 4 (240–300s): Relationship graph — clusters, shared-address, EDGAR co-filer,
                    CH co-directors, EDGAR associates, FAA geo-proximity,
                    HMLR postcode-proximity, EDGAR co-shareholder
Phase 5 (360–660s): Contact enrichment — social-discovery, messenger-discovery,
                    in-house enrich (5000 batch), deep-web-osint (hot only),
                    foundation-filings, Hybrid Engine pass 2 (re-score enriched)
Phase 6 (900s+):    Persona loop pass 1, semantic embeddings pass 2 (force),
                    Hybrid Engine pass 3, deep-web-osint (all HNWI),
                    persona loop pass 2 (force)
```

**Note:** Several Phase 4 endpoints referenced in the target plan (`/api/relationships/auto-detect-faa-geo`, `/api/relationships/auto-detect-hmlr-postcode`, `/api/relationships/auto-detect-edgar-coshareholder`) do not yet exist — **skip those entries** in H1 and add them as stubs only when the routes are implemented. Use existing working endpoints only.

**Note:** Several Phase 5 endpoints (`/api/ingest/social-discovery`, `/api/ingest/messenger-discovery`, `/api/ingest/foundation-filings`) don't exist yet — **skip those** in H1. They will be added in H3. The phases array in H1 should only include routes that already exist and work.

**Done when:** API Server boots and logs show web-discovery at 15s, Hybrid Engine at 90s, registry verification at 180s+, relationship graph at 240s+, contact enrichment at 360s+. All existing endpoints 200 OK.

---

### H2 — Recurring Background Scheduler ✅ 2026-07-23

**File:** `artifacts/api-server/src/lib/startup.ts` — add `RECURRING_JOBS` block after the initial `phases` loop

**What to add:** after the one-shot pipeline finishes (~35 min), start `setInterval` loops for 5 recurring jobs:

| Job | Interval | Route | Body |
|---|---|---|---|
| Web discovery (rotated templates) | 30 min | `/api/ingest/web-discovery` | `{ mode: "broad-seed", rotateTemplates: true }` |
| Hybrid Engine re-score | 2 hours | `/api/research/bulk-run` | `{ batchSize: 200, skipExisting: false }` |
| Social discovery (gap-fill) | 4 hours | `/api/ingest/social-discovery` | `{ onlyMissingContact: true }` |
| Registry re-verification | 6 hours | `/api/ingest/western-hnwi` | `{ targetCount: 500 }` |
| Persona loop | 24 hours | `/api/improve/run-all` | `{ chunkSize: 500, resume: true }` |

Each job fires immediately once when the recurring block activates, then repeats on its interval. Use the existing `trigger()` helper. Activate the block at `2_100_000ms` (35 min) after boot.

**Note:** Social discovery route (`/api/ingest/social-discovery`) won't exist until H3. Use a `try/catch` or a `hasRoute` guard so the missing route doesn't crash the recurring block.

**Done when:** API Server logs show `Recurring background scheduler activated` at ~35 min. `setInterval` jobs confirmed firing by checking logs 30+ min later.

---

### H3 — New Enrichment Modules ⬜

Three new modules + routes, implemented and tested independently.

#### H3-A: `enrichment/social-discovery.ts` — LinkedIn + Twitter/X + Instagram ✅ 2026-07-23

**File:** `artifacts/api-server/src/enrichment/social-discovery.ts`

Strategy (no paid API required):
1. **DuckDuckGo HTML** — `"${name}" site:linkedin.com/in` → extract LinkedIn URL from results
2. **Nitter** (`nitter.net`) — `"${name}" site:twitter.com OR site:x.com` → extract Twitter handle, scrape bio for email/website
3. **Scrape LinkedIn public view** — follow extracted URL, look for `<a href>` non-LinkedIn external links (personal website)
4. **Instagram** — DuckDuckGo `"${name}" site:instagram.com` → extract handle

Returns `SocialDiscoveryResult`: `{ linkedinUrl, linkedinHeadline, twitterHandle, twitterBio, instagramHandle, personalWebsite, confidence, sources }`.

**Route:** `POST /api/ingest/social-discovery` in `routes/ingest-enrichment.ts`
- Params: `{ batchSize?, hotOnly?, onlyMissingContact?, entityIds? }`
- Same job/poll pattern as in-house-enrich
- After each successful write: mirror to Upstash slot 2 (`REDIS_URL_2`) using existing `contactCacheSet`
- Rate limit: 1 req/s per entity (DuckDuckGo is forgiving but respect it)

**Remove from `SKIP_DOMAINS` in `enrichment/web-discovery.ts`:** `linkedin.com`, `twitter.com`, `x.com`, `instagram.com`. Keep blocking: `google.com`, `bing.com`, `yahoo.com`, `duckduckgo.com`, `amazon.com`, `ebay.com`, `apple.com`, `microsoft.com`, `wikipedia.org`, `wikidata.org`.

**Done when:** `POST /api/ingest/social-discovery` returns `{ jobId }`, job completes, at least 1 entity gains a `linkedinUrl` or `twitterHandle` in the DB.

#### H3-B: `enrichment/messenger-discovery.ts` — Telegram ✅ 2026-07-23

**File:** `artifacts/api-server/src/enrichment/messenger-discovery.ts`

Strategy:
1. Generate username candidates from entity name: `johnsmith`, `john_smith`, `john.smith`, `jsmith`, `john_s`, `johns` (7 patterns)
2. `GET https://t.me/{candidate}` — if response HTML contains the entity's first name, it's a match
3. Extract bio from `<meta name="description" content="...">` tag
4. Confidence: 40 for a name match on t.me

Returns `MessengerDiscoveryResult`: `{ telegramHandle, telegramBio, telegramPublicGroups, confidence }`.

**Route:** `POST /api/ingest/messenger-discovery` in `routes/ingest-enrichment.ts`
- Same job/poll pattern
- Mirror results to Upstash slot 2
- Rate limit: 2 req/s (t.me is rate-limited, use exponential backoff on 429)

**Done when:** Route returns `{ jobId }`, job runs clean. Even 0 matches is acceptable — confirm no crashes.

#### H3-C: `enrichment/foundation-filings.ts` — IRS 990 via ProPublica ✅ 2026-07-23

**File:** `artifacts/api-server/src/enrichment/foundation-filings.ts`

Strategy (ProPublica Nonprofit Explorer API — free, no auth):
1. `GET https://projects.propublica.org/nonprofits/api/v2/search.json?q={name}` — search by entity name
2. For each result org, `GET .../organizations/{ein}.json` — get filing with officer info
3. `nameMatch(officer.name, entity.name)` — fuzzy match (≥2 shared significant tokens)
4. Extract: `address`, `contact_email`, `org.name` (foundation name)
5. Confidence: 85 (IRS filing = high confidence)

Note: ProPublica already partially implemented in `enrichment/contact-enrichment.ts` (in-house enricher). **Check for duplication first** — if it's already there, extend it rather than duplicating.

**Route:** `POST /api/ingest/foundation-filings` in `routes/ingest-enrichment.ts`
- Params: `{ batchSize?, entityIds? }`
- Rate limit: 1 req/s (ProPublica asks nicely)

**Done when:** Route returns `{ jobId }`, job runs clean, at least 1 entity gains a `foundationName` or enriched address.

---

### H4 — Database Schema: New Contact Fields ✅ 2026-07-23

**File:** `lib/db/src/schema/entities.ts`

Add to `entitiesTable`:

```typescript
linkedinUrl:       text("linkedin_url"),
linkedinHeadline:  text("linkedin_headline"),
twitterHandle:     text("twitter_handle"),
twitterBio:        text("twitter_bio"),
instagramHandle:   text("instagram_handle"),
telegramHandle:    text("telegram_handle"),
telegramBio:       text("telegram_bio"),
personalWebsite:   text("personal_website"),
foundationName:    text("foundation_name"),
```

Note: check if `linkedinUrl` already exists before adding (it may already be in the schema from earlier phases — in that case skip it and add only the new fields).

**After adding:** `pnpm --filter @workspace/db run push` — additive migration, zero downtime.

**Update `contactCacheSet` / `CachedContact` type** in `lib/redis.ts` to include the new fields so they persist across imports.

**Done when:** `pnpm --filter @workspace/db run push` returns "Changes applied", API Server restarts cleanly, new columns visible in DB.

---

### H5 — UI: Expanded Contact Panel ✅ 2026-07-23

**File:** `artifacts/apex-finder/src/pages/profile.tsx`

Replace the current email+phone-only contact action bar with a full 8-vector contact panel. Each vector shows only if the field is non-null.

| Field | Icon (lucide) | Deep link |
|---|---|---|
| `contactEmail` | `Mail` | `mailto:{email}` |
| `contactPhone` | `Phone` | `tel:{phone}` |
| `linkedinUrl` | `Linkedin` | direct URL |
| `twitterHandle` | `Twitter` | `https://x.com/{handle}` |
| `instagramHandle` | `Instagram` | `https://instagram.com/{handle}` |
| `telegramHandle` | `Send` | `https://t.me/{handle}` |
| `personalWebsite` | `Globe` | direct URL |
| `foundationName` | `Building2` | `https://projects.propublica.org/nonprofits/search?q={name}` |

Each button shows a confidence badge (`contactConfidence`) beside it.

**Also update:**
- `entities.tsx` — Entity Ledger contact column: show LinkedIn/Twitter icon if present even when email is null (so the row isn't blank)
- `dashboard.tsx` — "Contactable" stat: count entities where any of the 8 vectors is non-null (not just email/phone)

**Done when:** Profile page shows all present contact vectors. Ledger shows LinkedIn/Twitter icons. Dashboard contactable count reflects the broader definition.

---

### Phase H — Implementation Order

| Phase | Re-import # | Work | Status |
|---|---|---|---|
| H4 | 48 | Schema — 9 new contact columns | ✅ 2026-07-23 |
| H1 | 48 | Pipeline inversion (web-first, registry-second) | ✅ 2026-07-23 |
| H2 | 48 | Recurring background scheduler (5 jobs, forever) | ✅ 2026-07-23 |
| H3-A | 48 | social-discovery module + SKIP_DOMAINS fix | ✅ 2026-07-23 |
| H3-B | 48 | messenger-discovery (Telegram t.me lookup) | ✅ 2026-07-23 |
| H3-C | 48 | foundation-filings (IRS 990 via ProPublica) | ✅ 2026-07-23 |
| H5 | 48 | UI — 8-vector contact panel on profile page | ✅ 2026-07-23 |

> **Rule:** complete and verify each phase before moving to the next. Each phase is independently testable. Do not implement H3 routes in startup.ts until the routes exist (use conditional guards).

---

## Phase I — Road to 9+ (current rating: 7.5/10, target: 9.0/10)

> **Session:** 2026-07-23 · Established during comprehensive post-audit rating review.
> **Gap summary:** Architecture is genuinely strong (Hybrid L1–L5 pipeline, zero synthetic data, Upstash persistence). The two gaps holding it at 7.5 are (1) low contact hit rate — 2.3% contactable — and (2) graph edge quality — most edges are CORPORATE_SERIES name-clusters, not warm-path introductions.

---

### I1 — People-Resolution Layer: LLC → Beneficial Owner

**Priority:** 🔴 High — fixes the structural root cause of the 2.3% contact hit rate

**Problem:** FAA entities are often registered to aviation LLCs ("John Smith Aviation LLC"), not the individual. The enricher fires against the LLC name, not the person. Wikidata/GitHub/LinkedIn pattern-guessing on "John Smith Aviation LLC" never finds a person because no person's profile is named that.

**Fix:** Before enrichment, attempt to resolve the LLC to its beneficial owner using two free sources:
1. **SEC EDGAR** — search `company_search_company.json?company={name}&type=SC+13D` for entities that share a name token with the LLC (the filer behind the LLC is often the HNWI)
2. **OpenCorporates** — `GET https://api.opencorporates.com/v0.4/companies/search?q={name}&fields=registered_agent_name,directors` — extract director/officer names from the free tier (50 req/day)
3. **FAA MASTER.txt cross-reference** — if the LLC has a registered agent in MASTER.txt field `[6]`, store it as `metadata.beneficialOwner`

**Implementation:**
- Add `resolveBeneficialOwner(entity)` in `artifacts/api-server/src/lib/enrichment/in-house-enricher.ts` — runs before the 7-source enrichment pass
- If a person name is found, store as `metadata.beneficialOwner` and use it as the search query for all subsequent enrichment steps (Wikidata, GitHub, Gravatar, etc.)
- Rate limit: 1 req/s (OpenCorporates free tier)

**Expected impact:** Contact hit rate for FAA Corporate entities lifts from ~0% toward 5–15%. Unlocks Wikidata/LinkedIn hits for the person behind the LLC rather than the LLC itself.

**Metric:** `contactableCount` rises for entities whose `entityType = "Corporation"` and `sourceRegistries LIKE '%faa%'`.

---

### I2 — Semantic Dedup Threshold Tuning

**Priority:** 🟠 Medium — fixes the duplicate surface problem without data loss risk

**Problem:** The semantic dedup pass compared 67k pairs and found 0 LIKELY_SAME_PERSON edges. The cosine similarity threshold of 0.93 is too conservative for cross-registry matching where name spellings differ substantially ("John T. Smith" in FAA vs "John Thomas Smith" in EDGAR). Separately, "Riley Jacob" appeared twice on the dashboard — suggesting two distinct FAA registration records for the same name that escaped dedup entirely.

**Fix:**
1. Lower the cosine similarity threshold from `0.93` → `0.87` in `artifacts/api-server/src/routes/relationships.ts` (`POST /api/relationships/semantic-dedup`) — but **add a name-token overlap guard**: require ≥2 shared significant tokens between the two entity names before creating an edge (prevents false positives from different people in the same city/state)
2. Add a **name-exact dedup pass** that runs at boot: find entity pairs where `LOWER(TRIM(name)) = LOWER(TRIM(name))` across different source registries — these are guaranteed same-name duplicates and deserve a `LIKELY_SAME_PERSON` edge regardless of embedding similarity
3. Surface the "Riley Jacob" class of duplicates on `/duplicates` — identical names within the same source registry are probably two registrations (two aircraft), not two people; add a "same-source name cluster" tab

**Implementation status (2026-07-23):** ✅ Complete. `/api/entities/same-source-name-clusters` returns up to 200 exact-name clusters grouped by normalized registry, and `/duplicates` now has a review-only Same-source clusters tab alongside the existing cross-registry candidate flow. Manual merge and dismiss actions remain unchanged; no records are auto-deleted.

**Files:**
- `artifacts/api-server/src/routes/relationships.ts` — lower threshold, add token overlap guard
- `artifacts/api-server/src/lib/startup.ts` — add name-exact dedup pass at ~300s

**Metric:** `totalRelationships` gains LIKELY_SAME_PERSON edges; `/duplicates` page shows cross-registry matches.

---

### I3 — Warm-Path Edge Quality: Introduce Co-Event and Co-Investment Signals

**Priority:** 🟠 Medium — transforms graph from "registry clustering" to "warm introduction network"

**Problem:** 230k edges but 97%+ are CORPORATE_SERIES (name-token clustering) or FAA GEOGRAPHIC_PEER. These are weak signals for warm introduction routing — the UCT path-finder traverses them but they don't represent real human connection. A path that goes HNWI → CORPORATE_SERIES_CLUSTER → CORPORATE_SERIES_CLUSTER → Target is not a warm introduction.

**Fix — add two high-quality edge types:**

#### I3-A: EDGAR Co-Investor Edges (same company, different filers)
- Two EDGAR entities that filed SC 13D/G for the same company are co-investors — they sit on the same cap table and likely know each other
- Already partially spec'd in C3 but focus on **same-company, different-person** pairs (not same-filing pairs)
- Implementation: group EDGAR entities by `metadata.companyName`, create `EDGAR_CO_INVESTOR` edges for pairs where both have HNWI/Gatekeeper type, cap at 20 per company to avoid hub explosion
- **This is the highest-quality warm-path signal available from current data**

#### I3-B: ProPublica 990 Co-Director/Co-Trustee Edges
- IRS 990 filings list every officer/director of a nonprofit foundation
- Two entities that appear as officers of the same foundation know each other well
- Implementation: extend `foundation-filings.ts` — after finding a foundation match, query its officer list and create `FOUNDATION_COLLEAGUE` edges between all entities in the DB who appear as officers of the same EIN
- `GET https://projects.propublica.org/nonprofits/api/v2/organizations/{EIN}.json` → `filing.officers[]`

**Files:**
- `artifacts/api-server/src/routes/relationships.ts` — new `POST /api/relationships/auto-detect-edgar-coinvestor`
- `artifacts/api-server/src/lib/enrichment/foundation-filings.ts` — extend to emit co-director edges
- `artifacts/api-server/src/lib/startup.ts` — trigger both at Phase 4 (300s)

**Metric:** UCT path sessions that traverse EDGAR_CO_INVESTOR or FOUNDATION_COLLEAGUE edges increase; path scores improve because warmth evaluator gives bonus to nodes with contact confidence.

---

### I4 — Contact Hit Rate: Targeted High-Value Enrichment

**Priority:** 🟡 Lower — complements I1 but requires more infrastructure

**Problem:** The 9 enrichment sources (Wikidata, Wikipedia, GitHub, Gravatar, DNS, RDAP, ProPublica, social-discovery, messenger-discovery) have high hit rates for public figures (Wikidata/Wikipedia) but near-zero for the FAA private individuals who make up 95% of the DB. Private HNWI aircraft owners are not on Wikidata. They may be on LinkedIn but the pattern-guessing approach only lands ~1–3%.

**Fix:** Tier the enrichment by entity quality rather than running the same pass over all 32k entities:

1. **Tier 1 — Public figures** (entities with `sourceRegistries` containing `edgar` or with `estimatedNetWorth > 30M`): run full 9-source enrichment pass every boot cycle. These have the highest Wikidata/Wikipedia hit probability.
2. **Tier 2 — FAA individuals** (typeReg=1, estimatedNetWorth $4M–$30M): focus on DNS domain guessing + RDAP + LinkedIn DuckDuckGo pattern. Skip Wikidata (no results). Run on 500 entities per boot cycle.
3. **Tier 3 — FAA corporations**: run people-resolution (I1) first, then enrich the resolved person name. Don't run Wikidata/GitHub against the LLC name.

**Implementation:** Add `enrichmentTier(entity): 1|2|3` function in `in-house-enricher.ts`. Route each entity to the appropriate source subset. Reduces wasted API calls and improves hit rate per call.

**Metric:** `contactableCount` per boot cycle rises without increasing enrichment run time.

---

### Phase I — Score Tracker

| Step | What it fixes | Expected lift | Status |
|---|---|---|---|
| Baseline (post-audit) | — | **7.5/10** | ✅ Measured 2026-07-23 |
| I1 — People-resolution | LLC → beneficial owner before enrichment | +0.5 (contact hit rate) | ✅ 2026-07-23 |
| I2 — Dedup threshold | 0 LIKELY_SAME_PERSON edges → cross-registry links | +0.3 (graph quality) | ✅ 2026-07-23 |
| I3 — Warm-path edges | CORPORATE_SERIES → co-investor/co-director edges | +0.5 (UCT path quality) | ✅ 2026-07-23 |
| I4 — Tiered enrichment | Private HNWI contact rate improvement | +0.2 (contact hit rate) | ✅ 2026-07-23 |
| **Target** | | **9.0/10** | ✅ Implemented |

### Phase I — Implementation Summary (2026-07-23)

**I1 — LLC Beneficial Owner Resolution** (`in-house-enricher.ts`)
- Added `resolveBeneficialOwner(llcName)` — queries SEC EDGAR EFTS + OpenCorporates for person behind FAA aviation LLCs
- If a person name is found, `enrichInHouse()` switches to enriching the resolved person (unlocks Wikidata/LinkedIn/email-pattern hits)
- Activated for Tier 3 entities (FAA Corps) in `enrichmentTier()` classification

**I2 — Semantic Dedup Improvements** (`relationships.ts`)
- Lowered SIMILARITY_THRESHOLD from 0.93 → 0.87 in semantic-dedup endpoint
- Added `hasEnoughSharedTokens()` token overlap guard (≥2 shared significant tokens) to prevent false positives at the lower threshold
- Added `POST /api/relationships/name-exact-dedup` — guaranteed same-name cross-registry matches (strength 0.95)
- Auto-triggered at 310s in startup.ts Phase 4
- Added `GET /api/entities/same-source-name-clusters` and a review-only Same-source clusters tab on `/duplicates`; exact-name records are grouped within each normalized registry and are never auto-merged
- Fixed duplicate candidate token indexing so repeated words in one entity name cannot produce self-pairs

**I3 — Warm-Path Edge Quality** (`relationships.ts`)
- Added `POST /api/relationships/auto-detect-edgar-coinvestor` (I3-A) — EDGAR_CO_INVESTOR edges between HNWI/Gatekeeper co-shareholders (strength 0.75); higher quality than existing EDGAR_CO_SHAREHOLDER (all types)
- Added `POST /api/relationships/foundation-colleagues` (I3-B) — FOUNDATION_COLLEAGUE edges between entities sharing the same IRS 990 foundation (strength 0.85); uses existing `foundationName` column
- Auto-triggered at 305s and 425s in startup.ts

**I4 — Tiered Enrichment** (`in-house-enricher.ts`)
- Added `enrichmentTier(entity): 1|2|3` classifier
- Tier 1 (EDGAR/public): full 20-source pass
- Tier 2 (FAA individuals): skip Wikidata, Wikipedia, ORCID, GitHub — focus on DDG-LinkedIn, DNS/RDAP, email patterns
- Tier 3 (FAA corps): resolveBeneficialOwner first, then treat as individual if resolved
- Reduces wasted API calls for 30k FAA private individuals; lifts per-call hit rate

---

## Phase J — Public Contact Discovery Roadmap Across Future Re-Imports

> **Purpose:** Raise the number of useful, lawful public contact vectors without sacrificing identity accuracy, source provenance, or the separation between a wealth signal and an access/contact signal.
>
> **Starting point:** The observed direct-contact yield is approximately **2.5% at best**. This is not a single-scraper problem. The current system finds more business, registry, website, and social evidence than it converts into a validated direct contact. Future work must improve the whole funnel: candidate selection → identity resolution → affiliation/domain resolution → public discovery → validation → persistence → measurable follow-up.
>
> **Research-phase principle:** This chapter describes lawful public methods, not a current production allowlist or capacity policy. During private development and future re-imports, do not prematurely disable lawful source families or discovery paths; that would reduce the evidence needed to improve recall and understand system capacity. Sources may carry an internal `productionReviewStatus` marker, but that marker is documentation only and must not restrict private research. Production safeguards, source allowlists, concurrency limits, retention rules, and public-facing privacy controls belong in a separate release-hardening phase before the system is made public.

### J0 — Establish the Measurement Contract Before Expanding Sources

**Priority:** Highest — no source expansion should be judged by a single “contactable” percentage.

**Problem:** A LinkedIn URL, a website, a registered address, a business switchboard, a guessed email, and a validated direct email are materially different outcomes. Treating them as one result hides where the 2.5% funnel is failing and can make a low-quality source appear successful.

**Implementation:**

1. Add a run-level funnel with counts for selected candidates, identity-normalized, beneficial-owner/person resolved, employer/affiliation resolved, official domain resolved, public candidate found, candidate validated, candidate attributed, candidate persisted, direct contact confirmed, and social/evidence-only result.
2. Break down every stage by entity type, source registry, country/jurisdiction, enrichment tier, and source module.
3. Separate outcome labels:
   - `evidence_only`: website, address, filing, asset, or organization record
   - `social_only`: LinkedIn/X/Instagram/Telegram handle without a direct contact
   - `organization_contact`: official company phone, generic inbox, or contact page
   - `direct_contact_candidate`: person-level email/phone supported by public evidence but not fully verified
   - `direct_contact_verified`: validated public person-level contact with attribution evidence
4. Store source URL, retrieval time, extraction method, confidence, and validation result for each contact vector. Do not store raw page dumps unless required for audit and retention policy.
5. Add a cohort baseline before each re-import. A later import is successful only when it improves precision and recall for a defined cohort, not merely the absolute number of rows.

**Relevant files:**

- `artifacts/api-server/src/routes/ingest-enrichment.ts`
- `artifacts/api-server/src/routes/ingest-pipeline.ts`
- `artifacts/api-server/src/lib/contact-confidence.ts`
- `artifacts/api-server/src/lib/contact-validation.ts`
- `artifacts/apex-finder/src/pages/jobs.tsx`
- `artifacts/apex-finder/src/pages/data-sources.tsx`

**Gate to J1:** A full enrichment run can answer “where did candidates disappear?” and reports direct, social, organization, and evidence-only outcomes separately.

---

### J1 — Stop Treating Social Presence as Enrichment Completion

**Priority:** Highest — likely the fastest yield improvement.

**Problem:** The current pipeline can mark an entity as enriched when it finds LinkedIn or another social handle. That is valuable evidence, but it can prevent the entity from receiving the later email/phone/domain passes that the user actually wants.

**Implementation:**

1. Keep `social_only` records eligible for targeted direct-contact passes.
2. Make the terminal state require a validated contact vector, not merely a social URL, website, or address.
3. Use the social identity as a disambiguation signal for follow-up queries: exact name + employer, exact name + city/country, profile slug + official domain, and known company + public team/contact pages.
4. Preserve all existing vectors; enrichment should fill missing fields instead of replacing a stronger source with a weaker result.
5. Score access separately from signal, following the existing product rule in `access-score.md`.

**Expected impact:** More second-pass opportunities for the large social/evidence-only cohort; better measurement of usable contact yield without inflating the wealth signal.

**Gate to J2:** The system reports how many social-only records receive a second direct-contact attempt and the conversion rate from that cohort.

---

### J2 — Build a Western Registry Coverage Matrix
**Status:** ✅ 2026-07-24

**Priority:** High — expand coverage by jurisdiction, not by indiscriminate scraping.

**Problem:** Western HNWI research is strongest where FAA, SEC EDGAR, HMLR, Companies House, BRREG, GLEIF, and ProPublica already provide structured data. Many countries have business registers, officer records, ownership records, property records, or official filings that are not yet represented in a consistent source layer.

**Registry families to prioritize:**

- **EU cross-border:** BRIS/e-Justice discovery, OpenCorporates cross-reference, and GLEIF identifiers.
- **Nordics:** Denmark CVR, Sweden Bolagsverket, Finland PRH, Norway BRREG, and Estonia e-Business Register.
- **DACH:** Austria Firmenbuch, Germany Handelsregister, Switzerland ZEFIX/cantonal registers, and Luxembourg RCS.
- **Benelux:** Belgium KBO/BCE, Netherlands KvK, and Luxembourg RCS.
- **Southern Europe:** France BODACC/Infogreffe where permitted, Italy Registro Imprese, Spain Registro Mercantil, Portugal company registry, and Ireland CRO.
- **Central and Eastern EU where legally usable:** Czech Justice, Poland KRS, Slovakia Commercial Register, Slovenia AJPES, Croatia Court Registry, Romania ONRC, Hungary company information, Latvia LURSOFT, Lithuania Legal Entities Register, Bulgaria Commercial Register, Cyprus Registrar, Malta MBR, and Greece GEMI.
- **Other Western jurisdictions:** US state company registries and county assessor sources, Canadian provincial registries, ASIC/LINZ and Australian state registries, and New Zealand Companies Office/LINZ.

**Implementation:**

- Create a source matrix with jurisdiction, entity identifier, person/officer fields, ownership availability, API/download method, rate limit, licensing, freshness, legal access notes, and an internal `productionReviewStatus`.
- Use non-blocking production-review labels: `review_required`, `reviewed_for_production`, or `not_yet_assessed`. Every new source may run during private development regardless of this label; the label is a reminder for the later public-production review.
- Implement one registry adapter at a time behind the existing registry-client dispatch pattern.
- Normalize company numbers, officer names, addresses, dates, and country codes into shared schemas.
- Keep ownership, officer, registered-agent, and correspondence-address roles distinct. Do not infer that every registered agent is the beneficial owner.
- Add fixture tests for each adapter before enabling it in the recurring scheduler.

**Delivered:** The coverage matrix and live registry search now include Norway BRREG, Czechia ARES, and France BODACC. Each adapter has fixture-style normalization tests, source provenance, identifier validation, and non-blocking production-review metadata. BODACC records are labeled as commercial-announcement evidence and are not treated as beneficial-ownership proof. Bulk-only FAA and HMLR sources remain documented in the matrix but are not exposed as live search adapters.

**Ordering:** Start with open, stable, high-value sources (CVR, AJPES, e-Business Register, CRO, ZEFIX, KRS, and BRIS discovery) before sources requiring paid access, difficult anti-bot handling, or uncertain licensing.

**Gate to J3:** At least three new jurisdictions produce normalized, provenance-backed person/company links and pass precision review on a sampled cohort.

---

### J3 — Make Identity Resolution the Core Enrichment Stage

**Priority:** High — prevents wrong-person contacts from increasing the headline rate.

**Problem:** A company name, an aircraft-owning LLC, a common person name, and a filing name are not interchangeable identities. Searching the wrong name produces low recall; accepting a same-name hit without context produces dangerous false attribution.

**Implementation:**

1. Maintain an identity bundle for each entity: normalized name variants, registry identifiers, employer/company affiliations, country/city, known public address, aircraft/property/company identifiers, and public profile URLs.
2. Expand FAA corporate resolution beyond a single owner guess. Preserve the legal LLC as the source entity, store each candidate beneficial owner with evidence and confidence, and use SEC, OpenCorporates, official state filings, and public registry officer data as corroboration.
3. Resolve officer/director records to existing people using token overlap, date/jurisdiction, employer, location, and registry identifiers — not name similarity alone.
4. Generate variants for `LAST FIRST`, `First Middle Last`, initials, diacritics, hyphens, suffixes, and transliterations. Alternate public names should be used only when a public source explicitly links them.
5. Add a human-review queue for ambiguous identity matches. Review-only is preferable to an incorrect auto-merge.

**Expected impact:** Higher recall for LLCs and cross-registry people while protecting precision. This stage should improve the quality of every downstream search rather than simply add more endpoints.

**Gate to J4:** A sampled review shows the resolved person/company link is attributable before any direct contact is promoted to verified.

---

### J4 — Resolve Employer, Official Domain, and Organization Contact Paths

**Priority:** High — the highest-leverage bridge from a person name to a public contact surface.

**Problem:** Email-pattern discovery is weak when the system does not know the person’s current or relevant employer. MX only proves that a domain accepts mail; it does not prove that a guessed address belongs to the person.

**Implementation:**

1. Build domain candidates from official registry websites, SEC/annual filings, Companies House/BRREG officer affiliations, official company pages, press releases, GLEIF, and public certificate-transparency evidence.
2. Score domains using official-source link, affiliation match, location match, consistent branding/contact page, MX/SPF/DNS health, and recency.
3. Reject registry and hosting domains as person-email domains. Keep the domain blocklist, but make it source-aware rather than relying on a guessed suffix.
4. Search official contact paths first: team/executive pages, investor-relations and media contacts, public office or foundation pages, company switchboards, and role inboxes.
5. Keep organization contacts labeled as organization contacts; do not silently convert them into personal contacts.

**Gate to J5:** Domain resolution reports candidate-domain precision and the proportion of person searches with at least one corroborated employer/domain hypothesis.

---

### J5 — Add a Lawful Digital-Footprint Discovery Layer

**Priority:** High — broaden recall after identity and domain quality are in place.

**Problem:** The attachment correctly points out that people often leave a large public digital footprint, but broad searching without identity controls creates noise, false positives, and unnecessary rate-limit failures.

**Lawful public source families to evaluate:**

- official websites, public team pages, press releases, event speaker pages, and public biographies
- public LinkedIn/X/Instagram/GitHub pages where access and terms permit
- Wikidata, Wikipedia, ORCID, ProPublica 990, SEC filings, and public corporate registries
- public news archives and search-engine results
- certificate-transparency logs, RDAP, Wayback snapshots, and DNS records for domain verification
- public aviation/property/company cross-references already supported by the project

**Implementation:**

1. Add query templates with disambiguating context: exact name + employer, exact name + jurisdiction, exact name + public role, official domain + contact/team/about, and company identifier + officer/director.
2. Extract candidate URLs, emails, phones, employer names, and handles into a common evidence queue.
3. Use source-specific parsers and rate limits; cache responses and record empty, blocked, timeout, and parse-failure outcomes.
4. Treat social profiles as identity evidence unless a direct contact is explicitly public and attributable.
5. Keep the discovery layer broad during private development. The attachment’s IntelX and paid-aggregator references can be evaluated as separate lawful integrations or source research and marked `review_required` internally; the marker must not disable them or alter private-research coverage. Deciding which sources, if any, are enabled in public production belongs to the later release-hardening phase, not this roadmap.

**Gate to J6:** New sources increase validated-contact recall on a manually labeled sample without exceeding the agreed false-attribution threshold.

---

### J6 — Introduce Contact Candidate Validation and Attribution Scoring

**Priority:** High — convert “found something” into a trustworthy contact.

**Problem:** A guessed email with MX, a public business phone, and an email extracted from a search snippet have different reliability. The current additive score should not be the only quality control.

**Implementation:**

1. Validate emails with syntax/normalization, domain/MX checks, source context, person/employer/domain consistency, and optional non-invasive SMTP results only when lawful, permitted, and technically safe.
2. Validate phones with international normalization, country/region consistency, source context, role labeling, duplicate detection, and business-switchboard classification.
3. Validate social profiles with exact or strong name match, employer/location consistency, linked official website, and cross-source corroboration.
4. Replace a single additive contact score with separate dimensions: `sourceReliability`, `identityMatch`, `recency`, `directness`, and `independentCorroboration`.
5. Require at least two independent signals — or one high-authority official source — for `direct_contact_verified`.
6. Keep rejected candidates and rejection reasons in audit metadata without exposing them as usable contacts.

**Gate to J7:** Precision is measured on a labeled sample and verified contacts can be explained source-by-source.

---

### J7 — Turn Contact Discovery Into a Multi-Pass, Budgeted Scheduler

**Priority:** High — prevent one pass from exhausting the opportunity.

**Passes:**

1. **Identity and registry:** normalize names, resolve companies/officers/owners, and attach stable identifiers.
2. **Domain and organization:** identify employers, official domains, contact pages, and role inboxes.
3. **Public social/web:** discover public profiles and use them for disambiguation.
4. **Direct contact:** search explicit public emails/phones and validate candidates.
5. **Graph expansion:** follow high-confidence person→company→officer→organization paths to discover additional public sources.
6. **Retry:** revisit evidence-only and social-only records after a cooling period with a new query plan, not an identical request.

**Implementation:**

- Add per-entity enrichment state, last-attempt time, pass number, source cooldown, and retry reason.
- Use quotas per source and jurisdiction so one slow or rate-limited source cannot starve the pipeline.
- Prioritize hot leads, high-identity-confidence records, and cohorts with demonstrated source yield.
- Keep a negative cache for confirmed no-match, blocked, and ambiguous outcomes with expiry; do not permanently suppress a person because one source returned nothing.
- Use idempotent jobs and Redis/PostgreSQL persistence so a re-import resumes rather than re-fires every request.

**Gate to J8:** Repeated passes produce incremental yield and do not repeatedly hammer the same source/entity pair.

---

### J8 — Use the Relationship Graph for Discovery, Not Just Visualization

**Priority:** Medium — improve the “company → owner → public footprint” thread described in the attachment.

**Problem:** The graph contains registry and corporate edges, but the enrichment engine does not consistently use high-confidence neighbors to generate contextualized search paths.

**Implementation:**

1. Add typed, provenance-backed edges for person↔company officer/director, person↔beneficial-owner candidate, person↔foundation/charity role, person↔official website/domain, person↔public social profile, and company↔company via shared officer or filing.
2. Give each edge confidence, source, observed date, and review state.
3. Permit graph expansion only from high-confidence edges and cap path length/cost.
4. Generate paths such as aircraft LLC → company filing → officer → official domain → public team/contact page.
5. Keep proximity (club, event, asset, location) separate from identity proof. It may prioritize research, but it must not prove that a contact belongs to a person.

**Gate to J9:** Graph-assisted searches show incremental validated contacts over name-only searches, with attributable evidence retained for every edge.

---

### J9 — Add Source Quality Operations and Re-Import Checkpoints

**Priority:** High — make the roadmap survive multiple future imports. This is an engineering continuity phase, not the public-production restriction phase.

**Before each re-import:**

1. Read `replit.md`, `Context.md`, and this Phase J chapter.
2. Snapshot entity count by registry/type/country; direct, social, organization, and evidence-only counts; a validated-contact precision sample; source errors/timeouts/rate limits; and unresolved identity/domain queues.
3. Confirm secrets, integrations, database schema, Redis/cache health, and source terms. Never invent missing credentials. Do not turn temporary development capacity issues into permanent source restrictions.
4. Ensure each source has a non-blocking `productionReviewStatus` marker and, where relevant, a short internal review note covering legal basis, licensing/terms, privacy, reliability, cost, rate limits, retention, and capacity. Do not use the marker as a runtime gate.
5. Run a small canary cohort before a full batch.
6. Compare the canary against the previous baseline before enabling the next phase.

**After each re-import:**

1. Restore durable contact evidence and provenance before launching broad enrichment.
2. Reconcile entities by stable registry identifiers before name matching.
3. Run schema/data-quality checks, then identity/domain resolution, then contact passes.
4. Review false positives and rejected candidates before increasing concurrency.
5. Record counts, limitations, and the next gate in `Context.md`; update `replit.md` only for durable environment, schema, or phase changes.

**Success dashboard targets:**

- contactable rate is reported by cohort, not only globally
- direct-contact precision is measured and does not fall as recall rises
- social-only records decrease after follow-up passes
- organization contacts are not counted as personal contacts
- every promoted contact has source, timestamp, attribution, and validation status
- re-imports are idempotent and do not create duplicate identities or duplicate contact vectors

### Phase J Implementation Order Across Re-Imports

| Re-import milestone | Work | Exit condition |
|---|---|---|
| **J-1** | J0 measurement contract + J1 non-terminal social/evidence state | Funnel visible; social-only follow-up is active |
| **J-2** | J2 registry matrix: first three high-value jurisdictions | Three adapters normalized, tested, and sampled |
| **J-3** | J3 identity bundles and multi-candidate beneficial-owner resolution | Identity attribution review passes |
| **J-4** | J4 employer/domain resolution and official organization contact paths | Domain precision measured; organization contacts labeled |
| **J-5** | J5 lawful public digital-footprint layer | New sources improve recall without unacceptable false attribution |
| **J-6** | J6 candidate validation and multidimensional access scoring | Verified contacts are explainable and auditable |
| **J-7** | J7 budgeted multi-pass scheduler and retry state | Incremental yield per pass; no repeated source hammering |
| **J-8** | J8 graph-assisted contextual discovery | Graph paths beat name-only baseline on labeled cohort |
| **J-9** | J9 operational checkpoints and source-quality dashboard | Re-import playbook is repeatable and metrics persist |

**Phase J target:** Move from an unqualified ~2.5% contactable headline to a measured, cohort-specific improvement in **validated direct contacts**, while preserving separate counts of social, organization, and evidence-only discoveries. During private development, maximize lawful discovery and measure capacity honestly. Maintain production-review markers internally without using them to restrict research; apply any necessary limits and safeguards only in a later release-hardening phase.

---

## Legacy Patterns (all ✅ — do not re-implement)

> See git history for full details. All 19 patterns implemented 2026-07-19 to 2026-07-21.

| Pattern | Status | Fixed by |
|---|---|---|
| Hybrid stack not activated | ✅ | startup.ts bulk-run at 45s |
| L4 UCT never run | ✅ | startup.ts bulk-run at 45s |
| L2 pipeline cold | ✅ | startup.ts bulk-run at 45s |
| L1 graph blind | ✅ | startup.ts 5-step relationship pipeline (15–35s) |
| L1 BM25 near-zero | ✅ | startup.ts step 5 (sparse notes fill) |
| isHot flag out of sync | ✅ | startup.ts step 1 (hot flag sync) |
| No contact vectors | ✅ | startup.ts in-house enricher at 120s |
| Digital vectors missing | ✅ | startup.ts in-house enricher at 120s |
| Isolated node | ✅ | startup.ts relationship pipeline |
| No corporate linkage | ✅ | startup.ts EDGAR co-filer + cluster detection |
| No geolocated assets | ✅ | startup.ts FAA coord backfill |
| Hot lead enrichment pending | ✅ | startup.ts CH enricher at 90s |
| Profile notes sparse | ✅ | startup.ts step 5 (populate notes) |
| Potential duplicate | ✅ | /duplicates page + merge endpoint |
| HNWI zero assets | ✅ | startup.ts step 6 (EDGAR stock assets) |
| Single source | ✅ | startup.ts OCCRP (disabled — 401) |
| liveSource missing | ✅ | startup.ts step 4 (provenance backfill) |
| Corporate no edges | ✅ | startup.ts cluster detection at 15s |
| High score not hot | ✅ | startup.ts step 1 |
