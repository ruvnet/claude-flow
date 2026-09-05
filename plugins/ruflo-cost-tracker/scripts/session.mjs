#!/usr/bin/env node
// cost-session — per-message cost breakdown for a single session.
//
// cost-anomaly identifies WHICH sessions are outliers ($spend distribution).
// cost-conversation lists ALL sessions and their totals.
// This skill answers: given ONE session (especially an outlier), WHICH
// MESSAGES within it were expensive?
//
// METHOD
//   1. Resolve the session jsonl: `--session-id <id>` or `--latest` (default).
//   2. Parse all assistant messages with `usage` blocks.
//   3. Cost each message via the shared PRICING table (_prices.mjs).
//   4. Sort by cost descending, surface top-N.
//   5. Output: total + per-message breakdown + cost-percentile context.
//
// Pairs with cost-anomaly: when a session is flagged as a >3.5σ outlier,
// `cost session --session-id <flagged-id>` shows the expensive messages.
//
// USAGE
//   node scripts/session.mjs                           # latest session (default --top 20)
//   node scripts/session.mjs --session-id <id>         # by id (searches all project dirs)
//   node scripts/session.mjs --top 10                  # show top N
//   node scripts/session.mjs --since 2026-06-15        # filter by ISO timestamp
//   node scripts/session.mjs --format json
//
// EXIT CODES
//   0  success
//   2  config error or session not found

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
// iter 73 — shared PRICING + cost helpers.
import { modelTier, costForUsage } from './_prices.mjs';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const ARGS = (() => {
  const a = { sessionId: null, top: 20, since: null, format: 'table' };
  if (process.env.SESSION_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--session-id') a.sessionId = process.argv[++i];
    else if (v === '--top') a.top = parseInt(process.argv[++i], 10);
    else if (v === '--since') a.since = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--latest') a.sessionId = null;
  }
  return a;
})();

function listAllJsonls() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const proj of readdirSync(PROJECTS_DIR)) {
    const projDir = join(PROJECTS_DIR, proj);
    let stat;
    try { stat = statSync(projDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = readdirSync(projDir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(projDir, f);
      let st;
      try { st = statSync(path); } catch { continue; }
      out.push({ path, mtime: st.mtimeMs, project: proj });
    }
  }
  return out;
}

function findSessionJsonl(sessionId) {
  const all = listAllJsonls();
  if (!sessionId) {
    // --latest: pick the most-recently-modified jsonl
    if (all.length === 0) return null;
    return all.sort((a, b) => b.mtime - a.mtime)[0];
  }
  // Scan each jsonl for the sessionId. Most jsonls contain a single
  // sessionId across all their messages, so reading the first line is
  // usually enough — but fall back to a full scan if needed.
  for (const f of all) {
    let head;
    try { head = readFileSync(f.path, 'utf-8').split('\n').slice(0, 5).join('\n'); }
    catch { continue; }
    if (head.includes(`"sessionId":"${sessionId}"`)) return f;
  }
  return null;
}

function summarizeMessages(jsonlPath) {
  const text = readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  const messages = [];
  let sinceMs = null;
  if (ARGS.since) {
    const t = Date.parse(ARGS.since);
    if (Number.isFinite(t)) sinceMs = t;
  }
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'assistant' || !m.message?.usage) continue;
    if (sinceMs !== null && m.timestamp && new Date(m.timestamp).getTime() < sinceMs) continue;
    const model = m.message.model || 'unknown';
    const tier = modelTier(model);
    const u = m.message.usage;
    const cost = costForUsage(tier, u);
    messages.push({
      timestamp: m.timestamp || null,
      model,
      tier,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
      cost_usd: cost,
    });
  }
  return messages;
}

