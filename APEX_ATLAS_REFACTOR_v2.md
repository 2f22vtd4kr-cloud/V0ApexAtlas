Apex Atlas Refactor (v2)

 Read this entire prompt before touching any file. This is a holistic architectural refactor, not a feature list. Every change below is justified by a concrete problem found in the current codebase. Implement them in the order specified — the order matters because later steps depend on earlier ones.

0. Project Identity

The product is renamed Apex Atlas (was "ApexFinder Pro"). Update every visible occurrence:

 artifacts/apex-finder/src/components/layout.tsx — both the desktop sidebar heading (line ~49) and mobile top bar (line ~147) currently say "ApexFinder Pro". Change both to "APEX ATLAS".
 artifacts/apex-finder/index.html — <title> and meta tags.
 artifacts/apex-finder/src/pages/manual.tsx — any "ApexFinder Pro" references in the Field Manual content.
 Footer version label in layout.tsx (currently Phase G · v0.3) → Atlas · v1.0.
Do NOT change directory names (apex-finder/) — that breaks imports. Only change user-visible strings.

1. The Core Architectural Problem (must understand before coding)

The current startup.ts exposes the inverted priority order. Here is the actual scheduling it runs:

TIME AFTER BOOT
WHAT FIRES
ROLE
15s	FAA/HMLR cluster + edge detection	Registry
25–42s	EDGAR co-filers, CH co-directors, EDGAR associates	Registry
90s	Bulk MCTS research	Internal analysis
95s	Companies House enrichment	Registry
120s, 300s, 600s, 1500s	In-house enricher passes 1–4	Internal enrichment
180s, 1200s	Persona improvement loop	Internal
240s, 1920s	Semantic embeddings	Internal
2,100s (35 min)	Deep web OSINT pass 1	Web OSINT — supposedly the core
2,700s (45 min)	Deep web OSINT pass 2	Web OSINT — supposedly the core
 
The broad web search engine — which the user defines as the core of the product — fires at minute 35. Everything before it is structured-registry ingestion. This is exactly backwards.

The refactor inverts this. Web OSINT broad search is the first thing that runs after DB warmup, with registries following as verification/corroboration anchors. The user wants: start broad ("search people everywhere"), collect from the open internet, then push the data through multiple critical filters, with registries serving as verification anchors — not as the main driver.

2. UI/UX: Declutter Without Redesigning

The visual style stays (dark, mono, primary accent). Only navigation structure, page composition, and feature visibility change.

2.1 Sidebar reorganization (layout.tsx)

The current sidebar has 11 top-level items with no clear hierarchy — every internal tool is exposed to the user. Replace with this 3-tier structure:

Main navigation (always visible):

Atlas (was Intelligence HQ) — / — overview + signals
Search (was Deep Search) — /search — the broad web-OSINT search entry point, the front door of the product
Profiles (was Entity Ledger) — /profiles — browseable, filterable list of discovered HNWIs
Network (was Network Graph) — /network — relationship graph
Workspace (collapsible section, collapsed by default):
5. Research Sessions (was Intel Terminal) — /research — MCTS investigation threads
6. Outreach Assistant — /outreach — new consolidated tool (see §5)
7. Pipeline (was Pipeline CRM) — /pipeline — Kanban for tracking outreach status

System (collapsed by default, admin-only feel):
8. Background Jobs — /jobs — consolidated status for all ingestors/enrichers/persona loops (replaces Data Sources page, see §2.3)
9. Field Manual — /manual — documentation

Removed from sidebar entirely:

 Persona Loop (/improvements) — moved into Background Jobs as a tab
 OSINT Tools (/osint-tools) — 4400-tool static catalog, not part of core flow. Move to a footer link inside Background Jobs
 Duplicates (/duplicates) — internal maintenance task. Trigger from Background Jobs
Update navItems array in layout.tsx accordingly. Group labels: main, workspace, system.

2.2 Dashboard declutter (dashboard.tsx, currently 803 lines)

