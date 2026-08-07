---
name: Upstash quota slot failover
description: When an Upstash slot hits its monthly request cap it stays TCP-connected ("ready") but throws ERR max requests limit exceeded on every command. getPermanentClient() must skip those slots, not return them.
---

# Upstash Quota Slot Failover Rule

## The Rule
When an Upstash Redis slot (REDIS_URL_1, REDIS_URL_2, …) hits its monthly request quota it stays TCP-connected — `status === "ready"` — but throws `ERR max requests limit exceeded` on every command. **Never treat a quota-exhausted slot as healthy.** Always fall through to the next slot.

**Why:** `getPermanentClient()` originally picked the first slot with `status === "ready"`, which would always return the exhausted slot 1, making every job lock/dedup/contact-cache write silently fail or throw.

## The Fix (already in code as of 2026-07-25)
`redis.ts` now:
1. Passes a `slotIndex` to each `buildClient()` call.
2. In the `error` handler, detects `max requests limit exceeded` → adds the slot index to `_quotaExhaustedSlots: Set<number>`.
3. `getPermanentClient()` skips any slot in `_quotaExhaustedSlots`.
4. `getAllPermanentClients()` and `getContactCacheClient()` do the same.
5. Exported `isSlotQuotaExhausted(slot: number)` for diagnostics.

## How to Apply
- On every import, check startup logs for `Quota exhausted — slot marked as unavailable` warnings.
- If all 5 Upstash slots are exhausted → ask the user to provide a new Upstash URL → add it as `REDIS_URL_6` (or next available) → restart API server → it auto-connects.
- Do NOT try to clear job locks via the API when slot 1 is exhausted — the lock simply won't exist in slot 2+ yet, so the new job will start cleanly after the failover fix is in place.
- Job locks (`apex:activejob:<type>`) are written to whichever slot `getPermanentClient()` returns at the time. After a failover, old locks in the exhausted slot are effectively invisible — the next healthy slot has no lock → jobs can start immediately.

## Slot Layout (as of 2026-07-25)
- Slot 1 (REDIS_URL_1): Dedup sets + job state — quota-exhausted as of 2026-07-25
- Slot 2 (REDIS_URL_2): Contact cache (preferred for contact writes)
- Slots 3–5 (REDIS_URL_3–5): Overflow / dedup shards
