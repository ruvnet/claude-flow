#!/usr/bin/env node
// ADR-391 router corpus validator. No dependencies.
// Usage: node validate-corpus.mjs [path/to/corpus.jsonl]
// Exits 1 on any failure; prints per-label x split counts and the sha256.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'corpus.jsonl');
const LABELS = ['coder', 'tester', 'reviewer', 'researcher', 'architect', 'security-architect',
  'performance-engineer', 'devops', 'swarm-specialist', 'memory-specialist', 'none'];
const MIN_PER_LABEL = 8;
const NONE_RANGE = [15, 20];
const TOTAL_RANGE = [180, 200];
const MIN_TRAPS = 30;

const buf = readFileSync(path);
const sha = createHash('sha256').update(buf).digest('hex');
const text = buf.toString('utf8');
const errors = [];
if (text.includes('\r')) errors.push('file contains CR characters (must be LF only)');
if (!text.endsWith('\n') || text.endsWith('\n\n')) errors.push('file must end with exactly one trailing newline');

const rows = [];
text.split('\n').forEach((line, i) => {
  if (line === '') return;
  try { rows.push(JSON.parse(line)); } catch (e) { errors.push(`line ${i + 1}: invalid JSON (${e.message})`); }
});

const ids = new Set();
for (const r of rows) {
  const where = r.id ?? '(no id)';
  if (typeof r.id !== 'string' || !/^r\d{3}$/.test(r.id)) errors.push(`${where}: id must match ^r\\d{3}$`);
  else if (ids.has(r.id)) errors.push(`${where}: duplicate id`);
  else ids.add(r.id);
  if (typeof r.prompt !== 'string' || r.prompt.trim() === '') errors.push(`${where}: empty prompt`);
  if (!LABELS.includes(r.label)) errors.push(`${where}: unknown label ${JSON.stringify(r.label)}`);
  if (r.split !== 'dev' && r.split !== 'test') errors.push(`${where}: split must be dev|test`);
  if (typeof r.trap !== 'boolean') errors.push(`${where}: trap must be boolean`);
  if (!['issue', 'pr', 'synthetic'].includes(r.source)) errors.push(`${where}: source must be issue|pr|synthetic`);
  if (typeof r.note !== 'string' || r.note.trim() === '') errors.push(`${where}: note required`);
}

const prompts = new Set();
for (const r of rows) {
  const k = String(r.prompt).trim().toLowerCase();
  if (prompts.has(k)) errors.push(`${r.id}: duplicate prompt`);
  prompts.add(k);
}

// Recompute the documented split rule: within each label, sort by id;
// 0-indexed position i -> dev iff i % 5 is 0 or 2, else test.
const byLabel = Object.fromEntries(LABELS.map((l) => [l, []]));
for (const r of rows) if (byLabel[r.label]) byLabel[r.label].push(r);
for (const list of Object.values(byLabel)) {
  [...list].sort((a, b) => a.id.localeCompare(b.id)).forEach((r, i) => {
    const want = i % 5 === 0 || i % 5 === 2 ? 'dev' : 'test';
    if (r.split !== want) errors.push(`${r.id}: split is ${r.split}, split rule says ${want}`);
  });
}

// Thresholds
if (rows.length < TOTAL_RANGE[0] || rows.length > TOTAL_RANGE[1]) errors.push(`total ${rows.length} outside ${TOTAL_RANGE.join('-')}`);
for (const l of LABELS) {
  const n = byLabel[l].length;
  if (l === 'none') { if (n < NONE_RANGE[0] || n > NONE_RANGE[1]) errors.push(`none has ${n}, want ${NONE_RANGE.join('-')}`); }
  else if (n < MIN_PER_LABEL) errors.push(`${l} has ${n}, want >= ${MIN_PER_LABEL}`);
}
const traps = rows.filter((r) => r.trap === true).length;
if (traps < MIN_TRAPS) errors.push(`only ${traps} trap cases, want >= ${MIN_TRAPS}`);

// Report
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('label', 22) + pad('dev', 6) + pad('test', 6) + pad('total', 7) + 'traps');
let dev = 0, test = 0;
for (const l of LABELS) {
  const d = byLabel[l].filter((r) => r.split === 'dev').length;
  const t = byLabel[l].filter((r) => r.split === 'test').length;
  dev += d; test += t;
  console.log(pad(l, 22) + pad(d, 6) + pad(t, 6) + pad(d + t, 7) + byLabel[l].filter((r) => r.trap).length);
}
console.log(pad('TOTAL', 22) + pad(dev, 6) + pad(test, 6) + pad(rows.length, 7) + traps);
console.log(`sha256  ${sha}  ${path}`);

if (errors.length) {
  console.error(`\nFAIL (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('OK');