The current dashboard embeds multiple <IngestionPanel> components directly (lines 493, 690, 756) — meaning a regular user landing on the dashboard sees FAA and Western HNWI ingestion UI. A user researching HNWIs does not want to see ingestion buttons.

Remove all <IngestionPanel> components from the dashboard. Replace with a single compact "Background Activity" card (bottom of right column) showing:

 One line: "X jobs running · Y entities processed in last hour"
 Link: "View Background Jobs →" → /jobs
The dashboard's job becomes purely: stats overview + hot leads + map. Ingestion is moved entirely to /jobs.

2.3 Consolidate Data Sources + Improvements + Duplicates → /jobs

Create a new page artifacts/apex-finder/src/pages/jobs.tsx that consolidates:

 The 15 ingestor/enricher cards from data-sources.tsx (1685 lines) — but as a tabbed "Sources" tab, NOT all visible at once
 The persona loop status from improvements.tsx (575 lines) — as "Persona Loop" tab
 The duplicate review from duplicates.tsx (340 lines) — as "Duplicates" tab
 A new "Live Activity" tab showing the current scheduled pipeline state (which jobs are queued/running/done) pulled from /api/ingest/jobs
The 4 tabs:

Live Activity (default) — current job statuses, last-run timestamps, next-scheduled-run
Sources — the 15 ingestor/enricher cards, but collapsed by default. Each expandable to show manual trigger + history.
Persona Loop — status + last sweep + manual trigger
Duplicates — review queue
The old data-sources.tsx, improvements.tsx, duplicates.tsx files are deleted; their content is migrated into jobs.tsx (or split into jobs/ subdirectory with 4 tab components).

2.4 Profile page focus (profile.tsx, currently 1447 lines)

The profile page does too much: identity, contact, assets, relationships, MCTS sessions, AND generates outreach sequences inline. Split into:

 Top half: Identity + Proximity Insights (the most important info — who this person is, how reachable, what their network looks like)
 Bottom half: Tabs:
 Assets & Sources — current Source Ledger table
 Network — embedded mini-graph of this entity's 1-hop relationships
 Research Threads — MCTS sessions for this entity (was the giant MCTS panel)
 Outreach Drafts — see §5
The current "Generate Outreach Sequence" button (lines ~1295–1350) — which produces "messages" displayed inline as if the app is sending them — is removed from the profile page. It moves to the dedicated Outreach Assistant (§5).

The mailto: link on the email field (line ~629) stays — that's standard contact, not "sending a message from the app."

3. Web-OSINT-First Pipeline (the core inversion)

This is the most important backend change. The current startup.ts runs ~25 setTimeout calls in a hardcoded flat list. Replace with a phase-based scheduler that runs in this strict order:

3.1 New file: artifacts/api-server/src/lib/pipeline-scheduler.ts

A proper scheduler with named phases, dependencies, and configurable intervals. Replace the 25+ setTimeout calls with this structure:

typescript

interface PipelinePhase {
  name: string;
  startsAt: number;        // ms after boot
  tasks: PipelineTask[];
  description: string;
}

interface PipelineTask {
  id: string;
  label: string;
  endpoint: string;
  body?: Record<string, unknown>;
  dependsOn?: string[];    // task IDs that must complete first
}
Phase 1 — Broad Web Discovery (fires first, at 15s)
The web is the primary source. Fire broad search BEFORE any registry ingestion, so discovered entities exist before registries try to verify them.

Tasks:

 web-discovery-seed — broad seed queries against DuckDuckGo/Bing for HNWI signals (yacht registrations, philanthropy boards, SEC filings mentions, luxury real estate transactions, family office announcements). Uses deep-web-osint.ts engine but in discovery mode (no entity ID input — it generates entities from search results).
 web-discovery-expand — iteratively expand: take discovered entities, build queries from their metadata, search again. MCTS-style expansion (use the existing mcts-agent.ts).
 web-discovery-pass2 — second broad pass with different query templates.
