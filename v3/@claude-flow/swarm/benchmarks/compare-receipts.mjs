#!/usr/bin/env node
// Paired comparison of baseline vs candidate topology-load-balance receipts.
// Trials are matched 1:1 by (scenario, seed) since both runs use the same
// deterministic seed sequence — this makes every diff a same-scenario,
// same-churn-pattern, same-random-draw paired observation.
import { readFileSync } from 'node:fs';

const [, , baselinePath, candidatePath, outPath] = process.argv;
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));

if (baseline.results.length !== candidate.results.length) {
  console.error('FATAL: receipt trial counts differ — not a fair paired comparison');
  process.exit(2);
}

function byKey(receipt) {
  const m = new Map();
  for (const r of receipt.results) m.set(`${r.scenario}:${r.seed}`, r);
  return m;
}

const baseMap = byKey(baseline);
const candMap = byKey(candidate);

const scenarios = [...new Set(baseline.results.map(r => r.scenario))];
const perScenario = {};
let totalPairs = 0;
let maxLoadImproved = 0;
let maxLoadWorsened = 0;
let maxLoadTied = 0;
const maxLoadDiffs = [];
const covDiffs = [];
const meanLoadDiffs = [];
let baselineFailures = 0;
let candidateFailures = 0;
let durationBaselineTotal = 0;
let durationCandidateTotal = 0;

for (const scenario of scenarios) {
  const rows = [];
  for (const [key, b] of baseMap) {
    if (!key.startsWith(scenario + ':')) continue;
    const c = candMap.get(key);
    if (!c) continue;
    rows.push({ b, c });
  }

  const sMaxDiffs = rows.map(({ b, c }) => c.maxLoad - b.maxLoad);
  const sCovDiffs = rows.map(({ b, c }) => c.covLoad - b.covLoad);
  const sMeanDiffs = rows.map(({ b, c }) => c.meanLoad - b.meanLoad);

  const baselineMeanLoadForScenario = avg(rows.map(r => r.b.meanLoad));
  const candidateMeanLoadForScenario = avg(rows.map(r => r.c.meanLoad));
  const relativeDensityChange =
    baselineMeanLoadForScenario > 0
      ? (candidateMeanLoadForScenario - baselineMeanLoadForScenario) / baselineMeanLoadForScenario
      : 0;

  perScenario[scenario] = {
    trials: rows.length,
    baselineMeanMaxLoad: avg(rows.map(r => r.b.maxLoad)),
    candidateMeanMaxLoad: avg(rows.map(r => r.c.maxLoad)),
    baselineMeanCov: avg(rows.map(r => r.b.covLoad)),
    candidateMeanCov: avg(rows.map(r => r.c.covLoad)),
    meanMaxLoadDelta: avg(sMaxDiffs),
    meanCovDelta: avg(sCovDiffs),
    meanMeanLoadDelta: avg(sMeanDiffs),
    // Per-scenario relative density change (candidate vs baseline avg connections/node).
    // Pooling this across scenarios (as an earlier version of this script did) hides
    // a real double-digit relative drop in the one scenario where P2C actually fires —
    // flagged by adversarial review; report it per-scenario, not as a global average.
    relativeDensityChangePct: relativeDensityChange * 100,
    // Per-scenario paired t-test on maxLoad — the pooled statistic mixes this
    // scenario's trials with untouched (exact-tie, zero-variance) scenarios,
    // which mischaracterizes significance. Report both; per-scenario is authoritative.
    maxLoadTStatistic: pairedTStat(sMaxDiffs),
    baselineReachabilityFailures: sum(rows.map(r => r.b.reachabilityFailures)),
    candidateReachabilityFailures: sum(rows.map(r => r.c.reachabilityFailures)),
  };

  for (const d of sMaxDiffs) {
    if (d < 0) maxLoadImproved++;
    else if (d > 0) maxLoadWorsened++;
    else maxLoadTied++;
  }
  maxLoadDiffs.push(...sMaxDiffs);
  covDiffs.push(...sCovDiffs);
  meanLoadDiffs.push(...sMeanDiffs);
  totalPairs += rows.length;
  baselineFailures += sum(rows.map(r => r.b.reachabilityFailures));
  candidateFailures += sum(rows.map(r => r.c.reachabilityFailures));
  durationBaselineTotal += sum(rows.map(r => r.b.durationMs));
  durationCandidateTotal += sum(rows.map(r => r.c.durationMs));
}

function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function sum(a) {
  return a.reduce((x, y) => x + y, 0);
}
function stddev(a) {
  const m = avg(a);
  return Math.sqrt(avg(a.map(x => (x - m) ** 2)));
}
// Paired t-test approximation on maxLoad deltas (two-sided).
function pairedTStat(diffs) {
  const n = diffs.length;
  const meanD = avg(diffs);
  const sd = stddev(diffs);
  const se = sd / Math.sqrt(n);
  return se > 0 ? meanD / se : 0;
}

const pooledTStat = pairedTStat(maxLoadDiffs);
// Rough two-sided significance flag at |t| > 1.96 (~95% CI, large-n normal approx).
const pooledSignificant = Math.abs(pooledTStat) > 1.96;

const report = {
  totalPairedTrials: totalPairs,
  maxLoad: {
    meanDelta: avg(maxLoadDiffs), // negative = candidate has lower max load (better)
    improvedTrials: maxLoadImproved,
    worsenedTrials: maxLoadWorsened,
    tiedTrials: maxLoadTied,
    improvedFraction: maxLoadImproved / totalPairs,
    // WARNING (added post adversarial-review): this t-statistic pools ALL 6 scenarios,
    // including untouched ones with exactly zero variance (mesh-small, both hybrid
    // scenarios, and near-zero for mesh-medium-churn). It is NOT a valid significance
    // test for any single scenario and must not be quoted as "n=40" — n here is
    // totalPairedTrials (240). Use perScenario[*].maxLoadTStatistic for the real,
    // scenario-scoped test (mesh-large-churn is where the effect actually lives).
    pooledTStatistic: pooledTStat,
    pooledSignificantAt95: pooledSignificant,
  },
  covLoad: {
    meanDelta: avg(covDiffs), // negative = candidate has lower coefficient of variation (more balanced)
  },
  meanLoad: {
    meanDelta: avg(meanLoadDiffs), // should be ~0 — candidate must not change average connectivity/density
  },
  reachability: {
    baselineFailures,
    candidateFailures,
    totalSamples: totalPairs * 24,
  },
  performance: {
    baselineTotalMs: durationBaselineTotal,
    candidateTotalMs: durationCandidateTotal,
    regressionRatio: durationCandidateTotal / durationBaselineTotal,
  },
  perScenario,
};

const json = JSON.stringify(report, null, 2);
if (outPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, json);
}
console.log(json);
