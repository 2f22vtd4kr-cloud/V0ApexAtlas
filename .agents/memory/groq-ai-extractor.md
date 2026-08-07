---
name: Groq AI Extractor
description: Groq llama-3.3-70b integrated as AI extraction phase in web OSINT pipeline; pure fetch, no SDK.
---

# Groq AI Extractor

## Rule
`ai-extractor.ts` in `artifacts/api-server/src/lib/` provides AI-powered extraction of contacts and owner names from accumulated web search text. It is the final pass in both `web-enricher.ts` (Phase 7) and `deep-web-osint.ts` (Phase 3.5) — runs after all regex passes, feeds results back into the hits maps for cross-corroboration scoring.

**Why:** Regex missed emails in obfuscated/sentence form, international phones, inline social mentions, and owner names from press snippets. Gemini key had all models returning quota errors. Groq llama-3.3-70b is free (6k req/day), no prepayment, OpenAI-compatible REST API.

## How to apply
- Secret: `GROQ_API_KEY` — Replit Secret, confirmed working 2026-07-25
- Primary model: `llama-3.3-70b-versatile`; fallback: `llama-3.1-8b-instant` on 429
- Uses plain `fetch` to `https://api.groq.com/openai/v1/chat/completions` — no SDK, no extra package, no esbuild external needed
- Response format: `json_object`; temperature 0; max_tokens 400
- Input text capped at 6 000 chars; returns null fields gracefully if key missing or error
- Owner names returned as `owners[]` — review-only, never auto-merged into entities

## Integration points
- `web-enricher.ts` `deepWebOsintEnrich`: Phase 7 (was Phase 7 for picking values, now Phase 8) — runs over `allSearchText` accumulated across Phases 1–6
- `deep-web-osint.ts` `deepWebOsintEnrich`: Phase 3.5 — `allSearchText` accumulation added to DDG and Bing phases; AI pass runs before Phase 4 (value picking)
