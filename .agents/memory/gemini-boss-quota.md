---
name: Gemini Boss quota behavior
description: Distinguishes Gemini model-catalog availability from usable generation quota in discovery-first Boss runs.
---

The Gemini catalog can identify models that are not actually usable by the current project. Grounded Boss generation can receive HTTP 429, including on `gemini-3.6-flash`, while the same key can successfully perform ordinary text generation through `generateContent` without search tools or grounding metadata. The current grounded Interactions request uses `tools: [{ type: "google_search" }]`.

**Why:** Catalog access and generation quota are separate provider decisions; changing accounts did not change the provider response. The prior legacy generateContent path and old preview model were also stale relative to the current Google docs.

**How to apply:** Treat model-catalog results as candidates only, keep the selected model paired with the key that exposed it, use plain `generateContent` for text/reasoning when appropriate, use Interactions plus Search grounding only when that entitlement is available, preserve model-specific 429/404 failures, and distinguish ordinary text quota from Search-grounding access. If grounding is unavailable, continue independent discovery lanes.