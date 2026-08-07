---
name: Enricher execution order
description: Correct order to run web-OSINT and in-house enricher; which can overwrite the other and when.
---

## Rule
**web-OSINT first, in-house enricher second.**

web-OSINT (`deepWebOsintEnrich`) is the primary data layer — multi-LLM AI pipeline (Perplexity, Gemini, Tavily, Exa, Groq) producing the highest-quality contact signals. In-house enricher (structured DB lookups: Wikidata, Wikipedia, GitHub, DNS, RDAP, etc.) is a supplementary fill layer.

## Why
In-house enricher has a fill-only-if-empty guard:
```typescript
if (result.email && !entity.email) updates["email"] = result.email;
if (result.linkedinUrl && !entity.linkedinUrl) updates["linkedinUrl"] = result.linkedinUrl;
if (result.phone && !entity.phone) updates["phone"] = result.phone;
```
So it will never overwrite data web-OSINT already wrote.

The dangerous direction is the reverse: web-OSINT with `force=true` **actively nulls** phone/linkedinUrl if it finds nothing:
```typescript
if (result.phone)       updates["phone"] = result.phone;
else if (force)         updates["phone"] = null;   // wipes in-house data
if (result.linkedinUrl) updates["linkedinUrl"] = result.linkedinUrl;
else if (force)         updates["linkedinUrl"] = null;
```

## How to apply
- Trigger order: `POST /api/ingest/web-osint-enrich` → then `POST /api/ingest/in-house-enrich`
- Never run `web-osint-enrich` with `force=true` after in-house enrichment has already populated fields unless you intend to wipe and re-derive everything from AI
- `contact_evidence` table rows are always additive from both layers (ON CONFLICT DO NOTHING) — evidence is never lost regardless of order
