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

import type { MCPTool } from './types.js';
// Loader + path/lineage helpers are shared with the SwarmMemoryBranches
// service (src/services/swarm-memory-branches.ts) via one module so the
// optional-dep dance and the COW open/fork semantics live in exactly one place.
import {
  loadAgenticow,
  degradedResult,
  resolveMemoryPath,
  manifestFor,
  validateLabel,
  openWithLineage,
} from './agenticow-loader.js';

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
        nativeAnn: { type: 'boolean', description: 'Use the native Rust COW dual-graph ANN path (recall@10=1.0, query spans the COW boundary in one Rust call). Default false (exact JS chain-walk). Set true when the branch will be queried.', default: false },
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
      const nativeAnn = input.nativeAnn === true;

      const base = await openWithLineage(api, basePath, dim);
      try {
        const branch = await base.fork(label, branchPath, { nativeAnn });
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
          nativeAnn,
        };
      } finally {
        await base.close?.();
      }
    },
  },
  {
    name: 'agenticow_ingest',
    description: 'agenticow — write vectors (with optional text payloads) into an .rvf memory branch or base. Records: [{id?, vector, text?}] — id auto-assigns when omitted. This is the write half that makes a branch usable: agenticow_branch creates an empty COW child, but without ingest it has nothing to read back. Use when you have branched and must populate the branch (agenticow_branch alone leaves it empty). Editing the base directly is wrong when the writes are speculative — ingest into a branch, then promote only if validated. Persists via .agenticow.json lineage manifest.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'ingest', 'write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .rvf memory file (branch or base)' },
        records: {
          type: 'array',
          description: 'Vectors to ingest: [{id?: number, vector: number[], text?: string}]',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: 'Explicit id (auto-assigned when omitted)' },
              vector: { type: 'array', items: { type: 'number' }, description: 'Embedding vector (length must equal the memory dimension)' },
              text: { type: 'string', description: 'Optional payload surfaced on query hits' },
            },
            required: ['vector'],
          },
        },
        dimension: { type: 'integer', description: 'Vector dimension (required only when path does not exist yet)' },
      },
      required: ['path', 'records'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const path = resolveMemoryPath(String(input.path));
      const records = input.records as Array<{ id?: number; vector: number[]; text?: string }>;
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('records must be a non-empty array of {id?, vector, text?}');
      }
      for (const r of records) {
        if (!Array.isArray(r.vector) || r.vector.length === 0) {
          throw new Error('each record requires a non-empty numeric vector');
        }
      }
      const dim = (input.dimension as number | undefined) ?? records[0].vector.length;
      const mem = await openWithLineage(api, path, dim);
      try {
        const result = await mem.ingest(records.map((r) => ({
          ...(typeof r.id === 'number' ? { id: r.id } : {}),
          vector: r.vector,
          ...(r.text !== undefined ? { text: r.text } : {}),
        })));
        await mem.save?.(manifestFor(path));
        return { success: true, path, ingested: result };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_query',
    description: 'agenticow — k-NN read across an .rvf memory branch\'s full COW lineage (parent ∪ edits, child wins), returning {id, distance, branch, text}. Read-only (no manifest write). The `branch` field on each hit tells you which lineage node the result came from — the read-through semantics that make branching useful. Use when you need to read from an agent/session branch without materializing a full copy. Re-opening the base and manually merging edits is wrong: query already spans the chain (and uses the single-call Rust path when the branch was forked with nativeAnn).',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'query', 'read', 'search'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .rvf memory file' },
        vector: { type: 'array', items: { type: 'number' }, description: 'Query embedding vector' },
        k: { type: 'integer', description: 'Number of nearest neighbors to return', default: 10 },
        efSearch: { type: 'integer', description: 'HNSW efSearch per lineage store (higher = better recall, slower)' },
      },
      required: ['path', 'vector'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const path = resolveMemoryPath(String(input.path));
      const vector = input.vector as number[];
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('vector must be a non-empty numeric array');
      }
      const k = typeof input.k === 'number' ? input.k : 10;
      const opts: Record<string, unknown> = {};
      if (typeof input.efSearch === 'number') opts.efSearch = input.efSearch;
      const mem = await openWithLineage(api, path);
      try {
        const hits = await mem.query(vector, k, opts);
        return { success: true, path, k, hits };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_diff',
    description: 'agenticow — show what a branch changed relative to its lineage: {added, overridden, deleted} vector-id lists. Use when you are about to promote and want to preview the exact merge, or when auditing what a branch actually wrote. Diffing by re-querying is wrong because deletions (tombstones) are invisible to a read — diff() surfaces them explicitly. Requires the branch was opened with edit tracking (default on).',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'diff'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to branch .rvf file' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const path = resolveMemoryPath(String(input.path));
      const mem = await openWithLineage(api, path);
      try {
        const diff = await mem.diff();
        return { success: true, path, diff };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_lineage',
    description: 'agenticow — walk the COW chain of an .rvf memory file: an ordered list of nodes (role working|checkpoint|base, id, label, parent, createdAt, mutations, tombstones). Use when you need branch history — to find checkpoint ids for a targeted rollback, or to debug a promote. Guessing the chain from filenames is wrong — lineage is the authoritative structure the store maintains.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'lineage', 'history'],
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
        const lineage = await mem.lineage();
        return { success: true, path, lineage };
      } finally {
        await mem.close?.();
      }
    },
  },
  {
    name: 'agenticow_status',
    description: 'agenticow — health/geometry of an .rvf memory file: {totalVectors, totalSegments, fileSize, currentEpoch, deadSpaceRatio, readOnly, chainDepth, dimension, metric}. Use when you need to check vector count before/after ingest, spot compaction pressure (deadSpaceRatio), or confirm the dimension before ingesting into a shared base. Pure read.',
    category: 'memory',
    tags: ['agenticow', 'memory', 'cow', 'status'],
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
        const status = await mem.status();
        return { success: true, path, status };
      } finally {
        await mem.close?.();
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
        checkpointId: { type: 'string', description: 'Target checkpoint id from agenticow_lineage (omit to roll back to the most recent checkpoint)' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const api = await loadAgenticow();
      if (!api) return degradedResult('agenticow-not-found');

      const path = resolveMemoryPath(String(input.path));
      const checkpointId = input.checkpointId ? String(input.checkpointId) : undefined;
      const mem = await openWithLineage(api, path);
      try {
        const r = checkpointId ? await mem.rollback(checkpointId) : await mem.rollback();
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
