/**
 * Speculative branch-and-promote — parallel A/B solution exploration over
 * COW memory branches (agenticow step 4).
 *
 * Concept (from agenticow's examples/ab-branches + promotion-pipeline):
 *   Fan out N candidate approaches, each on its own Copy-On-Write branch of a
 *   shared base `.rvf` memory. Each candidate explores/writes independently
 *   against its own branch handle. Score the results, PROMOTE the winner's
 *   branch back into base, and DISCARD the losers — which for agenticow means
 *   deleting the branch files (162 bytes each), not re-copying GB of state.
 *
 *   This is the memory-state analogue of the git-worktree-per-agent pattern
 *   used for parallel code agents: cheap speculative forks, keep one, throw the
 *   rest away at near-zero cost.
 *
 * This module is intentionally COMPOSED ON TOP of the existing agenticow verbs
 * (`fork` / `promote`) and the shared `_agenticow.ts` helpers — it does not
 * reimplement COW semantics. It is generic over the candidate result type so
 * callers supply their own `fn` (what to do on each branch) and `score`
 * (how good the branch turned out).
 *
 * @module @claude-flow/cli/agenticow/speculative-exploration
 */

import { existsSync, rmSync } from 'node:fs';
import {
  loadAgenticow,
  openWithLineage,
  manifestFor,
  resolveMemoryPath,
  validateLabel,
  type AgenticowApi,
} from '../mcp-tools/agenticow-loader.js';

/** A COW memory handle (agenticow `AgenticMemory`), kept `any` to avoid a hard type dep. */
export type MemoryHandle = any;

export interface SpeculativeCandidate<TResult> {
  /** Human-readable branch label (validated: `[A-Za-z0-9_.\-:/@]`). */
  label: string;
  /**
   * The exploration to run against this candidate's isolated branch handle.
   * Receives the forked branch (read-through of base ∪ its own edits). May
   * ingest, delete, query, etc. Its return value is fed to `score`.
   */
  fn: (branch: MemoryHandle) => TResult | Promise<TResult>;
}

export interface ExploreOptions {
  /**
   * Maps a candidate label to the on-disk path for its branch `.rvf` file.
   * Loser paths are deleted after scoring.
   */
  branchPath: (label: string) => string;
  /** Persist winner-branch + save manifests. Default true. */
  persist?: boolean;
  /**
   * Tie-break: when two candidates tie on score, the earlier one (lower index)
   * wins by default (stable). Set `'last'` to prefer the later candidate.
   */
  tieBreak?: 'first' | 'last';
  /**
   * PROMOTION GATE (ADR-171). A branch is promote-INELIGIBLE unless cleared by a
   * real evaluation oracle, or by an explicitly-accepted Fable judge. When
   * provided, the top-scoring candidate is promoted ONLY if this returns
   * `{cleared:true, by:'oracle:test-exec'}` or `{cleared:true, by:'judge:fable'}`.
   * `proxy:structural` can NEVER clear a promote — score rank alone does not
   * graduate work into base. Omit for legacy score-only promotion (unverified).
   */
  clearance?: (
    winnerResult: unknown,
    label: string,
  ) => Promise<{ cleared: boolean; by: PromotionProvenance; reason?: string }>;
  /**
   * Force the clearance gate even without a `clearance` fn — a missing gate then
   * means the winner is ineligible (fail-closed). Default: gate enforced iff
   * `clearance` is supplied.
   */
  requireClearance?: boolean;
}

/** Provenance of a promotion decision (ADR-171 trust tiers). */
export type PromotionProvenance =
  | 'oracle:test-exec'   // real evaluation — clears
  | 'judge:fable'        // explicitly-accepted LLM judge — clears
  | 'proxy:structural'   // score/structural only — NEVER clears a promote
  | 'unverified';        // legacy score-only path (no gate configured)

/**
 * Causal failure receipt (ADR-171). Emitted for every discarded loser and for
 * an ineligible/failed winner — a rollback that loses *why* is half-useful.
 */
export interface SpeculativeReceipt {
  label: string;
  score: number;
  /** What the branch changed vs its lineage, when introspectable. */
  diff: { added: number[]; overridden: number[]; deleted: number[] } | null;
  /** Why this branch did not graduate. */
  outcome: 'discarded-loser' | 'winner-ineligible' | 'winner-failed';
  provenance: PromotionProvenance;
  reason?: string;
}

