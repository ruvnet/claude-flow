/**
 * Agenticow MCP Tools — Copy-On-Write memory branching surface.
 *
 * Exposes `agenticow@~0.2.3` (a sibling RVF-based COW vector store by the same
 * author as ruflo) as MCP tools so agents can branch, checkpoint, rollback,
 * and promote memory state without copying GB-scale `.rvf` files.
 *
 * Motivation:
 *   The v3.14.4 release uncovered a tarball-bloat regression where Darwin
 *   loops' git-worktree-per-agent pattern accumulated 3.3 GB of disk. The
 *   structural cause was full-copy snapshot semantics. Measured agenticow
 *   branches are exactly 162 bytes regardless of base size (see
 *   `docs/agenticow/findings.md` for the bench data).
 *
 * Architectural constraint (mirrors metaharness-tools.ts / testgen-tools.ts):
 *   - `agenticow` lives in `optionalDependencies` — must NOT be a hard runtime dep
 *   - When the package is missing, every tool returns
 *     `{success: true, degraded: true, reason: 'agenticow-not-found'}`
 *     so callers see one contract regardless of install state
 *
 * Measured performance vs published claims (agenticow@0.2.3):
 *   ✅ 162-byte branches — confirmed exact
 *   ✅ 3,000×–180,000× smaller than full-copy at N=1k–50k
 *   ❌ 0.5 ms branch — measured ~10ms (fixed cost, not size-proportional)
 *   ❌ 83× faster — only beats full-copy past N ≈ 30k crossover
 *
 * Use cases (per ADR / findings doc):
 *   - Per-Darwin-iteration memory branching (eliminates worktree bloat)
 *   - Per-user / per-session personalization (cheap fork, no full copy)
 *   - Federation: branch → promote back as merge semantics
 *
 * @module @claude-flow/cli/mcp-tools/agenticow
 */

import { existsSync } from 'node:fs';
import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';
import { resolve, isAbsolute } from 'node:path';

const PACKAGE_NAME = 'agenticow';

// Cache: module load is expensive enough to amortize across handler calls.
// null = not yet attempted; false = attempted and unavailable; module = loaded.
let _agenticowMod: any = null;
let _loadAttempted = false;

interface AgenticowApi {
  open: (file: string, opts?: { dimension?: number; metric?: string }) => Promise<any>;
  openBase: (file: string, opts?: any) => Promise<any>;
  AgenticMemory: any;
}

async function loadAgenticow(): Promise<AgenticowApi | null> {
  if (_loadAttempted) return _agenticowMod;
  _loadAttempted = true;
  try {
    _agenticowMod = await import(PACKAGE_NAME);
    return _agenticowMod;
  } catch (err: any) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND' ||
                /Cannot find (module|package)/i.test(String(err.message)))) {
      _agenticowMod = false;
      return null;
    }
    throw err;
  }
}

function degradedResult(reason: string): { success: true; degraded: true; reason: string } {
  return { success: true, degraded: true, reason };
}

function resolveMemoryPath(path: string): string {
  if (!path || typeof path !== 'string') throw new Error('memory path is required');
  // D-2 style: reject path traversal in user-supplied paths
  if (/\.\.[\\/]|\0/.test(path)) throw new Error('memory path contains disallowed characters');
  return isAbsolute(path) ? path : resolve(getProjectCwd(), path);
}

/**
 * Lineage manifest companion path. agenticow persists the COW chain
 * (working → checkpoints → base) into `<file>.agenticow.json` next to the
 * `.rvf` data file. Without this, checkpoints and forks are in-memory only
 * and disappear when the AgenticMemory handle closes. Mirrors the bin
 * CLI's `manifestFor(file)` helper.
 */
function manifestFor(file: string): string {
  return `${file}.agenticow.json`;
}

function validateLabel(label: string): string {
  if (!label || typeof label !== 'string') throw new Error('label is required');
  if (label.length > 256) throw new Error('label exceeds 256 chars');
  if (!/^[A-Za-z0-9_.\-:/@]+$/.test(label)) {
    throw new Error('label may only contain [A-Za-z0-9_.\\-:/@]');
  }
  return label;
}

/**
 * Open (or create) a base memory file. When a lineage manifest exists at
 * `<file>.agenticow.json`, we load that to restore the COW chain (checkpoints,
 * ancestors). When only the `.rvf` exists, fresh-open it. When neither exists,
 * dimension is required to create. Mirrors the bin CLI's `loadMem()` helper.
 */
async function openWithLineage(api: AgenticowApi, file: string, dimension?: number) {
  const manifest = manifestFor(file);
  if (existsSync(manifest)) {
    // The class-level static method `load` reconstructs the full chain.
    return (api.AgenticMemory as any).load(manifest);
  }
  const opts: any = {};
  if (typeof dimension === 'number' && Number.isInteger(dimension) && dimension > 0) {
    opts.dimension = dimension;
  } else if (!existsSync(file)) {
    throw new Error('dimension is required when creating a new memory file');
  }
  return api.open(file, opts);
}

