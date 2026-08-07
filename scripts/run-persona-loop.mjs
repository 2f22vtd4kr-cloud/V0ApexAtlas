#!/usr/bin/env node
/**
 * Run the persona improvement loop across all entities in paginated batches.
 * Polls each job to completion before starting the next.
 * Usage: node scripts/run-persona-loop.mjs [batchSize] [maxBatches]
 */

const BASE = "http://localhost:8080/api";
const BATCH_SIZE = parseInt(process.argv[2] || "500", 10);
const MAX_BATCHES = parseInt(process.argv[3] || "20", 10);
const START_BATCH = parseInt(process.argv[4] || "0", 10);
const POLL_INTERVAL = 3000;

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function pollJob(jobId) {
  while (true) {
    const job = await get(`/improve/jobs/${jobId}`);
    const pct = job.progress ?? 0;
    const msg = job.message ?? "";
    process.stdout.write(`\r  [${pct}%] ${msg.slice(0, 80).padEnd(80)}`);
    if (job.status === "done" || job.status === "failed") {
      process.stdout.write("\n");
      return job;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// Fetch a page of entity IDs directly via the list endpoint
async function fetchEntityIds(offset, limit) {
  const data = await get(`/entities?limit=${limit}&offset=${offset}`);
  if (Array.isArray(data)) return data.map(e => e.id);
  if (Array.isArray(data.entities)) return data.entities.map(e => e.id);
  return [];
}

async function main() {
  console.log(`\n=== Persona Improvement Loop ===`);
  console.log(`Batch size: ${BATCH_SIZE} | Max batches: ${MAX_BATCHES} | Start batch: ${START_BATCH}\n`);

  let totalInserted = 0;
  let totalEntities = 0;

  for (let batch = START_BATCH; batch < START_BATCH + MAX_BATCHES; batch++) {
    const offset = batch * BATCH_SIZE;
    const ids = await fetchEntityIds(offset, BATCH_SIZE);

    if (ids.length === 0) {
      console.log(`No more entities at offset ${offset} — done.`);
      break;
    }

    console.log(`Batch ${batch + 1}/${MAX_BATCHES}: entities ${offset + 1}–${offset + ids.length}`);

    const start = await post("/improve/run", { entityIds: ids });

    if (start.error) {
      // If a job is already running, wait for it
      if (start.jobId) {
        console.log(`  Job already running (${start.jobId}), polling…`);
        const job = await pollJob(start.jobId);
        console.log(`  Done: ${job.inserted ?? 0} suggestions`);
        batch--; // retry this batch
        continue;
      }
      console.error(`  Error: ${start.error}`);
      break;
    }

    const job = await pollJob(start.jobId);
    const inserted = job.inserted ?? 0;
    totalInserted += inserted;
    totalEntities += ids.length;
    console.log(`  ✓ ${inserted} suggestions | running total: ${totalInserted} across ${totalEntities} entities\n`);

    if (ids.length < BATCH_SIZE) {
      console.log("Last batch processed — all entities covered.");
      break;
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`Total suggestions: ${totalInserted}`);
  console.log(`Total entities:    ${totalEntities}`);

  // Print final stats
  const stats = await get("/improve/stats");
  console.log("\nBy persona:");
  (stats.byPersona || []).forEach(p => console.log(`  ${p.persona}: ${p.count}`));
  console.log("\nBy priority:");
  (stats.byPriority || []).forEach(p => console.log(`  ${p.priority}: ${p.count}`));
}

main().catch(err => { console.error(err); process.exit(1); });
