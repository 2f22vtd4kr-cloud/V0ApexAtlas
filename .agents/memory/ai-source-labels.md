---
name: AI source labels
description: Correct source identifiers for Tavily and Exa results, and Gemini's correct role in the reactor diagram.
---

## The rule

Tavily and Exa source values are `"tavily"` and `"exa"` — **not** `"tavily-groq"` / `"exa-groq"`.

Evidence source strings: `"ai-tavily"`, `"ai-exa"`, `"ai-tavily-followup"`, `"ai-exa-followup"`.

Groq is an *internal* extraction detail for Tavily/Exa — it must not appear in user-facing source labels.

**Why:** The user sees evidence source labels in the profile page evidence panel. "Tavily[groq]" implies Groq is the search source; "Tavily" correctly attributes the result to Tavily. Groq is an implementation detail.

**How to apply:** Any new source check using Tavily/Exa results must compare against `"tavily"` / `"exa"`. Any new evidence `recordEvidence` call from Tavily/Exa must use `"ai-tavily"` / `"ai-exa"` as the source string.

---

## Gemini in the reactor diagram

Gemini (`id:"gemini"` in `reactor.tsx`) is `type:"ai-cyan"` with `color:"#22d3ee"` — same as Perplexity, Exa, Tavily.

**Why:** Gemini fires at Phase 0 as a parallel *search source* (Google Search grounding), not as an extraction layer. Making it `"ai-lime"` (Groq's colour) implied it was a post-processing extraction step.

**How to apply:** Do not change Gemini's node type to `"ai-lime"`. The `groq→gemini` edge does not exist — Gemini fires before Groq, in parallel with Perplexity/Exa/Tavily.

---

## Phase 0 parallel architecture (summary)

```
Phase 0 (all fire in Promise.all):
  Perplexity  → structured JSON directly          source: "perplexity-sonar"
  Gemini      → structured JSON directly          source: "gemini-flash"
  Tavily      → raw excerpts → Groq extracts      source: "tavily"
  Exa         → raw excerpts → Groq extracts      source: "exa"

Phase 7/3.5:
  Groq        → reads accumulated scrape text     source: "groq-llama-70b"
```
