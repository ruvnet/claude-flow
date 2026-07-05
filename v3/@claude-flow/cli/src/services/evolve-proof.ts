/**
 * single-round proof-of-mechanism  (ADR-176)
 *
 * SCOPE — read this before citing any output:
 *   This is a SINGLE-ROUND PROOF-OF-MECHANISM. It is NOT flywheel proof, NOT
 *   compounding learning, and NOT production learning. Its only purpose is to
 *   prove, on ONE deterministic synthetic round:
 *     (a) gate wiring        — the real versioned accept() decides promotion,
 *     (b) receipt persistence — a self-contained bundle is written to disk,
 *     (c) SHADOW registration — a passing candidate is registered in shadow,
 *     (d) no auto-serve path  — nothing is applied to the active/served policy.
 *   A synthetic PASS here is NOT evidence of real improvement.
 *
 * Independently verifiable: the bundle embeds the holdout, both manifests, the
 * exact PromotionVerdict inputs, and their hashes. verifyReceiptBundle() rehashes
 * everything and RE-RUNS the same versioned accept() — so a third party can
 * confirm *why* the candidate passed/failed without trusting any service log.
 *
 * Pure Node, $0, no LLM, no network, no real store. Deterministic.
 */
import { createHash } from 'node:crypto';
import { accept, type PromotionVerdict, type AcceptResult } from './harness-benchmark.js';
import { canonicalManifestBytes, type ProvenConfigManifest } from '../config/proven-config.js';

/** The promotion rule is versioned so a receipt pins exactly which semantics decided it. */
export const PROMOTION_RULE_VERSION = 'accept/v1';
export const PROOF_LABEL = 'single-round proof-of-mechanism';
export const NOT_CLAIMS = ['not flywheel proof', 'not compounding learning', 'not production learning'] as const;

