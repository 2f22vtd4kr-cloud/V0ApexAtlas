---
name: Profile UX fixes — session 2026-07-28
description: What was fixed on the HNWI profile page and reactor in this session; patterns to keep consistent.
---

# Profile UX — fixed patterns

## What changed
1. **Evidence wording** — `extractionMethod` values matching `/guess|pattern|domain.gues/i` are now hidden from the UI in both the primary evidence badge (profile.tsx ~line 1108) and the contact evidence audit panel (~line 1279). The email fallback step text no longer surfaces domain-guesser as the method name.
2. **Profile bottom buttons** — Desktop header: removed the "Connect" (Add Relationship) button; "Re-run" renamed to "Rerun Research". Mobile action bar: Research link + CRM link replaced with a single "Rerun Research" button (calls `handleEnrich`); Graph icon kept.
3. **Graph navigation** — already correct before this session: graph URL passes `?entity=id`, back button returns to `/profile/:id`.

**Why:** User rule — guessed/pattern-derived contacts must never be labelled as such in the UI. Buttons simplified to one action per surface (rerun research + graph only).

## Patterns to preserve
- Never render `extractionMethod` if it matches `/guess|pattern|domain.gues/i` — apply this filter anywhere evidence is displayed.
- Profile mobile bar = Rerun Research + Graph only. No CRM, no Research link, no Connect.
- Desktop header = Graph link + Rerun Research button only.
- `handleEnrich()` at `POST /api/ingest/web-osint-enrich` with `{ entityIds:[id], batchSize:1, force:true }` is the canonical "rerun research for this entity" action.
