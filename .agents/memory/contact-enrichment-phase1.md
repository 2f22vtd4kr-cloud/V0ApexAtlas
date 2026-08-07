---
name: Contact Enrichment Phase 1
description: Architecture and key decisions for the Phase 1 contact enrichment pipeline (Companies House, contactConfidence scoring, DB schema)
---

## What was built

Phase 1 added a full contact enrichment pipeline:

1. **Schema**: `contactConfidence integer not null default 0` on `entitiesTable`
   - Drizzle property: `entitiesTable.contactConfidence` (camelCase!)
   - DB column: `contact_confidence`
   - **Why:** `sql\`${entitiesTable.contact_confidence}\`` silently produces empty string — ALWAYS use `entitiesTable.contactConfidence` or `gte(entitiesTable.contactConfidence, 50)` with Drizzle operators.

2. **Scoring**: `computeContactConfidence()` in `contact-confidence.ts`
   - email +40, phone +30, linkedinUrl +20, knownResidences (non-empty) +10 → 0–100

3. **Enricher**: `companies-house-enricher.ts`
   - CH endpoint: `GET /search/officers?q={name}&items_per_page=5`
   - Auth: `Basic ${Buffer.from(`${key}:`).toString("base64")}`
   - Rate limit: 550ms sleep between calls (CH allows ~2/s)
   - Name matching: word-overlap similarity ≥ 0.4 threshold
   - Graceful: if no `COMPANIES_HOUSE_API_KEY`, skips CH but still recomputes confidence

4. **Route**: `POST /api/ingest/companies-house-enrich`
   - Accepts: `{ entityIds?: number[], batchSize?: number, force?: boolean }`
   - 409 if same job already running (unless `force: true`)
   - Returns: `{ jobId, pollUrl, note }`
   - Poll via `GET /api/ingest/job/:jobId`

5. **Profile page enrich flow**: POST → get jobId → recursive setTimeout poll (2s) → on done, call `refetchEntity()`

**How to apply:**
- Run enrichment without CH key: still useful (recomputes confidence for all entities)
- Run with CH key: also extracts officer correspondence addresses → writes to `knownResidences` (JSON array, max 5 entries)
- Profile page: enrichDone state is local to page lifetime — user must re-click to re-enrich
