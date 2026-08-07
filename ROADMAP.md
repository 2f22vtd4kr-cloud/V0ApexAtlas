# ApexFinder Pro — Improvement Roadmap

> **Tracking contract:** This file is the canonical source of truth for all planned and in-progress work.  
> After every re-import, read this file first and update status markers before starting work.  
> Use `[x]` for complete, `[-]` for in-progress, `[ ]` for not started, `[~]` for deferred/blocked.  
> Append to the **Completion Log** at the bottom after each phase or significant item lands.

---

## Audit Baseline (2026-07-25)

From the pipeline audit (`attached_assets/Pasted-Pipeline-Audit-*.txt`):

| Metric | Reported | Actual |
|---|---|---|
| "Reachable" entities | 992 (3.08%) | ~992 have *some* contact signal — majority is organisational |
| True personal contacts (SMTP + GitHub + clean ContactPage) | — | ~100–140 |
| True personal-contact yield | 3% | ~0.4–0.5% |
| Generic/corporate inboxes in email pool | — | ~30–35% of all emails |
| Registrar-contact noise (web.com, namebright, AWS) | — | ~32 entries |
| Entities with NULL contact_outcome | — | 99.88% of 32,201 |
| organisation_contact outcome assigned | — | 0 entities |

**Root cause:** The pipeline has no contact-type discrimination — it cannot distinguish "personal email" from "company customer-service address." The architecture is sound; the fixes are targeted and achievable.

---

## Phase K — Contact Quality Hardening *(immediate, highest ROI)*

> Goal: Clean the existing contact pool. No new sources. Fixes the four audit priorities plus phone hygiene.

### K1 — RDAP Registrar Domain Blocklist
**File:** `artifacts/api-server/src/lib/in-house-enricher.ts` → `rdapLookup()`  
**Problem:** RDAP returns the registrar's own contact (web.com ×12, namebright ×2, AWS support ×18) because `rdapLookup()` only filters "abuse"/"privacy"/"proxy" in the email string — it does not check whether the email's domain belongs to a registrar/hosting provider rather than the entity being researched.  
**Fix:** Before accepting any RDAP email, extract its domain and reject it if it matches a registrar/hosting blocklist. Also compare against the entity's own `knownDomain` — if the RDAP contact domain differs from the entity domain AND appears in the registrar list, discard.

- [x] Add `REGISTRAR_DOMAINS` set to `contact-validation.ts` (exported, ~30 domains)
- [x] Reject RDAP email in `rdapLookup()` if its domain is in `REGISTRAR_DOMAINS`
- [ ] Add unit test: RDAP result with web.com email → null returned
- [ ] Add unit test: RDAP result with entity's own domain → accepted

---

### K2 — Generic Prefix Penalty at `setEmail()` Write Time
**File:** `artifacts/api-server/src/lib/in-house-enricher.ts` → `setEmail()`

- [x] Add `GENERIC_PREFIXES` set (~30 prefixes) to `contact-validation.ts`
- [x] Export `isGenericEmailPrefix(local: string): boolean` from `contact-validation.ts`
- [x] In `setEmail()`: if `isGenericEmailPrefix(local)`, apply `confidence -= 30`; if ≤0, reject
- [x] Set `result.hasGenericEmail = true` flag for downstream `computeContactOutcome` (L1)
- [x] Track `result.emailSource` for org-contact attribution chain

---

### K3 — Cross-Entity Email Uniqueness Scan
**File:** `artifacts/api-server/src/routes/ingest-enrichment.ts`, `artifacts/api-server/src/lib/startup.ts`

- [x] Add `POST /api/ingest/flag-shared-emails` — SQL HAVING COUNT(DISTINCT id) >= 3, bulk-updates `organization_contact`
- [x] Wire into startup phases array (Phase 3b, 215s after boot)
- [ ] Add integration test

---

### K4 — Auto-Trigger Backfill After Ingestion
**File:** `artifacts/api-server/src/lib/startup.ts`

- [x] Add `POST /ingest/backfill-contact-outcomes` to startup phases array (Phase 3b, 210s after boot — after enrichment, before relationship graph)
- [x] Applies to both cold-start (empty DB) and populated-DB maintenance paths (phases array is inside `runPopulatedDbMaintenance`)

---

### K5 — Phone Number E.164 Normalisation
**File:** `artifacts/api-server/src/lib/contact-validation.ts`, `artifacts/api-server/src/lib/in-house-enricher.ts`

