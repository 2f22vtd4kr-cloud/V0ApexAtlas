---
name: Apex Profile Card (Phase 6)
description: Phase 6 implementation — what was built and where it lives
---

# Apex Profile Card — Phase 6

## What was built
New page: `artifacts/apex-finder/src/pages/profile.tsx`  
Route: `/profile/:id` (added to `artifacts/apex-finder/src/router.tsx`)  
Entry point: profile icon (IdCard) in entity ledger desktop action column + mobile detail CTA

## 4 panels
1. **Asset Footprint mini-map** — react-leaflet MapContainer with CartoDB dark tiles, CircleMarker per asset (needs lat/lng), legend by category
2. **Confidence Breakdown** — SVG ring (overall 0-100) + 5 category bars: Identity(20%), Financial(25%), Network(20%), Registry(20%), Assets(15%)
3. **Source Ledger** — full-width table: every entity field + each asset + each relationship as a row with category badge, value, source registry, verified status
4. **Outreach Strategy** — session selector (latest first), winning path chain, MCTS iterations table (scrollable), pitch generator button → collapsible multi-message display

## Hooks used (all pre-existing, no new API endpoints needed)
- `useGetEntity(id)`
- `useListAssets({ entityId })`
- `useListRelationships({ entityId })`
- `useListResearchSessions({ entityId, limit: 10 })`
- `useRunResearch()` → `.mutate({ data: { entityId, depth: 4 } })`
- `useGeneratePitch()` → `.mutate({ id: sessionId })`

## Confidence scoring algorithm
- Identity: completeness of nationality/residences/contactMethod/phone|email/linkedinUrl (each 20%)
- Financial: netWorth present (40pts) + assetsWithValue*15 capped at 60pts
- Network: relationships.length * 12, capped at 100
- Registry: unique sources from sourceRegistries + asset.sourceRegistry, each 20pts, capped at 100
- Assets: fraction of assets with sourceRegistry * 100

## Why
No new backend endpoints needed — all data was already available via existing routes. Keeps the API surface clean.
