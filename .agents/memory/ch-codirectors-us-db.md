---
name: CH co-directors returns zero for US-entity DB
description: CH co-director edge detection only works when UK Companies House entities are in the database
---

`POST /api/relationships/auto-detect-ch-codirectors` always returns 0 SHARED_DIRECTOR edges when the database contains primarily US-based entities (FAA aircraft registrations, SEC EDGAR shareholders).

**Why:** The endpoint queries Companies House (UK) to find shared directors between entities in the DB. FAA entities are US LLCs; EDGAR entities are US shareholders — neither has UK company registrations. CH officers enrichment will log "no CH match" for essentially every entity.

**How to apply:**
- Do not expect SHARED_DIRECTOR edges from the current FAA + EDGAR + HMLR dataset.
- CH co-directors only activates when UK-incorporated entities (via Companies House ingestion or GLEIF with UK registrations) are in the DB.
- The correct route is `POST /api/relationships/auto-detect-ch-codirectors` (not `/ch-codirectors` alone — that 404s).
- CORPORATE_SERIES edges from name-cluster detection are the primary relationship signal for the current dataset.
