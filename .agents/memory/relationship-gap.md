---
name: Relationship graph gap — FAA address uniqueness
description: Why POST /api/relationships/auto-detect always returns 0 for FAA-heavy datasets, and what signals actually work.
---

## Rule
`POST /api/relationships/auto-detect` finds shared correspondence addresses. It will always return 0 on a dataset dominated by FAA aircraft registrants because every FAA entity has a unique mailing address.

**Why:** FAA MASTER.txt field [6] name + [9]/[10] city/state is unique per aircraft registration. No two unrelated entities share the same address string in the FAA registry.

## How to apply
To build a real relationship graph from FAA data, use one of these alternative signals:
1. **Same company name prefix/LLC series** — e.g. "Tannjets Aerospace I LLC" and "Tannjets Aerospace II LLC" → likely same owner
2. **SEC co-filers** — entities that appear together in SEC 13D/13G filings
3. **UK Companies House director co-appointments** — two entities where the same person is a director (requires CH enrichment first)
4. **Asset co-ownership** — two entities sharing the same FBO address in aviation metadata

The auto-detect endpoint exists and works — it just needs a richer signal than address for FAA data.
