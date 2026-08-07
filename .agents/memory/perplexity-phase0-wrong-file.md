---
name: Perplexity Sonar Phase 0 — correct file
description: Phase 0 must live in web-enricher.ts, not deep-web-osint.ts; the route uses the web-enricher path.
---

# Perplexity Sonar Phase 0 — correct implementation file

## The rule
Phase 0 (Perplexity Sonar) belongs in `artifacts/api-server/src/lib/web-enricher.ts`, NOT in `lib/deep-web-osint.ts`.

**Why:** The route (`routes/ingest-pipeline.ts`) imports `deepWebOsintEnrich` from `lib/enrichment/web-discovery.ts`, which is a barrel that re-exports from `lib/web-enricher.ts`. The `lib/deep-web-osint.ts` file is a legacy file that is no longer called by the route. Any enrichment logic added there is silently dead.

**How to apply:** When adding new phases or modifying the deep-web enrichment pipeline, always edit `lib/web-enricher.ts`. The import chain is:
```
routes/ingest-pipeline.ts
  → lib/enrichment/web-discovery.ts  (barrel)
    → lib/web-enricher.ts            (← LIVE implementation)
```

## Confirmed fix (2026-07-26)
- Added `researchWithPerplexity` to the import on line 18 of `web-enricher.ts`
- Inserted Phase 0 block before Phase 1 (DDG) in `deepWebOsintEnrich`
- Live result: first entity processed → `hasEmail: true, owners: 1, ownerContacts: 1`
