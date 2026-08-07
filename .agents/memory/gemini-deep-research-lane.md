---
name: Gemini Deep Research lane
description: Durable boundary for the asynchronous Gemini Deep Research integration and its dedicated quota pool
---

## Rule

Gemini Deep Research is a bounded, target-scoped provider lane inside canonical web OSINT, separate from high-volume Gemini Flash-Lite work. It uses only dedicated key slots 11–13, runs asynchronously, and must never directly promote identity, ownership, access, contacts, or outreach state.

**Why:** Deep Research is expensive and asynchronous, while Apex Atlas must remain evidence-led and fail closed. Embedding it in the normal fan-out gives discovery/enrichment one cooperating research surface without allowing a free-form report to become authoritative evidence or stall a target.

**How to apply:** Keep it target-scoped and independently fail-soft with a short timeout. Persist report/citation metadata as review-only, send citations through ordinary exact-page validation, never append report text to contact extraction, expose its key pool separately in status health, and retain the standalone route only as compatibility.