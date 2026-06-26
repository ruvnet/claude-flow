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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

// ADR-100 / #1748 Issue 3 — CLI_CORE=1 routes to lite cli-core (~2s cold-cache).
// Note: cli-core's JsonMemoryBackend overwrites by default, so the
// "exists" / UNIQUE-constraint detection below collapses to "ok" under CLI_CORE.
// Re-running import in CLI_CORE mode is therefore idempotent (records refreshed)
// rather than incremental (records skipped). For incremental imports across
// many runs, leave CLI_CORE unset.
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ROOT = process.env.ADR_ROOT || process.cwd();
// `.claude` holds git worktrees (`.claude/worktrees/<name>/`) that are full repo
// copies — scanning them double/triple-counts every ADR. Skip it like build dirs.
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'v2', '.next', '.turbo', 'build']);

function findAdrs(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      findAdrs(p, out);
    } else if (e.endsWith('.md') && (p.includes('/docs/adr/') || p.includes('/docs/adrs/'))) {
      out.push(p);
    }
  }
  return out;
}

// Canonical ADR id used for BOTH node keys (parseId) and edge endpoints
// (extractAdrRefs). Without a single normalizer the two disagree on
// zero-padding: a `0001-foo.md` node was keyed `ADR-0001` while a
// `Supersedes: ADR-0001` ref resolved to `ADR-001`, so every edge to a
// 4-digit ADR was flagged as dangling. Strip the `ADR-` prefix, drop leading
// zeros, then pad back to a 3-digit minimum so `0001`, `ADR-0001` and `1` all
// collapse to `ADR-001`, while `097` stays `ADR-097`.
function normalizeAdrId(raw) {
  const digits = String(raw).replace(/^ADR[-\s]?/i, '').replace(/\D.*$/, '').replace(/^0+(?=\d)/, '');
  return digits ? `ADR-${digits.padStart(3, '0')}` : String(raw).toUpperCase();
}

// `npm exec` (the npx layer) re-validates forwarded args and rejects any token
// that starts with a non-ASCII dash (— – ―) as "probably invalid". ADR titles
// routinely use em-dashes ("ADR-005 — Title"), which made every `memory store`
// call fail with exit code 1 and persisted nothing. Normalize unicode dashes to
// an ASCII hyphen in CLI-bound strings.
function sanitizeForCli(s) {
  return typeof s === 'string' ? s.replace(/[‒–—―−]/g, '-') : s;
}

function parseAdr(path) {
  const text = readFileSync(path, 'utf-8');
  const id = parseId(path, text);
  const title = parseTitle(text);
  const status = parseStatus(text);
  const date = parseDate(text);
  const tags = parseTags(text);
  const context = parseContextFirstParagraph(text);
  const links = parseLinks(text, id);
  return { id, title, status, date, tags, context, links, file: path.replace(ROOT + '/', '') };
}

function parseId(path, text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^id:\s*(\S+)/m.exec(fm[1]);
    if (m) return normalizeAdrId(m[1]);
  }
  const fname = basename(path, '.md');
  const m = /^(ADR-?\d+|\d{3,4})/i.exec(fname);
  if (m) return normalizeAdrId(m[1]);
  return fname;
}

function parseTitle(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^title:\s*(.+)$/m.exec(fm[1]);
    if (m) return m[1].trim();
  }
  const m = /^#\s*(?:ADR-?\d+:?\s*)?(.+?)$/m.exec(text);
  return m ? m[1].trim() : '(untitled)';
}

function parseStatus(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^status:\s*(.+)$/im.exec(fm[1]);
    if (m) return m[1].trim();
  }
  // Pull the raw status string from one of two body forms, then reduce it to
  // its leading word. Both forms are widespread and the value is often adorned
  // with qualifiers the graph doesn't need ("Aceito — Fase 1 (...) em prod",
  // "Proposed (draft)"), so we keep only the first word ("Aceito", "Proposed").
  let raw = null;
  // Bold-line form: optional list marker ("- "), colon outside (`**Status**:`)
  // OR inside (`**Status:**`) the emphasis.
  const bold = /^\s*(?:[-*]\s+)?\*\*Status:?\*\*:?\s*(.+)$/mi.exec(text);
  if (bold) raw = bold[1];
  // Nygard-style `## Status` section: first non-empty line under the heading.
  if (raw === null) {
    const sec = /^#{1,6}\s*Status\s*$([\s\S]*?)(?=^#{1,6}\s|\Z)/m.exec(text);
    if (sec) raw = sec[1].split('\n').map((l) => l.trim()).find(Boolean) || '';
  }
  if (raw === null) return 'Unknown';
  const w = /^([A-Za-z][A-Za-z-]*)/.exec(raw.trim());
  return w ? w[1] : 'Unknown';
}

function parseDate(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^date:\s*(\S+)/m.exec(fm[1]);
    if (m) return m[1];
  }
  const m = /^\*\*Date\*\*:\s*(\S+)/m.exec(text);
  return m ? m[1] : '';
}

function parseTags(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^tags:\s*\[([^\]]+)\]/m.exec(fm[1]);
    if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const m = /^\*\*Tags\*\*:\s*(.+)$/m.exec(text);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function parseContextFirstParagraph(text) {
  const m = /^##\s*Context\s*$\s*([\s\S]+?)(?=^##\s|\Z)/m.exec(text);
  if (!m) return '';
  return m[1].trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ').slice(0, 400);
}