export const agenticowTools: MCPTool[] = [
  {
    name: 'agenticow_branch',
    description: 'agenticow@~0.2.3 — COW-fork a base .rvf memory file. Measured 162-byte branches regardless of base size (verified at N=1k/10k/50k). Use when you need per-Darwin-iteration / per-user / per-session memory personalization. Copying the parent .rvf file is wrong because full-copy snapshots grow linearly (the 3.3 GB Darwin-worktree bloat fixed in v3.14.4); agenticow gives read-through semantics (parent ∪ edits, child wins) at constant 162 B. Optional dep — degrades to {degraded:true} when missing.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'branch'],
    inputSchema: {
      type: 'object',
      properties: {
        basePath: { type: 'string', description: 'Path to base .rvf memory file (absolute or relative to cwd)' },
        branchPath: { type: 'string', description: 'Path to write the branch file' },
        label: { type: 'string', description: 'Human-readable label for the branch (alnum + _.-:/@ only)' },
        dimension: { type: 'integer', description: 'Vector dimension (required only when basePath does not exist yet)' },
      },
      required: ['basePath', 'branchPath', 'label'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const label = validateLabel(String(input.label));
      const basePath = resolveMemoryPath(String(input.basePath));
      const branchPath = resolveMemoryPath(String(input.branchPath));
      const dim = input.dimension as number | undefined;

      const base = await openWithLineage(api, basePath, dim);
      try {
        const branch = await base.fork(label, branchPath);
        // Persist lineage manifests so the branch (and base) reopen with
        // their COW chain intact. Without this, fork is in-memory only.
        await branch.save?.(manifestFor(branchPath));
        await base.save?.(manifestFor(basePath));
        await branch.close?.();
        return {
          success: true,
          basePath,
          branchPath,
          label,
        };
      } finally {
        await base.close?.();
      }
    },
  },
  {
    name: 'agenticow_checkpoint',
    description: 'agenticow — freeze a labelled restore point on an .rvf memory file. Subsequent edits stay in a fresh COW child; rollback returns here. Use when you are about to run an experimental Darwin tick or speculative agent edit that may need to be discarded. Relying on the working node alone is wrong because there is no "undo last N writes" semantics — without a checkpoint, a bad ingest contaminates the base. Persists via .agenticow.json lineage manifest so it survives close+reopen.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'checkpoint'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .rvf memory file' },
        label: { type: 'string', description: 'Checkpoint label (alnum + _.-:/@ only)' },
      },
      required: ['path', 'label'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const label = validateLabel(String(input.label));
      const path = resolveMemoryPath(String(input.path));
      const mem = await openWithLineage(api, path);
      try {
        const cp = await mem.checkpoint(label);
        await mem.save?.(manifestFor(path));
        return { success: true, path, label, checkpoint: cp };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_rollback',
    description: 'agenticow — discard all edits since the most recent checkpoint on an .rvf memory file. Reuses a fresh COW child derived from the checkpoint. Use when a Darwin tick or agent experiment regressed and you want to revert memory state without re-running. Deleting+rebuilding the .rvf is wrong because rebuild cost is O(N) and the data after the bad point is lost; rollback is O(edits-since-checkpoint) and the earlier history stays intact via the lineage manifest.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'rollback'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .rvf memory file' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const path = resolveMemoryPath(String(input.path));
      const mem = await openWithLineage(api, path);
      try {
        const r = await mem.rollback();
        await mem.save?.(manifestFor(path));
        return { success: true, path, rolledBack: true, result: r };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_promote',
    description: 'agenticow — merge a branch\'s edits back into its base (or an explicit target) memory file. After promote, branch edits become part of base lineage. Use when a per-user / per-Darwin-iteration branch has been validated and should graduate to shared memory (federation merge, A/B winner). Manually re-ingesting edits into the base is wrong because the edit set is opaque to the caller and tombstones (deletions) are easily missed; promote applies the full edit + tombstone set atomically.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'promote', 'merge'],
    inputSchema: {
      type: 'object',
      properties: {
        branchPath: { type: 'string', description: 'Path to branch .rvf file' },
        basePath: {
          type: 'string',
          description: 'Path to base .rvf file. When omitted, promote merges into the ' +
            'recorded fork parent (most common case).',
        },
      },
      required: ['branchPath'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const branchPath = resolveMemoryPath(String(input.branchPath));
      const basePath = input.basePath ? resolveMemoryPath(String(input.basePath)) : undefined;
      const branch = await openWithLineage(api, branchPath);
      const base = basePath ? await openWithLineage(api, basePath) : undefined;
      try {
        const result = base ? await branch.promote(base) : await branch.promote();
        // Persist mutated lineage so promote survives close+reopen
        await branch.save?.(manifestFor(branchPath));
        if (base && basePath) await base.save?.(manifestFor(basePath));
        return { success: true, branchPath, basePath: basePath ?? null, promoted: result ?? true };
      } finally {
        await branch.close?.();
        await base?.close?.();
      }
    },
  },
];
