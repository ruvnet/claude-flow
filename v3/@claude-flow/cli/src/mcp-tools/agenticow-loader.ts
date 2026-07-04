/**
 * Agenticow shared loader + helpers.
 *
 * Extracted from `agenticow-tools.ts` so both the MCP tool surface AND the
 * `SwarmMemoryBranches` service (src/services/swarm-memory-branches.ts) share
 * one loader, one degradation contract, and one set of path/lineage helpers —
 * rather than duplicating the optional-dep dance in two places.
 *
 * Architectural constraint (ADR-150, mirrors metaharness-tools.ts):
 *   - `agenticow` lives in `optionalDependencies` — never a hard runtime dep.
 *   - When the package is missing, callers get `null` from `loadAgenticow()`
 *     (or a `{degraded:true}` result via `degradedResult`) and MUST fall back
 *     gracefully — never throw a MODULE_NOT_FOUND.
 *
 * @module @claude-flow/cli/mcp-tools/agenticow-loader
 */

import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { getProjectCwd } from './types.js';

export const PACKAGE_NAME = 'agenticow';

export interface AgenticowApi {
  open: (file: string, opts?: { dimension?: number; metric?: string }) => Promise<any>;
  openBase?: (file: string, opts?: any) => Promise<any>;
  AgenticMemory: any;
}

// Cache: module load is expensive enough to amortize across handler calls.
// null = not yet attempted; false = attempted and unavailable; module = loaded.
let _agenticowMod: any = null;
let _loadAttempted = false;

/**
 * Lazily import `agenticow`. Returns the module on success, or `null` when the
 * package is not installed (the optional-dep degraded path). Any OTHER load
 * error (e.g. a corrupt install) is re-thrown so it is not silently masked.
 */
export async function loadAgenticow(): Promise<AgenticowApi | null> {
  if (_loadAttempted) return _agenticowMod || null;
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

/** Reset the module-level load cache. Test-only seam. */
export function __resetAgenticowCache(): void {
  _agenticowMod = null;
  _loadAttempted = false;
}

export function degradedResult(reason: string): { success: true; degraded: true; reason: string } {
  return { success: true, degraded: true, reason };
}

/**
 * Resolve a user-supplied memory path against the project cwd, rejecting path
 * traversal and NUL bytes (D-2 style hardening — same rule the MCP verbs use).
 */
export function resolveMemoryPath(path: string): string {
  if (!path || typeof path !== 'string') throw new Error('memory path is required');
  if (/\.\.[\\/]|\0/.test(path)) throw new Error('memory path contains disallowed characters');
  return isAbsolute(path) ? path : resolve(getProjectCwd(), path);
}

/**
 * Lineage manifest companion path. agenticow persists the COW chain
 * (working → checkpoints → base) into `<file>.agenticow.json` next to the
 * `.rvf` data file. Without it, forks/checkpoints are in-memory only and
 * disappear when the AgenticMemory handle closes.
 */
export function manifestFor(file: string): string {
  return `${file}.agenticow.json`;
}

/** Validate a COW branch/checkpoint label (alnum + a small safe symbol set). */
export function validateLabel(label: string): string {
  if (!label || typeof label !== 'string') throw new Error('label is required');
  if (label.length > 256) throw new Error('label exceeds 256 chars');
  if (!/^[A-Za-z0-9_.\-:/@]+$/.test(label)) {
    throw new Error('label may only contain [A-Za-z0-9_.\\-:/@]');
  }
  return label;
}

/**
 * Open (or create) a memory file, restoring its COW chain from the lineage
 * manifest when one exists. When neither the `.rvf` nor the manifest exists,
 * `dimension` is required to create a fresh base.
 */
export async function openWithLineage(api: AgenticowApi, file: string, dimension?: number) {
  const manifest = manifestFor(file);
  if (existsSync(manifest)) {
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
