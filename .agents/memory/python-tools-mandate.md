---
name: Python tools installation mandate
description: Holehe, Maigret, and Sherlock are installed and verified before research; managed Python survives re-imports.
---

# Python OSINT Tools — Mandatory Installation (permanent rule)

## The rule
Holehe and Maigret MUST be installed and verified before any research run. Sherlock is also installed as the supplementary username-discovery fallback. The app must not begin enrichment if the required tools are missing.

**Why:** The base image can re-import with Python 3.13 but without pip or the project packages. A managed Python 3.11 module plus an idempotent installer keeps the discovery tools available instead of silently degrading.

## Three enforcement layers (all added permanently)

1. **`scripts/post-merge.sh` step 4/4** — `bash scripts/install-python-tools.sh` runs automatically after every GitHub import merge, right after `pnpm install` and `db push`.

2. **`startup.ts` — `verifyAndInstallPythonTools()`** — fires on every API server boot, unconditionally (before the `ENABLE_AUTO_PIPELINE` check). Uses `.pythonlibs/bin/python3` when present and checks `holehe`, `maigret`, and `sherlock_project`; if any is missing, it runs the installer.

3. **`scripts/install-python-tools.sh`** — chooses the managed interpreter, installs holehe + maigret + sherlock-project through `uv` when available, and leaves theHarvester optional.

## How to apply
- On every session start: confirm `✅ Python OSINT tools verified: holehe ✓  maigret ✓  sherlock ✓` appears in API server logs.
- If missing: run `bash scripts/install-python-tools.sh` directly, wait for completion.
- Do NOT skip this check and proceed with research.
