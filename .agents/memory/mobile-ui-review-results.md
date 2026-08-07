---
name: Mobile web UI review (390x844 viewport)
description: Full mobile review across all pages at iPhone viewport; two 404s found due to wrong test paths (not real bugs)
---

## Pages reviewed at 390×844 (iPhone)

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Dashboard | / | ✅ OK | 32,300 entities, live signals, real data |
| Entities (Ledger) | /entities | ✅ OK | Search, type filter tabs, entity list |
| Deep Search | /deep-search | ✅ OK | NL query, preset chips, empty state correct |
| Network Graph | /graph | ⚠️ OK* | "Entity #1" in dropdown — known loading race (name fills in once allEntities resolves) |
| Intel Terminal | /research | ✅ OK | Target selector, pipeline info, awaiting state |
| Pipeline CRM | /crm | ✅ OK | Empty state, "Run Intel Analysis" CTA |
| Persona Loop | /improvements | ✅ OK | Empty state, "Run First Loop" CTA |
| Data Sources | /data-sources | ✅ OK | Phase 9 Hunter/Apollo card renders correctly |
| Profile | /profile/1 | ✅ OK | Map, asset footprint, contact vectors |
| Field Manual | /manual | ✅ OK | Tab navigation, readable content |

## 404 false alarms (wrong paths used in initial testing)
- /intel → correct path is **/research**
- /ledger → correct path is **/entities**
Both are fine; the sidebar nav links use the correct routes.

**Why:** The routes use non-obvious slugs (research ≠ intel-terminal, entities ≠ ledger). The router.tsx is the source of truth.
