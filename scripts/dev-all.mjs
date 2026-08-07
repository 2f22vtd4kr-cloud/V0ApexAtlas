#!/usr/bin/env node
/**
 * Runs the apex-finder Vite frontend and the api-server together.
 * The Vite dev server proxies /api -> http://127.0.0.1:$API_PORT.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load local env files (Vercel/Neon injects them into .env*.local) so the
// api-server child process sees DATABASE_URL and friends.
for (const file of ['.env', '.env.local', '.env.development.local']) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) process.env[key] = value;
  }
}

const API_PORT = process.env.API_PORT ?? '8080';
const WEB_PORT = process.env.PORT ?? '3000';

const children = [];
let shuttingDown = false;

function run(name, args, extraEnv) {
  const child = spawn('pnpm', args, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev-all] ${name} exited (code=${code} signal=${signal})`);
    if (name === 'web') shutdown('SIGTERM');
  });
  children.push(child);
  return child;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

run('api', ['--filter', '@workspace/api-server', 'run', 'dev'], {
  PORT: API_PORT,
  NODE_ENV: 'development',
});

run('web', ['--filter', '@workspace/apex-finder', 'run', 'dev'], {
  PORT: WEB_PORT,
  API_PORT,
});
