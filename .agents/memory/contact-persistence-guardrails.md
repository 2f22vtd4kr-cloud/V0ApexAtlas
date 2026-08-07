---
name: Contact persistence guardrails
description: Durable rule for keeping alternate writes and merges from bypassing public-contact validation.
---

Every path that persists or restores contact data must sanitize email, phone, and social values before writing PostgreSQL, evidence, Redis, or metadata. Never trust an incoming cached confidence score or a module-local score; recompute personal Access confidence from the cleaned vectors and entity type.

**Why:** Alternate enrichment routes, Redis restore, startup maintenance, and entity merge logic can otherwise reintroduce stale or invalid contacts after the primary enrichment path has been hardened.

**How to apply:** Keep the shared validators at every persistence boundary. On merges and maintenance, recompute contact outcome and `isHot` from the sanitized person-level direct vectors; pass entity type into every recomputation, and keep organization contacts and generic/shared channels outside personal Access.

This also applies to presentation boundaries: if stored legacy metadata says a corporation or trust has a personal outcome, API responses and ledger cards must normalize it to an organization route rather than exposing the stale label.

Registry-phone provenance must have a persisted schema field, not only a metadata convention. Backfill legacy metadata markers into that field before recomputing outcomes, confidence, or hot status.

**Why:** A legacy EDGAR phone source existed only in metadata while the recomputation path read a missing/blank structured source, allowing a registry switchboard to appear as a personal route.

**How to apply:** Keep the nullable `phone_source` column aligned with the Drizzle schema and pass it through every Atlas, enrichment, maintenance, merge, and reachability recomputation or provider-prompt path.

Reachability prompts must use the same sanitized, source-aware direct-contact classification as persistence scoring. A registry phone may remain useful organization evidence, but it cannot produce `DIRECT` telemetry or a direct-access research contract.

**Why:** A target-scoped canary exposed that Atlas's provider prompt omitted `phoneSource` even though persistence scoring already excluded EDGAR/Companies House phones, causing the model to receive a false direct-access instruction.

**How to apply:** Treat `phoneSource` as required context at every `assessTargetReachability` call, especially AI/deep-web prompt construction; add a regression test whenever a new reachability caller is introduced.

Operational `isHot`, dashboard contactable counts, and the `direct` entity filter require `direct_contact_verified`; `direct_contact_candidate` is a separate review-only surface and organization routes never enter either metric.

**Why:** A full sanitation/backfill audit found stale hot flags and an API contract gap that could make review candidates or legacy organization outcomes look reachable even after active contact vectors were quarantined.

**How to apply:** Keep the backfill, startup maintenance, Atlas persistence, dashboard queries, API filters, generated OpenAPI/Zod schemas, and funnel UI aligned. Verify candidate queries separately and expect zero verified/hot/contactable rows until exact target-person attribution is present.