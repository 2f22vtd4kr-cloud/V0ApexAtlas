---
name: Public contact evidence validation
description: Rules for preventing search-engine diagnostics and placeholder addresses from becoming durable contact vectors.
---

Public contact extraction must use one shared validator before PostgreSQL writes, Redis mirroring, and Redis-to-PostgreSQL restore. Search-engine diagnostics such as `error-lite@duckduckgo.com`, placeholders, privacy relays, and no-reply addresses are not contact vectors.

**Why:** A narrower extractor blocklist allowed a DuckDuckGo diagnostic address to inflate contactability and survive through the permanent cache across restarts.

**How to apply:** Keep validation at both extraction and persistence/restore boundaries, and recompute contact confidence after removing an invalid email while preserving valid phone, LinkedIn, or other evidence.