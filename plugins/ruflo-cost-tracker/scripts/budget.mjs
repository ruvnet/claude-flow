#!/usr/bin/env node
// cost-budget — set / get / check the project's cost budget against accumulated
// session spend in the `cost-tracking` namespace.
//
// Usage:
//   node scripts/budget.mjs set <usd>            # persist budget config
//   node scripts/budget.mjs get                  # show current budget config
//   node scripts/budget.mjs check                # compute utilization + alert level
//
// Env:
//   BUDGET_NAMESPACE=<name>   override (default: cost-tracking)
//   BUDGET_PERIOD=today|week|month|all   filter session totals by capturedAt
//   BUDGET_QUIET=1            machine-readable JSON only

import { spawnNpxSync } from './_npx.mjs';
// iter 73 — shared session-loader (was duplicated across 6 scripts).
// Only the session-list path consolidates; budget-config reads stay local
// because they have their own "latest stamp" upsert resolution logic.
import { loadSessions } from './_sessions.mjs';

// ADR-100 / #1748 Issue 3 — opt into cli-core's lite path with CLI_CORE=1.
// Cold-cache wall-time drops from ~25s to ~2s. JSON backend instead of
// SQLite/HNSW; semantic search degrades to substring (fine here — budget
// only does list/store/retrieve, no search). See cli-core/MIGRATION.md.
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const NS = process.env.BUDGET_NAMESPACE || 'cost-tracking';
const KEY = 'budget-config';

function memoryStore(key, value) {
  // The @claude-flow/cli memory layer has a UNIQUE-constraint quirk where
  // `store` rejects keys that `retrieve` doesn't surface. Workaround:
  // - For the budget-config key (single record), append a timestamp suffix
  //   on each write and update a small index that points at the latest.
  //   This avoids the conflict entirely. Retrieve resolves via the index.
  if (key === KEY) {
    const stamped = `${KEY}-${Date.now()}`;
    const r = spawnNpxSync([
      CLI_PKG, 'memory', 'store',
      '--namespace', NS, '--key', stamped, '--value', JSON.stringify(value),
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`memory store failed: ${r.stderr?.slice(0, 200) || r.status}`);
    // The "current pointer" is found at retrieval time by listing all
    // budget-config-* keys and picking the lexicographically-largest
    // (timestamp suffixes sort correctly because they are equal-width).
    return;
  }
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'store',
    '--namespace', NS, '--key', key, '--value', JSON.stringify(value),
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`memory store failed: ${r.stderr?.slice(0, 200) || r.status}`);
}

function memoryRetrieveOne(key) {
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', NS, '--key', key, '--value-only',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  try { return JSON.parse((r.stdout || '').trim()); } catch { return null; }
}

