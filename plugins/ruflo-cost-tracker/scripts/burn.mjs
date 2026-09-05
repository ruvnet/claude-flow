#!/usr/bin/env node
// cost-burn — burn-rate trend over time + acceleration alert.
//
// Iters 34 + 50 of ADR-149 router work added windowed-trend visibility
// and drift-alert exit codes. This is the cost-tracker plugin equivalent
// for session spend: bin sessions into daily (or custom-duration) buckets,
// surface trend, and optionally fail builds on rate acceleration.
//
// METHOD
//   1. Read `cost-tracking` namespace session records.
//   2. Bin into buckets of `--bucket` duration (default 1d) over `--lookback`
//      window (default 14d). Each bucket gets {n, spend, avgPerSession}.
//   3. Compute window-over-window delta: latest bucket's spend vs the mean
//      of the prior N buckets (default: all prior buckets).
//   4. If `--alert-on-acceleration-pct N` is set AND the latest bucket
//      spend is > (prior mean × (1 + N/100)), exit 1 with an alert message.
//
// Distinct from `cost-trend` (which surfaces BENCHMARK drift across
// docs/benchmarks/runs/*.json). This tracks PRODUCTION spend over time.
//
// Pairs with:
//   - cost-budget-check    (reactive: "have we crossed?")
//   - cost-projection      (predictive: "when will we cross?")
//   - cost-counterfactual  (comparative: "is routing earning its keep?")
//   - cost-burn            (trend: "is daily burn accelerating?")  ← this
//
// USAGE
//   node scripts/burn.mjs                                           # default 14d / 1d bins
//   node scripts/burn.mjs --bucket 1d --lookback 30d                # daily bins, last month
//   node scripts/burn.mjs --bucket 1w --lookback 90d                # weekly bins, last quarter
//   node scripts/burn.mjs --alert-on-acceleration-pct 50            # exit 1 if latest > +50% vs prior mean
//   node scripts/burn.mjs --format json
//
// Env: BURN_NAMESPACE (default cost-tracking), BURN_QUIET=1.

// iter 73 — shared session-loader (was duplicated across 6 scripts).
import { loadSessions, sessionTs, parseDurationMs } from './_sessions.mjs';

const NS = process.env.BURN_NAMESPACE || 'cost-tracking';

