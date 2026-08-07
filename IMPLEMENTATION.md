# ApexFinder Pro — Implementation Tracker

> **Permanent rule (enforce at every session):** Zero synthetic, fake, or hallucinated data. Every record must derive from a validated public registry. Missing data = "Unverified" or blank. This rule can never be broken.

---

## Spec Reference

Original master prompt lives in `attached_assets/Pasted-You-are-a-world-class-principal-systems-architect-and-f_1784468020806.txt`.

---

## Phase Status

### ✅ Phase 1 — Foundation & Architecture
- [x] pnpm monorepo (TypeScript, ESM)
- [x] Express 5 API server (`artifacts/api-server`, port 8080)
- [x] React 19 + Vite frontend (`artifacts/apex-finder`)
- [x] PostgreSQL schema (Drizzle ORM): entities, assets, relationships, research_sessions
- [x] Redis dual-stack: local ioredis (cache) + Upstash (permanent dedup/job state)
- [x] Background job queue (`lib/job-queue.ts`) with Redis-backed progress/log tracking
- [x] Logger (pino), CORS, session middleware

### ✅ Phase 2 — Real Data Ingestion Engine
- [x] SEC EDGAR SC 13D/G + DEF 14A harvester (US beneficial owners & directors)
- [x] UK Companies House Officers + PSC harvester (requires `COMPANIES_HOUSE_API_KEY`)
- [x] BRREG Norway director harvester (free, no key)
- [x] Mass ingestion job: `POST /ingest/western-hnwi` (fire-and-forget, progress polling)
- [x] Redis Upstash dedup set prevents re-insertion across restarts
- [x] **FAA Releasable Aircraft Database** — real turbine/multi-engine aircraft owner ingestion (`lib/faa-ingestor.ts`) via `POST /ingest/faa`
- [x] **GLEIF LEI Register** — legal entity lookup added to registry search
- [x] **Zero mock data on startup** — removed synthetic seeding; DB starts clean; real ingestion required
- [x] Live registry search: OpenCorporates, Companies House UK, SEC EDGAR, GLEIF (`POST /registry-search`)

### ✅ Phase 3 — Graph Analysis & MCTS
- [x] NetworkX-equivalent graph engine in TypeScript (`lib/graph-engine.ts`)
- [x] MCTS pathfinding with UCT (`lib/mcts-agent.ts`): explores outreach paths, rewards personal contact > gatekeeper
- [x] Bayesian scoring engine (`lib/bayesian-scorer.ts`): updates entity scores based on signal evidence
- [x] Research session persistence (DB + job tracking)

### ✅ Phase 4 — Core UI
- [x] Intelligence HQ (dashboard): stats bar, global Leaflet asset map, hot leads sidebar, ingestion panel
- [x] Network Graph (`react-force-graph-2d`): force-directed entity graph, node detail panel, entity selector
- [x] MCTS Terminal: visual simulation log, path ranking, confidence scores
- [x] Pipeline CRM: kanban board with deal stages
- [x] Entity Ledger: table with proximity/type filters, CSV export
- [x] Field Manual: operational documentation

### ✅ Phase 5 — Hybrid Search Engine
- [x] BM25 keyword search — pure TypeScript inverted index, name boosted 3×, Robertson-Sparck Jones IDF
- [x] TF-IDF cosine similarity — bigram-aware vector space model (semantic-like, no neural model/external API)
- [x] Reciprocal Rank Fusion (RRF, k=60) combining BM25 + TF-IDF + Bayesian graph signal
- [x] Agentic multi-agent reasoning: Planner → Retriever → Analyst → Critic (all deterministic TypeScript)
- [x] POST /search/intelligent — orchestrator entry point, 60 s Redis cache
- [x] "Deep Search" tab — visual pipeline cards, per-signal score bars, expandable analyst reasoning

### ✅ Phase 6 — Apex Profile Card (Complete)
- [x] Leaflet mini-map on entity profile (showing all owned assets with coordinates)
- [x] Full source ledger (every data point traced to registry + filing)
- [x] Confidence breakdown by data category
- [x] Outreach strategy panel with MCTS-derived best paths + personalized approach suggestions

