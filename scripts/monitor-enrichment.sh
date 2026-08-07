#!/usr/bin/env bash
# monitor-enrichment.sh
# Polls /api/pipeline/funnel every 2 minutes.
# Triggers backfill-contact-outcomes before each sample so the rate reflects
# real DB state. Prints a status line each cycle and exits when enrichment
# rate crosses the 2.5% pre-Phase-J ceiling.

API="http://localhost:8080"
THRESHOLD=2.5
LOG=/tmp/enrichment-monitor.log
INTERVAL=120   # seconds between polls

jq_parse() {
  echo "$1" | node -e "
const chunks=[]; process.stdin.on('data',c=>chunks.push(c)); process.stdin.on('end',()=>{
  try {
    const d=JSON.parse(chunks.join(''));
    const total=d.total||0;
    const none=(d.outcomes&&d.outcomes.none)||0;
    const enriched=total-none;
    const rate=total>0 ? ((enriched/total)*100).toFixed(4) : '0.0000';
    const conv=d.conversionRate ? ((1-(d.conversionRate.notEnriched||1))*100).toFixed(3) : '0.000';
    console.log(total+' '+none+' '+enriched+' '+rate+' '+conv);
  } catch(e){ console.log('0 0 0 0.0000 0.000'); }
});"
}

echo "$(date -u +%H:%M:%SZ) [monitor] Starting — threshold ${THRESHOLD}%, polling every ${INTERVAL}s" | tee -a "$LOG"

while true; do
  # Trigger backfill so contactOutcome is current
  curl -s -X POST "$API/api/ingest/backfill-contact-outcomes" -o /dev/null 2>/dev/null

  # Read funnel
  FUNNEL=$(curl -s "$API/api/pipeline/funnel" 2>/dev/null)
  READ=$(jq_parse "$FUNNEL")
  TOTAL=$(echo "$READ" | awk '{print $1}')
  NONE=$(echo "$READ"  | awk '{print $2}')
  ENRICHED=$(echo "$READ" | awk '{print $3}')
  RATE=$(echo "$READ"  | awk '{print $4}')
  CONV=$(echo "$READ"  | awk '{print $5}')

  TS=$(date -u +%H:%M:%SZ)
  echo "$TS  total=$TOTAL  none=$NONE  enriched=$ENRICHED  rate=${RATE}%  (funnel_conv=${CONV}%)" | tee -a "$LOG"

  # Check threshold
  CROSSED=$(echo "$RATE $THRESHOLD" | awk '{print ($1 > $2) ? "yes" : "no"}')
  if [ "$CROSSED" = "yes" ]; then
    echo "" | tee -a "$LOG"
    echo "================================================" | tee -a "$LOG"
    echo "  THRESHOLD CROSSED — ${RATE}% > ${THRESHOLD}%" | tee -a "$LOG"
    echo "  Phase J enrichment now exceeds pre-Phase-J ceiling." | tee -a "$LOG"
    echo "  total=$TOTAL  enriched=$ENRICHED  none=$NONE" | tee -a "$LOG"
    echo "================================================" | tee -a "$LOG"
    exit 0
  fi

  sleep "$INTERVAL"
done
