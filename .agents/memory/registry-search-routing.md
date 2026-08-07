---
name: Registry search routing
description: Where the live registry search endpoint lives and why it's not admin-protected
---

## Route location

`POST /api/registry-search` — in `artifacts/api-server/src/routes/ingest.ts`, registered **before** the `router.use("/ingest", adminOnly)` middleware line.

This means it does NOT require the SESSION_SECRET admin bearer token, which is intentional — the frontend calls it directly without any auth header.

## Why not /ingest/registry-search

The `/ingest/*` path prefix is protected by adminOnly middleware. Placing the route at `/registry-search` (no `/ingest/` prefix) in the same ingest router keeps it in the same file but out of the admin guard.

## Registries supported

- `opencorporates` — free, no key, ~50 req/day rate limit
- `companies-house` — requires `COMPANIES_HOUSE_API_KEY` env var; searches both companies AND officers (officers returned as HNWI type)

## UI flow

Live Intel button (Globe icon) in Entity Ledger expands a search panel → results appear → "Add" pre-fills the Add Entity slide-over form → user saves → entity created via POST /api/entities.
