/**
 * Shared agenticow COW-memory helpers.
 *
 * These helpers were first written as private functions inside
 * `agenticow-tools.ts`. Step 4 (speculative branch-and-promote) needs the exact
 * same loader / path-resolution / lineage semantics, so they are lifted here as
 * a shared module that both `agenticow-tools.ts` and
 * `agenticow-speculate-tools.ts` / the `SpeculativeExploration` module can import.
 *
 * Architectural constraint (mirrors agenticow-tools.ts):
 *   - `agenticow` lives in `optionalDependencies` — never a hard runtime dep.
 *   - When the package is missing, `loadAgenticow()` returns `null` so callers
 *     can return `{success:true, degraded:true, reason:'agenticow-not-found'}`.
 *
 * NOTE: to keep merge conflicts with a sibling branch minimal, this module is
 * ADDED alongside `agenticow-tools.ts` rather than refactoring that file to
 * import from here — its existing `agenticowTools` export stays byte-identical.
 *
 * @module @claude-flow/cli/mcp-tools/_agenticow
 */

import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { getProjectCwd } from './types.js';

export const PACKAGE_NAME = 'agenticow';

export interface AgenticowApi {
  open: (file: string, opts?: { dimension?: number; metric?: string }) => Promise<any>;
  openBase: (file: string, opts?: any) => Promise<any>;
  AgenticMemory: any;
}

// Cache: module load is expensive enough to amortize across handler calls.
// null = not yet attempted; false = attempted and unavailable; module = loaded.
let _agenticowMod: any = null;
let _loadAttempted = false;

/**
 * Dynamic-import agenticow. Returns the module namespace when installed, or
 * `null` when the package is absent (MODULE_NOT_FOUND). Any other error is
 * rethrown so genuine breakage is not masked as "not installed".
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

export function degradedResult(reason: string): { success: true; degraded: true; reason: string } {
  return { success: true, degraded: true, reason };
}

export function resolveMemoryPath(path: string): string {
  if (!path || typeof path !== 'string') throw new Error('memory path is required');
  // D-2 style: reject path traversal in user-supplied paths
  if (/\.\.[\\/]|\0/.test(path)) throw new Error('memory path contains disallowed characters');
  return isAbsolute(path) ? path : resolve(getProjectCwd(), path);
}

/**
 * Lineage manifest companion path. agenticow persists the COW chain
 * (working → checkpoints → base) into `<file>.agenticow.json` next to the
 * `.rvf` data file. Without this, checkpoints and forks are in-memory only.
 */
export function manifestFor(file: string): string {
  return `${file}.agenticow.json`;
}

export function validateLabel(label: string): string {
  if (!label || typeof label !== 'string') throw new Error('label is required');
  if (label.length > 256) throw new Error('label exceeds 256 chars');
  if (!/^[A-Za-z0-9_.\-:/@]+$/.test(label)) {
    throw new Error('label may only contain [A-Za-z0-9_.\\-:/@]');
  }
  return label;
}

/**
 * Open (or create) a base memory file. When a lineage manifest exists at
 * `<file>.agenticow.json`, we load that to restore the COW chain. When only the
 * `.rvf` exists, fresh-open it. When neither exists, dimension is required.
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
