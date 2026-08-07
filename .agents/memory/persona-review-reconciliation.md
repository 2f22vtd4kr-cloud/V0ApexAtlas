---
name: Persona review reconciliation
description: How to interpret repeated deterministic persona sweeps and stale improvement findings
---

The persona sweep is not an acceptance signal by itself: `0 new suggestions` only means duplicate suppression found no new titles. Current pending findings must be inspected separately, and historical findings resolved by later state changes must be dismissed while retaining their audit rows.

**Why:** A Corporation/Trust contact-state invariant was fixed and backfilled, but older pending operator findings continued to make the persona review look blocked even though the current entity state was fail-closed. Treating the job completion message as satisfaction would have hidden that discrepancy.

**How to apply:** After each substantial persona or data-state change, run a settled sweep, query pending findings by priority, inspect high-priority rows, and distinguish current actionable evidence gaps from stale findings and dataset limitations. For an all-Corporation/Trust dataset, do not manufacture personal-target findings to make the ledger non-empty. Never delete resolved findings merely to lower the count.