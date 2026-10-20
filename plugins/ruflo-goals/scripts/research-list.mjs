#!/usr/bin/env node
// research-list.mjs — print the newest deep-research records (ADR-438) as JSON.
//
// CONTRACT
//   stdout: { "version": 1, "records": [ { key, ...record } ] }  newest first
//   flags:  --limit N (default 20, max 100); --fixture <file> reads
//           [{key, value}] from a file instead of the memory CLI (tests)
//   Never throws: a missing CLI or empty namespace prints {version:1,records:[]}.
//   Records that are not valid version-1 research records are skipped.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runCli } from './lib/ruflo-cli.mjs';

const NAMESPACE = 'research';

// #3558: the installed ruflo CLI first, npx @latest only as the fallback
// (lib/ruflo-cli.mjs), so this reads the store deep-research wrote.
function cli(args) {
  return runCli(args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
}

function cliLoad() {
  const r = cli(['memory', 'list', '--namespace', NAMESPACE, '--format', 'json']);
  if (r.status !== 0) return [];
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return [];
  let entries;
  try { entries = JSON.parse(m[0]); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (typeof e?.key !== 'string' || !e.key.startsWith('research-')) continue;
    const g = cli(['memory', 'retrieve', '--namespace', NAMESPACE, '--key', e.key, '--value-only']);
    if (g.status === 0) out.push({ key: e.key, value: (g.stdout || '').trim() });
  }
  return out;
}

export function parseRecord(key, value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || v.version !== 1 || typeof v.question !== 'string') return null;
  if (!['done', 'truncated', 'failed'].includes(v.status)) return null;
  if (!Array.isArray(v.findings) || Number.isNaN(Date.parse(v.at))) return null;
  return { key, ...v };
}

export function listRecords(entries, limit = 20) {
  const n = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 20, 1), 100);
  const records = entries
    .map((e) => parseRecord(e.key, e.value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { version: 1, records: records.slice(0, n) };
}

function main(argv) {
  let limit = 20;
  let fixture = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--fixture') fixture = argv[++i];
  }
  let entries = [];
  try { entries = fixture ? JSON.parse(readFileSync(fixture, 'utf-8')) : cliLoad(); } catch { entries = []; }
  process.stdout.write(JSON.stringify(listRecords(entries, limit)) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
