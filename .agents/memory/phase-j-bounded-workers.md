---
name: Phase J bounded workers
description: Timeout and restart-recovery rules for the Phase J contact-research worker
---

Phase J must bound every target-scoped external or review stage and include `phase-j-pass` in startup ghost-job recovery. A process restart can kill the async worker while leaving its Redis lock and queued/running job metadata behind; without both safeguards, later contact passes can be blocked indefinitely.

**Why:** A real contact pass stalled on one target for more than 30 minutes while the API and Redis remained healthy. The persisted active lock survived the first restart because Phase J was missing from the recovery type list.

**How to apply:** Keep target-level timeouts around domain resolution, in-house enrichment, digital-footprint discovery, and persona review. When adding a new long-running worker type, add it to the startup recovery list and verify that an interrupted job becomes failed and its lock is cleared after restart.