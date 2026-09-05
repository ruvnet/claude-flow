#!/usr/bin/env node
// audit-list.mjs — list timestamped oia-audit records from the
// `metaharness-audit` memory namespace.
//
// The iter-7 oia-audit worker writes one record per run (keyed by ISO
// timestamp). This script enumerates them so operators can see audit
// cadence, spot gaps, and pick keys to feed into audit-trend.mjs.
//
// USAGE
//   node scripts/audit-list.mjs                       # most recent 20
//   node scripts/audit-list.mjs --limit 50
//   node scripts/audit-list.mjs --format json
//   node scripts/audit-list.mjs --since 30d           # last N days
//
// EXIT CODES
//   0  ok
//   2  config error

import { spawnSync } from 'node:child_process';

const NS = process.env.AUDIT_LIST_NAMESPACE || 'metaharness-audit';
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ARGS = (() => {
  const a = { limit: 20, since: null, format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--limit') a.limit = parseInt(process.argv[++i], 10);
    else if (v === '--since') a.since = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function parseDurationMs(spec) {
  const m = /^(\d+)([hdwm])$/.exec(spec);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { h: 3600_000, d: 86400_000, w: 7 * 86400_000, m: 30 * 86400_000 }[m[2]];
  return unit ? n * unit : null;
}

function memList() {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'list',
    '--namespace', NS, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return [];
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

function memRetrieve(key) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', NS, '--key', key,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function main() {
  if (!Number.isInteger(ARGS.limit) || ARGS.limit < 1) {
    console.error(`audit-list: --limit must be a positive integer`);
    process.exit(2);
  }
  let cutoffMs = null;
  if (ARGS.since) {
    const ms = parseDurationMs(ARGS.since);
    if (!ms) {
      console.error(`audit-list: --since must be N(h|d|w|m); got ${ARGS.since}`);
      process.exit(2);
    }
    cutoffMs = Date.now() - ms;
  }

  const entries = memList()
    .map((e) => e.key)
    .filter((k) => typeof k === 'string' && k.startsWith('audit-'))
    .sort()
    .reverse();  // newest first (ISO keys sort lexicographically by time)

  // Apply --since by parsing the timestamp out of the key.
  const filtered = entries.filter((k) => {
    if (!cutoffMs) return true;
    // key shape: audit-2026-06-16T15-30-00-000Z
    const m = /^audit-(.+)$/.exec(k);
    if (!m) return true;
    const isoLike = m[1].replace(/-/g, ':').replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const ts = Date.parse(isoLike);
    return Number.isFinite(ts) && ts >= cutoffMs;
  });

  const slice = filtered.slice(0, ARGS.limit);

  // Pull just enough fields from each record to render a compact line.
  const rows = [];
  for (const key of slice) {
    const rec = memRetrieve(key);
    if (!rec) continue;
    rows.push({
      key,
      startedAt: rec.startedAt || null,
      finishedAt: rec.finishedAt || null,
      worst: rec.composite?.worst || null,
      tmWorst: rec.composite?.threatModelWorst || null,
      mcpWorst: rec.composite?.mcpScanWorst || null,
      degraded: !!(rec.components?.oiaManifest?.degraded
                || rec.components?.threatModel?.degraded
                || rec.components?.mcpScan?.degraded),
    });
  }

  const payload = {
    namespace: NS,
    filters: { limit: ARGS.limit, since: ARGS.since },
    totalInNamespace: entries.length,
    matchedSinceFilter: filtered.length,
    returned: rows.length,
    records: rows,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# audit-list`);
  console.log('');
  console.log(`| Field | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Namespace | \`${NS}\` |`);
  console.log(`| Total records | ${entries.length} |`);
  console.log(`| Matched filter | ${filtered.length} |`);
  console.log(`| Showing | ${rows.length} (newest first) |`);
  console.log('');
  if (rows.length === 0) {
    console.log(`_No audit records found. Run \`harness oia-audit\` to create one._`);
    return;
  }
  console.log(`| Key | Started | Composite worst | Threat | MCP | Degraded |`);
  console.log(`|---|---|:---:|:---:|:---:|:---:|`);
  for (const r of rows) {
    const shortKey = r.key.slice(0, 32) + (r.key.length > 32 ? '…' : '');
    const started = r.startedAt ? r.startedAt.slice(0, 19).replace('T', ' ') : '—';
    console.log(`| \`${shortKey}\` | ${started} | ${r.worst || '—'} | ${r.tmWorst || '—'} | ${r.mcpWorst || '—'} | ${r.degraded ? '⚠' : '✓'} |`);
  }
  console.log('');
  console.log(`_Use \`audit-trend --baseline-key <a> --current-key <b>\` to diff two records._`);
}

main();