Phase 2 — Hybrid Analysis (fires at 120s, after Phase 1 has produced candidates)
Tasks:

 hybrid-search-index — runs BM25 + TF-IDF + semantic embedding + graph signals on the discovered candidates (existing hybrid-search.ts).
 bayesian-scoring — runs bayesian-scorer.ts on every discovered entity to produce initial reach/signal scores.
 semantic-dedup — existing semantic entity resolution.
Phase 3 — Critical Filters & Verification (fires at 300s)
Now we filter the broad web data. The user's exact words: "you can't trust the internet, analysis and selection of web data gotta go through even more sophisticated critical thinking process and deduction."

Tasks:

 filter-verification-registry-anchor — for each discovered entity, query registries (FAA, EDGAR, CH, BRREG) to CONFIRM existence. This is where registries come in — as verification anchors, not as the primary ingestion source.
 filter-cross-source-corroboration — require N independent sources for any data point. Existing logic in deep-web-osint.ts already does this (confidence scoring by source count); elevate it to a mandatory gate.
 filter-dedup-strict — strict dedup (existing duplicates logic).
Phase 4 — Enrichment (fires at 600s)
Only entities that survived Phase 3 filters get enriched. This is where in-house-enricher.ts, companies-house-enricher.ts run — but only on verified entities, not on the raw FAA dump.

Phase 5 — Continuous Background (recurring, every 30 min)

 Re-run Phase 1 broad discovery with new query templates.
 Re-run Phase 3 verification on any new entities.
 Persona loop runs here (background, never foreground).
3.2 Delete the flat setTimeout list in startup.ts

The current startup.ts (719 lines) has 25+ setTimeout calls. Delete them all. Replace with:

typescript

import { runPipeline } from './pipeline-scheduler';
runPipeline();  // handles all phases, dependencies, intervals
The cold-start ingestion (FAA/HMLR/Western-HNWI when DB is empty) stays as a special case — but only as a seed for the verification layer, not as the primary data source. When the DB is empty, the cold-start runs Phase 1 broad discovery immediately (not FAA ingestion at 15s).

3.3 Unify the 5 enricher modules

Current state — 5 overlapping enricher files:

 in-house-enricher.ts (1472 lines — Wikidata, GitHub, Gravatar, email patterns, DNS, RDAP)
 deep-web-osint.ts (522 lines — DuckDuckGo, Bing, page scraping)
 web-osint-enricher.ts (325 lines — DuckDuckGo, EDGAR, GLEIF, OpenCorporates)
 hunter-enricher.ts (256 lines — dead code, references paid Hunter.io API that was replaced)
 companies-house-enricher.ts (316 lines — UK Companies House officer lookup)
Consolidate into a single enrichment/ directory:

 enrichment/web-discovery.ts — the broad search engine (merge deep-web-osint + web-osint-enricher). This is the Phase 1 core.
 enrichment/structured-verification.ts — registry lookups for verification (companies-house-enricher + FAA/HMLR/EDGAR lookups). This is Phase 3.
 enrichment/contact-enrichment.ts — Wikidata, GitHub, Gravatar, email patterns, DNS, RDAP (from in-house-enricher). This is Phase 4.
 Delete hunter-enricher.ts — dead code, references a paid API that was explicitly replaced.
Each enricher exports a common interface:

typescript

interface EnrichmentSource {
  id: string;
  phase: 1 | 3 | 4;
  discover(query: DiscoveryQuery): Promise<DiscoveredEntity[]>;  // Phase 1
  verify(entity: Entity): Promise<VerificationResult>;            // Phase 3
  enrich(entity: Entity): Promise<EnrichmentResult>;              // Phase 4
}
4. Backend Modularization

4.1 Split god modules

 in-house-enricher.ts (1472 lines) → split by source: enrichment/sources/wikidata.ts, enrichment/sources/github.ts, enrichment/sources/gravatar.ts, enrichment/sources/email-patterns.ts, enrichment/sources/dns.ts, enrichment/sources/rdap.ts. Each <300 lines. An enrichment/sources/index.ts orchestrates.
 persona-engine.ts (1342 lines) → split: persona/engine.ts (orchestrator), persona/personas/ (one file per persona type — Data Engineer, Data Analyst, Intel Systems Analyst, etc.), persona/reports.ts (output formatting).
 routes/ingest.ts (1835 lines) → split by ingestor family: routes/ingest/registry.ts (FAA, HMLR, Western-HNWI), routes/ingest/enrichment.ts (in-house, deep-web, companies-house), routes/ingest/maintenance.ts (dedup, clusters, backfill). Each <600 lines.
 routes/research.ts (787 lines) → split: routes/research/mcts.ts, routes/research/pitches.ts, routes/research/bulk.ts.