function memoryRetrieve(key) {
  // For budget-config: pick the latest budget-config-<timestamp> entry.
  if (key === KEY) {
    const list = spawnNpxSync([
      CLI_PKG, 'memory', 'list',
      '--namespace', NS, '--format', 'json',
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
    if (list.status !== 0) return null;
    const m = /\[[\s\S]*\]/.exec(list.stdout || '');
    if (!m) return null;
    let entries;
    try { entries = JSON.parse(m[0]); } catch { return null; }
    const stamped = entries
      .map((e) => e.key)
      .filter((k) => typeof k === 'string' && /^budget-config-\d+$/.test(k))
      .sort();
    const latest = stamped[stamped.length - 1];
    if (!latest) {
      // fall back to plain budget-config (legacy / pre-stamping)
      return memoryRetrieveOne(KEY);
    }
    return memoryRetrieveOne(latest);
  }
  return memoryRetrieveOne(key);
}

function periodFilter(period) {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  if (period === 'today') return (ts) => ts && new Date(ts).toDateString() === new Date().toDateString();
  if (period === 'week')  return (ts) => ts && (now - new Date(ts).getTime()) < 7 * day;
  if (period === 'month') return (ts) => ts && (now - new Date(ts).getTime()) < 30 * day;
  return () => true; // 'all'
}

function alertLevel(utilization) {
  if (utilization >= 1.00) return { level: 'HARD_STOP', emoji: '🛑', threshold: 100 };
  if (utilization >= 0.90) return { level: 'CRITICAL',  emoji: '🔴', threshold: 90 };
  if (utilization >= 0.75) return { level: 'WARNING',   emoji: '🟠', threshold: 75 };
  if (utilization >= 0.50) return { level: 'INFO',      emoji: '🟡', threshold: 50 };
  return { level: 'OK', emoji: '🟢', threshold: 0 };
}

function recommendedAction(level) {
  return ({
    OK:        'within budget — no action.',
    INFO:      '50% consumed — log notification, no UX disruption.',
    WARNING:   '75% consumed — display warning, suggest optimizations (run /cost-optimize).',
    CRITICAL:  '90% consumed — urgent alert, recommend model downgrades, run /cost-optimize.',
    HARD_STOP: '100% consumed — halt non-essential agent spawns; review /cost-report and /cost-optimize before continuing.',
  }[level]);
}

function cmdSet(args) {
  const amount = parseFloat(args[0]);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('usage: budget.mjs set <usd-amount>  (positive number)');
    process.exit(2);
  }
  const config = {
    budget_usd: amount,
    setAt: new Date().toISOString(),
    thresholds: { info: 0.50, warning: 0.75, critical: 0.90, hard_stop: 1.00 },
  };
  memoryStore(KEY, config);
  if (process.env.BUDGET_QUIET === '1') {
    console.log(JSON.stringify(config));
  } else {
    console.log(`✓ Budget set: $${amount.toFixed(2)} (namespace: ${NS}, key: ${KEY})`);
    console.log('  Alerts: 50% INFO · 75% WARNING · 90% CRITICAL · 100% HARD_STOP');
  }
}

function cmdGet() {
  const cfg = memoryRetrieve(KEY);
  if (process.env.BUDGET_QUIET === '1') {
    console.log(JSON.stringify(cfg || { error: 'no budget configured' }));
    return;
  }
  if (!cfg) {
    console.log(`No budget configured (namespace: ${NS}, key: ${KEY}).`);
    console.log('Set one with: cost budget set <usd>');
    process.exit(0);
  }
  console.log(`Budget: $${cfg.budget_usd?.toFixed(2)}  (set ${cfg.setAt})`);
  console.log(`Thresholds: 50/75/90/100%`);
}

function cmdCheck() {
  const cfg = memoryRetrieve(KEY);
  const period = process.env.BUDGET_PERIOD || 'all';
  const records = loadSessions(NS);
  const filt = periodFilter(period);
  const filtered = records.filter((r) => filt(r.capturedAt || r.endedAt));
  const totalSpend = filtered.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  if (!cfg || !Number.isFinite(cfg.budget_usd)) {
    const out = { period, totalSpend, recordCount: filtered.length, error: 'no budget configured' };
    // audit-allow: exit-bypass — no-budget path can't reach the HARD_STOP exit (no `alert` is computed in this branch).
    if (process.env.BUDGET_QUIET === '1') return console.log(JSON.stringify(out));
    console.log(`Period: ${period}`);
    console.log(`Spent so far: $${totalSpend.toFixed(2)} across ${filtered.length} sessions`);
    console.log(`No budget set — run \`cost budget set <usd>\` to enable alerts.`);
    return;
  }
  const utilization = totalSpend / cfg.budget_usd;
  const alert = alertLevel(utilization);
  const out = {
    period,
    budget_usd: cfg.budget_usd,
    spent_usd: totalSpend,
    remaining_usd: Math.max(0, cfg.budget_usd - totalSpend),
    utilization_pct: utilization * 100,
    level: alert.level,
    threshold: alert.threshold,
    recommended_action: recommendedAction(alert.level),
    sessionCount: filtered.length,
  };
  if (process.env.BUDGET_QUIET === '1') {
    console.log(JSON.stringify(out));
  } else {
    console.log(`# Budget check (period: ${period})`);
    console.log('');
    console.log(`| Metric | Value |`);
    console.log(`|---|---:|`);
    console.log(`| Budget | $${cfg.budget_usd.toFixed(2)} |`);
    console.log(`| Spent | $${totalSpend.toFixed(2)} |`);
    console.log(`| Remaining | $${out.remaining_usd.toFixed(2)} |`);
    console.log(`| Utilization | ${out.utilization_pct.toFixed(1)}% |`);
    console.log(`| Sessions counted | ${filtered.length} |`);
    console.log(`| **Alert** | **${alert.emoji} ${alert.level}** |`);
    console.log('');
    console.log(`Action: ${out.recommended_action}`);
  }
  // CRITICAL: must run in BOTH branches — otherwise BUDGET_QUIET=1 silently
  // swallowed HARD_STOP, breaking cost-health composite gate (iter 75 fix).
  if (alert.level === 'HARD_STOP') process.exit(1);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'set':   return cmdSet(rest);
    case 'get':   return cmdGet();
    case 'check': return cmdCheck();
    default:
      console.error('usage: budget.mjs {set <usd>|get|check}');
      process.exit(2);
  }
}

main();
