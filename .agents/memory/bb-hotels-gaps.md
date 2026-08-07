---
name: B&B Hotels enrichment gaps
description: Two confirmed bugs found during B&B Hotels case study — to fix next session
---

## Bug 1 — Corp→Person name extraction collapse

**Rule:** The Corp→Person hop in `web-enricher.ts` is collapsing multiple real executive names into a single garbage string like `"Hotels CEO"` instead of extracting individual person names.

**Why:** Perplexity's Phase 0 response returned 5 real owner names (Goldman Sachs, PAI Partners, etc.) but the Corp→Person extractor didn't resolve them into individual HNWI candidates with proper names. The `persons` array in the log showed `["Hotels CEO"]` — a single malformed entry.

**How to apply:** When fixing, look at the Corp→Person hop logic in `web-enricher.ts` (the section that fires after Phase 0 completes). The name normalisation / candidate extraction step is failing to split and clean the Perplexity owner list into individual person names. Compare against what Perplexity actually returned (5 owners, 8 citations) vs what was logged as `persons`.

---

## Bug 2 — Wrong corporate domain selected

**Rule:** When a brand's primary domain is a booking/consumer-facing site (e.g. `bbhotels.com`), the enricher must also try the corporate/IR domain variant (e.g. `hotel-bb.com`).

**Why:** B&B Hotels has two domains — `bbhotels.com` (booking site, returns `privacy.france@hotelbb.com`) and `hotel-bb.com` (corporate site, correct exec email pattern `firstname.lastname@hotel-bb.com`). The enricher only hit the booking domain and returned the wrong privacy inbox.

**How to apply:** In `findContactPages` / domain selection logic in `web-enricher.ts`, add a heuristic: if the primary domain appears to be a booking/consumer site (contains keywords like "book", "reservation", or is a `.com` redirect to a booking engine), also probe hyphenated and `hotel-` prefixed variants. Alternatively, let Perplexity's Phase 0 explicitly surface the corporate domain from citations — it already found `hotel-bb.com` in its sources but the domain guesser ignored it.
