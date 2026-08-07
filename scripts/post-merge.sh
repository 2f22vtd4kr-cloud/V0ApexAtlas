#!/bin/bash
# ============================================================
# ApexFinder Pro — Post-Merge / Cold-Start Setup
#
# Runs automatically after every GitHub import merge.
# Safe to run repeatedly (idempotent).
#
# What this does:
#   1. Installs all pnpm workspace dependencies
#   2. Applies any new DB schema columns/tables (additive only)
#   3. Verifies no synthetic data crept in
#
# What happens automatically AFTER this (on API server boot):
#   - Ghost active-job locks from the previous process are cleared
#   - If the DB is empty, FAA + Land Registry + Western HNWI
#     ingestion start automatically (see src/lib/startup.ts)
#
# IMPORTANT — Upstash dedup across imports:
#   The Upstash dedup set (apex:dedup:hnwi) persists across imports.
#   If FAA inserts 0 records after a fresh import, it means all records
#   are already in the dedup set from a prior session.
#   To re-ingest from scratch: DELETE /api/ingest/dedup  (clears the set)
#   The cold-start auto-ingestion does NOT clear dedup — it respects it.
#
# Secrets needed (set once in Replit Secrets, persist across imports):
#   SESSION_SECRET          — Express session signing
#   REDIS_URL_1             — Upstash Redis (dedup + job state persistence)
#   COMPANIES_HOUSE_API_KEY — UK officer address enrichment (optional but recommended)
# ============================================================

set -e

echo "=== [1/4] Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== [2/4] Applying DB schema (additive) ==="
pnpm --filter @workspace/db run push

echo "=== [3/4] Checking for synthetic data ==="
bash scripts/check-no-synthetic-data.sh

echo "=== [4/4] Installing Python OSINT tools (Holehe · Maigret) ==="
# MANDATORY — Apex Atlas must not run research without these tools installed.
# Holehe: email → 120+ platform presence check
# Maigret: username → 3,000+ social platform dossier
bash scripts/install-python-tools.sh

echo ""
echo "✅ Post-merge setup complete."
echo "   Start workflows: Redis → API Server → apex-finder web"
echo "   All Python OSINT tools (Holehe, Maigret) verified above."
echo "   API server will auto-start ingestion if DB is empty."