function main() {
  if (!Number.isInteger(ARGS.top) || ARGS.top < 1) {
    console.error(`cost-session: --top must be a positive integer; got ${ARGS.top}`);
    process.exit(2);
  }
  const sessionFile = findSessionJsonl(ARGS.sessionId);
  if (!sessionFile) {
    console.error(`cost-session: ${ARGS.sessionId ? `no session matches id "${ARGS.sessionId}"` : 'no sessions found'}`);
    process.exit(2);
  }
  const messages = summarizeMessages(sessionFile.path);
  if (messages.length === 0) {
    if (ARGS.format === 'json') {
      console.log(JSON.stringify({
        sessionFile: sessionFile.path,
        sessionId: ARGS.sessionId,
        messageCount: 0,
        total_cost_usd: 0,
        messages: [],
        topByMessage: [],
        generatedAt: new Date().toISOString(),
      }, null, 2));
    } else {
      console.log(`# cost-session\n\n_No costed assistant messages in \`${sessionFile.path}\`._\n`);
    }
    return;
  }

  const total = messages.reduce((s, m) => s + m.cost_usd, 0);
  const sorted = messages.slice().sort((a, b) => b.cost_usd - a.cost_usd);
  const top = sorted.slice(0, ARGS.top);

  // Cost percentile context — p50/p90/p99 of message costs.
  const ascending = messages.map((m) => m.cost_usd).sort((a, b) => a - b);
  const pct = (q) => {
    const idx = Math.floor(q * (ascending.length - 1));
    return ascending[idx] || 0;
  };
  const percentiles = { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) };

  const payload = {
    sessionFile: sessionFile.path,
    sessionId: ARGS.sessionId,
    filters: { top: ARGS.top, since: ARGS.since },
    messageCount: messages.length,
    total_cost_usd: Math.round(total * 1e6) / 1e6,
    percentiles: {
      p50_cost_usd: Math.round(percentiles.p50 * 1e6) / 1e6,
      p90_cost_usd: Math.round(percentiles.p90 * 1e6) / 1e6,
      p99_cost_usd: Math.round(percentiles.p99 * 1e6) / 1e6,
    },
    topByMessage: top.map((m, i) => ({
      rank: i + 1,
      timestamp: m.timestamp,
      model: m.model,
      tier: m.tier,
      input_tokens: m.input_tokens,
      output_tokens: m.output_tokens,
      // iter 82 — surface cache_creation_input_tokens too. Without it,
      // big cache-write costs (e.g. opus @ 881K tokens = $16) look like
      // a 569-token output costing $16, which is misleading.
      cache_creation_input_tokens: m.cache_creation_input_tokens,
      cache_read_input_tokens: m.cache_read_input_tokens,
      cost_usd: Math.round(m.cost_usd * 1e6) / 1e6,
      pctOfSession: total > 0 ? Math.round((m.cost_usd / total) * 10000) / 100 : 0,
    })),
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# cost-session — ${sessionFile.path.split('/').pop()}`);
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Session file | \`${sessionFile.path}\` |`);
  console.log(`| Assistant messages | ${messages.length} |`);
  console.log(`| **Total cost** | **$${total.toFixed(6)}** |`);
  console.log(`| Median (p50) message | $${percentiles.p50.toFixed(6)} |`);
  console.log(`| p90 message | $${percentiles.p90.toFixed(6)} |`);
  console.log(`| p99 message | $${percentiles.p99.toFixed(6)} |`);
  console.log('');
  console.log(`## Top ${Math.min(ARGS.top, messages.length)} most expensive messages`);
  console.log('');
  console.log('| # | Timestamp | Model | Tier | In | Out | Cache W | Cache R | Cost | % session |');
  console.log('|---:|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const m of payload.topByMessage) {
    const tsShort = m.timestamp ? m.timestamp.slice(0, 19).replace('T', ' ') : '—';
    const modelShort = m.model.length > 30 ? m.model.slice(0, 27) + '…' : m.model;
    console.log(`| ${m.rank} | ${tsShort} | \`${modelShort}\` | ${m.tier} | ${m.input_tokens} | ${m.output_tokens} | ${m.cache_creation_input_tokens} | ${m.cache_read_input_tokens} | $${m.cost_usd.toFixed(6)} | ${m.pctOfSession.toFixed(2)}% |`);
  }
  console.log('');
  if (top[0].cost_usd > percentiles.p99 * 2) {
    console.log(`_The top message is >2× the p99 of this session — that's an in-session outlier; check the prompt content._`);
    console.log('');
  }
}

main();
