---
name: Phase J4–J9 completion
description: Architecture and file locations for the fully implemented Phase J contact discovery pipeline (J4 domain resolution through J9 source quality dashboard).
---

# Phase J4–J9 — Implementation Summary

## Files Written

| Module | File | Purpose |
|---|---|---|
| J4 | `artifacts/api-server/src/lib/domain-resolver.ts` | `resolveEmployerDomain(entity)` — GLEIF fuzzy, metadata URL extraction, DNS MX+SPF verify; returns `{ domain, confidence, mxVerified, officialContactPaths[], spfProvider }` |
| J5 | `artifacts/api-server/src/lib/digital-footprint.ts` | `discoverDigitalFootprint(entity, domain, contactPaths, cooldowns)` — 7 DDG query templates + contact-page scraper; returns `FootprintEvidence[]` + `cooldownUpdates` |
| J6 | `artifacts/api-server/src/lib/contact-attribution.ts` | `scoreAttribution(params)` — 5-dimension geometric mean (sourceAuthority, corroboration, validation, directness, domainFit); threshold 0.52; `isGenericLocalPart()` blocks org inboxes |
| J7 | Phase J route + `enrichment_state.source_cooldowns` | Per-source ISO cooldown timestamps; `mergeCooldowns()` keeps furthest-future value; `nextAttemptAt` gates selection |
| J8 | Phase J route + `loadNeighbourContext()` | Fetches entity names/domains from neighbour IDs via `relationshipsTable`; passes to J5 as `graphNeighbourDomains`/`graphNeighbourNames` |
| J9 | `GET /pipeline/phase-j/source-quality` | Queries `contact_evidence` grouped by source; returns per-source verified/candidate/rejected counts, avg reliability, avg directness, entity coverage |

## Routes (all in `artifacts/api-server/src/routes/phase-j.ts`)

- `GET /pipeline/phase-j/status` — Returns `implementation: { J0…J9: true }` with module descriptions; no stubs remain
- `POST /ingest/phase-j-pass` — Starts a J4-J9 pass over due candidates (respects `nextAttemptAt` cooldown)
- `POST /pipeline/phase-j/checkpoint` — Saves a J9 re-import funnel snapshot
- `GET /pipeline/phase-j/source-quality` — J9 source quality dashboard (per-source stats + outcome summary)

## Frontend (Data Sources page)

- `PhaseJCompletionPanel` — expanded with 8-stat grid (found / domains J4 / identity / direct / attributed J6 / social-only / org-contact / errors), collapsible J4–J9 module badge breakdown, enrichment state outcome pills
- `SourceQualityPanel` — new J9 panel below; fetches source-quality endpoint; shows outcome distribution + per-source evidence table

## Key Design Decisions

**Why geometric mean for attribution score:** Ensures all five dimensions must be non-trivially present; a zero in any dimension collapses the score, preventing high-corroboration but unverified emails from passing.

**Why threshold 0.52 (not 0.5):** Gives a 4% buffer above random to reject borderline marginal candidates without requiring very high confidence across all dimensions.

**Why `mergeCooldowns` keeps furthest-future cooldown:** Prevents a fast-executing source from immediately re-queuing an entity that another slow source just cooled down.

**How to apply:** When running Phase J passes, the entity selection query filters on `nextAttemptAt <= NOW() OR IS NULL`. Always call `resolveEmployerDomain` first (J4) before J5 footprint discovery because J5 uses the resolved domain to scrape official contact pages.
