#!/usr/bin/env node
/**
 * Persistent persona-loop daemon. Runs until all batches are done or maxBatches reached.
 * Writes plain newline-delimited log to /tmp/persona-daemon.log
 * Usage: node scripts/persona-daemon.mjs [startBatch] [maxBatches] [batchSize]
 */

import { writeFileSync, appendFileSync } from "node:fs";

const BASE        = "http://localhost:8080/api";
const START_BATCH = parseInt(process.argv[2] || "0",  10);
const MAX_BATCHES = parseInt(process.argv[3] || "60", 10);
const BATCH_SIZE  = parseInt(process.argv[4] || "500", 10);
const LOG         = "/tmp/persona-daemon.log";
const POLL_MS     = 5000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
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

async function waitForJob(jobId) {
  let last = -1;
  while (true) {
    let job;
    try { job = await get(`/improve/jobs/${jobId}`); }
    catch (e) { log(`  poll error: ${e.message} — retrying`); await sleep(POLL_MS); continue; }

    if (job.progress !== last) {
      log(`  [${job.progress ?? 0}%] inserted:${job.inserted ?? 0} — ${(job.message || "").slice(0, 70)}`);
      last = job.progress;
    }
    if (job.status === "done")   return job;
    if (job.status === "failed") { log(`  JOB FAILED: ${job.message}`); return job; }
    await sleep(POLL_MS);
  }
}

async function fetchIds(offset, limit) {
  let data;
  try { data = await get(`/entities?limit=${limit}&offset=${offset}`); }
  catch { return []; }
  return (Array.isArray(data) ? data : (data.entities || [])).map(e => e.id);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  try { writeFileSync(LOG, `=== Persona Daemon started ${new Date().toISOString()} ===\n`); } catch {}
  log(`Config: startBatch=${START_BATCH} maxBatches=${MAX_BATCHES} batchSize=${BATCH_SIZE}`);

  let totalNew = 0;

  for (let b = START_BATCH; b < START_BATCH + MAX_BATCHES; b++) {
    const offset = b * BATCH_SIZE;
    const ids = await fetchIds(offset, BATCH_SIZE);

    if (ids.length === 0) {
      log(`No entities at offset ${offset} — all done.`);
      break;
    }

    log(`--- Batch ${b + 1} (offset ${offset}, ${ids.length} entities) ---`);

    let resp;
    try { resp = await post("/improve/run", { entityIds: ids }); }
    catch (e) { log(`  POST error: ${e.message}`); break; }

    // If a job is already active, wait for it first then retry this batch
    if (resp.error && resp.jobId) {
      log(`  Active job found (${resp.jobId}) — waiting for it to finish`);
      await waitForJob(resp.jobId);
      b--; // retry same batch
      continue;
    }
    if (resp.error) { log(`  Error starting batch: ${resp.error}`); break; }

    const job = await waitForJob(resp.jobId);
    const inserted = job.inserted ?? 0;
    totalNew += inserted;
    log(`  Batch done: ${inserted} suggestions | running total: ${totalNew}`);
  }

  // Final summary
  let stats;
  try { stats = await get("/improve/stats"); } catch { stats = null; }
  log(`\n=== DAEMON COMPLETE ===`);
  log(`New suggestions this run: ${totalNew}`);
  if (stats) {
    log(`Grand total logs: ${stats.total}`);
    (stats.byPriority || []).forEach(p => log(`  ${p.priority}: ${p.count}`));
    log(`By persona:`);
    (stats.byPersona || []).forEach(p => log(`  ${p.persona}: ${p.count}`));
  }
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
