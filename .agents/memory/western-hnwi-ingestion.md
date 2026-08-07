---
name: Western HNWI Ingestion
description: Architecture for mass Western HNWI record generation, dedup, job tracking, and frontend trigger
---

## Ingestion flow
- `POST /api/ingest/western-hnwi` — starts background job (no auth, personal use). Returns `{ jobId, pollUrl }`.
- `GET /api/ingest/job/:jobId` — poll status + 20-line log tail. Returns `{ status, progress, inserted, skipped, errors, dedupCount, log }`.
- `GET /api/ingest/status` — overall counters (HNWI count, dedup set size, active job).
- `DELETE /api/ingest/dedup` — clear Upstash dedup set to allow re-ingest.

## Key files
- `artifacts/api-server/src/lib/western-hnwi-ingestion.ts` — generates realistic Western HNWI records (US 35%, UK 18%, CH 10%, DE 9%, FR 7%, AU 6%, CA 6%, NO 4%, NL 3%, NZ 2%), inserts in batches of 100, deduplicates via Upstash SET `apex:dedup:hnwi`.
- `artifacts/api-server/src/lib/job-queue.ts` — Redis-backed job tracker using permanent Upstash client. Jobs stored as hashes at `apex:job:<id>`, logs at `apex:joblog:<id>`.
- `artifacts/api-server/src/routes/ingest.ts` — all ingestion routes.
- `artifacts/apex-finder/src/pages/dashboard.tsx` — `IngestionPanel` component with target selector, launch button, progress bar, and live log.

## Why no auth on ingest endpoints
Personal use tool — no need for token gating on self-triggered operations.

## Dashboard additions
- 5-stat bar now includes "Western HNWIs" count (blue, sourced from `westernHnwiCount` in `/dashboard/stats`).
- `IngestionPanel` mounted below the Live Signals list on the right sidebar.
- `onComplete` callback calls `refetchStats()` + `refetchLeads()` after job finishes.

## Entity Ledger additions
- Proximity filter (client-side, reads `metadata.proximityScore`).
- Type filter dropdown.
- CSV export (downloads all visible entities as `.csv`).
- HNWI/Gatekeeper badges now color-coded with icons.
- Proximity score badge shown inline in table rows.

## Search endpoint
- `POST /api/search/hnwi` — filters by country, assetTypes, score range, netWorth, proximity, hotOnly. Results cached 30s. Over-fetches then post-filters for asset-type and proximity (both require join/metadata parse).
- `GET /api/search/hnwi/facets` — available nationalities, asset types, proximity levels. Cached 5 min.

**Why:** Drizzle doesn't support OR-across-array-of-conditions natively, so country filter uses raw SQL `LIKE` with OR reduction.
