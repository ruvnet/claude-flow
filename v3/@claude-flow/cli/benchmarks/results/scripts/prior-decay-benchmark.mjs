#!/usr/bin/env node
// prior-decay-benchmark.mjs — discounted Thompson sampling (ModelRouterConfig
// .priorDecay) vs undecayed baseline.
//
// Two scenario TYPES, run across two complexity buckets (low, med — see
// SCENARIOS below), same paired-seed methodology as prior dream-cycle
// nights' benchmark scripts (identical random stream fed to baseline and
// candidate so any difference is attributable to the decay math, not RNG
// noise):
//
//   1. STATIONARY  — the "correct" model never changes. Pre-declared
//      invariant: candidate's cumulative reward must not regress vs baseline.
//   2. NON-STATIONARY — the correct model changes once, mid-run (simulating
//      a real-world model-quality shift). Measures how many post-shift
//      rounds it takes the router to recover (trailing-20-window >=70% new
//      correct model).
//
// The 'med' bucket coverage (in addition to the original 'low' bucket) was
// added after an independent adversarial-critic pass flagged that the first
// version of this benchmark only ever exercised the 'low' bucket, so the
// recovery-speed claim wasn't empirically validated for buckets with a
// different BANDIT_REWARDS table (opus success=0.4 vs haiku=1.0, which
// changes how fast a decayed-then-refed posterior separates).
//
// Usage:
//   cd v3/@claude-flow/cli
//   npx tsx benchmarks/results/scripts/prior-decay-benchmark.mjs [--trials N]

import { ModelRouter } from '../../../src/ruvector/model-router.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function argNum(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? parseFloat(process.argv[i + 1]) : fallback;
}

const TRIALS = argNum('--trials', 30);
const SHIFT_AT = argNum('--shift-at', 1500); // pre-shift rounds — simulates accumulated
// history from a long-running persisted `.swarm/model-router-state.json` (months of
// nightly routing decisions) before a real-world model-quality shift occurs.
const POST_ROUNDS = argNum('--post-rounds', 300);
const TOTAL_ROUNDS = SHIFT_AT + POST_ROUNDS;
const STATIONARY_ROUNDS = argNum('--stationary-rounds', 400);
const CANDIDATE_DECAY = argNum('--decay', 0.995);
const RECOVERY_WINDOW = 20;
const RECOVERY_THRESHOLD = 14; // >=70% of trailing window

// Task strings pinned to a bucket by direct measurement (analyzeComplexity),
// not by assumption — see the score probe referenced in the PR/issue.
const SCENARIOS = [
  {
    bucket: 'low',
    task: 'fix a typo in the readme file',
    before: 'haiku',
    after: 'sonnet',
  },
  {
    bucket: 'med',
    task: 'refactor the payment processing module to support multiple currencies and add integration tests',
    before: 'sonnet',
    after: 'opus',
  },
];

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshRouter(priorDecay, tmpDir, tag) {
  return new ModelRouter({
    statePath: join(tmpDir, `state-${tag}.json`),
    priorDecay,
  });
}

async function runNonStationaryTrial(scenario, priorDecay, seed, tmpDir, tag) {
  Math.random = mulberry32(seed);
  const router = freshRouter(priorDecay, tmpDir, tag);
  let postShiftCorrectPicks = 0;
  let postShiftRounds = 0;
  let recoveryRound = null;
  const window = [];
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const correctModel = i < SHIFT_AT ? scenario.before : scenario.after;
    const result = await router.route(scenario.task);
    const picked = result.model;
    const outcome = picked === correctModel ? 'success' : 'failure';
    router.recordOutcome(scenario.task, picked, outcome);
    if (i >= SHIFT_AT) {
      postShiftRounds++;
      const hit = picked === scenario.after ? 1 : 0;
      postShiftCorrectPicks += hit;
      window.push(hit);
      if (window.length > RECOVERY_WINDOW) window.shift();
      if (
        recoveryRound === null &&
        window.length === RECOVERY_WINDOW &&
        window.reduce((a, b) => a + b, 0) >= RECOVERY_THRESHOLD
      ) {
        recoveryRound = i - SHIFT_AT + 1;
      }
    }
  }
  return {
    postShiftCorrectRate: postShiftCorrectPicks / postShiftRounds,
    recoveryRound: recoveryRound ?? TOTAL_ROUNDS - SHIFT_AT, // censored at max if never recovered
  };
}

