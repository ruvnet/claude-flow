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

import { CLI_PKG, parseEdgeKey } from './lib/index-records.mjs';
import { spawnCliSync } from './lib/ruflo-cli.mjs';

// Import/reindex always use the default CLI's SQLite store (#2781). Reading
// cli-core's separate JSON store would verify a different graph. #3558: the
// read goes through the same installed-CLI resolution as the writers
// (lib/ruflo-cli.mjs), so verify reads the store import/reindex wrote.
if (process.env.CLI_CORE === '1') {
  console.warn('[ruflo-adr] warning: CLI_CORE=1 is ignored for verification (#2781).');
}

// #2666 point 2: must match whatever ADR_ROOT import.mjs/reindex.mjs were
// run with — the CLI resolves `.swarm/memory.db` relative to this
// subprocess's cwd, so a mismatched root silently reads the wrong db.
const ROOT = process.env.ADR_ROOT || process.cwd();
// The CLI has no cursor/offset flag. Request one more than our maximum and
// refuse a full response, since its default --limit=20 cannot prove a graph.
const MAX_ROWS = 10_000;
const READ_LIMIT = MAX_ROWS + 1;
const READ_TIMEOUT_MS = Math.min(120_000, Math.max(100,
  Number(process.env.ADR_VERIFY_TIMEOUT_MS) || 60_000));
const MAX_BUFFER = 32 * 1024 * 1024;

function memoryListJson(namespace) {
  const r = spawnCliSync([
    CLI_PKG, 'memory', 'list',
    `--namespace=${namespace}`, '--format=json', `--limit=${READ_LIMIT}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT,
    timeout: READ_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
  });
  const fail = (error) => ({ ok: false, namespace, error });
  if (r.error) return fail(`memory list failed: ${r.error.message}`);
  if (r.signal) return fail(`memory list terminated by ${r.signal}`);
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim().slice(0, 300);
    return fail(`memory list exited ${r.status}${detail ? `: ${detail}` : ''}`);
  }
  let entries;
  try {
    entries = JSON.parse((r.stdout || '').trim());
  } catch (error) {
    return fail(`memory list returned invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(entries)) return fail('memory list returned JSON other than an array');
  if (entries.length >= READ_LIMIT) {
    return fail(`memory list reached ${READ_LIMIT} rows; completeness cannot be proven`);
  }
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.key !== 'string' || !entry.key.trim()) {
      return fail(`memory list row ${index} has no valid key`);
    }
    if (entry.namespace !== undefined && entry.namespace !== namespace) {
      return fail(`memory list row ${index} belongs to ${entry.namespace}, not ${namespace}`);
    }
  }
  return { ok: true, entries };
}

const patternRead = memoryListJson('adr-patterns');
const edgeRead = memoryListJson('adr-edges');
const readErrors = [patternRead, edgeRead].filter((read) => !read.ok)
  .map(({ namespace, error }) => ({ namespace, error }));
if (readErrors.length === 0) {
  for (const [index, entry] of edgeRead.entries.entries()) {
    if (!parseEdgeKey(entry.key)) {
      readErrors.push({ namespace: 'adr-edges', error: `row ${index} has an invalid edge key: ${entry.key}` });
    }
  }
}
if (readErrors.length) {
  if (process.env.VERIFY_FORMAT === 'json') {
    console.log(JSON.stringify({ scannedRoot: ROOT, readErrors }, null, 2));
  } else {
    console.log('## ADR Graph Verification FAILED');
    console.log('');
    for (const { namespace, error } of readErrors) console.log(`- ${namespace}: ${error}`);
  }
  process.exit(1);
}

const patternEntries = patternRead.entries;
const edgeEntries = edgeRead.entries;

const adrIds = new Set(
  patternEntries.map((e) => (e.key || '').split('::')[0]).filter(Boolean)
);

// Parse edge values to recover {from, to, relation}
const edges = [];
for (const e of edgeEntries) {
  const k = e.key || '';
  // Current deterministic key: relation:FROM__TO. Keep reading the earlier
  // relation:FROM->TO and relation:FROM->TO:timestamp-rand shape for seamless upgrades (#2660).
  const parsed = parseEdgeKey(k);
  if (parsed) edges.push(parsed);
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
