#!/usr/bin/env node
// cost-advise — optimisation findings from YOUR logs, each with evidence.
//
//   node advise.mjs [--since 7d] [--provider claude|codex|all] [--format json|markdown]
//
// Savings are what-if repricings of tokens you actually used (same tokens, other
// rate); a finding with no defensible figure says "n/a" rather than inventing one.
// Nothing is changed and nothing is sent anywhere.

import { collect } from './_ledger.mjs';
import { priceUsage, downshift, lookup } from './_pricebook.mjs';
import { parseDurationMs } from './_sessions.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
const cost = row => priceUsage(row.model, row, row.provider);

/** Findings, largest saving first. Pure: rows in, findings out. */
export function advise(rows) {
  const out = [];
  const priced = rows.map(row => ({ row, p: cost(row) }));

  // 1. Unpriced models: spend the numbers cannot see.
  const dark = [...new Set(priced.filter(x => !x.p.priced).map(x => x.row.model))];
  if (dark.length > 0) out.push({ id: 'unpriced', unit: null, saving: null, title: `${dark.length} model(s) have no price, so their spend is not counted`, evidence: dark.join(', '), action: 'Add them to data/prices.json (or set COST_PRICES) so totals and advice include them.' });

  // 2. Low cache hit ratio per provider: the largest controllable lever.
  for (const provider of new Set(rows.map(row => row.provider))) {
    const mine = rows.filter(row => row.provider === provider);
    const read = sum(mine, row => row.cache_read);
    const fresh = sum(mine, row => row.input + row.cache_write_5m + row.cache_write_1h);
    if (read + fresh < 5e6 || read / (read + fresh) >= 0.8) continue;
    out.push({ id: `cache-${provider}`, unit: null, saving: null, title: `${provider}: only ${(100 * read / (read + fresh)).toFixed(0)}% of input tokens were cache reads`, evidence: `${read} cached vs ${fresh} fresh input tokens`, action: 'Keep the system prompt, tool list, model and effort stable within a session; avoid mid-session MCP/tool changes; /clear between unrelated tasks.' });
  }

  // 3. 1-hour cache writes that were barely re-read: they cost 2x the 5-minute write.
  const claude = priced.filter(x => x.row.provider === 'claude' && x.p.priced && x.row.cache_write_1h > 0);
  if (claude.length > 0) {
    const w1 = sum(claude, x => x.row.cache_write_1h);
    const reads = sum(claude, x => x.row.cache_read);
    const extra = sum(claude, x => (x.row.cache_write_1h / 1e6) * (x.p.entry.cache_write_1h - x.p.entry.cache_write_5m));
    if (reads / Math.max(1, w1) < 2 && extra > 0.5) out.push({ id: 'ttl-1h', unit: 'usd', saving: extra, title: '1-hour cache writes were not re-read enough to pay back', evidence: `${w1} 1h-written tokens, ${reads} read back (a 1h write needs about two reads to beat a 5m write)`, action: 'Use the 5-minute TTL (CLAUDE_CODE_PROMPT_CACHE_TTL) for bursty or short sessions.' });
  }

  // 4. Sub-agents on a top-tier model: what-if one tier down. (Per-turn output size is NOT used: transcript output counts are placeholders.)
  const side = new Map();
  for (const { row, p } of priced) {
    if (!row.sidechain || !p.priced) continue;
    const down = downshift(row.model, row.provider);
    if (down === null) continue;
    const there = priceUsage(down, row, row.provider);
    const s = side.get(row.model) ?? { from: row.model, to: down, now: 0, then: 0, n: 0, unit: p.unit };
    s.now += p.cost; s.then += there.cost; s.n += 1;
    side.set(row.model, s);
  }
  for (const s of side.values()) if (s.now - s.then > 1) out.push({ id: `subagents-${s.from}`, unit: s.unit, saving: s.now - s.then, title: `Sub-agents ran on ${s.from}`, evidence: `${s.n} sub-agent messages; same tokens on ${s.to} would cost ${s.then.toFixed(2)} vs ${s.now.toFixed(2)}`, action: `Give simple sub-agents model: ${lookup(s.to)?.id ?? s.to}; keep the top tier for the lead. Quality is not measured here: spot-check before switching.` });

  // 5. Codex reasoning share: reasoning tokens bill as output.
  const codex = rows.filter(row => row.provider === 'codex' && row.output > 0);
  const out_ = sum(codex, row => row.output);
  if (codex.length > 20 && sum(codex, row => row.reasoning) / out_ > 0.7) out.push({ id: 'codex-effort', unit: null, saving: null, title: `Codex: ${(100 * sum(codex, row => row.reasoning) / out_).toFixed(0)}% of output tokens are reasoning`, evidence: `${sum(codex, row => row.reasoning)} of ${out_} output tokens`, action: 'Try model_reasoning_effort = "low" or "medium" for routine edits; keep high for hard problems. Savings are not estimated: no measured delta exists.' });

  // 6. Context bloat: sessions whose average turn re-reads a very large cached prefix.
  const bySession = new Map();
  for (const row of rows) { const s = bySession.get(row.session) ?? { cache: 0, n: 0, provider: row.provider }; s.cache += row.cache_read; s.n += 1; bySession.set(row.session, s); }
  const heavy = [...bySession.entries()].filter(([, s]) => s.n >= 30 && s.cache / s.n > 400_000).sort((a, b) => b[1].cache - a[1].cache).slice(0, 3);
  if (heavy.length > 0) out.push({ id: 'context-bloat', unit: null, saving: null, title: `${heavy.length} long session(s) re-read a very large context every turn`, evidence: heavy.map(([id, s]) => `${String(id).slice(0, 8)} ${s.provider}: ${Math.round(s.cache / s.n / 1000)}k cached tokens/turn over ${s.n} turns`).join('; '), action: '/compact at a natural break while the cache is warm, or /clear between tasks; move workflow text from CLAUDE.md into skills.' });

  return out.sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1));
}

const fmt = f => (f.saving === null ? 'saving n/a' : `up to ${f.unit === 'usd' ? '$' : ''}${f.saving.toFixed(2)}${f.unit === 'usd' ? '' : ' credits'} over the window`);

if (import.meta.url === `file://${process.argv[1]}`) {
  const spec = arg('since', '7d');
  const sinceMs = spec === 'all' ? 0 : Date.now() - (parseDurationMs(spec) ?? 7 * 86_400_000);
  const providers = arg('provider', 'all') === 'all' ? undefined : [arg('provider')];
  const findings = advise(collect({ providers, sinceMs }));

  if (arg('format', 'markdown') === 'json') console.log(JSON.stringify({ since: spec, findings }, null, 2));
  else console.log([`# Cost advice (${spec})`, '', ...(findings.length === 0 ? ['No findings: nothing in this window crosses a threshold.'] : findings.flatMap((f, i) => [`${i + 1}. **${f.title}** — ${fmt(f)}`, `   - evidence: ${f.evidence}`, `   - do: ${f.action}`])), '', 'What-if figures reprice the same tokens at another rate; they do not predict quality or future usage.'].join('\n'));
}