function sha256(s: string): string { return 'sha256:' + createHash('sha256').update(s).digest('hex'); }
function canon(v: unknown): string {
  const c = (x: unknown): unknown => Array.isArray(x) ? x.map(c)
    : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, c((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(c(v));
}
function manifestHash(m: ProvenConfigManifest): string { return sha256(canonicalManifestBytes(m).toString('utf-8')); }

export interface HoldoutTask { taskId: string; baselineScore: number; candidateScore: number; }

export interface DecisionReceipt {
  promotionRuleVersion: string;
  verdictInputs: PromotionVerdict;   // the exact inputs fed to accept()
  result: AcceptResult;              // accept()'s decision + per-term breakdown
  promoted: boolean;
  reason: string;
}

export interface ShadowRegistration {
  registrationId: string;
  state: 'shadow';
  served: false;                     // proves: no auto-serve path
  candidateManifestHash: string;
  registeredAt: number;
}

export interface CostReceipt { usd: 0; llmCalls: 0; tier: 'synthetic'; notes: string; }

export interface EvolveReceiptBundle {
  label: typeof PROOF_LABEL;
  disclaimers: typeof NOT_CLAIMS;
  generation: number;
  parent: string | null;             // parent generation's promoted candidate hash (lineage link); null at gen 0
  kind: 'synthetic';
  createdAt: number;
  // ── the seven required artifacts ──
  inputHoldoutHash: string;
  baselineManifestHash: string;
  candidateManifestHash: string;
  meetsPromotionRule: { version: string; result: boolean };
  decisionReceipt: DecisionReceipt;
  shadow: ShadowRegistration | null; // null when the candidate did NOT pass
  costReceipt: CostReceipt;
  // ── embedded evidence (so verification needs no service logs) ──
  holdout: HoldoutTask[];
  baselineManifest: ProvenConfigManifest;
  candidateManifest: ProvenConfigManifest;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function mkManifest(policyValue: Record<string, number>): ProvenConfigManifest {
  const ref = sha256(canon(policyValue));
  return { schema: 'ruflo.proven-config/v1', policy: { ref, value: policyValue }, layer: 'synthetic/proof', benchmark: { corpus: 'synthetic-proof-v1', corpusHash: sha256('synthetic-proof-v1') } };
}

/**
 * Run ONE deterministic synthetic evolve round and produce the receipt bundle.
 * `now` is injected (no Date in the pure path) for reproducible fixtures.
 * The default scenario is a strict Pareto improvement (candidate ≥ baseline on
 * every task, > on the mean) so the full PROMOTE→SHADOW path is exercised; pass
 * `regress: true` to exercise the REJECT path instead.
 */
export function runSyntheticProofRound(opts: { now: number; generation?: number; regress?: boolean; parent?: string | null; baseline?: Record<string, number>; candidate?: Record<string, number> } = { now: 0 }): EvolveReceiptBundle {
  const generation = opts.generation ?? 0;
  const parent = opts.parent ?? null;
  const baseline = opts.baseline ?? { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 };
  const candidate = opts.candidate ?? { alpha: 0.3, subjectWeight: 1, mmrLambda: 0.5, bodyWeight: 1.5, typePenaltyFactor: 0.5 };

  // Deterministic synthetic holdout. Default: candidate never worse, sometimes
  // better (Pareto). regress: candidate worse on one task (drives a REJECT).
  const holdout: HoldoutTask[] = [
    { taskId: 't0', baselineScore: 0.60, candidateScore: 0.72 },
    { taskId: 't1', baselineScore: 0.80, candidateScore: 0.80 },
    { taskId: 't2', baselineScore: 0.50, candidateScore: 0.66 },
    { taskId: 't3', baselineScore: 0.90, candidateScore: 0.90 },
    { taskId: 't4', baselineScore: 0.70, candidateScore: opts.regress ? 0.55 : 0.78 },
  ];

  const baselineHeldOut = mean(holdout.map((h) => h.baselineScore));
  const candidateHeldOut = mean(holdout.map((h) => h.candidateScore));
  const canaryRollbackRate = holdout.filter((h) => h.candidateScore < h.baselineScore - 1e-9).length / holdout.length;

  const verdictInputs: PromotionVerdict = {
    heldOutScore: candidateHeldOut,
    baselineHeldOutScore: baselineHeldOut,
    redblue: 'PASS',
    drift: 0,
    driftThreshold: 0.05,
    replayDeterministic: true,
    receiptCoverage: 1,
    canaryRollbackRate,
    baselineRollbackRate: 0,
  };
  const result = accept(verdictInputs);

  const baselineManifest = mkManifest(baseline);
  const candidateManifest = mkManifest(candidate);
  const baselineManifestHash = manifestHash(baselineManifest);
  const candidateManifestHash = manifestHash(candidateManifest);
  const inputHoldoutHash = sha256(canon(holdout));

  const decisionReceipt: DecisionReceipt = {
    promotionRuleVersion: PROMOTION_RULE_VERSION,
    verdictInputs, result, promoted: result.accept,
    reason: result.accept ? 'promoted (all accept/v1 terms held)' : `rejected — ${result.failed.join(', ')}`,
  };

  // SHADOW registration ONLY on pass — and it is explicitly NOT served.
  const shadow: ShadowRegistration | null = result.accept ? {
    registrationId: sha256(`${candidateManifestHash}|gen${generation}|shadow`).replace('sha256:', 'shadow:'),
    state: 'shadow', served: false, candidateManifestHash, registeredAt: opts.now,
  } : null;

  return {
    label: PROOF_LABEL, disclaimers: NOT_CLAIMS, generation, parent, kind: 'synthetic', createdAt: opts.now,
    inputHoldoutHash, baselineManifestHash, candidateManifestHash,
    meetsPromotionRule: { version: PROMOTION_RULE_VERSION, result: result.accept },
    decisionReceipt, shadow,
    costReceipt: { usd: 0, llmCalls: 0, tier: 'synthetic', notes: 'deterministic synthetic round — no model, no network, no real store' },
    holdout, baselineManifest, candidateManifest,
  };
}

export interface VerifyReport {
  valid: boolean;
  hashChecks: { inputHoldout: boolean; baselineManifest: boolean; candidateManifest: boolean };
  recomputed: { baselineHeldOut: number; candidateHeldOut: number; canaryRollbackRate: number; decision: AcceptResult };
  decisionMatches: boolean;
  ruleVersionMatches: boolean;
  noAutoServe: boolean;
  explanation: string;
  mismatches: string[];
}

/**
 * Independently verify a receipt bundle WITHOUT trusting any service log: rehash
 * the embedded holdout + manifests, recompute the held-out means + canary rate
 * from the embedded per-task scores, RE-RUN the same versioned accept(), and
 * confirm the recomputed decision equals the recorded one. Also confirms the
 * SHADOW registration is not served (no auto-serve). Pure; never throws.
 */
export function verifyReceiptBundle(bundle: EvolveReceiptBundle): VerifyReport {
  const mismatches: string[] = [];
  const hashChecks = {
    inputHoldout: sha256(canon(bundle.holdout)) === bundle.inputHoldoutHash,
    baselineManifest: manifestHash(bundle.baselineManifest) === bundle.baselineManifestHash,
    candidateManifest: manifestHash(bundle.candidateManifest) === bundle.candidateManifestHash,
  };
  if (!hashChecks.inputHoldout) mismatches.push('input holdout hash mismatch');
  if (!hashChecks.baselineManifest) mismatches.push('baseline manifest hash mismatch');
  if (!hashChecks.candidateManifest) mismatches.push('candidate manifest hash mismatch');

  const baselineHeldOut = mean(bundle.holdout.map((h) => h.baselineScore));
  const candidateHeldOut = mean(bundle.holdout.map((h) => h.candidateScore));
  const canaryRollbackRate = bundle.holdout.filter((h) => h.candidateScore < h.baselineScore - 1e-9).length / bundle.holdout.length;

  // Re-run the SAME versioned rule on independently-recomputed inputs.
  const ruleVersionMatches = bundle.decisionReceipt.promotionRuleVersion === PROMOTION_RULE_VERSION
    && bundle.meetsPromotionRule.version === PROMOTION_RULE_VERSION;
  if (!ruleVersionMatches) mismatches.push(`promotion rule version != ${PROMOTION_RULE_VERSION}`);

  const decision = accept({
    ...bundle.decisionReceipt.verdictInputs,
    heldOutScore: candidateHeldOut, baselineHeldOutScore: baselineHeldOut, canaryRollbackRate,
  });
  const decisionMatches = decision.accept === bundle.decisionReceipt.promoted && decision.accept === bundle.meetsPromotionRule.result;
  if (!decisionMatches) mismatches.push('recomputed decision != recorded decision');

  // no-auto-serve: a shadow registration must never be marked served.
  const noAutoServe = bundle.shadow === null || bundle.shadow.served === false;
  if (!noAutoServe) mismatches.push('candidate was auto-served (served=true) — violates shadow-only');

  const valid = hashChecks.inputHoldout && hashChecks.baselineManifest && hashChecks.candidateManifest
    && ruleVersionMatches && decisionMatches && noAutoServe;

  const why = decision.accept
    ? `PASS under ${PROMOTION_RULE_VERSION}: held_out ${candidateHeldOut.toFixed(4)} > ${baselineHeldOut.toFixed(4)}, canary rollback ${canaryRollbackRate} ≤ 0, all terms held`
    : `FAIL under ${PROMOTION_RULE_VERSION}: ${decision.failed.join(', ')}`;

  return {
    valid, hashChecks,
    recomputed: { baselineHeldOut, candidateHeldOut, canaryRollbackRate, decision },
    decisionMatches, ruleVersionMatches, noAutoServe,
    explanation: `independently recomputed from the bundle (no service logs) → ${why}`,
    mismatches,
  };
}

// ── Lineage + telemetry ──────────────────────────────────────────────────────
// The flywheel acceptance test: reconstruct the complete lineage from the
// current policy back to generation zero, every promotion independently
// replayable and chained (gen N's baseline == gen N-1's promoted candidate).
// With a single generation this still holds trivially — the scaffolding the
// eventual compounding loop (A-P3b) builds on.

export interface LineageTelemetry {
  generations: number;
  candidatesEvaluated: number;
  promotions: number;
  rejections: number;
  cumulativeHeldOutImprovement: number; // Σ (candidate - baseline) over PROMOTED generations (synthetic here)
  plateaued: boolean;                   // last `plateauWindow` generations produced no promotion
  lineageIntact: boolean;               // every promoted gen chains to its parent AND verifies independently
  allReplayable: boolean;               // every bundle passes verifyReceiptBundle
  chain: Array<{ generation: number; promoted: boolean; parent: string | null; candidateManifestHash: string; delta: number; replayable: boolean }>;
  problems: string[];
}

/**
 * Reconstruct + audit a lineage of receipt bundles. Independently replays every
 * bundle and checks the promoted chain links back to generation zero. Pure.
 */
export function reconstructLineage(bundles: EvolveReceiptBundle[], opts: { plateauWindow?: number } = {}): LineageTelemetry {
  const problems: string[] = [];
  const ordered = [...bundles].sort((a, b) => a.generation - b.generation);
  const plateauWindow = opts.plateauWindow ?? 3;

  let allReplayable = true;
  const chain = ordered.map((b) => {
    const rep = verifyReceiptBundle(b);
    if (!rep.valid) { allReplayable = false; problems.push(`gen ${b.generation}: not independently replayable (${rep.mismatches.join('; ')})`); }
    const delta = b.decisionReceipt.promoted
      ? mean(b.holdout.map((h) => h.candidateScore)) - mean(b.holdout.map((h) => h.baselineScore)) : 0;
    return { generation: b.generation, promoted: b.decisionReceipt.promoted, parent: b.parent, candidateManifestHash: b.candidateManifestHash, delta, replayable: rep.valid };
  });

  // Chain check: gen 0 promoted must have parent null; each later PROMOTED gen's
  // baseline must equal the previous PROMOTED gen's candidate (winner→baseline).
  let lineageIntact = true;
  const promoted = ordered.filter((b) => b.decisionReceipt.promoted);
  for (let i = 0; i < promoted.length; i++) {
    if (i === 0) { if (promoted[i].parent !== null) { lineageIntact = false; problems.push(`gen ${promoted[i].generation}: first promotion must have parent=null`); } continue; }
    if (promoted[i].parent !== promoted[i - 1].candidateManifestHash) {
      lineageIntact = false;
      problems.push(`gen ${promoted[i].generation}: parent != gen ${promoted[i - 1].generation} promoted candidate (broken lineage)`);
    }
    if (promoted[i].baselineManifestHash !== promoted[i - 1].candidateManifestHash) {
      lineageIntact = false;
      problems.push(`gen ${promoted[i].generation}: baseline != previous winner (did not inherit the verified policy)`);
    }
  }

  const recent = ordered.slice(-plateauWindow);
  const plateaued = ordered.length >= plateauWindow && recent.every((b) => !b.decisionReceipt.promoted);

  return {
    generations: ordered.length,
    candidatesEvaluated: ordered.length, // one candidate/round in the proof harness
    promotions: promoted.length,
    rejections: ordered.length - promoted.length,
    cumulativeHeldOutImprovement: chain.reduce((s, c) => s + (c.promoted ? c.delta : 0), 0),
    plateaued, lineageIntact: lineageIntact && allReplayable, allReplayable, chain, problems,
  };
}
