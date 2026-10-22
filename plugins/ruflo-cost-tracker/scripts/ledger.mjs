#!/usr/bin/env node
// cost-ledger — one cost view across Claude Code, Codex and Grok logs on this machine.
//
//   node ledger.mjs [--since 7d|24h|all] [--provider claude|codex|grok|all] [--format json|markdown] [--advise]
//   --advise adds the optimisation findings (advise.mjs) from the same single pass over the logs.
//   --from <ISO> --to <ISO> --project </abs/path> narrow the rows to a time window (inclusive) and to one project
//   (row.project is the path or inside it); JSON then carries `window`. A bad ISO time or a relative path exits 2.
//
// Reads local logs only; sends nothing anywhere. Prices come from data/prices.json
// (dated). USD and Codex credits are NEVER added together, and an unpriced model
// is listed, not counted as $0.

import { collect } from './_ledger.mjs';
import { priceUsage, bookDate } from './_pricebook.mjs';
import { parseDurationMs } from './_sessions.mjs';
import { advise } from './advise.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };

/** Aggregate priced rows. Exported so advise.mjs and tests share one definition. */
export function summarise(rows) {
  const out = { totals: {}, byProvider: {}, byModel: {}, byDay: {}, unpriced: {}, approx: [], cache: {}, rows: rows.length };
  const add = (bucket, key, unit, cost) => { bucket[key] ??= {}; bucket[key][unit] = (bucket[key][unit] ?? 0) + cost; };
  const tok = (bucket, key, row) => {
    const t = (bucket[key] ??= { input: 0, cache_read: 0, cache_write: 0, output: 0, messages: 0 });
    t.input += row.input; t.cache_read += row.cache_read; t.cache_write += row.cache_write_5m + row.cache_write_1h; t.output += row.output; t.messages += 1;
  };
  const tokens = {};
  const approx = new Set();
  for (const row of rows) {
    const p = priceUsage(row.model, row, row.provider);
    const day = new Date(row.ts).toISOString().slice(0, 10);
    tok(tokens, `${row.provider}|${row.model}`, row);
    if (!p.priced) { const u = (out.unpriced[row.model] ??= { provider: row.provider, messages: 0, tokens: 0 }); u.messages += 1; u.tokens += row.input + row.cache_read + row.output; continue; }
    if (p.approx) approx.add(row.model);
    add(out.byProvider, row.provider, p.unit, p.cost);
    add(out.byModel, `${row.provider}|${row.model}`, p.unit, p.cost);
    add(out.byDay, day, p.unit, p.cost);
    out.totals[p.unit] = (out.totals[p.unit] ?? 0) + p.cost;
  }
  out.approx = [...approx];
  out.tokens = tokens;
  for (const provider of new Set(rows.map(row => row.provider))) {
    const mine = rows.filter(row => row.provider === provider);
    const read = mine.reduce((sum, row) => sum + row.cache_read, 0);
    const fresh = mine.reduce((sum, row) => sum + row.input + row.cache_write_5m + row.cache_write_1h, 0);
    out.cache[provider] = { hitRatio: read + fresh > 0 ? read / (read + fresh) : null, read, fresh };
  }

  return out;
}

const money = (value, unit) => (unit === 'usd' ? `$${value.toFixed(2)}` : `${value.toFixed(0)} credits`);

function markdown(summary, meta) {
  const lines = [`# Cost ledger (${meta.since}, prices as of ${meta.priceDate})`, ''];
  lines.push(`Totals: ${Object.entries(summary.totals).map(([unit, value]) => money(value, unit)).join(' + ') || 'n/a'} · ${summary.rows} messages · estimates at list price, not bills`, '');
  lines.push('| Provider · model | Cost | Msgs | Input | Cache read | Cache write | Output |', '|---|---|---|---|---|---|---|');
  for (const [key, cost] of Object.entries(summary.byModel).sort((a, b) => Object.values(b[1])[0] - Object.values(a[1])[0])) {
    const t = summary.tokens[key];
    lines.push(`| ${key.replaceAll('|', ' · ')} | ${Object.entries(cost).map(([unit, value]) => money(value, unit)).join(', ')} | ${t.messages} | ${t.input} | ${t.cache_read} | ${t.cache_write} | ${t.output} |`);
  }
  for (const [provider, cache] of Object.entries(summary.cache)) lines.push('', `Cache hit ratio · ${provider}: ${cache.hitRatio === null ? 'n/a' : `${(cache.hitRatio * 100).toFixed(1)}%`}`);
  const dark = Object.entries(summary.unpriced);
  if (dark.length > 0) lines.push('', `Unpriced (NOT counted as $0): ${dark.map(([model, u]) => `${model} (${u.messages} msgs)`).join(', ')} — add them to data/prices.json`);
  if (summary.approx.length > 0) lines.push('', `Approximate (family fallback or list price; Grok subscription billing may differ): ${summary.approx.join(', ')}`);
  lines.push('', 'Claude output tokens come from the transcript, which can under-count streamed output; /usage is authoritative for the live session.');

  return lines.join('\n');
}

const bad = message => { console.error(`ledger: ${message}`); process.exit(2); };

/** An ISO time as epoch ms; anything else (relative words, bare numbers, a missing value) exits 2. */
function isoMs(name) {
  const value = arg(name);
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) bad(`--${name} needs an ISO time such as 2026-10-04T09:30:00Z`);

  return Date.parse(value);
}

/** An absolute POSIX path with no control characters or `..`; anything else exits 2. */
function absolutePath(name) {
  const value = arg(name);
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f\u007f]/.test(value) || value.split('/').includes('..')) bad(`--${name} needs an absolute path with no '..'`);

  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const given = name => process.argv.includes(`--${name}`);
  const fromMs = given('from') ? isoMs('from') : null;
  const toMs = given('to') ? isoMs('to') : null;
  const project = given('project') ? absolutePath('project') : null;
  if (fromMs !== null && toMs !== null && fromMs > toMs) bad('--from is after --to');
  const windowed = fromMs !== null || toMs !== null || project !== null;

  // An explicit window replaces the default 7-day look-back; an explicit --since still narrows it.
  const sinceSpec = given('since') || !windowed ? arg('since', '7d') : 'window';
  const spanMs = sinceSpec === 'all' || sinceSpec === 'window' ? 0 : Date.now() - (parseDurationMs(sinceSpec) ?? 7 * 86_400_000);
  const sinceMs = Math.max(spanMs, fromMs ?? 0);
  const providers = arg('provider', 'all') === 'all' ? undefined : [arg('provider')];
  const rows = collect({ providers, sinceMs, ...(toMs !== null && { untilMs: toMs }), ...(project !== null && { project }) });
  const summary = summarise(rows);
  const meta = { since: sinceSpec, priceDate: bookDate() };
  const findings = process.argv.includes('--advise') ? advise(rows) : undefined;
  const window = windowed ? { window: { from: fromMs === null ? null : new Date(fromMs).toISOString(), to: toMs === null ? null : new Date(toMs).toISOString(), project } } : {};

  console.log(arg('format', 'markdown') === 'json' ? JSON.stringify({ ...meta, ...summary, ...window, ...(findings && { findings }) }, null, 2) : markdown(summary, meta));
}
