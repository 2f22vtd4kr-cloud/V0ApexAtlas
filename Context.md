| 2026-08-06 | **First real Bureau discovery case completed**: Discovery case 3 ran the established Western-world investor mission through the shared case-context shaft. The randomized lane returned 19 review-only candidates/anchors: 10 named investment routes plus 9 registry-only anchors. The Bureau then continued through two bounded verification/tiering passes and a Gemini closure retry after a transient 503, ending at iteration 4 with 23 ordered reports and 20 review-only candidates/anchors. Mistral, registry, NVIDIA right-hand, and Gemini Boss reviews were persisted; no entities were inserted or promoted. The automated case is complete for review, with remaining uncertainty gates around independent identity evidence, named family-office decision-makers, and warm introduction paths. |
| 2026-08-04 | **Mobile Intelligence Reactor overhaul + controlled Atlas/persona run**: Rebuilt the mobile Reactor around compact live status, truthful completed/failed states, target/phase/queue telemetry, confirmed results, touch-sized event feed, and a scannable stage map. Completed Atlas run: 7 entities, 1 hot lead, 2 contacts, 0 errors. Completed full persona sweep: 7/7 entities, 4 suggestions, 0 errors. API/Redis healthy. |
| 2026-08-03 | **Bounded single-target Atlas mode + desktop telemetry inspector**: Added `singleTargetId` launch support that runs one existing entity through the complete target-scoped enrichment and optional UCT journey without discovery, registry ingestion, or global backfills. Desktop Reactor now shows target, stage, active tool, tool set, prompt, inputs, and result telemetry in a live inspector. |
| 2026-08-03 | **Overnight workflow monitoring hardening**: Development and OSINT review personas confirmed mixed registry/web discovery, strict one-target-at-a-time enrichment, and fail-closed evidence promotion. Tightened Atlas single-target ID parsing and documented that auto-pipeline must remain disabled for idle-safe review-only runs. |
| 2026-08-03 | **Atlas overnight run completed and audited**: Job `a5da1294-4322-4337-ac29-767635a68732` ran for 35 minutes with 21 randomized source rounds, strict single-target cooking, 7 newly admitted entities, and 22 total visible entities. Stored results show 20 assets, 0 relationships, 0 hot leads, 0 promoted/validated direct contacts, 155 review-only contact candidates, 16 manual-review research sessions, and 64 review-only research evidence rows. Provider limits affected Perplexity, Tavily, Gemini, and Groq; Exa remained usable. API/Redis are healthy and Atlas is idle. |
| 2026-08-03 | **Gemini quota-pool update**: Added ten Gemini secret slots to the provider pool and switched grounded research plus wealth estimation from `gemini-2.0-flash` to lower-quota `gemini-2.0-flash-lite`. Both imported API source trees now recognize `GEMINI_API_KEY_1` through `_10`; no provider run was started during the change. |
| 2026-08-03 | **Controlled sequential ingestion and research audit**: Live Western HNWI ingestion admitted 15 registry-backed records from 100 requested, skipped 101 duplicates, and reported 1 source error. All 15 admitted records were corporations; each then ran through bounded single-target Atlas enrichment plus UCT research strictly one at a time. 14 targets completed with 0 errors and 1 completed with 1 recoverable enrichment error; all 15 stayed `needs_follow_up` / `manual_review`, with 0 promoted emails, phones, social contacts, hot leads, or outreach drafts. Final API/Redis health was green and Atlas idle. Provider evaluation showed Perplexity quota exhaustion, Tavily plan limits, and Gemini rate limits; Exa returned evidence for some searches. |
# ApexFinder Pro — Session Context

> **ABSOLUTE RULE — no exceptions:**
> 1. Read `replit.md` AND `Context.md` at the start of every session (especially after any GitHub import).
> 2. Update `Context.md` after every meaningful iteration — update Current State + append to Iteration Log.
> 3. Update `replit.md` whenever env vars, DB counts, schema, or phases change.
> 4. Both files must be committed to the repo as part of any task that changes project state.

---

## Current State (2026-08-06 — adaptive research director verified)

- Added the durable, target-scoped Case Bureau architecture on top of the adaptive director. Each target can now have one PostgreSQL-backed case with an append-only event trail, explicit objective/motivation, local Head Investigator mode, specialist roster, shared case file, action queue, human directives, and ranked contact-route summary.
- Added `POST/GET /api/research/cases`, `POST /api/research/cases/:entityId/advance`, `POST /api/research/cases/:entityId/directive`, and `GET /api/research/cases/:entityId/events`. The first director is provider-key independent and assigns existing Apex tools deterministically; the contract leaves room for a later model-backed director without creating a parallel pipeline.
- The Research desk now exposes the living case, next action, specialist roster, human directive input, evidence counts, and broad human-review contact hierarchy. No contact is promoted or outreach is generated by the bureau layer.
- Validation: `research_cases` and `research_case_events` schema pushed; API codegen, library typecheck, ApexFinder typecheck, and production API build passed; managed API/web workflows restarted; `/api/healthz` returned 200 with Redis healthy. A clearly labeled synthetic target was used for live open/get/advance/directive/events verification and then deleted; cleanup confirmed 0 matching entities, cases, and events.

- Added a bounded, target-scoped adaptive research director before the canonical Phase 0 provider pass. It keeps explicit state for identity, structure, official domains, named people, follow-ups, provider lanes, progress, and stop conditions; each result selects the next action instead of blindly repeating a fixed ladder.
- The director supports identity resolution, operator/parent structure, official-route discovery, named-person follow-up, exact-claim verification, complementary provider lanes, and bounded review stops. It filters navigation/page-noise names and prioritizes official domains before generic routes.
- Adaptive results feed the existing canonical `web-enricher.ts` evidence path: discovered people and domains influence exact-page scraping and later follow-ups, while provider citations and contacts remain review-only until exact-page/provenance adjudication. No guessed contacts, AI-only promotion, organization-to-person promotion, or outreach behavior was added.
- A compact `adaptiveResearchTrace` is persisted alongside the existing investigator plan, lane coverage, search gaps, route hierarchy, and `deepWebYieldMetrics` in both enrichment routes. Full provider payloads remain in the evidence ledger rather than being duplicated in entity metadata.
- Validation: focused adaptive tests and the existing cascade tests passed; full API suite passed 40 files / 267 tests; production API build passed; managed API workflow restarted successfully; `/api/healthz` returned Redis-healthy `200`. No live Atlas benchmark was launched, so useful-yield superiority remains unclaimed until measured.

## Current State (2026-08-06 — yield widening and runtime metrics verified)

- The evidence-hardening pass is followed by a bounded yield-widening pass. Person extraction now retains up to 12 candidates, corporation person-hop follow-up covers up to 8 names, and targeted AI follow-up covers up to 6 names; existing identity, attribution, exact-page, generic-mailbox, and reachability gates are unchanged.
- Deep-web query retention is widened to 20 queries, French/Qwant and Bing lane coverage to 5 queries each, official corp/team-page result retention to 14 pages, follow-up citation scraping to 10 URLs, and exact claim-page verification to 12 URLs. Provider structured outputs retain larger owner/citation sets.
- Both deep-web enrichment routes persist `deepWebYieldMetrics`, covering queries, pages, evidence rows, people, owner resolutions, candidate routes, verified direct routes, review routes, and source-domain diversity. This enables comparison against single-provider/manual research by useful yield rather than raw tool count.
- Validation: full API suite passes 39 files / 264 tests; production API build passes; managed API workflow restarted successfully; `/api/healthz` returns Redis-healthy `200`. No Atlas research or ingestion benchmark was launched during this iteration, so superior useful-yield performance is not yet claimed.

## Current State (2026-08-05 — provider research lanes and target anchors verified)

- The API-key health bug is corrected. Tavily's main enrichment request now uses the documented `Authorization: Bearer` header instead of placing the key in the JSON body. Tavily 401/403/432 provider/account responses no longer suppress individual keys; Gemini/Tavily 429s are temporary `rate_limited` cooldowns honoring `Retry-After`, not `exhausted` keys.
- 2026-08-05 follow-up: added `TAVILY_API_KEY_6` through the secure secret flow after the original Tavily pool returned account quota 432 responses. The API now circuit-breaks Tavily 432 keys for 24 hours, leaving fresh slots eligible after restart; the web key-status panel wraps long provider summaries and clips horizontal overflow on narrow mobile viewports.
- After the API restart cleared stale in-memory cooldowns, live `/api/system/status` reported Groq 5/5 active, Gemini 4/4 active, Tavily 6/6 active, Exa 2/2 active, and zero temporary cooldowns. The screenshot's Tavily account-credit display is separate from per-key configuration state.
- Phase 0 web research now sends a shared target fingerprint to every provider: legal/trading name, city/country, compact registry or identifier anchors, and candidate domains. Perplexity, Gemini, Tavily, and Exa receive distinct research lanes (people/press, official records, contact routes, and semantic ownership discovery) instead of repeating generic contact searches. Raw residence text is intentionally not forwarded as an anchor.
- The structured prompt and provider query builder retain claim-level provenance, explicit identity uncertainty, negative findings/search gaps, and reachability realism. Candidate domains and record anchors remain disambiguation leads only; server-side evidence adjudication remains authoritative.
- The shared web header now has a live whole-workspace indicator on every route. It polls Atlas status and service/provider health, distinguishes active discovery/enrichment from queued, ready, degraded, and offline states, and links to Reactor and full diagnostics without inferring activity from historical runs.
- Gemini Deep Research is embedded as an isolated, target-scoped provider lane inside canonical Phase 0 through the asynchronous Interactions API. It uses only the dedicated `GEMINI_API_KEY_11`–`_13` pool, remains review-only, and sends citations only into exact-page validation. Hugging Face Open Deep Research now cooperates in the same fan-out through `smolagents`, a configurable Hugging Face model, and Serper live search/page tools; its report/citations are also review-only, fail closed on provider failure, and never enter generic contact extraction.
- The mobile web header now has intentional spacing between the linked Apex Atlas home mark and the DB status control. The larger page title remains below the header; the 390px `/reactor` preview and web production build are clean.
- The bounded Atlas run `407455b5-8576-4a4b-b9b8-597a927369c3` completed in about five minutes with the corrected run-wide `targetCount` cap: one new target admitted across two source rounds, Phase J completed, zero hot leads, zero personal contact promotions, and one organization route visible in the dashboard. Provider behavior remained fail-closed: Tavily/Exa citations and one retained review claim were not sufficient for identity or personal-contact promotion; Deep Research/Hugging Face failures promoted no claims.
- The run-wide admission fix is in `atlas-orchestrator.ts` and `broad-discovery.ts`: discovery adapters receive remaining budget, the loop stops when the budget is reached, and the summary reports `admitted 1/1`. `ENABLE_AUTO_PIPELINE=false` remains the active shared setting, so Atlas is idle after the explicit run.

- Apex Atlas is now strictly an OSINT/evidence research tool. CRM, outreach, pitch generation, communication approval, message export, and lead-creation behavior are removed or unavailable; historical database columns remain compatibility-only and do not drive product behavior.
- Final verification completed: API production build and 244 API tests pass; web production build passes; Expo iOS/Android static bundles pass; API/Redis health and dashboard stats return 200; retired pitch, safety, status-mutation, and lead endpoints return 404; final web preview has no browser errors.
- Research sessions and dashboard compatibility responses use research/evidence terminology. The entity ledger supports CSV export and evidence research only; the mobile “Evidence Path” tab is read-only. Canonical API, web, mobile, and mockup workflows were restarted successfully.
- The previous discovery-first Atlas job `695d3303-413a-48ac-af0c-7930890dd110` was killed by an API process restart during Phase 8/J4 at 10/50 targets, with no provider error and no active lock remaining. A fresh bounded discovery-first replacement `6690ff6c-9dcc-47e6-a6df-44ae463505a4` completed successfully in 16 minutes with 15 entities, 7 fully cooked discovery targets, 2/2 MCTS targets researched, and 0 errors. Provider quota/auth responses remain non-fatal and fail closed; Phase 0 OpenOwnership and Foundation Filing stages emit target-scoped Reactor events with numeric ownership counts.
- The mobile Intelligence Reactor now leads with a live research console: current target, Atlas phase, target queue, current operation, research lanes, evidence counters, result summary, and expandable research input. The pipeline map remains secondary context.
- Stored audit results show 155 contact-evidence candidates, all review-only with no validated or promoted contact vectors; 16 research sessions, all `manual_review`; and 64 research-evidence rows, all `review`. The new target outcomes are `none` for six entities and `evidence_only` for ARETE CAPITAL; no email, phone, social contact, direct route, pitch, or outreach-ready record was promoted.
- The recovered Atlas job completed Phase 10 after 9 discovery source rounds, including 4 Companies House officers and one Companies House contact contribution. Exa returned usable evidence; Tavily usage limits and other provider limits constrained some lanes without crashing the worker. `ENABLE_AUTO_PIPELINE=true` now starts a single serialized discovery-first Atlas controller immediately after startup maintenance; it no longer waits for the old 46-minute one-shot schedule. The controller waits for each bounded Atlas cycle to reach a terminal state, then schedules the next cycle after 30 minutes, so provider failures and lock/no-target responses cannot stop future discovery or create overlapping Atlas workers.
- Live verification after the API restart confirmed scheduler activation at 14:20:05 UTC and automatic Atlas job `122104f3-b0fc-487b-b7a9-6acbc53ec33d` at 14:20:06 UTC. `/api/ingest/atlas-status` exposes durable scheduler telemetry (`enabled`, `active`, cycle count, last trigger/status/job, next trigger, lock skips, and provider/no-target count); the Reactor renders the continuous state on desktop and mobile. A later mobile runtime overlay exposed a missing page-level `scheduler` binding; the Reactor now derives that prop directly from `atlasState.scheduler`, and the live mobile `/reactor` preview is clean while Atlas cycle 2 continues. The lower Reactor map was also verified at 402×1400 after removing the inherited scroll-surface mask that faded the bottom 20% of content on iOS.
- Added nullable `entities.phone_source` to the Drizzle schema. Backfilled 19 legacy EDGAR/Companies House phone provenance markers from metadata; all 19 now classify as `organization_contact`, confidence 0, and `is_hot=false`.
- Atlas and both deep-web reachability paths now pass `phoneSource` into confidence/outcome/hot scoring and provider prompts. Registry phones cannot become personal reachability or make a target appear `DIRECT` through omitted source metadata.
- Generic HNWI search-result and scraped-page extraction now defaults to `person_candidate` review scope. Target-person scope is reserved for explicit target claims or exact fetched claim evidence.
- Contact sanitization rejects zero-prefixed registry-like phone identifiers before evidence persistence. Final Richard Leeds evidence retained candidate values for review, with no personal contact promotion.
- Validation completed: ApexFinder web production build, API production build, API/Redis health, 402×874 mobile screenshot, and `git diff --check`. The API typecheck baseline remains blocked by pre-existing workspace export/logger and duplicate legacy-tree errors.
- Added a configurable per-target enrichment deadline, defaulting to 180 seconds and clamped to 30–600 seconds at the Atlas route. Timed-out targets are recorded as `timeout_review` with an explicit retry action, `cookedAt` remains unset, the error count advances, and the sequential batch proceeds without promoting contacts. The timeout branch is covered by the built implementation and guard logic; the 30-second live canary completed before the deadline and therefore did not claim a timeout occurrence.
- Phase J accepts the parent Atlas job ID and mirrors Phase 8/entity progress into it. Live verification advanced the parent status through J4–J9 entities instead of leaving the Reactor misleadingly at Phase 1 while Phase J was active.
- Phase J now publishes structured target/stage/tool/result telemetry and the Atlas status endpoint exposes the separate Phase J worker snapshot (pass progress, persisted records, and errors). The recovered run passed the prior failure point and completed Phase J for each target-scoped batch without errors.
- Evidence-led narrative UI now separates `What they do` from `What we found` across dashboard priority cards, entity ledger cards, and desktop/mobile profile summaries. Work summaries use stored public role/headline, filing/company notes, asset categories, foundation, and registry evidence; findings include source, filing/company, nationality, location, assets, and public-profile evidence. Empty biography fields no longer produce an unhelpful biography-only state.
- The active managed web workflow serves `artifacts/apex-finder/src`; the mirrored `artifacts/apex-finder/apex-finder/src` tree was updated as well because both artifact copies exist in the imported workspace. Root ApexFinder build and typecheck pass, `git diff --check` passes, and live dashboard/profile screenshots show the new filing-based summaries with no browser errors. Atlas is idle after the successful recovery; `ENABLE_AUTO_PIPELINE=true` is persisted in shared environment configuration so the background scheduler remains enabled on future API boots.
- Durable Reactor event telemetry is now appended to the existing capped Redis job log and returned by `/api/ingest/atlas-status`; desktop and mobile render expandable target-scoped events with safe inputs, provider/tool names, result summaries, counts, and review/blocked states. The canonical web enricher emits provider fan-out and ensemble adjudication events through an optional callback, while the Atlas worker remains intentionally un-restarted until the active slot is released.
- Profile/entity narrative helpers now use conversational evidence-grounded language such as “This profile caught our attention…” and “So far, we found…”, without adding unsupported lifestyle or access claims. Sherlock is included in Atlas identity-discovery telemetry and remains review-only.
- Persona remediation now applies only reversible, evidence-backed state fixes: shared contact confidence/outcome/hot reconciliation, quarantine of deterministic placeholder or synthetic records, and clearing known fake contact patterns. Research recommendations that require new public evidence remain pending. Atlas Phase 9 and the launch-time repair now use the same shared classifier instead of raw SQL backfills, so candidate emails, registry phones, and organization evidence cannot become hot leads.
- Persona reruns now suppress duplicate `(entity, persona, title)` findings, high Bayesian wealth scores no longer recommend hot-lead promotion, and the legacy contact-confidence maintenance endpoint reconciles confidence, outcome, and hot state together.
- Duplicate persona findings are retained for audit but marked dismissed newest-first; the improvement UI exposes the cleanup job and progress rather than silently deleting history.

### Research improvement iteration (2026-08-02):
- The bounded discovery-first canary `cdd3085b-1842-4214-bf3e-4869dd974eb8` was intentionally stopped after live review found two quality failures: a role-shaped HNWI candidate (`Rocco Forte Deputy`) and corporation person-hop recipe/page noise (`Creamy Cucumber`, `Tomato Salad`). No replacement run was launched; Atlas is idle.
- Added deterministic role-only candidate rejection to broad discovery and expanded the corporation person-hop blocklist for editorial/recipe noise before provider fan-out. Existing interrupted-run records were not deleted or retroactively promoted.
- Root cause confirmed for the canary's impossible-looking names: when Groq discovery returned an empty/refused result, the old code incorrectly treated that as provider unavailability and ran a regex extractor over the same snippets. Regex could manufacture role/editorial phrases such as `Rocco Forte Deputy`, `Creamy Cucumber`, and `Tomato Salad`. The fallback now runs only when no Groq provider is configured; Groq-empty/error paths remain empty and the final LLM admission gate receives name + source snippet + query context and fails closed.
- Overnight monitor found two additional legacy-data paths without interrupting the active run: Groq discovery admission hit HTTP 429 and correctly admitted zero candidates (future validator calls now rotate through configured Groq keys before failing closed); an existing registry row named `Unknown` entered corporation AI OSINT and produced `Catholic Church`, `Roman Martyrology`, `Wikipedia Unknown`, and similar person-hop noise (future full-circle enrichment now skips placeholder entity names and blocks Wikipedia/religious-text tokens).
- The active run also exposed a non-fatal empty-evidence edge case: sanitization can remove every provider candidate, and Drizzle rejects `.values([])`. Both in-house and AI OSINT evidence inserts now guard empty batches. This was validated without restarting the active process.
- Added structured `atlasTelemetry` to Atlas job state with target, stage, tool IDs, redacted prompt purpose, result summary, evidence/source/contact counts, and review status. The mobile Reactor now presents a readable sequential stage flow with a real Liquid Glass inspector and CSS fallback; malformed telemetry fails closed.
- The mobile Reactor scroll boundary was hardened with flex `min-height: 0`, touch overscroll handling, and a viewport-safe page wrapper so the full phase timeline and expanded inspector remain reachable on narrow screens. Business interests are now modeled as idempotent `BusinessInterest` asset rows for confirmed corporations and strongly business-shaped, sourced records; personal luxury assets remain separate.
- A live data-quality audit found two legacy invalid rows that had bypassed newer admission gates: `Rocco Forte Deputy` (role-shaped snippet) and `Unknown` (placeholder). Both are now hidden, preserved for provenance review, and excluded from active research; stale promoted contact state on invalid rows is archived in metadata and cleared from active contact fields. `Viken Shipping` is correctly classified as a Corporation.
- The classifier now recognizes shipping/maritime industry names, Finnish `Oyj` corporate suffixes, role-shaped names, and placeholder names. Startup maintenance reclassifies legacy rows and quarantines invalid names idempotently before active results are served.
- The mobile Reactor no longer repeats its internal `ATLAS REACTOR` title beneath the global `APEX ATLAS / Intelligence Reactor` shell header. The corrected 390×844 screenshot has no browser errors.
- Fixed the frontend generated-hook query-key typecheck mismatch and added the `liquid-glass-react` dependency to the ApexFinder artifact. API build plus the full 211-test suite and web build pass; API/Redis health is green; the 390×844 Reactor screenshot has no browser errors.
- The current development runtime has 22 visible entities, 20 assets, 0 relationships, 0 hot leads, and 16 manual-review research sessions. The authorized overnight Atlas job completed and is idle.
- Added the final deterministic contextual-name gate after a live audit caught “James Bond” being extracted from Casino de Monte-Carlo copy. Fictional/cultural references are now excluded both during candidate validation and at the final insertion boundary; focused guardrail coverage is 20/20.
- The first run was stopped after live monitoring found a registry-company phone incorrectly labeled `direct_contact_verified`. The shared classifier, Phase J, Atlas backfill, contact-confidence recomputation, and legacy metadata recovery were hardened so EDGAR/Companies House phones remain organization contact only.
- Repaired the current development records with the idempotent contact-outcome backfill: 18/18 updated, 7 registry-phone records classified `organization_contact`, and the affected Samih Sawiris record now has `contactConfidence=0`, `isHot=false`, and no personal reachability count.
- The prior corrected run `ba12f043-148b-46d2-b35e-17e39eaecf55` was stopped after its first round exposed fictional/contextual extraction noise; those two records remain hidden for review. The current authorized run is the final retry above.
- The historical broad venue-owner source round completed with 0 inserted candidates: employee/management-directory names, service-page names, author/UI fragments, and names without candidate-attributed ownership/wealth evidence were rejected before insertion. No Atlas worker is currently running.
- A stricter candidate-attribution gate and regression tests were added to broad discovery. Records from interrupted historical runs are review context only; they are not active targets and no contacts or outreach were promoted from them. Current imported development counts are 0 visible entities, 0 hidden entities, 0 assets, 0 relationships, and 0 active research sessions.
- Completed the Atlas audit gate: unreachable/prominent isolated targets remain `research_only`, entity enrichment and Phase 10 MCTS are strictly one target at a time, and the existing web-OSINT → Maigret/Holehe/Sherlock → adaptive re-entry design remains intact.
- Added a target-scoped final web/LLM sanity review before research-session publication, contact promotion, or new asset publication. The deterministic adjudicator can only approve exact supplied evidence, applies person/org scope rules, blocks contacts for research-only targets, and preserves rejected evidence/reasons for review.
- `ENABLE_AUTO_PIPELINE=false` remains set; no Atlas run was launched during this continuation.
- Managed `.pythonlibs/bin/python3` now verifies `holehe`, `maigret`, and `sherlock` from the same interpreter used by the API. API build passes; full API suite passes 35 files / 197 tests; final-review regression tests pass; web build passes.
- The API workflow was restarted after the audit changes and live checks report all three Python tools available. Mobile typecheck remains blocked by pre-existing generated-client exports (`useListEntities`/`useRunResearch`), unrelated to this audit.
- Completed the active-tree contact-discovery gap implementation: provider evidence is reconciled into explicit candidate states, bounded exact claim pages are fetched before promotion, and only fail-closed direct routes reach entity contact fields.
- Candidate funnel metadata and provenance-enriched evidence are persisted through both deep-web enrichment routes using the existing `entities.metadata` and `contact_evidence` storage; organization-only and person-hop candidates remain reviewable.
- Added active-tree regression coverage for independent-domain corroboration, organization-only contacts, same-publisher conflicts, blocked lead directories, and social eligibility. Full API test suite passes 34 files / 192 tests; production build passes.
- Restarted the managed API workflow after the changes. `/api/healthz` returns Redis-healthy `200`, `/api/pipeline/funnel` returns an idle empty funnel, and `/api/pipeline/phase-j/status` reports all J0–J9 implementations present. No ingestion job was started.
- The GitHub `origin` remote is configured for `BigContacts`; this audit change is ready to commit and verify on `main`.
- AI web-research prompts now require a target fingerprint with at least two agreeing anchors, claim-level source URLs, explicit identity assessment, negative findings, and search gaps. They explicitly reject entity drift and prevent usernames, email-platform presence, fame, wealth, or social visibility from proving identity or personal reachability. The structured fields are parsed in both extractor trees and remain model-side triage only; server-side adjudication remains authoritative.
- The next bounded three-category Atlas run was cancelled safely after repeated provider fan-out on `KH Group Oyj` produced unrelated proper nouns (`Khan Academy`, `Free Online Courses`, `Launch Day`) and stalled without fresh progress. Tavily remained over plan usage, Gemini had no usable key, and no direct contacts were promoted.
- Corporation person-hop admission now requires exact candidate text, an explicit role/ownership term, and a researched-corporation anchor in the same local evidence window before targeted person searches or follow-up provider calls. This blocks name-shaped provider noise while retaining review-only evidence semantics.
- Verification after this hardening: focused web-enricher tests 34/34, full API suite 231/231, production API build passes; the separate API typecheck remains blocked by pre-existing `@workspace/db` export mismatches and one unrelated `registry-client.ts` logger error. Atlas is idle, API/Redis health is green, and the working tree is committed locally.
- Holehe, Maigret, and Sherlock are installed and available to the API's managed Python interpreter. Maigret and Sherlock remain review-only username/profile discovery; Holehe records email-service presence only. None independently promotes identity, personal contact, or access. `theHarvester` remains unavailable and is not part of the active pipeline.
- Prompt regression coverage passes 10/10 focused tests; the full API suite passes 36 files / 218 tests; API production build and Redis-healthy `/api/healthz` pass. Full API typecheck still reports the existing unrelated workspace baseline (54 errors after the new-field errors were fixed). Atlas remains manual and idle.
- Added fail-closed contact candidate reconciliation across provider output: candidates retain canonical URLs/domains, scope, person attribution, conflicts, provider audit data, and explicit funnel states from discovered through verified direct route.
- Corrected person-vs-organization Perplexity prompt contracts and annotated web-enricher evidence with organization/target-person scope, target name, provider, citations, and relationship context.
- Persisted candidate funnel metadata and durable `contact_evidence` rows without adding a competing candidate table; research sessions now expose the stored funnel for review.
- Added the research desk candidate funnel panel and registered `/research` in the web router. The preview now renders the empty-state research desk correctly.
- Hardened the independent research scorecard: identity, ownership, contact, access, wealth, freshness, and source quality are scored independently from canonical evidence, attribution, validation, reachability, reliability, and dated evidence. Asset count, graph degree, provider repetition, and wealth no longer promote contact/access/identity.
- Fixed deep-web candidate confidence to use evidence carrying the candidate's actual fetched page URL. Flattened search snippets, aggregate AI extraction, and provider repetition remain capped review signals; search-result URL lists are not treated as claim-level provenance until the page is fetched.
- Fixed the shared evidence ledger so the same value on independent publisher domains is corroboration, while contradictory values from one publisher remain conflicts.
- Added Sherlock as an availability-checked, review-only username-discovery fallback after Maigret. Sherlock results never promote identity/contact fields or trigger web-OSINT re-entry.
- Restored the managed Python 3.11 toolchain with Holehe, Maigret, and Sherlock. Startup and the re-import installer now use the managed interpreter and verify all three tools.
- Stable-rerun coverage now asserts deterministic scorecard output; focused candidate/provenance/scorecard/tool tests pass 14/14. API and web production builds pass. API health, entities, research sessions, and dashboard stats return 200.
- Fixed the API build entry to bundle the full imported implementation under `artifacts/api-server/src/src`; the prior scaffold entry served health only and caused false 404s for real routes.
- A controlled single-target Warren Buffett canary was run through web OSINT and research scoring. The final run completed 1/1 with 0 errors, persisted 21 current-run evidence rows, and left the entity fail-closed with no promoted person-level phone/email.
- Final verification: 13 focused API tests pass; API and web production builds pass with only the existing Vite sourcemap/chunk-size warnings; `/api/healthz`, `/api/enrich/python-tools`, and `/research` return successfully; startup verifies `holehe ✓ maigret ✓ sherlock ✓`.
- Final canary scorecard (current run only): identity 1.00, ownership 0.40, contact 0.369, access 0.12, wealth 0.183, freshness 0.253, source quality 0.705, overall 0.454. The target is correctly in Research Review/research-only mode because public prominence, organization routes, provider-only citations, and social presence do not establish personal access. No remaining implementation path can honestly raise ownership, access, wealth, or freshness to 0.90 without new attributable evidence; broad ingestion remains disabled.
- Added bounded claim-source hardening: owner-resolution evidence retains all attached source URLs, exact-claim fetching accepts person-level candidates with source or discovery URLs, and lead-generation/directory publishers are excluded from direct-contact corroboration and claim fetching. A controlled three-target canary (Edmund O Noel, Robert M Davidson, Jacob Eiting) completed 3/3 with 0 errors, 0/3 verified direct routes, and current-run evidence counts of 15, 12, and 5 respectively. The result improved provenance quality without increasing direct-contact yield; broad ingestion remains disabled.

### Backend research workflow iteration (2026-08-01):
- Added an evidence ledger that canonicalizes URLs, classifies source families, deduplicates mirrored pages, and scores corroboration by independent domains/families instead of provider-count inflation.
- Research provider fan-out now uses `Promise.allSettled`, so one failed provider no longer discards the other providers' results. AI-only contacts receive a deliberately capped confidence until page-level evidence exists.
- Hardened extraction prompts against prompt injection, required explicit evidence for claims, replaced greedy JSON parsing with balanced-object parsing, and stopped assigning global provider citations to individual owner claims without claim-level URLs.
- API tests: 67 passing; production build and `/api/healthz` pass. Full typecheck remains blocked by the existing unrelated workspace errors.

### UI/UX iteration (2026-08-01):
- Replaced person-only workspace language with neutral entity language in the navigation, dashboard hero, stats, priority cards, empty states, and evidence footer.
- Added a shared four-class taxonomy presentation layer for HNWI, Corporation, Trust, and Gatekeeper records, including type-specific colors, icons, descriptors, metrics, evidence labels, and next-action vocabulary.
- Applied the taxonomy to desktop and mobile entity ledgers, type filters, entity signal columns, add-entity fields, profile heroes, completeness labels, and mobile target cards. Companies now surface control links, trusts surface structure/assets, gatekeepers surface access/contact outcomes, and HNWIs retain wealth metrics.
- Completed a broad visual pass across web and mobile: refreshed typography and dark-blue tokens, improved card hierarchy, hover/focus states, empty states, pipeline readability, mobile MCTS error treatment, and removed emoji glyphs from UI feedback.
- Added truthful type-aware completeness logic so non-HNWI profiles do not report missing wealth as their primary signal, and corrected the shared Trust icon used by profile cards.
- Web production build and mobile TypeScript validation pass. No API contract changes were required.

