---
name: FAA dedup batching
description: How to avoid Upstash per-record latency killing FAA ingestion throughput
---

## The Rule
Never call `isDuplicate()` / `markSeen()` (which are individual Upstash round-trips) inside the per-record FAA parse loop. Use `preloadDedupPrefix("faa:")` once at start, check/update an in-memory `Set<string>`, then call `batchMarkSeen(pendingDedup)` once per flush.

**Why:** At ~75ms/call × 865 matching records per 5,000 lines = ~65s per 5k lines. The job appeared to be stuck at 8% with inserted=0 indefinitely. Switching to in-memory dedup + batch writes reduced a 73s run down to that actual time (previously infinite).

**How to apply:**
1. Import `preloadDedupPrefix` and `batchMarkSeen` from `./job-queue`
2. Before the loop: `const seenKeys = await preloadDedupPrefix("faa:")`; declare `pendingDedup: string[] = []`
3. Replace `isDuplicate(dkey)` → `seenKeys.has(dkey)` and `markSeen(dkey)` → `seenKeys.add(dkey); pendingDedup.push(dkey)`
4. After each batch flush: `await batchMarkSeen(pendingDedup); pendingDedup.length = 0`

**Also:** Progress heartbeat must be placed BEFORE the filter `continue` statements (fire for ALL lines, not just matching ones). Put the `if (lineNum - lastProgressLine >= 5_000)` check right after `lineNum++`.

**Dedup key naming:** The actual Upstash key is `apex:apex:dedup:hnwi` (double-prefix artifact of `PERM_PREFIX + DEDUP_KEY` in redis.ts). `preloadDedupPrefix` and `batchMarkSeen` in job-queue.ts abstract this correctly.
