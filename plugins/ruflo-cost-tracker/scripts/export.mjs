#!/usr/bin/env node
// cost-export — emit cost-tracking telemetry in formats consumable by
// external observability systems.
//
// Outputs:
//   --prometheus <path>   write Prometheus textfile-collector exposition
//   --webhook <url>       POST JSON payload (default Content-Type: application/json)
//   (no flag)             write JSON to stdout
//
// Env:
//   EXPORT_NAMESPACE=cost-tracking (default)
//   EXPORT_WEBHOOK_HEADER='Authorization: Bearer xxx'  optional, may repeat (comma-separated)
//   EXPORT_QUIET=1        suppress confirmation output (errors still printed)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// iter 73 — shared session-loader + memoryRetrieve. Iter 83 brought export.mjs
// into the consolidation (was missed in the original sweep).
import { memoryListAllKeys, memoryRetrieve, loadSessions } from './_sessions.mjs';

const NS = process.env.EXPORT_NAMESPACE || 'cost-tracking';

function gather() {
  const sessions = loadSessions(NS);
  const budgetKeys = memoryListAllKeys(NS).filter((k) => /^budget-config(-\d+)?$/.test(k)).sort().reverse();
  const budget = budgetKeys.length ? memoryRetrieve(NS, budgetKeys[0]) : null;
  const totalUsd = sessions.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const byTier = { haiku: 0, sonnet: 0, opus: 0, unknown: 0 };
  // iter 83 — track tokens per (tier, type). Without this Prometheus
  // consumers can see "haiku spent $X" but can't slice by "cache_write
  // growth on opus" — the exact iter-82 driver. byTierTokens lets
  // Grafana panels split spend by class.
  const byTierTokens = {
    haiku:   { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    sonnet:  { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    opus:    { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    unknown: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
  };
  for (const r of sessions) {
    if (r.byTier) for (const [t, v] of Object.entries(r.byTier)) byTier[t] = (byTier[t] || 0) + v;
    if (r.byModel) {
      for (const slot of Object.values(r.byModel)) {
        const tier = slot.tier || 'unknown';
        if (!byTierTokens[tier]) byTierTokens[tier] = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
        byTierTokens[tier].input       += slot.input_tokens || 0;
        byTierTokens[tier].output      += slot.output_tokens || 0;
        byTierTokens[tier].cache_write += slot.cache_creation_input_tokens || 0;
        byTierTokens[tier].cache_read  += slot.cache_read_input_tokens || 0;
      }
    }
  }
  return { sessions, budget, totalUsd, byTier, byTierTokens, exportedAt: new Date().toISOString() };
}

function escLabel(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function toPrometheus(data) {
  const lines = [];
  lines.push('# HELP cost_tracker_total_usd Total measured cost across all sessions in USD');
  lines.push('# TYPE cost_tracker_total_usd gauge');
  lines.push(`cost_tracker_total_usd ${data.totalUsd.toFixed(6)}`);
  lines.push('');
  lines.push('# HELP cost_tracker_tier_total_usd Total cost per tier across all sessions');
  lines.push('# TYPE cost_tracker_tier_total_usd gauge');
  for (const [tier, cost] of Object.entries(data.byTier)) {
    lines.push(`cost_tracker_tier_total_usd{tier="${escLabel(tier)}"} ${(cost || 0).toFixed(6)}`);
  }
  lines.push('');
  lines.push('# HELP cost_tracker_session_total_usd Cost per session in USD');
  lines.push('# TYPE cost_tracker_session_total_usd gauge');
  lines.push('# HELP cost_tracker_session_messages Assistant messages per session');
  lines.push('# TYPE cost_tracker_session_messages counter');
  for (const s of data.sessions) {
    const sid = (s.sessionId || '').slice(0, 8);
    lines.push(`cost_tracker_session_total_usd{session="${escLabel(sid)}"} ${(s.total_cost_usd || 0).toFixed(6)}`);
    lines.push(`cost_tracker_session_messages{session="${escLabel(sid)}"} ${s.messageCount || 0}`);
  }
  // iter 83 — per-tier-per-type token totals. Lets dashboards slice by:
  //   sum by (type) (cost_tracker_tokens_total)       — total cache_write everywhere
  //   sum by (tier) (cost_tracker_tokens_total)       — total tokens per tier
  //   cost_tracker_tokens_total{tier="opus",type="cache_write"}  — the iter-82 driver
  lines.push('');
  lines.push('# HELP cost_tracker_tokens_total Total tokens per tier and type (input/output/cache_write/cache_read)');
  lines.push('# TYPE cost_tracker_tokens_total counter');
  for (const [tier, perType] of Object.entries(data.byTierTokens || {})) {
    for (const [type, count] of Object.entries(perType)) {
      if (count > 0) {
        lines.push(`cost_tracker_tokens_total{tier="${escLabel(tier)}",type="${escLabel(type)}"} ${count}`);
      }
    }
  }
  if (data.budget?.budget_usd) {
    lines.push('');
    lines.push('# HELP cost_tracker_budget_usd Configured budget limit in USD');
    lines.push('# TYPE cost_tracker_budget_usd gauge');
    lines.push(`cost_tracker_budget_usd ${data.budget.budget_usd.toFixed(2)}`);
    lines.push('# HELP cost_tracker_budget_utilization Spent / budget ratio (0.0–∞)');
    lines.push('# TYPE cost_tracker_budget_utilization gauge');
    lines.push(`cost_tracker_budget_utilization ${(data.totalUsd / data.budget.budget_usd).toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}

async function postWebhook(url, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.EXPORT_WEBHOOK_HEADER) {
    for (const h of process.env.EXPORT_WEBHOOK_HEADER.split(',')) {
      const [k, ...rest] = h.split(':');
      if (k && rest.length) headers[k.trim()] = rest.join(':').trim();
    }
  }
  const resp = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(data),
  });
  return { status: resp.status, ok: resp.ok };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let prometheus = null, webhook = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prometheus') prometheus = args[++i];
    else if (args[i] === '--webhook') webhook = args[++i];
  }
  return { prometheus, webhook };
}

async function main() {
  const { prometheus, webhook } = parseArgs();
  const data = gather();
  if (process.env.EXPORT_QUIET !== '1') {
    console.error(`Exported ${data.sessions.length} sessions, total $${data.totalUsd.toFixed(2)}`);
  }
  if (prometheus) {
    mkdirSync(dirname(prometheus), { recursive: true });
    writeFileSync(prometheus, toPrometheus(data));
    if (process.env.EXPORT_QUIET !== '1') console.error(`Wrote Prometheus textfile: ${prometheus}`);
  }
  if (webhook) {
    const r = await postWebhook(webhook, data);
    if (!r.ok) {
      console.error(`Webhook POST failed: HTTP ${r.status}`);
      process.exit(1);
    }
    if (process.env.EXPORT_QUIET !== '1') console.error(`Webhook POST ok (HTTP ${r.status})`);
  }
  if (!prometheus && !webhook) {
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch((e) => { console.error('export failed:', e.message || e); process.exit(1); });
