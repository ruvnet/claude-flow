// Ensemble-uncertainty threshold tuning from recorded trajectories (iter 47).
//
// Iter 44 added CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD — when
// the unified KRR and bucket specialist disagree on the picked model's
// quality by > threshold, the selector returns null so the caller falls
// back to bandit. Iter 45 surfaced the disagreement value per decision.
// Iter 46 persisted it to the trajectory JSONL.
//
// This iter analyzes the persisted distribution and recommends a threshold.
//
// METHOD
//   1. Read trajectory JSONL.
//   2. Filter to decision rows with ensemble_disagreement set.
//   3. Compute distribution: count, mean, percentiles (p50, p75, p90, p95, p99), max.
//   4. For each candidate threshold (default 0.05, 0.10, 0.15, 0.20, 0.30):
//        - Count how many decisions would have triggered fallback
//        - Compute the fallback rate %
//   5. Recommend threshold based on three strategies:
//        - conservative: ≤ 5% fallback rate → only the tail extremes
//        - balanced: ≈ 10% fallback rate → matches p90
//        - aggressive: ≈ 20% fallback rate → matches p80
//
// USAGE
//   node scripts/tune-ensemble-threshold.mjs
//   node scripts/tune-ensemble-threshold.mjs --thresholds 0.05,0.1,0.2
//   node scripts/tune-ensemble-threshold.mjs --since 7d --format json
//
// Exits 0 on success, 1 on I/O error.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ARGS = (() => {
  const a = {
    in: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? resolve('.swarm', 'model-router-trajectories.jsonl'),
    thresholds: '0.025,0.05,0.10,0.15,0.20,0.25,0.30,0.40,0.50',
    since: null,
    format: 'table',
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--thresholds') a.thresholds = process.argv[++i];
    else if (v === '--since') a.since = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function emit(payload) {
  if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
  else printTable(payload);
}

function printTable(p) {
  console.log('');
  console.log(`Ensemble-threshold tuning — ADR-149 iter 47`);
  console.log('─'.repeat(72));
  console.log(`  Input:           ${p.input}`);
  if (p.since) console.log(`  Time window:    since ${p.since}`);
  console.log(`  Decisions with ensemble_disagreement: ${p.count}`);
  console.log('');
  if (p.count === 0) {
    console.log('  No decisions in the trajectory carry ensemble_disagreement.');
    console.log('  Iter 46 persistence wires this; pre-iter-46 trajectories will lack the field.');
    console.log('  Generate fresh decisions with iter 16 bucket specialists loaded + a complexity bucket.');
    console.log('');
    return;
  }
  console.log('  Disagreement distribution:');
  console.log(`    mean:   ${p.distribution.mean.toFixed(4)}`);
  console.log(`    min:    ${p.distribution.min.toFixed(4)}`);
  console.log(`    p50:    ${p.distribution.p50.toFixed(4)}`);
  console.log(`    p75:    ${p.distribution.p75.toFixed(4)}`);
  console.log(`    p90:    ${p.distribution.p90.toFixed(4)}`);
  console.log(`    p95:    ${p.distribution.p95.toFixed(4)}`);
  console.log(`    p99:    ${p.distribution.p99.toFixed(4)}`);
  console.log(`    max:    ${p.distribution.max.toFixed(4)}`);
  console.log('');
  console.log('  Threshold → fallback rate sweep:');
  console.log('    threshold   wouldFallback  fallbackRate');
  for (const r of p.thresholdSweep) {
    console.log(`    ${r.threshold.toFixed(3).padStart(9)}   ${String(r.wouldFallback).padStart(13)}  ${r.fallbackRatePct.toString().padStart(8)}%`);
  }
  console.log('');
  console.log('  Recommendations:');
  console.log(`    Conservative (~5% fallback):   threshold=${p.recommend.conservative.threshold.toFixed(3)}  (~${p.recommend.conservative.fallbackRatePct}% of decisions)`);
  console.log(`    Balanced     (~10% fallback):  threshold=${p.recommend.balanced.threshold.toFixed(3)}  (~${p.recommend.balanced.fallbackRatePct}% of decisions)`);
  console.log(`    Aggressive   (~20% fallback):  threshold=${p.recommend.aggressive.threshold.toFixed(3)}  (~${p.recommend.aggressive.fallbackRatePct}% of decisions)`);
  console.log('');
  console.log('  Set via:  export CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD=<value>');
  console.log('');
}

if (!existsSync(ARGS.in)) {
  emit({ error: `trajectory file not found at ${ARGS.in}`, input: ARGS.in });
  process.exit(1);
}

const lines = readFileSync(ARGS.in, 'utf8').split('\n').filter(l => l.trim().length > 0);
let cutoffMs = null;
if (ARGS.since) {
  const m = ARGS.since.match(/^(\d+)([hdmw])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
    cutoffMs = Date.now() - n * unitMs;
  }
}

const disagreements = [];
for (const l of lines) {
  try {
    const r = JSON.parse(l);
    if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue;
    if (r.type === 'decision' && typeof r.ensemble_disagreement === 'number') {
      disagreements.push(r.ensemble_disagreement);
    }
  } catch { /* skip malformed */ }
}

if (disagreements.length === 0) {
  emit({ input: ARGS.in, since: ARGS.since, count: 0 });
  process.exit(0);
}

const sorted = [...disagreements].sort((a, b) => a - b);
const sum = sorted.reduce((s, v) => s + v, 0);
const distribution = {
  mean: sum / sorted.length,
  min: sorted[0],
  p50: percentile(sorted, 50),
  p75: percentile(sorted, 75),
  p90: percentile(sorted, 90),
  p95: percentile(sorted, 95),
  p99: percentile(sorted, 99),
  max: sorted[sorted.length - 1],
};

const thresholds = ARGS.thresholds.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
const thresholdSweep = thresholds.map(t => {
  const wouldFallback = sorted.filter(d => d > t).length;
  const fallbackRatePct = Math.round((wouldFallback / sorted.length) * 10000) / 100;
  return { threshold: t, wouldFallback, fallbackRatePct };
});

// Recommendations: pick the threshold whose fallback rate is closest to
// the target (5%, 10%, 20%). If no candidate threshold gives the target
// exactly, the closest one wins.
function pickClosestTo(targetPct) {
  let best = thresholdSweep[0];
  let bestGap = Math.abs(best.fallbackRatePct - targetPct);
  for (const t of thresholdSweep) {
    const gap = Math.abs(t.fallbackRatePct - targetPct);
    if (gap < bestGap) { best = t; bestGap = gap; }
  }
  return best;
}

const payload = {
  input: ARGS.in,
  since: ARGS.since,
  count: sorted.length,
  distribution,
  thresholdSweep,
  recommend: {
    conservative: pickClosestTo(5),
    balanced: pickClosestTo(10),
    aggressive: pickClosestTo(20),
  },
};

emit(payload);