export interface SpeculativeBranchOutcome<TResult> {
  label: string;
  path: string;
  score: number;
  result: TResult;
  /** true for the promoted winner, false for discarded losers. */
  kept: boolean;
}

export interface SpeculativeResult<TResult> {
  /** Label of the winning (promoted) candidate. */
  winner: string;
  /** label → score for every candidate. */
  scores: Record<string, number>;
  /** Whether the winner was successfully promoted into base. */
  promoted: boolean;
  /** How the promotion decision was reached (ADR-171 provenance). */
  promotedBy: PromotionProvenance;
  /** Human-readable promotion decision, e.g. 'promoted:oracle:test-exec' or 'ineligible:proxy-cannot-clear'. */
  promotionDecision: string;
  /** agenticow promote() stats for the winner ({ ingested, deleted }). */
  promoteStats: { ingested: number; deleted: number } | null;
  /** Labels of the discarded losers whose branch files were deleted. */
  discarded: string[];
  /** Causal failure receipts for discarded losers + an ineligible winner. */
  receipts: SpeculativeReceipt[];
  /** Per-candidate detail (score, path, result, kept). */
  branches: SpeculativeBranchOutcome<TResult>[];
}

function safeDiff(branch: MemoryHandle): SpeculativeReceipt['diff'] {
  try {
    const d = branch.diff?.();
    return d ? { added: d.added ?? [], overridden: d.overridden ?? [], deleted: d.deleted ?? [] } : null;
  } catch {
    return null;
  }
}

function deleteBranchFiles(path: string): void {
  for (const p of [path, manifestFor(path)]) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort discard; a leftover 162-byte file is not fatal */
    }
  }
}

/**
 * Fork one branch per candidate off `base`, run each `fn` against its own
 * branch handle, score the results, PROMOTE the best branch back into `base`,
 * and DISCARD (delete the files of) the rest.
 *
 * The caller owns `base`: this function mutates it in-memory via `promote()`
 * but does NOT save it (only the caller knows the base file path). Persist the
 * base yourself after this resolves (e.g. `base.save(manifestFor(basePath))`).
 *
 * @param base       An opened agenticow memory handle to branch from.
 * @param candidates The A/B candidates — each `{label, fn}`.
 * @param score      Scores a candidate's result; higher wins.
 * @param opts       Branch-path mapping + persistence knobs.
 */
