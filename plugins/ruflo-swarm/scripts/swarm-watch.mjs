#!/usr/bin/env node
// Emit one NDJSON line whenever `swarm status --format json` changes, for the Monitor tool.
// The ruflo CLI has no `swarm watch --stream`; this polls the real `swarm status` instead.
// Usage: node swarm-watch.mjs [--interval <seconds, 2-300, default 10>] [--once]
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const once = args.includes('--once');
const at = args.indexOf('--interval');
const raw = at >= 0 ? Number(args[at + 1]) : 10;
if (!Number.isFinite(raw) || raw < 2 || raw > 300) {
  console.error('swarm-watch: --interval must be a number between 2 and 300 seconds');
  process.exit(2);
}
const intervalMs = Math.round(raw * 1000);
const out = (event) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');

function poll() {
  // Fixed argv only; nothing from the environment or the user reaches the command line.
  const r = spawnSync('npx', ['-y', '@claude-flow/cli@latest', 'swarm', 'status', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 60_000,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) return { error: (r.stderr || r.error?.message || `exit ${r.status}`).toString().slice(0, 300) };
  const start = r.stdout.indexOf('{');
  try {
    return { status: JSON.parse(r.stdout.slice(start)) };
  } catch {
    return { error: 'swarm status did not return JSON' };
  }
}

let last = null;
let lastError = null;
for (;;) {
  const { status, error } = poll();
  if (error) {
    if (error !== lastError) out({ type: 'swarm.error', error });
    lastError = error;
  } else {
    lastError = null;
    const key = JSON.stringify(status);
    if (key !== last) out({ type: last === null ? 'swarm.snapshot' : 'swarm.changed', status });
    last = key;
  }
  if (once) process.exit(error ? 1 : 0);
  await new Promise((r) => setTimeout(r, intervalMs));
}