// Extract ADR-NNN references from a link line. CRITICAL: must distinguish ADR
// references from GitHub issue numbers (#1697 etc.) which the prior version
// false-positively captured as "ADR-1697". We only recognize bare numbers as
// ADR refs when they appear in a known ADR-link section AND they don't look
// like GitHub issues (no leading #, no leading "issue").
function parseLinks(text, selfId) {
  const out = [];
  // Frontmatter relationships
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    for (const [field, relation] of [
      ['supersedes', 'supersedes'],
      ['amended-by', 'amends'],
      ['amends', 'amends'],
      ['related', 'related'],
      ['depends-on', 'depends-on'],
    ]) {
      const re = new RegExp(`^${field}:\\s*\\[?([^\\]\\n]+)\\]?$`, 'mi');
      const m = re.exec(fm[1]);
      if (m) for (const ref of extractAdrRefs(m[1])) {
        if (relation === 'supersedes') out.push({ from: ref, to: selfId, relation });
        else out.push({ from: selfId, to: ref, relation });
      }
    }
  }
  // Body relationship lines. Accept the colon either outside (`**Supersedes**:`)
  // or inside (`**Supersedes:**`) the emphasis, plus an optional parenthetical
  // qualifier before it (`**Supersedes (partial):**`).
  const bodyRel = (label) =>
    new RegExp(`^\\s*(?:[-*]\\s+)?\\*\\*(?:${label})(?:\\s*\\([^)]*\\))?:?\\*\\*:?\\s*(.+)$`, 'mi').exec(text);
  const supersedes = bodyRel('Supersedes');
  if (supersedes) for (const ref of extractAdrRefs(supersedes[1])) out.push({ from: ref, to: selfId, relation: 'supersedes' });
  const amended = bodyRel('Amended[ -]by|Amends');
  if (amended) for (const ref of extractAdrRefs(amended[1])) out.push({ from: selfId, to: ref, relation: 'amends' });
  const related = bodyRel('Related');
  if (related) for (const ref of extractAdrRefs(related[1])) out.push({ from: selfId, to: ref, relation: 'related' });
  const dependsOn = bodyRel('Depends[ -]on');
  if (dependsOn) for (const ref of extractAdrRefs(dependsOn[1])) out.push({ from: selfId, to: ref, relation: 'depends-on' });
  return out;
}

function extractAdrRefs(s) {
  const refs = new Set();
  // Strip GitHub issue / commit references first to prevent false positives.
  const cleaned = s
    .replace(/#\d+/g, '')               // #1697
    .replace(/issue[s]?\s*\d+/gi, '')    // issue 1697
    .replace(/PR\s*\d+/gi, '')           // PR 1234
    .replace(/commit\s*[`a-f0-9]+/gi, '') // commit `abc123`
    .replace(/`[^`]*`/g, '');             // any backtick-quoted span
  const re = /\bADR-?(\d+)\b/gi;
  let m;
  while ((m = re.exec(cleaned))) refs.add(normalizeAdrId(m[1]));
  return [...refs];
}

function memoryStore(namespace, key, value) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'store',
    '--namespace', namespace,
    '--key', sanitizeForCli(key),
    '--value', sanitizeForCli(typeof value === 'string' ? value : JSON.stringify(value)),
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
  if (r.status !== 0) {
    if (/UNIQUE constraint/i.test(r.stderr || r.stdout || '')) return 'exists';
    return 'error: ' + (r.stderr || '').slice(0, 100);
  }
  return 'ok';
}

const dryRun = process.env.IMPORT_DRY_RUN === '1';
const fmt = process.env.IMPORT_FORMAT || 'markdown';

const files = findAdrs(ROOT);
const adrs = files.map(parseAdr);
const byId = new Map();
const allEdges = [];
for (const a of adrs) {
  byId.set(a.id, a);
  allEdges.push(...a.links);
}

let storedRecords = 0, storedEdges = 0;
const errors = [];
if (!dryRun) {
  // `memory store` fails with "Database not initialized" until the backend DB
  // exists. Without this, the first stores of every run are lost (the DB is only
  // created lazily) — initialize once up front so all records/edges persist.
  spawnSync('npx', [CLI_PKG, 'memory', 'init'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
  for (const a of adrs) {
    const r = memoryStore('adr-patterns', `${a.id}::${basename(a.file, '.md')}`,
      `${a.title} — ${a.context || '(no context)'}\n\nfile: ${a.file}\nstatus: ${a.status}\ndate: ${a.date}\ntags: ${a.tags.join(',')}`);
    if (r === 'ok' || r === 'exists') storedRecords++;
    else errors.push(`${a.id} ${a.file}: ${r}`);
  }
  for (const e of allEdges) {
    const key = `${e.relation}:${e.from}->${e.to}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = memoryStore('adr-edges', key, JSON.stringify({ ...e, capturedAt: new Date().toISOString() }));
    if (r === 'ok' || r === 'exists') storedEdges++;
    else errors.push(`edge ${e.relation} ${e.from}->${e.to}: ${r}`);
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
