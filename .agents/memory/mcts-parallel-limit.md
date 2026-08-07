---
name: MCTS parallel limit
description: Maximum safe number of parallel MCTS research/run calls before OOM crash
---

Running more than 5 parallel `POST /api/research/run` calls simultaneously causes the API server to crash with a JavaScript heap out of memory error (`--max-old-space-size=3072` limit hit).

**Why:** Each MCTS session builds a full graph traversal tree in memory simultaneously. 20 parallel sessions × ~200MB each = 4GB required, exceeding the 3072MB cap.

**How to apply:**
- Run MCTS sessions in batches of 5, waiting for each batch to complete before starting the next.
- Sequential is safest for large runs: `for id in ...; do curl ... ; done` (sequential, not `&`).
- For speed, batch 5 at a time with `&` then `wait` before starting next batch.
- After any OOM crash, restart the API server before continuing — the process is dead.
