#!/usr/bin/env node
// One-shot ADR importer for the ruflo-adr plugin.
//
// Walks the working directory (or ADR_ROOT override), parses every ADR file
// under */docs/adr/ or */docs/adrs/, persists records to the `adr-patterns`
// namespace, persists causal edges to the `adr-edges` namespace, prints a
// summary with status counts + relationship breakdown + dangling-ref check.
//
// Handles two ADR formats:
//   1. v3-style:  `# ADR-097: Title` heading + `**Status**: Proposed` line
//   2. plugin-style: YAML frontmatter (`status: Proposed`) at file head
//
// Usage:
//   node scripts/import.mjs                         # markdown summary to stdout
//   IMPORT_FORMAT=json node scripts/import.mjs       # JSON summary
//   IMPORT_DRY_RUN=1 node scripts/import.mjs         # parse + summarize, skip memory_store
//   ADR_ROOT=/path/to/repo node scripts/import.mjs   # override scan root (default: cwd)
//
// Why a script, not raw MCP calls: 70+ ADRs × multiple memory_store calls each
// is hundreds of MCP round-trips. spawnSync over the CLI is materially faster
// and avoids shell-quoting pitfalls in the ADR titles.

import { spawnSync } from 'node:child_process';
import { findAdrs, parseAdr } from './lib/parse-adrs.mjs';
import {
  adrRecordKey,
  adrRecordValue,
  edgeKey,
  edgeValue,
  memoryStoreArgs,
  uniqueEdges,
} from './lib/index-records.mjs';

// #2781 (Jordi-Izquierdo-DDS): CLI_CORE=1 previously routed writes through
// `@claude-flow/cli-core@alpha`, whose JsonMemoryBackend lives in a different
// store than `@claude-flow/cli@latest`'s SQLite backend. The default
// `ruflo memory search` reader hits the SQLite store, so setting CLI_CORE=1
// for the ~2s cold-cache speedup silently made `import` succeed against a
// store the default reader never looks at ("147/147 stored" but zero hits
// in later searches). Unified on the default CLI so writer and reader
// always agree — the CLI_CORE env var is now honored as read-only/logged
// but no longer routes to a different package.
if (process.env.CLI_CORE === '1') {
  console.warn(
    '[ruflo-adr] warning: CLI_CORE=1 is ignored — writing to the default ' +
    "`@claude-flow/cli@latest` store so `ruflo memory search` can find the records (#2781).",
  );
}

const ROOT = process.env.ADR_ROOT || process.cwd();

function memoryStore(namespace, key, value) {
  // #2474 Bug 1 (fatal): ADR titles like "ADR-005 — Repository …" contain
  // a U+2014 em-dash. \`npm exec\` runs argv validation BEFORE handing args
  // to the underlying bin, and \`commander\`-style argv with a non-ASCII
  // dash that starts an arg makes it reject with:
  //   npm error arg Argument starts with non-ascii dash, this is probably invalid: — …
  // Result: every store failed → \`Records stored: 0/N\`.
  //
  // Use the \`--flag=value\` form so npm sees a single \`--value=…\` token
  // and doesn't try to interpret the leading character of the value.
  // This works on both legacy and current npm; the underlying CLI accepts
  // \`--flag=value\` and \`--flag value\` equivalently.
  // #2666 point 2: without `cwd: ROOT`, this subprocess inherits THIS
  // process's own cwd, so `ADR_ROOT=/other/repo node import.mjs` run from
  // anywhere else scans the right files but writes to the wrong
  // `.swarm/memory.db` (the CLI resolves the db path relative to the
  // subprocess's cwd, not ADR_ROOT). Every memory subprocess call in this
  // plugin must pass `cwd: ROOT` so the scan root and the db root agree.
  // #2660: pass --upsert explicitly. The importer owns stable logical keys,
  // so re-running it must refresh changed ADRs and relationships in place.
  // Do not depend on a CLI parser default for this data-integrity contract.
  const r = spawnSync('npx', memoryStoreArgs(namespace, key, value),
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) {
    return 'error: ' + (r.stderr || r.stdout || '').slice(0, 100);
  }
  return 'ok';
}

const dryRun = process.env.IMPORT_DRY_RUN === '1';
const fmt = process.env.IMPORT_FORMAT || 'markdown';

const files = findAdrs(ROOT);
const adrs = files.map((f) => parseAdr(f, ROOT));
const byId = new Map();
const parsedEdges = [];
for (const a of adrs) {
  byId.set(a.id, a);
  parsedEdges.push(...a.links);
}
const allEdges = uniqueEdges(parsedEdges);

let storedRecords = 0, storedEdges = 0;
const errors = [];
if (!dryRun) {
  for (const a of adrs) {
    const r = memoryStore('adr-patterns', adrRecordKey(a), adrRecordValue(a));
    if (r === 'ok') storedRecords++;
    else errors.push(`${a.id} ${a.file}: ${r}`);
  }
  for (const e of allEdges) {
    const r = memoryStore('adr-edges', edgeKey(e), edgeValue(e));
    if (r === 'ok') storedEdges++;
    else errors.push(`${edgeKey(e)}: ${r}`);
  }
}

const danglingRefs = allEdges.filter((e) => !byId.has(e.to));
const supersededIds = new Set(allEdges.filter((x) => x.relation === 'supersedes').map((x) => x.from));
const statusMismatches = [];
for (const id of supersededIds) {
  const a = byId.get(id);
  if (a && !/superseded/i.test(a.status)) statusMismatches.push({ id, status: a.status, file: a.file });
}

const byStatus = {};
for (const a of adrs) {
  const k = (a.status || 'unknown').toLowerCase();
  byStatus[k] = (byStatus[k] || 0) + 1;
}
const byRelation = {};
for (const e of allEdges) byRelation[e.relation] = (byRelation[e.relation] || 0) + 1;
const bySource = {};
for (const a of adrs) {
  const src = a.file.split('/docs/')[0];
  bySource[src] = (bySource[src] || 0) + 1;
}

const result = {
  scannedRoot: ROOT,
  total: adrs.length,
  sourceDirs: Object.keys(bySource).length,
  storedRecords, storedEdges, dryRun,
  byStatus, byRelation, bySource,
  edges: allEdges.length,
  danglingRefs, statusMismatches, errors,
};

if (fmt === 'json') {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log('## ADR Index Summary');
console.log('');
console.log(`Total ADRs: **${result.total}** across ${result.sourceDirs} source dirs (root: ${ROOT})`);
console.log(`Records stored to \`adr-patterns\`: ${result.storedRecords}/${result.total}${dryRun ? ' (dry-run, skipped)' : ''}`);
console.log(`Edges stored to \`adr-edges\`: ${result.storedEdges}/${result.edges}${dryRun ? ' (dry-run, skipped)' : ''}`);
console.log('');
console.log('### By status');
for (const [k, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${n}`);
console.log('');
console.log(`### Relationships: **${result.edges}** edges`);
for (const [k, n] of Object.entries(byRelation).sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${n}`);
console.log('');
console.log('### Issues found');
console.log(`- Dangling refs (edge → non-existent ADR): ${danglingRefs.length}`);
for (const d of danglingRefs.slice(0, 10)) console.log(`  - ${d.relation} ${d.from} → ${d.to} (missing)`);
console.log(`- Status mismatches (superseded but not marked): ${statusMismatches.length}`);
for (const m of statusMismatches.slice(0, 10)) console.log(`  - ${m.id} status='${m.status}' (${m.file})`);
console.log(`- Storage errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
console.log('');
console.log('### Source breakdown');
for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`- ${s}: ${n}`);
