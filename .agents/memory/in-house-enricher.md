---
name: In-House OSINT Enricher
description: Replaces Hunter.io/Apollo with free in-house algorithms for email/LinkedIn discovery — file paths, strategies, and known behavior.
---

# In-House OSINT Enricher

**Why:** Hunter.io/Apollo are paid APIs. All enrichment must be self-contained and free.

**File:** `artifacts/api-server/src/lib/in-house-enricher.ts`

**Endpoint:** `POST /api/ingest/in-house-enrich` (in `artifacts/api-server/src/routes/ingest.ts`)

## Strategy stack (in order, stop on high-confidence hit)

1. **Wikidata SPARQL** (`https://query.wikidata.org/sparql`) — best for public figures; returns email/website/LinkedIn from structured data. Query by `rdfs:label` with `"@en"` filter.
2. **Wikipedia API** (`/api/rest_v1/page/summary/{name}`) — extract text scrape for email/LinkedIn.
3. **GitHub API** (`/search/users?q={name}+in:fullname`) — 60 req/hr unauthenticated; many founders/tech execs have public email in profile.
4. **ProPublica 990 Finder** (`/nonprofits/api/v2/search.json?q=`) — US nonprofit executive contacts.
5. **Email pattern gen + Gravatar MD5** — generates `first.last@domain`, `flast@domain`, etc. then checks `gravatar.com/avatar/{md5}?d=404`; 200 = confirmed.
6. **Domain resolver** — strips Inc/LLC/etc from company name → `.com` → DNS MX check via Node `dns.resolveMx`.
7. **RDAP** (`rdap.verisign.com` or IANA bootstrap) — registrant email for corporate domains.

## Known behavior
- Returns `OsintResult`-compatible shape: `{ email, linkedinUrl, phone, website, sources, emailConfidence }`
- `emailConfidence` scale: Gravatar-confirmed = 90, GitHub self-declared = 75, Wikidata = 85, Pattern+MX = 55, RDAP = 50, Wikipedia scrape = 40
- FAA entities are ALL-CAPS LAST FIRST — `normaliseName()` converts them before all lookups
- For HNWI/Gatekeeper: runs all individual-focused sources (Wikidata, GitHub, email patterns)
- For Corporation/Trust: runs ProPublica, domain guesser, RDAP; skips individual-only sources
- Sleep 150-400ms between requests — polite rate limiting
- All sources fail gracefully (try/catch) — never crashes the whole enrichment run

**BRREG integration (complete):** `queryBRREG(orgnr)` hits `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}` — free, no auth. Returns phone + website + address for Norwegian registered entities. Wired into Group 1 alongside other corporate sources. `orgnr` extracted from `entity.metadata`. `InHouseEnrichResult` now has an `address` field; ingest.ts persists it to `meta["bizLocation"]` and includes it in `hasSignal`.

**Why Gravatar works:** The MD5 check `gravatar.com/avatar/{hash}?d=404` returns 200 if a Gravatar exists for that exact email (lowercase). Many professionals have set up Gravatars via WordPress/GitHub/Atlassian. A 200 response is strong confirmation the email is real.
