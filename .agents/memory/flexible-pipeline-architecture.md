---
name: Flexible enrichment pipeline architecture
description: The correct enrichment order and the principle that any phase can re-fire when new signals are found.
---

# Flexible Enrichment Pipeline Architecture (permanent rule)

## The rule
The enrichment pipeline is NOT a strict one-way sequence. Any phase can be re-triggered when new signals unlock new search angles.

**Why:** Treating it as a strict pipeline (Phase 0 → done) meant web-OSINT was only ever called once, Maigret was never wired in, and the full intelligence potential of the tool stack was never used.

## Correct enrichment order

1. **Web-OSINT FIRST** (`POST /api/ingest/web-osint-enrich`) — primary AI layer:
   - Perplexity, Gemini, Tavily, Exa in parallel (Phase 0)
   - Groq extracts structure from Tavily/Exa results
   - This is the highest-signal step; always run it first.

2. **Maigret + Holehe AUTOMATICALLY** (wired inside web-osint-enrich job):
   - After deepWebOsintEnrich, if a twitter/instagram handle was found → Maigret scans 3,000+ platforms
   - If email was found → Holehe checks platform presence (runs in parallel with Maigret)
   - Results saved to `contact_evidence` table (vectorType: "social", source: "maigret"/"holehe")
   - If Maigret finds 3+ platforms and no email yet → **web-OSINT re-fires** with Maigret platform list as extra context

3. **In-house SECOND** (`POST /api/ingest/in-house-enrich`) — fills gaps:
   - Wikidata, Wikipedia, GitHub, EDGAR filing data, RDAP, DNS, Whoxy
   - Fill-only-if-empty guards: won't overwrite web-OSINT results
   - Run AFTER web-OSINT, not before

## Key implementation points
- `ingest-enrichment.ts` `web-osint-enrich` route: runs `deepWebOsintEnrich` → then `runMaigret` + `runHolehe` in parallel → then `deepWebOsintEnrich` again if Maigret found 3+ platforms
- `entity` select includes `notes` and `email` fields for Maigret context passing
- `runMaigret` and `runHolehe` imported from `../lib/python-tools`
- Maigret node in reactor.tsx: id:"maigret", cx:1460, cy:298, JOB_NODE_MAP["web-osint-enrich"] includes "maigret"

## How to apply
Never design research flows as one-pass linear sequences. If a new signal appears at any stage (new handle, new email, new domain), re-trigger the appropriate earlier phase with that signal as input.
