---
name: Run-isolated evidence snapshots
description: Current research scorecards must use the latest enrichment run while preserving historical contact evidence for audit.
---

Each targeted web-OSINT pass gets an enrichment run ID. Evidence rows are tagged with that run, duplicate upserts refresh the complete row rather than only changing the run ID, and research scoring filters to the entity's active run.

**Why:** Repeated canaries exposed stale verified rows contaminating later fail-closed scorecards; audit history must remain durable without allowing superseded evidence to influence current reachability.

**How to apply:** When adding another enrichment writer or scorecard input, propagate the run ID, refresh all evidence fields on conflict, and score only the active snapshot. Keep organization-only vectors auditable but out of personal contact/access metrics.