/**
 * CheckpointGate — agenticow-backed checkpoint/rollback gate for autopilot
 * loops and long-horizon workflows (agenticow integration, step 3).
 *
 * ── The pattern ───────────────────────────────────────────────────────────
 * Before a risky loop tick that mutates `.rvf` memory, take an O(1) agenticow
 * checkpoint (162 bytes, fixed cost — see mcp-tools/agenticow-tools.ts). Run
 * the tick. If it regresses — throws, or the caller's verdict says the outcome
 * got worse (verifier fail / error / worse metric) — roll the memory back to
 * the checkpoint. Rollback is O(edits-since-checkpoint), NOT an O(N) rebuild,
 * and the earlier history stays intact via the `.agenticow.json` lineage
 * manifest. On success the checkpoint is simply kept as the new good baseline.
 *
 * The three lifecycle verbs (checkpoint / rollback / promote) already exist in
 * the `agenticow` package and are surfaced as MCP tools in
 * `mcp-tools/agenticow-tools.ts`. This module is the *orchestration hook* that
 * calls them from inside a loop — the MCP surface is for agents, this is for
 * the in-process loop.
 *
 * ── Architectural constraint (ADR-150) ────────────────────────────────────
 * `agenticow` lives in `optionalDependencies` and must NEVER be a hard runtime
 * dependency. This gate degrades gracefully in three ways, each of which runs
 * the tick UNGUARDED rather than failing:
 *   1. package missing            → { degraded: true, reason: 'agenticow-not-found' }
 *   2. kill-switch env set         → { degraded: true, reason: 'kill-switch' }
 *   3. no memory path configured   → { degraded: true, reason: 'no-memory-path' }
 * The package is lazy-loaded on the first guard() call, so importing this
 * module has zero startup cost.
 *
 * The optional-dep loader + path/label/lineage helpers are the canonical ones
 * from `mcp-tools/agenticow-loader.ts` — one implementation shared across every
 * agenticow consumer (verbs, swarm branches, speculative, oracle, this gate).
 *
 * @module @claude-flow/cli/services/checkpoint-gate
 */

import {
  type AgenticowApi,
  loadAgenticow,
  __resetAgenticowCache,
  resolveMemoryPath,
  manifestFor,
  validateLabel,
  openWithLineage,
} from '../mcp-tools/agenticow-loader.js';

/**
 * Env var pointing at the `.rvf` memory file that a long-horizon loop mutates.
 * When set, the autopilot loop opts in to checkpoint/rollback around each tick.
 * When unset, the gate is a transparent pass-through.
 */
export const CHECKPOINT_MEM_ENV = 'CLAUDE_FLOW_AUTOPILOT_CHECKPOINT_MEM';

/**
 * Kill switch. When truthy (`1`/`true`/`yes`), the gate never touches agenticow
 * and every guard() runs the tick unguarded. Lets an operator disable the
 * feature without changing config or code.
 */
export const KILL_SWITCH_ENV = 'CLAUDE_FLOW_AGENTICOW_DISABLE';

/** Outcome of a guarded tick. `result` is undefined only when the tick threw
 *  AND `rethrow` was disabled. */
export interface CheckpointGuardResult<T> {
  /** The value fn() returned (undefined if it threw with rethrow:false). */
  result: T | undefined;
  /** True when a checkpoint was actually taken before running fn. */
  checkpointed: boolean;
  /** True when memory was rolled back to the checkpoint (throw or regression). */
  rolledBack: boolean;
  /** True when the gate could not engage agenticow and ran fn unguarded. */
  degraded: boolean;
  /** Machine-readable reason for degraded / rollback. */
  reason?: string;
  /** The checkpoint label, when one was taken. */
  checkpointLabel?: string;
  /** The error fn() threw, when rethrow was disabled. */
  error?: unknown;
}

export interface GuardOptions<T> {
  /**
   * Verdict function: return true when `result` represents a regression that
   * should trigger a rollback. Defaults to treating `{success:false}` /
   * `{ok:false}` / `{regressed:true}` as regressions.
   */
  isRegression?: (result: T) => boolean;
  /**
   * When the tick throws: roll back, then re-throw the original error
   * (default true). Set false to swallow the error and return it on the
   * result object instead — useful when the loop must never crash.
   */
  rethrow?: boolean;
  /** Optional checkpoint id to roll back to (defaults to most recent). */
  checkpointId?: string;
}

function defaultIsRegression(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return r.success === false || r.ok === false || r.regressed === true;
}

// ── The gate ────────────────────────────────────────────────────────────────

