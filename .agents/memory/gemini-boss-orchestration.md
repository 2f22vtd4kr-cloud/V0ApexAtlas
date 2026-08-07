---
name: Gemini Boss orchestration
description: Durable provider hierarchy and safety boundary for target-case planning.
---

Gemini is the authoritative Head Investigator for Bureau case planning, using plain text generation without web-search grounding. GLM-5.2 is advisory only: it receives the case file, may recommend an existing action, and cannot activate or replace Gemini's decision.

**Why:** Gemini Search grounding previously encountered project/free-tier quota errors, while ordinary text generation was available. Separating planning from evidence gathering also keeps model-generated claims from being treated as discovered facts.

**How to apply:** Pass the serialized case file and GLM note to Gemini as plain text only, require selection of an existing queued action plus bounded tools, evidence requirements, source/uncertainty restrictions, and investigator instructions. On transient Gemini 503/429 availability errors, try the next lower compatible catalog model before falling back to the deterministic local planner. Never attach search tools or invoke Gemini Deep Research; keep web, registry, Sherlock, Maigret, Holehe, and similar tools in investigator lanes.