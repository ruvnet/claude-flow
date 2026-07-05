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
import { bootstrapDeltaCILow } from './harness-improvement-ledger.js';
import { canonicalManifestBytes, type ProvenConfigManifest } from '../config/proven-config.js';

/**
 * The promotion rule is versioned so a receipt pins exactly which semantics
 * decided it. v1+sig = the accept() conjunction AND a statistical-significance
 * term: the per-held-out-task deltas must have a positive one-sided 95% bootstrap
 * lower bound, so a small-N mean gain can't ride on noise. The canary term is a
 * SEPARATE deployment-safety signal (a distinct slice), not held-out dominance.
 */
export const PROMOTION_RULE_VERSION = 'accept/v1+sig';
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
  significant: boolean;              // per-task delta bootstrap CI lower bound > 0
  deltaCILow: number;                // that lower bound (recomputable from holdout)
  promoted: boolean;                 // = result.accept AND significant (the FINAL decision)
  reason: string;
}

export interface ShadowRegistration {
  registrationId: string;
  state: 'shadow';
  served: false;                     // proves: no auto-serve path
  candidateManifestHash: string;
  registeredAt: number;
}

export interface CostReceipt { usd: number; llmCalls: number; tier: string; notes: string; }

/** Multi-dimensional deltas vs the parent — distinguishes *why* a change is (un)safe. */
export interface ChangeDeltas { benchmark: number; security: number; cost: number; }

/**
 * Causal promotion record (not just provenance). Answers *why* a candidate won —
 * and, aggregated across the lineage, *which mutation classes* reliably pay off.
 * This is what turns the lineage from an audit trail into a knowledge base.
 */
export interface PromotionRecord {
  parentManifestHash: string | null;
  candidateManifestHash: string;
  mutationClass: string;             // the KIND of change (e.g. 'retrieval:alpha', 'retrieval:multi')
  mutationSummary: string;           // human-readable diff of the policy fields that changed
  deltas: ChangeDeltas;
  decisionReceipt: DecisionReceipt;
}

/** Regression ancestry — a rejected candidate records the gate that killed it + its ancestor. */
export interface RegressionRecord {
  candidateManifestHash: string;
  ancestor: string | null;           // the policy this mutated from
  mutationClass: string;
  failureCause: 'holdout' | 'security' | 'drift' | 'replay' | 'governance' | 'canary' | 'significance';
  failedTerms: string[];             // the accept() terms that failed
}

export interface EvolveReceiptBundle {
  label: typeof PROOF_LABEL;
  disclaimers: typeof NOT_CLAIMS;
  generation: number;
  parent: string | null;             // parent generation's promoted candidate hash (lineage link); null at the root
  branch: string;                    // DAG branch label (default 'main') — anticipates tenant/domain branches
  kind: 'synthetic' | 'real';        // 'real' = measured on live retrieval over a frozen anchor
  createdAt: number;
  // ── the seven required artifacts ──
  inputHoldoutHash: string;
  baselineManifestHash: string;
  candidateManifestHash: string;
  meetsPromotionRule: { version: string; result: boolean };
  decisionReceipt: DecisionReceipt;
  shadow: ShadowRegistration | null; // null when the candidate did NOT pass
  costReceipt: CostReceipt;
  // ── causality (why), not just provenance (what) ──
  mutationClass: string;
  mutationSummary: string;
  deltas: ChangeDeltas;
  promotion: PromotionRecord | null; // populated on pass
  regression: RegressionRecord | null; // populated on reject
  // ── embedded evidence (so verification needs no service logs) ──
  holdout: HoldoutTask[];
  baselineManifest: ProvenConfigManifest;
  candidateManifest: ProvenConfigManifest;
}

const FAILURE_CAUSE: Record<string, RegressionRecord['failureCause']> = {
  held_out_improves: 'holdout', redblue_pass: 'security', drift_within: 'drift',
  replay_deterministic: 'replay', receipt_coverage_full: 'governance', canary_no_worse: 'canary',
};

