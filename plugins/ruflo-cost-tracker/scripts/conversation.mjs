#!/usr/bin/env node
// cost-conversation — list all session records in the cost-tracking namespace
// and show cost-per-conversation. Until now reports were per-agent / per-model;
// this gives a per-conversation timeline.
//
// Usage:
//   node scripts/conversation.mjs                    # markdown table
//   CONV_FORMAT=json node scripts/conversation.mjs   # JSON
//   CONV_LIMIT=20 node scripts/conversation.mjs      # most recent N
//   CONV_NAMESPACE=cost-tracking (default)

// iter 73 — shared session-loader (was duplicated across 6 scripts).
// ADR-100 / #1748 Issue 3 — CLI_CORE=1 routes to lite cli-core (~2s cold-cache).
import { loadSessions, memoryListSessionKeys } from './_sessions.mjs';

const NS = process.env.CONV_NAMESPACE || 'cost-tracking';

function fmtUsd(n) { return `$${(n || 0).toFixed(4)}`; }
function fmtTs(s) { return s ? new Date(s).toISOString().replace('T', ' ').replace(/\.\d+Z/, '') : ''; }
function topModel(byModel) {
  const entries = Object.entries(byModel || {}).sort((a, b) => (b[1].cost_usd || 0) - (a[1].cost_usd || 0));
  return entries[0]?.[0] || '—';
}

function main() {
  const keys = memoryListSessionKeys(NS);
  if (!keys.length) {
    console.log(`No sessions in '${NS}'. Run \`cost track\` first.`);
    return;
  }
  const records = loadSessions(NS);
  records.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));

  const limit = parseInt(process.env.CONV_LIMIT || '50', 10);
  const recent = records.slice(-limit);

  const total = records.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const byTier = { haiku: 0, sonnet: 0, opus: 0, unknown: 0 };
  for (const r of records) {
    if (r.byTier) {
      for (const [t, v] of Object.entries(r.byTier)) byTier[t] = (byTier[t] || 0) + v;
    }
  }

  if (process.env.CONV_FORMAT === 'json') {
    console.log(JSON.stringify({
      conversationCount: records.length,
      shownCount: recent.length,
      total_cost_usd: total,
      byTier,
      conversations: recent,
    }, null, 2));
    return;
  }

  console.log(`# cost-per-conversation — ${records.length} conversations in '${NS}'`);
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Conversations tracked | ${records.length} |`);
  console.log(`| **Total cost (all)** | **${fmtUsd(total)}** |`);
  for (const t of ['haiku', 'sonnet', 'opus', 'unknown']) {
    if (byTier[t] > 0) console.log(`| Tier ${t} | ${fmtUsd(byTier[t])} |`);
  }
  console.log('');
  console.log(`## ${recent.length === records.length ? 'All' : 'Most recent ' + recent.length} conversations`);
  console.log('');
  console.log('| Started | Session | Messages | Top model | Cost |');
  console.log('|---|---|---:|---|---:|');
  for (const r of recent) {
    const sid = (r.sessionId || '').slice(0, 8);
    console.log(`| ${fmtTs(r.startedAt)} | \`${sid}\` | ${r.messageCount || 0} | \`${topModel(r.byModel)}\` | ${fmtUsd(r.total_cost_usd)} |`);
  }
}

main();
