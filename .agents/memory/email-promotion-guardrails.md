---
name: Email promotion guardrails
description: Three guards that prevent wrong company/aggregator emails being promoted as personal contact data in web-enricher.ts
---

# Email Promotion Guardrails (web-enricher.ts)

## The bug (fixed)
`deepWebOsintEnrich` email promotion logic had: `const domainMatchesEntity = entityDomainTokens.size === 0 || ...` — when the entity's domain is unknown (size=0), ALL emails passed through. This caused `info@stocktitan.net`, `mike@sonomawestholdings.com` etc. to be assigned as personal contacts.

## The fix (three guards in `deepWebOsintEnrich`, ~line 2577)
1. **Generic prefix rejection** — `isGenericEmailPrefix(emailLocal)` → skip. Catches `info@`, `contact@`, `sales@` etc.
2. **Financial aggregator blocklist** — `FINANCIAL_AGGREGATOR_DOMAINS.has(emailDomain)` → skip. Defined at top of `web-enricher.ts`. Includes stocktitan.net, seekingalpha.com, crunchbase.com, pitchbook.com, 20+ others.
3. **Unknown-domain corroboration threshold** — when `entityDomainTokens.size === 0`, require `srcs.length >= 2` (two independent sources must agree on the same email). Single-source emails with unknown entity domain stay in evidence, never promoted.

**Why:** Evidence and primary contact data are separate concerns. The enricher scrapes many third-party pages; a single citation from a news wire or aggregator must not overwrite the entity's contact field.

**How to apply:** All three guards live in the `for (const [email, srcs] of emailHits.entries())` loop in `deepWebOsintEnrich`. `FINANCIAL_AGGREGATOR_DOMAINS` is defined near the top of `web-enricher.ts` alongside the `isGenericEmailPrefix` import from `contact-validation.ts`.
