---
name: Atlas target research handoff
description: Durable rules for the Atlas-to-UCT handoff and review-only research persistence.
---

Atlas single-target runs must call the shared target-research service rather than importing a route-only or nonexistent research function. The service persists the actual UCT path, steps, manual-review session, evidence rows, and audit stages; it must never generate outreach.

**Why:** A live Atlas run previously completed enrichment but failed at the Phase 10 handoff because it called a function that was not exported. Persisting empty path data also hid useful review evidence.

**How to apply:** Keep target research target-scoped, write the real `winningPath` and `mctsSteps`, retain disputed/review evidence, and keep `safeUseStatus=manual_review` with an empty generated pitch unless a separate approved workflow explicitly changes it.

MCTS explanations must use the same source-aware personal-contact adjudication as persistence and reachability. Raw email/phone presence is not enough to say “Contact VERIFIED” or “Direct outreach pathway open.”

**Why:** EDGAR and Companies House phones, shared inboxes, and other organization routes can coexist with HNWI rows and otherwise make UCT language overstate access even when final publication correctly rejects the route.

**How to apply:** Pass `phoneSource` and `contactOutcome` into graph vertices, use `hasMeaningfulDirectContact` in MCTS reasoning, and keep organization-only paths explicitly review-only.