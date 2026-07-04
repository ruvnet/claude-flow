/**
 * Benchmark corpus + held-out scoring + the accept() promotion gate
 * (ADR-176 phase 2 + the multi-term promotion rule).
 *
 * Proof #1 (measured, held-out): a candidate is scored against a VERSIONED,
 * content-hashed corpus on a held-out split — the "prove-before-ship" pattern
 * distill-tuning.ts established (train/held-out disjoint by index; held-out
 * scored once). Fitness is a composite, not a single gameable number.
 *
 * Promotion is a CONJUNCTION of externally-measurable predicates (ADR-176) —
 * never a scalar. accept() takes the independently-measured verdicts (held-out
 * delta, redblue, drift, deterministic replay, receipt coverage, canary
 * rollback) and admits only when EVERY term holds. Multi-dimensional +
 * Goodhart-resistant. Zero deps, $0.
 */
import { createHash } from 'crypto';

export interface BenchTask {
  id: string;
  input: unknown;
  expected: unknown;
  weight?: number; // default 1
}

export interface HarnessBenchmarkCorpus {
  version: string;
  corpusHash: string; // sha256 over canonical tasks — pins the held-out set
  tasks: BenchTask[];
}

/** Run a candidate policy on a task's input, producing an output. */
export type EvalFn<C> = (input: unknown, candidate: C) => unknown;
/** Grade an output against expected → [0,1]. */
export type GradeFn = (output: unknown, expected: unknown) => number;

function stable(v: unknown): string {
  const c = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(c);
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = c((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(c(v));
}

/** Content hash of a corpus's tasks — the tamper-evident pin for the held-out set. */
export function hashCorpus(tasks: BenchTask[]): string {
  const canon = tasks.map(t => ({ id: t.id, input: t.input, expected: t.expected, weight: t.weight ?? 1 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return 'sha256:' + createHash('sha256').update(stable(canon)).digest('hex');
}

/** Verify a corpus's declared hash matches its tasks (integrity of the benchmark). */
export function verifyCorpus(corpus: HarnessBenchmarkCorpus): boolean {
  return hashCorpus(corpus.tasks) === corpus.corpusHash;
}

export interface ScoreResult {
  fitness: number;   // weighted mean grade over tasks, [0,1]
  passRate: number;  // fraction graded >= 0.999
  n: number;
}

/** Score a candidate over a task set, on isolated tasks (no shared state). */
export function scoreOnTasks<C>(tasks: BenchTask[], candidate: C, evalFn: EvalFn<C>, gradeFn: GradeFn): ScoreResult {
  if (tasks.length === 0) return { fitness: 0, passRate: 0, n: 0 };
  let weighted = 0, totalW = 0, passes = 0;
  for (const t of tasks) {
    const w = t.weight ?? 1;
    let g = 0;
    try { g = Math.max(0, Math.min(1, gradeFn(evalFn(t.input, candidate), t.expected))); } catch { g = 0; }
    weighted += g * w; totalW += w;
    if (g >= 0.999) passes++;
  }
  return { fitness: totalW > 0 ? weighted / totalW : 0, passRate: passes / tasks.length, n: tasks.length };
}

export interface HeldOutSplit { train: BenchTask[]; heldOut: BenchTask[] }

/**
 * Deterministic held-out split. Tasks are stably ordered by id, and the last
 * `holdoutFrac` become the held-out set — disjoint from train, reproducible
 * (so two runs converge, per the ADR-176 acceptance test).
 */
export function computeHeldOutSplit(tasks: BenchTask[], holdoutFrac = 0.2): HeldOutSplit {
  const ordered = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const cut = Math.max(0, ordered.length - Math.max(1, Math.round(ordered.length * holdoutFrac)));
  return { train: ordered.slice(0, cut), heldOut: ordered.slice(cut) };
}

// ── The accept() conjunction (ADR-176 promotion rule) ───────────────────────

/** Independently-measured verdicts fed to accept(). Each comes from a different mechanism. */
export interface PromotionVerdict {
  heldOutScore: number;       // candidate held-out fitness
  baselineHeldOutScore: number;
  redblue: 'PASS' | 'FAIL' | 'SKIPPED';
  drift: number;              // 0 = identical to champion
  driftThreshold: number;     // default 0.05
  replayDeterministic: boolean;
  receiptCoverage: number;    // 0..1
  canaryRollbackRate: number;
  baselineRollbackRate: number;
}

export interface AcceptResult {
  accept: boolean;
  terms: Record<string, { value: unknown; pass: boolean }>;
  failed: string[];
}

/**
 * accept(candidate) ⟺
 *   held_out_score  >  baseline
 *   AND redblue     == PASS
 *   AND drift       <= threshold
 *   AND replay      == deterministic
 *   AND receipt_cov == 100%
 *   AND canary.rollback_rate <= baseline
 * Every term is externally measurable; ANY failure → reject.
 */
export function accept(v: PromotionVerdict): AcceptResult {
  const terms: AcceptResult['terms'] = {
    held_out_improves: { value: `${v.heldOutScore.toFixed(4)} > ${v.baselineHeldOutScore.toFixed(4)}`, pass: v.heldOutScore > v.baselineHeldOutScore },
    redblue_pass: { value: v.redblue, pass: v.redblue === 'PASS' },
    drift_within: { value: `${v.drift} <= ${v.driftThreshold}`, pass: v.drift <= v.driftThreshold },
    replay_deterministic: { value: v.replayDeterministic, pass: v.replayDeterministic === true },
    receipt_coverage_full: { value: v.receiptCoverage, pass: v.receiptCoverage >= 1 },
    canary_no_worse: { value: `${v.canaryRollbackRate} <= ${v.baselineRollbackRate}`, pass: v.canaryRollbackRate <= v.baselineRollbackRate },
  };
  const failed = Object.entries(terms).filter(([, t]) => !t.pass).map(([k]) => k);
  return { accept: failed.length === 0, terms, failed };
}
