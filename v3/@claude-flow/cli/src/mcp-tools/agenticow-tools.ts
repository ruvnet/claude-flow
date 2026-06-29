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
    description:
      'COW-fork a base memory. Branches are ~162 bytes regardless of base size. ' +
      'Use for per-Darwin-iteration, per-user, or per-session memory personalization ' +
      'without copying the parent file.',
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
    description:
      'Freeze a restore point on a memory file. Subsequent edits can be rolled back to this checkpoint. ' +
      'Use before an experimental Darwin tick or speculative agent edit.',
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
    description:
      'Discard edits made since the most recent checkpoint on a memory file. ' +
      'Use when a Darwin tick / agent experiment regressed and you want to revert ' +
      'memory state without re-running everything.',
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
    description:
      'Merge a branch\'s edits into a base memory file. After promote the branch ' +
      'edits become part of the base lineage. Used for federation merges and ' +
      'when a successful per-user branch should graduate to shared memory.',
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