async function runStationaryTrial(scenario, priorDecay, seed, tmpDir, tag) {
  Math.random = mulberry32(seed);
  const router = freshRouter(priorDecay, tmpDir, tag);
  let correctPicks = 0;
  for (let i = 0; i < STATIONARY_ROUNDS; i++) {
    const result = await router.route(scenario.task);
    const picked = result.model;
    const outcome = picked === scenario.before ? 'success' : 'failure';
    router.recordOutcome(scenario.task, picked, outcome);
    if (picked === scenario.before) correctPicks++;
  }
  return { correctRate: correctPicks / STATIONARY_ROUNDS };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
// SAMPLE stddev (Bessel's correction, ÷(n-1)) — required for a paired
// t-statistic. An earlier version of this function used population stddev
// (÷n) with an incorrectly-placed correction factor, inflating every
// reported t-value by exactly n/(n-1) (~3.4% at n=30). Caught by an
// independent adversarial-critic pass; fixed here, not just in the receipt.
function sampleStddev(xs) {
  const m = mean(xs);
  const n = xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
}
// Paired t-statistic (candidate - baseline), one sample per seed.
function pairedT(diffs) {
  const n = diffs.length;
  const m = mean(diffs);
  const sd = sampleStddev(diffs) || 1e-12;
  return m / (sd / Math.sqrt(n));
}

async function runScenario(scenario, tmpDir) {
  const nsBaseline = [];
  const nsCandidate = [];
  const stBaseline = [];
  const stCandidate = [];

  for (let seed = 0; seed < TRIALS; seed++) {
    const tag = `${scenario.bucket}-${seed}`;
    nsBaseline.push(await runNonStationaryTrial(scenario, 1, 1000 + seed, tmpDir, `ns-base-${tag}`));
    nsCandidate.push(
      await runNonStationaryTrial(scenario, CANDIDATE_DECAY, 1000 + seed, tmpDir, `ns-cand-${tag}`)
    );
    stBaseline.push(await runStationaryTrial(scenario, 1, 2000 + seed, tmpDir, `st-base-${tag}`));
    stCandidate.push(
      await runStationaryTrial(scenario, CANDIDATE_DECAY, 2000 + seed, tmpDir, `st-cand-${tag}`)
    );
  }

  const recoveryDiffs = nsBaseline.map((b, i) => b.recoveryRound - nsCandidate[i].recoveryRound);
  const postShiftRateDiffs = nsCandidate.map(
    (c, i) => c.postShiftCorrectRate - nsBaseline[i].postShiftCorrectRate
  );
  const stationaryDiffs = stCandidate.map((c, i) => c.correctRate - stBaseline[i].correctRate);

  return {
    bucket: scenario.bucket,
    task: scenario.task,
    shift: `${scenario.before} -> ${scenario.after}`,
    nonStationary: {
      baselineMeanRecoveryRound: mean(nsBaseline.map((r) => r.recoveryRound)),
      candidateMeanRecoveryRound: mean(nsCandidate.map((r) => r.recoveryRound)),
      recoveryRoundDeltaMean: mean(recoveryDiffs),
      recoveryRoundDeltaT: pairedT(recoveryDiffs),
      baselineMeanPostShiftCorrectRate: mean(nsBaseline.map((r) => r.postShiftCorrectRate)),
      candidateMeanPostShiftCorrectRate: mean(nsCandidate.map((r) => r.postShiftCorrectRate)),
      postShiftRateDeltaMean: mean(postShiftRateDiffs),
      postShiftRateDeltaT: pairedT(postShiftRateDiffs),
    },
    stationary: {
      baselineMeanCorrectRate: mean(stBaseline.map((r) => r.correctRate)),
      candidateMeanCorrectRate: mean(stCandidate.map((r) => r.correctRate)),
      deltaMean: mean(stationaryDiffs),
      deltaT: pairedT(stationaryDiffs),
      invariantHeld: mean(stationaryDiffs) >= -0.01, // candidate must not regress (>1pp) vs baseline
    },
  };
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'prior-decay-bench-'));
  const origRandom = Math.random;
  try {
    const scenarioResults = [];
    for (const scenario of SCENARIOS) {
      scenarioResults.push(await runScenario(scenario, tmpDir));
    }

    const result = {
      config: { TRIALS, SHIFT_AT, POST_ROUNDS, TOTAL_ROUNDS, STATIONARY_ROUNDS, CANDIDATE_DECAY, RECOVERY_WINDOW, RECOVERY_THRESHOLD },
      scenarios: scenarioResults,
      generatedAt: new Date().toISOString(),
    };

    console.log(JSON.stringify(result, null, 2));
    writeFileSync(
      join(new URL('.', import.meta.url).pathname, '..', 'prior-decay-receipt.json'),
      JSON.stringify(result, null, 2)
    );
  } finally {
    Math.random = origRandom;
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
