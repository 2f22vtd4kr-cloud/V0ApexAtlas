---
name: Contact research coordinator
description: Durable orchestration contract for direct-contact research
---

Direct-contact research is coordinated as one resumable job over HNWI and Gatekeeper targets only. It persists target IDs, cursor, phase, completed/failed IDs, and retry metadata; each target runs all registered personas before web OSINT and targeted Phase J. Corporation and Trust rows are intentionally excluded from the coordinator.

**Why:** Separate endpoint calls could be run out of order, overlap, or lose their place after an API restart. The coordinator makes the evidence pipeline explicit while preserving the existing fail-closed attribution gates.

**How to apply:** Start with `POST /api/ingest/contact-research` using `limit` or explicit `entityIds`, poll the job endpoint or coordinator status, and use `resumeJobId` for an incomplete job. Do not broaden selection to organization vehicles just to increase contact yield.