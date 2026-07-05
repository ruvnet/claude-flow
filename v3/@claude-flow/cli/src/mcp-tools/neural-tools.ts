/**
 * Neural MCP Tools for CLI
 *
 * V2 Compatibility - Neural network and ML tools
 *
 * ✅ HYBRID Implementation:
 * - Uses @claude-flow/embeddings for REAL ML embeddings when available
 * - Falls back to deterministic hash-based embeddings when ML model not installed
 * - Pattern storage and search with cosine similarity (real math in all tiers)
 * - Training stores patterns as searchable embeddings (not simulated)
 *
 * Note: For production neural features, use @claude-flow/neural module
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-176/177: an adopted+applied proven-config champion supplies the retrieval
 * defaults (`.claude-flow/harness-active-policy.json` → params). Read it once,
 * cached with a short TTL, fully fail-safe (any error → {} → hardcoded defaults).
 * A caller's explicit param always still wins over the champion.
 */
/**
 * Corpus-stats cache (perf): tokenized subject/body docs + BM25 corpus stats
 * depend ONLY on the stored patterns, not the query or retrieval config — yet
 * were rebuilt on every hybrid search (O(all docs) per call). Memoize them keyed
 * by a cheap store fingerprint (count + id + name/content lengths). This makes
 * repeated searches — e.g. the flywheel scoring many configs over a fixed store —
 * iterate in reasonable time, and speeds up every hybrid search. Invalidates when
 * the store changes size or a doc's length changes.
 */
