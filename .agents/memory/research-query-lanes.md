---
name: Research query lanes
description: Phase 0 provider calls share a compact target fingerprint while each provider searches a distinct evidence lane.
---

The Phase 0 research fan-out should use the same target fingerprint for every provider—legal/trading name, city/country, compact registry or identifier anchors, and candidate domains—while assigning distinct lanes for people/press, official records, contact routes, and semantic ownership discovery. Candidate domains and record anchors are disambiguation leads only; raw residence text should not be forwarded as a provider anchor.

**Why:** Generic parallel queries repeat the same broad search and amplify name collisions, while forwarding broad residence text adds unnecessary personal context. Shared compact anchors improve identity resolution without weakening evidence boundaries.

**How to apply:** Keep provider-specific query terms centralized in the AI extractor, pass lane/context from both canonical web-research callers, and preserve claim-level URLs plus server-side adjudication as the authority for promotion.