const ARGS = (() => {
  const a = { bucket: '1d', lookback: '14d', alertPct: null, format: 'table' };
  if (process.env.BURN_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--bucket') a.bucket = process.argv[++i];
    else if (v === '--lookback') a.lookback = process.argv[++i];
    else if (v === '--alert-on-acceleration-pct') a.alertPct = parseFloat(process.argv[++i]);
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  const bucketMs = parseDurationMs(ARGS.bucket);
  const lookbackMs = parseDurationMs(ARGS.lookback);
  if (!bucketMs) {
    console.error(`burn: --bucket must be N(h|d|w|m); got "${ARGS.bucket}"`);
    process.exit(2);
  }
  if (!lookbackMs) {
    console.error(`burn: --lookback must be N(h|d|w|m); got "${ARGS.lookback}"`);
    process.exit(2);
  }
  if (bucketMs > lookbackMs) {
    console.error(`burn: --bucket (${ARGS.bucket}) cannot exceed --lookback (${ARGS.lookback})`);
    process.exit(2);
  }

  const now = Date.now();
  const cutoffMs = now - lookbackMs;

  // Read + filter sessions (shared loader, iter 73).
  const records = loadSessions(NS);
  const windowed = records.filter((r) => sessionTs(r) >= cutoffMs);

  // Bin: bucket index counts BACKWARDS from now, so the LAST bucket is
  // "the most recent <bucket>". Operators read newest-first.
  // bucket index 0 = newest (now-bucketMs .. now), index 1 = (now-2*bucketMs .. now-bucketMs), etc.
  const numBuckets = Math.ceil(lookbackMs / bucketMs);
  const buckets = Array.from({ length: numBuckets }, (_, i) => ({
    index: i,
    startMs: now - (i + 1) * bucketMs,
    endMs: now - i * bucketMs,
    n: 0,
    spendUsd: 0,
  }));
  for (const rec of windowed) {
    const ts = sessionTs(rec);
    const offsetMs = now - ts;
    const idx = Math.floor(offsetMs / bucketMs);
    if (idx >= 0 && idx < numBuckets) {
      buckets[idx].n++;
      buckets[idx].spendUsd += rec.total_cost_usd || 0;
    }
  }

  // Window-over-window: latest bucket (index 0) vs mean of prior buckets
  // that have at least one session (avoid divide-by-zero on sparse history).
  const latest = buckets[0];
  const priorNonEmpty = buckets.slice(1).filter((b) => b.n > 0);
  const priorMean = priorNonEmpty.length > 0
    ? priorNonEmpty.reduce((s, b) => s + b.spendUsd, 0) / priorNonEmpty.length
    : 0;
  const deltaUsd = latest.spendUsd - priorMean;
  const deltaPct = priorMean > 0 ? (deltaUsd / priorMean) * 100 : (latest.spendUsd > 0 ? Infinity : 0);

  // Alert check.
  let alertTriggered = false;
  let alertReason = null;
  if (ARGS.alertPct !== null) {
    if (!isFinite(ARGS.alertPct) || ARGS.alertPct <= 0) {
      console.error(`burn: --alert-on-acceleration-pct must be > 0; got ${ARGS.alertPct}`);
      process.exit(2);
    }
    if (priorNonEmpty.length === 0) {
      alertReason = `skipped (no prior non-empty buckets to compare — need ≥1)`;
    } else if (priorMean === 0) {
      alertReason = `skipped (prior buckets are all $0)`;
    } else if (deltaPct > ARGS.alertPct) {
      alertTriggered = true;
      alertReason = `latest bucket $${latest.spendUsd.toFixed(6)} is ${deltaPct.toFixed(1)}% above prior mean $${priorMean.toFixed(6)} (threshold +${ARGS.alertPct}%)`;
    } else {
      alertReason = `latest bucket within +${ARGS.alertPct}% of prior mean (actual delta: ${deltaPct.toFixed(1)}%) — OK`;
    }
  }

  const payload = {
    namespace: NS,
    config: { bucket: ARGS.bucket, lookback: ARGS.lookback, alertOnAccelerationPct: ARGS.alertPct },
    bucketsConsidered: buckets.length,
    sessionsInLookback: windowed.length,
    latest: {
      windowStart: new Date(latest.startMs).toISOString(),
      windowEnd: new Date(latest.endMs).toISOString(),
      sessions: latest.n,
      spendUsd: Math.round(latest.spendUsd * 1e6) / 1e6,
    },
    priorMean: {
      bucketsConsidered: priorNonEmpty.length,
      meanSpendUsd: Math.round(priorMean * 1e6) / 1e6,
    },
    delta: {
      deltaUsd: Math.round(deltaUsd * 1e6) / 1e6,
      deltaPct: isFinite(deltaPct) ? Math.round(deltaPct * 100) / 100 : null,
    },
    series: buckets.map((b) => ({
      bucketIndex: b.index,
      windowStart: new Date(b.startMs).toISOString(),
      windowEnd: new Date(b.endMs).toISOString(),
      sessions: b.n,
      spendUsd: Math.round(b.spendUsd * 1e6) / 1e6,
    })),
    alert: ARGS.alertPct !== null ? {
      triggered: alertTriggered,
      reason: alertReason,
      thresholdPct: ARGS.alertPct,
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# cost-burn (bucket=${ARGS.bucket}, lookback=${ARGS.lookback})`);
    console.log('');
    console.log(`| Metric | Value |`);
    console.log(`|---|---:|`);
    console.log(`| Buckets considered | ${buckets.length} |`);
    console.log(`| Sessions in lookback | ${windowed.length} |`);
    console.log(`| Latest bucket spend | $${latest.spendUsd.toFixed(6)} (${latest.n} sessions) |`);
    console.log(`| Prior bucket mean | $${priorMean.toFixed(6)} (${priorNonEmpty.length} non-empty buckets) |`);
    const deltaStr = deltaUsd >= 0 ? `+$${deltaUsd.toFixed(6)}` : `-$${Math.abs(deltaUsd).toFixed(6)}`;
    const pctStr = isFinite(deltaPct) ? `${deltaPct.toFixed(2)}%` : (priorMean === 0 ? 'new' : '∞');
    console.log(`| **Delta (latest vs prior mean)** | **${deltaStr} (${pctStr})** |`);
    console.log('');
    console.log('## Bucket series (newest first)');
    console.log('');
    console.log('| # | Window | Sessions | Spend |');
    console.log('|---:|---|---:|---:|');
    for (const b of buckets) {
      const startShort = new Date(b.startMs).toISOString().slice(0, 16).replace('T', ' ');
      const endShort = new Date(b.endMs).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`| ${b.index} | ${startShort} → ${endShort} | ${b.n} | $${b.spendUsd.toFixed(6)} |`);
    }
    console.log('');
    if (alertReason !== null) {
      if (alertTriggered) {
        console.log(`⚠ **ALERT**: ${alertReason}`);
      } else {
        console.log(`✓ ${alertReason}`);
      }
      console.log('');
    }
  }

  if (alertTriggered) process.exit(1);
}

main();
