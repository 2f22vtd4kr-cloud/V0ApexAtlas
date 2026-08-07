# FAA benchmark report — 2026-08-02

## Scope

This controlled benchmark measures research quality on less-famous, business-linked individuals rather than celebrity visibility. Targets were selected from real FAA individual turbine/multi-engine aircraft-owner records. Warren Buffett, trusts, companies, obvious wrappers, and malformed names were excluded.

- Source import: 5,000 FAA records, 0 errors
- Cohort size: 16
- No synthetic entities or contacts were added
- Auto-ingestion remained disabled

## Runs

| Run | Result |
|---|---|
| Pre-attribution fix | 16/16 enriched, 13 social-only, 1 direct-contact candidate, 2 no usable contact outcomes |
| Five-target regression | 5/5 enriched, 0 errors; organization-only and same-name social values were not promoted |
| **Authoritative post-fix rerun** | **16/16 enriched, 0 errors, 10 social-only, 0 direct-contact candidates, 6 no usable contact outcomes** |
| Three-target claim-source canary | 3/3 enriched, 0 errors; 0/3 verified direct routes; blocked lead-generation publishers remained review-only |

The post-fix result is authoritative because it applies the final fail-closed attribution and legacy-handle protections.

## Post-fix evidence and promotion

- 431 durable `contact_evidence` rows across the 16 targets
- Evidence scopes: 199 organization, 118 person-candidate, 98 target-person
- 6 HNWI social fields promoted from current-run attributed evidence
- No personal email or phone was promoted into the cohort
- Organization accounts, same-name/public-figure candidates, AI-only citations, and provider agreement without exact fetched claim URLs remained review-only
- Maigret/Sherlock were not allowed to use legacy entity handles as scan fallbacks
- The claim-source canary excluded lead-generation/directory publishers from direct-contact corroboration and exact-claim fetching. It improved provenance quality but produced no new verified route: Edmund O Noel had 15 current-run evidence rows, Robert M Davidson 12, and Jacob Eiting 5; all three remained at 0 verified direct routes.

## Quality interpretation

This is a correctness and provenance milestone, not a 9/10 access-quality result. The authoritative direct-contact yield remains 0/16; the controlled three-target follow-up also yielded 0/3. The remaining work is source coverage and exact claim retrieval, not weakening identity, attribution, corroboration, freshness, or manual-review gates.