/** Classify a policy mutation by which fields changed → a repeatable mutation CLASS + a diff summary. */
export function classifyMutation(baseline: Record<string, number>, candidate: Record<string, number>): { mutationClass: string; mutationSummary: string } {
  const changed = Object.keys(candidate).filter((k) => candidate[k] !== baseline[k]).sort();
  if (changed.length === 0) return { mutationClass: 'none', mutationSummary: 'no change' };
  const summary = changed.map((k) => `${k}:${baseline[k]}→${candidate[k]}`).join(', ');
  const mutationClass = changed.length === 1 ? `retrieval:${changed[0]}` : 'retrieval:multi';
  return { mutationClass, mutationSummary: summary };
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function mkManifest(policyValue: Record<string, number>, layer = 'synthetic/proof', corpus = 'synthetic-proof-v1'): ProvenConfigManifest {
  const ref = sha256(canon(policyValue));
  return { schema: 'ruflo.proven-config/v1', policy: { ref, value: policyValue }, layer, benchmark: { corpus, corpusHash: sha256(corpus) } };
}

export interface AssembleOpts {
  generation: number; parent: string | null; branch: string; now: number;
  kind: 'synthetic' | 'real';
  cost: { tier: string; notes: string };
  redblue?: 'PASS' | 'FAIL' | 'SKIPPED'; drift?: number;
  canaryRollbackRate?: number;       // SEPARATE deployment-safety signal; default = strict per-held-out-task regression
  layer?: string; corpus?: string;
}

/**
 * Assemble a receipt bundle from a holdout + configs. This is the SHARED core:
 * the synthetic proof and a REAL measured round produce byte-identical bundle
 * structure and run the SAME versioned accept() — so `verifyReceiptBundle`
 * replays a real bundle exactly as it replays the synthetic fixture.
 */
export function assembleBundle(baseline: Record<string, number>, candidate: Record<string, number>, holdout: HoldoutTask[], o: AssembleOpts): EvolveReceiptBundle {
  const baselineHeldOut = mean(holdout.map((h) => h.baselineScore));
  const candidateHeldOut = mean(holdout.map((h) => h.candidateScore));
  // Canary is a SEPARATE deployment-safety signal (default: strict per-held-out
  // regression, preserving synthetic behavior; real rounds pass a distinct slice).
  const canaryRollbackRate = o.canaryRollbackRate ?? holdout.filter((h) => h.candidateScore < h.baselineScore - 1e-9).length / holdout.length;
  // Statistical-significance term (small-N noise guard): bootstrap lower bound on
  // the per-task deltas must be > 0.
  const deltaCILow = bootstrapDeltaCILow(holdout.map((h) => h.candidateScore - h.baselineScore));
  const significant = deltaCILow > 0;

  const verdictInputs: PromotionVerdict = {
    heldOutScore: candidateHeldOut, baselineHeldOutScore: baselineHeldOut,
    redblue: o.redblue ?? 'PASS', drift: o.drift ?? 0, driftThreshold: 0.05,
    replayDeterministic: true, receiptCoverage: 1, canaryRollbackRate, baselineRollbackRate: 0,
  };
  const result = accept(verdictInputs);
  const promoted = result.accept && significant;

  const baselineManifest = mkManifest(baseline, o.layer, o.corpus);
  const candidateManifest = mkManifest(candidate, o.layer, o.corpus);
  const baselineManifestHash = manifestHash(baselineManifest);
  const candidateManifestHash = manifestHash(candidateManifest);
  const inputHoldoutHash = sha256(canon(holdout));

  const failed = [...result.failed, ...(!significant ? ['significant'] : [])];
  const decisionReceipt: DecisionReceipt = {
    promotionRuleVersion: PROMOTION_RULE_VERSION, verdictInputs, result, significant, deltaCILow, promoted,
    reason: promoted ? `promoted (all ${PROMOTION_RULE_VERSION} terms held)` : `rejected — ${failed.join(', ')}`,
  };
  const shadow: ShadowRegistration | null = promoted ? {
    registrationId: sha256(`${candidateManifestHash}|gen${o.generation}|shadow`).replace('sha256:', 'shadow:'),
    state: 'shadow', served: false, candidateManifestHash, registeredAt: o.now,
  } : null;

  const { mutationClass, mutationSummary } = classifyMutation(baseline, candidate);
  const deltas: ChangeDeltas = { benchmark: candidateHeldOut - baselineHeldOut, security: o.redblue === 'FAIL' ? -1 : 0, cost: 0 };
  const promotion: PromotionRecord | null = promoted ? { parentManifestHash: o.parent, candidateManifestHash, mutationClass, mutationSummary, deltas, decisionReceipt } : null;
  const regression: RegressionRecord | null = promoted ? null : {
    candidateManifestHash, ancestor: o.parent ?? baselineManifestHash, mutationClass,
    failureCause: !significant && result.accept ? 'significance' : (FAILURE_CAUSE[result.failed[0]] ?? 'holdout'), failedTerms: failed,
  };

  return {
    label: PROOF_LABEL, disclaimers: NOT_CLAIMS, generation: o.generation, parent: o.parent, branch: o.branch, kind: o.kind, createdAt: o.now,
    inputHoldoutHash, baselineManifestHash, candidateManifestHash,
    meetsPromotionRule: { version: PROMOTION_RULE_VERSION, result: promoted },
    decisionReceipt, shadow,
    costReceipt: { usd: 0, llmCalls: 0, tier: o.cost.tier, notes: o.cost.notes },
    mutationClass, mutationSummary, deltas, promotion, regression,
    holdout, baselineManifest, candidateManifest,
  };
}

/**
 * Build a REAL evolve-round receipt bundle from MEASURED holdout scores (live
 * retrieval over a frozen anchor). Same gate, same replayability as the
 * synthetic proof — but `kind: 'real'` and the scores come from actual runs.
 * `redblue` should be 'FAIL' if the candidate regressed a frozen security/anchor
 * slice; drift from real distribution shift. $0 (no LLM/network on this path).
 */
export function runRealEvolveRound(opts: {
  baseline: Record<string, number>; candidate: Record<string, number>; holdout: HoldoutTask[];
  generation: number; parent: string | null; branch?: string; now: number;
  redblue?: 'PASS' | 'FAIL' | 'SKIPPED'; drift?: number; canaryRollbackRate?: number; corpus: string;
}): EvolveReceiptBundle {
  return assembleBundle(opts.baseline, opts.candidate, opts.holdout, {
    generation: opts.generation, parent: opts.parent, branch: opts.branch ?? 'main', now: opts.now, kind: 'real',
    cost: { tier: 'real-local', notes: 'measured on the frozen anchor via live retrieval — no LLM, no network' },
    redblue: opts.redblue, drift: opts.drift, canaryRollbackRate: opts.canaryRollbackRate, layer: 'real/retrieval', corpus: opts.corpus,
  });
}

/**
 * Run ONE deterministic synthetic evolve round and produce the receipt bundle.
 * `now` is injected (no Date in the pure path) for reproducible fixtures.
 * The default scenario is a strict Pareto improvement (candidate ≥ baseline on
 * every task, > on the mean) so the full PROMOTE→SHADOW path is exercised; pass
 * `regress: true` to exercise the REJECT path instead.
 */
export function runSyntheticProofRound(opts: { now: number; generation?: number; regress?: boolean; parent?: string | null; branch?: string; baseline?: Record<string, number>; candidate?: Record<string, number> } = { now: 0 }): EvolveReceiptBundle {
  const generation = opts.generation ?? 0;
  const parent = opts.parent ?? null;
  const branch = opts.branch ?? 'main';
  const baseline = opts.baseline ?? { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 };
  const candidate = opts.candidate ?? { alpha: 0.3, subjectWeight: 1, mmrLambda: 0.5, bodyWeight: 1.5, typePenaltyFactor: 0.5 };

  // Deterministic synthetic holdout. Default: candidate never worse, sometimes
  // better (Pareto). regress: candidate worse on one task (drives a REJECT).
  const holdout: HoldoutTask[] = [
    { taskId: 't0', baselineScore: 0.60, candidateScore: 0.70 },
    { taskId: 't1', baselineScore: 0.80, candidateScore: 0.86 },
    { taskId: 't2', baselineScore: 0.50, candidateScore: 0.62 },
    { taskId: 't3', baselineScore: 0.72, candidateScore: 0.80 },
    { taskId: 't4', baselineScore: 0.66, candidateScore: opts.regress ? 0.50 : 0.78 },
  ];

  return assembleBundle(baseline, candidate, holdout, {
    generation, parent, branch, now: opts.now, kind: 'synthetic',
    cost: { tier: 'synthetic', notes: 'deterministic synthetic round — no model, no network, no real store' },
  });
}

export interface VerifyReport {
  valid: boolean;
  hashChecks: { inputHoldout: boolean; baselineManifest: boolean; candidateManifest: boolean };
  recomputed: { baselineHeldOut: number; candidateHeldOut: number; canaryRollbackRate: number; decision: AcceptResult };
  decisionMatches: boolean;
  ruleVersionMatches: boolean;
  noAutoServe: boolean;
  causalConsistent: boolean;   // promotion/regression record present + benchmark delta matches recompute
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
  // The canary is a SEPARATE slice (not embedded) — trust the recorded rate; the
  // held-out means + significance ARE independently recomputed from the holdout,
  // so holdout tampering is still caught (via means/significance/decision).
  const canaryRollbackRate = bundle.decisionReceipt.verdictInputs.canaryRollbackRate;
  const deltaCILow = bootstrapDeltaCILow(bundle.holdout.map((h) => h.candidateScore - h.baselineScore));
  const significant = deltaCILow > 0;

  // Re-run the SAME versioned rule on independently-recomputed inputs.
  const ruleVersionMatches = bundle.decisionReceipt.promotionRuleVersion === PROMOTION_RULE_VERSION
    && bundle.meetsPromotionRule.version === PROMOTION_RULE_VERSION;
  if (!ruleVersionMatches) mismatches.push(`promotion rule version != ${PROMOTION_RULE_VERSION}`);

  const decision = accept({
    ...bundle.decisionReceipt.verdictInputs,
    heldOutScore: candidateHeldOut, baselineHeldOutScore: baselineHeldOut,
  });
  const promotedRecomputed = decision.accept && significant;
  const decisionMatches = promotedRecomputed === bundle.decisionReceipt.promoted && promotedRecomputed === bundle.meetsPromotionRule.result;
  if (!decisionMatches) mismatches.push('recomputed decision != recorded decision');

  // no-auto-serve: a shadow registration must never be marked served.
  const noAutoServe = bundle.shadow === null || bundle.shadow.served === false;
  if (!noAutoServe) mismatches.push('candidate was auto-served (served=true) — violates shadow-only');

  // causal record consistency: a pass carries a promotion record (with a delta
  // that matches the recompute) and no regression; a reject carries the inverse.
  const benchmarkDeltaMatches = Math.abs(bundle.deltas.benchmark - (candidateHeldOut - baselineHeldOut)) < 1e-9;
  const causalConsistent = promotedRecomputed
    ? (bundle.promotion !== null && bundle.regression === null && benchmarkDeltaMatches)
    : (bundle.promotion === null && bundle.regression !== null);
  if (!causalConsistent) mismatches.push('causal record inconsistent with the decision (promotion/regression/delta)');

  const valid = hashChecks.inputHoldout && hashChecks.baselineManifest && hashChecks.candidateManifest
    && ruleVersionMatches && decisionMatches && noAutoServe && causalConsistent;

  const why = promotedRecomputed
    ? `PASS under ${PROMOTION_RULE_VERSION}: held_out ${candidateHeldOut.toFixed(4)} > ${baselineHeldOut.toFixed(4)} (Δ CI-low ${deltaCILow.toFixed(4)} > 0, significant), canary rollback ${canaryRollbackRate} ≤ 0, all terms held`
    : `FAIL under ${PROMOTION_RULE_VERSION}: ${[...decision.failed, ...(!significant ? ['significant'] : [])].join(', ')}`;

  return {
    valid, hashChecks,
    recomputed: { baselineHeldOut, candidateHeldOut, canaryRollbackRate, decision },
    decisionMatches, ruleVersionMatches, noAutoServe, causalConsistent,
    explanation: `independently recomputed from the bundle (no service logs) → ${why}`,
    mismatches,
  };
}

// ── Lineage as a DAG — "version control for operating policies" ───────────────
// The flywheel acceptance test: reconstruct the complete lineage from any current
// policy back to the IMMUTABLE ROOT of the evolution graph (generation 0), every
// promotion independently replayable, with the DAG invariant: a child's baseline
// == its parent's promoted candidate (you inherit the policy you branched from).
// Modeled as a DAG, not a linked list, so it anticipates tenant/domain branches.

export interface LineageTelemetry {
  generations: number;
  candidatesEvaluated: number;
  promotions: number;
  rejections: number;
  cumulativeHeldOutImprovement: number; // Σ benchmark delta over PROMOTED nodes
  rootHash: string | null;              // the immutable root's candidate hash
  branches: string[];
  lineageIntact: boolean;               // single root + all parents resolve + baseline==parent.candidate + all replayable
  allReplayable: boolean;
  nodes: Array<{ generation: number; branch: string; promoted: boolean; parent: string | null; candidateManifestHash: string; mutationClass: string; delta: number; replayable: boolean }>;
  problems: string[];
}

/**
 * Reconstruct + audit a lineage DAG. Independently replays every bundle and
 * checks the graph invariants back to the immutable root. Pure; never throws.
 */
export function reconstructLineage(bundles: EvolveReceiptBundle[]): LineageTelemetry {
  const problems: string[] = [];
  const ordered = [...bundles].sort((a, b) => a.generation - b.generation);
  const byCandidate = new Map(ordered.map((b) => [b.candidateManifestHash, b]));

  let allReplayable = true;
  const nodes = ordered.map((b) => {
    const rep = verifyReceiptBundle(b);
    if (!rep.valid) { allReplayable = false; problems.push(`gen ${b.generation}: not independently replayable (${rep.mismatches.join('; ')})`); }
    return { generation: b.generation, branch: b.branch, promoted: b.decisionReceipt.promoted, parent: b.parent, candidateManifestHash: b.candidateManifestHash, mutationClass: b.mutationClass, delta: b.deltas.benchmark, replayable: rep.valid };
  });

  // DAG invariants.
  let lineageIntact = true;
  const roots = ordered.filter((b) => b.parent === null);
  if (roots.length !== 1) { lineageIntact = false; problems.push(`expected exactly one immutable root, found ${roots.length}`); }
  for (const b of ordered) {
    if (b.parent === null) continue;
    const parent = byCandidate.get(b.parent);
    if (!parent) { lineageIntact = false; problems.push(`gen ${b.generation} (${b.branch}): parent ${b.parent.slice(0, 20)}… not found in graph`); continue; }
    if (parent.generation >= b.generation) { lineageIntact = false; problems.push(`gen ${b.generation}: parent generation ${parent.generation} not older (cycle risk)`); }
    if (b.baselineManifestHash !== parent.candidateManifestHash) {
      lineageIntact = false;
      problems.push(`gen ${b.generation} (${b.branch}): baseline != parent's promoted candidate (did not inherit the verified policy)`);
    }
  }

  return {
    generations: ordered.length,
    candidatesEvaluated: ordered.length,
    promotions: ordered.filter((b) => b.decisionReceipt.promoted).length,
    rejections: ordered.filter((b) => !b.decisionReceipt.promoted).length,
    cumulativeHeldOutImprovement: ordered.reduce((s, b) => s + (b.decisionReceipt.promoted ? b.deltas.benchmark : 0), 0),
    rootHash: roots[0]?.candidateManifestHash ?? null,
    branches: [...new Set(ordered.map((b) => b.branch))],
    lineageIntact: lineageIntact && allReplayable, allReplayable, nodes, problems,
  };
}

// ── Mutation effectiveness — evidence-grounded meta-learning ──────────────────

export interface MutationStat { mutationClass: string; attempts: number; promotions: number; meanDelta: number; }

/**
 * Aggregate per-mutation-class effectiveness across a lineage. After enough
 * generations the optimizer can bias toward classes with higher historical
 * payoff — meta-learning grounded in evidence, not intuition.
 */
export function mutationEffectiveness(bundles: EvolveReceiptBundle[]): MutationStat[] {
  const by = new Map<string, { attempts: number; promotions: number; deltas: number[] }>();
  for (const b of bundles) {
    const e = by.get(b.mutationClass) ?? { attempts: 0, promotions: 0, deltas: [] };
    e.attempts++;
    if (b.decisionReceipt.promoted) { e.promotions++; e.deltas.push(b.deltas.benchmark); }
    by.set(b.mutationClass, e);
  }
  return [...by.entries()]
    .map(([mutationClass, e]) => ({ mutationClass, attempts: e.attempts, promotions: e.promotions, meanDelta: mean(e.deltas) }))
    .sort((a, b) => b.meanDelta - a.meanDelta);
}

// ── Rigorous plateau detection ────────────────────────────────────────────────

export type PlateauStatus = 'insufficient-data' | 'active' | 'local-optimum' | 'noisy-benchmark' | 'optimizer-failure';

export interface PlateauReport {
  status: PlateauStatus;
  window: number;
  medianImprovement: number;   // median promoted delta in the window
  promotionRate: number;
  varianceShrinking: boolean;  // candidate-score variance falling across the window halves
  candidateVariance: number;
  rationale: string;
}

function median(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function variance(xs: number[]): number { if (xs.length < 2) return 0; const mu = mean(xs); return mean(xs.map((x) => (x - mu) ** 2)); }

/**
 * Distinguish local optimum vs noisy benchmark vs optimizer failure — rigorously,
 * not by intuition. Over a rolling window: near-zero median improvement AND low
 * promotion rate is a plateau; shrinking candidate variance ⇒ converged
 * (local optimum); high, non-shrinking variance ⇒ the benchmark is noisy; low
 * variance with no promotions ⇒ the optimizer stopped exploring (failure).
 */
export function detectPlateau(
  bundles: EvolveReceiptBundle[],
  opts: { window?: number; epsilon?: number; maxPromotionRate?: number } = {},
): PlateauReport {
  const window = opts.window ?? 20;
  const epsilon = opts.epsilon ?? 0.001;
  const maxPromotionRate = opts.maxPromotionRate ?? 0.1;
  const ordered = [...bundles].sort((a, b) => a.generation - b.generation);

  if (ordered.length < window) {
    return { status: 'insufficient-data', window, medianImprovement: 0, promotionRate: 0, varianceShrinking: false, candidateVariance: 0, rationale: `need ${window} generations, have ${ordered.length}` };
  }
  const recent = ordered.slice(-window);
  const promotedDeltas = recent.filter((b) => b.decisionReceipt.promoted).map((b) => b.deltas.benchmark);
  const medianImprovement = median(promotedDeltas);
  const promotionRate = promotedDeltas.length / window;
  const candScores = recent.map((b) => mean(b.holdout.map((h) => h.candidateScore)));
  const firstHalfVar = variance(candScores.slice(0, window >> 1));
  const secondHalfVar = variance(candScores.slice(window >> 1));
  const candidateVariance = variance(candScores);
  const varianceShrinking = secondHalfVar < firstHalfVar * 0.5;

  let status: PlateauStatus = 'active';
  let rationale = `median Δ ${medianImprovement.toFixed(4)} ≥ ε or promotion rate ${(promotionRate * 100).toFixed(0)}% ≥ ${(maxPromotionRate * 100).toFixed(0)}% — still improving`;
  const plateaued = medianImprovement < epsilon && promotionRate < maxPromotionRate;
  if (plateaued) {
    if (varianceShrinking) { status = 'local-optimum'; rationale = 'no gains + candidate variance shrinking → converged to a local optimum'; }
    else if (candidateVariance > epsilon) { status = 'noisy-benchmark'; rationale = 'no gains but candidates vary widely → benchmark noise is masking signal'; }
    else { status = 'optimizer-failure'; rationale = 'no gains + candidates barely vary → optimizer stopped exploring'; }
  }
  return { status, window, medianImprovement, promotionRate, varianceShrinking, candidateVariance, rationale };
}
