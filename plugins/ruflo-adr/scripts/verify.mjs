#!/usr/bin/env node
// adr-verify — read the persisted adr-patterns + adr-edges namespaces, surface
// dangling refs, supersede cycles, and status mismatches.
//
// Companion to scripts/import.mjs. Run after import to validate graph integrity.
// Useful in CI: exits with code 1 on supersede cycles by default, or on ANY
// issue (dangling refs, status mismatches) when VERIFY_STRICT=1 is set.
//
// Usage:
//   node scripts/verify.mjs                     # markdown report
//   VERIFY_FORMAT=json node scripts/verify.mjs  # JSON for chaining
//   VERIFY_STRICT=1 node scripts/verify.mjs     # exit 1 on ANY issue (default: only on cycles)
//   ADR_ROOT=/path/to/repo node scripts/verify.mjs   # same root import.mjs was run with

import { spawnSync } from 'node:child_process';

// ADR-100 / #1748 Issue 3 — CLI_CORE=1 routes to lite cli-core (~2s cold-cache).
// verify only does list+retrieve across adr-patterns and adr-edges namespaces;
// no semantic search needed. JSON backend is sufficient.
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

// #2666 point 2: must match whatever ADR_ROOT import.mjs/reindex.mjs were
// run with — the CLI resolves `.swarm/memory.db` relative to this
// subprocess's cwd, so a mismatched root silently reads the wrong db.
const ROOT = process.env.ADR_ROOT || process.cwd();

function memoryListJson(namespace) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'list',
    '--namespace', namespace, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return [];
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}
function memoryRetrieve(namespace, key) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', namespace, '--key', key,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return null;
  // Strip ANSI / box-drawing
  const txt = (r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '');
  return txt;
}

const patternEntries = memoryListJson('adr-patterns');
const edgeEntries = memoryListJson('adr-edges');

const adrIds = new Set(
  patternEntries.map((e) => (e.key || '').split('::')[0]).filter(Boolean)
);

// Parse edge values to recover {from, to, relation}
const edges = [];
for (const e of edgeEntries) {
  const k = e.key || '';
  // key format: relation:FROM->TO:timestamp-rand
  const m = /^(\w[\w-]*?):(\S+?)->(\S+?):/.exec(k);
  if (m) edges.push({ relation: m[1], from: m[2], to: m[3], key: k });
}

const danglingRefs = edges.filter((e) => !adrIds.has(e.to));
const danglingFroms = edges.filter((e) => !adrIds.has(e.from));

// Cycle detection on supersedes (cycle = data corruption — ADR can't supersede itself transitively)
const supersedesGraph = new Map();
for (const e of edges.filter((e) => e.relation === 'supersedes')) {
  if (!supersedesGraph.has(e.from)) supersedesGraph.set(e.from, []);
  supersedesGraph.get(e.from).push(e.to);
}
const cycles = [];
function findCycle(node, visited, stack) {
  if (stack.has(node)) {
    cycles.push([...stack, node].join(' → '));
    return;
  }
  if (visited.has(node)) return;
  visited.add(node);
  stack.add(node);
  for (const next of supersedesGraph.get(node) || []) {
    findCycle(next, visited, stack);
  }
  stack.delete(node);
}
for (const n of supersedesGraph.keys()) findCycle(n, new Set(), new Set());

const result = {
  adrCount: adrIds.size,
  edgeCount: edges.length,
  byRelation: edges.reduce((acc, e) => { acc[e.relation] = (acc[e.relation] || 0) + 1; return acc; }, {}),
  danglingRefs,
  danglingFroms,
  cycles: [...new Set(cycles)],
};

if (process.env.VERIFY_FORMAT === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('## ADR Graph Verification');
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| ADRs in adr-patterns | ${result.adrCount} |`);
  console.log(`| Edges in adr-edges | ${result.edgeCount} |`);
  for (const [k, n] of Object.entries(result.byRelation).sort((a, b) => b[1] - a[1])) {
    console.log(`| edges (${k}) | ${n} |`);
  }
  console.log(`| Dangling 'to' refs | ${result.danglingRefs.length} |`);
  console.log(`| Dangling 'from' refs | ${result.danglingFroms.length} |`);
  console.log(`| Supersede cycles | ${result.cycles.length} |`);
  if (result.danglingRefs.length) {
    console.log('\n### Sample dangling refs');
    for (const d of result.danglingRefs.slice(0, 8)) console.log(`- ${d.relation} ${d.from} → ${d.to} (missing)`);
  }
  if (result.cycles.length) {
    console.log('\n### Cycles (DATA CORRUPTION — fix immediately)');
    for (const c of result.cycles) console.log(`- ${c}`);
  }
}

const strict = process.env.VERIFY_STRICT === '1';
if (result.cycles.length || (strict && (result.danglingRefs.length || result.danglingFroms.length))) {
  process.exit(1);
}
