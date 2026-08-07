---
name: FAA benchmark and attribution hardening
description: Controlled FAA benchmark results and the fail-closed social attribution rules for future research-quality work
---

The valid benchmark is a controlled cohort of 16 less-famous, business-linked FAA aircraft owners, not a celebrity such as Warren Buffett. The pre-fix run completed 16/16 with 0 errors at 13 social-only / 1 direct-contact candidate / 2 no usable contact outcomes. The authoritative fail-closed post-fix rerun completed 16/16 with 0 errors at 10 social-only / 0 direct-contact candidates / 6 no usable contact outcomes, with 431 durable evidence rows and 6 promoted social fields.

**Why:** Celebrity benchmarks make public reachability look artificially strong. The FAA cohort measures the real problem: identity and access for wealthy but less-famous individuals.

**How to apply:** Keep organization accounts, same-name/public-figure candidates, AI-only citations, and provider agreement without exact canonical claim URLs in durable review evidence only. HNWI social promotion and Maigret/Sherlock pivots require a current-run candidate with target-person attribution and an exact fetched claim URL; never fall back to legacy entity handles. Treat the post-fix 0/16 direct-contact yield as a measured limitation, not a reason to inflate scoring.

The enricher now makes a bounded exact-claim fetch pass over the strongest person-level discovery URLs before final promotion. The canary produced no new verified route, which is useful evidence that the current citation sources are inaccessible, non-claim pages, or insufficiently attributable rather than proof that the gates should be relaxed.

The claim-source pass now carries all owner-resolution source URLs into the candidate details and excludes lead-generation/directory publishers from direct-contact corroboration and exact-claim fetching. A controlled three-target canary completed 3/3 with 0 errors and 0/3 verified direct routes; the change improved provenance quality without increasing yield.

**Why:** Provider discovery frequently returns directory, aggregator, profile, or blocked pages that mention a candidate without exposing the exact contact value on a fetchable canonical page.

**How to apply:** Keep this pass bounded and opportunistic. Exclude known lead-generation/directory domains from direct-contact corroboration, and leave failed or non-matching fetches in review; expand lawful source coverage instead of promoting from snippets or provider agreement.