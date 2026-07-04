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
  /** agenticow promote() stats for the winner ({ ingested, deleted }). */
  promoteStats: { ingested: number; deleted: number } | null;
  /** Labels of the discarded losers whose branch files were deleted. */
  discarded: string[];
  /** Per-candidate detail (score, path, result, kept). */
  branches: SpeculativeBranchOutcome<TResult>[];
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

  // 3) Promote the winner's edits back into base.
  const promoteStats = winner.branch.promote(base) as { ingested: number; deleted: number };
  if (persist) {
    winner.branch.save?.(manifestFor(winner.path));
  }
  winner.branch.close?.();

  // 4) Discard the losers — close handle, delete branch files (162 bytes each).
  const discarded: string[] = [];
  for (let i = 0; i < live.length; i++) {
    if (i === winnerIdx) continue;
    live[i].branch.close?.();
    deleteBranchFiles(live[i].path);
    discarded.push(live[i].label);
  }

  const branches: SpeculativeBranchOutcome<TResult>[] = live.map((l, i) => ({
    label: l.label,
    path: l.path,
    score: l.score,
    result: l.result,
    kept: i === winnerIdx,
  }));

  return {
    winner: winner.label,
    scores,
    promoted: true,
    promoteStats: promoteStats ?? null,
    discarded,
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
