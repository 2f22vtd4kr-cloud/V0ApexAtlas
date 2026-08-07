---
name: Dedup key inconsistency
description: The Upstash dedup set has a double-prefix bug that caused clearDedup() to delete the wrong key
---

## The bug

`DEDUP_KEY = "apex:dedup:hnwi"` in job-queue.ts.

- `batchMarkSeen` and `preloadDedupPrefix` both manually build `fullKey = "apex:" + DEDUP_KEY` = `"apex:apex:dedup:hnwi"` and call `rc.sadd`/`rc.sscan` on the raw Upstash client.
- The `perm*` helpers in redis.ts also prepend `"apex:"` via `PERM_PREFIX`. So `permScard(DEDUP_KEY)` reads from `"apex:apex:dedup:hnwi"` — consistent with batchMarkSeen.
- **Bug**: `clearDedup()` was calling `rc.del(DEDUP_KEY)` without the prefix → deleted `"apex:dedup:hnwi"` (empty), leaving `"apex:apex:dedup:hnwi"` (full) intact.

## Fix applied (job-queue.ts)

```typescript
export async function clearDedup(): Promise<void> {
  const rc = getPermanentClient();
  if (!rc) return;
  const FULL_KEY = `apex:${DEDUP_KEY}`;   // must match batchMarkSeen/preloadDedupPrefix
  await rc.del(FULL_KEY);
  logger.info({ key: FULL_KEY }, "Dedup set cleared");
}
```

**Why**: batchMarkSeen uses raw client calls with the manually-assembled key; the del must match that same key.

**How to apply**: If batchMarkSeen/preloadDedupPrefix change their key construction, clearDedup must be updated to match.

## Consequence of this bug before fix

After any `drizzle-kit push` that wiped the DB, the Upstash dedup set retained ~150k entries from the prior session. On cold-start, all ingestors would see every record as "already seen" and insert 0 records, leaving the DB permanently empty despite apparently-successful ingestion jobs.
