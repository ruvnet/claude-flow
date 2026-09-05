#!/usr/bin/env node
// cost-counterfactual — actual vs hypothetical baseline cost analysis.
//
// Iters 32-33 of ADR-149 router work added multi-baseline counterfactual
// analysis for routing decisions. This is the cost-tracker equivalent for
// session-level spend: what would each session have cost if every message
// had been routed to a fixed tier (always-haiku / always-sonnet / always-opus)?
//
// METHOD
//   1. Read `cost-tracking` namespace session records (same source as
//      budget.mjs / conversation.mjs).
//   2. For each session: sum token totals across all `byModel[*]` entries.
//   3. For each baseline tier (default: all three):
//        counterfactualCost = (input_tokens / 1M × tier.input)
//                           + (output_tokens / 1M × tier.output)
//                           + (cache_creation / 1M × tier.cache_write)
//                           + (cache_read     / 1M × tier.cache_read)
//   4. Compute savings: counterfactual − actual = how much routing saved
//      (positive) or lost (negative) vs the baseline.
//   5. Aggregate across sessions; emit per-baseline totals + savings %.
//
// Pairs with `cost-budget-check` and `cost-projection`:
//   - check:        "have we crossed a threshold?" (reactive)
//   - projection:   "when will we cross a threshold?" (predictive)
//   - counterfactual: "is the routing earning its keep?" (comparative)
//
// USAGE
//   node scripts/counterfactual.mjs                                # all sessions
//   node scripts/counterfactual.mjs --since 7d                     # last week
//   node scripts/counterfactual.mjs --baseline always-haiku        # single baseline
//   node scripts/counterfactual.mjs --format json                  # pipe-friendly
//
// Env: COUNTERFACTUAL_NAMESPACE (default cost-tracking), COUNTERFACTUAL_QUIET=1.

// iter 68 — shared PRICING + cost helpers.
import { costAtTier } from './_prices.mjs';
// iter 73 — shared session-loader.
import { loadSessions, sessionTs, parseDurationMs } from './_sessions.mjs';

const NS = process.env.COUNTERFACTUAL_NAMESPACE || 'cost-tracking';

const ALL_BASELINES = ['always-haiku', 'always-sonnet', 'always-opus'];

const ARGS = (() => {
  const a = { since: null, baseline: 'all', format: 'table' };
  if (process.env.COUNTERFACTUAL_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--since') a.since = process.argv[++i];
    else if (v === '--baseline') a.baseline = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function tierFromBaseline(baseline) {
  switch (baseline) {
    case 'always-haiku':  return 'haiku';
    case 'always-sonnet': return 'sonnet';
    case 'always-opus':   return 'opus';
    default: return null;
  }
}

function sumSessionTokens(rec) {
  const totals = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const byModel = rec.byModel || {};
  for (const slot of Object.values(byModel)) {
    totals.input       += slot.input_tokens || 0;
    totals.output      += slot.output_tokens || 0;
    totals.cache_write += slot.cache_creation_input_tokens || 0;
    totals.cache_read  += slot.cache_read_input_tokens || 0;
  }
  return totals;
}

function main() {
  // Validate baseline arg.
  const baselines = ARGS.baseline === 'all'
    ? ALL_BASELINES
    : [ARGS.baseline];
  for (const b of baselines) {
    if (!tierFromBaseline(b)) {
      console.error(`counterfactual: invalid --baseline "${b}" (must be one of: ${ALL_BASELINES.join(' | ')} | all)`);
      process.exit(2);
    }
  }

  // Read + filter sessions (shared loader, iter 73).
  const records = loadSessions(NS);

  let cutoffMs = null;
  if (ARGS.since) {
    const ms = parseDurationMs(ARGS.since);
    if (!ms) {
      console.error(`counterfactual: --since must be N(h|d|w|m); got "${ARGS.since}"`);
      process.exit(2);
    }
    cutoffMs = Date.now() - ms;
  }
  const filtered = cutoffMs === null
    ? records
    : records.filter((r) => sessionTs(r) >= cutoffMs);

  // Aggregate.
  let actualUsd = 0;
  const tokens = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  for (const rec of filtered) {
    actualUsd += rec.total_cost_usd || 0;
    const t = sumSessionTokens(rec);
    tokens.input += t.input;
    tokens.output += t.output;
    tokens.cache_write += t.cache_write;
    tokens.cache_read += t.cache_read;
  }

  const baselineResults = baselines.map((b) => {
    const tier = tierFromBaseline(b);
    const counterfactualUsd = costAtTier(tokens, tier);
    const savingsUsd = counterfactualUsd - actualUsd;
    const savingsPct = counterfactualUsd > 0
      ? (savingsUsd / counterfactualUsd) * 100
      : 0;
    return {
      baseline: b,
      tier,
      counterfactualUsd: Math.round(counterfactualUsd * 1e6) / 1e6,
      actualUsd: Math.round(actualUsd * 1e6) / 1e6,
      savingsUsd: Math.round(savingsUsd * 1e6) / 1e6,
      savingsPct: Math.round(savingsPct * 100) / 100,
    };
  });

  const payload = {
    namespace: NS,
    filters: { since: ARGS.since, baseline: ARGS.baseline },
    sessionsConsidered: filtered.length,
    tokensTotal: tokens,
    actualUsd: Math.round(actualUsd * 1e6) / 1e6,
    baselines: baselineResults,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Markdown / human output.
  console.log(`# cost-counterfactual${ARGS.since ? ` (since ${ARGS.since})` : ' (all-time)'}`);
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Sessions considered | ${filtered.length} |`);
  console.log(`| Total input tokens | ${tokens.input.toLocaleString()} |`);
  console.log(`| Total output tokens | ${tokens.output.toLocaleString()} |`);
  console.log(`| Total cache_write tokens | ${tokens.cache_write.toLocaleString()} |`);
  console.log(`| Total cache_read tokens | ${tokens.cache_read.toLocaleString()} |`);
  console.log(`| **Actual spend** | **$${actualUsd.toFixed(6)}** |`);
  console.log('');
  if (filtered.length === 0) {
    console.log('_No sessions in window — nothing to compare. Run `cost track` after agent work to populate `cost-tracking`._');
    console.log('');
    return;
  }
  console.log('## Counterfactual baselines (what would the same tokens have cost?)');
  console.log('');
  console.log('| Baseline | Hypothetical cost | Actual | Savings | % saved |');
  console.log('|---|---:|---:|---:|---:|');
  for (const r of baselineResults) {
    const savingsCell = r.savingsUsd >= 0
      ? `+$${r.savingsUsd.toFixed(6)}`
      : `-$${Math.abs(r.savingsUsd).toFixed(6)}`;
    const pctCell = r.savingsPct >= 0
      ? `${r.savingsPct.toFixed(2)}%`
      : `${r.savingsPct.toFixed(2)}%`;
    console.log(`| \`${r.baseline}\` | $${r.counterfactualUsd.toFixed(6)} | $${actualUsd.toFixed(6)} | ${savingsCell} | ${pctCell} |`);
  }
  console.log('');
  console.log('_Positive savings = routing chose cheaper models than the baseline._');
  console.log('_Negative savings = routing chose more-expensive models than the baseline (e.g. always-haiku was cheaper)._');
  if (baselines.length > 1) {
    console.log('_When always-haiku shows negative savings, qualityBar may be set too high; investigate via `cost optimize`._');
  }
  console.log('');
}

main();
