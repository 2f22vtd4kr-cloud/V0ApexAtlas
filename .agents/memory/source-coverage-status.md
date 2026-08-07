---
name: Source coverage status
description: Preserve the distinction between successful research lanes, blocked pages, unavailable providers, and negative findings.
---

Research coverage is evidence metadata, not a success boolean. Each provider lane must retain its own status, while blocked anti-bot pages and unavailable HTTP/fetch failures remain explicit source gaps. Negative findings must be stored separately from search gaps.

**Why:** Treating an inaccessible official page or failed provider as an empty successful search makes an evidence-only investigation look more complete than it was and can incorrectly mark downstream stages complete.

**How to apply:** Carry lane status, negative findings, and search gaps through the enrichment result, research plan, entity metadata, and research-session response. Use `review`, `blocked`, or `unavailable` stage states instead of claiming completion when coverage is incomplete.