### ✅ Phase 7 — Persona Improvement Loop
- [x] Autonomous background agent triggered via POST /improve/run (fire-and-forget, Redis job tracking)
- [x] Single-entity sync run via POST /improve/run/:entityId
- [x] Personas: Data Engineer, Data Analyst, MCTS Expert, Business Engineer, UX Designer, Architect (all deterministic TypeScript)
- [x] improvement_logs DB table (entity_id, persona, category, priority, title, description, action_taken, status)
- [x] Persona Loop page (`/improvements`): persona cards, priority/status filters, expandable log cards, apply/dismiss actions
- [x] GET /improve/stats — summary counts by persona + priority
- [x] GET /improve/logs — paginated, filterable list with entity name join
- [x] PATCH /improve/logs/:logId — status update (pending → applied / dismissed)

### ✅ Phase 8 — Extended Real Sources
- [x] OCCRP Aleph enricher — cross-references all entities against aleph.occrp.org; flags sanctions/investigation hits; sets isHot=true on sanctions matches
- [x] UK HM Land Registry OCOD ingestor — bulk CSV download of overseas companies owning UK property; creates Corporation entities + Real Estate assets
- [x] OpenSky Network enricher — live ADS-B state vectors matched against FAA aviation assets; marks jets actively airborne + enriches with position/altitude/speed
- [x] EASA / national aviation registers — noted as "coming soon" (no standardised bulk API across European registries)
- [x] Data Sources dashboard page (`/data-sources`) — all sources displayed with type badge, run button, live job progress, log tail, and external links
- [ ] US county-level property assessor records (skipped — no standardised API)
- [ ] GLEIF bulk download (skipped — existing live GLEIF search already integrated)

---

## Data Sources — Status

| Source | Type | Auth | Status |
|--------|------|------|--------|
| SEC EDGAR SC 13D/G | Beneficial owners | None | ✅ Live |
| SEC EDGAR DEF 14A | Directors/executives | None | ✅ Live |
| UK Companies House | Officers + PSCs | `COMPANIES_HOUSE_API_KEY` | ✅ Live (key required) |
| BRREG Norway | Company directors | None | ✅ Live |
| FAA Releasable Aircraft DB | Aircraft owners (private jets) | None | ✅ Live |
| OpenCorporates | Corporate search | None | ✅ Live (50 req/day free) |
| GLEIF LEI Register | Legal entities | None | ✅ Live |
| OCCRP Aleph | Beneficial ownership | None | ✅ Live |
| UK HM Land Registry (OCOD) | Property | None | ✅ Live |
| OpenSky / ADS-B Exchange | Live flights | None | ✅ Live |

---

## Environment Variables

| Key | Purpose | Required |
|-----|---------|----------|
| `DATABASE_URL` | PostgreSQL (Replit-managed) | ✅ Auto |
| `REDIS_URL` | Local Redis cache | ✅ Set |
| `REDIS_URL_1` | Upstash Redis (permanent) | ✅ Set |
| `SESSION_SECRET` | Admin token fallback | ✅ Set |
| `COMPANIES_HOUSE_API_KEY` | UK Companies House API | ⚠️ Optional (needed for CH source) |
| `PORT` | API server port (auto-assigned) | ✅ Auto |

---

## Session Log

### Session 8 — Phase 8: Extended Real Sources
- Built `artifacts/api-server/src/lib/occrp-enricher.ts` — Aleph REST API (1 req/s rate limit), name-overlap match (≥75% word overlap), sanctions-dataset flagging, isHot escalation
- Built `artifacts/api-server/src/lib/land-registry-ingestor.ts` — streaming CSV download + parse (handles quoted fields), dual-URL fallback, 30-day cache, dedup by Title Number, Bayesian score from price paid
- Built `artifacts/api-server/src/lib/opensky-ingestor.ts` — live state vectors from opensky-network.org, callsign→N-number matching, altitude/speed/position enrichment, marks owners as hot leads
- Added POST /ingest/occrp, POST /ingest/land-registry, POST /ingest/opensky to ingest.ts routes
- Added OpenAPI paths + IngestJobStarted schema, ran codegen (typecheck clean)
- Built `artifacts/apex-finder/src/pages/data-sources.tsx` — full Data Sources dashboard with per-source cards, phase badges, enricher/ingestor type labels, live job polling, log tails, external links
- Added "Data Sources" nav item (Radio icon) to layout.tsx, route `/data-sources` to router.tsx

