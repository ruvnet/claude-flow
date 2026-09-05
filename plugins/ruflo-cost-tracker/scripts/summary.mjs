#!/usr/bin/env node
// cost-summary — programmatic single-shot dump of all cost-tracking data.
// Other plugins / scripts can shell out: `node summary.mjs --format json` and
// parse the result. This is the plugin-local equivalent of the MCP tool
// `cost_summary` that ADR-0002 considered but explicitly deferred (would
// require modifying @claude-flow/cli source — out of scope for this plugin).
//
// Output (JSON shape — stable contract for consumers):
// {
//   exportedAt: ISO,
//   total_cost_usd: number,
//   sessionCount: number,
//   conversationCount: number,    // alias of sessionCount
//   byTier: { haiku, sonnet, opus, unknown }: USD,
//   byModel: { <model>: { tier, cost_usd, messages, ... } },
//   topSession: { sessionId, total_cost_usd, messageCount },
//   budget: null | { budget_usd, setAt, utilization, level },
//   federation: { eventCount, peerCount, totalUsd24h }
// }
//
// Markdown form is also available (--format markdown, the default).

// iter 73 — shared session-loader + memoryRetrieve (was duplicated across 7 scripts).
// ADR-100 / #1748 Issue 3 — CLI_CORE=1 routes to lite cli-core (~2s cold-cache).
import { memoryListAllKeys, memoryRetrieve } from './_sessions.mjs';
// iter 81 — optional git context (sha/branch/isDirty) for snapshot traceability.
import { spawnSync } from 'node:child_process';

const NS = process.env.SUMMARY_NAMESPACE || 'cost-tracking';
const FED_NS = process.env.SUMMARY_FED_NAMESPACE || 'federation-spend';

