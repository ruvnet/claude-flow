// _sessions.mjs — shared session-loader for the cost-tracking namespace.
//
// Iter 73 consolidation. Six analytics scripts (anomaly, burn, conversation,
// counterfactual, projection, budget) previously duplicated identical
// boilerplate for reading sessions from the `cost-tracking` namespace.
// This module is the single source of truth. Math is byte-identical to
// the per-script copies it replaces.
//
// CONTRACT
//   - `memoryListSessionKeys(ns)`      → keys starting with `session-` only
//   - `memoryListAllKeys(ns)`          → ALL keys in namespace (for non-session lookups)
//   - `memoryRetrieve(ns, key)`        → parsed JSON value, or null on failure
//   - `loadSessions(ns)`               → array of session records (filters out nulls)
//   - `sessionTs(rec)`                 → ms-since-epoch from capturedAt|endedAt|startedAt
//   - `parseDurationMs(spec)`          → ms for "Nh"/"Nd"/"Nw"/"Nm"; null on parse fail

import { spawnNpxSync } from './_npx.mjs';

const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

export function memoryListAllKeys(namespace) {
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'list',
    '--namespace', namespace, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return [];
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return [];
  let entries;
  try { entries = JSON.parse(m[0]); } catch { return []; }
  return entries
    .map((e) => e.key)
    .filter((k) => typeof k === 'string');
}

export function memoryListSessionKeys(namespace) {
  return memoryListAllKeys(namespace).filter((k) => k.startsWith('session-'));
}

export function memoryRetrieve(namespace, key) {
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', namespace, '--key', key, '--value-only',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  try { return JSON.parse((r.stdout || '').trim()); } catch { return null; }
}

export function loadSessions(namespace) {
  const keys = memoryListSessionKeys(namespace);
  const records = [];
  for (const k of keys) {
    const rec = memoryRetrieve(namespace, k);
    if (rec) records.push(rec);
  }
  return records;
}

export function sessionTs(rec) {
  const t = rec.capturedAt || rec.endedAt || rec.startedAt;
  return t ? new Date(t).getTime() : 0;
}

export function parseDurationMs(spec) {
  const m = /^(\d+)([hdwm])$/.exec(spec);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { h: 3600_000, d: 86400_000, w: 7 * 86400_000, m: 30 * 86400_000 }[m[2]];
  return unit ? n * unit : null;
}
