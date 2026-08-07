---
name: Domain guesser city-in-name bug
description: guessCompanyDomainWithCity generates wrong domains when entity name already contains city; fix and known scraping limits.
---

## Rule
When `guessCompanyDomainWithCity(name, city)` is called with an entity whose name **already contains the city** (e.g. "Baoli Cannes" + city "Cannes"), the city-suffix block must be skipped or it produces `baolicannescannes.com` in slots 0–2, pushing the correct `baolicannes.com` to slot 3 (only 4 slots allowed).

**Why:** The old check was `cityClean !== base` which only skips when the entire base equals the city. "baolicannes" ≠ "cannes" so it passed. The actual test needed is `!base.includes(cityClean)`.

**Fix applied:** `web-enricher.ts` — condition changed to `cityClean && cityClean !== base && !base.includes(cityClean)`.

**How to apply:** Any time you touch `guessCompanyDomainWithCity`, ensure the triple guard stays. If the entity name already encodes both brand and city (e.g. "Baoli Cannes", "Nobu London", "Zuma Dubai"), the city suffix variants are unhelpful noise.

## Known scraping limit: Avada/WordPress + Cloudflare
Sites built on Avada/WordPress with Cloudflare in front (common for luxury venues in France) serve a JS challenge or bot-detection page to server-side Node.js fetch even with rotating User-Agent. `curl` bypasses this due to timing differences. Symptom: `scrapePage` returns empty results despite the page containing emails/phones visible in curl output. AI extraction from search snippet text is more reliable for these sites than direct domain scraping.
