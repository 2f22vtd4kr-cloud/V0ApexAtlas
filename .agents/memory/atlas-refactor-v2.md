---
name: Atlas Refactor v2 state
description: Completion state of APEX_ATLAS_REFACTOR_v2.md items; what's done and what remains.
---

## Done (all verified: API build clean, frontend build clean, screenshot confirmed)

- **Product rename** — layout.tsx = "APEX ATLAS", footer = "Atlas · v1.0"
- **3-tier sidebar** — mainNav / workspaceNav / systemNav collapsible sections
- **Router** — all new paths wired; legacy paths redirect
- **`/jobs` page** — 4 tabs: Live Activity, Sources, Persona Loop, Duplicates
- **Dashboard cleanup** — IngestionPanel removed; compact Background Activity card
- **outreach.tsx** — page exists and is routed at /outreach
- **Phase-based scheduler** — startup.ts uses typed Phase[] array
- **`ingest.ts` split** — 395 lines; mounts ingest-enrichment, ingest-migrations, ingest-pipeline sub-routers
- **hunter-enricher.ts deleted** — POST /ingest/hunter-enrich returns 410
- **Profile tab split** — 4 tabs: Assets & Sources, Network, Research Threads, Outreach Drafts. Inline "Generate Sequence" pitch UI removed from Research Threads tab. Outreach Drafts tab shows read-only pitch history + link to /outreach.
- **`research.ts` split** — thin router mounts: routes/research/mcts.ts (POST /research/run), routes/research/sessions.ts (GET/PATCH sessions), routes/research/pitches.ts (POST pitch + backfill), routes/research/bulk.ts (POST /research/lead + bulk-run)
- **Enrichment consolidation** — lib/enrichment/web-discovery.ts, structured-verification.ts, contact-enrichment.ts barrel-export canonical files; all 5 import sites updated (ingest-enrichment.ts, ingest-pipeline.ts, ingest.ts)

**Why barrel pattern for enrichment:**
web-enricher.ts and web-osint-enricher.ts have duplicate exports (OsintResult, enrichEntityOsint). registry-enricher.ts is the canonical file for CH+OCCRP (not companies-house-enricher.ts). Barrel approach avoids name conflicts and preserves working implementations.

## Remaining
- **Field Manual content update** — lower priority; manual.tsx has no "ApexFinder Pro" refs but content still references old pipeline phase names. No code impact.