4.2 Remove dead code

 artifacts/apex-mobile/ — entire directory. It's a separate Expo mobile app that duplicates functionality. The product is the web app (apex-finder). Mobile users access it via responsive web. Delete the directory; remove from workspace config.
 artifacts/mockup-sandbox/ — entire directory. This is a design sandbox with mockup components (DashMobile.tsx, CrmMobile.tsx, etc.) that were used for UI exploration. None of it is imported by the real app. Delete.
 hunter-enricher.ts — as noted in §3.3.
 Any improvements.md phase-tracking content older than the current refactor — move to an archive/ directory. Keep the file but reset its content to "Apex Atlas v1.0 refactor — see CONTEXT.md."
4.3 Job queue visibility

The current job-queue.ts (190 lines) works but has no UI for monitoring. The new /jobs page (§2.3) needs an endpoint:

 GET /api/ingest/jobs — returns all job types with current status, last-run timestamp, next-scheduled-run (from the new pipeline-scheduler), and last-run metrics (inserted/skipped/errors).
This is what the "Live Activity" tab polls.

5. Outreach Assistant (replaces "send message" pattern)

The current profile page generates "outreach sequences" inline and displays them as if the app is sending messages. The user is explicit: "every communication is meant to be a user further job and a prompt inside ApexFinder."

5.1 New page: artifacts/apex-finder/src/pages/outreach.tsx

A dedicated tool, not embedded in profiles. The flow:

Select a profile — search/select an entity from the Atlas
Context assembly — the assistant pulls: entity's proximity insights, MCTS winning path (from research sessions), known assets, shared connections. Displayed as a "briefing" the user reads.
Draft generation — user clicks "Draft outreach". The pitch-generator.ts (483 lines, already exists) generates a multi-step sequence. Displayed as editable text areas (user can edit before copying).
Copy / Export — each step has a "Copy" button. No "Send" button. The user pastes into their own email/LinkedIn/TG client.
Status tracking — optional: user can mark a draft as "Sent externally" which moves the entity in the Pipeline CRM (§2.1 item 7). This is the only connection between the assistant and the CRM.
5.2 Remove from profile.tsx

Delete the inline pitch generation UI (lines ~1295–1350 in profile.tsx). The profile page's "Outreach Drafts" tab (§2.4) only shows drafts that were already created via the Outreach Assistant — it's a read-only history, not a generator.

6. Continuous Background Enrichment (the "always searching" requirement)

The user's complaint: "sources aren't being constantly searched for in background." The current pipeline runs once per boot (the 25 setTimeouts) and stops. There is no recurring interval.

6.1 Recurring scheduler in pipeline-scheduler.ts

After the initial 5 phases complete (roughly 30 min after boot), the scheduler enters continuous mode:

 Every 30 minutes: re-run Phase 1 broad discovery with a rotating set of query templates (cycle through 50+ template variations so each run discovers new ground).
 Every 2 hours: re-run Phase 3 verification on entities discovered in the last 2 hours.
 Every 6 hours: re-run Phase 4 enrichment on entities that have been verified but not yet enriched.
 Every 24 hours: persona loop sweep (existing persona-engine.ts).
Each recurring run respects rate limits (existing UA rotation, existing Redis dedup) and uses heavy caching (existing Redis slot 1 + slot 2). The scheduler logs every run to the new /api/ingest/jobs endpoint so the user can see "last broad discovery run: 12 min ago, found 47 new candidates."

6.2 Query template rotation

