---
name: Provider JSON transport
description: AI provider responses may wrap valid JSON as a string or HTML-escape punctuation before extraction.
---

The shared AI extractor must normalize provider transport wrappers before balanced JSON extraction: unwrap a JSON-encoded string and decode only the small set of common HTML entities. This is parsing recovery, not evidence promotion.

**Why:** Perplexity returned structurally valid research JSON without a code fence and with HTML entities; rejecting it discarded owner and provenance data even though the downstream adjudicator would still have failed closed on unsupported contact routes.

**How to apply:** Keep tolerant transport normalization immediately before `extractJsonObject`; preserve strict schema, provenance, identity, and contact adjudication after parsing. Add a helper regression whenever a provider response shape is observed live.