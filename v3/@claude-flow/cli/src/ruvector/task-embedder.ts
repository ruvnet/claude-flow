/**
 * task-embedder.ts — Shared lazy task embedder + LRU cache (ADR-149 iter 9).
 *
 * The cost-optimal neural router (ADR-149) fires only when `route(task, embedding)`
 * is called with a real embedding. Two call sites in the dispatcher chain need
 * embeddings: `agent-tools.ts` (initial routing) and `agent-execute-core.ts`
 * (the fallback chain on 429/5xx). Before this module they each loaded their
 * own @xenova/transformers MiniLM pipeline and recomputed embeddings on every
 * call — including for repeated prompts.
 *
 * This module:
 *   1. Loads the pipeline once per process (`loadTaskEmbedder`).
 *   2. Caches embeddings per task text via an LRU of configurable size
 *      (default 500 entries ≈ 1.5 MB at 384-dim).
 *   3. Hashes by FNV-1a-32 + length to keep the key compact and collision-safe
 *      for typical prompt sizes.
 *   4. Returns `undefined` on any failure so callers gracefully fall back to
 *      the heuristic+bandit path.
 *
 * @module task-embedder
 */

// ============================================================================
// FNV-1a-32 hash (matches scripts/gen-seed-corpus.mjs + router-trajectory.ts)
// ============================================================================

