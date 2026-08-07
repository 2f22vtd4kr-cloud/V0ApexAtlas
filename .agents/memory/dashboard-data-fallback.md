---
name: Dashboard data fallback
description: The imported workspace can have healthy Redis and API jobs while PostgreSQL-backed dashboard endpoints are unavailable.
---

The dashboard must distinguish unavailable database data from a genuinely empty dataset. Keep a visible, recoverable fallback when stats or lead queries fail, while still showing any independent live job/activity feed that remains healthy.

**Why:** The imported workspace verified Redis, web, and `/api/ingest/jobs`, but PostgreSQL-backed dashboard requests returned 500; indefinite skeletons made this look like a frontend loading bug.

**How to apply:** When validating or redesigning Intel HQ, test the stats, hot-leads, and jobs endpoints independently and preserve explicit partial-failure UI.