export class CheckpointGate {
  /** True when the kill-switch env is set to a truthy value. */
  static isKillSwitchSet(): boolean {
    const v = (process.env[KILL_SWITCH_ENV] || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  /** The configured loop memory path, or undefined when the feature is off. */
  static configuredMemPath(): string | undefined {
    const p = (process.env[CHECKPOINT_MEM_ENV] || '').trim();
    return p || undefined;
  }

  /**
   * Lazy-load agenticow. Returns null when the package is absent (optional dep)
   * or the kill switch is set. Any *other* import error is re-thrown — a broken
   * install should be loud, a missing optional dep should be silent.
   */
  private async load(): Promise<AgenticowApi | null> {
    if (CheckpointGate.isKillSwitchSet()) return null;
    // Delegates to the canonical loader (#22) — one cache, one degradation
    // policy shared across every agenticow consumer.
    return loadAgenticow();
  }

  /** True when agenticow can be engaged (present + not killed). */
  async available(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  /**
   * Take a checkpoint on the given `.rvf` memory file. Non-throwing except for
   * validation errors (path traversal, bad label) — those are surfaced so a
   * misconfiguration is caught early.
   */
  async checkpoint(
    memPath: string,
    label: string,
  ): Promise<{ ok: boolean; degraded: boolean; reason?: string; checkpoint?: unknown }> {
    const api = await this.load();
    if (!api) return { ok: false, degraded: true, reason: CheckpointGate.isKillSwitchSet() ? 'kill-switch' : 'agenticow-not-found' };

    const path = resolveMemoryPath(String(memPath));
    const lbl = validateLabel(String(label));
    const mem = await openWithLineage(api, path);
    try {
      const cp = await mem.checkpoint(lbl);
      await mem.save?.(manifestFor(path));
      return { ok: true, degraded: false, checkpoint: cp };
    } finally {
      await mem.close?.();
    }
  }

  /**
   * Roll the given `.rvf` memory file back to a checkpoint. Discards edits made
   * since (O(edits-since-checkpoint)). Omit `checkpointId` to target the most
   * recent checkpoint.
   */
  async rollback(
    memPath: string,
    checkpointId?: string,
  ): Promise<{ ok: boolean; degraded: boolean; reason?: string; result?: unknown }> {
    const api = await this.load();
    if (!api) return { ok: false, degraded: true, reason: CheckpointGate.isKillSwitchSet() ? 'kill-switch' : 'agenticow-not-found' };

    const path = resolveMemoryPath(String(memPath));
    const mem = await openWithLineage(api, path);
    try {
      const r = checkpointId ? await mem.rollback(checkpointId) : await mem.rollback();
      await mem.save?.(manifestFor(path));
      return { ok: true, degraded: false, result: r };
    } finally {
      await mem.close?.();
    }
  }

  /**
   * Guard a risky loop tick with a checkpoint/rollback bracket.
   *
   *   const outcome = await gate.guard(memPath, 'iter-7', async () => runTick());
   *
   * Behaviour:
   *   - No memPath / kill-switch / agenticow-absent → run fn unguarded, degraded:true.
   *   - Checkpoint fails to engage (degraded) → run fn unguarded, degraded:true.
   *   - fn throws → roll back to checkpoint, then re-throw (unless rethrow:false).
   *   - fn returns a regression verdict → roll back, return result with rolledBack:true.
   *   - fn succeeds → keep the checkpoint, return result with rolledBack:false.
   *
   * The gate is non-fatal: an internal agenticow failure never masks fn()'s own
   * result — if checkpointing throws, fn still runs unguarded.
   */
  async guard<T>(
    memPath: string | undefined,
    label: string,
    fn: () => Promise<T>,
    opts: GuardOptions<T> = {},
  ): Promise<CheckpointGuardResult<T>> {
    const rethrow = opts.rethrow !== false;
    const isRegression = opts.isRegression ?? (defaultIsRegression as (r: T) => boolean);

    // Fast paths: feature off → transparent pass-through.
    if (!memPath) {
      const result = await fn();
      return { result, checkpointed: false, rolledBack: false, degraded: true, reason: 'no-memory-path' };
    }
    if (CheckpointGate.isKillSwitchSet()) {
      const result = await fn();
      return { result, checkpointed: false, rolledBack: false, degraded: true, reason: 'kill-switch' };
    }

    // Try to checkpoint. Any failure here degrades to unguarded — the loop must
    // never break because memory branching is unavailable.
    let checkpointed = false;
    try {
      const cp = await this.checkpoint(memPath, label);
      if (!cp.ok) {
        const result = await fn();
        return { result, checkpointed: false, rolledBack: false, degraded: true, reason: cp.reason };
      }
      checkpointed = true;
    } catch (err) {
      const result = await fn();
      return {
        result,
        checkpointed: false,
        rolledBack: false,
        degraded: true,
        reason: `checkpoint-error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Run the tick under the checkpoint.
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      const rb = await this.safeRollback(memPath, opts.checkpointId);
      if (rethrow) throw err;
      return {
        result: undefined,
        checkpointed,
        rolledBack: rb,
        degraded: false,
        reason: 'tick-threw',
        checkpointLabel: label,
        error: err,
      };
    }

    // Verdict: regression → roll back, keep the returned result for the caller.
    if (isRegression(result)) {
      const rb = await this.safeRollback(memPath, opts.checkpointId);
      return { result, checkpointed, rolledBack: rb, degraded: false, reason: 'regression-verdict', checkpointLabel: label };
    }

    // Success → keep the checkpoint as the new baseline.
    return { result, checkpointed, rolledBack: false, degraded: false, checkpointLabel: label };
  }

  /** Roll back without throwing — used on the failure path so a rollback error
   *  never masks the original tick failure. */
  private async safeRollback(memPath: string, checkpointId?: string): Promise<boolean> {
    try {
      const r = await this.rollback(memPath, checkpointId);
      return r.ok;
    } catch {
      return false;
    }
  }
}

/** Shared process-wide gate instance. */
let _shared: CheckpointGate | null = null;
export function getCheckpointGate(): CheckpointGate {
  if (!_shared) _shared = new CheckpointGate();
  return _shared;
}

/** Reset the lazy-load cache — test-only. */
export function __resetCheckpointGateForTests(): void {
  __resetAgenticowCache();
  _shared = null;
}
