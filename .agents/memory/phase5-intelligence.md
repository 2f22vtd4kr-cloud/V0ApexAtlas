---
name: Phase 5 Intelligence & Reliability Hardening
description: What was built in Phase 5 — OCCRP adverse media, OpenSky flights, graph contact rings, Bayesian contact signal, smoke tests, entity pagination.
---

# Phase 5 — Intelligence & Reliability Hardening

## Backend changes

### New endpoints (entities.ts)
- `GET /api/entities/:id/occrp` — reads `entity.metadata.aleph`, returns `{ entityName, aleph }`. Returns null aleph when not yet enriched. Returns 400 on non-numeric id, 404 on missing entity.
- `GET /api/entities/:id/opensky` — reads aviation assets for entity, returns `{ flights: [...] }` where each flight has `opensky` metadata (altitudeFt, speedKnots, originCountry, onGround).

### Graph node enrichment (graph.ts)
- `vertexToNode` now includes `contactConfidence` and `contactEmail` in the returned node object.

### Bayesian scorer (bayesian-scorer.ts)
- Added `contactConfidence?: number` to `EntityScoringInput`.
- Added signals: `contact_high` (weight 0.7, LR 3.0) for conf ≥70, `contact_partial` (weight 0.4, LR 1.6) for conf ≥30.

### Research route (research.ts)
- Passes `contactConfidence: targetEntity.contactConfidence ?? 0` to `computeBayesianScore`.

## Frontend changes

### Graph (graph.tsx)
- `drawContactRing` function draws a glow ring around entity nodes based on contactConfidence. Green ≥70, amber 30–69, skipped if ≤0. Wired via `nodeCanvasObjectMode="after"` + `nodeCanvasObject`.

### Profile (profile.tsx)
- Added `useEffect` import.
- OCCRP + OpenSky state fetched via two `useEffect` calls on `entityId`.
- "Adverse Media" card: sanctions badge (red/green), dataset tags, Aleph URL.
- "Live Flight Intel" card: per-aircraft altitude, speed, origin, airborne status.
- Both cards only render when data or loading state is non-empty.

### Entity Ledger (entities.tsx)
- `page` state + `useEffect` to reset on filter changes.
- `useListEntities` uses `limit: 50, offset: page * 50`.
- Footer: Prev/Next pagination controls (Next disabled when < 50 results returned).

## Smoke tests (api-server)
- vitest installed. `pnpm --filter @workspace/api-server test` runs 12 tests, all passing.
- Covers: healthz, entity list shape + filters, dashboard KPIs, OCCRP endpoint (valid/400/404), OpenSky endpoint (valid/400), registry-search reachability.

**Why:** Dashboard stats uses `totalEntities`/`avgBayesianScore` (not entityCount/avgSignalScore) — always check actual API response before writing assertions.
**Why:** OpenCorporates requires API key — registry-search returns 500 without one; smoke test accepts [200, 500] from that endpoint.
