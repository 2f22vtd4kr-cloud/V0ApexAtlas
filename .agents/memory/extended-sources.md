---
name: Extended Sources — Phase 8
description: Three new data source ingestors/enrichers added in Phase 8, and the Data Sources dashboard page
---

## New ingestors/enrichers

| Source | File | Kind | Endpoint |
|--------|------|------|----------|
| OCCRP Aleph | `occrp-enricher.ts` | enricher | POST /ingest/occrp |
| UK Land Registry OCOD | `land-registry-ingestor.ts` | ingestor | POST /ingest/land-registry |
| OpenSky Network | `opensky-ingestor.ts` | enricher | POST /ingest/opensky |

## Key implementation notes

**OCCRP Aleph:**
- Free REST API at `https://aleph.occrp.org/api/2/entities?q=<name>&filter:schema=Thing`
- Hard gate: ≥75% word overlap required to avoid false positives
- Rate limit: 1.1s between requests — do not reduce
- Sets `isHot=true` if entity appears in any dataset matching `/sanction|watchlist|ofac|interpol|fatf|pep|oligarch/i`

**UK Land Registry OCOD:**
- CSV at `https://use-land-property-data.service.gov.uk/files/ocod/OCOD_FULL.csv` — may require fresh download link from portal
- Has a fallback URL; if both fail, error message includes the portal URL with instructions
- Streaming download to disk (no in-memory buffering); custom CSV parser handles quoted fields
- Dedup by Title Number via Redis; 30-day cache before re-download
- `estimatedValue` field populated from `Price Paid` column; Bayesian score scales with value

**OpenSky Network:**
- `GET https://opensky-network.org/api/states/all` — no auth, 60 req/hour limit on free tier
- Match strategy: `callsign.trim().toUpperCase() === asset.identifier.toUpperCase()` (N-number)
- Updates `assetsTable.lastActivityDate` + `metadata.opensky.{icao24, altitudeFt, speedKnots, ...}`
- Sets `entitiesTable.isHot=true` for owners of airborne jets

## Data Sources page
- Route: `/data-sources`, nav label "Data Sources" (Radio icon)
- Phase 8 sources shown first; Phase 1 core sources below
- Each card: source type badge (ingestor/enricher), run button, live job progress bar + log tail
- EASA shown as "coming soon" (no standardised European bulk registry API)