### Setup this session (2026-07-31 — BigContacts import):
- Imported the BigContacts project, including ApexFinder web, Apex mobile, API source, shared libraries, scripts, documentation, and memory files.
- `pnpm install` ✅
- Redis system dependency ✅ · Python 3.11 ✅
- `pnpm --filter @workspace/db run push` → schema applied ✅
- Shared env configured: `REDIS_URL=redis://localhost:6379` and `ENABLE_AUTO_PIPELINE=false`
- Redis ✅ · artifacts/api-server: API Server ✅ · artifacts/apex-finder: web ✅
- Python tools: holehe ✓ · maigret ✓ · sherlock ✓ · theHarvester optional/unavailable
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- Automatic broad ingestion is disabled; no Atlas or ingestion job is active. One bounded Warren Buffett research session remains as a review record.
- API and web workflows were restarted after the safeguards were applied and are healthy. API health is `ok` with local Redis healthy; Upstash slot 1 is quota-exhausted and slots 2–5 remain available.
- Backend builds and frontend builds pass. Vite emits only the existing sourcemap/chunk-size warnings. Focused realism/contact tests pass: 2 files / 9 tests. Full API typecheck remains blocked by the pre-existing workspace DB export mismatch and unrelated legacy errors; the production build is unaffected.
- Intelligence Reactor now renders the complete rod-wall pipeline on desktop and mobile: all eight registries, discovery tools, AI providers, synthesis, graph/core, adaptive feedback routes, and output are visible. Mobile uses a responsive SVG route map instead of collapsing tools into disconnected phase cards.
- Reactor telemetry is now truthful: Atlas exposes separate numbered phase state and entity-batch state, including phase 0–10, current entity names, entity range/total, and current detail. The UI shows the 11 numbered checkpoints, completed/active/queued/skipped/failed rod states, and only lights feedback routes when live endpoints are active.
- Idle mode no longer runs fake desktop waves or treats historical research sessions as live reactor activity. The pipeline remains idle; no Atlas, ingestion, or research job was started.
- Reactor quick information is header-first on desktop and mobile: phase/checkpoint, current live detail, entity workbench, database totals, hot leads, assets, research sessions, and outreach count remain visible without scrolling. The old footer meters were removed, and idle headers retain real totals instead of zeroing them.
- HNWI and entity cards now surface an evidence-led public profile brief and involvement summary from stored headlines, social bios, foundation names, registry signals, assets, and source registries. The same narrative treatment is present on the dashboard priority cards, desktop/mobile People ledger, and desktop/mobile profile hero. Missing evidence is explicitly shown as unrecorded rather than inferred.
- The bounded Warren Buffett verification record is now clean: malformed `+++14023461400` was rejected, phone/contact confidence and Access were recomputed, the record is social-only and not hot, and manual provenance is not presented as registry evidence.
- Research reruns recompute Bayesian score from the stable prior rather than compounding the prior posterior. Isolated targets without a corroborated gatekeeper are saved as `Research Review` with no outreach recommendation or generated contact copy.
- Target research now runs a deterministic reachability-realism preflight before retrieval, orchestration, MCTS, and outreach generation. Prominent/wealthy isolated targets with no validated direct vector or corroborated intermediary route are bounded as `research_only`; direct contact and corroborated intermediary paths retain normal research budget.
- Perplexity, Gemini, Tavily, Exa, deep-web prompts, and MCTS now distinguish identity/wealth/social/asset evidence from practical access. Hypothetical WhatsApp, commission, FBO, marina, club, property-manager, and staff routes are not actionable without explicit corroboration.
- The research-only preflight persists an explicit `Research Review` session with empty outreach/path output and the reasons/blockers used for the budget decision. No broad Atlas or ingestion job was started.

---

## Historical State (2026-07-31 — bounded Atlas run was previously launched; now idle)

- Secure secret check confirmed all 30 requested slots are present; secret values were not read or displayed.
- Requested slots: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY through _5,
  PERPLEXITY_API_KEY through _6, WHOXY_API_KEY, GEMINI_API_KEY through _4,
  EXA_API_KEY through _2, and TAVILY_API_KEY through _6.
- Fresh Perplexity secrets `PERPLEXITY_API_KEY_7` and `_8` were present and loaded in the restarted API process alongside `_1` through `_6`.
- The prior bounded Atlas jobs were stopped/marked failed by API restarts; their partial database results were preserved. No replacement job was launched during the contact-quality hardening pass.
- Current workflow state: Redis, API Server, web, and mockup sandbox are running; mobile is not started because it is not needed. API health is `ok`.
- The last observed job list was entirely idle; no Atlas, ingestion, or research worker is active.

### Contact-quality hardening completed (2026-07-31)
- Human-name admission now applies deterministic safety gates and retains only successful LLM validation results; provider failure cannot admit broad-discovery candidates.
- AI prompts and parser rules prohibit constructed/pattern-derived emails; inferred email candidates were removed from web and deep-web evidence paths.
- Email, phone, and social URLs are sanitized before entity, evidence, Redis, and confidence writes.
- Organization contacts remain separate from personal Access confidence; corporate/trust records cannot receive personal contact confidence from switchboards or shared inboxes.
- Access/contact confidence no longer uses wealth, assets, registry, or composite identity score; `isHot` requires a meaningful person-level direct contact signal.
- Aircraft, property value, shareholder filing, and live-flight signals remain wealth/research evidence only and no longer promote an entity to Access-hot status.

---

## Current State (2026-07-31 — imported project setup complete; all 30 requested secrets active; pipeline idle)

- Secure secret check confirmed all 30 requested provider slots present; values remain hidden.
- No dependencies, database schema, workflows, or research jobs were changed in this setup-only pass.
- Pipeline remains idle and awaiting explicit user instruction.

---

## Current State (2026-07-30 — Re-import #43 — Atlas RUNNING job 46607658 — all 30 secrets active)

