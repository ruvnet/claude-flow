/**
 * Provider-agnostic transformers loader.
 *
 * ADR-094: prefer the maintained `@huggingface/transformers` (which
 * pulls in `protobufjs >=7.5.5` and clears the critical RCE CVE
 * chain), fall back to the legacy `@xenova/transformers` for
 * backwards compatibility with consumers who haven't installed the
 * new package yet.
 *
 * Both packages export the same `pipeline()` function with compatible
 * signatures for our usage (`pipeline('feature-extraction', modelId)`),
 * so callers can use the returned function transparently. The `source`
 * field is reported through `embeddings_status.ruvectorStatus` so
 * users can see which package satisfied the runtime.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type PipelineFn = (
  task: string,
  model?: string,
  options?: Record<string, unknown>,
) => Promise<unknown>;

export interface TransformersHandle {
  pipeline: PipelineFn;
  source: '@huggingface/transformers' | '@xenova/transformers';
  version?: string;
}

let cached: TransformersHandle | null = null;
let cacheChecked = false;

/**
 * Resolve a writable cache directory for ONNX model downloads.
 *
 * ADR-454: a system-prefix global install's package directory is
 * root-owned, so defaulting the loader's cache into
 * `node_modules/@huggingface/transformers/.cache` fails with EACCES
 * for the runtime user. Honor an explicit env override first, then
 * fall back to the repo's existing `~/.cache/ruflo/<subpath>`
 * convention (see `gaia-loader.ts`, `gaia-judge.ts`).
 */
export function resolveModelCacheDir(): string {
  return (
    process.env.TRANSFORMERS_CACHE ||
    process.env.HF_HOME ||
    path.join(os.homedir(), '.cache', 'ruflo', 'models')
  );
}

/**
 * Load a working transformers pipeline. Returns null if neither
 * package is installed. Caches the first successful resolution so
 * subsequent calls don't re-import.
 */
export async function loadTransformersPipeline(): Promise<TransformersHandle | null> {
  if (cacheChecked) return cached;
  cacheChecked = true;

  // Use indirect import paths through string variables so TypeScript
  // doesn't try to resolve module types at compile time. Both packages
  // are runtime-optional; types aren't needed for the typed PipelineFn
  // signature we expose.
  const tryLoad = async (specifier: string): Promise<Record<string, unknown> | null> => {
    try {
      // Webpack/tsc can't statically resolve the specifier when it's a
      // variable, which is intentional here — we want runtime resolution
      // that gracefully fails if the package isn't installed.
      const mod = await import(/* @vite-ignore */ specifier);
      return mod as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // Prefer the maintained successor.
  const hf = await tryLoad('@huggingface/transformers');
  if (hf && typeof hf.pipeline === 'function') {
    const cacheDir = resolveModelCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    if (hf.env) (hf.env as { cacheDir: string }).cacheDir = cacheDir;
    cached = {
      pipeline: hf.pipeline as PipelineFn,
      source: '@huggingface/transformers',
      version: typeof hf.version === 'string' ? hf.version : undefined,
    };
    return cached;
  }

  // Fall back to the legacy package so existing installs keep working.
  const xen = await tryLoad('@xenova/transformers');
  if (xen && typeof xen.pipeline === 'function') {
    const cacheDir = resolveModelCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    if (xen.env) (xen.env as { cacheDir: string }).cacheDir = cacheDir;
    cached = {
      pipeline: xen.pipeline as PipelineFn,
      source: '@xenova/transformers',
      version: typeof xen.version === 'string' ? xen.version : undefined,
    };
    return cached;
  }

  return null;
}

/**
 * Synchronous probe — returns whether either package was loaded
 * during a previous call to `loadTransformersPipeline()`. For status
 * tools that don't want to trigger a fresh import.
 */
export function getCachedTransformersSource(): TransformersHandle | null {
  return cached;
}
