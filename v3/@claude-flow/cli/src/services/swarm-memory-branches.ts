/**
 * SwarmMemoryBranches — per-agent Copy-On-Write memory branching for swarms.
 *
 * ## Why this exists
 *
 * The v3.14.4 release uncovered a tarball-bloat regression: the Darwin
 * git-worktree-per-agent pattern accumulated 3.3 GB of disk because each
 * agent got a *full copy* of shared state. `agenticow` (a sibling RVF-based
 * COW vector store by the same author) forks a branch in a measured **162
 * bytes** regardless of base size — read-through semantics (parent ∪ edits,
 * child wins) instead of a linear-growth snapshot.
 *
 * This service is the swarm-facing consumer of that primitive. The pattern
 * mirrors `agenticow`'s own `examples/parallel-agents`:
 *
 *   shared base .rvf
 *     → each agent forks a 162-byte COW branch (nativeAnn:true) at spawn
 *     → the agent reads/writes its branch in isolation
 *     → on success: promote branch → base (merge its edits back)
 *     → on failure: discard the branch file (throw the edits away)
 *
 * ## Honest scope (the seam)
 *
 * The current `agent_spawn` MCP path (src/mcp-tools/agent-tools.ts) stores an
 * agent as pure JSON metadata — it does **not** create, copy, or hold any
 * per-agent `.rvf` workspace today. So there is no full-copy for a COW branch
 * to "replace" inline. This service therefore wires in as an **opt-in**: a
 * swarm/agent that actually wants an isolated memory workspace passes a base
 * memory path, and only then does a branch get forked. Default behavior is
 * unchanged.
 *
 * ## Non-fatal + kill-switch (ADR-150)
 *
 *   - `agenticow` is an optional dependency — every method degrades to
 *     `{ degraded: true }` when it is absent (never throws MODULE_NOT_FOUND).
 *   - The `CLAUDE_FLOW_NO_COW_MEMORY=1` env var hard-disables branching so an
 *     operator can kill the feature without a redeploy.
 *   - agenticow is loaded lazily (dynamic import inside `loadAgenticow`), so
 *     importing this module does NOT pull agenticow onto the CLI startup path.
 *
 * @module @claude-flow/cli/services/swarm-memory-branches
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { getProjectCwd } from '../mcp-tools/types.js';
import {
  loadAgenticow,
  resolveMemoryPath,
  manifestFor,
  validateLabel,
  openWithLineage,
} from '../mcp-tools/agenticow-loader.js';

/** Env var that hard-disables per-agent COW branching (operator kill switch). */
export const COW_KILL_SWITCH_ENV = 'CLAUDE_FLOW_NO_COW_MEMORY';

/** True unless the operator set the kill switch. */
export function cowMemoryEnabled(): boolean {
  const v = process.env[COW_KILL_SWITCH_ENV];
  return !(v === '1' || v === 'true' || v === 'yes');
}

/** Persisted mapping so promote/discard (a later, separate call) can find the branch. */
export interface BranchRecord {
  agentId: string;
  basePath: string;
  branchPath: string;
  label: string;
  createdAt: string;
}

interface BranchRegistry {
  version: string;
  branches: Record<string, BranchRecord>;
}

export interface BranchResult {
  success: boolean;
  agentId: string;
  basePath?: string;
  branchPath?: string;
  label?: string;
  /** Set when the operation was a no-op because COW is unavailable/disabled. */
  degraded?: true;
  reason?: string;
}

export interface PromoteResult {
  success: boolean;
  agentId: string;
  promoted: boolean;
  branchPath?: string;
  basePath?: string;
  degraded?: true;
  reason?: string;
}

export interface DiscardResult {
  success: boolean;
  agentId: string;
  discarded: boolean;
  branchPath?: string;
  reason?: string;
}

const REGISTRY_REL = join('.claude-flow', 'swarm', 'cow-branches.json');

/**
 * Manages the branch→base COW lifecycle for a swarm's agents. One instance per
 * project cwd; state is persisted to `.claude-flow/swarm/cow-branches.json` so
 * a branch forked in `branchForAgent` survives to a later `promoteAgent` /
 * `discardAgent` call in a different process.
 */
export class SwarmMemoryBranches {
  private readonly registryPath: string;

  /**
   * @param registryPath Override the registry location (tests point this at a
   *   temp dir). Defaults to `<cwd>/.claude-flow/swarm/cow-branches.json`.
   */
  constructor(registryPath?: string) {
    this.registryPath = registryPath ?? join(getProjectCwd(), REGISTRY_REL);
  }

  // ---- registry persistence -------------------------------------------------

