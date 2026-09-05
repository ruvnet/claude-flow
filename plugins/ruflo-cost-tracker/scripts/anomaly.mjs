#!/usr/bin/env node
// cost-anomaly — MAD-based outlier detection on session spend.
//
// cost-burn answers "is the LATEST BUCKET accelerating?" — a question about
// AGGREGATE trend. This script answers "which SPECIFIC SESSIONS are
// anomalous outliers?" — a question about INDIVIDUAL data points.
//
// METHOD
//   1. Read all `session-*` records from `cost-tracking` namespace.
//   2. Filter to `--since` window (default: all-time).
//   3. Compute median(total_cost_usd) and MAD = median(|x - median|).
//   4. Per-session modified z-score (Iglewicz-Hoaglin):
//        z = 0.6745 * (x - median) / MAD
//   5. Flag sessions with |z| > `--threshold` (default 3.5).
//
// Why MAD (median absolute deviation) and not mean+sigma:
//   - Robust to the very outliers we're hunting (a single $50 session
//     would inflate mean+sigma so badly that subsequent outliers hide).
//   - Works on small samples (n=10 is fine; mean+sigma needs n=30+).
//   - Iglewicz-Hoaglin (1993): |modified z| > 3.5 is the canonical cutoff.
//
// Pairs with:
//   - cost-burn          → "did the AGGREGATE rate spike?"
//   - cost-anomaly       → "which INDIVIDUAL sessions are outliers?" ← this
//   - cost-counterfactual → "could routing have been cheaper?"
//   - cost-projection    → "when will we hit budget?"
//
// USAGE
//   node scripts/anomaly.mjs                                # default 3.5 threshold, all-time
//   node scripts/anomaly.mjs --since 7d                     # last week only
//   node scripts/anomaly.mjs --threshold 3.0                # stricter (more outliers)
//   node scripts/anomaly.mjs --threshold 5.0                # looser (only egregious)
//   node scripts/anomaly.mjs --alert-on-outliers 1          # exit 1 if ≥1 outlier found
//   node scripts/anomaly.mjs --format json
//
// Env: ANOMALY_NAMESPACE (default cost-tracking), ANOMALY_QUIET=1.

// iter 73 — shared session-loader (was duplicated across 6 scripts).
import { loadSessions, sessionTs, parseDurationMs } from './_sessions.mjs';

const NS = process.env.ANOMALY_NAMESPACE || 'cost-tracking';

