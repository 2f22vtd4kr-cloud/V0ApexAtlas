---
name: Invalid entity quarantine
description: Durable rules for handling role-shaped and placeholder entity records without losing provenance
---

Invalid role-shaped and placeholder entity records must be quarantined rather than deleted. Quarantine hides the row from active targets and clears every promoted contact field, contact outcome, confidence, and hot flag. The original contact values and metadata-level claims belong under a review-only quarantine evidence object.

**Why:** Legacy imports can bypass newer discovery gates, and a hidden row with stale direct-contact state can still mislead reviewers or be rehydrated by Redis startup restoration.

**How to apply:** Run quarantine maintenance idempotently during populated-database startup, preserve an existing quarantine evidence snapshot instead of overwriting it with already-cleared fields, and never restore Redis contacts into hidden rows.