Create enrichment/query-templates.ts with 50+ broad discovery query templates that don't depend on a specific entity. Examples:

 "family office" + "London" + "director"
 "yacht registration" + "Mediterranean" + "owner"
 "philanthropy foundation" + "trustee" + "Switzerland"
 "luxury real estate" + "buyer" + "Monaco"
 "art collection" + "collector" + "auction"
 "private jet" + "registered owner" + "N-number"
The scheduler cycles through these so each 30-min run uses a different set, systematically covering the HNWI discovery surface over days.

7. Persona Loop Backgrounding

The current /improvements page (575 lines) exposes the persona loop as a foreground tool with manual triggers. The user wants it running in the background.

 Move the persona loop trigger from startup.ts line 585 (180s) and 608 (1200s) into the recurring scheduler (§6.1, every 24h).
 The persona loop's output (improvement suggestions) is logged to a persona_reports table (already exists).
 The new /jobs page "Persona Loop" tab shows: last run, next scheduled run, last 5 reports with "Apply" / "Dismiss" buttons. This is the only UI for persona — no separate page.
8. Execution Order

Implement in this strict order. Each step is independently testable.

Rename (§0) — 5 min, zero risk. Verify the app still boots.
Delete dead code (§4.2) — apex-mobile, mockup-sandbox, hunter-enricher. 10 min. Verify build still passes.
Sidebar reorg (§2.1) — 30 min. Just layout.tsx changes. Verify all routes still reachable.
Dashboard declutter (§2.2) — 30 min. Remove IngestionPanels, add Background Activity card.
Create /jobs page (§2.3) — 2 hours. Consolidate data-sources + improvements + duplicates.
Profile page split (§2.4) — 1 hour. Tabs, remove inline pitch generation.
Outreach Assistant page (§5) — 1 hour. New page, wire to existing pitch-generator.
Pipeline scheduler (§3.1, §3.2, §6) — 3 hours. The core inversion. Replace 25 setTimeouts with phase-based scheduler. Add recurring intervals. This is the biggest change — test thoroughly.
Enrichment consolidation (§3.3, §4.1) — 3 hours. Merge 5 enrichers into enrichment/ directory. Split god modules.
Query template rotation (§6.2) — 1 hour. 50+ templates for broad discovery.
Job visibility endpoint (§4.3) — 30 min. GET /api/ingest/jobs.
Persona loop backgrounding (§7) — 30 min. Move to recurring scheduler.
Total: ~13 hours of work. Do it in order, commit after each step, verify the app boots and the affected pages load before moving to the next.

9. What NOT to Change

 The dark visual style — colors, fonts, mono aesthetic, grid background pattern. All stay.
 The database schema — no schema migrations. The refactor is in code organization and pipeline ordering, not data model.
 The existing enricher logic — deep-web-osint.ts, in-house-enricher.ts have working logic. We're reorganizing them, not rewriting their internals.
 The API spec (lib/api-spec/openapi.yaml) — endpoints stay. We add /api/ingest/jobs but don't remove existing ones.
 The Field Manual content — documentation updates can come later.
10. Verification

After each step:

pnpm install (if dependencies changed)
API Server boots, /healthz returns 200
Web Frontend boots, no console errors
The affected page loads without errors
Existing data is still visible (no DB schema changes means no data loss)
After all steps:

Cold-start from empty DB → Phase 1 broad discovery fires at 15s (not FAA ingestion)
Sidebar shows 9 items in 3 groups (not 11 flat items)
Dashboard shows 0 IngestionPanels
/jobs page shows all 4 tabs
Profile page has 4 tabs, no inline pitch generation
/outreach page generates drafts with Copy buttons (no Send)
Background jobs recur every 30 min (check /api/ingest/jobs after 31 min)
No references to "ApexFinder Pro" anywhere in the UI
11. Report Back

After completing all steps, report:

 Files created, files deleted, files modified (with line counts)
 The new pipeline phase order with timestamps
 Screenshot of the new sidebar
 Screenshot of the new /jobs page
 Screenshot of the new /outreach page
 Confirmation that cold-start now fires broad web discovery first
 Confirmation that recurring scheduler is active (show the interval config)