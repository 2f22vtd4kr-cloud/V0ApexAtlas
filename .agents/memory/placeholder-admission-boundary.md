---
name: Placeholder admission boundary
description: Registry placeholders must be rejected before deduplication or batch insertion
---

Registry adapters must reject placeholder names before dedup keys are marked or candidates enter a batch. Later enrichment skips and startup quarantine are recovery layers, not admission controls.

**Why:** A live worker can retain a stale placeholder reference and repopulate hidden contact fields after manual cleanup; preventing admission avoids both the bad row and the stale-worker race.

**How to apply:** Keep the pre-insert guard in every registry/batch ingestion path, test representative placeholders and real names, and still retain idempotent startup quarantine with provenance preservation.