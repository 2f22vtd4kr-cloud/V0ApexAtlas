---
name: web-osint route wired to wrong function
description: web-osint-enrich was calling the shallow stub instead of the full AI-first pipeline — fix and diagnosis notes
---

# web-osint-enrich called wrong function

## The rule
`/api/ingest/web-osint-enrich` must call `deepWebOsintEnrich` (full AI-first pipeline), NOT `enrichEntityOsint` (shallow 4-step stub).

**Why:** `enrichEntityOsint` (lines 283–389 of `web-enricher.ts`) is a lightweight DDG + EDGAR + GLEIF + domain-guess function that returns in ~1.8s with no AI calls whatsoever. `deepWebOsintEnrich` (line 1494) is the real pipeline: Phase 0 fires Perplexity + Gemini + Tavily + Exa in parallel first, then scrapes citation domains, then runs Groq extraction.

**How to apply:** If `web-osint-enrich` ever reverts or gets copied, verify the import in `ingest-enrichment.ts` line ~31 imports `deepWebOsintEnrich` from `../lib/enrichment/web-discovery` (not `enrichEntityOsint`). The entity select must include `bayesianScore`. The `hasSignal` check uses `result.evidence.length > 0` (not `result.website` which doesn't exist on `DeepWebOsintResult`).

## Diagnosis signal
- `enriched: 0, skipped: 100` with ~1.8s/entity = wrong function (no AI firing)
- Logs will show zero "Phase 0" entries despite 100 entities processed
- `deepWebOsintEnrich` takes 30–120s per entity and logs every LLM call

## Gemini rate-limit behaviour
All 4 Gemini keys hit RPM cap simultaneously on the first entity of a batch (they share the same per-minute window). They auto-recover in 5 min. Perplexity + Tavily + Exa cover in the meantime — this is expected and not a bug.
