/**
 * Loop orchestrator (ADR-176 phase 8).
 *
 * Composes every gate into one pass:
 *   OBSERVE → QUALIFY → BENCHMARK(held-out) → VERIFY(adversarial+drift)
 *           → CANARY → ACCEPT(conjunction) → emit champion manifest.
 *
 * $0 + fail-closed by default: with no optimizer/verifier/canary wired, nothing
 * is promoted and the current signed champion stands. A champion manifest is
 * emitted ONLY when every accept() term holds — and it is emitted UNSIGNED here;
 * signing is a separate publish step (scripts/sign-proven-config.mjs, GCP key)
 * so key material never touches the loop. The daemon worker runs this bounded.
 */
import { admitTrajectories, AntiPatternArchive, type Trajectory, type ReplayFn } from './harness-qualification.js';
import {
  computeHeldOutSplit, scoreOnTasks, accept,
  type HarnessBenchmarkCorpus, type EvalFn, type GradeFn, type PromotionVerdict, type AcceptResult,
} from './harness-benchmark.js';
import { runVerify, type VerifyOptions, type VerifyResult } from './harness-verify.js';
import { runCanary, compareCanary, type CanaryRunner, type CanaryTelemetry } from './harness-canary.js';
import type { ProvenConfigManifest } from '../config/proven-config.js';

export interface HarnessLoopOptions<C> {
  trajectories: Trajectory[];
  corpus: HarnessBenchmarkCorpus;
  baseline: C;
  candidate?: C;                 // proposed mutation; absent => nothing to evaluate
  evalFn: EvalFn<C>;
  gradeFn: GradeFn;
  replay?: ReplayFn;             // qualification determinism check
  verify?: VerifyOptions;        // redblue+drift runners (default degrade => SKIPPED)
  canaryRunner?: CanaryRunner<C>;// absent => canary required => cannot promote
  archive?: AntiPatternArchive;
  holdoutFrac?: number;
  driftThreshold?: number;
  layer?: string;                // ADR-176 hierarchy for the emitted manifest
  policyRefOf?: (candidate: C) => string; // content hash of the policy blob
  now?: number;
}

export interface HarnessLoopResult {
  admitted: number;
  rejected: number;
  baselineScore?: number;
  candidateScore?: number;
  verify?: VerifyResult;
  canary?: { candidate: CanaryTelemetry; baseline: CanaryTelemetry; pass: boolean };
  verdict?: AcceptResult;
  accepted: boolean;
  manifest?: ProvenConfigManifest; // UNSIGNED; publish signs it
  reason: string;
}

export async function runHarnessLoop<C>(opts: HarnessLoopOptions<C>): Promise<HarnessLoopResult> {
  const driftThreshold = opts.driftThreshold ?? 0.05;

  // 1. QUALIFY — only receipt-backed, deterministic, benchmark-attributed
  //    trajectories become training data; rejects → anti-pattern archive.
  const admission = admitTrajectories(opts.trajectories, { replay: opts.replay, archive: opts.archive, ts: opts.now });
  const base: HarnessLoopResult = { admitted: admission.admittedCount, rejected: admission.rejectedCount, accepted: false, reason: '' };
  if (admission.admittedCount === 0) return { ...base, reason: 'no qualified trajectories (receipt_coverage=0)' };
  if (opts.candidate === undefined) return { ...base, reason: 'no candidate to evaluate' };

  // 2. BENCHMARK — held-out scoring (isolated, reproducible split).
  const { heldOut } = computeHeldOutSplit(opts.corpus.tasks, opts.holdoutFrac ?? 0.2);
  const baselineScore = scoreOnTasks(heldOut, opts.baseline, opts.evalFn, opts.gradeFn).fitness;
  const candidateScore = scoreOnTasks(heldOut, opts.candidate, opts.evalFn, opts.gradeFn).fitness;

  // 3. VERIFY — adversarial + drift (fail-closed: SKIPPED cannot pass).
  const verify = await runVerify({ ...opts.verify, driftThreshold });

  // 4. CANARY — required (separate promotion from deployment); absent => no promote.
  if (!opts.canaryRunner) {
    return { ...base, baselineScore, candidateScore, verify, accepted: false, reason: 'canary required (no runner) — cannot promote' };
  }
  const slice = opts.corpus.tasks.map(t => ({ id: t.id, input: t.input }));
  const canaryCand = runCanary(opts.candidate, slice, opts.canaryRunner);
  const canaryBase = runCanary(opts.baseline, slice, opts.canaryRunner);
  const canaryCmp = compareCanary(canaryCand, canaryBase);

  // 5. ACCEPT — the full conjunction. receipt_coverage=1 by construction (only
  //    qualified trajectories are used; rejects were excluded).
  const verdict: PromotionVerdict = {
    heldOutScore: candidateScore,
    baselineHeldOutScore: baselineScore,
    redblue: verify.redblue,
    drift: verify.drift < 0 ? Number.POSITIVE_INFINITY : verify.drift,
    driftThreshold,
    replayDeterministic: !!opts.replay, // qualification already enforced replay determinism on admitted set
    receiptCoverage: 1,
    canaryRollbackRate: canaryCand.rollbackRate,
    baselineRollbackRate: canaryBase.rollbackRate,
  };
  const decision = accept(verdict);

  const result: HarnessLoopResult = {
    ...base, baselineScore, candidateScore, verify,
    canary: { candidate: canaryCand, baseline: canaryBase, pass: canaryCmp.pass },
    verdict: decision, accepted: decision.accept,
    reason: decision.accept ? 'accepted — all gates hold' : `rejected — ${decision.failed.join(', ')}`,
  };

  // 6. EMIT the champion manifest (UNSIGNED) on acceptance.
  if (decision.accept && canaryCmp.pass) {
    result.manifest = {
      schema: 'ruflo.proven-config/v1',
      policy: { ref: opts.policyRefOf ? opts.policyRefOf(opts.candidate) : 'sha256:unknown' },
      layer: opts.layer,
      compatibility: { ruflo: '>=3.24.0' },
      benchmark: { corpus: opts.corpus.version, corpusHash: opts.corpus.corpusHash },
      receipt: {
        heldOutDelta: candidateScore - baselineScore,
        redblue: verify.redblue,
        drift: verify.drift,
        canary: { rollbackRate: canaryCand.rollbackRate, latencyP95: canaryCand.latencyP95, costPerTask: canaryCand.costPerTask },
        receiptCoverage: 1,
      },
    };
  } else if (decision.accept && !canaryCmp.pass) {
    result.accepted = false;
    result.reason = `rejected — canary regressed (${canaryCmp.failed.join(', ')})`;
  }

  return result;
}
