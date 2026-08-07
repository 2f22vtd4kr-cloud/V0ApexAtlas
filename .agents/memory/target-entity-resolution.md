---
name: Target entity resolution
description: Brand-level research targets need explicit disambiguation before contact evidence or outreach is trusted
---

**Rule:** When a target is a brand or shared name rather than a unique legal entity, keep organization evidence, ownership evidence, person candidates, and contact vectors separate until the exact entity is resolved.

**Why:** A single Orient Express run found authoritative Accor-related ownership/officer evidence but also pulled an India-based same-name directory entry. The enrichment score and Atlas pitch could otherwise make unrelated contact data look actionable.

**How to apply:** Preserve source URLs and review-only statuses, treat same-name directory contacts as collision candidates, and do not generate actionable outreach or high-confidence graph paths from an isolated target without corroborating relationships.