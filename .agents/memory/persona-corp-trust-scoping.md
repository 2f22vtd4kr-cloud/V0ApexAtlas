---
name: Persona engine Corp/Trust scoping
description: Corp and Trust entities should get LOW/skipped flags in persona engine; backfill-net-worth endpoint
---

Corp and Trust entities (typically 60–75% of the portfolio) are property/investment vehicles, not direct outreach targets. Treating them identically to HNWI/Gatekeeper inflates flag counts and misdirects operator attention.

**Scoping rules (persona-engine.ts):**
- `runBusinessEngineer`: "isolated node" flag is HIGH for HNWI/Gatekeeper, LOW for Corp/Trust (with a different description explaining CH co-director edges are the correct path)
- `runUxDesigner`: "no geolocated assets" flag is skipped entirely for entities whose `sourceRegistries` includes "land registry", "hmlr", or "price paid" — property titles don't have GPS coordinates and the address is the asset
- `runDataEngineer`: `isDirectTarget = entity.type === "HNWI" || entity.type === "Gatekeeper"` gate already in place — contact/residence flags only fire for direct outreach targets

**Why:** These checks were added after simulation runs showed 70% of high-priority flags were noise for Corp/Trust entities that are functioning correctly as property vehicles.

**Backfill net worth endpoint:**
- `POST /api/ingest/backfill-net-worth` — sets `estimatedNetWorth = total_asset_value × 3` for entities with null net worth and total assets ≥ £1M
- Eliminates `data_analyst` persona flags ("HNWI with zero registered net worth")
- Button added to Data Sources page under "EDGAR Stock Assets"