const ARGS = (() => {
  const a = { since: null, threshold: 3.5, alertOnOutliers: null, format: 'table' };
  if (process.env.ANOMALY_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--since') a.since = process.argv[++i];
    else if (v === '--threshold') a.threshold = parseFloat(process.argv[++i]);
    else if (v === '--alert-on-outliers') a.alertOnOutliers = parseInt(process.argv[++i], 10);
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[(n - 1) / 2];
}

function main() {
  if (!isFinite(ARGS.threshold) || ARGS.threshold <= 0) {
    console.error(`anomaly: --threshold must be > 0; got ${ARGS.threshold}`);
    process.exit(2);
  }
  if (ARGS.alertOnOutliers !== null && (!Number.isInteger(ARGS.alertOnOutliers) || ARGS.alertOnOutliers < 1)) {
    console.error(`anomaly: --alert-on-outliers must be a positive integer; got ${ARGS.alertOnOutliers}`);
    process.exit(2);
  }

  // Read + filter sessions (shared loader, iter 73).
  const records = loadSessions(NS);

  let cutoffMs = null;
  if (ARGS.since) {
    const ms = parseDurationMs(ARGS.since);
    if (!ms) {
      console.error(`anomaly: --since must be N(h|d|w|m); got "${ARGS.since}"`);
      process.exit(2);
    }
    cutoffMs = Date.now() - ms;
  }
  const filtered = cutoffMs === null
    ? records
    : records.filter((r) => sessionTs(r) >= cutoffMs);

  // Insufficient-data guard. MAD is meaningful only with ≥3 samples.
  if (filtered.length < 3) {
    const payload = {
      namespace: NS,
      filters: { since: ARGS.since, threshold: ARGS.threshold },
      sessionsConsidered: filtered.length,
      sufficient: false,
      reason: `need ≥3 sessions for MAD-based outlier detection; got ${filtered.length}`,
      outliers: [],
      stats: null,
      generatedAt: new Date().toISOString(),
    };
    if (ARGS.format === 'json') {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`# cost-anomaly${ARGS.since ? ` (since ${ARGS.since})` : ' (all-time)'}`);
      console.log('');
      console.log(`_Insufficient data: need ≥3 sessions for MAD-based outlier detection; got ${filtered.length}._`);
      console.log('');
    }
    return;
  }

  // Compute median + MAD over total_cost_usd.
  const spends = filtered.map((r) => r.total_cost_usd || 0).sort((a, b) => a - b);
  const med = median(spends);
  const absDeviations = spends.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const mad = median(absDeviations);

  // MAD=0 means ≥50% of sessions share the exact same spend — z-score
  // collapses. Report the explainer instead of dividing by zero.
  let outliers = [];
  let madZero = false;
  if (mad === 0) {
    madZero = true;
  } else {
    for (const rec of filtered) {
      const x = rec.total_cost_usd || 0;
      const z = 0.6745 * (x - med) / mad;
      if (Math.abs(z) > ARGS.threshold) {
        outliers.push({
          sessionId: rec.sessionId || 'unknown',
          spendUsd: Math.round(x * 1e6) / 1e6,
          deviationUsd: Math.round((x - med) * 1e6) / 1e6,
          modifiedZ: Math.round(z * 1000) / 1000,
          capturedAt: rec.capturedAt || rec.endedAt || rec.startedAt || null,
          messageCount: rec.messageCount || 0,
          direction: x > med ? 'high' : 'low',
        });
      }
    }
    outliers.sort((a, b) => Math.abs(b.modifiedZ) - Math.abs(a.modifiedZ));
  }

  // Alert check.
  let alertTriggered = false;
  let alertReason = null;
  if (ARGS.alertOnOutliers !== null) {
    if (outliers.length >= ARGS.alertOnOutliers) {
      alertTriggered = true;
      alertReason = `found ${outliers.length} outlier session(s) (|modified z| > ${ARGS.threshold}); threshold was ≥${ARGS.alertOnOutliers}`;
    } else {
      alertReason = `found ${outliers.length} outlier session(s); under threshold ≥${ARGS.alertOnOutliers} — OK`;
    }
  }

  const payload = {
    namespace: NS,
    filters: { since: ARGS.since, threshold: ARGS.threshold, alertOnOutliers: ARGS.alertOnOutliers },
    sessionsConsidered: filtered.length,
    sufficient: !madZero,
    stats: {
      medianUsd: Math.round(med * 1e6) / 1e6,
      madUsd: Math.round(mad * 1e6) / 1e6,
      minUsd: Math.round(spends[0] * 1e6) / 1e6,
      maxUsd: Math.round(spends[spends.length - 1] * 1e6) / 1e6,
    },
    outliers,
    alert: ARGS.alertOnOutliers !== null ? {
      triggered: alertTriggered,
      reason: alertReason,
      thresholdOutlierCount: ARGS.alertOnOutliers,
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# cost-anomaly${ARGS.since ? ` (since ${ARGS.since})` : ' (all-time)'}`);
    console.log('');
    console.log(`| Metric | Value |`);
    console.log(`|---|---:|`);
    console.log(`| Sessions considered | ${filtered.length} |`);
    console.log(`| Threshold (|modified z|) | ${ARGS.threshold} (Iglewicz-Hoaglin default 3.5) |`);
    console.log(`| Median spend | $${med.toFixed(6)} |`);
    console.log(`| MAD | $${mad.toFixed(6)} |`);
    console.log(`| Min / Max | $${spends[0].toFixed(6)} / $${spends[spends.length - 1].toFixed(6)} |`);
    console.log(`| **Outliers found** | **${outliers.length}** |`);
    console.log('');
    if (madZero) {
      console.log(`_MAD is $0 — ≥50% of sessions share the exact same spend. No outliers can be computed; investigate if this is expected (e.g. all sessions captured during a dry-run)._`);
      console.log('');
    } else if (outliers.length === 0) {
      console.log(`✓ No outliers found within the |modified z| > ${ARGS.threshold} band.`);
      console.log('');
    } else {
      console.log('## Outlier sessions (sorted by |modified z| descending)');
      console.log('');
      console.log('| Session | Spend | Deviation | Modified z | Direction | Messages | Captured |');
      console.log('|---|---:|---:|---:|:---:|---:|---|');
      for (const o of outliers) {
        const sid = o.sessionId.slice(0, 8);
        const devStr = o.deviationUsd >= 0 ? `+$${o.deviationUsd.toFixed(6)}` : `-$${Math.abs(o.deviationUsd).toFixed(6)}`;
        console.log(`| \`${sid}\` | $${o.spendUsd.toFixed(6)} | ${devStr} | ${o.modifiedZ.toFixed(3)} | ${o.direction} | ${o.messageCount} | ${o.capturedAt || '—'} |`);
      }
      console.log('');
      console.log('_High-direction outliers are usually long sessions or sessions stuck in expensive tiers — investigate via `cost report` / `cost conversation`._');
      console.log('_Low-direction outliers may indicate dropped sessions, crashes, or unfinished work — verify the session completed normally._');
      console.log('');
    }
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
