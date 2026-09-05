#!/usr/bin/env node
// beir-bootstrap-significance.mjs — paired bootstrap significance test for
// BEIR retrieval results (ADR-086).
//
// Given a run JSON with per-query nDCG@10 and a baseline mean nDCG@10,
// estimates whether our result is significantly above the baseline.
//
// Method: paired bootstrap — resample N=10000 with replacement from our
// per-query nDCG scores, compute mean each time, take 2.5%-97.5% percentile
// for 95% CI. Compare baseline to our CI: if baseline < CI lower bound,
// the difference is significant at p < 0.05.
//
// For a paired test against ANOTHER per-query run (e.g. our pure-BM25 vs
// our BGE-base), resample paired DIFFERENCES instead. Pass --paired
// path/to/baseline-run.json.
//
// Usage:
//   node scripts/beir-bootstrap-significance.mjs <run-json-path>
//   node scripts/beir-bootstrap-significance.mjs <ours> --paired <baseline>
//
// Example:
//   node scripts/beir-bootstrap-significance.mjs \
//     docs/benchmarks/runs/beir-nfcorpus-bge-latest.json

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node beir-bootstrap-significance.mjs <run-json> [--paired <baseline-run-json>]');
  process.exit(1);
}
const RUN_PATH = args[0];
const PAIRED_IDX = args.indexOf('--paired');
const PAIRED_PATH = PAIRED_IDX > 0 ? args[PAIRED_IDX + 1] : null;
const ITERATIONS = Number(process.env.BOOTSTRAP_ITERATIONS) || 10000;

// Deterministic PRNG (Mulberry32) — so re-runs are reproducible.
const SEED = Number(process.env.BOOTSTRAP_SEED) || 42;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(arr) { let s = 0; for (const v of arr) s += v; return s / arr.length; }

function percentile(sortedArr, p) {
  const idx = Math.max(0, Math.min(sortedArr.length - 1, Math.floor(p * sortedArr.length)));
  return sortedArr[idx];
}

function pointEstimate(scores) {
  return {
    mean: mean(scores),
    n: scores.length,
  };
}

function bootstrapCI(scores, iterations, rng, percentiles = [0.025, 0.975]) {
  const means = new Float64Array(iterations);
  const n = scores.length;
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += scores[Math.floor(rng() * n)];
    means[i] = s / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  return {
    point: mean(scores),
    lower: percentile(sorted, percentiles[0]),
    upper: percentile(sorted, percentiles[1]),
    p_value_vs_baseline_zero: null,
  };
}

// Paired bootstrap: compare our per-query scores to a baseline's per-query
// scores. Resample (idx) and average paired differences. The 95% CI on the
// mean difference tells us if it's significantly non-zero.
function pairedBootstrap(oursByQid, baselineByQid, iterations, rng) {
  const sharedIds = [...oursByQid.keys()].filter((id) => baselineByQid.has(id));
  const diffs = sharedIds.map((id) => oursByQid.get(id) - baselineByQid.get(id));
  const n = diffs.length;
  const means = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += diffs[Math.floor(rng() * n)];
    means[i] = s / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  // One-sided p ≈ fraction of resamples where mean diff ≤ 0
  let negCount = 0;
  for (const m of means) if (m <= 0) negCount++;
  return {
    n_paired: n,
    point_diff: mean(diffs),
    lower_95: percentile(sorted, 0.025),
    upper_95: percentile(sorted, 0.975),
    p_one_sided: negCount / iterations,
  };
}

function loadRun(path) {
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  if (!data.perQuery || !Array.isArray(data.perQuery)) {
    console.error(`Run JSON at ${path} has no perQuery array — re-run the bench with the updated harness.`);
    process.exit(2);
  }
  return data;
}

const ours = loadRun(RUN_PATH);
console.log(`# BEIR significance test (ADR-086)`);
console.log(`Run: ${RUN_PATH}`);
console.log(`Dataset: ${ours.dataset ?? '?'}  Model: ${ours.model ?? '?'}  Queries: ${ours.perQuery.length}`);
console.log(`Bootstrap: ${ITERATIONS} iterations, seed=${SEED}`);

const rng = mulberry32(SEED);
const ourScores = ours.perQuery.map((q) => q.ndcg10);

const t0 = performance.now();
const oursCI = bootstrapCI(ourScores, ITERATIONS, rng);
console.log(`\n=== Our nDCG@10 (1-sample bootstrap CI) ===`);
console.log(`  point:    ${oursCI.point.toFixed(4)}`);
console.log(`  95% CI:   [${oursCI.lower.toFixed(4)}, ${oursCI.upper.toFixed(4)}]`);

if (ours.baselines) {
  console.log(`\n=== vs each published baseline (CI overlap) ===`);
  for (const [name, score] of Object.entries(ours.baselines)) {
    const ciDiff = oursCI.point - score;
    const lowerDiff = oursCI.lower - score;
    const upperDiff = oursCI.upper - score;
    const direction = ciDiff > 0 ? '↑ above' : '↓ below';
    const sig = (lowerDiff > 0 && upperDiff > 0) ? 'p<0.05 (95% CI excludes baseline)'
              : (lowerDiff < 0 && upperDiff < 0) ? 'p<0.05 (95% CI below baseline)'
              : 'n.s. (95% CI overlaps baseline)';
    console.log(`  ${score.toFixed(3)}  ${name.padEnd(28)}  Δ=${ciDiff >= 0 ? '+' : ''}${ciDiff.toFixed(4)}  ${direction}  [${sig}]`);
  }
}

if (PAIRED_PATH) {
  const baseline = loadRun(PAIRED_PATH);
  console.log(`\n=== Paired bootstrap vs ${PAIRED_PATH} ===`);
  const oursByQid = new Map(ours.perQuery.map((q) => [q.qid, q.ndcg10]));
  const baseByQid = new Map(baseline.perQuery.map((q) => [q.qid, q.ndcg10]));
  const rng2 = mulberry32(SEED + 1);
  const paired = pairedBootstrap(oursByQid, baseByQid, ITERATIONS, rng2);
  console.log(`  paired queries: ${paired.n_paired}`);
  console.log(`  Δ (ours - baseline): ${paired.point_diff >= 0 ? '+' : ''}${paired.point_diff.toFixed(4)}`);
  console.log(`  95% CI: [${paired.lower_95.toFixed(4)}, ${paired.upper_95.toFixed(4)}]`);
  console.log(`  one-sided p (Δ ≤ 0): ${paired.p_one_sided.toFixed(4)}`);
  const sig = paired.lower_95 > 0 ? 'SIGNIFICANT improvement (p<0.025 one-sided)' :
              paired.upper_95 < 0 ? 'SIGNIFICANT regression (p<0.025 one-sided)' :
              'NOT SIGNIFICANT — CI overlaps zero';
  console.log(`  verdict: ${sig}`);
}

console.log(`\nBootstrap took ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
