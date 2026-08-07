---
name: Real OSINT data pipeline
description: How FAA/GLEIF/registry ingestion is wired; why curl+unzip instead of npm; mock data removal pattern
---

## Rule
Zero synthetic/mock data. Database starts empty; populate only from real public registries.

## FAA Ingestor Architecture
- Downloads registry.faa.gov/database/ReleasableAircraft.zip (~70MB) via `curl` shell exec
- Extracts MASTER.txt via `unzip` shell exec (avoids npm zip packages with ESM/CJS issues in esbuild bundle)
- Streams line-by-line with Node readline (pipe-delimited, latin1 encoding)
- Filter: STATUS=A, INDIVIDUAL_TYPES={1,2,4,7,9}, TURBINE_ENGINES={2,3,4,5} or multi-engine/rotorcraft
- Caches ZIP for 23h to avoid re-download; background job with Redis Upstash progress tracking

**Why curl+unzip:** npm zip packages (unzipper, adm-zip) have ESM compatibility issues in the esbuild ESM bundle.

## Mock Data Removal
- Removed seedMockData() and seedExtendedData() from artifacts/api-server/src/index.ts
- On fresh repo import: existing DB has old mock data — must DELETE from tables in FK order:
  research_sessions → relationships → assets → entities

## Registry Client Extension Pattern
1. Create lib/<source>-client.ts
2. Add to RegistrySearchParams.registry union in registry-client.ts
3. Add dispatch case in searchRegistry()
4. Add validation in /registry-search route

## Dashboard Empty State
- Checks stats.totalEntities === 0 to show EmptyState component
- EmptyState buttons set ingestionSource state (faa | western-hnwi)
- IngestionPanel accepts source + autoStart props; auto-starts on mount when autoStart is set
