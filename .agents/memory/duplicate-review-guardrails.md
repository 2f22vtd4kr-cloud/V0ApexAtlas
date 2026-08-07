---
name: Duplicate review guardrails
description: Safety rules for name-token duplicate detection and same-source review
---

# Duplicate review guardrails

Name-token candidate generators must deduplicate tokens per entity before building pair scores, otherwise repeated words inside one name can produce self-pairs. Same-source exact-name matches are review signals, not automatic identity proof.

**Why:** The live duplicate surface exposed self-pairs from repeated words in registry names, and same-source records can represent multiple assets or registrations for one person.

**How to apply:** Keep same-source clustering read-only and registry-scoped; preserve manual merge/dismiss controls and exclude any entity from pairing with itself.