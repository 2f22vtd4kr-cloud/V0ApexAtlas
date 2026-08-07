---
name: Mistral Bureau web-search lane
description: Mistral's built-in web search belongs on the Conversations/Agents API, not Chat Completions.
---

The investigatory bureau treats Mistral web search as an explicit, review-only discovery lane. It uses the Conversations API built-in `web_search` tool, keeps candidates and citations unpromoted until human review, and enforces a one-request-per-second process-wide guard to respect the Experiment-tier throttle.

**Why:** Mistral's built-in web search returns source references through Conversations/Agents, while Chat Completions does not support the search tool or its references.

**How to apply:** Keep Mistral separate from the existing Gemini Boss and Hugging Face/Serper lanes. Do not invoke it during setup or health checks; only call it from an explicitly started Bureau discovery run.