### Setup this session (2026-07-30 — re-import #43 — full launch):
- `CI=true pnpm install --frozen-lockfile` ✅ (~37s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- All 30 secrets active: SESSION_SECRET, REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–6, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–6
- Pre-launch fixes applied this session:
  1. broad-discovery.ts: Tavily key rotation now includes _5 and _6 (was only _1–_4)
  2. llm-name-validator.ts: upgraded from llama-3.1-8b-instant → llama-3.3-70b-versatile
  3. ai-extractor.ts buildPerplexityPrompt: HNWI phone warning expanded with 5 corporate HQ examples (Vail, Goldman, BNP, Lloyd's, Dubai)
  4. broad-discovery.ts aiExtractPersonNames: fixed "every word ≥4 chars" prompt — now "at least ONE word ≥5 chars"
- Atlas job 46607658 RUNNING — discoveryFirst=true, skipFaa=true, targetCount=500, broadCategories=3
- Phase 1/10: [1/21] European venue owners — broad discovery live

### Poll command:
```bash
curl -s http://localhost:8080/api/ingest/job/46607658-023b-44bb-a15d-90d565d1b0e8 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:120])"
```

---

## Current State (2026-07-30 — Re-import #43 — setup complete; SESSION_SECRET active; DB empty; pipeline idle)

### Setup this session (2026-07-30 — re-import #43):
- `CI=true pnpm install --frozen-lockfile` ✅ (~37s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- DB: 0 entities (fresh/empty)
- Secrets: SESSION_SECRET active (re-enter API keys as needed)
- Pipeline idle — ready for Atlas launch when user instructs

---

## Current State (2026-07-30 — Re-import #42 — Atlas RUNNING job c6718f0e — all 30 secrets active)

### Setup this session (2026-07-30 — re-import #42 — full launch):
- `CI=true pnpm install --frozen-lockfile` ✅ (~42s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- All 30 secrets active: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–6 (6 keys — 2 new vs last session), WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–6, SESSION_SECRET
- Upstash: slot 1 quota-exhausted (non-fatal), slots 2–5 ready ✅
- Groq status display fix: line 1230 now dynamically enumerates GROQ_API_KEY_1–8 (was hardcoded to 4)
- Dedup cleared ✅ (50 stale entries from prior session removed)
- Ghost jobs: auto-cleared on startup ✅
- Atlas job c6718f0e RUNNING — discoveryFirst=true, skipFaa=true, targetCount=500
- Phase 1/10: Discovery + full-circle enrichment loop — running

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/c6718f0e-7fea-4a5e-b32a-ae078749f661 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:120])"
```

---

## Current State (2026-07-30 — Re-import #42 — setup complete; SESSION_SECRET active; DB empty; pipeline idle)

### Setup this session (2026-07-30 — re-import #42):
- `CI=true pnpm install --frozen-lockfile` ✅ (~42s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB: 0 entities (fresh/empty)
- Secrets: SESSION_SECRET active (other API keys need re-entry if quota-exhausted)
- Pipeline idle — ready for Atlas launch when user instructs

---

## Current State (2026-07-30 — Re-import #41 — Atlas RUNNING job 4707e3f0 — 6 bug fixes applied)

### Setup this session (2026-07-30 — re-import #41 — continued):
- All 29 secrets active (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_1–5, PERPLEXITY_1–4, WHOXY, GEMINI_1–4, EXA_1–2, TAVILY_1–6, SESSION_SECRET)
- Atlas job 4707e3f0 RUNNING — 21-source pipeline, discoveryFirst=true, skipFaa=true, targetCount=500
- ⚠️ Perplexity (all 4 keys 401 quota-exhausted), Tavily (all 6 keys 432 quota-exhausted) — graceful degradation active; Exa + Groq + Gemini (recovering cold-start) running
- DB: ~10 entities (9 from prior rounds + 1 new Joyce Price)

### Bug fixes applied this session:
1. **isPlaceholderEmail wired** — ai-extractor.ts: now called at both top-level email (line 322) and owner-contact email (line 293). Extended to block role-based inboxes (info@, contact@, press@, etc.) and financial aggregator domains.
2. **Confidence score mismatch fixed** — profile.tsx hero now shows `contactConfidence` (same as entities list) labeled "Contact". Was showing 5-factor `confidence.overall` (different number). Both list and profile card now match.
3. **"web-discovery" source badge filtered** — internal pipeline labels (web-discovery, broad-discovery, ai-osint, etc.) now suppressed from profile hero source badges and from `primaryWealthSource`. Mobile "Wealth" card shows "In Discovery" instead of "Unknown source".
4. **Mobile profile hero** — Added "Contact" score card alongside Access and Wealth for consistency with desktop and list view.
5. **Entities list columns renamed** — "Confidence" → "Contact Score", "Contact" → "Direct Contact" for clarity.
6. **Corporate handle rejection** — `normTW`/`normIG` now reject handles matching known data-aggregator/registry patterns (societe_com, infogreffe, etc.) and brand suffixes (_com, _fr, etc.). Fixed: "@aSociete_com" was being stored as Walid Dabess's Twitter.
7. **Groq extraction prompt hardened** — Now explicitly requires living contemporary HNWIs; blocks historical figures, celebrities, politicians, royalty, truncated names, plural/group nouns.
8. **Hard-reject filter expanded** — broad-discovery.ts: added military/title prefixes (colonel, commodore, etc.), French article rejection (La/Le/Les prefix), UI scraping artifacts ("View", "Read" etc. stripped), entity suffix rejection (Ltd, LLC, etc.), plural collective noun rejection.
9. **"Unknown source" → "In Discovery"** — Mobile Wealth card shows better label when enrichment hasn't determined the wealth source yet.

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/4707e3f0-6d1a-4e03-9af3-e36db962a3e8 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:120])"
```

---

## Current State (2026-07-30 — Re-import #41 — setup complete; SESSION_SECRET active; DB empty; pipeline idle)

### Setup this session (2026-07-30 — re-import #41):
- `CI=true pnpm install --frozen-lockfile` ✅ (~34s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- DB: 0 entities (fresh/empty)
- Secrets: All 29 active — REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–6 (6 keys this session, up from 4), SESSION_SECRET
- Pipeline idle — ready for Atlas launch when user instructs

---

## Current State (2026-07-30 — Re-import #40 — setup complete; SESSION_SECRET active; DB empty; pipeline idle)

### Setup this session (2026-07-30 — re-import #40):
- `CI=true pnpm install --frozen-lockfile` ✅ (~41s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- DB: 0 entities (fresh/empty)
- Secrets: All 26 active — REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4, SESSION_SECRET
- Atlas job d1a235d0 RUNNING — 21-source pipeline, discoveryFirst=true, skipFaa=true, targetCount=500
- Round 1 complete: 17 entities from prior run + 10 new from re-run = 27 total; 19 cooked, 17 priority leads
- Name validator fix applied: deceased historical figures (Gar Wood, George Mason, Louis Comfort Tiffany) now blocked
- Tavily all 4 keys quota-exhausted (432 billing limit) — graceful degradation active; Perplexity+Exa+Groq still running
- Gemini cold-start rate limit (normal, auto-recovers ~5 min after restart)
- Pipeline idle — all secrets set; ready for Atlas launch when user instructs

---

## Current State (2026-07-30 — Re-import #39 — setup complete; all 26 secrets active; DB empty; pipeline idle)

### Setup this session (2026-07-30 — re-import #39):
- `CI=true pnpm install --frozen-lockfile` ✅ (~38s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB: 0 entities, 0 enrichment_runs, 0 identity_bundles (fresh/empty)
- All 26 secrets active: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4, SESSION_SECRET
- Pipeline idle — ready for Atlas launch

---

## Current State (2026-07-30 — Re-import #38 — Atlas RUNNING job 25a433ea — Step G upgraded: Hospitality assets + llama-3.3-70b)

### Setup this session (2026-07-30 — re-import #38):
- `pnpm install` ✅ (~44s) · `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Python tools: holehe ✓ maigret ✓
- All 26 secrets active: REDIS_URL_1–5 (slot 1 quota-exhausted/non-fatal, slots 2–5 healthy), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4

### Fix applied this session:
- **Step G asset extraction upgraded** — `enrichEntityFullCircle` Step G now uses `llama-3.3-70b-versatile` (was `llama-3.1-8b-instant`) with an expanded prompt that explicitly covers "Hospitality" as a category (hotels, resorts, restaurants, golf clubs, beach clubs, ski resorts, marinas — businesses the HNWI owns/operates). Categories: RealEstate | Aviation | Marine | **Hospitality** | Business | PrivateClub | Investment. Max assets per entity raised from 8 → 12. Context now includes sourceRegistries + metadata (companyName, bizLocation) in addition to notes and knownResidences.

### Atlas job 7ec3cdba (relaunched after artifact registration triggered restart):
- Started: 2026-07-30 ~08:36 UTC
- `discoveryFirst=true, skipFaa=true, targetCount=500, researchLimit=15`
- 21 interleaved sources (15 broad web-search + 6 registry batches)
- Per-entity full-circle enrichment (concurrency=3, cookedAt stamped)
- Dedup cleared before launch ✅
- Phase 0 (OCCRP + OpenSky + CH Officers pre-run) running

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/7ec3cdba-1c41-49ca-bd93-45b49a3e7c64 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:100])"
```

---

## Current State (2026-07-30 — Re-import #37 — Atlas RUNNING job 0799f997 — 3 bugs fixed, all 26 secrets set)

### Setup this session (2026-07-30 — re-import #37):
- `pnpm install` ✅ (~32s) · `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Python tools: holehe ✓ maigret ✓
- All 26 secrets added: REDIS_URL_1–5 (slots 1–5 all healthy), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–5, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4
- Slot 1 quota-exhausted on first restart (prior run used it), then recovered on second restart — slots 1–5 all connected and ready

### 3 bugs fixed before Atlas launch:
1. **Phase 3 notes overwrite** — Phase 3 metadata population was overwriting `notes` with bare registry metadata strings, destroying ICIJ/Whoxy/AI forensic notes written during full-circle enrichment. Fixed: only write baseline notes when `notes IS NULL` (entities already enriched are untouched).
2. **200-entity cap per source round** — `newEntities` query had `.limit(200)` — source rounds producing >200 entities left the rest permanently uncooked. Raised to 1000.
3. **`totalContacts` always 0** — initialized to 0, never incremented. Fixed: query DB at end of pipeline for real count (`email IS NOT NULL OR phone IS NOT NULL OR linkedinUrl IS NOT NULL`).

### Atlas job 0799f997:
- Started: 2026-07-30
- `discoveryFirst=true, skipFaa=true` — 21 interleaved sources (15 broad web-search + 6 registry batches)
- Per-entity full-circle enrichment (concurrency=3, cookedAt stamped)
- Dedup cleared before launch ✅
- All 5 Upstash slots connected ✅

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/0799f997-b6c3-40c6-bf3c-cd997ffbe8e1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:100])"
```

---

## Current State (2026-07-30 — Re-import #36 — Atlas RUNNING job 2fda3fc9 — 2 critical bugs fixed, concurrency=3)

### Fixes applied this session (2026-07-30 — re-import #36):
1. **CRITICAL: Gemini/Tavily/Exa results were silently dropped** — `gem`, `tav`, `exa` were declared with `const` inside a `try` block in `web-enricher.ts` (line ~1735) and then referenced in subsequent `try` blocks outside it. In JS, `typeof` of an out-of-scope block-scoped `const` returns `"undefined"`, so all three provider result-processing blocks were silently skipped on every enrichment — only Perplexity results were ever used. Fixed by declaring `let perp, gem, tav, exa` before the first `try` block.
2. **Concurrency: sequential → 3 parallel** — Per-entity enrichment in `atlas-orchestrator.ts` was a plain sequential `for` loop (one entity at a time). `runEntityBatch(concurrency=3)` already existed but was unused in the discovery loop. Wired it in — 3 entities now enrich simultaneously, ~3× faster throughput.

### Atlas job 2fda3fc9:
- Started: 2026-07-30
- discoveryFirst=true, skipFaa=true, targetCount=1500, researchLimit=15
- 21 interleaved sources: 15 broad web-search categories + 6 registry batches
- Per-entity full-circle with cookedAt stamp and concurrency=3
- Dedup cleared before launch ✅

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/2fda3fc9-1e40-4b7b-9237-1478af1b6643 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), '|', d.get('inserted',0), 'inserted |', str(d.get('message',''))[:100])"
```

---

## Current State (2026-07-30 — Re-import #36 — setup complete; pipeline idle; waiting for user)

### Import setup (2026-07-30 — re-import #36)
- `CI=true pnpm install --frozen-lockfile` ✅ (~34s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret 0.6.3 ✓ (pip-installed fresh)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}` ✅
- SESSION_SECRET present; enrichment secrets carried from prior import
- Pipeline idle — user has not launched Atlas yet

---

## Current State (2026-07-30 — Re-import #35 — Atlas RUNNING job 31de1d45 — per-entity full-circle, reactor fixes applied)

### Fixes applied this session (2026-07-30 — reactor overhaul):
1. **Mobile REGISTRIES section** — `MOBILE_PHASES` now includes `brreg` and `whoxy` nodes (were in `NODES` but never rendered on mobile)
2. **WEB DISC. subtitle** — updated from "DuckDuckGo · Bing" to "15 Categories · Tavily · AI" (reflects actual operation)
3. **`atlasStepToNodes()` helper** — maps `[N/21]` step numbers to correct reactor nodes: registry steps (2,5,8,11,14,18) → edgar/ch/brreg/hnwi; `🍳` cooking → enrichment stack; broad category → webdisc/groq
4. **Content-aware keyword parser** — entity-level messages (inner enrichment overwrites `[N/21]`) now matched by emoji/keyword: Maigret→maigret, Perplexity→perp0/perpfu, Gemini→gemini, Tavily→tavily, Exa→exa, AI OSINT→full AI stack, In-house→inhouse, Phase J→semantic/bayesian
5. **Footer STEP meter** — parses `[N/21]` to show step progress (e.g. 3/21) instead of dead `Atlas Phase X/10` regex
6. **`exhaustedKeys` TS fix** — defaulted to `[]` in MobileReactor props to eliminate `possibly undefined` error

### Atlas job 31de1d45 (refired after workflow crash):
- Started: 2026-07-30 ~05:22 UTC
- Dedup cleared before launch
- Holehe running on entities; AI OSINT sweep active

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/atlas-status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), d.get('progress'),'/',d.get('total'), '—', d.get('inserted',0), 'inserted —', str(d.get('message',''))[:80])"
```

---

## Current State (2026-07-30 — Re-import #35 — Atlas RUNNING job 5b9a7e99 — Phase 0 broad discovery + registries interleaved)

### What was done this session (2026-07-30 — re-import #35):
1. **Mobile COOKED badge added** — `MobileEntityCard` in `entities.tsx` now shows `CheckCircle2` (emerald) when `entity.cookedAt` is set — matches desktop table behaviour
2. **Dedup cleared** — `DELETE /api/ingest/dedup` called before Atlas launch to ensure fresh Upstash dedup (fresh DB, stale entries from prior runs would have silently blocked discovery)
3. **Atlas launched** — `discoveryFirst=true`, `skipFaa=true`, `targetCount=1500`, `researchLimit=15`, all 15 broad categories + 6 registry batches interleaved; per-entity full-circle enrichment with `cookedAt` stamp

### Atlas job 5b9a7e99:
- Started: 2026-07-30 ~05:10 UTC
- 21 interleaved sources: 15 broad web-search categories (hotels Italy/Sicily, golf clubs Norway, Dubai funds, Nordic shipping, French Riviera, Asian wealth centres, Latin America, UK estates, marinas, SEC filings, philanthropy, public mentions…) + 6 EDGAR/CH/BRREG/BODACC registry batches
- FAA mass-dump: SKIPPED ✅
- Per-entity full-circle: each discovered entity immediately runs Phases 4–8 + cookedAt stamp

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/5b9a7e99-24d3-4d0c-ab2a-328e0a976470 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), d.get('progress'),'/',d.get('total'), '—', str(d.get('inserted',0)), 'inserted —', d.get('message','')[:80])"
```

---

## Current State (2026-07-30 — Re-import #35 — setup complete; pipeline idle; waiting for user)

### Import setup (2026-07-30 — re-import #35)
- `CI=true pnpm install --frozen-lockfile` ✅ (~31s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret 0.6.3 ✓ (pip-installed fresh)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- SESSION_SECRET present; enrichment secrets carried from prior import
- Pipeline idle — user has not launched Atlas yet

---

## Current State (2026-07-30 — Re-import #34 — setup complete; pipeline idle; waiting for user)

### Import setup (2026-07-30 — re-import #34)
- `CI=true pnpm install --frozen-lockfile` ✅ (~38s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret 0.6.3 ✓
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":3}}` ✅
- All 24 enrichment secrets set: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4, WHOXY_API_KEY, GEMINI_API_KEY/\_2/\_3/\_4, EXA_API_KEY/\_2, TAVILY_API_KEY/\_2/\_3/\_4; SESSION_SECRET present
- Pipeline idle — user has not launched Atlas yet

---

## Current State (2026-07-30 — Atlas RUNNING job b41fe1e2 — Phase 1 enrichment — 941 entities / 91 contactable)

### Fixes applied this session (2026-07-30):
1. **ConfidenceBadge crash fixed** — `profile.tsx` used `ConfidenceBadge` without importing it; added to import on line 49
2. **Reactor node cycling fixed** — `currentStepNodes` was pulsing 1 node per 1.3s; now ALL `liveNodes` lit simultaneously (Perplexity + Tavily + Exa + Maigret all glow at once during Phase 6); dot-pulse ticker slowed to 2.5s gentle pulse
3. **Key exhaustion shown in Reactor** — `pollJobs` now fetches `/api/system/status` every 3s; amber "⚠ RATE LIMITED: Gemini·Tavily↓" strip appears in live banner when any AI provider is rate-limited; works both live and idle
4. **MobileReactor `exhaustedKeys` prop** — properly typed in props interface and passed from page wrapper

### Current pipeline state (2026-07-30 02:11):
- 941 entities | 91 contactable | 98 reachable personal | 1 reachable social | 11% enrichment coverage
- Atlas job b41fe1e2 running: skipIngestion=true, Phase 1 (OCCRP 401/rate-limited non-fatal, OpenSky fetch-failed non-fatal, CH Officers running)
- All AI keys healthy: Groq _1/_2/_3 ✓ | Perplexity _1–_4 ✓ | Gemini _1–_4 ✓ | Tavily _1–_4 ✓ | Exa _1/_2 ✓
- OCCRP requires API key (401) — non-fatal, Atlas continues through all phases

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/atlas-status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), d.get('progress'),'/',d.get('total'), '—', d.get('message','')[:80])"
```

---

## Current State (2026-07-29 — Re-import #33 — Atlas RUNNING job 634c7968 — Phase 0 all-15-category discovery)

### Import setup (2026-07-29 — re-import #33)
- `CI=true pnpm install --frozen-lockfile` ✅ (~38s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret 0.6.3 ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- All 24 enrichment secrets set: REDIS_URL_1–5 (slot 1 quota-exhausted/non-fatal), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–3, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4
- Atlas fired: discoveryFirst=true, broadCategories=15, skipFaa=true, targetCount=1500, researchLimit=15

---

## Current State (2026-07-29 — Re-import #32 setup complete; all workflows running; DB schema applied; pipeline idle)

### Import setup (2026-07-29 — re-import #32)
- `CI=true pnpm install --frozen-lockfile` ✅ (~40s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- **Atlas RUNNING** — job `5dd23d80`, Phase 0/10 discovery-first, 5 broad categories, skipFaa=true, targetCount=1500, researchLimit=15
- All 24 enrichment secrets set: REDIS_URL_1–5 (slots 2–5 connected; slot 1 quota-exhausted/non-fatal), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4, WHOXY_API_KEY, GEMINI_API_KEY/\_2/\_3/\_4, EXA_API_KEY/\_2, TAVILY_API_KEY/\_2/\_3/\_4; SESSION_SECRET present

### Fixes applied this session (2026-07-29 — re-import #32 continuation):
1. **Ghost Atlas job cleared permanently**: Added `"atlas-run"` to `INGESTOR_TYPES` in `startup.ts` — ghost Atlas jobs now cleared on every restart (same as FAA/western-hnwi)
2. **Reactor RUNS=0 fixed**: Footer RUNS meter now shows `PHASE X/10` (real Atlas phase progress) when Atlas is live; falls back to `RUNS` (sessions count) when idle — parsed from `liveLabel` pattern `"▶ Atlas Phase X/10 — …"`
3. **Score NaN guard added**: `ConfidenceBadge` and `AccessScoreBadge` in `utils.tsx` now guard against NaN and non-number values (`typeof score !== "number" || isNaN(score)`) in addition to null/undefined — prevents any rendering crash from unexpected DB values
4. **Atlas launched**: `discoveryFirst=true`, `broadCategories=5`, `skipFaa=true` (no 50k aircraft dump), `targetCount=1500` (EDGAR/CH/BRREG/BODACC diversity), `researchLimit=15` MCTS sessions at Phase 10

### To poll Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/5dd23d80-e814-44b3-99fd-f41c0d97f45f | jq '{status,progress,total,message,inserted}'
```

---

## Current State (2026-07-29 — Re-import #31 — Atlas RUNNING job 8b10bf96 — Phase 0 broad discovery)

### What was done this session (2026-07-29 — re-import #31 + Atlas launch)
1. **Key rotation fixes** — 3 static key arrays were missing `GROQ_API_KEY_1` and `TAVILY_API_KEY_1`:
   - `lib/llm-name-validator.ts`: added `GROQ_API_KEY_1` to GROQ_KEYS
   - `lib/enrichment/broad-discovery.ts`: added `GROQ_API_KEY_1` + `TAVILY_API_KEY_1`
2. **Stale Atlas lock cleared** (leftover from re-import #30 session)
3. **Atlas fired** — discovery-first, batchSize 200, researchLimit 15, all 11 phases queued

### To check Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/8b10bf96-dd1c-47b3-b3ec-6669905c3f0a | jq '{status,progress,total,message,inserted}'
```

---

## Current State (2026-07-29 — Re-import #31 setup complete; all workflows running; DB schema applied; pipeline idle)

### Import setup (2026-07-29 — re-import #31)
- `CI=true pnpm install --frozen-lockfile` ✅ (~31s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 710ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 1180ms)
- Python tools: holehe ✓ maigret ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":37}}` ✅
- DB schema applied; pipeline idle; awaiting user instruction

---

## Current State (2026-07-29 — Re-import #30 setup complete; all workflows running; DB schema applied; 24 API secrets loaded; pipeline idle)

### Import setup (2026-07-29 — re-import #30)
- `CI=true pnpm install --frozen-lockfile` ✅ (~42s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":3}}` ✅
- **24 new API secrets saved**: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY_1–3, PERPLEXITY_API_KEY_1–4, WHOXY_API_KEY, GEMINI_API_KEY_1–4, EXA_API_KEY_1–2, TAVILY_API_KEY_1–4
- **Key rotation updated** in `ai-extractor.ts`: getGroqKeys now includes _1; getGeminiKeys, getTavilyKeys, getExaKeys now scan from _1 (previously started at _2)
- DB schema applied; pipeline idle; awaiting user instruction

---

## Current State (2026-07-29 — Re-import #29 setup complete; all workflows running; DB schema applied; pipeline idle)

### Import setup (2026-07-29 — re-import #29)
- `CI=true pnpm install --frozen-lockfile` ✅ (~36s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB schema applied; pipeline idle; awaiting user instruction

---

## Current State (2026-07-29 — Atlas running Phase 4/In-house; 395 entities; 25 contactable; quality fixes applied)

### What was done this session (2026-07-29 — re-import #28 + Atlas launch)

1. **`clearDedup` import bug fixed** (`western-hnwi-ingestion.ts` line 23): `clearDedup` was used at line 728 but never imported — function call would throw at runtime. Fixed by adding it to the job-queue import.
2. **`looksLikePerson` corporate regex expanded** (`western-hnwi-ingestion.ts`): Added missing terms: `limited`, `corporate`, `sas`, `sarl`, `llp`, `securitisation`, `secretarial`, `appoint`, `incorporated`, `services`, `ventures`, `consultancy`, `recruitment`. Prevents CH/BRREG company names like "HILTON CORPORATE", "L.D.C SECURITISATION", "DIRECTORC01 LIMITED", "PLEASE APPOINT A" from being stored as HNWIs. Also expanded `abstractVerb` reject list with imperative starters (`please`, `appoint`, `use`, `visit`, `find`, etc.).
3. **Broad-discovery country-prefix fix** (`broad-discovery.ts`): Added `LEADING_GEO_WORDS` set (50 country/region names) to `extractNames()` — strips leading geo-word before validation so "Mexico Asanka Pathiraja" → "Asanka Pathiraja".
4. **Broad-discovery VENUE_INDICATORS expanded** (`broad-discovery.ts`): Added `wealth`, `financial`, `advisory`, `bank`, `banking`, `corporate`, `university`, `school`, `college`, `academy`, `privacy`, `profiles`, `cookies`, `consent` — prevents "Hoxton Wealth", "Yale University School", "Use Privacy Profiles" from being stored as HNWIs.
5. **27 bad entities deleted from DB** during live Atlas run (8 broad-discovery junk + 19 CH/BRREG corporate names).
6. **Atlas launched (discovery-first mode)**: jobId `18178f30-67c8-4191-b486-afe19f0bee40`
   - Phase 0a broad-discovery: 224 entities from 3 template categories (Nordic/Latin American/UK estates) ✅
   - Phase 0b western-hnwi: 199 inserted (EDGAR SC 13D/G + DEF 14A + BRREG Norway + CH UK) ✅
   - Phase 1 OCCRP + OpenSky + CH Officers ✅ (OCCRP 401 — no API key, non-fatal)
   - Phase 2 OpenOwnership + CH contact enrichment + Foundation filings ✅
   - Phase 3 Notes + EDGAR assets ✅
   - Phase 4 In-house OSINT (Wikidata/GitHub/RDAP/DNS/Gravatar) — **running at 55/200**
   - Phase 5–10 pending
7. **DB state at wrap**: 395 entities / 25 contactable — Peter Thiel (phone + LinkedIn), Anousheh Ansari (phone + LinkedIn), Warren Stephens, and 22 more.
8. **All fixes built** (API server rebuild clean 578ms) — will take effect on next ingestion since Phase 0 already completed.

### To check Atlas progress:
```bash
curl -s http://localhost:8080/api/ingest/job/18178f30-67c8-4191-b486-afe19f0bee40 | jq '{status,progress,total,message}'
```

### Next session:
- Atlas will have completed Phase 4 (in-house enrichment) → Phase 5 (social discovery) → Phase 6 (AI OSINT: Perplexity + Gemini + Tavily + Exa + Groq → Maigret → Holehe) → Phases 7–10
- If Atlas completed: check DB totals and trigger `POST /api/ingest/web-osint-enrich {"batchSize": 100, "force": true}` on any unenriched entities
- Restart API server (between Atlas phases) to pick up the broad-discovery + looksLikePerson fixes for future ingestion runs

---

## Current State (2026-07-29 — Re-import #28 setup complete; all workflows running; DB schema applied; pipeline idle)

### Import setup (2026-07-29 — re-import #28)
- `CI=true pnpm install --frozen-lockfile` ✅ (~42s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- Python tools: holehe ✓ maigret ✓ (theHarvester ✗ needs Python 3.12; gliner ✗ optional)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}` ✅
- DB schema applied; pipeline idle; ENABLE_AUTO_PIPELINE=false; awaiting user instruction

---

## Current State (2026-07-29 — Re-import #27 setup complete; all workflows running; DB schema applied; pipeline idle)

### Import setup (2026-07-29 — re-import #27)
- `CI=true pnpm install --frozen-lockfile` ✅ (~39s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 730ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 976ms)
- Python tools: holehe ✓ maigret ✓ (verified by startup.ts on boot)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB schema applied; pipeline idle; ENABLE_AUTO_PIPELINE=false; awaiting user instruction

---

## Current State (2026-07-29 — Apex Atlas RUNNING — full 10-phase pipeline active)

### What was done this session (2026-07-29 — Atlas orchestrator)
1. **Full audit of all 30+ data sources** — every enricher, ingestor, and OSINT tool catalogued
2. **`lib/atlas-orchestrator.ts`** — 600-line orchestrator that chains all 10 phases in the optimal cross-reference order
3. **`routes/atlas.ts`** — POST /api/ingest/atlas-run endpoint + DELETE /api/ingest/atlas-lock + GET /api/ingest/atlas-status
4. **`routes/phase-j.ts`** — exported `runPhaseJBatch()` so Atlas can call it directly without HTTP
5. **`routes/index.ts`** — registered atlasRouter
6. **Atlas triggered**: jobId `a588fbf6-3a32-419b-bc8a-6eea157eb55e` — running in background

### Atlas 10-phase pipeline (currently running):
- Phase 0: FAA (60k aircraft) + Western HNWI/EDGAR/CH/BRREG (15k entities) — PARALLEL
- Phase 1: OCCRP Aleph + OpenSky live flights + CH Company Officers — PARALLEL
- Phase 2: CH contact enrichment + OpenOwnership BODS + Foundation filings — PARALLEL
- Phase 3: Notes + EDGAR stock assets + live-source markers
- Phase 4: In-house OSINT (Wikidata/GitHub/RDAP/DNS/Gravatar/ProPublica990) — concurrency 5
- Phase 5: Social discovery (LinkedIn/Twitter/Instagram) + Messenger (Telegram) + Broad discovery (200 new entities)
- Phase 6: AI OSINT (Perplexity+Gemini+Tavily+Exa+Groq) → Maigret (3k platforms) + Holehe (120 services) → re-run if 3+ signals
- Phase 7: Forensic — ICIJ Offshore Leaks + Whoxy WHOIS + Equasis vessels + ADSB flight history — PARALLEL
- Phase 8: Phase J (J4-J9) domain resolution + digital footprint + J6 attribution
- Phase 9: Semantic embeddings + net worth backfill + contact outcomes + confidence recompute
- Phase 10: MCTS research on top 10 hot leads (batches of 5)

### To check progress:
```bash
curl -s http://localhost:8080/api/ingest/job/a588fbf6-3a32-419b-bc8a-6eea157eb55e | jq '{status,progress,total,message}'
curl -s http://localhost:8080/api/ingest/atlas-status | jq .
```

### To re-run Atlas (skip ingestion if data already there):
```bash
curl -s -X POST http://localhost:8080/api/ingest/atlas-run -H "Content-Type: application/json" \
  -d '{"skipIngestion": true, "hotLeadsOnly": false, "runResearch": true}'
```

---

### What was done this session (2026-07-28 — post-import hardening)
1. **Python tools installed**: `bash scripts/install-python-tools.sh` → holehe ✓ maigret ✓
2. **post-merge.sh updated**: added step 4/4 — `bash scripts/install-python-tools.sh` runs after every GitHub re-import automatically, permanently
3. **startup.ts updated**: `verifyAndInstallPythonTools()` now runs on every API server boot, auto-installs missing tools before any research
4. **Maigret + Holehe wired into web-osint-enrich pipeline**: After `deepWebOsintEnrich` finds a handle, Maigret scans 3,000+ platforms; if 3+ found with no email, web-OSINT re-runs with Maigret context. Holehe runs in parallel if email is known. Results saved to `contact_evidence` table.
5. **Reactor updated**: Maigret node added to NODES, EDGES (sky-mai, web-mai, mai-groq, mai-bay), WAVES, MOBILE_PHASES, JOB_NODE_MAP
6. **replit.md updated**: Rules 5 and 6 added permanently — tool verification mandate + flexible pipeline architecture rules
7. **API build clean**: 1382ms, all edits compile cleanly

### Next session
- Trigger Atlas: western-hnwi ingestion → web-osint-enrich (now includes Maigret + Holehe automatically)
- Monitor reactor to verify Maigret node lights up during web-osint-enrich job

---

## Current State (2026-07-28 — Re-import #26 setup complete; all 24 secrets saved; all workflows running; DB empty; pipeline idle)

### Import setup (2026-07-28 — re-import #26)
- `CI=true pnpm install --frozen-lockfile` ✅ (~35s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 1977ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 1885ms)
- All 24 secrets saved: SESSION_SECRET, REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY, GEMINI_API_KEY/_2/_3/_4, EXA_API_KEY/_2, TAVILY_API_KEY/_2/_3/_4
- Upstash slots 1–5 all connected; slot 1 quota-exhausted (auto-skipped, expected)
- Ghost job lock cleared (western-hnwi) at cold-start ✅
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB empty (0 entities) — ENABLE_AUTO_PIPELINE=false; pipeline idle; awaiting user instruction

---

## Current State (2026-07-28 — Session wrap-up; 200 entities; 32 contactable; quality fixes applied)

### What was done this session (2026-07-28 — continued from attachment)
1. **Email promotion bug fixed** (`web-enricher.ts`): `entityDomainTokens.size === 0` was passing ALL emails through domain check — company emails like `info@stocktitan.net` and `mike@sonomawestholdings.com` were being promoted as personal contacts. Fixed with three guards: (a) reject generic prefixes (`info@`, `contact@`, etc.), (b) reject financial aggregator/news domains, (c) when entity domain is unknown, require 2+ independent source corroboration before promotion.
2. **Financial aggregator blocklist added** to `web-enricher.ts`, `deep-web-osint.ts`, and `in-house-enricher.ts`: stocktitan.net, seekingalpha.com, benzinga.com, crunchbase.com, pitchbook.com, 20+ others.
3. **EDGAR name normalization fixed** (`western-hnwi-ingestion.ts`): Added `normalizeEdgarName()` — converts ALL_CAPS LAST FIRST format ("THIEL PETER" → "Peter Thiel", "KIM JAMES J" → "James J Kim"). Wired into SC 13D/G and DEF 14A yield sites. 48 existing ALL_CAPS names patched in DB via SQL UPDATE.
4. **Atlas run**: western-hnwi ingestion running (200 entities inserted, EDGAR SC 13D/G in progress). In-house enrichment got 32 contactable before session ended. Web-OSINT not yet triggered.
5. **API server** build clean (1197ms), all 5 Upstash slots connected (slot 1 quota-exhausted, auto-skipped).

### Next session: trigger web-OSINT enrichment on all entities
- `POST /api/ingest/web-osint-enrich {"batchSize": 100, "force": true}` — runs full AI-first pipeline (Perplexity + Gemini + Tavily + Exa + Groq)
- Ingestion still running in background — check western-hnwi job status first
- DB: 200 entities / 30 hot / 32 contactable at wrap-up

---

## Current State (2026-07-28 — Re-import #25 setup complete; all 24 secrets present; all workflows running; DB empty; pipeline idle)

### Import setup (2026-07-28 — re-import #25)
- `CI=true pnpm install --frozen-lockfile` ✅ (~32s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 555ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 1017ms)
- All 24 secrets carried over: SESSION_SECRET, REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY, GEMINI_API_KEY/_2/_3/_4, EXA_API_KEY/_2, TAVILY_API_KEY/_2/_3/_4
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB empty (0 entities) — ENABLE_AUTO_PIPELINE not set; pipeline idle; awaiting user instruction

---

## Current State (2026-07-28 — Re-import setup complete; all 24 secrets saved; all workflows running; DB empty; research NOT started)

### Import setup (2026-07-28)
- `CI=true pnpm install --frozen-lockfile` ✅ (~44s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 1612ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready)
- All 24 secrets saved: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY, GEMINI_API_KEY/_2/_3/_4, EXA_API_KEY/_2, TAVILY_API_KEY/_2/_3/_4
- Upstash slots 1–5 all connected (slots 1–3 confirmed in logs; 4–5 connecting at log cutoff)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- DB empty — ENABLE_AUTO_PIPELINE=false; research NOT started; awaiting user instruction

---

## Current State (2026-07-28 — web-osint-enrich fixed; Phase 0 AI-first confirmed; Gemini keys rate-limited; 101 entities in DB)

### web-osint Phase 0 fix (2026-07-28)
- Root cause: `/api/ingest/web-osint-enrich` was calling `enrichEntityOsint` (shallow 4-step DDG-only stub ending at line 389, ~1.8s/entity, no AI calls) instead of `deepWebOsintEnrich` (full AI-first pipeline with Phase 0 at line 1494)
- Fix: changed import + call in `ingest-enrichment.ts` to `deepWebOsintEnrich`; added `bayesianScore` to entity select; updated result handling to `DeepWebOsintResult` (removed `.website`, uses `.evidence.length`)
- Verified: 5/5 entities enriched, 0 skipped — Perplexity ✅ Tavily ✅ Exa ✅ all fire in parallel at Phase 0
- Gemini issue: all 4 keys hit "rate limit — key exhausted 5 min" simultaneously — free-tier RPM cap; keys auto-recover in 5 min; other LLMs cover in the meantime
- DB: 101 entities (71 HNWI, 30 Corporation); in-house enrichment complete (~60 contactable); western-hnwi still running (cleared stale dedup; second run inserted 100 + broad-discovery 1)
- Next: run full web-OSINT batch (100 entities, force=true) once Gemini keys recover

---

## Current State (2026-07-28 — Re-import setup complete; all 24 secrets saved; all workflows running; DB empty; research NOT started)

### Import setup (2026-07-28)
- `CI=true pnpm install --frozen-lockfile` ✅ (~33s)
- `pnpm --filter @workspace/db run push` → `[✓] Changes applied` ✅
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 754ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 782ms)
- All 24 secrets saved: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY, GEMINI_API_KEY/_2/_3/_4, EXA_API_KEY/_2, TAVILY_API_KEY/_2/_3/_4
- Upstash slots 1–5 all connected; slot 1 quota-exhausted (auto-skipped, expected)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- Ghost job lock cleared (western-hnwi) at cold-start ✅
- `ENABLE_AUTO_PIPELINE` not set → broad ingestion disabled; no research run; awaiting user instruction

---

## Current State (2026-07-28 — All 24 secrets saved; Upstash slots 2–5 healthy; DB empty; research not started)

### Secrets & restart (2026-07-28)
- All 24 secrets saved: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY, GEMINI_API_KEY/_2/_3/_4, EXA_API_KEY/_2, TAVILY_API_KEY/_2/_3/_4
- API Server restarted — Upstash slots 2–5 connected; slot 1 quota-exhausted (auto-skipped, expected)
- DB still empty; ENABLE_AUTO_PIPELINE=false; no research run — awaiting user instruction

---

## Current State (2026-07-28 — Fresh import setup complete; DB empty; all workflows running; 0 entities)

### Post-import setup (2026-07-28)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~36s); native bindings (onnxruntime, sharp) built
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis ✅ (port 6379) · artifacts/api-server: API Server ✅ (port 8080, build 907ms) · artifacts/apex-finder: web ✅ (port 23695, Vite ready 839ms)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- `/api/dashboard/stats` → 200, all zeros (empty database) ✅
- `ENABLE_AUTO_PIPELINE=false` confirmed in shared env → broad cold-start ingestion disabled; no credits spent
- `REDIS_URL=redis://localhost:6379` confirmed in shared env
- DB empty — no research run yet; user has not requested ingestion to start

---

## Current State (2026-07-28 — Re-import setup complete; 24 secrets set; DB empty; research NOT started)

### Import setup (2026-07-28)
- CI=true frozen-lockfile pnpm install (~39s) ✅
- DB schema pushed (`[✓] Changes applied`) ✅
- Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}` ✅
- All 24 secrets set: REDIS_URL_1–5 (slots 2–5 healthy, slot 1 quota-exhausted/auto-skipped), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4, WHOXY_API_KEY, GEMINI_API_KEY/\_2/\_3/\_4, EXA_API_KEY/\_2, TAVILY_API_KEY/\_2/\_3/\_4
- DB empty — cold-start auto-recovery ran; ENABLE_AUTO_PIPELINE not set; user instructed NOT to start research yet
- Ghost job locks cleared at startup (western-hnwi, companies-house-enrich, improve)

---

## Current State (2026-07-28 — Exa integrated; 2 keys saved; clean build; API healthy)

### Exa integration (2026-07-28)
- `researchWithExa()` added to `ai-extractor.ts` — Exa neural search (POST https://api.exa.ai/search) with `useAutoprompt: true`, `type: "neural"`, 7 results with text excerpts; fed into Groq for structured extraction
- Key rotation: `EXA_API_KEY` through `EXA_API_KEY_8` (2 keys saved); independent exhaustion map
- Source label: `"exa-groq"` (added to union type)
- Wired into 3 places (all in `Promise.all` — zero added latency):
  - `web-enricher.ts` Phase 0 → Phase 0.7 processing block (domain injection + scrape queue)
  - `web-enricher.ts` Phase 7.5 → `fuExa` follow-up per discovered person (`Exa[fu:FirstName]`)
  - `deep-web-osint.ts` Phase 0 → Exa processing block
- Build: clean (1768ms, no errors) ✅

---

## Current State (2026-07-28 — Tavily integrated; 4 keys saved; clean build; API healthy)

### Tavily integration (2026-07-28)
- `researchWithTavily()` added to `ai-extractor.ts` — Tavily search API (POST https://api.tavily.com/search) returns clean excerpts fed into Groq (llama-3.3-70b) for structured contact/owner extraction
- Key rotation: `TAVILY_API_KEY` through `TAVILY_API_KEY_8` (4 keys saved); 429 → exhausted 5 min then auto-recover; independent exhaustion map
- Source label: `"tavily-groq"` (added to union type)
- Wired into 3 places (all in `Promise.all` — zero added latency vs existing calls):
  - `web-enricher.ts` Phase 0 → Phase 0.6 processing block (domain injection + scrape queue)
  - `web-enricher.ts` Phase 7.5 → `fuTav` follow-up per discovered person
  - `deep-web-osint.ts` Phase 0 → Tavily processing block
- Evidence in UI shows `Tavily[groq]` / `Tavily[fu:FirstName]` labels
- Build: clean (874ms, no errors); `/api/healthz` → ok ✅

---

## Current State (2026-07-28 — AI source labels corrected; all 5 sources correctly represented in reactor diagram and evidence)

### AI source label cleanup (2026-07-28)
- `"tavily-groq"` → `"tavily"` everywhere (source type, evidence strings, follow-up labels)
- `"exa-groq"` → `"exa"` everywhere
- Evidence labels: `"Tavily[groq]"` → `"Tavily"`, `"Exa[groq]"` → `"Exa"`
- Evidence source strings: `"ai-tavily-groq"` / `"ai-exa-groq"` / followup variants → `"ai-tavily"` / `"ai-exa"`
- `reactor.tsx` corrected: Gemini node now `type:"ai-cyan"` (search source, not extraction layer); removed wrong `groq→gemini` edge; added `webdisc→gemini` + `gemini→semantic` edges; Wave 3 renamed "AI PHASE 0 — Perplexity · Gemini · Tavily · Exa in parallel"; mobile AI LAYER now shows all 6 AI nodes; `web-osint-enrich` job map includes Gemini
- `ai-extractor.ts` header updated to describe 5-source parallel architecture
- API build: clean (1417ms) ✅ · Frontend build: clean (7.09s) ✅

---

## Current State (2026-07-28 — All 24 secrets saved; Upstash slots 2–5 healthy; DB empty; pipeline idle; awaiting user instruction)

### Post-import setup + secrets (2026-07-28, latest import — Task #1)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~39s); all native bindings built (onnxruntime, sharp)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis ✅ (port 6379) · `artifacts/api-server: API Server` ✅ (port 8080, build 484ms) · `artifacts/apex-finder: web` ✅ (port 23695, Vite ready 849ms)
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- All 24 enrichment secrets saved: `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `PERPLEXITY_API_KEY`/`_2`/`_3`/`_4`, `WHOXY_API_KEY`, `GEMINI_API_KEY`/`_2`/`_3`/`_4`, `EXA_API_KEY`/`_2`, `TAVILY_API_KEY`/`_2`/`_3`/`_4`
- Upstash: slot 1 quota-exhausted (auto-skipped); slots 2–5 connected ✅
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion disabled; DB empty; no research started

---

## Current State (2026-07-28 — Re-import setup complete; Redis + API + web running; DB schema applied; 18,100 entities; 18,200 assets)

### Post-import setup (2026-07-28, this import — Task #1)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~42s); all native bindings built
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server (`artifacts/api-server: API Server`), apex-finder web (`artifacts/apex-finder: web`) workflows running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- `/api/dashboard/stats` → 200; entities=18,100 assets=18,200 hotLeads=3,953 ✅
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion disabled; no new research run
- All 15 secrets saved: `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `PERPLEXITY_API_KEY`/`_2`/`_3`/`_4`, `WHOXY_API_KEY`, `GEMINI_API_KEY` (new)

---

## Current State (2026-07-28 — Python tools installed; Phase L tool health panel redesigned; 2/4 tools ready)

### Python OSINT tools (2026-07-28)
- Python 3.11 installed via Replit module system (.pythonlibs/)
- holehe ✅ installed (email → 200+ platform accounts)
- maigret ✅ installed (username → 3,000+ social profiles)
- theHarvester ❌ requires Python ≥3.12; PyPI package is a 0.0.1 stub; real one (GitHub) won't install on 3.11
- GLiNER ❌ offline by default — start manually: `python3 scripts/gliner_service.py`; falls back to regex NER automatically
- API endpoint /api/enrich/python-tools returns: `{tools:{holehe:true,maigret:true,theHarvester:false},gliner:{available:false}}`
- install script (scripts/install-python-tools.sh) updated: uses `python3 -m pip`, documents theHarvester Python version constraint
- python-tools.ts fixed: buildPythonEnv() injects PYTHONUNBUFFERED; removed broken runSubprocessRaw reference

### Phase L tool health panel redesign (2026-07-28)
- PythonToolsPanel in data-sources.tsx rewritten: health summary bar (X/4 ready), per-tool rows with status badges (Ready/Not installed/Online/Offline), usage context (Auto vs On-demand), endpoint paths, and inline install instructions
- theHarvester source card in SOURCES: comingSoon removed, note added explaining Python ≥3.12 requirement

---

## Current State (2026-07-28 — Fresh import setup complete; all 14 secrets saved; Redis + API + web running; DB schema applied; 0 entities; no research run)

### Post-import setup (2026-07-28)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~35s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server (`artifacts/api-server: API Server`), apex-finder web (`artifacts/apex-finder: web`) workflows running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}` ✅
- `/api/dashboard/stats` → 200, all zeros (empty database) ✅
- All 14 secrets saved: `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `PERPLEXITY_API_KEY`/`_2`/`_3`/`_4`, `WHOXY_API_KEY`
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion disabled; no research run, no credits spent

---

## Current State (2026-07-27 — HNWI-first responsive frontend applied and verified; database empty; no research run)

### Frontend redesign (2026-07-27)
- Dashboard now leads with HNWI discovery and priority people cards, including separate Signal and Access scores, wealth/assets context, contact-path cues, source, and recency.
- Desktop shell uses a focused research-desk hierarchy; technical routes are grouped under quiet Workspace settings while People, Discover, Connections, and Field manual stay prominent.
- Mobile web layout verified at 390×844 with intentional compact header, one-column priority surface, wrapped controls, and no horizontal overflow.
- Production build passed; `/api/healthz`, `/api/dashboard/stats`, and `/api/dashboard/hot-leads` return 200. Database remains empty and broad ingestion is disabled.

### Current user-directed hold
- Securely saved: `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `PERPLEXITY_API_KEY`/`_2`/`_3`/`_4`, and `WHOXY_API_KEY`
- Workflows remain stopped by request; no ingestion, external research, or credit-consuming work was run
- Secret values were not read, printed, or written to project files

### Post-import setup (2026-07-27, this import — Task #1)
- `CI=true pnpm install` — all packages installed (~37s); all native bindings built (sharp, onnxruntime-node)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server (`artifacts/api-server: API Server`), apex-finder web (`artifacts/apex-finder: web`) workflows running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- `/api/dashboard/stats` → 200, all zeros (empty database) ✅
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion disabled
- All 4 artifacts registered: API Server, ApexFinder Pro, ApexFinder Mobile, Canvas

## Current State (2026-07-27 — Re-import setup complete; SESSION_SECRET present; Redis + API + web running; DB schema applied; 0 entities; all 4 artifacts registered)

### Post-import setup (2026-07-27, this import)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~40s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server (`artifacts/api-server: API Server`), apex-finder web (`artifacts/apex-finder: web`) workflows running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- `/api/dashboard/stats` → 200, all zeros (empty database) ✅
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion disabled
- All 4 artifacts registered: API Server, ApexFinder Pro, ApexFinder Mobile, Canvas
- SESSION_SECRET ✅; all 14 secrets added: REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/_2/_3, PERPLEXITY_API_KEY/_2/_3/_4, WHOXY_API_KEY
- Upstash slots 2–5 healthy; slot 1 quota-exhausted (graceful fallback, non-fatal)
- ENABLE_AUTO_PIPELINE not set → no ingestion running, no credits spent
- **Phase 7.5/7.6 added to web-enricher.ts**: iterative Perplexity follow-up after AI extraction — discovered persons fed back into Perplexity (max 2 follow-ups), new citation URLs scraped; no longer a one-shot linear pipeline
- **Profile Enrich button fixed**: now calls `/api/ingest/web-osint-enrich` (full Perplexity+DDG+scrape cycle) instead of `/api/ingest/in-house-enrich`

## Current State (2026-07-26 — Re-import setup complete; all 13 secrets restored; Redis + API + web running; DB schema applied; 0 entities)

### Post-import setup (2026-07-26, this import)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~31s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server (`artifacts/api-server: API Server`), apex-finder web (`artifacts/apex-finder: web`) workflows restarted and confirmed running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
- `/api/entities` → `[]` (empty database, as expected after fresh import)
- `/api/dashboard/stats` → 200, all zeros ✅
- `ENABLE_AUTO_PIPELINE` not set → broad cold-start ingestion remains disabled
- Optional workflows (apex-mobile, mockup-sandbox) remain stopped
- All 4 artifacts registered by platform: API Server, ApexFinder Pro, ApexFinder Mobile, Canvas
- All 13 secrets loaded: `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `PERPLEXITY_API_KEY`/`_2`/`_3`/`_4`
- Upstash slots 2–5 healthy; slot 1 quota-exhausted (graceful fallback, non-fatal)

### B&B Hotels case study (2026-07-26)
- Seed entity: B&B Hotels (Corporation, FR) — ID 1
- Deep-web OSINT: completed in ~4min, confidence 88, `direct_contact_candidate`, access 0.87
  - email: privacy.france@hotelbb.com (WRONG domain — hotelbb.com not hotel-bb.com)
  - Ownership chain: Goldman Sachs AM (confirmed, €1.9B 2019, exploring €3.5B sale) ← PAI Partners ← Carlyle ← Duke Street. Founder: François Branellec
  - Céline Vercollier (CEO) and Amir Mustafa (US CEO) correctly identified
  - Corp→Person hop extracted "Hotels CEO" — weak; missed all exec names
- 7 HNWI exec entities created from Gemini intel (IDs 2–8): Vercollier, Collet, D.Martin, Gerke, Duchini, M.Charles, Lacroix — all with email pattern firstname.lastname@hotel-bb.com (domain confirmed live, unverified deliverability)
- Atlas research sessions 1–8 complete (all path scores synthetic — graph isolated, 0 edges)
- Gemini advantage: org chart enumeration + email pattern; Our advantage: sourced ownership chain with PE history

## Previous State (2026-07-26 — Orient Express HNWI Atlas run complete; 5 entities; Perplexity credits exhausted across all slots)

### Orient Express HNWI Research (2026-07-26)
- Seed: Orient Express (Corporation, ID 1) — Accor/LVMH JV context node; no Atlas run on it
- HNWIs created and enriched: Sébastien Bazin (ID 2), Bernard Arnault (ID 3), Gilda Perez-Alvarado (ID 4), Guillaume de Saint Lager (ID 5)
- Deep-web OSINT: 4/4 enriched, 0 errors; Perplexity credits exhausted on all 5 Upstash slots — fell back to DDG+Groq for all entities
- Atlas run: all 4 HNWIs — graph isolated (0 edges, no registry ingestion yet); path scores are synthetic fallbacks
- Key findings:
  - Bazin: phone +33 1 45 38 88 00 (Accor HQ, not personal); no email; confidence 25
  - Arnault: email b.arnault@fondationlouisvuitton.fr (foundation, needs verification); phone +33 1 44 13 22 22 (LVMH HQ); confidence 83; AroundDeal twitter is noise
  - Perez-Alvarado: email gilda.perezalvarado@jll.com (STALE — pre-Accor JLL address); LinkedIn directory; confidence 50; dual role confirmed (Accor CSO + OE CEO)
  - de Saint Lager: ⚠️ IDENTITY CONFLICT — OSINT found "Founder & CEO Paragone / Director Barnes Interiors", not OE General Secretary; email info@paragoneagency.com is agency inbox; LinkedIn confirmed but ambiguous
- Perplexity direct API key added (`PERPLEXITY_API_KEY`); `ai-extractor.ts` now calls `api.perplexity.ai` directly (sonar-pro[direct] → sonar[direct]) before falling back to OpenRouter-routed Sonar; confirmed working — Omer Acar enrichment returned 8 citations via sonar-pro[direct] with zero credit errors
- Awaiting Google/Gemini comparison from user

## Previous State (2026-07-26 — Re-import setup complete; Redis + API + web running; DB schema applied; empty DB)

### Post-import setup (2026-07-26, this import)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~31s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server, apex-finder web workflows restarted and confirmed running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}` ✅
- `/api/entities` → `[]` (empty database, as expected after fresh import)
- Optional workflows (apex-mobile, mockup-sandbox) remain stopped

## Previous State (2026-07-26 — All 13 secrets set; auto-pipeline gated; Orient Express single-target Apex Atlas run complete)

### Orient Express case study (2026-07-26)
- User-provided target brief: `attached_assets/Pasted-The-Orient-Express-brand-is-owned-and-operated-as-a-joi_1785076892493.txt`.
- Added one research-only `Corporation` entity: **Orient Express**. No broad ingestion or registry population was started.
- Added `ENABLE_AUTO_PIPELINE=false` to the shared environment and gated `coldStartRecovery()` so an empty database cannot trigger broad discovery or registry ingestion on startup.
- Targeted deep-web job completed successfully: **1 enriched, 0 skipped, 0 errors**; 12 queries fired and 5 pages scraped.
- Live research layers used: Perplexity Sonar fallback, DuckDuckGo search, Groq structured extraction, and direct public-page parsing.
- Persisted findings: official organization email `contact@orient-express.com`; review-only named principals **Gilda Perez-Alvarado** (CEO) and **Guillaume de Saint Lager** (General Secretary); ownership summary returned Accor control, based on the captured Wikipedia/Accor PDF sources.
- Contact state: `organization_contact`, confidence 73, Access score 0.74. The India-based `info@orientexpress.in`, `+91-11-4151 4430`, and Unilocal social result are likely name-collision evidence and must not be treated as Orient Express (Accor) contacts.
- Full Apex Atlas session completed: Bayesian score 0.05 → 0.1644, path score 0.99, but graph remains isolated with 0 relationships. The generated pitch is therefore not actionable; its gatekeeper/path score is a synthetic fallback and should be reviewed before any outreach.
- Google/Gemini comparison baseline is now ready: compare against the attachment’s Accor/LVMH, Corinthian, Belmond, hotel, and train claims; separate factual ownership accuracy, source quality, entity resolution, contact attribution, and unsupported inference.

### Post-import setup (2026-07-26)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~35s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server, apex-finder web workflows restarted and confirmed running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":5}}` ✅
- All 13 secrets loaded via secure form: `SESSION_SECRET`, `REDIS_URL_1`–`REDIS_URL_5`, `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `OPENROUTER_API_KEY`/`_2`/`_3`/`_4`
- Upstash slots 2–5 healthy; slot 1 quota-exhausted (graceful fallback, non-fatal)
- Database is fresh/empty. OSINT ingestion intentionally NOT started — user will trigger a single-entity enrichment run for testing/study.
- Cold-start auto-ingestion that fires on empty DB was triggered on first boot but user has instructed to hold off further OSINT until ready.

| 2026-07-26 | **Perplexity Sonar Phase 0 fix**: Phase 0 was wired into `lib/deep-web-osint.ts` but the route imports `deepWebOsintEnrich` from `lib/web-enricher.ts` (via `lib/enrichment/web-discovery.ts` barrel). Added `researchWithPerplexity` import and full Phase 0 block to `web-enricher.ts` before Phase 1 (DDG). Build clean (1023ms). Live confirmation: first entity processed ("Scott Yocham J") — `Phase 0: Perplexity Sonar research complete hasEmail: true owners: 1 ownerContacts: 1`. Perplexity Sonar is now the first layer of every deep-web enrichment run. |

## Previous State (2026-07-26 — Fresh import; Redis + API + web running; all requested enrichment secrets restored)

### Post-import setup (2026-07-26)
- `CI=true pnpm install --frozen-lockfile` — all packages installed (~29s)
- `pnpm --filter @workspace/db run push` — schema applied (`[✓] Changes applied`)
- Redis, API Server, apex-finder web workflows restarted and confirmed running
- `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}` ✅
- `/api/entities` and `/api/dashboard/stats` return 200; the fresh development database currently has zero entities/assets.
- All requested secrets restored: `REDIS_URL_1`–`REDIS_URL_5` (Upstash slots 2–5 healthy; slot 1 quota-exhausted but non-fatal), `COMPANIES_HOUSE_API_KEY`, `GROQ_API_KEY`/`_2`/`_3`, `OPENROUTER_API_KEY`/`_2`

## Previous State (2026-07-25 — Phase K web-OSINT fixes complete) — 32,103 entities; all secrets set; Redis + API + web running; BAOLI test: email + instagram found

### Phase K web-OSINT enrichment fixes (2026-07-25)
- **scrapePage full browser headers** — added Accept-Language, Sec-Fetch-*, Cache-Control, Pragma, Upgrade-Insecure-Requests, Connection; TLD-aware locale selection (fr-FR for .fr/.be/.mc, etc.)
- **isBotBlock() CF-challenge detection** — detects cf_chl_opt, challenge-platform, jschl-answer, __cf_bm, ddos-guard, human verification signatures; added `botBlocked` flag to ScrapedPage interface
- **Wayback fallback improved** — triggers on `rootScrape.botBlocked || text.length < 500` instead of text.length only
- **Query city-duplication guard** — `tradingHasCity` flag prevents "Baoli Cannes Cannes email" double-city queries when tradingName already contains city
- **Layer 1 instagram/twitter capture** — `scrapeContactEmail` → `ContactPageResult` returns `{email, instagramUrl, twitterUrl}`; `OsintResult` now includes both social fields; `enrichEntityOsint` Step 4 persists them
- **Live verification**: BAOLI SAS → `reservations@baolicannes.com` (email) + `https://www.instagram.com/baolicannes` (instagram) found by Layer 1 Domain-Guess in single pass
- **Google/Gemini investigation**: Google.com server-side fetch returns JS-only noscript shell — Gemini AI Overview is JS-rendered, not accessible from Node.js without a real browser. Gemini API with Google Search grounding is the correct equivalent but requires a working GEMINI_API_KEY (free-tier quota exhausted on user's keys). Groq llama-3.3-70b remains the AI extraction layer.

### Environment
- **Replit PostgreSQL** connected — `DATABASE_URL` set automatically ✅
- **Local Redis** running on `redis://localhost:6379` — workflow `Redis` running ✅
- **SESSION_SECRET** — ✅ Set
- **REDIS_URL** — ✅ Set (local Redis, env var `redis://localhost:6379`)
- **Upstash Redis (`REDIS_URL_1`–`REDIS_URL_5`)** — ✅ Set; slot 1 quota-exhausted (non-fatal), slots 2–5 healthy
- **COMPANIES_HOUSE_API_KEY** — ✅ Set
- **GROQ_API_KEY** — ✅ Set

### Workflows running
| Workflow | Status |
|---|---|
| Redis | ✅ Running (port 6379) |
| `artifacts/api-server: API Server` | ✅ Running (port 8080) |
| `artifacts/apex-finder: web` | ✅ Running (port 23695) |
| artifacts/apex-mobile: expo | ⏸️ Optional / not required for web setup |
| artifacts/mockup-sandbox: Component Preview Server | ⏸️ Optional / not required for web setup |

### Post-import setup (2026-07-25, this import)
1. `CI=true pnpm install --frozen-lockfile` — all packages installed (pnpm v10.26.1, ~43s)
2. `pnpm --filter @workspace/db run push` — schema applied to PostgreSQL (`[✓] Changes applied`)
3. The imported artifact metadata was present, but the platform registry was empty; validating the four existing artifact manifests restored the managed workflows.
4. Redis, API Server, and apex-finder web workflows started; optional mobile and mockup workflows remain stopped.
5. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}` ✅
6. `/api/entities` and `/api/dashboard/stats` return 200 with zero records; the dashboard browser preview renders the empty-state screen.
7. Added `REDIS_URL_1`–`REDIS_URL_5` and `COMPANIES_HOUSE_API_KEY` through the secure secrets flow; API startup confirmed all five slots, with slot 1 quota-limited and slots 2–5 healthy.
8. Completed the prior handoff: structured contact-evidence audit rows are visible on profiles; duplicate dismiss/merge decisions persist in `dedup_reviews`; the pair key is unique and upserted safely.
9. Cleared API, web, mobile, shared-library, mockup, and script typechecks; applied the schema; production API/web builds passed; `/api/healthz` and the web root returned HTTP 200; final dashboard preview rendered successfully.

### Phase J2 verification (2026-07-24)
- Added the Western registry coverage matrix and `GET /api/registry-matrix`.
- Added live, normalized registry search for Norway BRREG, Czechia ARES, and France BODACC through `POST /api/registry-search`.
- Added fixture-style normalization tests covering valid records, missing identifiers, provenance, and registry adapter membership.
- Verified live sample searches for all three new registries with HTTP 200 responses and normalized records.
- Verified `/api/healthz`, `/api/pipeline/funnel`, `/api/dashboard/stats`, and the Data Sources browser page after applying the development Drizzle schema.
- Added an unavailable-data guard to the existing Funnel panel so an API/database error renders a stable state instead of crashing the page.
- Full workspace typechecks still report unrelated pre-existing errors; shared libraries typecheck, focused J2 tests pass (5/5), and API/frontend production builds pass.

### Phase J3 verification (2026-07-24)
- Added `identity_bundles` and `identity_candidates` schema tables for durable, provenance-backed identity evidence and review-only candidate links.
- Added deterministic identity bundle construction: normalized names, order/initial variants, registry identifiers, affiliations, locations, asset identifiers, public profile URLs, and source provenance.
- Added contextual candidate scoring and bounded variant indexing; name-only matches are rejected and no candidate can auto-merge entities or promote a contact.
- Added `POST /api/identity/resolve`, `GET /api/identity/stats`, `GET /api/identity/candidates`, and `PATCH /api/identity/candidates/:id`.
- Added the J3 Identity Resolution panel to Data Sources with a review-only run control and pending/confirmed/rejected counts.
- Applied the development schema, API build, frontend build, focused registry tests, and focused J3 resolver tests successfully. Live `/api/healthz` and `/api/identity/stats` respond successfully; fresh import currently reports zero bundles/candidates while ingestion repopulates the database.
- Full API typecheck still contains unrelated pre-existing errors outside J3; J3-specific type errors are cleared.

### Measured live state (2026-07-24 13:59 UTC)
- Entities: **0 visible in fresh database** | Assets: **0 visible** | Relationships: **0**
- Contact evidence: **not yet measured** — cache restoration is enabled through Upstash slot 2
- Research sessions: **0 at initial check**
- Active background work: semantic engine loading; cold-start recovery is non-fatal but persistent Redis cleanup is quota-limited
- Honest assessment: **app is running and the dashboard is verified; ingestion/persistent-cache operations may be limited until the Upstash request quota resets or the Redis plan changes**.

### Latest UI verification (2026-07-24 14:03 UTC)
- Mobile app bar keeps the single `APEX ATLAS` header and adds the current page/tab context to its right.
- Profile-specific duplicate mobile header rows were removed, so the profile no longer shows separate entity and `PROFILE` header bars.
- Profile tab content now uses the layout's page scroll container rather than a nested scroll container, allowing the full asset map and content below it to be reached on mobile.
- Frontend production build passes; API health remains `ok`; mobile previews were verified for `/profiles` and `/profile/1` at 390×844. `/profile/1` shows the loading state because the fresh development database currently has zero entities.

### Phase I — Road to 9/10 (implemented 2026-07-23)
All 4 Phase I items implemented and live. Build clean (esbuild ⚡ 1183ms). All 3 new endpoints verified returning 200:
- **I1** `resolveBeneficialOwner()` in `in-house-enricher.ts` — FAA LLC → person before enrichment (EDGAR EFTS + OpenCorporates)
- **I2** semantic-dedup threshold 0.93→0.87 + token overlap guard + `POST /api/relationships/name-exact-dedup` (strength 0.95, cross-registry exact matches)
- **I3-A** `POST /api/relationships/auto-detect-edgar-coinvestor` — EDGAR_CO_INVESTOR edges (HNWI/Gatekeeper co-shareholders, strength 0.75)
- **I3-B** `POST /api/relationships/foundation-colleagues` — FOUNDATION_COLLEAGUE edges (shared IRS 990 foundation name, strength 0.85)
- **I4** `enrichmentTier()` classifier — Tier 2 (FAA individuals) skips Wikidata/Wikipedia/ORCID/GitHub to focus budget on DDG-LinkedIn/DNS/RDAP
- Startup triggers added: edgar-coinvestor at 305s, name-exact-dedup at 310s, foundation-colleagues at 425s
- **Same-source duplicate review** — `GET /api/entities/same-source-name-clusters` groups exact names within normalized registries; `/duplicates` has a separate review-only tab and preserves manual merge/dismiss behavior
- Duplicate candidate token indexing now deduplicates tokens per entity, preventing self-pairs from repeated words in one name

### Iteration Log
| Date | Summary |
|---|---|
| 2026-08-04 | **OSINT-only product boundary completed and verified**: removed active pitch/safety helpers, pitch routes, lead creation, CRM bulk actions, and outreach-oriented telemetry; renamed research states and Evidence Path UI; preserved historical schema/client compatibility without using CRM fields for behavior. API 244/244 tests, API/web builds, Expo iOS/Android bundles, health/dashboard checks, 404 retired-route probes, and browser preview all passed. |
| 2026-08-03 | Corrected Atlas research completion semantics: zero approved contacts now remain `needs_follow_up`/`incomplete`, failed enrichment does not stamp `cookedAt`, and high-priority persona guidance requests another bounded pass. Propagated registry phone provenance through every Atlas/deep-web reachability prompt so EDGAR phones cannot create `DIRECT` access. Richard Leeds post-fix pass reported bounded access, 0 approved contacts, 5 reviewable candidates, and `needs_follow_up`; API suite passed 239/239 and the API build/health checks passed. |
| 2026-08-03 | Repaired legacy data-quality leaks: quarantined role/placeholder rows, cleared stale promoted contact state while retaining review provenance, classified Viken Shipping as a Corporation, expanded classifier coverage, and removed the duplicate mobile Reactor header. Verified 10 active entities / 9 visible business assets / 0 visible stock holdings; full API suite passed 211/211 and API/web builds passed. |
| 2026-08-02 | Final live discovery retry verified: the contextual/fictional-name gate rejected the previously observed Casino de Monte-Carlo “James Bond” pattern and the first corrected venue-owner round inserted 0 candidates. Focused discovery/contact/final-review tests passed 20/20; API build passed; Atlas remains running under job `e4cc9451-853e-4d5d-9887-8f216952be38`. |
| 2026-08-02 | Launched authorized Atlas background job `7ca90f62-07e5-44f4-8c65-a94e6eb55d40` with discovery-first live sources. Tightened broad discovery to require candidate-attributed ownership/wealth evidence, added 8 regression tests, hid interrupted weak records for review, and verified the first corrected venue-owner round inserted 0 weak candidates while Atlas continued running. |
| 2026-08-02 | Added bounded claim-source hardening: owner-resolution candidates now retain their attached source URLs, exact-claim verification can fetch those person-level URLs, and lead-generation/directory publishers are excluded from direct-contact corroboration and exact-claim fetching. Controlled canary on Edmund O Noel, Robert M Davidson, and Jacob Eiting completed 3/3 with 0 errors and 0/3 verified direct routes; blocked-publisher evidence remained review-only. Full API suite passed 101/101, API build and health passed. |
| 2026-08-02 | Completed the authorized controlled research canary and final persistence pass: web-OSINT evidence is run-tagged, superseded rows no longer contaminate scorecards, duplicate upserts refresh validation/provenance, organization contacts are excluded from personal reachability scoring, provider citation bundles remain review-only, and cross-publisher disagreement is not misclassified as same-publisher conflict. Final run 1/1 with 0 errors; 21 current-run evidence rows; scorecard identity 1.00, ownership 0.40, contact 0.369, access 0.12, wealth 0.183, freshness 0.253, source quality 0.705, overall 0.454. |
| 2026-08-02 | Completed final research hardening: candidate evidence now binds only to exact fetched pages, the ledger distinguishes cross-domain corroboration from same-publisher conflicts, Sherlock is a review-only Maigret fallback, and managed Python 3.11 verifies Holehe/Maigret/Sherlock on boot. 13 focused tests, API/web builds, health, tool-status, and `/research` checks pass; pipeline remains idle with no canary run. |
| 2026-08-02 | Completed research evidence hardening: candidate funnel persistence/review UI, `/research` route registration, canonical-domain scorecard inputs, stable-rerun coverage, and API build-entry correction. Focused tests 11/11, API/web builds, endpoint checks, and research preview pass; pipeline remains idle with no provider calls. |
| 2026-08-02 | **Atlas audit gate completed**: added strict sequential target processing, final target-scoped web/LLM review with fail-closed exact-evidence adjudication, research-only/org scope blocks, held asset publication, and managed Python-tool setup. API build and all 197 tests pass; live API/Redis/tool checks are healthy; database is empty and no controlled run was started. |
| 2026-08-01 | Completed cross-product UI/UX polish pass: refreshed web typography/theme, dashboard/ledger/profile/CRM/research/reactor hierarchy, mobile MCTS/manual states, type-aware profile signals, and icon-based status treatment. Web build, mobile typecheck, API health, and desktop/mobile previews verified. |
| 2026-07-31 | Completed contact-quality hardening: fail-closed name admission, no constructed emails, final contact-vector sanitization, organization/personal Access separation, and direct-contact-only hot flags. Rebuilt and restarted API/web; health and preview verified; no ingestion or research job active. |
| 2026-07-31 | Securely added fresh Perplexity keys `_7` and `_8`, restarted the API so the process loaded them, confirmed all eight numbered Perplexity slots active, preserved the prior partial Atlas results, and launched replacement job `8c24a586-6ad9-42c1-af36-1f8370645703` with the same bounded profile. |
| 2026-07-31 | Verified the running API's Perplexity pool through `/api/system/status`: numbered slots `_1` through `_6` are all present and active. The direct rotation source scans the base slot plus `_1` through `_8`, so newly added `_5` and `_6` are included; no restart was performed while Atlas was active. |
| 2026-07-31 | Restored the fresh import, applied the existing schema, verified Holehe/Maigret, rebuilt and restarted Redis/API/web, and launched one bounded discovery-first Apex Atlas run (`deaa85d0-1788-4eca-898d-2532c2ebbf48`). The run is healthy with 24 entities inserted; Exa/Tavily are producing results while exhausted Perplexity/Gemini fall back non-fatally. |
| 2026-07-31 | Imported-project setup completed without spending research credits: securely confirmed all 30 requested provider secrets, did not read or display values, did not restart failed app workflows, and left research/ingestion paused pending explicit approval. |
| 2026-07-27 | **HNWI-first frontend redesign applied and verified**: replaced the operations-led dashboard with responsive people discovery, priority HNWI cards, separate Signal/Access scores, contact-path cues, and clear empty/loading/error states; regrouped technical navigation under Workspace settings; desktop and 390px mobile previews verified; API health/stats/hot-leads returned 200; production build and frontend typecheck passed; no ingestion or research run. |
| 2026-07-26 | Completed a controlled Orient Express single-target run from the uploaded brief: auto-pipeline disabled; one corporation created; targeted deep-web enrichment returned 1/1 success with official Orient Express contact evidence and two review-only officers; full Apex Atlas session completed with no graph edges. Name-collision contacts and synthetic fallback pitch/path were explicitly flagged for review. |
| 2026-07-26 | Imported project setup completed: securely restored five Upstash Redis URLs, one Companies House key, three Groq keys, and four OpenRouter keys; installed frozen-lockfile dependencies; applied the Drizzle schema; restarted Redis/API/web workflows; verified `/api/healthz`, `/api/entities`, and `/api/dashboard/stats`; API and web are healthy, with a fresh empty database ready for ingestion. |
| 2026-07-26 | Fresh import boot: pnpm install (28s), DB schema push ([✓] Changes applied), Redis+API+Web workflows restarted, /api/healthz → ok; all 11 secrets restored (REDIS_URL_1–5 slots 1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/2/3, OPENROUTER_API_KEY/2); 9,500 entities + 2,384 hot leads carried from prior session |
| 2026-07-23 | Fresh import boot: pnpm install, DB schema push, all 3 workflows running, cold-start ingestion auto-started |
| 2026-07-23 | All Upstash secrets restored; API Server restarted with both slots confirmed live |
| 2026-07-23 | Import setup completed: locked dependencies restored, Drizzle schema applied, artifact-managed API/Web workflows restarted, endpoint checks and browser preview passed; live ingestion is active |
| 2026-07-23 | Phase I (road to 9/10) fully implemented: I1 beneficial owner resolution, I2 dedup tuning, I3 warm-path edges, I4 tiered enrichment |
| 2026-07-23 | Same-source duplicate review implemented: new cluster endpoint and `/duplicates` tab verified against live data; duplicate candidate self-pair regression fixed; API smoke tests 14/14 passed; API/Web production builds passed |
| 2026-07-24 | Fresh import boot: pnpm install (20.4s), DB schema push ([✓] Changes applied), Redis+API+Web workflows restarted, /api/healthz → ok (latencyMs:0), all 3 secrets set (REDIS_URL_1/2, COMPANIES_HOUSE_API_KEY), cold-start ingestion auto-started |
| 2026-07-24 | Imported project setup verified: API health and web root return 200; artifact registration was restored and ApexFinder preview screenshot verified |
| 2026-07-24 | Imported project setup completed: frozen-lockfile dependencies restored, schema applied, canonical artifact workflows registered and running, duplicate legacy workflows removed, secrets confirmed, and fresh API/web preview verified |
| 2026-07-24 | Second import setup: pnpm install (16s), all secrets added (REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY), schema pushed to fresh DB, API+web confirmed healthy; database is empty — ingestion needed to populate data |
| 2026-07-24 | Live-process bar redesign completed: replaced Lucide-icon ticker (broken clipping loop) with custom SVG glyph stream — 16 hand-coded glyphs (wikipedia, browser, github, dns, plane, registry, property, company, graph, etc.), icons move faster than explanatory text, seamless -50% loop on duplicated track, edge mask fade, process-specific glyphs+phrases for all 11 job types, desktop+mobile verified with 3 live jobs |
| 2026-07-24 | Live maintenance continued after setup: 28,000 entities, 28,000 assets, 642 contactable profiles, and 12,716 hot leads measured; relationships and research sessions remain pending |
| 2026-07-24 | Ran EDGAR issuer backfill and deterministic relationship passes: 228,362 CORPORATE_SERIES, 2,236 PROPERTY_AREA_PEER, 26 GEOGRAPHIC_PEER, 11 EDGAR_CO_INVESTOR, and 12 EDGAR_CO_SHAREHOLDER edges |
| 2026-07-24 | Restored 693 cached contacts; measured 936 contactable profiles, 343 emails, 613 phones, 100 EDGAR entities, 95 issuer-covered; API/web health and preview verified |
| 2026-07-24 | Third import setup: pnpm install (4m 6s), DB schema push ([✓] Changes applied), REDIS_URL_1/REDIS_URL_2/COMPANIES_HOUSE_API_KEY secrets added, Redis+API+Web workflows started, /api/healthz → ok (redis latencyMs:289), dashboard preview screenshot verified. Upstash quota still exhausted (500k limit reached) — ghost job cleanup non-fatal, dedup cleared for fresh ingest. Database empty; cold-start auto-ingestion active. |
| 2026-07-24 | Fixed in-house enrichment state handling so website/address-only evidence remains eligible for later contact enrichment; corrected build and restarted API successfully |
| 2026-07-24 | Improved dashboard live-process bars with process-specific explainer marquees, icon trails, fading edges, mobile stacking, and reduced-motion support; frontend build and canonical workflows verified |
| 2026-07-24 | Fourth import setup: pnpm install (22.3s), schema pushed, all 4 artifacts registered, Redis+API+Web workflows running, /api/healthz ok; 32,002 entities from FAA+HMLR auto-ingestion; REDIS_URL_1/2 and COMPANIES_HOUSE_API_KEY not yet set |
| 2026-07-24 | All 3 missing secrets added (REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY); API restarted — both Upstash slots confirmed live; 32,102 entities, 5 contactable profiles restored from cache; setup fully complete |
| 2026-07-25 | Fresh import boot: pnpm install (28s), DB schema push ([✓] Changes applied), all 4 artifacts re-registered via verifyAndReplaceArtifactToml, Redis+API+Web workflows running, /api/healthz → ok (redis latencyMs:2); fixed missing BookOpen lucide import in data-sources.tsx; dashboard preview verified at 32,001 entities; cold-start ingestion active |
| 2026-07-24 | Fifth import setup: pnpm install (25.4s), Redis workflow started, schema pushed ([✓] Changes applied), all 4 artifacts re-registered via verifyAndReplaceArtifactToml, OutreachAssistant missing import fixed in router.tsx, API/web workflows running, /api/healthz ok (redis latencyMs:2), dashboard verified at 11,150 profiles; REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY all set |
| 2026-07-24 13:22 | Fresh import setup: REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY added via secrets flow; pnpm install (1m52s); schema pushed ([✓] Changes applied); all 4 artifacts registered; Redis+API+web workflows running; /api/healthz ok (latencyMs:1); dashboard verified at 1,100 profiles with FAA+HMLR+Western HNWI ingestion active; both Upstash slots live |
| 2026-07-24 | 8 UI/UX fixes: (1) infinite scroll confirmed working; (2) removed duplicate "Preferred" contact badge; (3) added mobile profile header showing entity name + active tab + access badge; (4) fixed map height (clamp 320-520px, explicit on MapContainer); (5) renamed "Bayesian Score"→"Wealth Signal" and "Has direct contact"→"Has contact info" in deep-search; (6) outreach banner/section removed from Research Threads tab, renamed "Outreach Strategy"→"Research Threads"; (7) graph nodeCanvasObjectMode→"replace" eliminates black node text; "Approach Vector"→"How to Approach"; (8) job progress bars: done=green 100%, queued=pulsing, active=clamped ≤100% |
| 2026-07-24 | Latest import setup: requested and confirmed REDIS_URL_1, REDIS_URL_2, and COMPANIES_HOUSE_API_KEY through secure secrets flow; restored dependencies, pushed schema, registered all four artifacts, restarted Redis/API/web, verified API health and browser dashboard, and confirmed cold-start auto-ingestion is active |
| 2026-07-24 | Sixth import setup: pnpm install (1m 59s), schema pushed ([✓] Changes applied), REDIS_URL_1/REDIS_URL_2/COMPANIES_HOUSE_API_KEY added via secrets flow, API restarted — both Upstash slots live, /api/healthz ok (latencyMs:0), dashboard verified at 32,101 profiles (FAA auto-ingested), cold-start Western HNWI + broad discovery active |
| 2026-07-24 19:38 | Imported project setup completed: frozen-lockfile dependencies installed, schema pushed, all four artifact metadata records restored, canonical Redis/API/web workflows running, live dashboard screenshot verified, and FAA/HMLR ingestion produced 11,600 entities/assets |
| 2026-07-25 | Fresh import setup completed: securely restored REDIS_URL_1–REDIS_URL_5 and COMPANIES_HOUSE_API_KEY, installed frozen-lockfile dependencies, applied the Drizzle schema, registered all four artifacts, restarted Redis/API/web, verified API health and web preview, and recorded the empty fresh database while cold-start ingestion runs |
| 2026-07-24 | Imported project setup finalized: secure keys confirmed, frozen-lockfile dependencies restored, Drizzle schema applied, all four artifacts registered, Redis/API/web workflows healthy, API and browser preview checks passed; optional mobile and mockup services remain stopped |
| 2026-07-24 13:59 | Imported project setup reverified after secure key entry: dependencies restored, schema applied, Redis/API/web healthy, `/api/healthz` returned Redis ok, web preview returned 200 and rendered the empty-state dashboard; Upstash persistent Redis reported its 500,000-request quota exhausted |
| 2026-07-24 14:03 | Fixed mobile profile chrome: removed duplicate profile headers, moved current tab context beside APEX ATLAS in the shared top bar, removed nested profile scrolling, and verified mobile previews plus production frontend build |
| 2026-07-25 03:15 | **Phase J4–J9 fully implemented**: domain-resolver.ts (J4 GLEIF/MX/SPF), digital-footprint.ts (J5 DDG+contact-page scraper, 7 query templates), contact-attribution.ts (J6 geometric-mean score, threshold 0.52); phase-j.ts route rewritten integrating all three + J7 source-cooldown scheduler + J8 graph-neighbour context; GET /pipeline/phase-j/source-quality added (J9); status endpoint now returns J0–J9 all true; PhaseJCompletionPanel expanded (8-stat grid, module badges, outcome pills); SourceQualityPanel added; API build clean 778ms |
| 2026-07-25 07:09 | **Imported handoff completed**: restored artifact registrations from existing manifests; added Redis slot 5 and Companies House secret; implemented durable N4 dedup review upserts, L3 persisted contact-evidence loading, API type fixes, stale research-field cleanup, and Expo symbol fixes; schema push, full workspace typecheck, API/web builds, live health checks, and dashboard screenshot all passed |
| 2026-07-24 | Added Phase J to `improvements.md`: a multi-re-import roadmap for raising validated public-contact yield through funnel measurement, non-terminal social enrichment, Western registry coverage, identity/domain resolution, lawful digital-footprint discovery, candidate validation, budgeted multi-pass scheduling, graph-assisted research, and re-import checkpoints |
| 2026-07-24 | Clarified Phase J as a lawful research-phase roadmap rather than a current source or capacity allowlist; lawful discovery remains broad during private development, while public-production limits and safeguards are deferred to separate release hardening |
| 2026-07-24 | Added non-blocking `productionReviewStatus` source markers (`review_required`, `reviewed_for_production`, `not_yet_assessed`); markers are internal review reminders only and do not restrict private research or alter source coverage |
| 2026-07-24 18:40 | Phase J2 verified: restored frozen dependencies and development schema, added BRREG/ARES/BODACC live registry coverage with normalization fixtures, verified all three live adapters plus `/api/registry-matrix`, fixed Funnel API error-state rendering, and confirmed API/web workflows and Data Sources preview |
| 2026-07-24 19:10 | Phase J3 implemented: added deterministic identity bundles, review-only cross-registry candidate scoring, durable provenance tables, identity review APIs, Data Sources controls, focused resolver tests, and verified API/web builds plus live health/stats endpoints |

---

## Previous State (2026-07-23 — GitHub import recovery) — All core workflows running, ingestion auto-started

### Environment
- **Replit PostgreSQL** connected — `DATABASE_URL` set automatically ✅
- **Local Redis** running on `redis://localhost:6379` — workflow `Redis` running ✅
- **SESSION_SECRET** — ✅ Set
- **REDIS_URL** — ✅ Set (local Redis)
- **Upstash Redis (`REDIS_URL_1`)** — ✅ Set (permanent dedup set)
- **Upstash Redis (`REDIS_URL_2`)** — ✅ Set (permanent contact cache)
- **COMPANIES_HOUSE_API_KEY** — ✅ Set

### Workflows running
| Workflow | Status |
|---|---|
| Redis | ✅ Running (port 6379) |
| API Server | ✅ Running (port 8080) |
| ApexFinder Web | ✅ Running (port 23695) |

### Post-import recovery + comprehensive audit (2026-07-23)

#### Recovery steps
1. `pnpm install` — all 1,229 packages installed
2. `pnpm --filter @workspace/db run push` — schema applied to fresh PostgreSQL DB
3. All three Upstash secrets restored (REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY)
4. API Server and ApexFinder Web restarted — both Upstash slots confirmed live on boot
5. FAA + Western HNWI + broad-discovery auto-started on cold boot
6. 729 contactable entities restored from Upstash contact cache (slot 2) on boot

#### Bugs fixed this session
1. **research.tsx line 426** — user-facing terminal placeholder said "L4 MCTS Deep Path Exploration"; fixed to "L4 UCT Deep Path Exploration (120 rollouts)". MCTS is L4's internal algorithm; the system is Hybrid Research.
2. **ingest-enrichment.ts foundation-filings route** — `rows` SELECT was missing `phone`, `linkedinUrl`, `twitterHandle`, `instagramHandle`, `telegramHandle` columns, causing `computeContactConfidence` to receive `undefined` for all social signals and undercount confidence. Fixed: all 5 columns added to the select.

#### Full codebase audit — confirmed working ✅
- **Pipeline order**: web-first ✅ — broad-discovery fires at 15s, social-discovery at 45s, messenger at 60s, Hybrid Research at 90s, registries at 180s+
- **RECURRING_JOBS scheduler**: active at 46min mark — broad-discovery (30min), deep-web OSINT (30min), social-discovery (30min), Hybrid Engine re-score (2h), messenger-discovery (4h), registry re-verification (6h), persona loop (24h)
- **social-discovery.ts**: exists, routes exist, confidence correctly uses `computeContactConfidence` → `update.contactConfidence` ✅
- **messenger-discovery.ts**: exists, routes exist, confidence correctly uses `newConfidence` ✅
- **foundation-filings.ts**: exists, routes exist, confidence correctly uses `computeContactConfidence` ✅ (row select bug fixed above)
- **SKIP_DOMAINS**: does NOT block linkedin/twitter/instagram ✅ — social media routed to dedicated module
- **contact-validation.ts**: `isValidPublicEmail`, `sanitizePublicEmail` exist with full blocklist ✅
- **computeContactConfidence**: accepts all signal fields (email +35, phone +25, linkedin +15, telegram +12, twitter +8, instagram +5, address +5) ✅
- **Phase H DB columns**: linkedinUrl, twitterHandle, instagramHandle, telegramHandle, personalWebsite, foundationName all present in schema ✅
- **No user-facing MCTS strings**: all remaining MCTS references are internal code comments, variable names, or import statements ✅
- **ingest-pipeline.ts**: no "bulk-mcts" references ✅ — confirmed "bulk-hybrid-research" throughout
- **jobs.tsx**: no "bulk-mcts" references ✅

#### Test suite run — verified
- **Persona Loop**: 100 entities processed, 226 suggestions, 0 errors ✅
- **Hybrid Research bulk**: 300/300 sessions, 0 errors ✅
- **API health**: Redis latency 1ms, all endpoints responding ✅
- **Both Upstash slots**: connected on every restart ✅

#### Live DB state at end of session
- Entities: 32,101 | Assets: 32,100 | Relationships: 230,692
- Hot leads: 14,808 | Contactable: 729 | Research sessions: 624
- Persona suggestions: 226 (82 high, 84 medium, 60 low priority)
- FAA ingestor: running (cold-boot auto-start) | Western HNWI: running | Broad discovery: completed
- Deep Web OSINT: running (startup pipeline phase 1)

---

## Previous State (2026-07-23 — full audit + bug-fix pass) — All workflows running, ingestion active

### Environment
- **Replit PostgreSQL** connected — `DATABASE_URL` set automatically
- **Local Redis** running on `redis://localhost:6379` — workflow `Redis` running ✅
- **SESSION_SECRET** — ✅ Set
- **Upstash Redis (`REDIS_URL_1`)** — ✅ Set (permanent dedup set)
- **Upstash Redis (`REDIS_URL_2`)** — ✅ Set (permanent contact cache)
- **COMPANIES_HOUSE_API_KEY** — ✅ Set

### Workflows running
| Workflow | Status |
|---|---|
| Redis | ✅ Running (port 6379) |
| API Server | ✅ Running (port 8080) |
| ApexFinder Web | ✅ Running (port 23695) |

### What was verified and fixed this session (2026-07-23 — comprehensive audit)

**Codebase audit results — all Phase H features confirmed present:**
- ✅ Pipeline IS web-first: deep-web-osint at 15s, social-discovery at 45s, messenger at 60s, then Hybrid Engine at 90s, registries at 180s, graph at 240s, deep enrichment at 360s
- ✅ Recurring scheduler (RECURRING_JOBS / setInterval) active at 46-min mark — 7 persistent jobs (broad discovery, deep web, social, Hybrid Engine, messenger, registry, persona loop)
- ✅ All Phase H DB columns present: linkedinUrl, linkedinHeadline, twitterHandle, twitterBio, instagramHandle, telegramHandle, telegramBio, personalWebsite, foundationName
- ✅ All 3 enrichment modules exist and are routed: social-discovery.ts, messenger-discovery.ts, foundation-filings.ts
- ✅ SKIP_DOMAINS in web-enricher.ts does NOT block social media
- ✅ contactConfidence awards points for twitter (+8), instagram (+5), telegram (+12)
- ✅ Cold-start retry logic: 3 attempts with 10s intervals before aborting
- ✅ No "mcts" references in startup.ts phases or recurring scheduler labels

**Bugs found and fixed:**
1. **deep-web-osint.ts SKIP_DOMAINS** — still blocked linkedin/twitter/x/instagram even though social-discovery handles them. Fixed: removed social media from SKIP_DOMAINS, kept only search engines, e-commerce, encyclopaedias, gov registries.
2. **ingest-pipeline.ts line 345** — catalog entry `id: "bulk-mcts"` still present. Fixed → `bulk-hybrid-research`.
3. **jobs.tsx line 38** — UI job definition `id: "bulk-mcts"`. Fixed → `bulk-hybrid-research`.
4. **outreach.tsx** — 3 user-facing strings said "MCTS research session" / "MCTS investigation". Fixed → "Hybrid Research session" / "Hybrid Research investigation".
5. **profile.tsx** — "MCTS winning path" in Outreach Assistant description. Fixed → "Hybrid Research winning path".
6. **manual.tsx** — "MCTS Research Session" in Field Manual. Fixed → "Hybrid Research Session" with 5-layer description.
7. **data-sources.tsx** — "MCTS path scoring" in Semantic Embedding description. Fixed → "Hybrid Research path scoring".
8. **ingest-enrichment.ts social-discovery** — `contactCacheSet` used `result.confidence` (module-internal 0–100 signal) instead of `update.contactConfidence` (recomputed from all signals). Fixed.
9. **ingest-enrichment.ts messenger-discovery** — same wrong confidence in cache write. Fixed → uses `newConfidence`.
10. **ingest-enrichment.ts foundation-filings** — MISSING `computeContactConfidence` call entirely; contactConfidence never updated after foundation enrichment. Fixed: computes from all signals including new email/address, saves to DB and cache.

**Functional tests run:**
- Persona Loop (50 entities): ✅ 223 suggestions, 0 errors
- Hybrid Research bulk (300 entities): ✅ 300/300, 0 errors, 300 sessions
- API Server build: ✅ clean
- Frontend production build: ✅ clean

**Active ingestion at time of writing:**
- FAA: ✅ done (20,032 records, 30,000 dedup-skipped)
- Land Registry PPD: running (~8,750+ inserted, targeting 50,000)
- Western HNWI: running
- Deep-web OSINT: running (hot leads pass)
- Social discovery, Messenger discovery: running (from maintenance pipeline)

**Live DB at last check:** 44,901+ entities, 230,693 relationships, 738 contactable, 844 research sessions

---

## Previous State (2026-07-23 — pipeline recovery verified) — Redis + canonical API + Web running

### Environment
- **Replit PostgreSQL** connected — `DATABASE_URL` set automatically
- **Local Redis** running on `redis://localhost:6379` — workflow `Redis` running ✅
- **SESSION_SECRET** — ✅ Set
- **Upstash Redis (`REDIS_URL_1`)** — ✅ Set (permanent dedup set)
- **Upstash Redis (`REDIS_URL_2`)** — ✅ Set (permanent contact cache)
- **COMPANIES_HOUSE_API_KEY** — ✅ Set

### Workflows running
| Workflow | Status |
|---|---|
| Redis | ✅ Running (port 6379) |
| API Server | ✅ Running (port 8080) |
| ApexFinder Web | ✅ Running (port 23695) |

> **Verified pipeline recovery (2026-07-23):** canonical artifact workflows are running and `/api/healthz` returns Redis `ok`. Live database state: **81,528 entities, 80,305 assets, 264,253 relationships, 16,305 hot leads, 767 contactable entities, 600 research sessions**. FAA and HMLR jobs completed with 0 errors. Deep-web OSINT remains active as a background enrichment pass; its records are validated by a shared public-email sanitizer.

> **Contact filtering completion note (2026-07-23):** Finished the interrupted contactability UI/UX task. Entity Ledger contact filtering is now server-side and paginated, so it no longer stops at the old 500-row client-side cap or checks nonexistent `contactEmail`/`contactPhone` fields. Added Any Contact, Email, Phone, WhatsApp, Telegram, and Instagram filters to desktop and mobile, documented the query contract in OpenAPI, and regenerated the typed React/Zod clients. Web/API builds and frontend typecheck pass. Filter requests reach the API correctly; this fresh import's PostgreSQL schema has now been applied and dashboard/entity endpoints are responding normally.

> **Persona loop completion note (2026-07-23):** The original live run completed successfully for 100 real HNWI/Gatekeeper entities with **1,180 suggestions and 0 errors** (644 high / 241 medium / 295 low). After the pipeline recovery and enrichment stages, a fresh 100-entity run also reached `done` with **489 suggestions and 0 errors**. The database currently contains **1,669 improvement logs across all 8 deterministic personas**.

> **Hybrid Research verification note (2026-07-23):** Two fresh scheduled bulk passes reached `done`, each with **300/300 sessions created and 0 errors**, for **600 persisted `Pitch Generated` research sessions**. Sample sessions contain non-empty winning paths, MCTS/UCT steps, path scores, and generated outreach pitches. The stale queued `bulk-mcts` lock is repaired on startup and stale queued jobs are superseded by the bulk route.

> **Contact-data integrity note (2026-07-23):** A shared validator now rejects search-engine diagnostics and placeholder/privacy relay addresses across web and in-house enrichers. Boot sanitation removed **55 invalid PostgreSQL emails and 31 invalid cached entries**; the known `error-lite@duckduckgo.com` residue is gone. Contact confidence is recomputed without the invalid email, while valid phone and LinkedIn evidence is preserved.

### What was done this session (2026-07-23 — post-import setup)

1. **Dependencies restored** (`pnpm install`) — lockfile satisfied in 22s; the imported web and API services build and start successfully.
2. **DB schema pushed** (`pnpm --filter @workspace/db run push`) — schema applied to fresh Replit PostgreSQL; entity count queries now succeed.
3. **Workflows restarted** — Redis ✅, API Server ✅, ApexFinder Web ✅ all running.
4. **Cold-start auto-recovery triggered** — empty DB detected; server auto-started FAA, HMLR, broad discovery, and Western HNWI ingestion.
5. **Secrets restored** — REDIS_URL_1 and REDIS_URL_2 are set for persistent dedup/contact caching, and COMPANIES_HOUSE_API_KEY is set for optional Companies House enrichment. DATABASE_URL and SESSION_SECRET are present.

> **Import state (2026-07-23):** All three core workflows are running under artifact-managed workflows. The existing Drizzle schema is applied to the fresh PostgreSQL database, both persistent Redis slots connect successfully, and health, dashboard, hot-lead, and ingestion-job endpoints have been verified at HTTP 200. The database starts empty after import and is being populated by live public-registry ingestion.

### What was done this session (2026-07-23 — mobile UX fixes + star/hide/MCTS rename)

**5 targeted fixes + 2 new features — all graduated directly to production:**

1. **Mobile dashboard stats bar removed** (`dashboard.tsx`): `StatsBar` was rendering on mobile AND desktop, causing two conflicting stat areas (top bar showed "0 Active Research" while the green banner showed 3 jobs). Fixed by wrapping `<StatsBar />` in `<div className="hidden md:block">` — mobile now uses only `MobileStatTiles` + `MobileOperationsBanner` which have correct live job counts.

2. **"Active Research" → "Active Tasks"** (`dashboard.tsx`): Desktop StatsBar "Active Research" tile now reads `jobs.length` from `useJobPoll()` instead of `activeResearchSessions` from the DB stats endpoint. Correctly reflects live running background tasks. Link goes to `/jobs`.

3. **"MCTS Bulk Research" → "Hybrid Research"** (`ingest-pipeline.ts` line 345): The job label shown in the mobile "RESEARCH ACTIVE" banner and all job lists now says "Hybrid Research" instead of "MCTS Bulk Research".

4. **DB schema** (`lib/db/src/schema/entities.ts`): Added `isStarred boolean DEFAULT false` and `isHidden boolean DEFAULT false` columns. Schema pushed (`[✓] Changes applied`).

5. **Star + Hide API endpoints** (`routes/entities.ts`):
   - `PATCH /api/entities/:id/star` — toggles `isStarred`, clears entity list cache
   - `PATCH /api/entities/:id/hide` — toggles `isHidden`, clears entity list cache
   - `GET /api/entities` default view now excludes `isHidden=true` entities; `?starred=true` returns only starred; `?hidden=true` returns only hidden.
   - Hot leads (`routes/dashboard.ts`): `GET /dashboard/hot-leads` now filters `isHidden = false` so hidden profiles never appear in the priority queue.

6. **Entity Ledger — view mode tabs** (`entities.tsx`):
   - Desktop: "All / Starred / Hidden" pill tabs added to the toolbar (before the Live Intel button)
   - Mobile: "All / ★ Starred / ◌ Hidden" row added above type filter chips
   - View mode drives the API query (`?starred=true` / `?hidden=true`)

7. **Entity Ledger — Star/Hide buttons** (`entities.tsx`):
   - Desktop table: Star (⭐) and Hide (👁) icons appear in the per-row hover action group alongside Profile/Network/Research/Delete
   - Mobile card (expanded): 3-column action grid → 5-column with Star and Hide/Unhide buttons
   - Optimistic UI: local state updates immediately on click; API call fires in background; hidden entities removed from default view instantly

**Verified:** Production build passes. PATCH star/hide endpoints return `{id, isStarred}` / `{id, isHidden}` as expected.

> **Current import verification note (2026-07-23):** Fresh dependencies were restored from the lockfile. The web server returns HTTP 200 and `/api/healthz` reports Redis healthy; both Upstash Redis connections also initialize successfully. Dashboard data endpoints currently fail because PostgreSQL is unavailable in this imported workspace; do not interpret that as an empty database. The three configured workflows are running. The screenshot helper could not resolve the web preview because the imported artifact registry is empty, although the web server itself responds successfully. The production web build passes. Typecheck still reports pre-existing imported-project errors in shared UI typings/generated client declarations and the optional Expo artifact.

> **Responsive polish verification note (2026-07-23):** Mobile dashboard now mounts the full activity/context strip and keeps it visible during PostgreSQL outages; the entity ledger distinguishes loading, unavailable, and genuinely empty states; profile tabs use compact horizontally scrollable mobile labels and remain sticky while browsing; deep search uses a shorter mobile explanation and stacked pipeline/results layout; mobile menu controls meet touch-target sizing. Desktop dashboard remains the full two-column command center. ApexFinder production build passes. Browser/API 500s are still the known PostgreSQL-unavailable condition; Redis and `/api/ingest/jobs` remain healthy.

> **Mobile navigation note (2026-07-23):** Removed the mobile bottom navigation bar and its reserved 60px content padding. Mobile navigation now uses only the existing hamburger-triggered side menu; desktop navigation is unchanged.

### What was done this session (2026-07-23 — re-import #51 nav + UX fixes)

1. **Nav reordered** (`layout.tsx`): Intel HQ → Entity Ledger → Search → Network Graph → Intel Terminal → CRM Pipeline → Outreach, then collapsible "Tools & Admin" (Persona Loop, Data Sources, OSINT Tools, Duplicates, Background Jobs, Field Manual). Footer → "Phase G · v0.3".
2. **Router secondary routes** (`router.tsx`): /improvements, /data-sources, /osint-tools, /duplicates exposed directly instead of `/_` prefixes.
3. **BackgroundActivityCard** (`dashboard.tsx`): upgraded from one-liner ticker to live panel — polls /api/ingest/jobs every 15s, shows each running job name + progress bar (up to 3 visible).
4. **"Avg Signal" → "Wealth Signal"** in stats bar — clearly distinct from the Access score concept.
5. **Profile dual badges** (`profile.tsx`): Access and Wealth badges now side-by-side with clear "Access" / "Wealth" labels instead of stacked with a single "HNWI Signal" caption.
6. **Profile CRM link** fixed: `/crm` → `/pipeline` (direct route, no redirect needed).
7. **All 4 artifacts registered** + secrets set (REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY).

### What was done this session (2026-07-23 — Research Command Center frontend)

1. **Canvas design direction**: extracted the real dashboard into the mockup sandbox and created one responsive Research Command Center direction. Desktop and mobile previews are live on Canvas; the mockup keeps the Atlas dark emerald/blue language while foregrounding contactability and visible research progress.
2. **Dashboard hierarchy** (`artifacts/apex-finder/src/pages/dashboard.tsx`): replaced the map-first Intel HQ with a responsive Best Next Contacts queue and Background Activity rail. Access/contactability is primary; wealth, assets, and registry context are secondary.
3. **Live research visibility**: the dashboard polls `/api/ingest/jobs` every 5 seconds, showing queued/running task labels, progress, messages, completed results, retry state, and a real `/jobs` activity link. Mobile uses a horizontal activity feed before the contact queue.
4. **Production navigation and states**: lead cards link to real profile/network routes, show only contact evidence available from the API contract, remove manual target-count ingestion controls from the dashboard, and preserve a compact global context section.
5. **Verification**: ApexFinder production build passes; dashboard-specific TypeScript is clean. Existing typecheck failures remain in shared `button-group.tsx` and `calendar.tsx`. PostgreSQL-backed dashboard requests still return 500 in this import, so the new UI renders an explicit recoverable unavailable-data state rather than an unexplained empty database.

### What was done this session (2026-07-23 — re-import #51 nav restore)

1. **Nav reordered and restored** (`layout.tsx`): renamed mainNav items to correct Atlas labels (Intel HQ, Entity Ledger, Search, Network Graph, Intel Terminal, CRM Pipeline, Outreach). Added "Tools & Admin" collapsible section (Persona Loop, Data Sources, OSINT Tools, Duplicates, Background Jobs, Field Manual). Footer updated to "Phase G · v0.3".
2. **Router secondary routes restored** (`router.tsx`): `/improvements`, `/data-sources`, `/osint-tools`, `/duplicates` exposed directly instead of `/_` prefixes. Legacy redirects updated (/intel→/research, /ledger→/profiles).
3. **All 4 artifacts registered** via verifyAndReplaceArtifactToml — platform auto-detected api-server, apex-mobile, mockup-sandbox. Artifact-managed workflows are now canonical.
4. **Secrets set**: REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY all confirmed.

> **Root cause of missing UI changes:** previous sessions' layout/router changes were never committed to GitHub. Only Context.md docs were pushed. On each import, origin/main is the source of truth. Fix: commit code changes before ending each session.

### What was done this session (2026-07-23 — access-first UX and live task visibility)

1. **Access Score separated from wealth signal**: added a contactability-first `accessScore` based on public contact evidence, confidence, and directness. The existing Bayesian score remains labeled as signal context and is no longer presented as reachability.
2. **Lead ranking corrected**: dashboard hot leads are ranked by Access Score, with wealth/registry signal retained as supporting context.
3. **User-facing hierarchy improved**: dashboard/jobs language now prioritizes profiles, discovery, enrichment, running tasks, and AI suggestions over internal ingestion jargon. Existing dark emerald/blue Atlas styling and routes are preserved.
4. **Responsive affordances retained**: desktop and mobile cards, task progress, active-task states, data attributes, and profile/list score badges were kept aligned.
5. **Workflow recovery**: restored `API Server` and `ApexFinder Web` project workflows in `.replit` so the imported project can be previewed alongside Redis.

> **Import #40 note (2026-07-22):** pnpm install (~18s). DB schema pushed (`[✓] Changes applied`). No port conflicts on startup. API Server ✅ + Web Frontend ✅ running via managed workflows. API /healthz → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. DB empty at boot → cold-start auto-recovery triggered FAA + HMLR + Western HNWI ingestion.
> **Port conflict fix (if needed):** kill -9 $(lsof -ti:8080 -ti:23695) then restart `API Server` and `Web Frontend`.
> **Recurring import gotcha:** `manual.tsx` has smart/curly quotes in JSX string props (lines ~984-986). Each import may re-introduce this bug if the file reverts from git. Fix: change outer quote delimiter to single-quotes on those lines.

### Database (2026-07-22 — re-import #46, post-Apex Atlas session)
- **Entities**: 33,100 (FAA + HMLR + EDGAR — auto-ingested on cold start)
- **Relationships**: 229k+ (cluster + co-filer + semantic dedup edges)
- **Hot Leads**: 15,811
- **Contactable**: 180 (in-house enricher running continuously)
- **Wealth Tiers**: Ultra >$100M: 7,392 · Very $30-100M: 4,016 · HNW: 24,568 · Unknown: 1,100
- **Research Sessions**: many (MCTS bulk-run has run multiple passes)

### What was done this session (2026-07-22 — UI/UX overhaul: clickable stats, score labels, nav reorder, manual Intel HQ)

**5 targeted UX fixes across 5 files — no backend changes, all live via Vite HMR:**

1. **`utils.tsx`**: ScoreBadge now shows "Reach 82" instead of a bare number — users immediately understand what the score means. Tooltip: "how reachable this person is".
2. **`dashboard.tsx`**: Hot Leads and Contactable stat tiles are now clickable Links (→ /entities?hot=1 and /entities?contactable=1). "W-HNWIs" → "HNWI Profiles". "Signal Avg" → "Avg Reach". "Live Signals" → "Top Hot Leads". "View all →" link added to panel header. Each lead card is now a full Link to the profile page (not just the footer buttons).
3. **`entities.tsx`**: URL param filtering — `?hot=1` and `?contactable=1` now activate a filter mode with a colored banner and clear button. Loads 500 records when filtering so the list is complete.
4. **`layout.tsx`**: Nav reordered to match investigation workflow (HQ → Ledger → Search → Graph → Terminal → CRM → [Tools & Admin separator] → Persona Loop → Data Sources → OSINT Tools → Duplicates → Field Manual). Group label "Tools & Admin" added.
5. **`manual.tsx`**: Level I renamed "INTEL HQ" (was "BASICS"). Content completely rewritten to explain Intelligence HQ — stat tiles, Reach Score scale, Top Hot Leads panel, daily workflow steps. LEVELS sidebar titles updated to match sidebar nav order.

### What was done this session (re-import #44 — Phase 2 Mobile Pass + Phase 3 Field Manual — 2026-07-22)

**Direct source-file changes across 4 files — no canvas, no sandbox. All changes survive re-imports.**

Changes made:
- `manual.tsx`: Fixed "5th signal" → "4th signal" in Level III (semantic embedding is the 4th, not 5th signal); "5-layer search" heading → "4-signal search"; pin label updated to match. Fixed "Phase 9 — In-House OSINT Enricher" → "Phase F" (correct phase naming). Updated persona count "6" → "8" in 3 places (Level I nav list, Level VII intro, Level VII pin); replaced stale 6-persona FeatureGrid with accurate 8-persona grid (Data Engineer, Data Analyst, Intel Systems Analyst, Business Engineer, UX Designer, Architect, Data Integrity Auditor, Hybrid Architecture Auditor). Added missing `Palette` icon import.
- `osint-tools.tsx`: Pagination control now mobile-safe — page count text hidden on mobile (`hidden sm:block`), compact `{page}/{totalPages}` shown instead; page number buttons reduced to 3 (always fits 390px); `flex-wrap` on button row.
- `data-sources.tsx`: All 15 action button rows now mobile-safe — added `gap-3 min-w-0 line-clamp-2` to description spans, wrapped buttons in `flex-shrink-0` divs so they never get pushed off-screen. Descriptions trimmed to be concise.

**Confirmed clean:**
- All 11 pages mobile-safe at 390px: desktop-only tables/toolbars are `hidden md:flex`; profile contact bar uses `flex-wrap` + `max-w-[220px] sm:max-w-none`; graph entity selector is `absolute left-3 right-3` (full-width on mobile).
- API Server + Web Frontend both running, /healthz → OK.
- Maintenance pipeline running: 279 contact cache entries restoring, embeddings computing, persona loop sweeping.

**Next session:**
- No further mobile or Field Manual work needed — both phases complete.
- Optional: screenshot verification pass if desired.

---

### What was done this session (re-import #42 — UI/UX Polish Pass 1 — 2026-07-22)

**Direct source-file polish across 14 files — no canvas, no sandbox. All changes committed to git.**

Changes made:
- `layout.tsx`: Updated version label `v0.2 · 32.5k entities` → `Phase G · v0.3`
- `dashboard.tsx`: Removed `ring-2 ring-inset ring-amber-500/20` inconsistency from Hot Leads card; changed signal text from `truncate` → `line-clamp-2` in both desktop and mobile signal panels
- `crm.tsx`: Added `overflow-x-auto` to desktop Kanban board container for mid-size screens
- `research.tsx`: Added `break-words` to MCTS reasoning text div; added `sm:min-w-[140px]` to algorithm pipeline stage cards
- `deep-search.tsx`: `truncate` → `line-clamp-1` on entity name h3 in search results
- `graph.tsx`: Added `max-w-[90vw]` to desktop floating toolbar to prevent overflow
- `improvements.tsx`: `bg-muted/30` → `bg-primary/5 border border-primary/10` for action taken block; persona grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6`
- `osint-tools.tsx`: Category chips scrollable on mobile (`overflow-x-auto flex-nowrap sm:flex-wrap`); scroll-to-top on pagination change
- `entities.tsx`: Live Intel slide-over width `w-[380px]` → `w-[min(380px,100vw)]` for full mobile coverage
- `profile.tsx`: Source Ledger table `min-w-[600px]` prevents column squash on mobile; MCTS steps `max-h-40` → `max-h-80`; removed `line-through` on missing completeness fields (replaced with `opacity-40`)
- `duplicates.tsx`: Entity comparison panel stacks vertically on mobile (`flex-col md:flex-row`)
- `data-sources.tsx`: Status message text hidden on mobile (`hidden sm:inline`) to prevent button overflow

**Phase plan for next session:**
- Phase 2: Full mobile pass (screenshot all 11 pages at 390px, fix remaining layout breaks)
- Phase 3: Field Manual — verify all level content is accurate, update data counts

---

### What was done this session (re-import #36 — Phase G nav link + session resume — 2026-07-22)

Added missing OSINT Tools sidebar nav link (`Telescope` icon, `/osint-tools`) between Data Sources and Field Manual in `artifacts/apex-finder/src/components/layout.tsx`. This was the one incomplete piece from the prior session — the page (331 lines), router entry, and API backend were all already built. Page loads 8,000 tools with category chips, search, and pagination. Phase G now fully visible and navigable.

---

### What was done this session (re-import #35 — Phase G complete — 2026-07-22)

**Phase G — Semantic Intelligence Layer fully implemented and deployed:**

1. **G1 semantic engine** (`lib/semantic-engine.ts`) — all-MiniLM-L6-v2 ONNX, 384-dim, warms up on boot, loads Redis cache, exports `getAllEmbeddings()` for cross-module use
2. **Hybrid search signal 4** (`lib/hybrid-search.ts`) — 4-signal RRF now includes true sentence embeddings; activates when ≥100 embeddings cached
3. **`POST /api/ingest/compute-embeddings`** — fixed: raised batchSize cap 2k→50k, added `offset` param, skips already-cached entities when `force=false`; startup triggers at 4 min + 32 min
4. **`GET /api/search/embedding-status`** — returns `{modelLoaded, cacheSize, model, dimensions}`
5. **G2 web OSINT enricher** (`lib/web-osint-enricher.ts`) — DuckDuckGo + EDGAR + GLEIF + OpenCorporates, wired to `POST /api/ingest/web-osint-enrich`
6. **G2b semantic entity resolution** (`routes/relationships.ts`) — `POST /api/relationships/semantic-dedup`: groups entities by normalised registry prefix (faa/edgar/hmlr/brreg/ch), compares cross-registry pairs cosine>0.93, creates LIKELY_SAME_PERSON edges; startup triggers at 8 min + 34 min; compared 1.7M pairs on first run
7. **G5 OSINT tools directory** (`routes/osint-tools.ts`) — 4,400+ categorised tools from tomvaillant/osint-tool-database (HuggingFace), 21 categories, 24h Redis cache
8. **Data Sources page** — Phase G section (violet) with Semantic Embedding Engine + OSINT Tools Directory cards; ComputeEmbeddingsButton (live cache counter) + SemanticDedupButton in controls panel
9. **Phase G chapter** in `improvements.md` — full investigation summary, integration decisions, per-item status
10. **`improvements.md`** — Phase G added as new chapter covering G1–G6

**Verified endpoints:**
- `GET /api/search/embedding-status` → `{modelLoaded:true, cacheSize:5391}`
- `POST /api/relationships/semantic-dedup` → compared 1,746,938 pairs (faa:5045, hmlr:342, edgar:4); 0 edges (correct — EDGAR only has 4 embeddings so far)
- `GET /api/osint-tools/categories` → 4,400 tools, 21 categories ✅

### What was done this session (re-import #31 — Deep Web OSINT — 2026-07-22)

**Deep Web OSINT Enricher built and deployed (additive — does not replace existing tools):**

1. **`artifacts/api-server/src/lib/deep-web-osint.ts`** — new module (~350 lines):
   - 12 rotating real browser User-Agent signatures (Chrome/Firefox/Safari/Edge on Win/Mac/Linux)
   - Dual search engines: DuckDuckGo HTML (`html.duckduckgo.com/html`) + Bing HTML (`bing.com/search`)
   - 4–7 context-aware query templates per entity using ALL available metadata:
     N-number (FAA aircraft), company name (EDGAR/CH), location, filing type, asset type
   - Follows top 3 non-social result URLs → scrapes actual pages for mailto: hrefs
   - Cross-validation scoring: same email in N independent sources → confidence (42/62/78/88)
   - Results mirror to Upstash slot 2 (REDIS_URL_2) — survives DB resets

2. **Route: `POST /api/ingest/deep-web-osint`** (new, in ingest.ts)
   - `batchSize`, `hotOnly`, `force` params; same job/poll pattern as other enrichers
   - `DELETE /api/ingest/deep-web-osint-lock` for ghost lock cleanup

3. **`startup.ts`** — two new auto-triggers:
   - 35 min: deep web OSINT pass 1 — hot leads (bayesianScore ≥ 0.5), batchSize 500
   - 45 min: deep web OSINT pass 2 — all HNWI/Gatekeeper, batchSize 1000
   Runs AFTER all in-house enricher passes (25min) so structured DBs exhausted first

4. **UI**: "Deep Web OSINT" button (cyan) added to Data Sources controls panel
   Polls job progress, shows live count of entities found

5. **Secrets** — all 3 set: REDIS_URL_1 ✅ REDIS_URL_2 ✅ COMPANIES_HOUSE_API_KEY ✅

6. **Route verified**: `POST /api/ingest/deep-web-osint` → jobId confirmed live

### What was done this session (re-import #30 — improvements.md audit + Phase F — 2026-07-22)

**Improvements.md full audit and Phase F implementation:**

1. **Audited all phases A–E** — all items already implemented in codebase (B2, B3, C1–C3, D1–D2, D3, E1, E3, E4). Updated all status markers to ✅ 2026-07-22.

2. **F1: Wikidata associate seeding** — `POST /api/relationships/seed-wikidata-associates` existed but was never auto-triggered. Added startup trigger at **360s (6 min)**, fires after in-house EDGAR enricher so Wikidata hits exist before SPARQL queries run. Creates `FAMILY_OF` / `KNOWN_ASSOCIATE` edges.

3. **F2: Pitch backfill auto-trigger** — `POST /api/research/backfill-pitches` existed but never scheduled. Added startup trigger at **660s (11 min)**, fires after MCTS pass 2 (8 min). Retries placeholder pitches.

4. **F4: Populate-notes auto-trigger** — `POST /api/ingest/populate-notes` existed but never scheduled. Added startup trigger at **110s**. Auto-fills entity notes from top asset description for entities with blank notes — improves BM25 recall.

5. **Added Phase F** to improvements.md (F1–F5) covering Wikidata seeding, pitch backfill, wealth tier segmentation, notes auto-populate, and MCTS gatekeeper routing bias.

6. **All 3 secrets confirmed** — REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY set via secure form.

---

### What was done this session (re-import #24 — app review completion — 2026-07-21)

**Completed the interrupted app review from previous session:**

1. **`avgBayesianScore` type bug fixed** — `artifacts/api-server/src/routes/dashboard.ts` line 227: PostgreSQL `avg()` returns a numeric string; wrapped in `parseFloat(String(...))` so the API now returns a proper JS number. Verified: `typeof avgBayesianScore === "number"`.

2. **Profile score labeling confirmed correct** — Previous session's fix is in the code:
   - `ScoreBadge` in header shows `(bayesianScore * 100).toFixed(0)`, labeled "HNWI Signal" ✅
   - Contact confidence badge shows `{conf}% contact data` with tooltip "separate from HNWI Signal score" ✅
   - Confidence breakdown panel shows "Overall Confidence" (0-100 integer) with circular gauge ✅
   - No label confusion remaining.

3. **Code review of all 12 pages** — clean on: dashboard, entities, profile, graph, research, crm, data-sources, improvements, duplicates, manual, deep-search. No blocking bugs found beyond #1 above.

4. **Confirmed non-issues:**
   - `marker-blue/emerald/amber` CSS classes → defined in `src/index.css` ✅
   - Graph defaulting to entity ID 1 → entity 1 exists (Etos Air Llc) ✅
   - ScoreBadge 0-1 scale → correct ✅
   - FAA body param `maxRecords` → matches API ✅

5. **Screenshot verification note** — Vite HMR WebSocket prevents automated `networkidle` screenshots in dev mode. Both services verified working via curl (port 80 proxy → 200, port 23695 → 200, port 8080 → 200). All API endpoints returning correct data.

### What was done this session (re-import #22, session 2 — 2026-07-21)

**Redis contact cache layer — enrichment now survives DB resets:**

1. **`artifacts/api-server/src/lib/redis.ts`** — Added slot-2-specific contact cache helpers:
   - `getContactCacheClient()` — returns `_permanentClients[1]` (REDIS_URL_2) with slot-1 fallback
   - `contactCacheSet(stableKey, data)` — writes `CachedContact` JSON to Redis, no TTL (permanent)
   - `contactCacheGet(stableKey)` — reads a single entry
   - `contactCacheScanAll()` — full scan of `contact:v1:*` keys (used by startup restore)
   - `contactCacheCount()` — counts cache entries
   - Stable key format: `contact:v1:{sourceRegistries[0]}` (e.g. `contact:v1:edgar:cik123`) — derived from source data, stable across GitHub imports

2. **`artifacts/api-server/src/routes/ingest.ts`** — After every enrichment DB write, also mirrors to Redis slot 2. Derives stable key from `entity.sourceRegistries[0]`; falls back to `name:{name}` if no registry ID.

3. **`artifacts/api-server/src/lib/startup.ts`** — Two new maintenance steps (run before isHot sync on every boot):
   - **Step 0a: Redis → PostgreSQL restore** — scans slot 2 for `contact:v1:*` keys, matches each entity by sourceRegistries pattern, backfills contact fields if entity currently has none
   - **Step 0b: PostgreSQL → Redis backfill** — reads all entities with contact data from PostgreSQL and writes to slot 2 if not already cached; captures enrichments done before Redis mirroring was deployed

4. **Enrichment run results** (2026-07-21):
   - 89 entities backfilled from PostgreSQL → Redis on first boot after deploy
   - 26+ new entities enriched with new Redis-mirroring code (enricher still running)
   - **Total: 114 entities with contact data** (email/phone/LinkedIn in PostgreSQL + mirrored to Redis)
   - Redis slot 2 now has 115+ `contact:v1:` entries — permanent, survives imports

### What was done this session (re-import #22 — 2026-07-21)

**Standard re-import setup:**
1. `pnpm install` — fresh install, completed in ~15s
2. `pnpm --filter @workspace/db run push` — schema applied (additive, no changes)
3. Redis workflow started ✅
4. API Server (manual) started ✅ — port 8080
5. Web Frontend (manual) started ✅ — port 23695
6. Cold-start auto-recovery detected empty DB → FAA (30k) + HMLR (2k) auto-ingested; Western HNWI background job started
7. All 4 artifacts re-registered (apex-finder via verifyAndReplaceArtifactToml; api-server, apex-mobile, mockup-sandbox auto-detected by platform)
8. API healthy: /healthz ✅ · /dashboard/stats ✅ (32,000 entities, 32,000 assets, 7,454 hot leads)

### What was done this session (re-import #21 — 2026-07-21)

**improvements.md — all 6 remaining ⬜ items implemented:**

1. **Expanded relationship-building pipeline in `startup.ts`** — replaced the single 15s cluster trigger with a full 5-step pipeline on every populated-DB boot:
   - 15s: `auto-detect-clusters` (CORPORATE_SERIES edges)
   - 20s: `auto-detect` (KNOWN_ASSOCIATE from shared addresses)
   - 25s: `auto-detect-edgar-cofilers` (EDGAR_CO_FILER edges)
   - 30s: `auto-detect-ch-codirectors` (SHARED_DIRECTOR edges — gated on CH API key)
   - 35s: `seed-edgar-associates` (KNOWN_ASSOCIATE from live EDGAR EFTS)
   - Fixes: "L1 graph traversal blind" + "Isolated node — no relationships mapped"

2. **CH enrichment auto-trigger** — `POST /api/ingest/companies-house-enrich` at 90s (batchSize: 200, gated on CH API key). Fixes: "Hot lead real-data pipeline incomplete — enrichment pending".

3. **OCCRP enrichment auto-trigger** — `POST /api/ingest/occrp` at 150s (batchSize: 300). Fixes: "Single source — corroboration needed".

4. **Extracted `trigger()` helper** in `startup.ts` — replaces 4 copies of the same fetch/log/catch boilerplate. All 9 scheduled triggers now use it.

5. **improvements.md** — all 6 remaining ⬜ items marked ✅ (19/19 patterns now addressed).

---

### What was done this session (re-import #20, session 2 — 2026-07-21)

**Startup.ts performance + auto-trigger improvements (improvements.md batch):**

1. **Steps 4, 5, 7 rewritten** — all previously did sequential awaited DB writes per entity (bottleneck: 11,878 writes in step 5, 32,000 in step 4). Now collect all updates first, then write in parallel chunks (100 for step 4, 50 for steps 5 & 7). Boot results: step 4 synced 32,000 liveSource markers, step 5 populated 2,000 sparse notes, step 7 cleared 0 needsEnrichment flags — all ran in parallel and logged correctly.

2. **Bulk MCTS auto-trigger scaled** — `batchSize: 60` → `batchSize: 200` at 45s. Second pass added at 8 min (another 200). `bulk-mcts` added to INGESTOR_TYPES for ghost cleanup on boot (first boot had 409 from stale ghost — fixed next boot).

3. **In-house enricher auto-trigger added** — fires at 120s: `POST /api/ingest/in-house-enrich` batchSize: 500. `in-house-enrich` added to INGESTOR_TYPES.

4. **Cluster detection** — 228,828 new CORPORATE_SERIES edges created at 15s trigger (2,085 clusters). 100 EDGAR StockHolding assets created by step 6.

5. **improvements.md** — 8 new ✅ items: all MCTS cold-session patterns, sparse notes patterns, zero-contact-vector patterns marked done.

### What was done this session (re-import #17, Session 2 — 2026-07-21)

**5 improvements from improvements.md implemented:**

1. **Startup auto-maintenance** (`artifacts/api-server/src/lib/startup.ts`):
   - When DB is populated on boot, runs 4 background tasks: isHot sync, entity reclassification, FAA coordinate backfill, liveSource provenance marker backfill
   - Result this boot: 7,432 hot flags synced, 22,807 Corp + 581 Trust reclassified, 64 FAA assets checked (already geocoded)

2. **New Duplicate Entity Review page** (`artifacts/apex-finder/src/pages/duplicates.tsx` + nav):
   - Route: `/duplicates` · Nav item: "Duplicates" (Copy icon)
   - Token-similarity algorithm detects pairs sharing ≥2 significant name tokens across all 32k entities
   - Each pair shows entity cards with type badge + Bayesian score, swap-direction button, Merge + Dismiss actions
   - **Merge endpoint** (`POST /api/entities/:id/merge/:targetId`): reassigns assets + relationships from target to primary, merges sourceRegistries/metadata/notes, deletes target, clears cache
   - **Candidates endpoint** (`GET /api/entities/duplicate-candidates`): returns top 200 pairs sorted by token overlap — registered BEFORE `:id` route to avoid Express routing conflict
   - 200 real candidates found immediately (Wells Fargo variants, series LLC families, etc.)

3. **isHot flag auto-sync** — already covered in (1) above

4. **Entity type reclassification** — already covered in (1) above

5. **liveSource provenance backfill** — already covered in (1) above

### What was done this session (re-import #6, Session 1 — 2026-07-20)

**1. Field Manual mobile view fixes:**
- Fixed 5-step workflow grid: replaced inline `borderRight` with responsive Tailwind `border-b md:border-b-0 md:border-r` — items now stack cleanly as vertical cards on mobile
- Fixed Level IV edge types grid: changed `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` — was too narrow (185px columns) on 390px screens
- Updated Level VIII enrichers list: replaced "Hunter.io + Apollo.io (email/LinkedIn — paid)" with "In-House OSINT (Wikidata · Gravatar · GitHub · pattern gen)"
- Updated Level VIII Hunter/Apollo callout → describes the in-house engine
- Updated Level X contact confidence scoring text → references In-House Enricher instead of Hunter/Apollo
- All changes hot-reloaded via Vite HMR

**2. In-House OSINT Enrichment Engine (replaces Hunter.io + Apollo):**
- New file: `artifacts/api-server/src/lib/in-house-enricher.ts`
  - **Source 1: Wikidata SPARQL** — structured data for public figures (email, website, LinkedIn URL)
  - **Source 2: Wikipedia API** — article extract scraping for email/LinkedIn
  - **Source 3: GitHub API** — search by full name, extract public profile email (60 req/hr, no auth)
  - **Source 4: Email pattern generation + Gravatar MD5 verification** — generates first.last/flast/f.last/etc. patterns, verifies each against Gravatar hash (200 = confirmed email)
  - **Source 5: Company domain resolver + DNS MX validation** — company name → .com heuristic, validates with `dns.resolveMx`
  - **Source 6: RDAP domain contact** — ICANN RDAP registrant email for corporate domains
  - **Source 7: ProPublica 990 Finder** — US nonprofit executive contacts + website scrape
- New route: `POST /api/ingest/in-house-enrich` (batchSize, force, entityIds params; same job/poll pattern as web-osint-enrich)
- New route: `DELETE /api/ingest/in-house-enrich-lock` — manual ghost-lock clear
- Updated `data-sources.tsx`:
  - Phase 9 source definition: replaced "Hunter.io + Apollo.io" card with "In-House OSINT Enricher" (green, free-tier, no paid API)
  - Added `InHouseEnrichButton` component (polls job progress, same UX as `WebOsintButton`)
  - Added quick-action button row in the controls panel
  - Updated Phase 9 section heading: "Commercial Enrichment" → "In-House OSINT Engine"
- Verified endpoint works: `POST /api/ingest/in-house-enrich` → returns jobId, runs in background, job completes cleanly

**Re-import setup:**
- pnpm install (fresh), db schema push, secrets set (SESSION_SECRET, REDIS_URL_1, COMPANIES_HOUSE_API_KEY)
- Workflows: Redis ✅ · API Server ✅ (manual workflow) · Web Frontend ✅ (manual workflow)
- Note: managed artifact workflows (artifacts/api-server: API Server, etc.) also registered but not started — manual "API Server" and "Web Frontend" workflows are the active ones
- DB already had 32,600 entities from prior session (cold-start auto-recovery detected populated DB)

### Next unlock to reach 9.2
Run **IN-HOUSE ENRICH** on HNWI/Gatekeeper entities — Wikidata SPARQL will hit well-known public figures; Gravatar verification will confirm email patterns for executives with corporate domains. Contactable count: 0 → target ~200+ with in-house engine alone.

### What's new this session (2026-07-20 — second re-import)

**5 improvements built:**
1. **Auto-pitch / Critic synthesis enriched** — `POST /research/run` now calls `orchestrate()` (full Planner→Retriever→Analyst→Critic) and builds a rich `critiqueNote` from the top-3 ranked candidates with reasoning. Pitch generation wrapped in try-catch (always creates session, never 500s). File: `artifacts/api-server/src/routes/research.ts`.
2. **CH company officers button** — `ChOfficersButton` in data-sources.tsx. Polls job at `/api/ingest/job/:jobId`. Triggers `POST /api/ingest/ch-company-officers` (background job enriching all Corporation entities with officer lists stored in `metadata.chOfficers`).
3. **CH co-director edges button** — `ChCodirectorsButton` calls `POST /api/relationships/auto-detect-ch-codirectors`. Builds `SHARED_DIRECTOR` edges between entities that share a common CH officer.
4. **Populate notes button** — `PopulateNotesButton` calls `POST /api/ingest/populate-notes`. Enriches entity notes from filing metadata (formType, fileDate, companyName, orgnr, CH directors, nationality, location).
5. **EDGAR stock assets button** — `EdgarStockButton` calls `POST /api/ingest/create-edgar-stock-assets`. Creates `StockHolding` asset records for SEC EDGAR large-shareholder entities with no assets yet.

**New persona added:**
6. **Data Integrity Auditor** (`data_integrity_auditor`) — 7th persona in `persona-engine.ts`. Enforces the zero-synthetic-data rule. Checks: synthetic flags in metadata, missing provenance, placeholder names, fake emails/phones, synthetic asset identifiers, enrichment-pending hot leads, missing liveSource markers. Color: red `#EF4444`. Run 3 confirmed: **0 synthetic violations** across 300 entities — data purity rule is being respected.

**Data operations run this session (all via API, not UI buttons):**
- POST /ingest/create-edgar-stock-assets → 2,053 StockHolding assets created
- POST /ingest/populate-notes → 35,856 entities enriched (paginated, 2k/page)
- POST /ingest/sync-hot-flags → 17,161 hot leads
- POST /ingest/reclassify-entity-types → 24,144 Corp, 690 Trust, 11,022 HNWI
- POST /relationships/auto-detect-clusters → 229,282 edges across 2,096 clusters
- POST /ingest/companies-house-enrich → 50 entities enriched (contactConfidence only; key not set)
- 40 research sessions (MCTS+Critic+Pitch) on top HNWI + Trust hot leads

**Bugs fixed:**
- OOM crash from 10 parallel research sessions → `--max-old-space-size=3072` in node start
- `req.body` undefined on CH officers POST → nullish coalesce `?? {}`
- populate-notes loading 35k rows → paginated loop (2k/page)
- `sql not defined` in co-directors → added sql to drizzle-orm import

### What's pending
- **Ingest data**: Run FAA (`POST /api/ingest/faa`), HMLR (`POST /api/ingest/land-registry`), Western HNWI (`POST /api/ingest/western-hnwi`) to populate entities and assets. Optionally clear Upstash dedup first.
- **COMPANIES_HOUSE_API_KEY**: Set this secret in Replit to enable CH officer address lookups. Without it, the enricher still recomputes `contactConfidence` for all entities.
- **REDIS_URL_1**: Set this Upstash secret to persist dedup across restarts.

---

## Phase 3 — MCTS & Outreach Upgrade (2026-07-20) ✅ COMPLETE

### What was built

1. **MCTS contact scoring** (`graph-engine.ts`, `mcts-agent.ts`): `contactConfidence`, `contactEmail`, `contactPhone` added to `GraphVertex`, `EntityRow`, `PathStep`; `evaluateWarmth()` gives +0.15 UCT bonus for nodes with confidence ≥ 50 and +0.10 for any known email/phone; winning path now carries all three fields; HNWI reasoning line reports direct contact status.
2. **MCTS Terminal — path step detail** (`research.tsx`): New `PathNodeContact` sub-component renders a confidence bar + clickable `mailto:`/`tel:` links inside every path node card (mobile stack + desktop horizontal). New `CopyBriefButton` component generates a formatted plain-text outreach brief from the full path and copies it to clipboard.
3. **Pitch generator real contacts** (`pitch-generator.ts`, `research.ts`): `PitchContext.targetEntity` gains `contactEmail` + `contactPhone`; `intelBlock()` emits `CONTACT:` and `PHONE:` lines when present; `research.ts` pitch route now passes entity contact fields into the generation context.
4. **CRM notes + follow-up date + Export PDF** (`crm.tsx`): Desktop session detail panel now has a notes textarea and follow-up date picker — saved to `research_sessions.notes` and `research_sessions.followUpDate` via a direct PATCH to the existing status route (route accepts these extra fields regardless of Zod schema). "Export as PDF" opens a `window.open()` formatted print view with all three pitch sections. `selectSession()` pre-fills notes/date on open.
5. **DB schema** (`research_sessions.ts`): Added `notes text` and `followUpDate date` columns; `pnpm --filter @workspace/db run push` applied.
6. **Mobile approach — tabbed pitch modal** (`approach.tsx`): `PitchModal` replaced with a three-tab version (Initial / Follow-Up / Intro Script) that parses the stored JSON sequence; each tab shows its section in a `ScrollView`; header gains a Share icon button and a footer **SHARE THIS PITCH** button both wired to `Share.share()`; `SelectionContext.PathStep` updated with the new contact fields.

---

## Iteration Log

| Date | What changed |
|---|---|
| 2026-07-23 | **Mobile navigation simplification**: removed the bottom bar menu and its reserved viewport space, leaving the hamburger side menu as the only mobile navigation. Verified at 390×844; production build passes and the web workflow is running. |
| 2026-07-23 | **Responsive mobile polish pass**: mounted the approved activity/context feed in the mobile dashboard, removed duplicate mobile job polling, added explicit Entity Ledger loading/unavailable/empty states, tightened mobile profile tabs and touch targets, simplified Deep Search mobile copy and stacked its pipeline/results layout, restarted the web workflow, verified 390px mobile and 1440px desktop screenshots, and confirmed the production build passes. |
| 2026-07-23 | **Research Command Center frontend**: extracted and live-previewed one responsive Canvas direction, graduated the hierarchy into the production dashboard, added 5-second live activity polling with progress/results and `/jobs` navigation, made contactability the primary queue signal, demoted map/wealth context, removed dashboard manual-ingestion controls, and added explicit PostgreSQL-unavailable fallback states. Production build passes; shared UI typecheck errors remain pre-existing. |
| 2026-07-23 | **Imported project setup**: restored pnpm dependencies from the lockfile; confirmed SESSION_SECRET, REDIS_URL_1, REDIS_URL_2, and COMPANIES_HOUSE_API_KEY are set; started Redis, API Server, and ApexFinder Web. API `/api/healthz` and web HTTP checks pass, production web build passes. PostgreSQL is unavailable in this workspace, and existing frontend/mobile typecheck errors remain documented above. |
| 2026-07-23 | **Contact-channel filtering completed**: finished the interrupted Entity Ledger fix by moving Any Contact, Email, Phone, WhatsApp, Telegram, and Instagram filtering server-side with blank-value guards; added desktop/mobile channel chips; removed the client-side dataset cap and stale field checks; updated OpenAPI and regenerated React/Zod clients. Web build, API build, frontend typecheck, shared-library typecheck, and diff checks pass. PostgreSQL remains the only runtime blocker for live entity responses in this import. |
| 2026-07-23 | **Persona loop review**: attempted a bounded live persona run and reviewed the `/improvements` page from an operator perspective. PostgreSQL failed on the initial entities query, so the run, stats, and logs all return 500. Redis/API health and the web shell are healthy, but the UI leaks an HTML-to-JSON parse error instead of explaining database unavailability. No persona results were invented. |
| 2026-07-23 | **Persona loop recovered and completed**: PostgreSQL was reachable but had no project tables, so the existing Drizzle schema was pushed; stale dedup state was cleared only because the repaired DB was empty; FAA, HMLR, and Western HNWI real ingestion restarted. Persona loop completed for 100 HNWI/Gatekeeper entities with 1,180 suggestions and 0 errors (644 high / 241 medium / 295 low). Updated stale Persona Loop copy from 6 AI agents to 8 deterministic personas. |
| 2026-07-23 | **Full real-data pipeline recovery verified**: canonical API/web workflows restarted; stale queued Hybrid Research locks now clear on restart; live state reached 81,528 entities / 80,305 assets / 264,253 relationships / 767 contactable / 600 research sessions. Two 300-target Hybrid Research passes and a fresh 100-target Persona Loop pass reached `done` with 0 errors. Added shared public-email validation plus boot-time PostgreSQL/Redis sanitation, removing 55 invalid DB emails and 31 invalid cache entries. |
| 2026-07-23 | Re-import #49: pnpm install, db schema push, artifact-managed workflows started (ports 8080/23695), 4 improvements implemented (broad-discovery engine, cold-start inversion, recurring scheduler rotation, weighted contact confidence) |
| 2026-07-23 | Re-import #48: pnpm install, db schema push, all workflows started, cold-start auto-recovery triggered |
| 2026-07-23 | Phase H complete (H1–H5 in one session): pipeline inverted (web-first), recurring scheduler, 3 new enrichment modules (social/messenger/foundation), 9 new schema columns, 8-vector contact panel UI, SKIP_DOMAINS fix |

| Date | What changed |
|---|---|
| 2026-07-22 | **Re-import #45 setup**: pnpm install (~20s), DB schema pushed (`[✓] Changes applied`). Redis ✅ · API Server ✅ (port 8080) · Web Frontend ✅ (port 23695). SESSION_SECRET ✅. DB empty → cold-start auto-recovery triggered FAA + HMLR + Western HNWI ingestion. API healthy: /healthz `{"status":"ok","redis":{"status":"ok","latencyMs":5}}`. |
| 2026-07-22 | **Re-import #34 setup**: pnpm install (~16s), DB schema pushed. Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ✅ · REDIS_URL_2 ✅ · COMPANIES_HOUSE_API_KEY ✅. Port conflict resolved (killed old manual workflow PIDs). DB: 32,100 entities / 32,100 assets / 14,811 hot leads / 62 contactable (contact cache restore running). API healthy: /healthz `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. |
| 2026-07-22 | **Re-import #33 setup + 3 bug fixes**: pnpm install (~20s), DB schema pushed. Redis ✅ · API Server ✅ (port 8080) · Web Frontend ✅ (port 23695). Secrets set: REDIS_URL_1 ✅ REDIS_URL_2 ✅ COMPANIES_HOUSE_API_KEY ✅. All 4 artifacts re-registered. DB empty → FAA 30k + HMLR 2k auto-ingested. **Fixes:** (1) Graph `useGetEntityGraph(0)` 404 on init — added `enabled: targetId > 0`; (2) `/api/pipeline/status` timing out (O(n×m) NOT EXISTS correlated subqueries over 32k×231k) — replaced with aggregate UNION subqueries, now <100ms; (3) Persona simulation re-run: 529 suggestions / 50 entities. Pipeline Status panel now rendering in Data Sources with live counts. Contactable: 75 and growing (in-house enricher running). |
| 2026-07-22 | **Re-import #32 setup**: pnpm install (~19s), DB schema pushed (no changes — `[✓] Changes applied`). Redis ✅ · API Server ✅ (port 8080) · Web Frontend ✅ (port 23695). SESSION_SECRET ✅. DB had 32,000 entities / 32,000 assets / 7,453 hot leads from cold-start auto-recovery. API healthy: /healthz `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Contactable: 0 (contact cache restore running in background if REDIS_URL_2 set). |
| 2026-07-22 | **Re-import #31 setup**: pnpm install (~13s), DB schema pushed (no changes). Redis ✅ · API Server ✅ (port 8080) · Web Frontend ✅ (port 23695). SESSION_SECRET ✅. DB had 32,000 entities / 32,000 assets / 7,453 hot leads from cold-start auto-recovery. API healthy: /healthz `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Contactable: 0 (contact cache restore running in background if REDIS_URL_2 set). |
| 2026-07-22 | **Re-import #28 setup**: pnpm install (~17s), DB schema pushed. Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ⚠️ NOT SET · REDIS_URL_2 ⚠️ NOT SET · COMPANIES_HOUSE_API_KEY ⚠️ NOT SET. DB empty at boot → FAA 30k + HMLR 2k auto-ingested; Western HNWI running in background. API healthy: 32k entities · 32k assets · 7,454 hot leads. |
| 2026-07-22 | **BRREG enricher fix**: `address` field added to `InHouseEnrichResult`; `result.address` initialised to null in orchestrator; persisted to `meta["bizLocation"]` in `processEntity`; included in `hasSignal` check so BRREG address-only hits are no longer silently dropped. Memory updated. |
| 2026-07-22 | **Re-import #27 setup**: pnpm install (~16s), DB schema pushed. Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ✅ (upstash-1 ready) · REDIS_URL_2 ✅ (upstash-2 ready) · COMPANIES_HOUSE_API_KEY ✅. DB empty at boot → FAA 30k + HMLR 2k auto-ingested; Western HNWI running in background. Port conflict resolved after artifact workflows registered (killed old PIDs on 8080/23695). Fully operational. |
| 2026-07-21 | **Re-import #26 setup**: pnpm install, DB schema pushed. Redis ✅ · API Server ✅ (port 8080) · Web Frontend ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ✅ · REDIS_URL_2 ✅ · COMPANIES_HOUSE_API_KEY ✅. DB empty at boot → FAA 30k + HMLR 2k auto-ingested; Western HNWI running in background. Upstash slot 1 (dedup) + slot 2 (contact cache) both connected on restart. |
| 2026-07-21 | **Re-import #25 setup**: pnpm install, DB schema pushed. Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅. REDIS_URL_1/REDIS_URL_2 not confirmed set (contact cache count=0 at boot). DB retained 32,100 entities — cold-start maintenance ran (7,346 hot flags, 22,774 Corp + 581 Trust reclassified). Port conflict resolved: killed old manual API Server/Web Frontend, started managed artifact workflows. |
| 2026-07-21 | **Redis contact cache (Phase 10)**: `REDIS_URL_2` (Upstash slot 2) now stores permanent contact cache (`contact:v1:{stableKey}`). Enricher mirrors to Redis after every DB write. Startup runs restore (Redis→PG) + backfill (PG→Redis) on every boot. On first boot: 89 entities backfilled from PG → Redis; enricher run added 27+ more. Total: **114+ entities with contact data**, 115+ Redis entries. Enricher auto-trigger at 120s was blocked (409) by manual job already running; persona loop passes 1 & 2 auto-fired; Hybrid Research bulk run pass 3 blocked (409). |
| 2026-07-22 | **Apex Atlas Refactor (re-import #46)**: Brand rename ApexFinder → **Apex Atlas**. Sidebar rewritten as 3-tier collapsible (Main/Workspace/System). Router: /search /profiles /network /pipeline /outreach /jobs added; old routes redirect. Dashboard: IngestionPanel removed, BackgroundActivityCard added, `<a>`-inside-`<a>` fixed via HotLeadCard sub-component. New page: **jobs.tsx** — 4-tab (Live Activity / Sources / Persona Loop / Duplicates) consolidating data-sources + improvements + duplicates. New page: **outreach.tsx** — 4-step Outreach Assistant. API: GET /api/ingest/jobs endpoint added (20 job types, polls Redis job queue). hunter-enricher.ts deleted; POST /ingest/hunter-enrich returns 410. API Server rebuild clean (build 944ms). App healthy: 33,100 entities, 15,811 hot leads, 180 contactable. |
| 2026-07-22 | **Re-import #37 setup**: pnpm install (~22s), DB schema pushed. Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ✅ · REDIS_URL_2 ✅ · COMPANIES_HOUSE_API_KEY not set. All 4 artifacts re-registered. DB: 32,100 entities / 32,100 assets / 14,811 hot leads (cold-start auto-recovery). API healthy: /healthz `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. |
| 2026-07-22 | **Re-import #36 setup**: pnpm install (~17s). DB schema pushed (`[✓] Changes applied`). All 4 artifacts re-registered (verifyAndReplaceArtifactToml). Port conflict on 8080/23695 resolved (kill -9). Managed workflows started: Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅ · REDIS_URL_1 ✅ · REDIS_URL_2 ✅ · COMPANIES_HOUSE_API_KEY — check secrets panel. DB populated: 32,100 entities (cold-start auto-recovery). API /healthz → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. App screenshot verified. |
| 2026-07-21 | **Re-import #22 setup**: pnpm install, DB schema pushed, Redis ✅, API Server ✅ (manual, port 8080), Web Frontend ✅ (manual, port 23695). SESSION_SECRET ✅. REDIS_URL_1 ⚠️ NOT SET · COMPANIES_HOUSE_API_KEY ⚠️ NOT SET. Cold-start auto-ingested FAA (30k) + HMLR (2k); Western HNWI running in background. All 4 artifacts registered. API healthy: 32,000 entities · 32,000 assets · 7,454 hot leads. |
| 2026-07-21 | **Re-import #21 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml). Redis ✅ · API Server ✅ (manual, port 8080) · Web Frontend ✅ (manual, port 23695). SESSION_SECRET ✅. REDIS_URL_1 ⚠️ NOT SET · COMPANIES_HOUSE_API_KEY ⚠️ NOT SET. DB had ~2,000 entities (Western HNWI partial from prior boot); FAA auto-ingest failed (no cached ZIP); Western HNWI running in background. API healthy: /healthz ✅ · /dashboard/stats ✅. |
| 2026-07-21 | **Re-import #18 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml). Redis ✅ · artifacts/api-server: API Server ✅ (port 8080) · artifacts/apex-finder: web ✅ (port 23695). SESSION_SECRET ✅. REDIS_URL_1 ⚠️ NOT SET · COMPANIES_HOUSE_API_KEY ⚠️ NOT SET. DB retained 32,000 entities — cold-start maintenance ran (7,262 hot flags, 22,748 Corp + 581 Trust reclassified). API healthy. |
| 2026-07-21 | **Re-import #15 setup**: pnpm install, DB schema pushed. Redis ✅ · API Server ✅ (manual workflow, port 8080) · Web Frontend ✅ (manual workflow, port 23695). SESSION_SECRET ✅. REDIS_URL_1 ⚠️ NOT SET · COMPANIES_HOUSE_API_KEY ⚠️ NOT SET. DB retained 32,000 entities + 32,000 assets from prior session — FAA auto-ingestion kicked off (dedup empty). API healthy: /healthz ✅ · /dashboard/stats ✅. |
| 2026-07-22 | **Re-import #22 setup**: pnpm install ✅, DB schema pushed ✅, all 4 artifacts re-registered (verifyAndReplaceArtifactToml) ✅. Port conflict resolved (killed orphaned PIDs on 8080/23695). Managed workflows running: Redis ✅ · artifacts/api-server: API Server ✅ · artifacts/apex-finder: web ✅. DB auto-recovered: 32,000 entities (FAA 30k + LR 2k), 14,711 hot leads. SESSION_SECRET ✅. Missing secrets: REDIS_URL_1, REDIS_URL_2, COMPANIES_HOUSE_API_KEY (graceful degradation active — dedup/contact cache/CH enricher offline until set). App loads and dashboard is live. |
| 2026-07-21 | **Re-import #11 setup + Persona Run 6**: pnpm install, DB schema pushed, all 4 artifacts registered. Redis ✅ · artifacts/api-server: API Server ✅ · artifacts/apex-finder: web ✅. SESSION_SECRET ✅ · REDIS_URL_1 ✅ · COMPANIES_HOUSE_API_KEY ✅. Western HNWI auto-ingested (100 entities). isHot sync run → 100 hot leads. Persona run 6 complete: 1,392 suggestions / 100 entities, 13.92 avg, 0 errors. App rating: **4.5/10** (cold start — code architecture ~8/10, data gap is entire deficit). improvements.md updated with full Run 6 breakdown + ops checklist. |
| 2026-07-21 | **Re-import #10 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml). Managed workflows started: Redis ✅ · artifacts/api-server: API Server ✅ · artifacts/apex-finder: web ✅. DB retained 32,100 entities — cold-start auto-recovery skipped ingestion. SESSION_SECRET ✅ · REDIS_URL_1 ✅ · COMPANIES_HOUSE_API_KEY ✅. |
| 2026-07-21 | **Re-import #9 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered. Redis ✅ · API Server ✅ · Web Frontend ✅. SESSION_SECRET ✅ · REDIS_URL_1 ✅ (Upstash connected) · COMPANIES_HOUSE_API_KEY ✅. DB retained 32,200 entities — cold-start skipped auto-ingestion. |
| 2026-07-21 | **Re-import #8 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml). Artifact-managed workflows started: Redis ✅ · artifacts/api-server: API Server ✅ · artifacts/apex-finder: web ✅. DB retained 32,100 entities from prior session — cold-start auto-recovery skipped ingestion. SESSION_SECRET ✅ · REDIS_URL_1 ✅ (Upstash connected) · COMPANIES_HOUSE_API_KEY ✅. All 4 artifact-managed workflows running. In-house enrichment pass 1 complete (49/100 EDGAR entities enriched: Ansari LinkedIn+phone cc=60, Icahn/Slim/Thiel/33 others phones cc=30-40). MCTS run on 7 top targets (Ansari 0.577, Leeds 0.486, Kim 0.494, Icahn 0.474, Slim 0.444, Thiel 0.44, Zhang 0.416). 7346 hot flags, 229259 relationship edges, 31622 notes enriched, entity reclassification done (22767 Corp / 8748 HNWI / 585 Trust). FAA enrichment pass 2 running (500 FAA entities). |
| 2026-07-24 | **GitHub import re-setup**: secrets set (REDIS_URL_1–4, COMPANIES_HOUSE_API_KEY), pnpm install ✅ (~31s), DB schema pushed ✅, all 4 artifacts re-registered via verifyAndReplaceArtifactToml, Redis + API Server + apex-finder web workflows running. /api/healthz ✅, all 4 Upstash slots connected. Dashboard loads — DB empty, cold-start auto-ingestion running in background. |
| 2026-07-23 | **Full audit + 2 bug fixes (post-import #51)**: (1) `research.tsx` terminal placeholder read "L4 MCTS Deep Path Exploration" — corrected to "L4 UCT Deep Path Exploration (120 rollouts)". UCT is the user-visible selection policy; MCTS is the internal algorithm name only. Full grep confirmed zero remaining user-facing MCTS strings. (2) `ingest-enrichment.ts` foundation-filings route — `db.select()` missing `phone`, `linkedinUrl`, `twitterHandle`, `instagramHandle`, `telegramHandle`; all 5 added so `computeContactConfidence` no longer receives undefined for social signals and writes systematically low scores. Audit confirmed all other systems correct: pipeline order web-first ✅, RECURRING_JOBS scheduler 7 jobs ✅, all Phase H modules exist and route correctly ✅, SKIP_DOMAINS not blocking social media ✅, contact-validation blocklist present ✅. Tests: Persona Loop 100 entities 226 suggestions 0 errors ✅; Hybrid Research bulk 300/300 0 errors ✅. Live state: 32,101 entities · 230,692 relationships · 729 contactable · 834 research sessions · 14,808 hot leads. Honest rating: **7.5/10** — architecture strong; contact hit rate (2.3%) and graph edge quality (mostly CORPORATE_SERIES, not warm-path introductions) are the two remaining gaps to close. See improvements.md Phase I. Commit 23941c6. |
| 2026-07-23 | **Re-import #50 setup**: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml), old manual workflows removed, artifact-managed workflows started (artifacts/api-server: API Server + artifacts/apex-finder: web). Fixed `trigger` scoping bug in startup.ts — moved function to module level as `triggerHttp`, removing stale inner duplicate. Port conflict resolved (kill -9). App loads: 18,700 profiles, 4,035 hot leads. Auto-ingestion running (FAA + HMLR + Western HNWI). |
| 2026-07-20 | **Post-import setup + relationship graph**: secrets set (REDIS_URL_1, COMPANIES_HOUSE_API_KEY), artifact-managed workflows restored, schema pushed, FAA 30k + LR 2k ingested, Western HNWI restarted (5k target), hot flags synced (14,814), name-clustering endpoint built (113,946 CORPORATE_SERIES edges), CH enrichment running. |
| 2026-07-20 | **Hybrid architecture correction + 4 operational steps**: (1) Entity reclassification ran — 22,741→Corp, 585→Trust, 8,674 remain HNWI. (2) CH enricher started (500 entities, addresses added). (3) Relationship auto-detect ran — 0 found (FAA addresses are unique; need different signal). (4) MCTS run on top 5 hot leads — sessions 1–5 created, path scores 0.415–0.488. Code: algorithmPipeline in research.ts now labels L1–L5; persona-engine layer numbering corrected (MCTS=L4); research.tsx HYBRID_PIPELINE string updated; improvements.md Core Hybrid Architecture section added. |
| 2026-07-23 | Access-first frontend pass: added server/client `accessScore` contract and contactability-first dashboard ranking; changed visible badges from misleading Reach labels to Access/Signal; simplified dashboard and background-task copy; restored API Server and ApexFinder Web workflows. Web/API smoke checks passed, but this import's PostgreSQL connection was unavailable so populated-data screenshots could not be captured. |
| 2026-07-23 | Imported-project setup: securely confirmed `REDIS_URL_1`, `REDIS_URL_2`, and `COMPANIES_HOUSE_API_KEY`; restored dependencies from the lockfile; started Redis, API Server, and ApexFinder Web; API health and web HTTP checks passed. Artifact-registry screenshot resolution remains unavailable in this import. |
| 2026-07-23 | UI/UX polish pass: added `formatEntityName` (ALL CAPS → title case) + `formatSignal` (strips verbose SEC "Source:/Filing type:" prefix) to utils.tsx. Applied formatEntityName across all 7 name display locations: dashboard, entities, profile, graph dropdown, research, duplicates. Fixed graph single-node blob — added "No connections mapped yet" overlay when nodes=1 and links=0 instead of showing lone giant circle. Graph Corp color fix (Corp → blue) was already in place from prior session. |
| 2026-07-23 | GitHub import re-setup (#23): pnpm install ✅, DB schema pushed ✅, REDIS_URL already set ✅. All 4 artifacts re-registered via verifyAndReplaceArtifactToml. Workflows running: Redis, API Server (8080), apex-finder web (23695). App loads — 32,000 profiles, 7,453 hot leads. Cold-start auto-ingestion fired (FAA + Western HNWI background job running). |
| 2026-07-20 | **Sim run (post-import)**: 6 persona batches × 50 entities = 300 entities. 2,376 suggestions (1,284 high / 498 medium / 594 low). Top flags: 100% zero contact vectors, 100% isolated nodes (0 relationships), 100% no MCTS sessions. App rating updated: **6.0/10** (up from 5.2 baseline). All 5 code phases complete; gap is purely operational — trigger CH enricher + relationship auto-detect + entity reclassification. improvements.md updated with full breakdown. |
| 2026-07-19 | GitHub import re-setup: pnpm install, DB schema pushed, REDIS_URL set, REDIS_URL_1 (Upstash) set and verified connected (`[upstash-1] Redis ready`). Workflows running: Redis, API Server (port 8080), apex-finder web (port 23695). App loads. DB empty — needs ingestion. |
| 2026-07-19 | Fresh GitHub import. Environment bootstrapped. DB empty. Upstash not connected. |
| 2026-07-19 | REDIS_URL_1 (Upstash) set and verified connected (`[upstash-1] Redis ready`). Dedup now persists across restarts. Ready for ingestion. |
| 2026-07-19 | Synthetic data purge: removed Math.random() jitter from graph path score (graph.ts), removed hardcoded "James"/"Captain" name fallbacks (pitch-generator.ts), replaced random skeleton widths with fixed value (sidebar.tsx). Added scripts/check-no-synthetic-data.sh — bans faker libs, Math.random() outside MCTS, lorem ipsum, seeding functions. Wired into post-merge.sh so every future merge is checked automatically. |
| 2026-07-19 | Ingestion run: FAA ✅ 12,902 inserted (37,110 deduped from prior Upstash session). LR ✅ 50,000 inserted (50,000 deduped). Western HNWI 🔄 running in background (~600+ so far, SEC EDGAR rate-limited). Dashboard live: ~63,500 entities, ~62,900 assets, 5,151 hot leads. |
| 2026-07-19 | Replaced MCTS Expert persona with Intel Systems Analyst (`intel_systems_analyst`). New persona covers the full hybrid stack: MCTS path coverage (Layer 1), hybrid search signal coverage / BM25+RRF anchors (Layer 2), agent orchestration pipeline completeness / Planner→Retriever→Analyst→Critic (Layer 3), Bayesian-UCB convergence / score-frozen detection (Layer 4). Updated persona-engine.ts, improvements.tsx, improvement_logs.ts schema comment. |
| 2026-07-19 | GitHub import re-setup: pnpm install, DB schema pushed, all 4 artifacts re-registered (verifyAndReplaceArtifactToml), API server + apex-finder web workflows running. Dashboard loads. DB empty — needs re-ingestion. |
| 2026-07-19 | REDIS_URL_1 (Upstash) set and verified connected (`[upstash-1] Redis ready`). Dedup state from prior sessions is live. Ready for ingestion. |
| 2026-07-25 | GitHub import re-setup #2: pnpm install (~31s, frozen lockfile), DB schema pushed (`[✓] Changes applied`), all 4 artifacts re-registered (verifyAndReplaceArtifactToml), managed workflows created. Redis + API Server + apex-finder web running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Cold-start auto-recovery triggered (Western HNWI + broad discovery background jobs). DB empty — needs re-ingestion. Missing secrets: REDIS_URL_1–4 (Upstash) and COMPANIES_HOUSE_API_KEY need re-adding. |
| 2026-07-25 | GitHub import re-setup #3: pnpm install (~32s, frozen lockfile), DB schema pushed (`[✓] Changes applied`), all 4 artifacts re-registered (verifyAndReplaceArtifactToml), managed workflows created. Redis + API Server (8080) + apex-finder web (23695) running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Dashboard loads — 32,000 profiles from prior DB state. Cold-start broad discovery + Western HNWI background jobs triggered. Missing secrets: REDIS_URL_1–4 (Upstash) and COMPANIES_HOUSE_API_KEY need re-adding for full enrichment. |
| 2026-07-25 | GitHub import re-setup #4: pnpm install (~36s), DB schema pushed, all 6 secrets set (REDIS_URL_1–5 + COMPANIES_HOUSE_API_KEY), all 4 artifacts re-registered, Redis+API Server+apex-finder web running. All 5 Upstash slots connected (slot 1 quota-exhausted, slots 2–5 healthy). /api/healthz → ok. Dashboard loads — DB empty, cold-start recovery triggered. |
| 2026-07-25 | Implemented structured evidence provenance: (1) in-house-enricher now passes real source URLs (Wikidata entity, ORCID record, GitHub profile, EDGAR/CIK, Companies House, BRREG API, RDAP, ProPublica, Wikipedia) through setEmail/setPhone; (2) ingest-enrichment.ts processEntity writes contact_evidence rows after each entity update; (3) profile.tsx evidence audit panel now renders sourceUrl as clickable link, extractionMethod, and observed date per row; explainContact leads with actual evidence badge instead of generic boilerplate. API build clean, healthz ok. |
| 2026-07-25 | GitHub import re-setup #5: CI=true pnpm install (~33s), DB schema pushed (`[✓] Changes applied`). Artifact registry was empty post-import (managed workflows not auto-restored); configured manual workflows: "API Server" (PORT=8080) and "ApexFinder Web" (PORT=23695). Redis + API Server + apex-finder web all running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Web root 200. Cold-start auto-recovery triggered (broad discovery + Western HNWI background jobs). DB empty — needs re-ingestion. SESSION_SECRET present; Upstash slots (REDIS_URL_1–5) and COMPANIES_HOUSE_API_KEY need re-adding for full enrichment. |
| 2026-07-25 | Artifacts registered (platform restored managed workflows for all 4 artifacts). Removed manual "API Server" and "ApexFinder Web" duplicate workflows. Re-added all 6 secrets: REDIS_URL_1–5 + COMPANIES_HOUSE_API_KEY. All 5 Upstash slots confirmed connected in startup logs ("Permanent Redis connected slot: 1–5"). All workflows healthy: Redis, API Server (8080), apex-finder web (23695), apex-mobile expo, mockup-sandbox. DB empty — ready for ingestion. |
| 2026-07-25 | Import setup completed: verified managed artifact workflows after clearing orphaned port listeners; Redis, API Server, and apex-finder web are running. `/api/healthz` and `/api/entities` return 200; the Apex Atlas root preview renders successfully. Upstash slot 1 remains quota-exhausted but slots 2–5 are healthy and the app degrades non-fatally. |
| 2026-07-25 | Phase K web-OSINT enrichment fixes: (1) scrapePage — full browser headers (Accept-Language, Sec-Fetch-*, Cache-Control etc.) + TLD-aware locale; (2) isBotBlock() CF-challenge detection (cf_chl_opt, challenge-platform, ddos-guard signatures) + botBlocked flag on ScrapedPage; (3) Wayback fallback now triggers on botBlocked flag OR short text; (4) buildDeepWebQueries city-duplication guard (tradingHasCity prevents "Baoli Cannes Cannes" queries); (5) scrapeContactEmail upgraded to full browser headers + returns ContactPageResult {email, instagramUrl, twitterUrl}; OsintResult gets instagramUrl/twitterUrl; enrichEntityOsint Step 4 persists both social fields. Live test BAOLI SAS → reservations@baolicannes.com (email) + https://www.instagram.com/baolicannes (instagram) found in single Layer 1 pass. contactOutcome: direct_contact_candidate. Google/Gemini investigation: google.com returns JS-only noscript shell from Node.js — Gemini AI Overview is not accessible server-side without a real browser; Gemini API grounding would be the correct route but free-tier keys are quota-exhausted; Groq remains the AI extraction layer. |
| 2026-07-25 | GitHub import re-setup #6: CI=true pnpm install (~33s), DB schema pushed (`[✓] Changes applied`), all 4 artifacts re-registered (verifyAndReplaceArtifactToml), managed workflows auto-created. Redis + API Server (8080) + apex-finder web (23695) running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. DB empty — needs re-ingestion. Missing secrets: REDIS_URL_1–5 (Upstash) and COMPANIES_HOUSE_API_KEY need re-adding for full enrichment. |
| 2026-07-25 | Imported project setup: CI=true frozen-lockfile dependencies restored, schema pushed, all four existing artifact manifests validated and registered, and managed Redis/API/web workflows started. All six requested secrets are present; `/api/healthz`, `/api/entities`, `/api/dashboard/stats`, and the browser dashboard preview pass. Fresh database currently has 0 records; ingestion is the next operational step. |
| 2026-07-25 | GitHub import re-setup #7: CI=true pnpm install (~30s, frozen lockfile), DB schema pushed (`[✓] Changes applied`), Redis + API Server + ApexFinder Web workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":2}}`. `/api/dashboard/stats` → 32,000 entities / 32,000 assets / 7,458 hot leads (DB retained from prior import). Cold-start auto-recovery triggered. SESSION_SECRET ✅; Upstash REDIS_URL_1–5 and COMPANIES_HOUSE_API_KEY confirmed present. |
| 2026-07-25 | **Phase K AI extraction (Groq)**: created `artifacts/api-server/src/lib/ai-extractor.ts` — Groq llama-3.3-70b-versatile (free, 6k req/day) via plain fetch, falls back to llama-3.1-8b-instant on rate limit, silent fallback if no key. Integrated as Phase 7 in `web-enricher.ts` deepWebOsintEnrich (runs over accumulated allSearchText after all search+scrape passes) and Phase 3.5 in `deep-web-osint.ts`. Also added allSearchText accumulation to deep-web-osint.ts DDG/Bing phases. Groq key confirmed working: llama-3.3-70b returns structured JSON. API build clean (1646ms), `/api/healthz` ok. GROQ_API_KEY set as Replit Secret. |
| 2026-07-25 | **Imported project setup completed**: securely added REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, and GROQ_API_KEY; restored dependencies with frozen lockfile; pushed the existing Drizzle schema; registered all four artifact manifests; removed duplicate legacy API/web workflows; and updated the Project run button to use managed artifact workflows. Redis, managed API, and managed web are running. `/api/healthz`, `/api/entities`, and `/api/dashboard/stats` return 200, and the browser dashboard renders its empty state. Fresh database contains 0 records; ingestion is the next operational step. |
| 2026-07-25 | **Import setup finalized**: validated the Project run button against managed Redis/API/web workflows; cold-start ingestion populated 14,200 entities and 14,100 assets. Current dashboard stats: 3,046 hot leads, 301 contactable profiles, 0 relationships, 0 active research sessions. API health and dashboard endpoints return 200; browser preview renders successfully. |
| 2026-07-25 | **Import #8 setup complete**: CI=true frozen-lockfile install (~30s), DB schema pushed (`[✓] Changes applied`), all 7 secrets added (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY). All 4 artifacts registered; Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. Upstash slots 2–5 healthy, slot 1 quota-exhausted (non-fatal). DB empty — ready for ingestion. |
| 2026-07-25 | **Import #9 setup complete**: CI=true frozen-lockfile install (~34s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. Fixed duplicate `extractPhone` function in `web-enricher.ts` (lines 961-970 removed — private copy shadowed the exported one, causing esbuild build failure). `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. Dashboard stats: 18,500 entities / 18,500 assets / 3,986 hot leads (cold-start ingestion active). Upstash slots 2–5 healthy, slot 1 quota-exhausted (non-fatal). |
| 2026-07-25 | **Domain guesser fix + registry search fix**: (1) `guessCompanyDomainWithCity` in `web-enricher.ts` — added `!base.includes(cityClean)` guard so entity named "Baoli Cannes" + city "Cannes" generates `baolicannes.com` at slot 0 instead of `baolicannescannes.com` in slots 0–2 (which put the correct domain in slot 3 and wasted 3 of the 4 allowed scrape slots). (2) Registry search `POST /api/registry-search` — default registry set changed from `["opencorporates"]` (paid-only, causes 500 for all unspecified searches) to `["bodacc-france","brreg","ares-czechia","gleif"]` (all free, returns results immediately). (3) Live test on Baoli Cannes (entity 11151): deep-web-osint enrichment now returns `enriched: 1` — found phone `+33 4 93 43 03 43` via Groq AI extraction from search snippets. Email (`reservations@baolicannes.com`) present on `/contact` page in static HTML (curl confirms it), but not extracted by scrapePage — site likely serves Cloudflare JS challenge or bot-detection page to server-side fetch despite `redirect:follow` and rotating UA. Phone + `outcome: direct_contact_candidate` is a confirmed win. |
| 2026-07-26 | **OSINT pipeline continuation (Phase K+)**: (1) contact_evidence DB writes wired into deep-web route — result.evidence rows (vectorType, value, source, sourceUrl, extractionMethod, sourceReliability, directnessScore, identityMatch) now inserted via ON CONFLICT DO NOTHING after each entity enrichment; (2) Germany Handelsregister added via offeneregister.de Datasette SQL API (graceful 502 fallback); (3) Sweden Bolagsverket added via Allabolag search (graceful fallback); (4) both added to registry-client.ts REGISTRY_IDS, registry-matrix.ts coverage entries, and FREE_DEFAULTS in ingest.ts; offeneregister.de and allabolag.se are inaccessible from container (502/timeout) so return [] gracefully — will activate if network policy allows. Build clean (315ms). All 8 enrichment phases operational. |
| 2026-07-26 | **Import #10 setup complete**: CI=true frozen-lockfile install (~27s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. Dashboard stats: 32,001 entities (FAA + land-registry cold-start auto-loaded). Cold-start maintenance ran: 7,252 hot flags synced, 5,856 FAA names normalized, 22,782 corps reclassified, 584 trusts. Missing secrets: REDIS_URL_1–5 (Upstash dedup), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY — enrichment pipeline degrades gracefully without them but full dedup and AI extraction require them. |
| 2026-07-26 | **Import #11 setup complete**: CI=true frozen-lockfile install (~29s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Dashboard stats: 32,000 entities (FAA + land-registry cold-start auto-loaded), 7,458 hot leads, avg Bayesian score 0.67. Missing secrets: REDIS_URL_1–5 (Upstash dedup), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY — enrichment pipeline degrades gracefully without them but full dedup and AI extraction require them. |
| 2026-07-26 | **Import #12 setup complete**: CI=true frozen-lockfile install (~29s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Cold-start auto-ingestion triggered on empty DB. All 11 secrets set (REDIS_URL_1–5 slots 2–5 healthy/slot 1 quota-exhausted non-fatal, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY ×3, OPENROUTER_API_KEY ×2). |
| 2026-07-26 | **EU registry expansion (Italy/Spain/Netherlands/Belgium)**: Added `atoka-italy`, `borme-spain`, `kvk-netherlands`, `kbo-belgium` to REGISTRY_IDS, registry-matrix.ts, and registry-client.ts implementations. All four fail gracefully from the Replit container (HTML portals / Cloudflare-protected) at 5s timeout. Excluded from FREE_DEFAULTS to avoid latency on default searches — can be called explicitly. Also fixed `estimatedNetWorth: null` bug in YTJ Finland function (field doesn't exist on RegistryResult interface). Build clean (1014ms). |
| 2026-07-26 | **Import #13 setup verification**: requested 11 secrets are present (5 Upstash Redis, Companies House, 3 Groq, 2 OpenRouter); frozen-lockfile pnpm install and Drizzle schema push completed; Redis, API, and web workflows running; `/api/healthz` returns OK; web production build passes; cold-start ingestion is active with 12,800 entities, 12,800 assets, and 2,689 hot leads at verification. Upstash slot 1 is quota-exhausted but slots 2–5 are healthy and failover is automatic. |
| 2026-07-26 | **Import #14 setup complete**: CI=true frozen-lockfile pnpm install (~38s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Dashboard: 32,000 entities (30k FAA + 2k land-registry cold-start auto-loaded), 7,458 hot leads, avg Bayesian score 0.67. SESSION_SECRET is set; optional secrets REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY not set — enrichment pipeline degrades gracefully without them. |
| 2026-07-26 | **Import #15 setup complete**: CI=true frozen-lockfile pnpm install (~30s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":4}}`. All 13 secrets set: REDIS_URL_1–5 (all 5 Upstash slots connected and healthy), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4. ENABLE_AUTO_PIPELINE=false — no research engines or broad ingestion started. DB empty (Orient Express 5-entity controlled state from prior session); awaiting user instruction for next task. |
| 2026-07-26 | **Import #16 setup complete**: CI=true frozen-lockfile pnpm install (~38s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. All 13 secrets set: REDIS_URL_1–5 (Upstash dedup), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4. ENABLE_AUTO_PIPELINE not set — research engines NOT started, Replit credits preserved. |
| 2026-07-26 | **B&B Hotels bugs fixed (web-enricher.ts)**: (1) `extractPersonCandidates` now rejects role-words (CEO/CFO/COO/etc.) and company-type words (Hotels/Group/Holdings/etc.) per-word — kills "Hotels CEO" garbage. `addOwnerResolution` now guards `personsDiscovered` pushes with `looksLikePersonName()` — PE firm names (Goldman Sachs AM, PAI Partners) no longer seed the person-hop. (2) After Phase 0, Perplexity citation URLs are parsed and their domains injected at front of `domainTargets` — hotel-bb.com (corporate) now gets scraped instead of bbhotels.com (booking). Added `CITATION_SKIP_DOMAINS` set (OTAs, news wires, social, registries). Added `PERSON_WORD_BLOCKLIST` and `looksLikePersonName()` helpers. Build clean 1115ms. |
| 2026-07-27 | **Import setup complete**: CI=true frozen-lockfile pnpm install (~32s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. All 14 secrets added (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY). Upstash slots 2–5 healthy, slot 1 quota-exhausted (non-fatal). ENABLE_AUTO_PIPELINE=false — broad ingestion disabled. |
| 2026-07-27 | **Partech Partners OSINT case study**: entity created (ID 2, Corp, FR, Paris). Full pipeline: in-house (GitHub/EDGAR/ContactPage/SPF/SMTP) + web OSINT (24 queries, 8 pages) + deep-web OSINT (Perplexity Sonar Pro Phase 0). Final: contactConfidence=93, accessScore=0.83, contactOutcome=direct_contact_candidate. Verified: edelaveau@partechpartners.com (SMTP-verified) + itresson@partechpartners.com + +33 1 53 65 65 53. Named GPs from /team: Collombel, Patouillaud (Senior Advisor), Delaveau, Tresson, Benayoun, Minvielle, Said, Moussey, Dehaldat, Lavault, Golden, Collon, Dème, Crémel (14 named, 6 confirmed emails, 8 inferred). PAR Technology entity-hop on social links caught and rejected. **Bug fixed**: findContactPages now prioritises /team,/partners,/people FIRST for Corp entities and does not break early — previously /contact early-exit buried the team page entirely. |
| 2026-07-26 | **Phase L — Extended OSINT Tool Suite**: 7 new library files added under `artifacts/api-server/src/lib/`: `icij-enricher.ts` (ICIJ Offshore Leaks reconciliation API), `whoxy-enricher.ts` (reverse WHOIS, requires WHOXY_API_KEY), `equasis-enricher.ts` (vessel/yacht ownership), `adsbtrack-enricher.ts` (historical ADS-B flight traces), `openownership-enricher.ts` (BODS beneficial ownership + UK PSC), `python-tools.ts` (Holehe/Maigret/theHarvester subprocess runner), `gliner-client.ts` (GLiNER NER microservice client, port 7890). New route file `extended-osint.ts` with 10 endpoints under `/api/enrich/*` registered via `extendedOsintRouter`. ICIJ hooked into `in-house-enricher.ts` as Source C9 (added to g1Promises for corporations). Whoxy hooked after GROUP 3 email discovery phase. `extractPersonCandidatesAsync` added to `web-enricher.ts` — calls GLiNER when service is available, falls back to regex. Python tool status: Holehe ✅, Maigret ✅, GLiNER ✅ (pip install), theHarvester ❌ (pip dependency conflict on Nix, marked coming-soon). Scripts: `scripts/gliner_service.py` (standalone HTTP NER server), `scripts/install-python-tools.sh`. Data Sources page (`/data-sources`) updated with Phase L section, `PythonToolsPanel` component showing GLiNER online/offline status + per-tool availability. Both builds clean (API 520ms, frontend 6.92s). |
| 2026-07-27 | **Import setup complete (re-import)**: pnpm install (~35s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. All 4 artifacts re-registered by platform. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. DB empty — needs re-ingestion. ENABLE_AUTO_PIPELINE=false — broad ingestion disabled. All 14 secrets from prior session should still be present (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY). |
| 2026-07-27 | **Import #2 setup complete**: CI=true pnpm install (~34s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. `/api/dashboard/stats` → 200, all zeros (empty DB). ENABLE_AUTO_PIPELINE not set — broad ingestion disabled. SESSION_SECRET present. DB empty — ready for research or ingestion. All 14 secrets added (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY). All 5 Upstash slots confirmed connected (slots 1–5 all "Permanent Redis connected"). No ingestion started — credits preserved. |
| 2026-07-27 | **Resumed from prev session — 4 OSINT pipeline fixes applied**: (1) CITATION_SKIP_DOMAINS: added target.com/corporate.target.com/highperformr.ai/aggregators to block US-retailer and wrong-aggregator contamination; (2) Stale contact clearing: web-osint-enrich force=true now wipes old phone/email/linkedinUrl instead of preserving garbage from prior runs; (3) Perplexity prompt SCOPE LOCK: explicit city+country disambiguation injected into every Phase 0 prompt — blocks "Target Global VC" from receiving Target Corporation US retailer data; (4) Wayback sub-page fallback: findContactPages now tries Wayback snapshot for any bot-blocked or near-empty sub-page (JS SPA /team pages) before giving up. Build clean (1312ms). |
| 2026-07-27 | **Permira benchmark + bug fixes**: Apex Atlas vs Replit Agent comparison on Permira (PE firm, London). Atlas: 12 named people, 5 individual emails (firstname.lastname@permira.com), 5 LinkedIn /in/ URLs, +44 20 7632 1000, sourced from live Bloomberg + permira.com/people + permira.com/contact-us/london. Agent training: 4-5 stale names, wrong roles (pre-2024 leadership transition), 0 emails, 0 LinkedIn. Atlas clear winner. Bugs found+fixed: (1) ENRICHER_TIMEOUT_MS 4→6 min for Corp scrape depth; (2) waybackPageUrl timeout 8s→3s; (3) PERSON_WORD_BLOCKLIST: added Executive/Committee/Board/Director/street words (Mall/Street/Avenue/etc.)/geographic region words (North/South/America/Europe/etc.) — blocked "North America" and "Pall Mall" from firing Phase 7.5 Perplexity credits. DB: 1 entity (Permira, ID 1). |
| 2026-07-28 | **Intelligence Reactor mobile UX overhaul**: removed fake setInterval simulation on mobile; replaced with real data fetch from `/api/research/sessions` + `/api/dashboard/stats`; pipeline now static (no fake wave-stepping); ☢ nuclear sign fixed from `display:grid/placeItems:center` → `display:flex/alignItems:center/justifyContent:center` + `lineHeight:1`; 2-column grid overflow fixed (explicit `overflow:hidden`, `width:100%`, tighter gap/padding); mobile wrapper changed from `position:absolute/inset:0` to `display:flex/flexDirection:column/height:100%`; footer meters now show real ENTITIES/RUNS/OUTREACH counts; STANDBY state with "NO SESSIONS YET" shown when DB empty; desktop DesktopReactor unchanged. All 14 API secrets added (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY). |
| 2026-07-28 | **Import setup complete (re-import)**: CI=true pnpm install (~39s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. `/api/dashboard/stats` → 200, all zeros (empty DB). SESSION_SECRET present. ENABLE_AUTO_PIPELINE not set — broad ingestion disabled. DB empty — ready for research or ingestion. Optional secrets (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY) needed for full enrichment pipeline. |
| 2026-07-28 | **All 14 enrichment secrets set**: REDIS_URL_1–5 (Upstash slots 1–5 connected; slot 1 quota-exhausted, slots 2–5 healthy), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4, WHOXY_API_KEY. API server restarted to pick up secrets. ENABLE_AUTO_PIPELINE not set — no ingestion or research started. DB empty. |
| 2026-07-28 | **Intelligence Reactor live polling fix**: `fetchData` extracted to `useCallback`; auto-polls every 10s so mobile reactor stays in sync after research sessions complete; manual sync button (`onRefresh`) and `syncing` spinner state now wired through from page wrapper to `MobileReactor`. Vite HMR applied cleanly. |
| 2026-07-28 | **Full pipeline launched**: ENABLE_AUTO_PIPELINE=true set; API server restarted; cold-start confirmed active — 3,700 FAA entities loaded within 8s of boot, 809 hot leads. Full 6-phase pipeline running (broad discovery → registry ingestion → enrichment → graph edges → contact enrichment → UCT research). Recurring H2 scheduler activates at ~46 min and runs forever. Upstash slots 2–5 healthy (slot 1 quota-exhausted, non-fatal). |

| 2026-07-28 | **Re-import setup complete**: CI=true frozen-lockfile install (~35s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":6}}`. DB retained from prior import — 32,001 entities / 14,706 hot leads at startup. Cold-start pipeline auto-triggered (DB was empty at first check). SESSION_SECRET present. All 14 enrichment secrets (REDIS_URL_1–5, COMPANIES_HOUSE_API_KEY, GROQ_API_KEY×3, PERPLEXITY_API_KEY×4, WHOXY_API_KEY) carried over. ENABLE_AUTO_PIPELINE not set — full ingestion disabled by default. |

| 2026-07-28 | **All 14 enrichment secrets set**: REDIS_URL_1–5 (Upstash slots 1–5 all connected and ready), COMPANIES_HOUSE_API_KEY, GROQ_API_KEY/\_2/\_3, PERPLEXITY_API_KEY/\_2/\_3/\_4, WHOXY_API_KEY. API server restarted — all 5 permanent Redis slots confirmed connected in logs. ENABLE_AUTO_PIPELINE not set — no ingestion or research started. DB has 32,001 entities / 14,706 hot leads from prior import. Awaiting user instruction before starting pipeline. |

| 2026-07-28 | **AI source label cleanup**: `"tavily-groq"` → `"tavily"` and `"exa-groq"` → `"exa"` across `ai-extractor.ts`, `web-enricher.ts` (Phase 0.6, 0.7, 7.5 follow-up), `deep-web-osint.ts`. Evidence source strings updated (`ai-tavily`, `ai-exa`, `ai-tavily-followup`, `ai-exa-followup`). `reactor.tsx` corrected: Gemini node `type:"ai-lime"` → `"ai-cyan"` (it's a search source, not extraction layer); removed wrong `groq→gemini` edge; added `webdisc→gemini` + `gemini→semantic` edges; Wave 3 renamed "AI PHASE 0 — Perplexity · Gemini · Tavily · Exa in parallel"; mobile AI LAYER now shows all 6 AI nodes; `web-osint-enrich` job map includes Gemini. API build clean (503ms), frontend build clean (7.09s). Upstash slots 2–5 connected; slot 1 quota-exhausted (non-fatal). |
| 2026-07-28 | **Enricher execution order confirmed**: web-OSINT (deepWebOsintEnrich) must run FIRST — it is the primary data layer. In-house enricher runs second (fill-only-if-empty guard: only writes email/phone/linkedinUrl if field is null). Running web-OSINT with force=true AFTER in-house risks nulling out in-house-found data if web-OSINT finds nothing. Evidence rows (contact_evidence table) are always additive from both layers. |
| 2026-07-31 | **Contact-quality persistence hardening**: shared email/phone/social sanitation now covers in-house, web-OSINT, Phase J, social discovery, foundation filings, Redis restore, cold-start maintenance, and entity merges. Alternate paths recompute contact confidence/outcome and hot status from cleaned vectors; cache and merge scores are never trusted. Added regression coverage for invalid handles, infrastructure/constructed emails, organization contact scoring, and hot-lead gating. API tests: 55 passed; API/frontend builds clean; health healthy; pipeline idle. |
| 2026-07-31 | **Intelligence Reactor rod-wall redesign**: completed registry coverage in the desktop waves and Atlas step mapping, including BRREG and WHOXY; added explicit phase purpose/readouts; replaced the mobile collapsed phase presentation with a complete responsive SVG route map showing every tool rod, directional data paths, and adaptive feedback rails; live desktop routes now highlight edges connected to active rods; fixed desktop canvas containment so the reactor occupies one main surface instead of tiling. Frontend build passed; desktop and 390px mobile previews verified with no application console errors. No ingestion or research job started. |
| 2026-07-31 | **Intelligence Reactor truthful telemetry**: added structured Atlas phase/entity fields to Redis job state; phase progress remains separate from entity-batch progress; stale entity fields are cleared between phases; frontend now shows the 0–10 phase model as 11 numbered checkpoints, current entity names/range, and shared completed/active/queued/skipped/failed rod semantics across desktop/mobile. Removed idle desktop wave simulation and historical-session rod lighting. API tests 55/55, frontend/API production builds pass, desktop and 390px reactor previews have no browser errors, Atlas remains idle. Full API typecheck still reports the existing workspace DB export mismatch plus unrelated legacy errors. |
| 2026-07-31 | **Reactor header-first status UX**: moved overall progress, live phase/entity detail, database totals, hot leads, assets, research sessions, and outreach count into responsive desktop/mobile headers; removed duplicate footer meters and retained real idle totals. Frontend build passed, web workflow restarted, API health returned `ok`, and desktop/390px Reactor previews showed no browser errors. |
| 2026-07-31 | **Reactor mobile label containment fix**: removed the floating vertical phase labels that sat outside the mobile rod-wall cards, clipped the SVG route layer to the reactor frame, rebuilt/restarted the web workflow, and verified the 390px preview without browser errors. |
| 2026-07-31 | **HNWI/entity narrative cards**: expanded the OpenAPI hot-lead payload with profile narrative fields; added shared evidence-led bio/involvement derivation; dashboard priority cards, People ledger cards, and profile hero now show public profile context and what the entity is involved in, with explicit missing-evidence states. API spec codegen, API/frontend production builds, and `git diff --check` pass. Live API health is healthy; current database is empty, so no populated card preview is available without starting ingestion. |
| 2026-07-31 | **Single-entity evidence hardening verification**: rejected malformed repeated-plus phone input, repaired the contact-rejection recalculation path, recomputed confidence/outcome/Access/hot state, prevented manual seed notes from becoming involvement or registry claims, stabilized research rerun scoring, and changed isolated research sessions to `Research Review` with no outreach recommendation. API tests 55/55, API/frontend builds pass, workflows healthy, desktop/mobile dashboard/profile screenshots verified without browser errors. |
| 2026-07-31 | **Target realism gate**: added deterministic reachability preflight and provider directives; isolated prominent/social-only targets now skip broad retrieval, critic/orchestration, MCTS, and outreach generation; direct vectors and corroborated intermediary paths retain normal research mode. MCTS no longer assumes hypothetical staff, asset, WhatsApp, or commission routes are actionable. Focused realism/contact tests 9/9, API build and health pass; full typecheck remains blocked by pre-existing workspace errors. |
| 2026-08-01 | **Backend research workflow hardening**: independent evidence scoring, balanced AI JSON parsing, prompt-injection defenses, claim-level citation binding, and all-settled provider/follow-up fan-out. API tests 67/67, build and health pass; full typecheck still reports only pre-existing workspace errors. |
| 2026-07-28 | **Re-import setup complete (Task #1)**: CI=true frozen-lockfile install (~39s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. DB empty — all 24 enrichment secrets present (SESSION_SECRET + REDIS_URL_1–5 + COMPANIES_HOUSE_API_KEY + GROQ×3 + PERPLEXITY×4 + WHOXY + GEMINI×4 + EXA×2 + TAVILY×4). ENABLE_AUTO_PIPELINE not set — pipeline idle, awaiting user instruction. |
| 2026-07-29 | **Re-import setup complete (Task #1)**: CI=true frozen-lockfile install (~38s), DB schema pushed (`[✓] Changes applied`), Redis + API Server (8080) + apex-finder web (23695) workflows running. `/api/healthz` → `{"status":"ok","redis":{"status":"ok","latencyMs":0}}`. DB empty — cold-start pipeline auto-check ran (ENABLE_AUTO_PIPELINE not set, so pipeline idle). SESSION_SECRET present. All enrichment secrets from prior session carried over. Awaiting user instruction before starting ingestion. |
| 2026-07-29 | **3 bugs fixed + Atlas launched (discovery-first)**: (1) Ghost `atlas-run` job `0754421b` was blocking new runs — fixed by adding `"atlas-run"` to `INGESTOR_TYPES` in startup.ts so ghost Atlas jobs are auto-cleared on every cold-start. (2) Reactor `RUNS` meter was always 0 (sessions only created at Phase 10 MCTS) — now shows `PHASE X/10` with real Atlas progress when live, falls back to `RUNS` (session count) when idle. (3) `ConfidenceBadge` / `AccessScoreBadge` now guard against `NaN` + non-number values (was guarding null/undefined only). Atlas fired: `discoveryFirst=true`, 5 broad categories (Tier-1 funds, Asian wealth centres, European venues, Nordic, Public mentions), `skipFaa=true`, `targetCount=1500`, `researchLimit=15`. Phase 0a complete: 224 entities from web discovery. Phase 0b (EDGAR SC 13D/G + DEF 14A + BRREG Norway + CH UK) running. |
| 2026-07-28 | **Gemini Flash grounded search added**: `researchWithGemini()` implemented in `ai-extractor.ts` using `gemini-2.0-flash` with `google_search` grounding tool. Wired into `web-enricher.ts` Phase 0 (parallel with Perplexity, evidence source `ai-gemini-flash`) + Phase 7.5 follow-up persons; and `deep-web-osint.ts` Phase 0. Both models now fire in `Promise.all()` — different search indexes for complementary coverage. GEMINI_API_KEY set. Supports GEMINI_API_KEY_2…_8 via same rotation pattern. Build clean (415ms). ENABLE_AUTO_PIPELINE not set — pipeline still idle. |
| 2026-08-01 | **Research task 1 — claim evidence ledger**: Added durable research_evidence records linked to sessions, API endpoint, research-page evidence panel, and evidence-row builder for target/path/MCTS/reachability claims. Pinned Orval to 8.21.0 because local 8.23 emitted Zod 4-only zod.int() against the project's Zod 3 runtime. DB push, API/web builds, health and route checks pass; mobile Expo watcher remains independently failed after reinstall. |
| 2026-08-01 | **Research task 2 — independent scorecard**: Research sessions now persist separate identity, ownership, contact, access, wealth, freshness, and source-quality scores plus JSON breakdown; research UI displays each dimension independently. Scorecard tests cover wealth/access separation and source/recency signals. 69 API tests, DB push, codegen, API/web builds pass. |
| 2026-08-01 | **Research task 3 — temporal evidence**: Research evidence now stores published/validity windows and freshness scores; deterministic half-life classification labels claims current, aging, stale, or unknown in the UI. Temporal utility tests cover decay, future-date caps, and validity windows. 72 API tests, DB push, codegen, API/web builds pass. |
| 2026-08-01 | **Research task 4 — identity promotion gate**: Added accepted/review/rejected identity gate decisions, persisted gate reasons, blocked confirmation unless the candidate clears independent corroboration, and filtered unaccepted identity links from research graph construction. 73 API tests, DB push, API/web builds pass. |
| 2026-08-01 | **Research task 5 — adaptive cascade**: Added deterministic stage budgeting that skips redundant critic/orchestration when validated direct or corroborated intermediary evidence is already sufficient; sparse or mixed evidence still triggers critic review. 75 API tests and API/web builds pass. |
| 2026-08-01 | **Research task 6 — run audit trail**: Added durable research-run events for phase status, elapsed time, messages, and skip reasons; exposed `/research/sessions/:id/audit` and preserved pipeline visibility in the research UI/API response. 75 API tests, DB push, codegen, API/web builds pass. |
| 2026-08-01 | **Research task 7 — negative and disputed evidence**: Added explicit supported/review/disputed/rejected evidence decisions, retained conflict and non-attribution reasons, and updated the claim ledger to distinguish disputes, rejections, and review notes. 78 API tests and API/web builds pass. |
| 2026-08-01 | **Research task 8 — provenance-aware graph/MCTS**: Graph arcs now carry provenance score, citation count, freshness, and evidence status; MCTS rewards cited, verified edges and penalizes disputed or weakly supported paths. 80 API tests and API/web builds pass. |
| 2026-08-01 | **Research task 9 — source reliability registry**: Added reusable reliability profiles by source family with separate identity, ownership, contact, and freshness dimensions; unknown/derived sources remain review-only and scores incorporate authoritative-source quality. 83 API tests and API/web builds pass. |
| 2026-08-01 | **Research task 10 — safe-use controls**: Research sessions default to manual review, generated outreach is explicitly draft-only, safety review requires a reviewer note plus minimum identity/access evidence, blocked states are supported, and no endpoint sends or schedules messages. Safety state is visible in the research UI. 86 API tests, DB push, codegen, API/web builds, workflow restart, health check, and root preview pass. |
| 2026-08-01 | **Registry runtime promotion and compact source UI**: Live registry adapters now participate in a shuffled, bounded discovery pass during Western ingestion; bulk-only FAA/HMLR remain separate, credential-gated sources stay explicit-only, and the Data Sources page exposes runtime mode separately from production review with collapsible operational sections. |
| 2026-08-02 | **Re-import setup complete**: Cloned from GitHub (BigContacts), copied all artifacts (apex-finder, apex-mobile), api-server src, lib, scripts, root configs, and memory files. pnpm install (~33s, +783 packages). Redis 7.2.10 installed and running on port 6379. DB schema pushed (`[✓] Changes applied`). Env vars set: REDIS_URL=redis://localhost:6379, ENABLE_AUTO_PIPELINE=false. Python tools install ran (holehe/maigret unavailable — no pip on Python 3.13; non-fatal). All workflows running: Redis → API Server (8080) → apex-finder web (23695). `/api/healthz` → `{"status":"ok"}`. Awaiting user instruction. |
| 2026-08-02 | **Controlled FAA benchmark and attribution hardening**: Buffett was rejected as an invalid celebrity benchmark. FAA bulk import completed with 5,000 real records and 0 errors. The pre-fix 16-person FAA aircraft-owner cohort completed 16/16 with 0 errors at 13 social-only / 1 direct-contact candidate / 2 no usable contact outcomes. After fail-closed attribution changes, the authoritative post-fix rerun completed 16/16 with 0 errors at 10 social-only / 0 direct-contact candidates / 6 no usable contact outcomes, with 431 durable evidence rows and 6 explicitly promoted social fields. Organization-only and same-name handles no longer reach HNWI contact fields or legacy Maigret/Sherlock scan fallbacks; review evidence remains durable. Added current-run social eligibility requiring target-person attribution plus exact fetched claim URLs, orphan-worker ownership checks and boot-time ghost-job scoping, and regression coverage. API build passed, focused suite passed 99/99, health and Redis checks passed. This is an honest provenance/correctness milestone, not yet a 9/10 access-quality result. |
| 2026-08-02 | **Canary quality stop + Reactor telemetry**: Stopped the bounded discovery-first Atlas canary after live monitoring found the role-shaped candidate `Rocco Forte Deputy` and corporation person-hop recipe noise; no new run was launched. Added role-only and recipe/editorial candidate gates, structured target-scoped `atlasTelemetry` job state, and a readable mobile Reactor stage navigator with `liquid-glass-react` inspector fallback. API build/focused discovery tests and ApexFinder typecheck/web build pass; API health is Redis-healthy; Atlas is idle; Reactor 390×844 screenshot has no browser errors. |
| 2026-08-03 | **AI web-research prompt contract hardening**: Added target-fingerprint/disambiguation rules, claim-level provenance requirements, explicit identity/negative-finding/search-gap fields, and stronger entity-drift/contact-route safeguards to both extractor trees and all AI prompt paths. Added regression coverage. Holehe/Maigret/Sherlock availability was verified; Sherlock remains review-only, Maigret remains candidate discovery, and Holehe remains service-presence evidence. API tests 218/218, build, workflow restart, and Redis-healthy API check pass; full typecheck remains blocked by unrelated baseline errors. |
| 2026-08-03 | **Atlas incident monitoring and organization-route correction**: A bounded `skipIngestion` Atlas run stalled on Phase 1 discovery with unchanged progress; it was safely cancelled and Atlas remains manual/idle. Reconciled 23 records fail-closed (`17 none`, `6 organization_contact`), cleared stale organization hot flags, made corporate/trust personal Access score 0, normalized legacy direct outcomes at the API boundary, and changed mobile/desktop ledger labels from misleading personal scores to `ORG ROUTE`. Dashboard now reports `hotLeadsCount=0`, `reachablePersonal=0`, `reachableVerified=0`, `reachableOrg=6`; API/Redis health is green and 390×844/desktop screenshots are verified. |
| 2026-08-03 | **Monitored Atlas retry and cancellation hardening**: Started bounded job `402e83e4-a0f9-46e5-9de4-050cf34f67f3` with ingestion skipped, one discovery category, small batches, and one research limit. Phase 1 scraped 42 results, produced 19 candidates, Groq validation hit 429 on all five keys and fail-closed to 0 candidates; the next enrichment loop stalled without job progress and was cancelled at the 45-second freshness threshold. Found and fixed Atlas cancellation so clearing the active slot cannot let the worker advance or overwrite failed state; added ownership checks at phase/source/entity boundaries and reliable path-based stale-job cleanup. Final state: Atlas idle, job failed, API/Redis healthy, 21 entities, 0 hot, 0 direct outcomes. API build and diff check pass. |
| 2026-08-03 | **Targeted HNWI research + deep-web cancellation hardening**: Pascal Camia research completed with 7 queries and 11 pages; Perplexity/Exa/Tavily produced one owner identity and a LinkedIn candidate, but no validated personal route, so Pascal remains `none`/confidence 0. A targeted Michael Halsall job was cancelled during provider fan-out; fixed deep-web ownership checks and path-based cancellation so cancelled workers cannot persist results or rewrite the job as `done`. Regression job `55e0b83a-5689-4005-998a-9d062086e001` stayed `failed` with zero writes. Current active HNWI result remains 0/4 directly contactable. |
| 2026-08-03 | **Bounded HNWI follow-up and provider parser hardening**: Patrick Remme (7 queries/9 pages), Alex Dean (7 queries/10 pages), and Michael Halsall (6 queries/10 pages) completed without worker stalls; all remained `none`/confidence 0 after fail-closed adjudication. Perplexity was observed returning valid JSON as a string with HTML entities; tolerant transport normalization was added before balanced extraction while strict contact validation remained unchanged. API tests pass 222/222, build passes, workflow restarted, and API/Redis/Atlas checks are healthy/idle. |
| 2026-08-03 | **Review-only intro path candidate layer**: Added `GET /api/research/intro-path/:entityId`, deriving at most one route from durable evidence. Only exact public URLs plus organization routes or named professional intermediary roles qualify; generic person candidates and blocked lead-generation publishers do not. Research UI shows the candidate immediately on target selection with evidence links, scope, warnings, and the manual verification action. Michael Halsall returns one `intermediary_candidate` from Contract Finder, while entity `email`/`phone`/`linkedinUrl` remain null, `contactOutcome=none`, and `isHot=false`. One bounded depth-2 run remained an empty graph path/manual review. Full API suite 227/227 and API/web builds pass; workflows healthy and Atlas remains idle. |
| 2026-08-03 | **Atlas stale-step guard and corp person-hop hardening**: A bounded six-category run was cancelled safely after provider fan-out remained on `1R Holdings SA` for more than two minutes; Tavily returned plan-limit errors and the corp→person extractor produced German editorial/UI fragments (`Der Fußballklub`, `Fußballvereine Kölner`, `Accessibility Feedback Deutsch`). No contacts were promoted. Reused the stronger deterministic human-name gate for regex and GLiNER person-hop candidates, blocked the observed fragments, added regressions (31 focused tests), rebuilt and restarted the API; Atlas is idle and Redis/API health is green. |
| 2026-08-03 | **Corporation person-hop claim-level admission hardening**: A smaller three-category retry advanced through multiple source rounds but stalled on `KH Group Oyj`; provider output included unrelated proper nouns (`Khan Academy`, `Free Online Courses`, `Launch Day`) and Tavily plan-limit errors. The run was cancelled safely with no promoted contacts. Added a local evidence-window gate requiring the exact candidate, an explicit role/ownership term, and a target anchor before corp→person searches and paid follow-up calls. Focused tests pass 34/34, full API suite 231/231, production build passes; API typecheck remains blocked by pre-existing workspace export/logger errors. Atlas is idle and API/Redis health is green. |
| 2026-08-03 | **GitHub import setup complete**: Imported BigContacts, installed pnpm dependencies, applied the PostgreSQL schema, installed Redis and Python OSINT tools (Holehe, Maigret, and Sherlock), configured local Redis plus `ENABLE_AUTO_PIPELINE=false`, and saved the requested provider credentials through Replit Secrets. Redis, API Server, and ApexFinder web workflows are running; `/api/healthz` returns `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Research and ingestion remain paused pending explicit instruction. |
| 2026-08-03 | **Atlas research handoff and contact-cache hardening**: Replaced the nonexistent `runResearchSession` call with a target-scoped UCT service that persists the real winning path, evidence, and audit stages in manual review without outreach. Shared press/media inboxes are excluded from Holehe; Redis restore/backfill now preserves EDGAR/Companies House phone provenance and recomputes contact outcome, confidence, and hot status instead of trusting cached scores. UCT explanations use the same personal-contact adjudication, so James J. Concilla remains `organization_contact`, confidence 0, `isHot=false`, `cookedAt=null`, `needs_follow_up`, and job outcome `incomplete`. Final target pass completed with 0 approved contacts; API suite 242/242, production build, restart, health, and evidence verification pass. |
| 2026-08-03 | **Contact integrity audit completed**: Rejected malformed local-parts such as `trust.@bizprofile.net`, quarantined heuristic/SMTP-only/malformed emails during the idempotent backfill, and made `isHot`, dashboard contactable/hot metrics, and operational `direct` filters require `direct_contact_verified`. Review candidates remain a separate person-only filter; legacy organization outcomes normalize to `organization_contact`. OpenAPI/Zod/client contracts now expose the contact filters. Live state: 103 funnel rows, 102 visible entities, 0 verified routes, 0 hot leads, 0 contactable records, 55 organization routes; API suite 244/244, API/web builds pass, workflows healthy, Atlas idle. |
| 2026-08-03 | **Evidence-led narrative summaries**: Replaced biography-only UI states across the active ApexFinder dashboard, entity ledger, and profile surfaces with separate `What they do` and `What we found` summaries. Stored filing/company notes, registry sources, nationality/location, linked assets, foundation data, and public profile text are surfaced without inventing occupation or personal facts. Root web build and typecheck pass; managed web workflow restarted; dashboard and Dean A Monco profile screenshots verified with no browser errors. |
| 2026-08-03 | **Atlas timeout and telemetry hardening**: Added a configurable fail-forward deadline to sequential target enrichment, preserving review-only state and cooperative cancellation ownership. Phase J now mirrors entity progress into the parent Atlas job. A live bounded run advanced through Phase J entities; after cooperative cancellation, the API was rebuilt/restarted and a single-target canary completed with 0 errors and `incomplete`/`needs_follow_up` outcome. API suite 244/244, production build, health, and final Atlas idle checks pass. |
| 2026-08-03 | **Atlas resumed as requested**: Started bounded discovery-first Atlas job `e2e38ff6-67bc-4ad4-9509-4f505f560478` with three broad categories, registry ingestion, sequential enrichment, Phase J, and five research slots. It completed Phase 0 cross-reference/enrichment work and is active in Phase 1 discovery/full-circle enrichment. OCCRP 401/rate-limit and OpenSky fetch failures are visible non-blocking provider failures; API/Redis health remains green. Persisted `ENABLE_AUTO_PIPELINE=true` for future continuous scheduling without restarting the active API process. |
| 2026-08-04 | **Atlas/Reactor visibility and restart safety**: The prior Atlas run was killed by an API restart at Phase 8, while `/api/ingest/atlas-status` incorrectly fell back to idle and the Reactor could not show the failure. Added persisted latest-job telemetry with a constant-time Redis pointer plus one-time migration for older jobs; desktop/mobile Reactor now distinguish live, failed, and complete Atlas state and retain the last failed phase. API and web production builds pass, health/Redis are green, and the fresh discovery-first job `feae7d88-3eee-48ae-99ee-7e9071801989` is active at Phase 0 with live OCCRP/OpenSky/Deep Web/provider nodes visible. Do not restart the API while this job owns the active slot. |
| 2026-08-04 | **Provider pool status correction**: Secure existence checks confirm `GROQ_API_KEY_1`–`_10` and `GEMINI_API_KEY_1`–`_10` are present and the running API discovers all 20 numbered slots; the unnumbered base keys are intentionally absent. A burst of provider 429s was being displayed as `EXHAUSTED API KEYS`, so the Reactor now says `Provider rate limit — configured keys rotating`. After cooldown, live status reports 10/10 Groq and 10/10 Gemini active while Atlas continues at Phase 8. |
| 2026-08-04 | **Mobile live research console + Phase J handoff**: Replaced the mobile Reactor’s inference-based activity display with a target-scoped public-source research console showing only confirmed target, phase, queue, operation, and API-emitted telemetry. Parent status text no longer lights individual tool nodes; missing lane telemetry is explicitly labeled unavailable. Added Phase J structured telemetry and a separate-worker snapshot to the Atlas status contract; web/API builds pass and the mobile screenshot is verified. The API was not restarted because job `feae7d88-3eee-48ae-99ee-7e9071801989` still owns the active slot. |
| 2026-08-04 | **Three requested project personas implemented**: Expanded the deterministic Persona Loop from 8 to 11 with `user_operator` (documented operator rules, not invented identity), `development_team` (implementation/checkpoint invariants), and `osint_specialists_team` (claim-level provenance and personal-vs-organization access). Phase J now runs all 11 after each target checkpoint and persists duplicate-safe findings in `improvement_logs`; Reactor telemetry labels the explicit `PERSONA REVIEW` lane. API/web builds and persona tests pass. The active Atlas worker `feae7d88-3eee-48ae-99ee-7e9071801989` was not restarted, so this hook is staged for the next safe API restart rather than claimed as live in the current process. |
| 2026-08-04 | **Durable Reactor feed and conversational cards**: Added capped target-scoped `ATLAS_EVENT` history beside latest telemetry, sanitized provider/tool summaries, expandable desktop/mobile event views, Sherlock/Maigret/Holehe and MCTS event coverage, and persona names in the Reactor inspector. Profile, dashboard, and ledger copy now uses conversational evidence-grounded wording without invented lifestyle claims. API/web production builds and diff checks pass. |
| 2026-08-04 | **Atlas process recovery and live telemetry activation**: The prior run reached Phase 8, J4–J9 pass 36/50 with 35 inserted targets and 0 target errors before an intentional API restart applied the optional candidate-funnel persistence guard; cold-start recovery preserved the failed state and released the lock. The API was rebuilt and restarted safely, then a new sequential discovery-first job `4813e6e4-64a5-4272-9417-6818d7a2b1ea` was launched with durable telemetry, personas, and the guard active. OCCRP/Aleph authorization and rate-limit failures remain non-blocking and visible. |
| 2026-08-04 | **Contact-focused pass and Phase J recovery hardening**: Ran forced web OSINT over all 7 current entities (6 enriched, 1 no-match, 0 errors) and reran the full registered 11-persona sweep (0 errors). Phase J encountered a stalled persisted worker at 10/50; added per-target timeouts for domain resolution, in-house enrichment, digital-footprint discovery, and persona review, and added `phase-j-pass` to cold-start ghost-job recovery. Restart reclaimed the stale lock; a follow-up bounded pass correctly reported no candidates due. API health/Redis are green, API build plus 40 test files/248 tests pass, and the web production build passes. Current dataset remains 7 corporations, 2 organization-contact outcomes, 5 none, 0 verified personal routes; scores remain evidence-backed rather than inflated. |
| 2026-08-04 | **Durable contact-research coordinator implemented**: Added `POST /api/ingest/contact-research`, `GET /api/ingest/contact-research/status`, and `POST /api/ingest/contact-research/cancel`. The coordinator persists target IDs, cursor, phase, completed/failed IDs, retry counts, and incomplete outcome in Redis; runs all 11 personas before one-target web OSINT and targeted Phase J; continues after target-level errors with exponential retry backoff up to three attempts; rejects corporation/trust-only datasets; prevents overlapping jobs; supports ownership-safe cancellation; and automatically resumes incomplete/retry-wait jobs after API restart. Phase J now accepts explicit target IDs for coordinator handoff. API build and all 250 tests pass; current 7-corporation dataset correctly returns no eligible HNWI/Gatekeeper targets. |
| 2026-08-04 | **Persona review fully satisfied**: Corporation/Trust records are excluded from individual-target hybrid-anchor, relationship-depth, profile-map, and personal-name gap rules; organization evidence remains fail-closed and audit-visible. After an API restart, the full 11-persona sweep processed all 7 entities with 0 errors and 0 new suggestions, and the pending findings ledger was verified empty. API build and 245 tests passed. |
| 2026-08-04 | **Atlas worker recovery and evidence-state audit**: The failed job `695d3303-413a-48ac-af0c-7930890dd110` was confirmed killed by an API restart during Phase 8/J4, not by a provider or data error. With no active lock, replacement job `6690ff6c-9dcc-47e6-a6df-44ae463505a4` ran in bounded discovery-first mode and completed Phase 10 with 15 entities, 2/2 MCTS targets, and 0 errors. Target-scoped contact research then processed David Fattal and Ole Andreas Halvorsen (2/2, 0 errors). Safe contact-state reconciliation left both at `organization_contact`, confidence 0, and `isHot=false`; no personal route was promoted. Final 11-persona sweep processed 15 entities with 0 new suggestions. The remaining 24 pending rows are durable evidence-gap recommendations for those two HNWI records, not unresolved integrity contradictions. API/Redis health is green, Atlas and contact research are idle, and `ENABLE_AUTO_PIPELINE=true` remains enabled. |
| 2026-08-04 | **Reactor runtime regression fixed**: The continuous scheduler UI was passed a page-level `scheduler` variable that had never been declared, causing the mobile Vite runtime overlay `Can't find variable: scheduler`. The page now derives the prop from the live `atlasState.scheduler` response. Web build passed, the canonical web workflow was restarted after clearing its duplicate port holder, and the 402×874 `/reactor` preview shows the active target, phase, and scheduler panel with no browser errors. The API and active Atlas cycle were not restarted. |
| 2026-08-04 | **Mobile Reactor lower-content visibility fixed**: The scrollable Reactor content reused `.atlas-grid`, whose `mask-image` faded the lower 20% of the entire scroll surface on iOS Safari. Added a mask-free scroll variant that retains the grid background but keeps the research context, event feed, counters, and full seven-stage pipeline map readable. Web build and diff checks pass; the canonical web workflow was restarted and the 402×1400 preview confirms the bottom map is fully visible. |
| 2026-08-04 | **Reactor lane semantics clarified**: The mobile and desktop live research views now separate `OSINT & EVIDENCE TOOLS` from `POST-RESEARCH QUALITY REVIEW`. The 11-persona block is explicitly described as deterministic inspection of the saved Phase J result; it does not search the web, add contacts, or perform OSINT. Mobile shows a two-lane legend before the expandable context panel, and desktop groups the inspector tools by role. Web build, diff checks, workflow restart, and 402×1400/1440×900 previews passed with no browser errors. |
| 2026-08-04 | **Atlas preview recovery**: Atlas was not stopped; cycle 8 job `e724ca17-e46a-4f08-b487-9c1db483da5a` remained active and advanced from 17% to 41% in Phase 0/OpenOwnership with PostgreSQL and Redis healthy. The canonical `artifacts/apex-finder: web` preview had failed because a duplicate managed web workflow held port 23695. Stopped the duplicate holder, restarted the canonical workflow, and verified the mobile Reactor showed the live target and research state. The API was not restarted or cancelled. OCCRP rate limits remained non-fatal provider warnings. |
| 2026-08-05 | **Reactor scheduled-wait visibility fixed**: The mobile screenshot correctly showed a completed Atlas run during the serialized scheduler’s 30-minute wait, but the UI looked silent because it only exposed the completed state. Added a scheduler countdown clock and explicit `NEXT CYCLE QUEUED`/`Standby · next Atlas cycle in …` state to mobile and desktop; the countdown derives from the live scheduler snapshot and does not simulate research activity. Web build passed, canonical workflow restarted, and the live Reactor then showed cycle 12 active at phase 6/10. |
| 2026-08-05 | **Unavailable-source fallback hardening**: OCCRP now falls back to official OFAC SDN XML for compliance evidence only; live aircraft enrichment uses adsb.lol first with OpenSky compatibility fallback and registration-first matching; historical ADS-B adds Airplanes.Live before legacy providers; ICIJ uses `/api/v1/reconcile` JSON batches and rejects fuzzy `match:false` suggestions; registry search returns truthful 200 partial/unavailable payloads instead of 500 on provider outages; ARES gives a specific narrow-query message; source labels and reliability profiles were updated. API build passed, web build passed, 232 non-smoke tests plus focused fallback tests passed, and the API was restarted only after Atlas job `5208bf36-f944-4d6b-86fd-5af2323a4e6c` completed phase 10. |
| 2026-08-05 | **Targeted web-research effectiveness pass**: Added shared target-record anchors and provider-specific Phase 0 lanes across the canonical web enricher and deep-web path; Perplexity/Gemini prompts now explain the lane and candidate-domain status, while Tavily/Exa queries use the same anchored fingerprint. Added regression coverage for prompt/query contracts. API production build passed and the full API test run passed 252/252; the full typecheck remains blocked by pre-existing shared database-export and legacy-tree errors, with no new errors in the modified research files. API restart, PostgreSQL/Redis health, and the canonical web shell check passed. |
| 2026-08-05 | **BigContacts import + full environment setup**: Cloned https://github.com/2f22vtd4kr-cloud/BigContacts, copied all artifacts (apex-finder, apex-mobile), api-server src, lib/, scripts/, .agents/memory/, and root markdown files into the workspace. Ran pnpm install (+784 packages), installed Redis system package, installed Python 3.11, pushed DB schema, set REDIS_URL=redis://localhost:6379 and ENABLE_AUTO_PIPELINE=false, configured Redis workflow, ran scripts/install-python-tools.sh (holehe ✓, maigret ✓, sherlock ✓, gliner optional). Workflows started: Redis → API Server → apex-finder: web. Final health check returned {"status":"ok","redis":{"status":"ok","latencyMs":2}}. |
| 2026-08-05 | **Provider key rotation tuned before research**: Gemini remains on the lower-credit `gemini-2.0-flash-lite` model with a reduced output cap. Groq, Gemini, Tavily, and Exa now use provider-specific shared round-robin starting cursors so concurrent calls do not repeatedly hit the first newly-created key; per-key 429 cooldowns remain separate and fail-soft. API build passed, API restarted, `/api/healthz` returned Redis healthy, and no research was started. |
| 2026-08-05 | **Mobile status and key visibility fix**: Header status popovers were anchored to their compact controls and could render off-screen on mobile, while translucent panels let page content bleed through. Both panels now use a viewport-safe mobile position, opaque background, and bounded scrolling. Compact header controls now immediately distinguish `DB x/y` persistent Redis capacity from `WEB x/y` web-OSINT key capacity; expanded panels repeat `Database / persistence` and `WEB OSINT` labels. Production web build passed, canonical preview restarted, and 402px/390px mobile previews show the compact capacity indicators cleanly. |
| 2026-08-05 | **Atlas progress check**: No continuous Atlas cycle is currently running. The latest target-scoped run finished at 09:18 UTC in about 2 minutes with 0 errors, 1 target processed, candidate path 55/100, and `needs_follow_up`. All ingest queues are idle. The durable scheduler record is stale (`lastTriggerAt` 07:42 UTC, `nextTriggerAt` 08:31 UTC), while the current API process has `ENABLE_AUTO_PIPELINE=false`, so the scheduler was disabled on this boot. PostgreSQL and Redis remain healthy. |
| 2026-08-05 | **Gemini Deep Research embedded in web OSINT**: Added the asynchronous Deep Research provider to the canonical Phase 0 fan-out with a 75-second per-target bound and isolated slots `_11`–`_13`. Reports remain explicitly review-only; citations feed only the normal exact-page fetch/provenance path, and no report text enters contact extraction or promotion. Hardened corporation person-name filtering against phrase-like captures, preserved report-only results in metadata, and verified the prior 22-entity Atlas cycle completed with 0 errors before restart. |
| 2026-08-05 | **Hugging Face Open Deep Research lane**: Added a bounded project-native `smolagents` runner with Serper search, bounded public-page fetching, machine-readable output, timeout/query/page/report limits, and fail-closed errors. Wired it into canonical Phase 0 as an isolated review-only provider; reports remain outside contact extraction and citations become scrape leads for exact-page validation. Serper returned live results and Hugging Face inference was verified independently; the full agent correctly failed closed when a 72B generation exceeded its timeout, so the default is now the faster configurable 7B model. |
| 2026-08-05 | **GitHub main reconciliation and provider-status publication**: Reconciled the workspace with the newer GitHub `main` history without force-pushing or overwriting remote work. Preserved the newer Atlas/enrichment base, restored `ENABLE_AUTO_PIPELINE=false`, retained the bounded Hugging Face/Serper review-only decision, and reapplied the separate Open Research status lane across API, desktop, and mobile surfaces. The two uploaded Git screenshots remain local reference attachments and are not product assets. |
| 2026-08-05 | **Corporation-to-person review handoff repaired**: Atlas now persists named people found during organization research independently of contact discovery, preserving role, basis, jurisdiction, source URLs, and explicit review-only/non-HNWI state. The profile prefers this structured candidate list and labels it review-only. A bounded single-target retry for Amaron Helsingborg Topasen 7 AB completed in 5 minutes with 0 errors and stored 4 Swedish-company candidates; the corporation still has no personal email, phone, hot status, or promoted route. API/web builds, workflow restart, health checks, and a live profile screenshot passed. Swedish officer evidence still needs an appropriate Sweden-specific source before identity or contact promotion. |
| 2026-08-05 | **Amaron operator-to-executive handoff benchmark completed**: Entity 6 now retains `amaron.se` and Amaron Real Estate AB in the investigator plan, with Martin Mildner, Stefan Wilhelmson, and Kjell Rudsby as named review-only executives. Official operator pages are fetched past large embedded JSON payloads, per-person phone/email attribution is bounded to each page segment, and shared `info@amaron.se` is organization-only. Final run completed 1/1 with 0 errors; 259 focused API tests, production build, API health, web health, and desktop/mobile Profile/Research previews passed. |
| 2026-08-05 | **Persisted Research review hydration**: The Research page now loads the selected entity’s saved candidate funnel and route hierarchy on selection/reload, while keeping explicit UCT analysis as a separate action. Amaron’s 19-route hierarchy and three named executive routes are visible on desktop and mobile without launching another run; frontend/backend builds, API/web health, and browser-console checks pass. |
| 2026-08-06 | **Research architecture hardening**: Added explicit target subject kinds and compact disambiguation notes to provider prompts/queries and persisted investigator plans; provider lanes now retain independent status, negative findings, and search gaps; blocked anti-bot pages are distinct from unavailable HTTP/fetch failures; incomplete stages remain review/blocked/unavailable instead of claiming completion. Both enrichment routes persist the coverage metadata, research sessions hydrate the plan unchanged, focused API tests pass (89), production API build passes, and `/api/healthz` reports Redis healthy. |
| 2026-08-06 | **Yield widening pass**: Expanded bounded candidate/person/page/citation retention and official operator-page coverage before adjudication, while keeping fail-closed identity, provenance, attribution, exact-page, generic-mailbox, and reachability rules unchanged. Added persisted `deepWebYieldMetrics` for useful-yield benchmarking. Full API suite passed 39 files / 264 tests, API build passed, managed API workflow restarted, and `/api/healthz` remained Redis-healthy. No benchmark run was launched, so result superiority remains unproven until measured. |
| 2026-08-06 | **Controlled Campione benchmark**: Pushed the four local commits and verified `main` equals `origin/main` at `3349a66`. Cancelled the abandoned Amaron trial, then ran a clean single-target retry for `Casinò di Campione S.p.A.` with a 10-minute target budget. Atlas completed in about 3 minutes with 0 run errors but no promoted contact, 5 page-noise person candidates, and 11 review-only evidence rows dominated by unrelated organization signals. Independent exact-domain research found official leadership pages naming Stefano Silvestri as general manager/managing director with `s.silvestri@casinocampioneditalia.it` (a named business route, not validated personal access), plus organization-only mailboxes. Conclusion: Atlas did not outperform focused independent research on this target; API health remained Redis-healthy. |
| 2026-08-06 | **Workspace re-import (Replit Agent)**: Cloned `2f22vtd4kr-cloud/BigContacts`, copied all artifacts (`apex-finder`, `apex-mobile`), api-server src, lib packages, scripts, agent memory, and root files. Ran `pnpm install` (784 packages). Installed system dep `redis` (7.2.10) and Python 3.13. Set env vars `REDIS_URL=redis://localhost:6379` and `ENABLE_AUTO_PIPELINE=false`. Configured Redis workflow. Pushed DB schema. Ran `scripts/install-python-tools.sh` — holehe ✓ maigret ✓ sherlock ✓ smolagents ✓ (gliner optional/skipped). Started workflows: Redis → api-server → apex-finder web. Final `/api/healthz`: `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. API server confirmed OSINT tools verified on startup. |
| 2026-08-06 | **Full project import from GitHub**: Cloned `2f22vtd4kr-cloud/BigContacts` and imported all artifacts (`apex-finder`, `apex-mobile`), api-server src, lib packages, scripts, agent memory files, root config files, and root .md files into the workspace. Installed system dep `redis` (7.2.10), Python 3.11, and ran `pnpm install` to resolve all deps including `ioredis`. Set env vars `REDIS_URL=redis://localhost:6379` and `ENABLE_AUTO_PIPELINE=false`. Configured Redis workflow (`redis-server --port 6379 --save '' --appendonly no`). Pushed DB schema via `pnpm --filter @workspace/db run push`. Ran `scripts/install-python-tools.sh` — holehe, maigret, sherlock, smolagents, beautifulsoup4, markdownify, python-dotenv, requests all installed; gliner optional/skipped. Restarted api-server twice (once after ioredis install, once after Python tools). Final health check: `{"status":"ok","redis":{"status":"ok","latencyMs":1}}`. Workflows running: Redis, api-server API Server, apex-finder web. |
| 2026-08-06 | **Case Bureau architecture and live verification**: Added `research_cases` plus append-only `research_case_events`, the provider-key-independent local Head Investigator/case-file service, case API routes/OpenAPI codegen, and the Research desk bureau console. The local director builds a target-scoped specialist roster, bounded action queue, shared evidence context, ranked direct→executive→operator→intermediary→organization routes, and human directives while preserving review-only provenance. Used one clearly labeled synthetic target to verify open/get/advance/directive/events through the live API, then deleted it; cascade verification returned 0 temporary entities, cases, and events. API/web builds and typechecks passed, API/Redis health was 200. |
| 2026-08-06 | **Discovery-first Case Bureau**: Extended `research_cases` to allow `targetEntityId = null` and added discovery/target case types, Gemini Boss metadata (`gemini-3.1-pro-preview`, pending until configured), durable human mission/geography/exclusions, and a generated broad public-web opening prompt. Added create/latest/get discovery routes, append-only initial-research recording with Boss commentary and source URLs, and reviewed candidate promotion into the existing target-scoped case file while preserving discovery context. The Research desk now begins with the mission before entity selection and reloads the latest discovery case. Live lifecycle test passed for open → retrieve → record response/commentary → latest reload; the clearly labeled temporary case and events were deleted with zero remaining rows. API build, library/frontend typechecks, schema push, web/API restart, health check, and Research preview passed. Gemini was not called or configured. |
| 2026-08-06 | **Gemini Boss cost policy**: Replaced the Case Bureau's planned `gemini-3.1-pro-preview` default with the official cost-safe `gemini-3.1-flash-lite` model, which supports the future Boss requirements for text, search grounding, structured output, and function calling. Centralized the model constant, updated discovery and legacy target-case creation, changed the database default, and documented that client model overrides no longer replace the cost policy. No Gemini key was requested or read, and no provider call was made. |
| 2026-08-06 | **Gemini Boss automatic low-cost selection**: Replaced the fixed Flash-Lite version with `auto-low-cost-pending` until keys exist. On case creation, the server now inspects the configured Gemini key's model catalog, filters compatible generative models, and cost-ranks Flash-Lite/Flash families with older stable versions preferred; the selection is cached briefly and persisted per case. No Gemini keys are configured, so no catalog call was made. |
| 2026-08-06 | **Gemini current API correction**: Read the current Google Gemini docs and replaced the Bureau's legacy `generateContent` + `gemini-3-flash-preview` path with the documented Interactions API, current catalog-selected Flash models, `tools: [{ type: "google_search" }]`, and Interactions citation annotations. A clean Case 5 run with the newest supplied key selected `gemini-3.6-flash` and reached Google, which returned a structured `too_many_requests` HTTP 429. API build and health check passed. |
| 2026-08-06 | **Gemini Search entitlement isolated**: Direct tests with the fresh key showed model catalog access and plain `gemini-3.6-flash` Interactions generation succeed, while adding Google Search returned HTTP 429. Google pricing documents Gemini 3.x Search grounding as paid-tier-only; Gemini 2.5 is unavailable to new users and Gemini 2.0 returned a provider error. Bureau discovery now preserves this as a provider gap and continues Tavily/Exa/DuckDuckGo plus registry lanes; Case 5 completed with 6 review-only candidates and no entity insertion. |
| 2026-08-06 | **Gemini search permanently disabled**: Removed Gemini from all enrichment/search fan-outs, adaptive provider dispatch, telemetry, provider status, and the legacy Deep Research endpoint. Gemini is text-only for Boss planning/review; on Boss model HTTP 503/429 it automatically tries the next catalog-compatible lower model without repeating search lanes. |
| 2026-08-06 | **Mistral web-search lane configured (research not started)**: Added the secure `MISTRAL_API_KEY` to the investigatory Bureau configuration. Mistral uses the Conversations API built-in `web_search` tool, is isolated as an explicit review-only discovery lane, and is guarded to one request per second. Existing Hugging Face Open Deep Research remains wired to `HF_TOKEN` plus bounded Google-backed `SERPER_API_KEY` searches. Status endpoint verified Mistral, Hugging Face, and Serper configured; API build and managed API/web workflows are healthy. No research case or provider request was run. |
| 2026-08-06 | **NVIDIA NIM GLM-5.2 case-file reasoning lane configured**: Added the secure `NVIDIA_NIM_API_KEY` and wired NVIDIA’s OpenAI-compatible `z-ai/glm-5.2` endpoint into target-scoped Bureau advancement. GLM receives only the serialized `research_cases.caseFile` (“case context”) and existing queued actions, selects one bounded next action, and cannot search, invent evidence, promote contacts, or create actions. Invalid/unavailable NIM responses fall back to the local Head Investigator planner. System status exposes the reasoning lane separately from web-search providers; no research case was advanced during setup. |
| 2026-08-06 | **Boss/right-hand hierarchy corrected**: The Boss remains the target-case Head Investigator and owns the director fields and final action-queue decision. GLM-5.2 is now explicitly the Boss's right-hand advisor: its bounded recommendation is stored as `rightHandAdvice` and an append-only advisor event, but it cannot activate or replace the Boss's selected action. The Research desk and provider status labels now reflect the hierarchy. |
| 2026-08-06 | **Gemini installed as Boss**: Target-case advancement now consults GLM first, then sends the case file plus GLM's advisory to Gemini plain `generateContent` as the authoritative Boss. Gemini selects only an existing queued action, generates the investigator prompt, approved tool subset, evidence requirements, and search-discipline restrictions, then activates the action only after strict validation. No Gemini web-search grounding is used; web/registry/Sherlock investigators remain separate search-capable lanes. Invalid or unavailable Gemini output falls back to the local Boss planner. |
| 2026-08-06 | **Graceful GitHub merge handoff**: Following the previous re-import reconciliation pattern, the divergent GitHub `main` history was preserved without force-pushing. The complete latest workspace tree is published on `replit-sync-bureau-contract-20260806`; PR #15 is the requested merge path into `main`. Merge that PR in GitHub to make `main` current. |
| 2026-08-06 | **PR conflict resolution completed**: GitHub `main` advanced after the sync branch was opened, so the current remote `main` was merged into the sync branch as a normal merge commit. Overlapping API/UI files kept the latest Bureau implementation, GitHub-only files were retained, conflict markers were cleared, focused Bureau tests passed 7/7, API/web builds passed, and the canonical API/web previews are healthy. |
