/**
 * Router embedder (ADR-390).
 *
 * `hooks_route` compares a task with each agent pattern's keywords in a 384-d
 * vector index. Historically both sides came from a character hash
 * (`generateSimpleEmbedding`), which measures spelling, not meaning. This
 * module lets the router use the local sentence model (all-MiniLM-L6-v2, 384-d)
 * instead, with the hash as the fallback.
 *
 * Rules (ADR-390 §Decision):
 *  - The MiniLM path uses `generateLocalEmbedding` ONLY. Never the bridge-first
 *    `generateEmbedding` — that recursed without bound in #2312.
 *  - One embedder per index: if ANY text cannot be embedded by the real model
 *    (throw, backend !== 'onnx', or a non-384 vector), EVERY text in the call
 *    is embedded with the hash, and the result says so.
 *  - The default stays `hash` until ADR-391's benchmark says otherwise.
 *
 * Selection: `CLAUDE_FLOW_ROUTER_EMBEDDER=minilm|hash`. The router index is
 * process-lifetime state, so the env var is read when the index is (re)built,
 * not per CLI invocation.
 */
// memory-initializer is imported lazily (as hooks-tools does elsewhere): it is
// heavy, and the default `hash` path must not load it at all.

export type RouterEmbedderKind = 'minilm' | 'hash';

/** Default embedder. ADR-391 decides whether this flips to 'minilm'. */
export const DEFAULT_ROUTER_EMBEDDER: RouterEmbedderKind = 'hash';

/** Dimension of the router index (VectorDb + SemanticRouter are built at 384). */
export const ROUTER_EMBEDDING_DIM = 384;

export const ROUTER_EMBEDDER_ENV = 'CLAUDE_FLOW_ROUTER_EMBEDDER';

export interface RouterEmbedderSelection {
  kind: RouterEmbedderKind;
  /** Set when the requested value was invalid and the default was used. */
  reason?: string;
}

export interface RouterEmbeddingResult {
  vectors: Float32Array[];
  /** The embedder that actually produced `vectors` (after any degradation). */
  embedder: RouterEmbedderKind;
  /** Why the result is `hash` when `minilm` was requested. */
  reason?: string;
}

/**
 * Resolve which embedder the router should use.
 * Precedence: explicit override > CLAUDE_FLOW_ROUTER_EMBEDDER > DEFAULT_ROUTER_EMBEDDER.
 */
export function resolveRouterEmbedder(
  override?: RouterEmbedderKind,
  env: NodeJS.ProcessEnv = process.env,
): RouterEmbedderSelection {
  if (override) return { kind: override };
  // Env-only by design (registered in scripts/audit-env-var-precedence.mjs):
  // the router index is process-lifetime MCP state, not owned by one CLI call.
  const raw = env.CLAUDE_FLOW_ROUTER_EMBEDDER?.trim().toLowerCase();
  if (!raw) return { kind: DEFAULT_ROUTER_EMBEDDER };
  if (raw === 'minilm' || raw === 'hash') return { kind: raw };
  return {
    kind: DEFAULT_ROUTER_EMBEDDER,
    reason: `${ROUTER_EMBEDDER_ENV}=${JSON.stringify(raw)} is not 'minilm' or 'hash'; using '${DEFAULT_ROUTER_EMBEDDER}'`,
  };
}

/**
 * Deterministic character-hash embedding (the router's historical embedder).
 * Moved verbatim from hooks-tools.ts; do not change the math — existing routes
 * and thresholds were calibrated against it.
 */
export function generateSimpleEmbedding(text: string, dimension: number = ROUTER_EMBEDDING_DIM): Float32Array {
  const embedding = new Float32Array(dimension);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words = normalized.split(/\s+/).filter(w => w.length > 0);

  for (let i = 0; i < dimension; i++) {
    let value = 0;
    // Word-level features
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      for (let c = 0; c < word.length; c++) {
        const charCode = word.charCodeAt(c);
        value += Math.sin((charCode * (i + 1) + w * 17 + c * 23) * 0.0137);
      }
    }
    // Character-level features
    for (let c = 0; c < text.length; c++) {
      value += Math.cos((text.charCodeAt(c) * (i + 1) + c * 7) * 0.0073);
    }
    embedding[i] = value / Math.max(1, text.length);
  }

  return l2Normalize(embedding);
}

function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// Per-(embedder, text) memo. Keyword vectors don't change when the pattern set
// changes, so this survives router rebuilds (e.g. after saveRoutingOutcomes).
const MINILM_CACHE = new Map<string, Float32Array>();
const MINILM_CACHE_MAX = 2048;

async function embedOneMiniLM(text: string): Promise<Float32Array> {
  const cached = MINILM_CACHE.get(text);
  if (cached) return cached;
  const { generateLocalEmbedding } = await import('../memory/memory-initializer.js');
  const out = await generateLocalEmbedding(text);
  if (out.backend !== 'onnx') {
    throw new RouterEmbedderDegraded(`local embedder backend is '${out.backend}' (model '${out.model}'), not onnx`);
  }
  if (!out.embedding || out.embedding.length !== ROUTER_EMBEDDING_DIM) {
    throw new RouterEmbedderDegraded(
      `local embedder returned ${out.embedding?.length ?? 0}-d vectors; router index is ${ROUTER_EMBEDDING_DIM}-d`,
    );
  }
  const vec = l2Normalize(Float32Array.from(out.embedding));
  if (MINILM_CACHE.size >= MINILM_CACHE_MAX) {
    const oldest = MINILM_CACHE.keys().next().value;
    if (oldest !== undefined) MINILM_CACHE.delete(oldest);
  }
  MINILM_CACHE.set(text, vec);
  return vec;
}

class RouterEmbedderDegraded extends Error {}

/**
 * Embed texts for the router. All vectors in one result come from ONE embedder.
 * `hash` never touches the model (no load cost for default users).
 */
export async function embedForRouter(
  texts: readonly string[],
  kind: RouterEmbedderKind = resolveRouterEmbedder().kind,
): Promise<RouterEmbeddingResult> {
  if (kind === 'hash') {
    return { vectors: texts.map(t => generateSimpleEmbedding(t)), embedder: 'hash' };
  }
  try {
    const vectors: Float32Array[] = [];
    for (const t of texts) vectors.push(await embedOneMiniLM(t));
    return { vectors, embedder: 'minilm' };
  } catch (err) {
    const why = err instanceof RouterEmbedderDegraded
      ? err.message
      : `local embedder threw: ${err instanceof Error ? err.message : String(err)}`;
    return {
      vectors: texts.map(t => generateSimpleEmbedding(t)),
      embedder: 'hash',
      reason: `minilm unavailable (${why}); using hash for patterns and query`,
    };
  }
}

/** Test hook: clear the MiniLM vector memo. */
export function clearRouterEmbedderCache(): void {
  MINILM_CACHE.clear();
}