// iter 81 — git context (optional; graceful degrade outside a repo).
// Makes snapshots traceable — cost-diff can then surface "baseline was
// at sha X, current is at sha Y" without operators having to track it
// out-of-band. All three lookups are best-effort: any failure leaves
// `git: null` in the JSON, which downstream consumers treat as "unknown".
function captureGitContext() {
  function tryGit(args) {
    const r = spawnSync('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
  }
  const sha = tryGit(['rev-parse', 'HEAD']);
  if (!sha) return null;
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = tryGit(['status', '--porcelain']);
  return {
    sha,
    shaShort: sha.slice(0, 7),
    branch: branch || null,
    isDirty: status !== null && status.length > 0,
  };
}

function alertLevel(util) {
  if (util >= 1.00) return 'HARD_STOP';
  if (util >= 0.90) return 'CRITICAL';
  if (util >= 0.75) return 'WARNING';
  if (util >= 0.50) return 'INFO';
  return 'OK';
}

function gather() {
  const ctKeys = memoryListAllKeys(NS);
  const sessions = ctKeys.filter((k) => k.startsWith('session-'))
    .map((k) => memoryRetrieve(NS, k)).filter(Boolean);

  const totalUsd = sessions.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const byTier = { haiku: 0, sonnet: 0, opus: 0, unknown: 0 };
  const byModel = {};
  // iter 84 — per-token-class aggregation (mirrors iter 83's export.mjs).
  // Surfaces cache_write as a distinct cost driver in summary output.
  const byTokenClass = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  for (const r of sessions) {
    if (r.byTier) for (const [t, v] of Object.entries(r.byTier)) byTier[t] = (byTier[t] || 0) + v;
    if (r.byModel) {
      for (const [m, slot] of Object.entries(r.byModel)) {
        const agg = byModel[m] || { tier: slot.tier, cost_usd: 0, messages: 0,
          input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        agg.cost_usd += slot.cost_usd || 0;
        agg.messages += slot.messages || 0;
        agg.input_tokens += slot.input_tokens || 0;
        agg.output_tokens += slot.output_tokens || 0;
        agg.cache_creation_input_tokens += slot.cache_creation_input_tokens || 0;
        agg.cache_read_input_tokens += slot.cache_read_input_tokens || 0;
        byModel[m] = agg;
        byTokenClass.input       += slot.input_tokens || 0;
        byTokenClass.output      += slot.output_tokens || 0;
        byTokenClass.cache_write += slot.cache_creation_input_tokens || 0;
        byTokenClass.cache_read  += slot.cache_read_input_tokens || 0;
      }
    }
  }

  const topSession = sessions.slice().sort((a, b) => (b.total_cost_usd || 0) - (a.total_cost_usd || 0))[0];

  // Resolve current budget (latest budget-config-<ts>)
  const budgetKey = ctKeys.filter((k) => /^budget-config(-\d+)?$/.test(k)).sort().reverse()[0];
  const budgetCfg = budgetKey ? memoryRetrieve(NS, budgetKey) : null;
  const budget = budgetCfg ? {
    budget_usd: budgetCfg.budget_usd,
    setAt: budgetCfg.setAt,
    spent_usd: totalUsd,
    utilization: budgetCfg.budget_usd > 0 ? totalUsd / budgetCfg.budget_usd : 0,
    level: budgetCfg.budget_usd > 0 ? alertLevel(totalUsd / budgetCfg.budget_usd) : 'OK',
  } : null;

  // Federation aggregate
  const fedKeys = memoryListAllKeys(FED_NS);
  const fedEvents = fedKeys.filter((k) => k.startsWith('fed-spend-'))
    .map((k) => memoryRetrieve(FED_NS, k)).filter(Boolean);
  const peers = new Set(fedEvents.map((e) => e.peerId).filter(Boolean));
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const totalUsd24h = fedEvents.reduce((s, e) => {
    const ts = e.ts ? new Date(e.ts).getTime() : 0;
    return s + (ts && now - ts < day ? (e.usdSpent || 0) : 0);
  }, 0);

  return {
    exportedAt: new Date().toISOString(),
    // iter 81 — git context for snapshot traceability (null outside a git repo).
    git: captureGitContext(),
    total_cost_usd: totalUsd,
    sessionCount: sessions.length,
    conversationCount: sessions.length,
    byTier,
    byModel,
    // iter 84 — per-token-class summary so consumers can see "X% of spend
    // is cache_write" without re-aggregating byModel themselves.
    byTokenClass,
    topSession: topSession ? {
      sessionId: topSession.sessionId,
      total_cost_usd: topSession.total_cost_usd,
      messageCount: topSession.messageCount,
    } : null,
    budget,
    federation: {
      eventCount: fedEvents.length,
      peerCount: peers.size,
      totalUsd24h,
    },
  };
}

function fmtUsd(n) { return `$${(n || 0).toFixed(4)}`; }

function asMarkdown(s) {
  const lines = [];
  lines.push(`# cost-summary (${s.exportedAt})`);
  if (s.git) {
    const dirty = s.git.isDirty ? ' **(dirty working tree)**' : '';
    lines.push(`_git: \`${s.git.shaShort}\` (${s.git.branch || 'detached HEAD'})${dirty}_`);
  }
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Total measured spend | **${fmtUsd(s.total_cost_usd)}** |`);
  lines.push(`| Conversations / sessions | ${s.sessionCount} |`);
  if (s.budget) {
    lines.push(`| Budget | ${fmtUsd(s.budget.budget_usd)} |`);
    lines.push(`| Utilization | ${(s.budget.utilization * 100).toFixed(1)}% (${s.budget.level}) |`);
  } else {
    lines.push(`| Budget | unset |`);
  }
  lines.push(`| Federation events | ${s.federation.eventCount} (${s.federation.peerCount} peers, 24h ${fmtUsd(s.federation.totalUsd24h)}) |`);
  lines.push('');
  lines.push(`## By tier`);
  lines.push('');
  lines.push('| Tier | Cost |');
  lines.push('|---|---:|');
  for (const [t, c] of Object.entries(s.byTier)) {
    if (c > 0) lines.push(`| ${t} | ${fmtUsd(c)} |`);
  }
  lines.push('');
  // iter 84 — surface token-class breakdown so cache_write is visible.
  // A 569-output-token, $16 cache-write message used to look like "$16 went
  // to opus" in summary; now it shows "$16 = cache_write tokens" which is
  // what operators need to know to fix the underlying cause.
  if (s.byTokenClass) {
    const totalTokens = Object.values(s.byTokenClass).reduce((a, b) => a + b, 0);
    if (totalTokens > 0) {
      lines.push(`## By token class`);
      lines.push('');
      lines.push('| Class | Tokens | % of tokens |');
      lines.push('|---|---:|---:|');
      for (const cls of ['input', 'output', 'cache_write', 'cache_read']) {
        const n = s.byTokenClass[cls] || 0;
        if (n > 0) {
          const pct = (n / totalTokens) * 100;
          lines.push(`| ${cls} | ${n.toLocaleString()} | ${pct.toFixed(1)}% |`);
        }
      }
      lines.push('');
    }
  }
  if (s.topSession) {
    lines.push(`## Top session`);
    lines.push('');
    lines.push(`- Session \`${(s.topSession.sessionId || '').slice(0, 8)}\`: ${fmtUsd(s.topSession.total_cost_usd)} across ${s.topSession.messageCount} messages`);
  }
  return lines.join('\n');
}

function parseFormat() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format') return args[++i];
  }
  return process.env.SUMMARY_FORMAT || 'markdown';
}

const summary = gather();
if (parseFormat() === 'json') {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(asMarkdown(summary));
}