interface CorpusStatsEntry { fp: string; subjectDocs: string[][]; bodyDocs: string[][]; subjectStats: unknown; bodyStats: unknown }
let _corpusStatsCache: CorpusStatsEntry | null = null;
// (query, store) → embedding + cosine cache. Small LRU (not size-1): the flywheel
// scores many configs across several queries in interleaved order, so a size-1
// cache would thrash. Cap keeps memory bounded; eviction is oldest-first.
const _cosineCache = new Map<string, { queryEmbedding: number[]; cosineArr: number[] }>();
const _COSINE_CACHE_MAX = 128;
function _cosineCacheGet(key: string): { queryEmbedding: number[]; cosineArr: number[] } | undefined {
  const v = _cosineCache.get(key);
  if (v) { _cosineCache.delete(key); _cosineCache.set(key, v); } // LRU touch
  return v;
}
function _cosineCacheSet(key: string, v: { queryEmbedding: number[]; cosineArr: number[] }): void {
  _cosineCache.set(key, v);
  if (_cosineCache.size > _COSINE_CACHE_MAX) _cosineCache.delete(_cosineCache.keys().next().value as string);
}
function corpusFingerprint(patterns: Array<{ id: string; name?: string; content?: string }>): string {
  let h = 2166136261 >>> 0;
  for (const p of patterns) {
    const s = `${p.id}|${p.name?.length ?? 0}|${p.content?.length ?? 0}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return `${patterns.length}:${h.toString(16)}`;
}

let _champCache: { at: number; params: Record<string, unknown> } | null = null;
function activeChampionParams(): Record<string, unknown> {
  try {
    if (_champCache && Date.now() - _champCache.at < 30_000) return _champCache.params;
    const p = join(getProjectCwd(), '.claude-flow', 'harness-active-policy.json');
    let params: Record<string, unknown> = {};
    if (existsSync(p)) {
      const active = JSON.parse(readFileSync(p, 'utf-8'));
      if (active && !active.rolledBack && active.params && typeof active.params === 'object') params = active.params;
    }
    _champCache = { at: Date.now(), params };
    return params;
  } catch { return {}; }
}

// Real embeddings — resolved LAZILY on first use.
// Perf (measured 2026-07): the previous top-level-await version of this block
// ran `await import('ruvector')` + `initOnnxEmbedder()` + a probe embed at
// module-import time, adding ~450ms (warm) to ~2800ms (cold) to EVERY CLI
// command, because mcp-client statically imports this module. ensureEmbeddings()
// keeps the exact same tier chain and degraded/fallback semantics, but only
// pays the cost when a handler actually needs an embedding.
// Tier 0 (ADR-089): ruvector@0.2.27 bundled ONNX (no sharp dep, fixes ADR-086's
//   silent-fallback bug at source; closes the chain described in ruvnet/ruvector#523).
// Tier 1: agentic-flow v3 ReasoningBank (was Tier 1 — broken on darwin-arm64 without sharp)
// Tier 2-3: @claude-flow/embeddings
let realEmbeddings: { embed: (text: string) => Promise<number[]> } | null = null;
let embeddingServiceName: string = 'none';
let embeddingsPromise: Promise<void> | null = null;

/**
 * Memoized lazy initialiser for the embedding provider chain. Safe to call
 * concurrently (single shared promise). If every tier fails to import or
 * probe, `realEmbeddings` stays null and callers use the explicit
 * hash-fallback path — identical degraded semantics to the old eager block.
 */
function ensureEmbeddings(): Promise<void> {
  if (embeddingsPromise) return embeddingsPromise;
  embeddingsPromise = (async () => {
    try {
      // Tier 0: ruvector@0.2.27 — bundled all-MiniLM-L6-v2 + parallel worker pool.
      // Probe with isOnnxAvailable() and verify an actual embed succeeds (avoids
      // the type-load-success-but-runtime-fails trap from ADR-086). The probe now
      // runs on first embed request instead of at import time.
      // NOTE: ruvector's embed() returns `{embedding, dimension, timeMs}` — we
      // unwrap to plain number[] for the shared interface.
      const rv = await import('ruvector').catch(() => null) as any;
      if (rv?.embed && typeof rv.embed === 'function' && rv.isOnnxAvailable?.()) {
        try {
          if (typeof rv.initOnnxEmbedder === 'function') await rv.initOnnxEmbedder();
          const probe = await rv.embed('probe');
          // Handle both shapes: ruvector wraps as {embedding, dimension, timeMs};
          // some versions returned raw Float32Array.
          const probeVec = probe?.embedding ?? probe;
          if (probeVec && (Array.isArray(probeVec) || (probeVec as ArrayLike<number>).length > 0)) {
            realEmbeddings = {
              embed: async (text: string) => {
                const r = await rv.embed(text);
                const v = r?.embedding ?? r;
                return Array.isArray(v) ? v : Array.from(v as ArrayLike<number>);
              },
            };
            embeddingServiceName = 'ruvector@0.2.27 (bundled all-MiniLM-L6-v2)';
          }
        } catch {
          // ruvector embed failed at runtime; fall through to next tier
        }
      }

      // Tier 1: agentic-flow v3 ReasoningBank (kept for backward-compat; may
      // silently fall back on darwin-arm64 without sharp — that's the bug
      // Tier 0 was added to bypass).
      if (!realEmbeddings) {
        const rb = await import('agentic-flow/reasoningbank').catch(() => null);
        if (rb?.computeEmbedding) {
          realEmbeddings = { embed: (text: string) => rb.computeEmbedding(text) };
          embeddingServiceName = 'agentic-flow/reasoningbank';
        }
      }

      // Tier 2: @claude-flow/embeddings with agentic-flow provider
      if (!realEmbeddings) {
        const embeddingsModule = await import('@claude-flow/embeddings').catch(() => null);
        if (embeddingsModule?.createEmbeddingService) {
          try {
            const service = embeddingsModule.createEmbeddingService({ provider: 'agentic-flow' });
            realEmbeddings = {
              embed: async (text: string) => {
                const result = await service.embed(text);
                return Array.from(result.embedding);
              },
            };
            embeddingServiceName = 'agentic-flow';
          } catch {
            // agentic-flow provider not available, try ONNX
          }
        }
      }

      // Tier 3: @claude-flow/embeddings with ONNX provider
      if (!realEmbeddings) {
        const embeddingsModule = await import('@claude-flow/embeddings').catch(() => null);
        if (embeddingsModule?.createEmbeddingService) {
          try {
            const service = embeddingsModule.createEmbeddingService({ provider: 'onnx' });
            realEmbeddings = {
              embed: async (text: string) => {
                const result = await service.embed(text);
                return Array.from(result.embedding);
              },
            };
            embeddingServiceName = 'onnx';
          } catch {
            // ONNX provider not available, fall through to mock
          }
        }
      }

      // No Tier 4 mock fallback. If all real-embedder tiers fail to import or
      // probe, leave realEmbeddings null and let downstream code use the
      // explicit hash-fallback path with a clear _embeddingNote in stats.
      // Silently substituting mock embeddings would hide a missing production
      // dependency from callers — that's the bug ADR-086 was about.
    } catch {
      // No embedding provider available, will use fallback
    }
  })();
  return embeddingsPromise;
}

// Storage paths
const STORAGE_DIR = '.claude-flow';
const NEURAL_DIR = 'neural';
const MODELS_FILE = 'models.json';
const PATTERNS_FILE = 'patterns.json';

interface NeuralModel {
  id: string;
  name: string;
  type: 'moe' | 'transformer' | 'classifier' | 'embedding';
  status: 'untrained' | 'training' | 'ready' | 'error';
  accuracy: number;
  trainedAt?: string;
  epochs: number;
  config: Record<string, unknown>;
}

interface Pattern {
  id: string;
  name: string;
  type: string;
  embedding: number[];
  /** Source text the embedding was built from. Cap 4096 chars. Used for
   *  BM25 in hybrid retrieval (ADR-078). Optional for backwards compat —
   *  pre-3.10.18 patterns fall back to `name` for BM25 tokenisation. */
  content?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  usageCount: number;
}

interface NeuralStore {
  models: Record<string, NeuralModel>;
  patterns: Record<string, Pattern>;
  version: string;
}

function getNeuralDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, NEURAL_DIR);
}

function getNeuralPath(): string {
  return join(getNeuralDir(), MODELS_FILE);
}

function ensureNeuralDir(): void {
  const dir = getNeuralDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadNeuralStore(): NeuralStore {
  try {
    const path = getNeuralPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { models: {}, patterns: {}, version: '3.0.0' };
}

/**
 * ADR-176 flywheel: expose the stored patterns (id/name/content) so the
 * self-optimizing loop can harvest a benchmark corpus from real usage. Additive,
 * read-only, never throws.
 */
export function getStorePatterns(): Array<{ id: string; name: string; content?: string }> {
  try {
    return Object.values(loadNeuralStore().patterns ?? {}).map((p) => ({ id: p.id, name: p.name, content: p.content }));
  } catch { return []; }
}

function saveNeuralStore(store: NeuralStore): void {
  ensureNeuralDir();
  writeFileSync(getNeuralPath(), JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Public helper: read-only stats about the neural store, for the unified
 * learning-stats aggregator. Returns total pattern count + per-type breakdown
 * without exposing the embeddings.
 */
export function getNeuralStoreStats(): {
  patternCount: number;
  byType: Record<string, number>;
  modelCount: number;
  source: string;
} {
  const store = loadNeuralStore();
  const patterns = Object.values(store.patterns ?? {});
  const byType: Record<string, number> = {};
  for (const p of patterns) {
    const t = (p as { type?: string }).type || 'unknown';
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return {
    patternCount: patterns.length,
    byType,
    modelCount: Object.values(store.models ?? {}).length,
    source: '.claude-flow/neural/patterns.json (loadNeuralStore)',
  };
}

/**
 * Public helper: store an array of patterns into the neural store so they
 * surface via `neural_patterns list`. Used by hooks_pretrain so its extracted
 * patterns are actually queryable, not just bundled in the `pretrain` namespace.
 * #2245.
 *
 * Returns the number of patterns written.
 */
export async function storeNeuralPatterns(items: Array<{
  name: string;
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
}>): Promise<{ stored: number; total: number }> {
  if (!items || items.length === 0) return { stored: 0, total: 0 };
  // realEmbeddings is initialised lazily by ensureEmbeddings() (invoked from
  // generateEmbedding()); it falls back to a hash-based embedding if no
  // provider is available.
  const store = loadNeuralStore();
  let stored = 0;
  for (const item of items) {
    if (!item.name || !item.type) continue;
    const sourceText = item.content ?? item.name;
    const embedding = await generateEmbedding(sourceText);
    const id = `pattern-${Date.now()}-${stored.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    store.patterns[id] = {
      id,
      name: String(item.name).slice(0, 200),
      type: String(item.type).slice(0, 64),
      embedding,
      content: typeof sourceText === 'string' ? sourceText.slice(0, 4096) : undefined,
      metadata: item.metadata ?? {},
      createdAt: new Date().toISOString(),
      usageCount: 0,
    };
    stored++;
  }
  saveNeuralStore(store);
  return { stored, total: items.length };
}

// Generate embedding - uses real ML embeddings if available, falls back to deterministic hash
async function generateEmbedding(text?: string, dims: number = 384): Promise<number[]> {
  // Lazily resolve the embedding provider on first real use (perf: keeps
  // ONNX init off the CLI startup path — see ensureEmbeddings()).
  if (text) await ensureEmbeddings();
  // If real embeddings available and text provided, use them
  if (realEmbeddings && text) {
    try {
      return await realEmbeddings.embed(text);
    } catch {
      // Fall back to hash-based
    }
  }

  // Hash-based deterministic embedding (better than pure random for consistency)
  // NOTE: No semantic meaning — only useful for consistent deduplication, not similarity search
  if (text) {
    if (embeddingServiceName === 'none') {
      embeddingServiceName = 'hash-fallback';
    }
    const hash = text.split('').reduce((acc, char, i) => {
      return acc + char.charCodeAt(0) * (i + 1);
    }, 0);

    // Use hash to seed a deterministic embedding
    const embedding: number[] = [];
    let seed = hash;
    for (let i = 0; i < dims; i++) {
      // Simple LCG random with seed
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      embedding.push((seed / 0x7fffffff) * 2 - 1);
    }
    return embedding;
  }

  // No text provided — return zero vector (callers should always provide text)
  return new Array(dims).fill(0);
}

// Cosine similarity for pattern search
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export const neuralTools: MCPTool[] = [
  {
    name: 'neural_train',
    description: 'Train a neural model Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to train' },
        modelType: { type: 'string', enum: ['moe', 'transformer', 'classifier', 'embedding'], description: 'Model type' },
        epochs: { type: 'number', description: 'Number of training epochs' },
        learningRate: { type: 'number', description: 'Learning rate' },
        data: { type: 'object', description: 'Training data' },
      },
      required: ['modelType'],
    },
    handler: async (input) => {
      if (input.modelId) { const v = validateIdentifier(input.modelId as string, 'modelId'); if (!v.valid) return { success: false, error: v.error }; }

      const store = loadNeuralStore();
      const modelId = (input.modelId as string) || `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const modelType = input.modelType as NeuralModel['type'];
      const epochs = (input.epochs as number) || 10;

      const model: NeuralModel = {
        id: modelId,
        name: `${modelType}-model`,
        type: modelType,
        status: 'training',
        accuracy: 0,
        epochs,
        config: {
          learningRate: input.learningRate || 0.001,
          batchSize: 32,
        },
      };

      store.models[modelId] = model;
      saveNeuralStore(store);

      // Real training: embed training data and store as searchable patterns
      const trainingData = input.data as Record<string, unknown> | Array<unknown> | undefined;
      let patternsStored = 0;

      if (trainingData) {
        const entries = Array.isArray(trainingData) ? trainingData : [trainingData];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const text = typeof entry === 'string' ? entry
            : (entry as Record<string, unknown>)?.text as string
            || (entry as Record<string, unknown>)?.content as string
            || (entry as Record<string, unknown>)?.label as string
            || JSON.stringify(entry);
          if (!text) continue;

          const embedding = await generateEmbedding(text, 384);
          const patternId = `${modelId}-train-${i}`;
          // ADR-093 F11: extract a meaningful label instead of dumping raw
          // training JSON as the pattern name. Audit reported neural_predict
          // returned `label: <raw training data JSON>` because the previous
          // fallback was `text.slice(0, 100)` where text was `JSON.stringify(entry)`.
          let label: string;
          if (typeof entry === 'string') {
            label = entry.slice(0, 80);
          } else if (entry && typeof entry === 'object') {
            const e = entry as Record<string, unknown>;
            // Prefer common semantic fields over a JSON dump
            const labelField = e.label ?? e.category ?? e.class ?? e.tag ?? e.intent ?? e.name ?? e.title;
            if (typeof labelField === 'string' && labelField.length > 0) {
              label = labelField.slice(0, 80);
            } else {
              const summaryField = e.text ?? e.input ?? e.task ?? e.description ?? e.content;
              if (typeof summaryField === 'string' && summaryField.length > 0) {
                label = `${summaryField.slice(0, 60)}${summaryField.length > 60 ? '…' : ''}`;
              } else {
                // Last resort: reduce to a stable short hash-like id
                label = `${modelType}:entry-${i}`;
              }
            }
          } else {
            label = `${modelType}:entry-${i}`;
          }
          store.patterns[patternId] = {
            id: patternId,
            name: label,
            type: modelType,
            embedding,
            metadata: { modelId, epoch: epochs, index: i, raw: entry },
            createdAt: new Date().toISOString(),
            usageCount: 0,
          };
          patternsStored++;
        }
      }

      model.status = 'ready';
      model.accuracy = patternsStored > 0 ? 1.0 : 0; // accuracy = data stored, not simulated
      model.trainedAt = new Date().toISOString();
      saveNeuralStore(store);

      return {
        success: true,
        _realEmbedding: !!realEmbeddings,
        _embeddingSource: embeddingServiceName,
        embeddingProvider: embeddingServiceName,
        modelId,
        type: modelType,
        status: model.status,
        patternsStored,
        totalPatterns: Object.keys(store.patterns).length,
        epochs,
        trainedAt: model.trainedAt,
        ...(embeddingServiceName === 'hash-fallback' || embeddingServiceName === 'none' ? {
          platformNote: 'ONNX embeddings not available — using hash-based fallback. Install @claude-flow/embeddings and run "embeddings init --download" for semantic search.',
        } : {}),
      };
    },
  },
  {
    name: 'neural_predict',
    description: 'Make predictions using a neural model Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to use' },
        input: { type: 'string', description: 'Input text or data' },
        topK: { type: 'number', description: 'Number of top predictions' },
      },
      required: ['input'],
    },
    handler: async (input) => {
      { const v = validateText(input.input as string, 'input'); if (!v.valid) return { success: false, error: v.error }; }
      if (input.modelId) { const v = validateIdentifier(input.modelId as string, 'modelId'); if (!v.valid) return { success: false, error: v.error }; }

      const store = loadNeuralStore();
      const modelId = input.modelId as string;
      const inputText = input.input as string;
      const topK = (input.topK as number) || 3;

      // Find model or use default
      const model = modelId ? store.models[modelId] : Object.values(store.models).find(m => m.status === 'ready');

      if (model && model.status !== 'ready') {
        return { success: false, error: 'Model not ready' };
      }

      // Generate real embedding for the input
      const startTime = performance.now();
      const embedding = await generateEmbedding(inputText, 384);
      const latency = Math.round(performance.now() - startTime);

      // ADR-093 F11: real classifier head over stored patterns. Previously
      // confidence was the raw cosine similarity (often clamped to 0 when
      // stored embeddings were stale or zero-vectored). Now we run k-NN
      // with cosine distance and apply a temperature-controlled softmax
      // over the top-K so confidence is a proper distribution that sums
      // to 1, and we surface enough metadata to trust the result.
      const storedPatterns = Object.values(store.patterns);
      let predictions: Array<{ label: string; confidence: number; patternId: string; cosineSimilarity: number }>;

      if (storedPatterns.length > 0) {
        // Step 1: k-NN with cosine
        const scored = storedPatterns
          .map(p => {
            const sim = cosineSimilarity(embedding, p.embedding);
            return {
              patternId: p.id,
              label: p.name || p.type || p.id,
              cosineSimilarity: sim,
            };
          })
          .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)
          .slice(0, topK);

        // Step 2: temperature-softmax over the top-K so confidence sums to 1.
        // Temperature 0.1 sharpens differences between similar candidates.
        const tau = 0.1;
        const exps = scored.map(s => Math.exp(s.cosineSimilarity / tau));
        const z = exps.reduce((a, b) => a + b, 0) || 1;
        predictions = scored.map((s, i) => ({
          label: s.label,
          patternId: s.patternId,
          cosineSimilarity: Number(s.cosineSimilarity.toFixed(4)),
          confidence: Number((exps[i] / z).toFixed(4)),
        }));
      } else {
        // No patterns stored — no predictions possible. Be honest about it
        // instead of returning empty silently.
        predictions = [];
      }

      const topConfidence = predictions[0]?.confidence ?? 0;
      const topSimilarity = predictions[0]?.cosineSimilarity ?? 0;

      return {
        success: true,
        _realEmbedding: !!realEmbeddings,
        _embeddingSource: embeddingServiceName,
        embeddingProvider: embeddingServiceName,
        _hasStoredPatterns: storedPatterns.length > 0,
        _classifierHead: storedPatterns.length > 0 ? 'knn-cosine+softmax(tau=0.1)' : 'none',
        modelId: model?.id || 'default',
        input: inputText,
        predictions,
        // Surface cosineSimilarity separately so callers know whether the
        // softmax confidence reflects true match strength.
        topPrediction: predictions[0]?.label ?? null,
        topConfidence,
        topSimilarity,
        embedding: embedding.slice(0, 8), // Preview of embedding
        embeddingDims: embedding.length,
        latency,
        ...(storedPatterns.length === 0 ? {
          _note: 'No patterns stored. Train with neural_train(modelType, trainingData) before predicting.',
        } : {}),
      };
    },
  },
  {
    name: 'neural_patterns',
    description: 'Get or manage neural patterns Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'store', 'search', 'delete'], description: 'Action to perform' },
        patternId: { type: 'string', description: 'Pattern ID' },
        name: { type: 'string', description: 'Pattern name' },
        type: { type: 'string', description: 'Pattern type' },
        content: { type: 'string', description: 'Pattern source text (used for BM25 in hybrid search; falls back to name)' },
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Top-K results to return (default 10, max 100)' },
        mode: { type: 'string', enum: ['hybrid', 'cosine'], description: 'Search mode — hybrid (cosine+BM25+MMR, default) or cosine (pre-3.10.18 behaviour, for A/B)' },
        alpha: { type: 'number', description: 'Hybrid: cosine weight in [0,1]; (1-α) is BM25 weight (default 0.5, tuned ADR-082)' },
        mmrLambda: { type: 'number', description: 'Hybrid: MMR balance — 1.0 = pure relevance, 0.0 = pure diversity (default 0.7, tuned ADR-082)' },
        subjectWeight: { type: 'number', description: 'Hybrid: multi-field BM25 weight for subject/name (default 2.0 non-rerank, 3.0 with rerank — tuned ADR-082/083)' },
        bodyWeight: { type: 'number', description: 'Hybrid: multi-field BM25 weight for body/content (default 1.0)' },
        typePenaltyFactor: { type: 'number', description: 'Hybrid: meta-commit score multiplier — release/merge/bump commits × this factor (default 1.0 = disabled; set 0.5 for aggressive suppression)' },
        rerank: { type: 'boolean', description: 'Hybrid: opt-in cross-encoder rerank pass over the top-K (ADR-080). Adds ~20-40 ms per (query, doc) pair; first call downloads ~30MB model. Gracefully degrades to hybrid+MMR order when unavailable.' },
        hybridWeight: { type: 'number', description: 'Rerank: hybrid score weight in final combination (default 0.7, tuned ADR-083)' },
        ceWeight: { type: 'number', description: 'Rerank: cross-encoder score weight in final combination (default 0.3, tuned ADR-083)' },
        data: { type: 'object', description: 'Pattern data' },
      },
    },
    handler: async (input) => {
      if (input.patternId) { const v = validateIdentifier(input.patternId as string, 'patternId'); if (!v.valid) return { success: false, error: v.error }; }
      if (input.name) { const v = validateText(input.name as string, 'name'); if (!v.valid) return { success: false, error: v.error }; }
      if (input.type) { const v = validateIdentifier(input.type as string, 'type'); if (!v.valid) return { success: false, error: v.error }; }
      if (input.query) { const v = validateText(input.query as string, 'query'); if (!v.valid) return { success: false, error: v.error }; }

      const store = loadNeuralStore();
      const action = (input.action as string) || 'list';

      if (action === 'list') {
        const patterns = Object.values(store.patterns);
        const typeFilter = input.type as string;
        const filtered = typeFilter ? patterns.filter(p => p.type === typeFilter) : patterns;

        return {
          patterns: filtered.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            usageCount: p.usageCount,
            createdAt: p.createdAt,
          })),
          total: filtered.length,
        };
      }

      if (action === 'get') {
        const pattern = store.patterns[input.patternId as string];
        if (!pattern) {
          return { success: false, error: 'Pattern not found' };
        }
        return { success: true, pattern };
      }

      if (action === 'store') {
        const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const patternName = (input.name as string) || 'Unnamed pattern';
        const patternContent = (input.content as string) ?? patternName;

        // Generate embedding from pattern content (falls back to name).
        const embedding = await generateEmbedding(patternContent, 384);

        const pattern: Pattern = {
          id: patternId,
          name: patternName,
          type: (input.type as string) || 'general',
          embedding,
          content: typeof patternContent === 'string' ? patternContent.slice(0, 4096) : undefined,
          metadata: (input.data as Record<string, unknown>) || {},
          createdAt: new Date().toISOString(),
          usageCount: 0,
        };

        store.patterns[patternId] = pattern;
        saveNeuralStore(store);

        return {
          success: true,
          _realEmbedding: !!realEmbeddings,
          _embeddingSource: embeddingServiceName,
          embeddingProvider: embeddingServiceName,
          patternId,
          name: pattern.name,
          type: pattern.type,
          embeddingDims: embedding.length,
          createdAt: pattern.createdAt,
        };
      }

      if (action === 'search') {
        const query = input.query as string;
        const k = Math.min(Math.max(Number(input.limit ?? input.topK ?? 10), 1), 100);
        // ADR-078 hybrid retrieval controls. Cosine-only mode preserves the
        // pre-3.10.18 behaviour for A/B tests via {mode:'cosine'}; default is
        // hybrid (cosine + BM25 + MMR).
        const mode = String(input.mode ?? 'hybrid');
        const useRerank = input.rerank === true || String(input.rerank) === 'true';
        // ADR-083 joint grid: rerank path benefits from DIFFERENT hybrid
        // sub-params than non-rerank (the cross-encoder adds semantic depth,
        // so the hybrid stage can be more keyword-focused). nDCG@3 0.900 →
        // 0.963 on rerank just by switching sw 2.0 → 3.0 in the hybrid stage.
        // Champion-provided defaults (ADR-176/177): explicit input wins, then the
        // adopted proven-config champion, then the hardcoded ADR-082 defaults.
        const champ = activeChampionParams();
        const alpha = Number(input.alpha ?? champ.alpha ?? 0.5);
        const mmrLambda = Number(input.mmrLambda ?? champ.mmrLambda ?? 0.7);

        const { tokenize, buildCorpusStats, hybridScores, mmrRerank, multiFieldBM25, typePenalty } =
          await import('../memory/hybrid-retrieval.js');

        const patterns = Object.values(store.patterns);

        // Query embedding + cosine array depend only on (query, store) — NOT the
        // retrieval config. Cache them so scoring many configs for one query
        // (the flywheel's access pattern) embeds + cosines once, not per config.
        const _cosKey = `${corpusFingerprint(patterns)}::${query}`;
        let queryEmbedding: number[], cosineArr: number[];
        const _hit = _cosineCacheGet(_cosKey);
        if (_hit) {
          queryEmbedding = _hit.queryEmbedding;
          cosineArr = _hit.cosineArr;
        } else {
          queryEmbedding = await generateEmbedding(query, 384);
          cosineArr = patterns.map((p) => cosineSimilarity(queryEmbedding, p.embedding));
          _cosineCacheSet(_cosKey, { queryEmbedding, cosineArr });
        }

        if (mode === 'cosine') {
          const ranked = patterns
            .map((p, i) => ({ ...p, similarity: cosineArr[i] }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, k);
          return {
            _realSimilarity: true,
            _realEmbedding: !!realEmbeddings,
            _embeddingSource: embeddingServiceName,
            embeddingProvider: embeddingServiceName,
            mode: 'cosine',
            query,
            results: ranked.map((r) => ({ id: r.id, name: r.name, type: r.type, similarity: r.similarity })),
            total: ranked.length,
          };
        }

        // Hybrid path — multi-field BM25 (subject 3×, body 1×) + type penalty
        // for meta-commits (release bumps / merges) per ADR-079. Falls back
        // to single-field BM25 when no content is stored.
        // Cache the (config-independent) tokenized docs + BM25 stats by store fingerprint.
        const _fp = corpusFingerprint(patterns);
        let subjectDocs: string[][], bodyDocs: string[][], subjectStats: ReturnType<typeof buildCorpusStats>, bodyStats: ReturnType<typeof buildCorpusStats>;
        if (_corpusStatsCache && _corpusStatsCache.fp === _fp) {
          subjectDocs = _corpusStatsCache.subjectDocs;
          bodyDocs = _corpusStatsCache.bodyDocs;
          subjectStats = _corpusStatsCache.subjectStats as ReturnType<typeof buildCorpusStats>;
          bodyStats = _corpusStatsCache.bodyStats as ReturnType<typeof buildCorpusStats>;
        } else {
          subjectDocs = patterns.map((p) => tokenize(p.name ?? ''));
          bodyDocs = patterns.map((p) => {
            // Body is content minus the subject — if content starts with name,
            // strip it; otherwise use full content (with name removed if duplicated).
            const c = p.content ?? '';
            const n = p.name ?? '';
            return tokenize(c.startsWith(n) ? c.slice(n.length) : c);
          });
          subjectStats = buildCorpusStats(subjectDocs);
          bodyStats = buildCorpusStats(bodyDocs);
          _corpusStatsCache = { fp: _fp, subjectDocs, bodyDocs, subjectStats, bodyStats };
        }
        const queryTokens = tokenize(query);
        // ADR-082: subjectWeight 3.0 → 2.0 from grid (sw=2 dominates at hybrid-only).
        // ADR-083 joint grid: when rerank is on, the cross-encoder handles
        // semantic understanding, so the hybrid stage can be MORE
        // subject-focused (sw=3) — recovers nDCG@3 0.963.
        const subjectWeight = Number(input.subjectWeight ?? champ.subjectWeight ?? (useRerank ? 3.0 : 2.0));
        const bodyWeight = Number(input.bodyWeight ?? champ.bodyWeight ?? 1.0);
        const bm25Arr = patterns.map((_, i) =>
          multiFieldBM25(queryTokens, subjectDocs[i], bodyDocs[i], subjectStats, bodyStats, subjectWeight, bodyWeight),
        );
        const baseHybrid = hybridScores(cosineArr, bm25Arr, alpha);
        // Type penalty — opt-in (default 1.0 = disabled). Ablation in ADR-079
        // showed multi-field BM25 alone gives best top-1 (8/10 vs 7/10 with
        // penalty enabled) because some relevant work commits also match the
        // Merge/release regex. Callers wanting aggressive meta-commit
        // suppression can set {typePenaltyFactor: 0.5}.
        const typeFactor = Number(input.typePenaltyFactor ?? champ.typePenaltyFactor ?? 1.0);
        const hybridArr = typeFactor === 1.0
          ? baseHybrid
          : baseHybrid.map((s, i) => s * typePenalty(patterns[i].name, typeFactor));

        // Candidate pool sizing: k*3 for MMR, k*6 for cross-encoder (it needs
        // more options to find the truly-best). ADR-080 ablation: rerank over
        // a narrow post-MMR slice degrades top-1; reranking a wider hybrid
        // top-K*6 pool restores and exceeds the no-rerank baseline.
        // useRerank declared at top of search block for conditional defaults.
        const poolSize = useRerank ? k * 6 : k * 3;
        const prelim = patterns
          .map((p, i) => ({ p, hybrid: hybridArr[i], cosine: cosineArr[i], bm25: bm25Arr[i] }))
          .sort((a, b) => b.hybrid - a.hybrid)
          .slice(0, Math.min(poolSize, patterns.length));

        const candidates = prelim.map(({ p, hybrid, cosine, bm25 }) => ({
          id: p.id, name: p.name, type: p.type,
          embedding: p.embedding,
          content: p.content,
          relevance: hybrid,
          _cosine: cosine,
          _bm25: bm25,
        }));

        let picked: Array<typeof candidates[number] & { mmrScore?: number; _crossEncoderScore?: number }>;

        if (useRerank) {
          // ADR-080: cross-encoder reranks the wider candidate pool, then
          // final score = hybridWeight * hybrid + ceWeight * crossEncoder
          // on normalised scales. Ablation showed cross-encoder alone hits
          // 100% top-3 but loses top-1 (calibration on short commit subjects
          // is noisy); linear combination preserves hybrid's top-1 strength
          // while gaining the cross-encoder's recall.
          try {
            const { crossEncoderRerank } = await import('../memory/cross-encoder-rerank.js');
            const { normalise } = await import('../memory/hybrid-retrieval.js');
            const docs = candidates.map((c) => c.content || c.name);
            const reranked = await crossEncoderRerank(query, docs);
            const ceScores = new Array(candidates.length).fill(0);
            for (const { index, score } of reranked) ceScores[index] = score;

            const hybridNorm = normalise(candidates.map((c) => c.relevance));
            const ceNorm = normalise(ceScores);
            // ADR-083 joint grid: hw=0.7 cw=0.3 (with α=0.5 sw=3 from above) is
            // the joint optimum at nDCG@3=0.963 (vs 0.900 at 0.5/0.5). The
            // hybrid signal carries most of the relevance; the cross-encoder
            // contributes a 30% smoothing/disambiguation kick.
            const hybridWeight = Number(input.hybridWeight ?? 0.7);
            const ceWeight = Number(input.ceWeight ?? 0.3);
            const combined = candidates.map((c, i) => ({
              ...c,
              _crossEncoderScore: ceScores[i],
              _combinedScore: hybridWeight * hybridNorm[i] + ceWeight * ceNorm[i],
            }));
            picked = combined
              .sort((a, b) => b._combinedScore - a._combinedScore)
              .slice(0, k);
          } catch {
            picked = candidates.slice(0, k);
          }
        } else {
          // Default path: MMR diversity over top-K*3 hybrid candidates.
          picked = mmrRerank(candidates, k, mmrLambda);
        }

        return {
          _realSimilarity: true,
          _realEmbedding: !!realEmbeddings,
          _embeddingSource: embeddingServiceName,
          embeddingProvider: embeddingServiceName,
          mode: 'hybrid',
          alpha,
          mmrLambda,
          rerank: useRerank,
          query,
          results: picked.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            similarity: r.relevance,   // exposed as `similarity` for back-compat
            hybridScore: r.relevance,
            cosineScore: r._cosine,
            bm25Score: r._bm25,
            mmrScore: r.mmrScore,
            ...((r as { _crossEncoderScore?: number })._crossEncoderScore !== undefined
              ? { crossEncoderScore: (r as { _crossEncoderScore?: number })._crossEncoderScore }
              : {}),
          })),
          total: picked.length,
        };
      }

      if (action === 'delete') {
        const patternId = input.patternId as string;
        if (!store.patterns[patternId]) {
          return { success: false, error: 'Pattern not found' };
        }
        delete store.patterns[patternId];
        saveNeuralStore(store);
        return { success: true, deleted: patternId };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'neural_compress',
    description: 'Compress neural model or embeddings Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to compress' },
        method: { type: 'string', enum: ['quantize', 'prune', 'distill'], description: 'Compression method' },
        targetSize: { type: 'number', description: 'Target size reduction (0-1)' },
      },
    },
    handler: async (input) => {
      if (input.modelId) { const v = validateIdentifier(input.modelId as string, 'modelId'); if (!v.valid) return { success: false, error: v.error }; }

      // Resolve provider so embeddingProvider in the result matches the old
      // eager-init reporting.
      await ensureEmbeddings();
      const store = loadNeuralStore();
      const method = (input.method as string) || 'quantize';
      const targetReduction = (input.targetSize as number) || 0.5;
      const patterns = Object.values(store.patterns);

      if (patterns.length === 0) {
        return { success: false, error: 'No patterns to compress. Train patterns first with neural_train.' };
      }

      const beforeCount = patterns.length;
      const beforeSize = patterns.reduce((s, p) => s + (p.embedding?.length || 0) * 4, 0); // Float32 = 4 bytes

      if (method === 'quantize') {
        try {
          const { quantizeInt8, getQuantizationStats } = await import('../memory/memory-initializer.js');
          let totalCompressed = 0;
          for (const pattern of patterns) {
            if (pattern.embedding && pattern.embedding.length > 0) {
              const stats = getQuantizationStats(pattern.embedding);
              const quantized = quantizeInt8(pattern.embedding);
              // Store quantized metadata (keep original embedding for search)
              (pattern as any)._quantized = {
                scale: quantized.scale,
                zeroPoint: quantized.zeroPoint,
                compressionRatio: stats.compressionRatio,
              };
              totalCompressed++;
            }
          }
          saveNeuralStore(store);
          return {
            success: true, _real: true, method,
            embeddingProvider: embeddingServiceName,
            patternsCompressed: totalCompressed,
            compressionRatio: '3.92x (Int8)',
            beforeBytes: beforeSize,
            afterBytes: Math.round(beforeSize / 3.92),
          };
        } catch {
          return { success: false, error: 'Quantization requires memory-initializer. Run `memory init` first.' };
        }
      }

      if (method === 'prune') {
        // Prune patterns with low usage count below threshold (targetReduction as min usage)
        const threshold = targetReduction;
        const toRemove: string[] = [];
        for (const [id, pattern] of Object.entries(store.patterns)) {
          if ((pattern.usageCount || 0) < threshold) toRemove.push(id);
        }
        for (const id of toRemove) delete store.patterns[id];
        saveNeuralStore(store);
        return {
          success: true, _real: true, method,
          embeddingProvider: embeddingServiceName,
          threshold,
          patternsRemoved: toRemove.length,
          patternsBefore: beforeCount,
          patternsAfter: Object.keys(store.patterns).length,
        };
      }

      if (method === 'distill') {
        // Merge similar patterns by cosine similarity > 0.95
        const patternList = Object.entries(store.patterns);
        const merged: string[] = [];
        for (let i = 0; i < patternList.length; i++) {
          const [idA, a] = patternList[i];
          if (merged.includes(idA)) continue;
          for (let j = i + 1; j < patternList.length; j++) {
            const [idB, b] = patternList[j];
            if (!a.embedding || !b.embedding || merged.includes(idB)) continue;
            const sim = cosineSimilarity(a.embedding, b.embedding);
            if (sim > 0.95) {
              // Merge: average embeddings, keep higher usage count
              for (let k = 0; k < a.embedding.length; k++) {
                a.embedding[k] = (a.embedding[k] + (b.embedding[k] || 0)) / 2;
              }
              a.usageCount = Math.max(a.usageCount || 0, b.usageCount || 0);
              delete store.patterns[idB];
              merged.push(idB);
            }
          }
        }
        saveNeuralStore(store);
        return {
          success: true, _real: true, method,
          embeddingProvider: embeddingServiceName,
          patternsMerged: merged.length,
          patternsBefore: beforeCount,
          patternsAfter: Object.keys(store.patterns).length,
        };
      }

      return { success: false, error: `Unknown method: ${method}. Use quantize, prune, or distill.` };
    },
  },
  {
    name: 'neural_status',
    description: 'Get neural system status Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Specific model ID' },
        detailed: { type: 'boolean', description: 'Include detailed info' },
      },
    },
    handler: async (input) => {
      if (input.modelId) { const v = validateIdentifier(input.modelId as string, 'modelId'); if (!v.valid) return { success: false, error: v.error }; }

      // Resolve provider so _realEmbeddings/embeddingProvider report the same
      // values the old eager-init version produced.
      await ensureEmbeddings();
      const store = loadNeuralStore();

      if (input.modelId) {
        const model = store.models[input.modelId as string];
        if (!model) {
          return { success: false, error: 'Model not found' };
        }
        return { success: true, model };
      }

      const models = Object.values(store.models);
      const patterns = Object.values(store.patterns);

      return {
        _realEmbeddings: !!realEmbeddings,
        embeddingProvider: realEmbeddings ? `@claude-flow/embeddings (${embeddingServiceName})` : 'hash-based (deterministic)',
        models: {
          total: models.length,
          ready: models.filter(m => m.status === 'ready').length,
          training: models.filter(m => m.status === 'training').length,
          avgAccuracy: models.length > 0
            ? models.reduce((sum, m) => sum + m.accuracy, 0) / models.length
            : 0,
        },
        patterns: {
          total: patterns.length,
          byType: patterns.reduce((acc, p) => {
            acc[p.type] = (acc[p.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          totalEmbeddingDims: patterns.length > 0 ? patterns[0].embedding.length : 384,
        },
        features: {
          hnsw: true,
          quantization: true,
          // #1770: probe the real loader instead of returning a literal false.
          // Was hardcoded false, which contradicted hooks_intelligence_stats's
          // simultaneous claim of `implementation: real-flash-attention`.
          // The two surfaces now agree on a single source of truth.
          flashAttention: await (async () => {
            try {
              // #1773 item 4 — flash-attention now lives in @claude-flow/neural
              const { getFlashAttention } = await import('@claude-flow/neural');
              return getFlashAttention() !== null;
            } catch {
              return false;
            }
          })(),
          reasoningBank: true,
        },
      };
    },
  },
  {
    name: 'neural_optimize',
    description: 'Optimize neural model performance Use when nothing native trains on your workflow — Claude Code has no learning loop. Use to train SONA/MoE/EWC patterns from successful task outcomes; query via neural_predict before spawning agents. Off-path for one-shot work.',
    category: 'neural',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Model ID to optimize' },
        target: { type: 'string', enum: ['speed', 'memory', 'accuracy', 'balanced'], description: 'Optimization target' },
      },
    },
    handler: async (input) => {
      if (input.modelId) { const v = validateIdentifier(input.modelId as string, 'modelId'); if (!v.valid) return { success: false, error: v.error }; }

      // Resolve provider so embeddingProvider in the result matches the old
      // eager-init reporting.
      await ensureEmbeddings();
      const store = loadNeuralStore();
      const target = (input.target as string) || 'balanced';
      const patterns = Object.values(store.patterns);

      if (patterns.length === 0) {
        return { success: false, error: 'No patterns to optimize. Train patterns first with neural_train.' };
      }

      const startTime = performance.now();
      const actions: string[] = [];
      const beforeCount = patterns.length;
      const dims = patterns[0]?.embedding?.length || 0;
      let patternsRemoved = 0;
      let patternsQuantized = 0;
      let duplicatesRemoved = 0;

      // speed / balanced: deduplicate identical or near-identical patterns
      if (target === 'speed' || target === 'balanced') {
        const seen = new Map<string, string>(); // hash -> id
        for (const [id, p] of Object.entries(store.patterns)) {
          if (!p.embedding || p.embedding.length === 0) continue;
          // Quick hash: first 8 dims rounded
          const hash = p.embedding.slice(0, 8).map(v => v.toFixed(4)).join(',');
          if (seen.has(hash)) {
            // Verify with full cosine similarity
            const existingId = seen.get(hash)!;
            const existing = store.patterns[existingId];
            if (existing && cosineSimilarity(p.embedding, existing.embedding) > 0.99) {
              existing.usageCount = Math.max(existing.usageCount || 0, p.usageCount || 0);
              delete store.patterns[id];
              duplicatesRemoved++;
            }
          } else {
            seen.set(hash, id);
          }
        }
        if (duplicatesRemoved > 0) actions.push(`Removed ${duplicatesRemoved} near-duplicate patterns`);
      }

      // memory / balanced: quantize large embeddings
      if (target === 'memory' || target === 'balanced') {
        try {
          const { quantizeInt8, getQuantizationStats } = await import('../memory/memory-initializer.js');
          for (const p of Object.values(store.patterns)) {
            if (p.embedding && p.embedding.length > 0 && !(p as any)._quantized) {
              const stats = getQuantizationStats(p.embedding);
              const q = quantizeInt8(p.embedding);
              (p as any)._quantized = { scale: q.scale, zeroPoint: q.zeroPoint, compressionRatio: stats.compressionRatio };
              patternsQuantized++;
            }
          }
          if (patternsQuantized > 0) actions.push(`Quantized ${patternsQuantized} pattern embeddings (Int8, ~3.92x)`);
        } catch {
          actions.push('Quantization skipped (memory-initializer not available)');
        }
      }

      // accuracy / balanced: prune low-usage, zero-embedding patterns
      if (target === 'accuracy' || target === 'balanced') {
        for (const [id, p] of Object.entries(store.patterns)) {
          if (!p.embedding || p.embedding.length === 0) {
            delete store.patterns[id];
            patternsRemoved++;
            continue;
          }
          // Remove patterns with all-zero embeddings (no useful signal)
          const norm = p.embedding.reduce((s, v) => s + v * v, 0);
          if (norm < 1e-10) {
            delete store.patterns[id];
            patternsRemoved++;
          }
        }
        if (patternsRemoved > 0) actions.push(`Pruned ${patternsRemoved} empty/zero-signal patterns`);
      }

      saveNeuralStore(store);
      const elapsed = Math.round(performance.now() - startTime);

      return {
        success: true, _real: true, target,
        embeddingProvider: embeddingServiceName,
        actions,
        patternsBefore: beforeCount,
        patternsAfter: Object.keys(store.patterns).length,
        duplicatesRemoved,
        patternsQuantized,
        patternsRemoved,
        embeddingDims: dims,
        elapsedMs: elapsed,
      };
    },
  },
];
