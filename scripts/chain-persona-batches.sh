#!/usr/bin/env bash
# Chain persona-loop batches. Runs fully detached — safe to kill this script,
# the in-flight fire-and-forget job on the API server will still complete.
# Usage: bash scripts/chain-persona-batches.sh [start_offset] [num_batches] [batch_size]

BASE="http://localhost:8080/api"
START_OFFSET="${1:-2000}"
NUM_BATCHES="${2:-55}"
BATCH_SIZE="${3:-500}"
LOG="/tmp/persona-chain.log"

log() { echo "[$(date -u +%T)] $*" | tee -a "$LOG"; }

log "=== chain-persona-batches START offset=$START_OFFSET batches=$NUM_BATCHES size=$BATCH_SIZE ==="

wait_for_job() {
  local JID="$1"
  local PREV=-1
  while true; do
    RESP=$(curl -sf "$BASE/improve/jobs/$JID" 2>/dev/null)
    STATUS=$(echo "$RESP" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{const j=JSON.parse(Buffer.concat(c));console.log(j.status+'|'+j.progress+'|'+(j.inserted||0)+'|'+((j.message||'').slice(0,50)));}catch{console.log('err|0|0|');}});")
    IFS='|' read -r ST PCT INS MSG <<< "$STATUS"
    if [ "$PCT" != "$PREV" ]; then
      log "  [$ST $PCT%] ins:$INS — $MSG"
      PREV=$PCT
    fi
    if [ "$ST" = "done" ] || [ "$ST" = "failed" ]; then
      log "  job $JID finished: $ST ins=$INS"
      return 0
    fi
    sleep 6
  done
}

check_active_job() {
  # Returns active jobId if one is running, else empty (uses -s not -sf so 409 body is returned)
  RESP=$(curl -s -X POST "$BASE/improve/run" -H "Content-Type: application/json" -d '{"entityIds":[999999999]}' 2>/dev/null)
  JID=$(echo "$RESP" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{const j=JSON.parse(Buffer.concat(c));console.log(j.jobId||'');}catch{console.log('');}});")
  echo "$JID"
}

# Wait for any currently-active job first
ACTIVE=$(check_active_job)
if [ -n "$ACTIVE" ]; then
  log "Active job $ACTIVE — waiting before starting batches"
  wait_for_job "$ACTIVE"
fi

OFFSET=$START_OFFSET
TOTAL_NEW=0

for i in $(seq 1 $NUM_BATCHES); do
  # Fetch entity IDs for this offset
  IDS=$(curl -sf "$BASE/entities?limit=$BATCH_SIZE&offset=$OFFSET" 2>/dev/null | \
    node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{const d=JSON.parse(Buffer.concat(c));const arr=Array.isArray(d)?d:(d.entities||[]);console.log(arr.map(e=>e.id).join(','));}catch{console.log('');}});")

  if [ -z "$IDS" ]; then
    log "No entities at offset $OFFSET — done."
    break
  fi

  ENTITY_COUNT=$(echo "$IDS" | tr ',' '\n' | wc -l)
  log "--- Batch $i: offset $OFFSET ($ENTITY_COUNT entities) ---"

  # Start the job (use -s not -sf so 409 body is returned)
  RESP=$(curl -s -X POST "$BASE/improve/run" \
    -H "Content-Type: application/json" \
    -d "{\"entityIds\":[$IDS]}" 2>/dev/null)

  JOB_ID=$(echo "$RESP" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{const j=JSON.parse(Buffer.concat(c));console.log(j.jobId||'');}catch{console.log('');}});")

  if [ -z "$JOB_ID" ]; then
    log "  Failed to start job: $RESP"
    break
  fi

  log "  Started job $JOB_ID"
  wait_for_job "$JOB_ID"

  OFFSET=$((OFFSET + BATCH_SIZE))
  TOTAL_NEW=$((TOTAL_NEW + 1))

  if [ "$ENTITY_COUNT" -lt "$BATCH_SIZE" ]; then
    log "Last batch (only $ENTITY_COUNT entities returned) — all entities processed."
    break
  fi
done

# Final stats
STATS=$(curl -sf "$BASE/improve/stats" 2>/dev/null)
GRAND=$(echo "$STATS" | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{const j=JSON.parse(Buffer.concat(c));console.log('total='+j.total+' high='+j.byPriority.find(x=>x.priority==='high').count+' med='+j.byPriority.find(x=>x.priority==='medium').count+' low='+j.byPriority.find(x=>x.priority==='low').count);}catch{console.log('stats unavailable');}});")
log "=== DONE | batches_run=$TOTAL_NEW | $GRAND ==="
