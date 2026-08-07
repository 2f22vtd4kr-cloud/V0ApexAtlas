---
name: Cold-start auto-recovery
description: startup.ts runs on every API server boot to clear ghost jobs and auto-start ingestion when DB is empty
---

## What it does (artifacts/api-server/src/lib/startup.ts)

Runs automatically after Upstash connects (via index.ts → connectPermanentRedis().then(() => coldStartRecovery())).

1. **Ghost job cleanup**: Iterates over all ingestor types, finds any active job with status "running", marks it "failed" with "Process was killed" message, and calls clearActiveJob(). This ensures ingest buttons don't show 409 "already running" after a process restart.

2. **Stale dedup detection**: If entityCount === 0 AND dedupCount > 0, the dedup set is stale from a prior session that got wiped. Clears dedup automatically.

3. **Auto-ingestion**: If entityCount === 0, starts FAA + LR + Western HNWI in background.

## Edge case: partial DB state

If DB has some entities (e.g. HNWI ran before a restart) but FAA/LR dedup are stale (from before a DB wipe), startup.ts skips auto-ingestion. Manual workaround:
- `DELETE /api/ingest/dedup` to clear the full set
- Then force-restart FAA and LR: `POST /api/ingest/faa {"force":true}`, `POST /api/ingest/land-registry {"force":true}`

## Ingestor types covered

`["faa", "land-registry", "western-hnwi", "companies-house-enrich", "occrp", "opensky"]`

**Why**: All six use fire-and-forget async functions that die when the Node process is killed, but their job state persists in Upstash. Without this cleanup, the active job lock prevents new jobs from starting (409 error).
