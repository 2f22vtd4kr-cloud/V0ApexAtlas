---
name: NVIDIA NIM Bureau reasoning
description: The NVIDIA GLM lane is a bounded planner over Bureau cases, separate from every web-search provider.
---

The Bureau's NVIDIA NIM lane is the Boss's right-hand case-file advisor, not the Head Investigator and not a research or browsing provider. It receives either a serialized target case file and queued actions or a discovery mission/opening brief, then may recommend bounded framing or one existing queued action. It must not search, invent evidence, create actions, promote contacts, resolve identity, or generate outreach.

**Why:** NVIDIA's reviewed GLM endpoint supports chat completions but does not expose the web-search contract used by the Bureau's discovery lanes. Keeping the lane reasoning-only prevents accidental provider crossover and preserves human review.

**How to apply:** Keep `z-ai/glm-5.2` behind `NVIDIA_NIM_API_KEY`; preserve the Boss's deterministic local planner as the final fallback and authority for missing keys, request failures, timeouts, malformed output, or any disagreement with the advisor. Persist the right-hand recommendation separately from the Boss decision in the case file and append-only case event log, while reporting the lane separately from open-research readiness. Discovery should preserve a GLM provider gap explicitly and continue safely if the advisory exceeds its request budget.