function fnv1a32(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Compact cache key — hash + length so distinct prompts of similar shape collide rarely. */
function cacheKey(task: string): string {
  return `${fnv1a32(task)}:${task.length}`;
}

// ============================================================================
// Lazy pipeline load (shared across all callers in the process)
// ============================================================================

type EmbedFn = (text: string) => Promise<number[]>;
type EmbedBatchFn = (texts: string[]) => Promise<number[][]>;
type ExtractorFn = (input: string | string[], opts: { pooling: 'mean'; normalize: boolean }) =>
  Promise<{ data: Float32Array; dims?: number[] }>;

// Single shared extractor. Both single-text and array-input modes call this
// same function (xenova's pipeline returns a callable that accepts either),
// so we don't pay the ONNX model-load cost twice.
let _extractorPromise: Promise<ExtractorFn | null> | null = null;

function loadExtractor(): Promise<ExtractorFn | null> {
  if (_extractorPromise !== null) return _extractorPromise;
  _extractorPromise = (async () => {
    try {
      const specifier = '@xenova/transformers';
      const mod = await import(/* @vite-ignore */ specifier).catch(() => null);
      if (!mod || typeof mod.pipeline !== 'function') return null;
      return await mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    } catch {
      return null;
    }
  })();
  return _extractorPromise;
}

async function loadEmbedder(): Promise<EmbedFn | null> {
  const ex = await loadExtractor();
  if (!ex) return null;
  return async (text: string): Promise<number[]> => {
    const out = await ex(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data as Float32Array);
  };
}

/**
 * Array-input batch embedder — xenova's pipeline accepts `string[]` and
 * returns a stacked tensor of shape `[N, dim]`. Shares the same loaded
 * pipeline with `loadEmbedder` so cold-load cost is paid once across
 * single + batch usage. Measured speedup: ~1.83× on 30-task batches
 * against the same-pipeline single-call loop.
 */
async function loadEmbedderBatch(): Promise<EmbedBatchFn | null> {
  const ex = await loadExtractor();
  if (!ex) return null;
  return async (texts: string[]): Promise<number[][]> => {
    const out = await ex(texts, { pooling: 'mean', normalize: true });
    const dims = out.dims ?? [texts.length, 384];
    const N = dims[0] ?? texts.length;
    const dim = dims[1] ?? Math.floor(out.data.length / N);
    const data = out.data;
    const result: number[][] = new Array(N);
    for (let i = 0; i < N; i++) {
      result[i] = Array.from(data.subarray(i * dim, (i + 1) * dim));
    }
    return result;
  };
}

// ============================================================================
// LRU cache — Map preserves insertion order, so delete+set on hit = O(1) LRU
// ============================================================================

const MAX_SIZE = (() => {
  const v = parseInt(process.env.CLAUDE_FLOW_ROUTER_EMBED_CACHE_SIZE ?? '500', 10);
  return Number.isFinite(v) && v >= 0 ? v : 500;
})();

const _cache: Map<string, number[]> = new Map();
let _hits = 0;
let _misses = 0;

function lruGet(key: string): number[] | undefined {
  const hit = _cache.get(key);
  if (hit === undefined) return undefined;
  // Refresh recency: re-insert at the end.
  _cache.delete(key);
  _cache.set(key, hit);
  return hit;
}

function lruSet(key: string, value: number[]): void {
  if (MAX_SIZE === 0) return;
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > MAX_SIZE) {
    const oldest = _cache.keys().next().value;
    if (oldest === undefined) break;
    _cache.delete(oldest);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute (or fetch from cache) the 384-dim MiniLM embedding for `task`.
 * Returns `undefined` on any failure (missing @xenova/transformers, ONNX
 * runtime error, etc.) so callers can gracefully fall back to the
 * heuristic+bandit path. Best-effort and never throws.
 *
 * Cache hit-rate accumulates across the process lifetime and is observable
 * via `embedderStats()` for diagnostics.
 */
export async function embedTaskWithCache(task: string): Promise<number[] | undefined> {
  if (typeof task !== 'string' || task.length === 0) return undefined;
  const key = cacheKey(task);
  const cached = lruGet(key);
  if (cached !== undefined) {
    _hits++;
    return cached;
  }
  try {
    const embed = await loadEmbedder();
    if (!embed) return undefined;
    const v = await embed(task);
    lruSet(key, v);
    _misses++;
    return v;
  } catch {
    return undefined;
  }
}

/**
 * Batch counterpart to `embedTaskWithCache`. For each task, returns the
 * cached embedding when present, else schedules a fresh inference. The
 * fresh-inference set is computed in a SINGLE ONNX pass via
 * @xenova/transformers' array-input mode, amortizing tensor setup +
 * model-load overhead across the batch. Order of the output array
 * matches the input order.
 *
 * Returns `undefined` for any task that failed to embed (missing dep,
 * runtime error). Cache state updates as if each task had been called
 * separately through embedTaskWithCache (hits/misses counters update
 * accordingly).
 */
export async function embedTaskWithCacheBatch(tasks: string[]): Promise<Array<number[] | undefined>> {
  const out: Array<number[] | undefined> = new Array(tasks.length).fill(undefined);
  // Validate + split into (cached-hits) and (missing-needs-inference).
  const missingIdx: number[] = [];
  const missingTasks: string[] = [];
  const missingKeys: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (typeof t !== 'string' || t.length === 0) continue;
    const key = cacheKey(t);
    const hit = lruGet(key);
    if (hit !== undefined) {
      _hits++;
      out[i] = hit;
    } else {
      missingIdx.push(i);
      missingTasks.push(t);
      missingKeys.push(key);
    }
  }
  if (missingTasks.length === 0) return out;
  try {
    const embedBatch = await loadEmbedderBatch();
    if (!embedBatch) {
      for (let j = 0; j < missingIdx.length; j++) _misses++;
      return out;
    }
    // Real array-input batch: xenova returns one stacked tensor we slice
    // back into N embeddings. Amortizes tensor setup + ONNX overhead
    // across the batch (measured 1.83× speedup at N=30).
    const fresh = await embedBatch(missingTasks);
    for (let j = 0; j < missingIdx.length; j++) {
      const v = fresh[j];
      if (v) {
        lruSet(missingKeys[j], v);
        out[missingIdx[j]] = v;
      }
      _misses++;
    }
  } catch {
    // best-effort — leave undefined entries as is
  }
  return out;
}

/** Diagnostic surface — hit/miss counters + cache state. */
export function embedderStats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: number } {
  const total = _hits + _misses;
  return {
    size: _cache.size,
    maxSize: MAX_SIZE,
    hits: _hits,
    misses: _misses,
    hitRate: total > 0 ? _hits / total : 0,
  };
}

/** Test seam — clear LRU + counters so tests get a fresh baseline. */
export function __resetTaskEmbedderForTests(): void {
  _cache.clear();
  _hits = 0;
  _misses = 0;
  _extractorPromise = null;
}
