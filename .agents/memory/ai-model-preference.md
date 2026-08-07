---
name: AI model preference
description: User prefers built-in agent (Fable 5 High effort) over external AI APIs for all AI features
---

## Rule
Do NOT use external AI API integrations (Anthropic, OpenAI, OpenRouter) for AI features in this project. Implement all AI logic (pitch generation, scoring, path analysis) directly in server-side TypeScript code.

**Why:** User explicitly stated they prefer using the built-in Replit agent ("Fable 5 in High effort mode") over external AI APIs. They also declined the Replit AI Integrations upgrade required for Anthropic access.

**How to apply:** For pitch generation and other non-research product features, keep the logic server-side and data-driven without external AI calls. For the explicitly requested Gemini research/Boss lane, when keys are provided inspect the available model catalog and choose the cheapest suitable Flash/Flash-Lite model dynamically rather than pinning a version.