  private loadRegistry(): BranchRegistry {
    try {
      if (existsSync(this.registryPath)) {
        const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && parsed.branches) return parsed as BranchRegistry;
      }
    } catch { /* fall through to empty */ }
    return { version: '1.0.0', branches: {} };
  }

  private saveRegistry(reg: BranchRegistry): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(reg, null, 2), 'utf-8');
  }

  /** Look up the branch record for an agent, if one was forked. */
  getBranch(agentId: string): BranchRecord | undefined {
    return this.loadRegistry().branches[agentId];
  }

  /**
   * Deterministic per-agent branch path: `<baseDir>/.swarm-cow/<base>.<agentId>.rvf`.
   * Keeps branch files namespaced next to their base so cleanup is obvious.
   */
  private branchPathFor(basePath: string, agentId: string): string {
    const safeAgent = agentId.replace(/[^A-Za-z0-9_.\-]/g, '_');
    const baseName = basename(basePath).replace(/\.rvf$/i, '');
    return join(dirname(basePath), '.swarm-cow', `${baseName}.${safeAgent}.rvf`);
  }

  // ---- lifecycle ------------------------------------------------------------

  /**
   * Fork a 162-byte COW branch off `base` for `agentId`. The agent then owns
   * an isolated read/write view (parent ∪ its own edits). Idempotent: a second
   * call for the same agent returns the existing branch record.
   *
   * @param base      Path to the shared base `.rvf` (absolute or cwd-relative).
   * @param agentId   Agent that owns the branch (used as the COW label).
   * @param opts.dimension  Required only when `base` does not yet exist.
   * @param opts.nativeAnn  Fork with the native Rust ANN path (default true —
   *   agent branches are meant to be queried).
   */
  async branchForAgent(
    base: string,
    agentId: string,
    opts: { dimension?: number; nativeAnn?: boolean } = {},
  ): Promise<BranchResult> {
    if (!cowMemoryEnabled()) {
      return { success: true, agentId, degraded: true, reason: 'cow-memory-disabled' };
    }
    const api = await loadAgenticow();
    if (!api) return { success: true, agentId, degraded: true, reason: 'agenticow-not-found' };

    const label = validateLabel(agentId);
    const basePath = resolveMemoryPath(base);

    // Idempotent — a retried spawn must not double-fork.
    const existing = this.getBranch(agentId);
    if (existing && existsSync(existing.branchPath)) {
      return {
        success: true, agentId,
        basePath: existing.basePath, branchPath: existing.branchPath, label: existing.label,
      };
    }

    const branchPath = this.branchPathFor(basePath, agentId);
    mkdirSync(dirname(branchPath), { recursive: true });
    const nativeAnn = opts.nativeAnn !== false;

    const baseMem = await openWithLineage(api, basePath, opts.dimension);
    try {
      const branch = await baseMem.fork(label, branchPath, { nativeAnn });
      // Persist lineage manifests so the branch + base reopen with the COW
      // chain intact — without this, the fork is in-memory only.
      await branch.save?.(manifestFor(branchPath));
      await baseMem.save?.(manifestFor(basePath));
      await branch.close?.();
    } finally {
      await baseMem.close?.();
    }

    const reg = this.loadRegistry();
    reg.branches[agentId] = {
      agentId, basePath, branchPath, label, createdAt: new Date().toISOString(),
    };
    this.saveRegistry(reg);

    return { success: true, agentId, basePath, branchPath, label };
  }

  /**
   * Promote an agent's branch back into its base (merge its edits + tombstones
   * atomically), then delete the branch file and drop it from the registry.
   * Call on agent success. No-op (`promoted:false`) when the agent has no
   * branch.
   */
  async promoteAgent(agentId: string): Promise<PromoteResult> {
    const rec = this.getBranch(agentId);
    if (!rec) return { success: true, agentId, promoted: false, reason: 'no-branch' };

    const api = await loadAgenticow();
    if (!api) return { success: true, agentId, promoted: false, degraded: true, reason: 'agenticow-not-found' };

    if (existsSync(manifestFor(rec.branchPath)) || existsSync(rec.branchPath)) {
      const branch = await openWithLineage(api, rec.branchPath);
      const baseMem = await openWithLineage(api, rec.basePath);
      try {
        await branch.promote(baseMem);
        await branch.save?.(manifestFor(rec.branchPath));
        await baseMem.save?.(manifestFor(rec.basePath));
      } finally {
        await branch.close?.();
        await baseMem.close?.();
      }
    }

    this.removeBranchFiles(rec.branchPath);
    this.forgetBranch(agentId);
    return { success: true, agentId, promoted: true, branchPath: rec.branchPath, basePath: rec.basePath };
  }

  /**
   * Discard an agent's branch — delete the branch file + lineage manifest and
   * drop the registry entry, WITHOUT merging anything into base. Call on agent
   * failure. No-op (`discarded:false`) when the agent has no branch. Never
   * touches agenticow (pure filesystem), so it works even in the degraded path.
   */
  async discardAgent(agentId: string): Promise<DiscardResult> {
    const rec = this.getBranch(agentId);
    if (!rec) return { success: true, agentId, discarded: false, reason: 'no-branch' };
    this.removeBranchFiles(rec.branchPath);
    this.forgetBranch(agentId);
    return { success: true, agentId, discarded: true, branchPath: rec.branchPath };
  }

  // ---- helpers --------------------------------------------------------------

  private removeBranchFiles(branchPath: string): void {
    try { rmSync(branchPath, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { rmSync(manifestFor(branchPath), { force: true }); } catch { /* best-effort */ }
  }

  private forgetBranch(agentId: string): void {
    const reg = this.loadRegistry();
    if (reg.branches[agentId]) {
      delete reg.branches[agentId];
      this.saveRegistry(reg);
    }
  }
}
