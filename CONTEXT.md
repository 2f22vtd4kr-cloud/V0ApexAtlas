# ApexFinder Pro — Session Context

**Date:** 2026-07-19  
**Purpose:** Handoff document for the next repo import / agent session. Read this before touching any ingestor or data pipeline code.

---

## What Was Done This Session

### 1. FAA Ingestor — Fixed (was stuck at 0 records forever)

**Root cause:** `isDuplicate()` called once per qualifying record → one Upstash `SISMEMBER` round-trip per record (~75ms) × ~865 qualifying records per 5,000 lines = ~65 seconds per 5k lines. Job ran for 5+ minutes with `inserted=0`, `skipped=0`, progress frozen at 8%.

**Secondary bug:** Progress heartbeat was placed *after* the filter `continue` statements — it only fired when a record actually matched all filters AND wasn't a duplicate. For thousands of filtered-out records, no heartbeat fired.

**Fix applied in `artifacts/api-server/src/lib/faa-ingestor.ts`:**
- Added `preloadDedupPrefix("faa:")` call before the loop — scans Upstash once into a local `Set<string>`
- Replaced `await isDuplicate(dkey)` → `seenKeys.has(dkey)` (in-memory, no network)
- Replaced `await markSeen(dkey)` → `seenKeys.add(dkey); pendingDedup.push(dkey)`
- After each 100-record batch flush: `await batchMarkSeen(pendingDedup); pendingDedup.length = 0`
- Moved progress heartbeat to fire unconditionally every 5,000 lines (before filter chain)

**Result:** 30,000 FAA aircraft owners inserted in **73 seconds**.

**New helpers added to `artifacts/api-server/src/lib/job-queue.ts`:**
- `preloadDedupPrefix(prefix: string): Promise<Set<string>>` — scans Upstash dedup set for matching members
- `batchMarkSeen(keys: string[]): Promise<void>` — bulk SADD to Upstash in one call

---

### 2. Land Registry Ingestor — Rebuilt (SPARQL → bulk CSV)

**Root cause:** HMLR PPD SPARQL endpoint (`https://landregistry.data.gov.uk/landregistry/query`) is non-functional for bulk queries:
- Queries with `FILTER(?amount >= 1000000)` time out (HTTP 000, curl exit 28)
- Queries with only date range filter return empty bindings (0 results) for any year tested
- The endpoint works for trivial single-record queries but not for our use case

**Fix:** Replaced the entire SPARQL implementation with the official HMLR bulk CSV approach.

**New `artifacts/api-server/src/lib/land-registry-ingestor.ts` (full rewrite):**
- Downloads `http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-YYYY.csv`
- URL redirects (HTTP 301) to `prod2` subdomain — use `curl -L`
- File size: ~160MB per year. 2025 + 2024 both available and tested.
- No header row. Comma-delimited. Fields are `"quoted"` — strip with `unquote()`.
- Filters: skip record status `D` (deletes), skip PPD category `B` (additional/auction), keep `price >= 1_000_000`
- **Buyer name is NOT in the PPD CSV** — entity name = property address (e.g. "UK Property — 1, PALACE STREET, LONDON")
- Same in-memory dedup pattern as FAA (dedup key prefix: `lr:`)

**Result:** 50,000 £1M+ UK property transaction records inserted in **~497 seconds** (2025 + 2024 data).

**Cache:** Files cached at `/tmp/apexfinder-hmlr/pp-YYYY.csv`, TTL 30 days.

---

### 3. Data Integrity Audit & Cleanup

**Triggered by:** User request to confirm all data is real.

**Found and removed — `artifacts/api-server/src/lib/mock-data.ts` (deleted):**
A 955-line file containing `seedMockData()` and `seedExtendedData()` with 27 completely fictional profiles: Lorenzo Castellani, Edward Fitzwilliam-Holt, Alexei Morozov, Bradford Whitmore III, and others, with invented addresses, phone numbers, IMO numbers, club memberships, and Geometra licence numbers. The file was dead code (nothing imported it), confirmed by grep — no routes or startup called it. Deleted entirely.

**Found and fixed — Fake Live Signals in `artifacts/api-server/src/routes/dashboard.ts`:**
The `/api/dashboard/hot-leads` endpoint had a `getLiveSignal()` function using `Math.random()` to pick from 40+ hardcoded strings ("Marina movement: vessel departed home berth — destination unknown", "Club membership renewal confirmed", etc.). These were displayed on the dashboard as "LIVE SIGNALS" but were entirely invented.

**Fix:** Removed all hardcoded signal arrays. Replaced with a real asset query — for each hot lead entity, query its most recent asset from the database and build the signal from actual fields (`category`, `description`, `sourceRegistry`). Falls back to the entity's `notes` field (which contains real source attribution from the ingestors). No more randomness, no invented text.

---

### 4. Persona Improvement Loop — Run

Triggered `POST /api/improve/run` on the fully-populated database.
- **50 entities processed**, **300 improvement suggestions generated**
- 150 high-priority, 100 medium, 50 low
- Personas: Data Engineer (100), MCTS Expert (50), Business Engineer (50), Data Analyst (50), UX Designer (50), Architect (0 — these entities lacked the graph depth to trigger architect suggestions)
- All suggestions are pending — none applied yet

---

## Current Database State

```
Entities:    80,900
Assets:      80,700
Hot Leads:   9,176
Western HNWIs: 200
Avg Bayesian Score: 63.0%

Assets by category:
  RealEstate:  50,000  (HMLR PPD — £91.4B total declared value)
  Aviation:    30,700  (FAA registry — no estimated values stored)
```

---

## Architecture Decisions Made

