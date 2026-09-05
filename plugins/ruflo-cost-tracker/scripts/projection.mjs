#!/usr/bin/env node
// cost-projection — forward-looking spend extrapolation.
//
// Iter 41 of ADR-149 router work added a similar tool for routing decisions;
// this is the cost-tracker equivalent for session-level spend.
//
// METHOD
//   1. Read `cost-tracking` namespace session records (same source as budget.mjs)
//   2. Filter to a measurement window (default last 7d on capturedAt/startedAt)
//   3. Compute USD-per-day rate from that window
//   4. Linear-extrapolate to 7d / 30d / 90d / 365d horizons
//   5. If a budget is configured: compute "days until 75% / 90% / 100% consumed"
//
// Pairs with `cost budget check` (reactive alerts) to give operators a
// PREDICTIVE view — finance/SREs want to know "when will we hit the cap?"
// not just "we hit the cap".
//
// USAGE
//   node scripts/projection.mjs                           # default 7d window
//   node scripts/projection.mjs --window 24h              # extrapolate from last day
//   node scripts/projection.mjs --horizons 7d,30d,90d     # custom horizons
//   node scripts/projection.mjs --format json             # pipe to dashboards
//
// Env: PROJECTION_NAMESPACE (default cost-tracking)
//      PROJECTION_QUIET=1 → JSON only (alias for --format json)

// iter 73 — shared session-loader + memoryRetrieve (was duplicated across 6 scripts).
import {
  loadSessions,
  memoryRetrieve,
  memoryListAllKeys,
  sessionTs,
  parseDurationMs,
} from './_sessions.mjs';

const NS = process.env.PROJECTION_NAMESPACE || 'cost-tracking';

