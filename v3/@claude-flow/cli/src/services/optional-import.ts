/**
 * Safe loader for optional dependencies that pull in native addons.
 *
 * Why this exists: on Node 20, when an ESM graph statically imports a
 * CommonJS package that throws while loading (for example `sharp` whose
 * binary was never built, or `onnxruntime-node` loaded a second time in a
 * worker thread: "Module did not self-register"), the `import()` promise
 * rejects as expected AND the loader reports the same error a second time as
 * an unhandled rejection. A `.catch()` on the import cannot intercept that
 * second report, and under Node's default `--unhandled-rejections=throw` it
 * terminates the process. Node 22 does not do this.
 *
 * `agentic-flow` and `agentic-flow/reasoningbank` statically import
 * `@xenova/transformers`, which statically imports `sharp` and
 * `onnxruntime-node`, so a plain `import('agentic-flow/reasoningbank')
 * .catch(() => null)` crashes the CLI on Node 20 whenever either native
 * module cannot load. The workspace deliberately skips building sharp
 * (`pnpm.neverBuiltDependencies`), so this is the normal case, not an edge.
 *
 * The fix is to load the native modules through `require` first: a CommonJS
 * load failure is an ordinary synchronous throw that we can catch. If any of
 * them cannot load, the ESM import would have failed anyway, so we return
 * `null` without attempting it. If they load, the import proceeds and reuses
 * the already-cached CommonJS modules.
 *
 * The same applies to imports we do not make ourselves: AgentDB's
 * EmbeddingService does its own caught `import('@xenova/transformers')`, and
 * on Node 20 that still crashes the process. `esmLoaderDoubleReportsCjsErrors`
 * lets callers skip such a path only where the loader behaves this way.
 *
 * @module optional-import
 */

import { createRequire } from 'node:module';

export interface NativeProbe {
  /**
   * Packages to resolve, in order, starting from the target module, to reach
   * the package that actually depends on the native modules. If any link in
   * this chain cannot be resolved the probe is skipped and the import decides.
   */
  via?: string[];
  /** Native packages that must load (via `require`) for the import to work. */
  natives: string[];
}

/** Probes for the optional dependencies the CLI is known to import. */
export const TRANSFORMERS_NATIVE_PROBE: NativeProbe = {
  via: ['@xenova/transformers'],
  natives: ['sharp', 'onnxruntime-node'],
};

export const ONNX_NATIVE_PROBE: NativeProbe = {
  natives: ['onnxruntime-node'],
};

/** `@claude-flow/memory` -> AgentDB -> transformers.js (AgentDB.initialize). */
export const AGENTDB_TRANSFORMERS_NATIVE_PROBE: NativeProbe = {
  via: ['agentdb', '@xenova/transformers'],
  natives: ['sharp', 'onnxruntime-node'],
};

/**
 * True on Node versions whose ESM loader reports a CommonJS load failure a
 * second time as an unhandled rejection. Observed on Node 20.20.2; not
 * reproduced on Node 22.23.3. Node 21 is treated as affected (unverified).
 */
export function esmLoaderDoubleReportsCjsErrors(
  nodeVersion: string = process.versions.node,
): boolean {
  const major = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major < 22;
}

const localRequire = createRequire(import.meta.url);

/**
 * Returns false only when a native module that the target statically depends
 * on is known to fail to load. Returns true when everything loads or when the
 * dependency chain cannot be resolved (so the import itself decides).
 */
export function nativeDepsLoadable(specifier: string, probe: NativeProbe): boolean {
  let base: string;
  try {
    base = localRequire.resolve(specifier);
    for (const pkg of probe.via ?? []) {
      base = createRequire(base).resolve(pkg);
    }
  } catch {
    // Target or an intermediate package is not resolvable from here; nothing
    // to probe. The import will report a plain module-not-found.
    return true;
  }

  const requireFromBase = createRequire(base);
  for (const native of probe.natives) {
    let resolved: string;
    try {
      resolved = requireFromBase.resolve(native);
    } catch {
      // Not installed where the target would look for it. Whether that matters
      // is the import's call (a missing static dependency is an ordinary
      // resolution error, not the double-reported load failure).
      continue;
    }
    try {
      requireFromBase(resolved);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Import an optional module, returning `null` when it is not installed, fails
 * to load, or (with a probe) when one of its native dependencies cannot load.
 */
export async function importOptional<T = unknown>(
  specifier: string,
  probe?: NativeProbe,
): Promise<T | null> {
  if (probe && !nativeDepsLoadable(specifier, probe)) {
    return null;
  }
  try {
    return (await import(specifier)) as T;
  } catch {
    return null;
  }
}