### Dedup Strategy
**Decision:** Use in-memory `Set<string>` during parse loops, not per-record Upstash calls.  
**Why:** Upstash latency (~75ms/call) × high match rate = pipeline stall. One scan at start + one batch write per flush is the correct pattern.  
**Apply to:** Any future ingestor that processes >1,000 records in a loop. The Western HNWI ingestor still uses old per-record pattern (acceptable at 200 records; fix if volume grows).

### Dedup Key Naming
The actual Upstash Redis key is `apex:apex:dedup:hnwi` — double prefix is an artifact of `PERM_PREFIX + DEDUP_KEY` in `redis.ts`. Do not change without clearing the dedup set. `preloadDedupPrefix` and `batchMarkSeen` in `job-queue.ts` handle this correctly.

### Land Registry Data Source
**Decision:** HMLR bulk CSV over SPARQL permanently.  
**Why:** SPARQL endpoint is non-functional for price-filtered bulk queries. The S3 CSV is the official HMLR bulk download channel and is reliable.  
**Limitation:** PPD CSV does not include buyer identity — entities are named by property address. To get beneficial owner data, the HMLR OCOD (Overseas Companies) dataset would be needed instead (separate endpoint, only covers foreign-owned property).

### Signal Display
**Decision:** Signals must be derived from real database content.  
**Why:** Hardcoded random strings were found masquerading as live intelligence — a data integrity violation. All text in the SIGNAL field is now sourced from actual asset descriptions or entity notes populated by real ingestors.

---

## Files Changed This Session

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/faa-ingestor.ts` | Rewrote parse loop: in-memory dedup, unconditional progress heartbeat, batch Upstash writes |
| `artifacts/api-server/src/lib/land-registry-ingestor.ts` | Full rewrite — SPARQL replaced with HMLR PPD bulk CSV streaming |
| `artifacts/api-server/src/lib/job-queue.ts` | Added `preloadDedupPrefix()` and `batchMarkSeen()` helpers |
| `artifacts/api-server/src/routes/dashboard.ts` | Removed fake signal arrays + `getLiveSignal()`; replaced with real asset query |
| `artifacts/api-server/src/lib/mock-data.ts` | **Deleted** — 955 lines of fictional profiles |
| `replit.md` | Updated with full current project state |
| `.agents/memory/MEMORY.md` | Updated with new topic pointers |
| `.agents/memory/faa-dedup-batching.md` | New topic file — per-record dedup pattern and fix |
| `.agents/memory/hmlr-ppd-csv.md` | New topic file — SPARQL failure and CSV approach |

---

## Known Remaining Issues

### Western HNWI Ingestor — Old Dedup Pattern
`artifacts/api-server/src/lib/western-hnwi-ingestion.ts` still uses `isDuplicate()` / `markSeen()` per record (one Upstash round-trip each). This is acceptable at 200 records (~15 seconds of latency total) but will become a bottleneck if target count is raised above ~1,000. Fix: apply same `preloadDedupPrefix` + `batchMarkSeen` pattern.

### HMLR PPD Entities Are Transactions, Not Buyers
The 50,000 Land Registry entities are UK property transactions — the entity name is the property address ("UK Property — 1, PALACE STREET, LONDON"), not the buyer. If the goal is to identify *who* bought these properties, a different source is needed:
- **HMLR OCOD** — Overseas Companies Ownership of Data: lists overseas-company-owned properties with company names. Available at `https://use-land-property-data.service.gov.uk/datasets/ocod`.
- **Companies House PSC** — Persons with Significant Control register links company ownership back to individuals.

### FAA Entity Matching to Real People
FAA records contain the registrant name as filed — which for LLCs and partnerships may be a corporate entity name rather than an individual (e.g. "9AT LLC", "WPP NAUTICAL LLC"). The `INDIVIDUAL_TYPES` filter allows type 7 (LLC) which is correct for HNWI research but means some entities are vehicle names, not person names.

### SEC EDGAR DEF 14A Entries Are Companies
The `harvestSecEdgarDEF14A` harvester in `western-hnwi-ingestion.ts` extracts the DEF 14A *filer* (the registrant company), not the individual directors listed inside the proxy statement. Companies with names like "GENERAL ATLANTIC, L.P." pass the `looksLikePerson()` filter because the regex `\blp\b` doesn't match "L.P." (the dots break the word boundary). These corporate entities end up classified as HNWI type. Low impact at current scale (200 entities total) but worth fixing if the Western HNWI harvest is expanded.

---

## Next Session Priorities

Based on incomplete items from prior context:

1. **Run OCCRP enrichment** — `POST /api/ingest/occrp` — cross-references existing entities against OCCRP Aleph. Hasn't been run on the new 80,900-entity dataset. Will take a while (1 req/s rate limit × 80,900 = ~22 hours for full set; run on a sample with `?limit=500`).

2. **Replace HMLR PPD entities with OCOD beneficial owners** — if the goal is to identify the people behind £1M+ property purchases (not just log the transactions), the HMLR OCOD dataset provides overseas company ownership, which can then be traced to individuals via Companies House PSC.

3. **Fix Western HNWI DEF 14A harvester** — filter out corporate names more robustly (strip "L.P.", "S.A.", etc. before the `looksLikePerson()` check).

4. **Persona loop — apply suggestions** — 300 pending improvement suggestions exist. The apply flow (`PATCH /api/improve/logs/:logId` with `{"status":"applied"}`) exists but no automation runs it yet.

5. **OpenSky live flight enrichment** — `POST /api/ingest/opensky` — enriches aviation assets with live ADS-B position data. Hasn't been run on the new 30,000 FAA records.
