---
name: Research quota safety
description: Provider and pipeline safeguards for controlled, one-target-at-a-time research.
---

Gemini research uses the lower-credit Flash-Lite model, rotates across configured keys, and caps output tokens. Groq, Gemini, Tavily, and Exa calls start from shared per-provider round-robin cursors so parallel calls do not repeatedly hit slot zero. Full web research is serialized across entry points; Atlas entity processing is also single-target.

Provider key presence and provider quota are separate facts: multiple configured keys can still receive 429 responses during a provider/project cooldown, so UI status must say rate-limited/rotating rather than implying the secrets are missing or invalid. The project uses several quota-limited public research providers, and concurrent target work can create avoidable bursts and 429 responses.

**Why:** The newly added numbered Groq and Gemini pools were all discovered by the running API, but a burst of 429 responses temporarily marked every slot in the in-memory cooldown map. The Reactor warning incorrectly described those configured keys as exhausted.

**How to apply:** Keep automatic pipeline startup disabled for imports and only enable broader work deliberately. Preserve one-target sequencing even if individual provider calls remain parallel within that target. Treat a key as configured independently from its temporary rate-limit state; keep rotating numbered slots and expose the configured count in status UI.