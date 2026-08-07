---
name: Hunter/Apollo enrichment constraints
description: Apollo people/match requires paid plan; Hunter free tier exhausts at 25/mo; FAA entity names are ALL CAPS LAST FIRST
---

## Apollo API constraint
- `people/match` endpoint returns **403 API_INACCESSIBLE** on free plan
- Paid plan required (Apollo Basic ~$49/mo) for API access
- Enricher now logs a clear warn-level message on 403 instead of silently returning null
- Free plan marketing says "50 exports/mo" but this refers to CSV exports in the UI, not the API

## Hunter.io constraint
- Free tier: 25 email-finder searches/month — exhausted after one 200-entity batch
- Hunter Basic ($49/mo) gives 500 searches/month

## FAA entity name format
- Names are ALL CAPS LAST FIRST: "THIEL PETER", "KOENIG THEODORE L"
- `normalizeName()` in hunter-enricher.ts detects ALL CAPS and flips to Title Case First Last
- "THIEL PETER" → "Peter Thiel"; "KOENIG THEODORE L" → "Theodore L Koenig"
- Mixed-case names (e.g. "Chadwick John Huston") pass through unchanged

## Apollo organization_name pitfall
- Passing the person's own name as `organization_name` causes zero results
- Apollo interprets org_name as "find this person at a company with this name"
- Fix: only pass `orgName` when metadata contains a real company/employer field
- Extract from entity.metadata JSON keys: company, organization, employer

**Why:** Free API plan blocks people/match entirely; this explains all 0-match runs before the paid plan constraint was discovered.
**How to apply:** Recommend paid plans before running Hunter/Apollo enrichment. The enricher logic is correct — it will produce matches once a paid Apollo key is provided.
