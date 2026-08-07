---
name: Dual-path contact adjudication
description: Both canonical and secondary deep-web enrichment must reconcile providers through the same fail-closed adjudicator and retain rejected candidates.
---

Provider consensus is discovery evidence, not proof. The canonical web enricher and the secondary deep-web OSINT path must both run the same adjudication pass, which may select only a value already supplied by a provider. Every candidate, including blocked directories, organization-only socials, malformed values, and failed attribution, must remain visible with an explicit rejected state and reason.

**Why:** A secondary path that only grouped providers could silently produce different promotion behavior, while filtering rejected values before persistence made discovered-contact metrics undercount the actual evidence.

**How to apply:** When adding or changing an enrichment path, wire it through the shared ensemble/adjudication helpers, persist candidate funnel metadata and rejection reasons, and keep exact fetched-page verification separate from provider agreement.