const ARGS = (() => {
  const a = { window: '7d', horizons: '7d,30d,90d,365d', format: 'table' };
  if (process.env.PROJECTION_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--window') a.window = process.argv[++i];
    else if (v === '--horizons') a.horizons = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

// ----------------------------------------------------------------------------
// Budget config — mirror budget.mjs latest-stamp resolution.
// ----------------------------------------------------------------------------
function getBudgetConfig() {
  const stamped = memoryListAllKeys(NS)
    .filter((k) => /^budget-config-\d+$/.test(k))
    .sort();
  const latest = stamped[stamped.length - 1];
  if (latest) return memoryRetrieve(NS, latest);
  // Fallback: plain budget-config key (legacy / pre-stamping)
  return memoryRetrieve(NS, 'budget-config');
}

// ----------------------------------------------------------------------------
// Time math
// ----------------------------------------------------------------------------
function formatDays(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  const days = ms / 86400_000;
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 60) return `${days.toFixed(1)} days`;
  return `${(days / 30).toFixed(1)} months`;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const windowMs = parseDurationMs(ARGS.window);
  if (!windowMs) {
    console.error(`projection: --window must be N(h|d|w|m); got "${ARGS.window}"`);
    process.exit(2);
  }

  const horizonSpecs = ARGS.horizons.split(',').map((s) => s.trim()).filter(Boolean);
  for (const spec of horizonSpecs) {
    if (!parseDurationMs(spec)) {
      console.error(`projection: invalid horizon "${spec}"`);
      process.exit(2);
    }
  }

  // Read all sessions (shared loader, iter 73).
  const records = loadSessions(NS);

  // Filter by measurement window — use capturedAt if present, else startedAt.
  const cutoffMs = Date.now() - windowMs;
  const windowed = records.filter((r) => sessionTs(r) >= cutoffMs);
  const windowSpend = windowed.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const windowDays = windowMs / 86400_000;
  const usdPerDay = windowSpend / windowDays;

  // Compute total all-time spend (for budget consumed-so-far math).
  const totalSpend = records.reduce((s, r) => s + (r.total_cost_usd || 0), 0);

  const budget = getBudgetConfig();
  const budgetUsd = budget && Number.isFinite(budget.budget_usd) ? budget.budget_usd : null;

  // Horizons: linear extrapolation
  const horizons = horizonSpecs.map((spec) => {
    const ms = parseDurationMs(spec);
    const projectedUsd = usdPerDay * (ms / 86400_000);
    return {
      horizon: spec,
      days: ms / 86400_000,
      projectedSpendUsd: Math.round(projectedUsd * 1e6) / 1e6,
    };
  });

  // Budget exhaustion projections (when configured + rate > 0).
  let budgetExhaustion = null;
  if (budgetUsd !== null && usdPerDay > 0) {
    const targets = [0.75, 0.90, 1.00];
    budgetExhaustion = targets.map((pct) => {
      const targetUsd = budgetUsd * pct;
      const remainingUsd = Math.max(0, targetUsd - totalSpend);
      const daysUntil = remainingUsd / usdPerDay;
      const exhaustionMs = daysUntil * 86400_000;
      return {
        thresholdPct: pct * 100,
        targetUsd: Math.round(targetUsd * 1e6) / 1e6,
        remainingUsd: Math.round(remainingUsd * 1e6) / 1e6,
        daysUntilReached: Math.round(daysUntil * 10) / 10,
        humanReadable: formatDays(exhaustionMs),
        alreadyReached: totalSpend >= targetUsd,
      };
    });
  }

  const payload = {
    namespace: NS,
    measurementWindow: ARGS.window,
    measurement: {
      sessionsInWindow: windowed.length,
      windowSpendUsd: Math.round(windowSpend * 1e6) / 1e6,
      windowDays,
      usdPerDay: Math.round(usdPerDay * 1e6) / 1e6,
    },
    allTime: {
      sessionsTotal: records.length,
      totalSpendUsd: Math.round(totalSpend * 1e6) / 1e6,
    },
    horizons,
    budget: budgetUsd !== null ? {
      configuredUsd: budgetUsd,
      utilizationPct: budgetUsd > 0 ? Math.round((totalSpend / budgetUsd) * 10000) / 100 : 0,
      exhaustion: budgetExhaustion,
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Markdown / human output.
  console.log(`# cost-projection (window: ${ARGS.window})`);
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Sessions in window | ${windowed.length} |`);
  console.log(`| Window spend | $${windowSpend.toFixed(6)} |`);
  console.log(`| Days in window | ${windowDays.toFixed(1)} |`);
  console.log(`| **USD per day** | **$${usdPerDay.toFixed(6)}** |`);
  console.log(`| All-time spend | $${totalSpend.toFixed(6)} across ${records.length} sessions |`);
  console.log('');
  console.log('## Projected spend (linear extrapolation)');
  console.log('');
  console.log('| Horizon | Days | Projected spend |');
  console.log('|---|---:|---:|');
  for (const h of horizons) {
    console.log(`| ${h.horizon} | ${h.days} | $${h.projectedSpendUsd.toFixed(4)} |`);
  }
  console.log('');
  if (budgetExhaustion) {
    console.log(`## Budget exhaustion ($${budgetUsd.toFixed(2)} configured)`);
    console.log('');
    console.log('| Threshold | Target | Remaining | Time at current rate |');
    console.log('|---|---:|---:|---|');
    for (const ex of budgetExhaustion) {
      const status = ex.alreadyReached ? '**ALREADY REACHED**' : ex.humanReadable;
      console.log(`| ${ex.thresholdPct.toFixed(0)}% | $${ex.targetUsd.toFixed(2)} | $${ex.remainingUsd.toFixed(2)} | ${status} |`);
    }
    console.log('');
    console.log('Assumes the current rate holds. Re-run after large workload shifts.');
  } else if (budgetUsd === null) {
    console.log(`_No budget configured — set one with \`cost budget set <usd>\` to see exhaustion projections._`);
    console.log('');
  } else if (usdPerDay === 0) {
    console.log(`_No spend in measurement window — projection cannot extrapolate from zero. Widen --window or record more sessions._`);
    console.log('');
  }
}

main();
