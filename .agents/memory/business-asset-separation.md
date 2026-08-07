---
name: Business asset separation
description: Operating businesses are ledger assets distinct from personal luxury assets and require sourced entity evidence.
---

Business ownership should be represented as a separate `BusinessInterest` asset, not inferred from a person's other assets or from an uncertain name alone. Materialization must be idempotent, skip placeholders, require a visible confirmed corporation or strongly business-shaped sourced record, and preserve organization contacts as separate from personal/direct access.

**Why:** The Atlas runtime needed business assets counted without fabricating wealth or letting switchboards, registry records, or generic HNWI names inflate personal Access.

**How to apply:** Run the shared materializer during startup maintenance and after each completed Atlas target; filter hidden owners from public asset counts and keep personal aircraft, marine, property, and vehicle rows independent.