export async function explore<TResult>(
  base: MemoryHandle,
  candidates: SpeculativeCandidate<TResult>[],
  score: (result: TResult, label: string) => number,
  opts: ExploreOptions,
): Promise<SpeculativeResult<TResult>> {
  if (!base) throw new Error('base memory handle is required');
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('at least one candidate is required');
  }
  if (typeof score !== 'function') throw new Error('score function is required');
  if (!opts || typeof opts.branchPath !== 'function') {
    throw new Error('opts.branchPath(label) is required');
  }
  const persist = opts.persist !== false;
  const tieBreak = opts.tieBreak ?? 'first';

  // Reject duplicate labels up front — two branches to the same file would clash.
  const seen = new Set<string>();

  interface Live {
    label: string;
    path: string;
    branch: MemoryHandle;
    result: TResult;
    score: number;
  }
  const live: Live[] = [];

  // 1) Fork + explore each candidate on its own isolated branch.
  for (const c of candidates) {
    const label = validateLabel(c.label);
    if (seen.has(label)) throw new Error(`duplicate candidate label: ${label}`);
    seen.add(label);
    if (typeof c.fn !== 'function') throw new Error(`candidate ${label} is missing fn()`);

    const path = resolveMemoryPath(opts.branchPath(label));
    const branch = base.fork(label, path);
    const result = await c.fn(branch);
    const s = Number(score(result, label));
    live.push({ label, path, branch, result, score: Number.isFinite(s) ? s : -Infinity });
  }

  // 2) Pick the winner (highest score; stable tie-break).
  let winnerIdx = 0;
  for (let i = 1; i < live.length; i++) {
    const better = tieBreak === 'last'
      ? live[i].score >= live[winnerIdx].score
      : live[i].score > live[winnerIdx].score;
    if (better) winnerIdx = i;
  }

  const scores: Record<string, number> = {};
  for (const l of live) scores[l.label] = l.score;

  const winner = live[winnerIdx];
  const receipts: SpeculativeReceipt[] = [];

  // 3) PROMOTION GATE (ADR-171). The top score is a *nominee*, not a promotion.
  //    A branch graduates into base only when cleared by a real oracle or an
  //    explicitly-accepted Fable judge. proxy:structural / score-only never
  //    clears. Fail-closed: requireClearance with no gate = ineligible.
  const gate = opts.clearance;
  const enforce = opts.requireClearance ?? !!gate;
  let promoted = false;
  let promotedBy: PromotionProvenance = 'unverified';
  let promotionDecision: string;
  let promoteStats: { ingested: number; deleted: number } | null = null;

  let clearance: { cleared: boolean; by: PromotionProvenance; reason?: string };
  if (gate) {
    try {
      clearance = await gate(winner.result, winner.label);
    } catch (e) {
      clearance = { cleared: false, by: 'proxy:structural', reason: `clearance threw: ${(e as Error)?.message ?? e}` };
    }
  } else if (enforce) {
    clearance = { cleared: false, by: 'proxy:structural', reason: 'requireClearance set but no clearance gate provided' };
  } else {
    clearance = { cleared: true, by: 'unverified', reason: 'legacy score-only promotion (no gate configured)' };
  }

  // proxy:structural can NEVER clear a promote, regardless of `cleared`.
  const cleared = clearance.cleared
    && (clearance.by === 'oracle:test-exec' || clearance.by === 'judge:fable' || (!enforce && clearance.by === 'unverified'));

  if (cleared) {
    promoteStats = winner.branch.promote(base) as { ingested: number; deleted: number };
    if (persist) winner.branch.save?.(manifestFor(winner.path));
    winner.branch.close?.();
    promoted = true;
    promotedBy = clearance.by;
    promotionDecision = `promoted:${clearance.by}`;
  } else {
    // Winner is ineligible — base stays UNCHANGED. Emit a causal receipt and
    // discard the branch (it did not earn graduation).
    promotedBy = clearance.by;
    promotionDecision = `ineligible:${clearance.by === 'proxy:structural' ? 'proxy-cannot-clear' : clearance.by}`;
    receipts.push({
      label: winner.label,
      score: winner.score,
      diff: safeDiff(winner.branch),
      outcome: 'winner-ineligible',
      provenance: clearance.by,
      reason: clearance.reason ?? 'not cleared by oracle or accepted Fable judge',
    });
    winner.branch.close?.();
    deleteBranchFiles(winner.path);
  }

  // 4) Discard the losers — receipt each, close handle, delete files.
  const discarded: string[] = [];
  for (let i = 0; i < live.length; i++) {
    if (i === winnerIdx) continue;
    receipts.push({
      label: live[i].label,
      score: live[i].score,
      diff: safeDiff(live[i].branch),
      outcome: 'discarded-loser',
      provenance: 'proxy:structural',
      reason: `lower score than winner (${live[i].score} < ${winner.score})`,
    });
    live[i].branch.close?.();
    deleteBranchFiles(live[i].path);
    discarded.push(live[i].label);
  }

  const branches: SpeculativeBranchOutcome<TResult>[] = live.map((l, i) => ({
    label: l.label,
    path: l.path,
    score: l.score,
    result: l.result,
    kept: i === winnerIdx && promoted,
  }));

  return {
    winner: winner.label,
    scores,
    promoted,
    promotedBy,
    promotionDecision,
    promoteStats,
    discarded,
    receipts,
    branches,
  };
}

/**
 * Convenience wrapper that owns the whole lifecycle for a file-path base:
 * loads agenticow (returns `null` when the optional dep is absent), opens the
 * base with its lineage, runs {@link explore}, then persists the mutated base.
 *
 * Returns `null` when agenticow is not installed so callers can emit the
 * standard `{degraded:true}` contract.
 */
export async function exploreFromPath<TResult>(
  basePath: string,
  candidates: SpeculativeCandidate<TResult>[],
  score: (result: TResult, label: string) => number,
  opts: ExploreOptions & { dimension?: number; api?: AgenticowApi },
): Promise<SpeculativeResult<TResult> | null> {
  const api = opts.api ?? (await loadAgenticow());
  if (!api) return null;

  const resolvedBase = resolveMemoryPath(basePath);
  const base = await openWithLineage(api, resolvedBase, opts.dimension);
  try {
    const result = await explore(base, candidates, score, opts);
    if (opts.persist !== false) {
      base.save?.(manifestFor(resolvedBase));
    }
    return result;
  } finally {
    base.close?.();
  }
}
