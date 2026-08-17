#!/usr/bin/env node
// prior-decay-benchmark.mjs — discounted Thompson sampling (ModelRouterConfig
// .priorDecay) vs undecayed baseline.
//
// Two scenarios, same paired-seed methodology as prior dream-cycle nights'
// benchmark scripts (identical random stream fed to baseline and candidate
// so any difference is attributable to the decay math, not RNG noise):
//
//   1. STATIONARY  — the "correct" model never changes. Pre-declared
//      invariant: candidate's cumulative reward must not regress vs baseline.
//   2. NON-STATIONARY — the correct model changes once, mid-run (simulating
//      a real-world model-quality shift). Measures how many post-shift
//      rounds it takes the router to recover (trailing-20-window >=70% new
//      correct model).
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
const LOW_TASK = 'fix a typo in the readme file';
const CANDIDATE_DECAY = argNum('--decay', 0.995);
const RECOVERY_WINDOW = 20;
const RECOVERY_THRESHOLD = 14; // >=70% of trailing window

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

async function runNonStationaryTrial(priorDecay, seed, tmpDir, tag) {
  Math.random = mulberry32(seed);
  const router = freshRouter(priorDecay, tmpDir, tag);
  let postShiftCorrectPicks = 0;
  let postShiftRounds = 0;
  let recoveryRound = null;
  const window = [];
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const correctModel = i < SHIFT_AT ? 'haiku' : 'sonnet';
    const result = await router.route(LOW_TASK);
    const picked = result.model;
    const outcome = picked === correctModel ? 'success' : 'failure';
    router.recordOutcome(LOW_TASK, picked, outcome);
    if (i >= SHIFT_AT) {
      postShiftRounds++;
      const hit = picked === 'sonnet' ? 1 : 0;
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

async function runStationaryTrial(priorDecay, seed, tmpDir, tag) {
  Math.random = mulberry32(seed);
  const router = freshRouter(priorDecay, tmpDir, tag);
  let correctPicks = 0;
  for (let i = 0; i < STATIONARY_ROUNDS; i++) {
    const result = await router.route(LOW_TASK);
    const picked = result.model;
    const outcome = picked === 'haiku' ? 'success' : 'failure';
    router.recordOutcome(LOW_TASK, picked, outcome);
    if (picked === 'haiku') correctPicks++;
  }
  return { correctRate: correctPicks / STATIONARY_ROUNDS };
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
// Paired t-statistic (candidate - baseline), one sample per seed.
function pairedT(diffs) {
  const n = diffs.length;
  const m = mean(diffs);
  const sd = stddev(diffs) || 1e-12;
  return (m / (sd / Math.sqrt(n))) * Math.sqrt(n / (n - 1)); // small-sample correction
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'prior-decay-bench-'));
  const origRandom = Math.random;
  try {
    const nsBaseline = [];
    const nsCandidate = [];
    const stBaseline = [];
    const stCandidate = [];

    for (let seed = 0; seed < TRIALS; seed++) {
      nsBaseline.push(await runNonStationaryTrial(1, 1000 + seed, tmpDir, `ns-base-${seed}`));
      nsCandidate.push(
        await runNonStationaryTrial(CANDIDATE_DECAY, 1000 + seed, tmpDir, `ns-cand-${seed}`)
      );
      stBaseline.push(await runStationaryTrial(1, 2000 + seed, tmpDir, `st-base-${seed}`));
      stCandidate.push(
        await runStationaryTrial(CANDIDATE_DECAY, 2000 + seed, tmpDir, `st-cand-${seed}`)
      );
    }

    const recoveryDiffs = nsBaseline.map((b, i) => b.recoveryRound - nsCandidate[i].recoveryRound);
    const postShiftRateDiffs = nsCandidate.map(
      (c, i) => c.postShiftCorrectRate - nsBaseline[i].postShiftCorrectRate
    );
    const stationaryDiffs = stCandidate.map((c, i) => c.correctRate - stBaseline[i].correctRate);

    const result = {
      config: { TRIALS, SHIFT_AT, POST_ROUNDS, TOTAL_ROUNDS, STATIONARY_ROUNDS, CANDIDATE_DECAY, RECOVERY_WINDOW, RECOVERY_THRESHOLD },
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
