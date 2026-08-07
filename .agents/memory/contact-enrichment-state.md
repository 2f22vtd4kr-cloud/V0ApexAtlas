---
name: Contact enrichment state
description: Distinguishes public evidence from actual contactability during repeated enrichment passes.
---

Website, registered-address, and similar evidence must not mark an entity as fully enriched. Only a public contact vector (email, phone, LinkedIn, or a persisted social handle) should clear `needsEnrichment` and set the terminal enricher version; evidence-only results remain eligible for later contact discovery.

**Why:** The in-house enricher originally treated any website/address result as completion, which suppressed later attempts to find higher-value contact vectors and made contactability look better than it was.

**How to apply:** Preserve website/address evidence in metadata and entity fields, but keep the entity eligible for another enrichment module or scheduled pass until a validated contact vector is found.