---
name: Discovery case-context shaft
description: Durable orchestration rule for discovery-first cases and their review handoff.
---

Discovery-first cases use one append-only shared context as the handoff boundary: each investigator reads the latest snapshot, appends a structured report, and only then does the next lane or reviewer run. Discovery is not case completion: after the opening pass, the Bureau must execute bounded Boss-directed verification and a closure review over the refreshed shaft. The final Gemini Boss review is authoritative; the NVIDIA lane is advisory and must remain separate, with provider gaps preserved rather than hidden.

**Why:** A single end-of-run merge allowed later prompts to miss earlier findings and could discard intermediate reports. Ordered checkpoints make the investigation auditable, keep uncertainty visible, and let the next rabbit-hole decision use the complete refreshed case.

**How to apply:** Preserve report order, current progress, open questions, candidate records, and separate right-hand/Boss decisions in the durable case file and append-only events. Continue through bounded verification until the Boss has reviewed the refreshed evidence; if a provider fails, retry only the missing review rather than repeating completed lanes. Keep all discovery candidates review-only until human promotion, and expose the lifecycle in the research UI.