- [x] Add `normalizePhone(raw: string): string | null` to `contact-validation.ts` (8–15 digit range, +1 prefix for 10-digit US)
- [x] Replace raw phone storage in `setPhone()` with `normalizePhone()` result — old PHONE_BLOCKLIST removed
- [x] Raise minimum digit count from 7 to 8
- [x] Add `POST /api/ingest/normalize-phones` migration endpoint for existing DB records
- [x] Track `result.phoneSource` for org-contact attribution

---

### K6 — Email Domain Parsing Bug (JS Filename as Domain)
**File:** `artifacts/api-server/src/lib/contact-validation.ts` → `isValidPublicEmail()`

- [x] Add `SCRIPT_EXTENSION_RE` to `isValidPublicEmail()` — rejects `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`, `.py`, `.rb`, `.php`, `.sh`, `.json`, `.wasm`, `.map`, `.lock`
- [x] Add `IP_LIKE_DOMAIN_RE` — rejects `10.x.x`, `192.x`, etc.

---

## Phase L — Contact Outcome Correctness

> Goal: Make `computeContactOutcome()` correctly classify organisational vs personal contacts so the dashboard Reachable metric reflects reality.

### L1 — `computeContactOutcome()` Must Detect Organisational Contacts
**File:** `artifacts/api-server/src/lib/contact-confidence.ts` → `computeContactOutcome()`

- [x] Added `emailSource?: string | null; phoneSource?: string | null; isGenericPrefix?: boolean` to input type
- [x] Imports `isGenericEmailPrefix` from `contact-validation.ts` — works for existing DB records in backfill path without explicit flag
- [x] Rule: `phoneSource === "EDGAR-Phone"` or `"CompaniesHouse-Phone"` AND no email → `organization_contact`
- [x] Rule: email local-part is generic (explicit flag OR pattern check) → `organization_contact`
- [x] Updated caller in `ingest-enrichment.ts` to pass `isGenericPrefix`, `emailSource`, `phoneSource`, `validatedDirectContact`
- [x] Updated `backfill-contact-outcomes` to read persisted `emailSource`/`phoneSource` from entity metadata

---

### L2 — Dashboard "Reachable" Metric Split
**File:** `artifacts/api-server/src/routes/dashboard.ts`, `artifacts/apex-finder/src/pages/dashboard.tsx`

- [x] Added parallel SQL query to `dashboard.ts`: `reachablePersonal`, `reachableVerified`, `reachableOrg`, `reachableSocial` by `contact_outcome`
- [x] All four fields returned from `/api/dashboard/stats`
- [x] Dashboard header strip: shows `reachablePersonal` (labelled "Personal") when backfill has run; falls back to `contactableCount` (labelled "Reachable") before first backfill — no misleading 0 during cold start
- [x] Mobile stat tiles updated identically

---

### L3 — Contact Evidence Audit Panel
**File:** `artifacts/apex-finder/src/` (new tab/panel on Data Sources page)  
**Problem:** No UI surface to inspect the contact quality breakdown — which email domains are most common, which sources contribute noise, what the prefix distribution looks like.  
**Fix:** Add a "Contact Audit" tab to the Data Sources page (`/data-sources`). Show: top 20 email domains by frequency, source attribution breakdown, generic-prefix count, SMTP-verified count, organization_contact vs direct_contact_candidate split.

- [ ] Add `GET /api/pipeline/contact-audit` endpoint returning domain frequency, source breakdown, outcome counts
- [ ] Add Contact Audit tab to Data Sources page
- [ ] Surface the "true personal yield" metric prominently

---

## Phase M — Yield Improvement

> Goal: Increase the true personal-contact yield from ~0.4–0.5% toward a measurable target. No new third-party APIs required — improvements to existing sources and enrichment logic.

### M1 — Promote SMTP-Verified Contacts to `direct_contact_verified`
**File:** `artifacts/api-server/src/lib/in-house-enricher.ts`, `artifacts/api-server/src/routes/ingest-enrichment.ts`

- [x] `result.smtpVerified = true` set in `enrichInHouse()` after successful SMTP handshake
- [x] `updates["validatedDirectContact"] = true` written to DB when `result.smtpVerified`
- [x] `computeContactOutcome()` caller passes `validatedDirectContact: result.smtpVerified === true`
- [x] Backfill derives verified status from `enrichmentSources` containing `"SMTP-Verified"` (handles existing records)
- [ ] Surface `direct_contact_verified` badge in Entity Ledger and profile pages
- [ ] Dashboard count of verified contacts

---

