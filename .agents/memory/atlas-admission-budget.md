---
name: Atlas admission budget
description: Discovery-first targetCount must bound the entire run, not each source round
---

In discovery-first Atlas runs, `targetCount` is a run-wide admission budget. Broad and registry adapters must receive the remaining budget, and the discovery loop must stop when that budget is exhausted.

**Why:** A per-source interpretation of `targetCount: 1` admitted one new entity per registry/source round, causing a supposedly single-target research run to fan out across multiple targets and spend provider quota unexpectedly.

**How to apply:** Keep discovery source rounds sequential, fully process each admitted target before the next round, and report both source rounds and `admitted X/Y` in the final summary. Existing rows inspected during Phase 0 do not count as new discovery admissions.