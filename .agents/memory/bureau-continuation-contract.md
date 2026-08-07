---
name: Bureau continuation contract
description: Durable client/server behavior for asynchronous Bureau discovery continuation and review actions.
---

Bureau continuation actions are asynchronous job starts. Their successful 202 response contains job and polling metadata, not the updated case file. A client must refetch the case after accepting the job, and must surface the job state separately if it needs progress feedback.

**Why:** Treating a job-start envelope as a case object leaves the UI with stale or malformed state and makes the API contract ambiguous.

**How to apply:** Keep the shared positive case-ID path schema and job envelope in OpenAPI/Zod/client code. Validate the envelope at the server boundary, use generated mutation helpers in clients, and refetch the case after the mutation succeeds.