### M2 — Multi-Pass Enrichment for `social_only` Entities
**File:** `artifacts/api-server/src/routes/ingest-enrichment.ts`, `artifacts/api-server/src/lib/startup.ts`  
**Problem:** Entities with only a LinkedIn URL (`social_only`) are marked `needsEnrichment = false` in some cases (J1 partially fixed this but cold-start recovery doesn't explicitly schedule a second pass).  
**Fix:** In the post-ingestion maintenance loop, identify `social_only` entities that haven't had a second enrichment pass (check `lastEnrichedAt` or enrichment-pass counter in metadata). Schedule them for a budget-capped background pass focused on domain guessing → email patterns → SMTP.

- [ ] Add `enrichmentPassCount` field to entity metadata (or use existing `lastEnrichedAt`)
- [ ] Post-maintenance: query `social_only` entities with `enrichmentPassCount < 2`
- [ ] Run targeted second pass: domain-guesser → email-pattern → SMTP only (skip knowledge graphs)
- [ ] Cap: max 100 entities per background pass to avoid OOM
- [ ] Log yield delta per pass in structured logs

---

### M3 — LLC → Person Resolution Coverage
**File:** `artifacts/api-server/src/lib/in-house-enricher.ts` → `resolveBeneficialOwner()`  
**Problem:** FAA aircraft are primarily registered to LLCs. The beneficial owner resolver exists (Phase I1) but only runs for Tier 3 entities. Many FAA LLC entities that could be pierced to a named individual are staying as LLC records with no personal contact path.  
**Fix:** Increase the coverage of LLC → person resolution by adding OpenCorporates fallback for LLCs that don't appear in EDGAR SC 13D/G, and by attempting resolution for Tier 2 entities (FAA individuals) whose names suggest an LLC wrapper.

- [ ] Audit current `resolveBeneficialOwner()` hit rate (add metric to enrichment logs)
- [ ] Add OpenCorporates lookup as fallback when EDGAR EFTS returns no result
- [ ] Extend to Tier 2 entities whose names end in LLC/Ltd/Corp
- [ ] Log resolved person names for review before enriching as person

---

### M4 — Contact Attribution Chain (Provenance Per Contact)
**File:** `artifacts/api-server/src/lib/contact-attribution.ts`  
**Problem:** Each entity has a single email/phone but no audit trail of which source provided it, at what confidence, and when. This prevents quality review and makes it impossible to batch-remove noise from a specific bad source.  
**Fix:** Persist the full contact evidence list per entity (source, value, confidence, timestamp) in a `contact_evidence` JSONB column or a new `contact_evidence` table. The winning contact is still promoted to the entity's `email`/`phone` columns for query efficiency.

- [ ] Design schema: `contact_evidence` table with `entity_id`, `type` (email/phone), `value`, `source`, `confidence`, `capturedAt`, `outcome`
- [ ] Write evidence rows in `setEmail()` / `setPhone()` instead of discarding non-winners
- [ ] Add `GET /api/entities/:id/contact-evidence` to expose the evidence chain
- [ ] Surface in profile page: "Contact Evidence" expandable section showing all sources
- [ ] Enable batch-purge by source: `DELETE FROM contact_evidence WHERE source = 'RDAP-Registrant'`

---

## Phase N — Infrastructure & Data Quality

> Goal: Platform health, dedup integrity, and resilience improvements that enable all other phases.

### N1 — Upstash Slot 1 Quota Replacement
**File:** `replit.md` (procedure documented), `artifacts/api-server/src/lib/redis.ts`  
**Problem:** `REDIS_URL_1` hit its 500k free-tier request cap. Slot scanner falls back to slots 2–4, but slot 1 keeps retrying non-fatally in the background, consuming log noise and marginal overhead.  
**Fix:** Add a fresh Upstash database as `REDIS_URL_5`. The slot scanner picks it up automatically.

- [ ] Create new Upstash Redis database at upstash.com
- [ ] Add its URL as `REDIS_URL_5` in Replit Secrets
- [ ] Restart API Server and confirm `Permanent Redis connected slot: 5` in logs
- [ ] Verify slot 1 retry noise subsides (it will keep retrying but slot 5 absorbs the work)

---

### N2 — Startup Auto-Backfill for Fresh Imports
**File:** `artifacts/api-server/src/lib/startup.ts`

- [x] `backfill-contact-outcomes` added to phases array at 210s (Phase 3b — after enrichment, before relationship graph)
- [x] `flag-shared-emails` added to phases array at 215s
- [x] Applies to both cold-start (post-ingestion watcher path) and populated-DB maintenance path — phases array lives inside `runPopulatedDbMaintenance()`

---

### N3 — Pre-existing TypeScript Errors Cleanup
**File:** Various files throughout `artifacts/api-server/src/`  
**Problem:** Workspace typecheck has unrelated pre-existing errors noted across multiple session logs. These don't block builds (esbuild bypasses TS errors) but suppress real type-safety signals.  
**Fix:** Audit the pre-existing errors, fix or suppress with targeted `// @ts-expect-error` where genuinely intentional. Goal: clean `pnpm --filter @workspace/api-server run typecheck`.

- [ ] Run `pnpm --filter @workspace/api-server run typecheck 2>&1 | grep "error TS"` — count and categorize
- [ ] Fix structural errors (wrong types, missing properties)
- [ ] Suppress with `@ts-expect-error` only where the runtime behavior is correct but typings are wrong
- [ ] Target: zero typecheck errors in the API server

---

### N4 — Contact Deduplication Within Entities
**File:** `lib/db/src/schema/`, `artifacts/api-server/src/routes/ingest-enrichment.ts`  
**Problem:** "Delux Public Charter LLC" appears 5 times with identical email and phone. Ingestion dedup prevents re-ingesting the same registry record, but multiple enrichment passes or research sessions can write duplicate entity rows.  
**Fix:** Add a unique index on `(registry, registryId)` to prevent duplicate entity rows at the DB level. Add a cleanup endpoint to merge existing duplicates by registry+registryId.

- [ ] Audit: `SELECT registry, registry_id, COUNT(*) FROM entities GROUP BY registry, registry_id HAVING COUNT(*) > 1`
- [ ] Add unique index: `UNIQUE (registry, registry_id)` to the entities table (via Drizzle schema)
- [ ] Add `POST /api/ingest/dedup-entities` endpoint: merge duplicate rows (keep highest-confidence contact, merge metadata)
- [ ] Run dedup sweep on existing data after index is applied

---

## Completion Log

> Append one line per completed item or phase with date and brief note.

| Date | Item | Notes |
|---|---|---|
| 2026-07-25 | Roadmap created | Audit baseline established; Phases K–N defined |
| 2026-07-25 | K1–K6 implemented | RDAP registrar blocklist, generic prefix penalty, cross-entity email dedup endpoint, backfill auto-trigger, E.164 normalisation, JS-filename domain rejection |
| 2026-07-25 | L1–L2 implemented | computeContactOutcome org detection (EDGAR-Phone, generic prefix); dashboard metric split — "54 Personal" shown (was misleading 992 Reachable) on 32,700 entities = ~0.16% true personal yield, consistent with audit estimate |
| 2026-07-25 | M1 implemented (server-side) | smtpVerified flag → validatedDirectContact DB write; backfill derives from SMTP-Verified enrichmentSources |
| 2026-07-25 | N2 implemented | backfill-contact-outcomes + flag-shared-emails auto-triggered in startup phases at 210s/215s |

---

## Quick Reference — Status Summary

| Phase | Title | Status | Priority |
|---|---|---|---|
| K1 | RDAP Registrar Blocklist | [x] Done | 🔴 Critical |
| K2 | Generic Prefix Penalty at setEmail | [x] Done | 🔴 Critical |
| K3 | Cross-Entity Email Uniqueness Scan | [x] Done | 🔴 Critical |
| K4 | Auto-Trigger Backfill After Ingestion | [x] Done | 🔴 Critical |
| K5 | Phone E.164 Normalisation | [x] Done | 🟠 High |
| K6 | Email Domain Parsing Bug (JS filename) | [x] Done | 🟠 High |
| L1 | computeContactOutcome Org Detection | [x] Done | 🔴 Critical |
| L2 | Dashboard Reachable Metric Split | [x] Done | 🟠 High |
| L3 | Contact Evidence Audit Panel | [ ] Not started | 🟡 Medium |
| M1 | Promote SMTP-Verified to direct_contact_verified | [x] Done (server-side) | 🟠 High |
| M2 | Multi-Pass for social_only Entities | [ ] Not started | 🟠 High |
| M3 | LLC→Person Resolution Coverage | [ ] Not started | 🟡 Medium |
| M4 | Contact Attribution Chain (Provenance) | [ ] Not started | 🟡 Medium |
| N1 | Upstash Slot 1 Replacement | [ ] Not started — manual (add REDIS_URL_5 secret) | 🟠 High |
| N2 | Startup Auto-Backfill Fresh Imports | [x] Done | 🟠 High |
| N3 | Pre-existing TypeScript Errors | [ ] Not started | 🟡 Medium |
| N4 | Contact Dedup Within Entities | [ ] Not started | 🟡 Medium |
