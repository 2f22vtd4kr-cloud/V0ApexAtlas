---
name: Contact discovery roadmap
description: Durable roadmap principles for improving public-contact enrichment across future re-imports.
---

Phase J in `improvements.md` is the source of truth for the multi-re-import contact discovery roadmap.

**Rule:** Optimize for validated, attributable public direct contacts, not an unqualified contactable percentage. Keep evidence-only, social-only, organization-contact, candidate, and verified-direct outcomes separate.

**Why:** The observed yield is approximately 2.5% at best, and the existing pipeline finds more registry, website, and social evidence than it converts into validated direct contact. Source expansion without funnel measurement risks increasing false attribution.

**How to apply:** Implement Phase J in gated milestones: measurement and non-terminal social state first; then registry coverage, identity and domain resolution, lawful public-footprint discovery, candidate validation, budgeted multi-pass retries, graph-assisted discovery, and re-import checkpoints. Keep lawful discovery broad during private development. Use `productionReviewStatus` only as a non-blocking internal label (`review_required`, `reviewed_for_production`, or `not_yet_assessed`); defer runtime source allowlists, capacity limits, retention rules, and public-facing safeguards to separate pre-production hardening.