### Session 7 — Phase 7: Persona Improvement Loop
- Added `improvement_logs` table (`lib/db/src/schema/improvement_logs.ts`) — FK → entities, cascade delete
- Built `artifacts/api-server/src/lib/persona-engine.ts` — 6 deterministic persona runners (Data Engineer, Data Analyst, MCTS Expert, Business Engineer, UX Designer, Architect), each queries DB and produces typed `ImprovementSuggestion[]`
- Added `artifacts/api-server/src/routes/improve.ts` — POST /improve/run (background job), POST /improve/run/:entityId (sync), GET /improve/jobs/:jobId, GET /improve/logs, GET /improve/logs/:entityId, PATCH /improve/logs/:logId, GET /improve/stats
- Added OpenAPI spec paths + schemas (ImprovementLog, ImprovementJobState, ImprovementStats) + ran codegen
- Built `artifacts/apex-finder/src/pages/improvements.tsx` — full Persona Loop dashboard with persona summary cards, job progress bar with live polling, filterable log list, expandable cards with apply/dismiss, empty-state CTA
- Added "Persona Loop" nav item (Bot icon) to `layout.tsx`, route `/improvements` to `router.tsx`
- Switched from manual workflows to managed artifact workflows (artifacts/api-server: API Server, artifacts/apex-finder: web)

### Session 6 — Phase 6: Apex Profile Card
- Created `artifacts/apex-finder/src/pages/profile.tsx` — full-page entity profile with 4 panels
- **Asset mini-map:** Leaflet/react-leaflet with CartoDB dark tiles, CircleMarker per asset (colored by category: Aviation=#3B82F6, RealEstate=#10B981, Marine=#06B6D4, PrivateClub=#A855F7), legend, empty state
- **Confidence breakdown:** 5-category scoring (Identity/Financial/Network/Registry/Assets) + overall SVG ring; derived from entity fields + assets + relationships
- **Source ledger:** Full-width table tracing every data point to its source registry; categories: Identity, Financial, Network, Asset, Registry; verified/unverified badges
- **Outreach strategy:** MCTS session selector, winning path chain visualization, MCTS iterations table, pitch generation button, collapsible multi-message pitch display
- Wired to existing hooks: `useGetEntity`, `useListAssets`, `useListRelationships`, `useListResearchSessions`, `useRunResearch`, `useGeneratePitch`
- Added `/profile/:id` route in `router.tsx`
- Added profile icon (IdCard) to entity ledger desktop action column + mobile detail view

### Session 5 — Kill mock data; wire real OSINT sources
- Removed `seedMockData()` + `seedExtendedData()` auto-seeding from server startup
- Built real FAA Releasable Aircraft Database ingestor (`lib/faa-ingestor.ts`):
  - Downloads official ZIP from `registry.faa.gov` (~70MB)
  - Streams and parses MASTER.txt (pipe-delimited)
  - Filters: Active status, individual-like registrant, turbine/multi-engine/rotorcraft aircraft
  - Background job with Redis progress tracking
- Added GLEIF LEI Register to registry search (`lib/gleif-client.ts`)
- Updated `/ingest/faa` endpoint to run real FAA ingestor as background job
- Added empty-state UI to dashboard when database has no data (clean install CTA)
- Database now starts empty; all data must come from real public registries

### Session 4 — Western HNWI Engine + Entity Ledger upgrades + Field Manual
_(see replit.md for details)_

### Session 3 — Spacing tightened, SEC EDGAR live source added
_(see replit.md for details)_

### Session 2 — Master prompt implementation, graph navigation, pitch engine
_(see replit.md for details)_

### Session 1 — Setup and baseline
_(see replit.md for details)_
