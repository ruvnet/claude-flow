#!/usr/bin/env node
// ADR index reconciler for the ruflo-adr plugin (#2666).
//
// import.mjs is convergence-only: it upserts what's on disk into
// `adr-patterns`/`adr-edges`, but has no way to remove a row whose source
// ADR file was deleted (or an edge line that was deleted from a surviving
// file) — that row survives every future import, and adr-verify.mjs
// certifies the resulting graph as "healthy" because an orphan row has no
// dangling ref and forms no cycle. See issue #2666 for the full analysis.
//
// This is reaping, not convergence, and the only reliable way to reap is a
// full drop-and-rebuild of BOTH namespaces:
//   1. Hard-purge `adr-patterns` and `adr-edges` (via the new
//      `memory purge --namespace <ns> --force` CLI command, #2666 — a real
//      DELETE, not `memory delete`'s soft tombstone that still trips the
//      UNIQUE(namespace, key) constraint on re-store, #2652).
//   2. Re-scan every ADR currently on disk and store fresh.
//   3. Re-list the namespace and assert the count equals the number of ADR
//      files scanned — a `storedRecords != 0` tally (what import.mjs prints)
//      cannot see this failure mode: if step 1 got silently clobbered by a
//      concurrent writer resurrecting old rows (#2621), step 2's upserts
//      still report "ok", and only a fresh re-count catches the drift.
//
// This also incidentally fixes the separate staleness problem where
// `memory store` (no --upsert) leaves a changed-but-still-present ADR's
// content stale forever (#2660) — after a full purge there's nothing to
// conflict with, so every store is a clean insert of current content.
//
// Usage:
//   node scripts/reindex.mjs                         # purge + rebuild, markdown summary
//   REINDEX_FORMAT=json node scripts/reindex.mjs      # JSON summary
//   REINDEX_DRY_RUN=1 node scripts/reindex.mjs        # report only, no purge/store
//   ADR_ROOT=/path/to/repo node scripts/reindex.mjs   # override scan + db root (default: cwd)
//
// #2621 caveat: the purge step is lock-protected against a second concurrent
// purge/delete on the same memory.db, but NOT against every possible
// concurrent writer (a daemon or MCP server mid a sql.js-fallback
// read-modify-write cycle can still flush an older image afterward and
// resurrect what this just purged) — that requires every memory.db writer
// to respect the same lock, which is a larger change than this reconcile
// primitive. Re-run this script if that ever happens; the post-condition
// check below will tell you.

import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findAdrs, parseAdr } from './lib/parse-adrs.mjs';

const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ROOT = process.env.ADR_ROOT || process.cwd();
const dryRun = process.env.REINDEX_DRY_RUN === '1';
const fmt = process.env.REINDEX_FORMAT || 'markdown';

const NAMESPACES = ['adr-patterns', 'adr-edges'];

function purgeNamespace(namespace) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'purge',
    `--namespace=${namespace}`,
    '--force',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) {
    return { success: false, error: (r.stderr || r.stdout || '').slice(0, 300) };
  }
  return { success: true };
}

function memoryStore(namespace, key, value) {
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  // Same argv-encoding note as import.mjs: `--flag=value` avoids npm's
  // non-ASCII-leading-dash argv rejection on em-dash titles (#2474 Bug 1).
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'store',
    `--namespace=${namespace}`,
    `--key=${key}`,
    `--value=${valueStr}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return 'error: ' + (r.stderr || r.stdout || '').slice(0, 100);
  return 'ok';
}

function memoryListCount(namespace) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'list',
    '--namespace', namespace, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return null;
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return null;
  try { return JSON.parse(m[0]).length; } catch { return null; }
}

const files = findAdrs(ROOT);
const adrs = files.map((f) => parseAdr(f, ROOT));
const byId = new Map();
const allEdges = [];
for (const a of adrs) {
  byId.set(a.id, a);
  allEdges.push(...a.links);
}

const result = {
  scannedRoot: ROOT,
  total: adrs.length,
  edges: allEdges.length,
  dryRun,
  purge: {},
  storedRecords: 0,
  storedEdges: 0,
  errors: [],
  postCondition: null,
};

if (dryRun) {
  if (fmt === 'json') {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  console.log('## ADR Reindex (dry run — nothing purged or written)');
  console.log('');
  console.log(`Would purge + rebuild \`adr-patterns\` and \`adr-edges\` from ${result.total} ADR file(s) under ${ROOT}.`);
  process.exit(0);
}

// Step 1: hard-purge both namespaces (drop).
for (const ns of NAMESPACES) {
  result.purge[ns] = purgeNamespace(ns);
  if (!result.purge[ns].success) {
    result.errors.push(`purge ${ns}: ${result.purge[ns].error}`);
  }
}

// Step 2: rebuild from the current on-disk scan.
for (const a of adrs) {
  const r = memoryStore('adr-patterns', `${a.id}::${basename(a.file, '.md')}`,
    `${a.title} — ${a.context || '(no context)'}\n\nfile: ${a.file}\nstatus: ${a.status}\ndate: ${a.date}\ntags: ${a.tags.join(',')}`);
  if (r === 'ok') result.storedRecords++;
  else result.errors.push(`${a.id} ${a.file}: ${r}`);
}
for (const e of allEdges) {
  const key = `${e.relation}:${e.from}->${e.to}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = memoryStore('adr-edges', key, JSON.stringify({ ...e, capturedAt: new Date().toISOString() }));
  if (r === 'ok') result.storedEdges++;
}

// Step 3: post-condition — re-count from a fresh `memory list`, not the
// store-loop's own "ok" tally. This is the check the issue's point 3 calls
// for: a tally of successful store calls cannot see a concurrent-writer
// clobber of the purge; a fresh recount can.
const recount = memoryListCount('adr-patterns');
result.postCondition = {
  expected: adrs.length,
  actual: recount,
  ok: recount === adrs.length,
};
if (!result.postCondition.ok) {
  result.errors.push(
    `post-condition failed: expected ${adrs.length} adr-patterns record(s) after reindex, found ${recount === null ? 'unreadable' : recount}. ` +
    `Likely cause: a concurrent memory.db writer (daemon/MCP server) raced the purge (#2621). Re-run reindex.mjs.`
  );
}

if (fmt === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('## ADR Reindex Summary');
  console.log('');
  console.log(`Scanned root: ${ROOT}`);
  console.log(`ADR files on disk: **${result.total}**`);
  console.log('');
  console.log('### Purge');
  for (const ns of NAMESPACES) {
    console.log(`- ${ns}: ${result.purge[ns].success ? 'purged' : `FAILED — ${result.purge[ns].error}`}`);
  }
  console.log('');
  console.log('### Rebuild');
  console.log(`- Records stored to \`adr-patterns\`: ${result.storedRecords}/${result.total}`);
  console.log(`- Edges stored to \`adr-edges\`: ${result.storedEdges}/${result.edges}`);
  console.log('');
  console.log('### Post-condition (records == ADR files on disk)');
  console.log(`- Expected: ${result.postCondition.expected}, Actual: ${result.postCondition.actual}, ${result.postCondition.ok ? 'OK' : 'FAILED'}`);
  if (result.errors.length) {
    console.log('');
    console.log('### Errors');
    for (const e of result.errors.slice(0, 10)) console.log(`- ${e}`);
  }
}

process.exit(result.postCondition.ok && result.errors.length === 0 ? 0 : 1);
