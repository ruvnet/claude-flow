/**
 * Shared Vector Database Utilities
 *
 * Consolidated implementations for all RuVector plugins.
 */

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Vector database interface for HNSW operations
 */
export interface IVectorDB {
  insert(vector: Float32Array, id: string, metadata?: Record<string, unknown>): string;
  search(query: Float32Array, k: number, filter?: Record<string, unknown>): Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  get?(id: string): { vector: Float32Array; metadata: Record<string, unknown> } | null;
  delete(id: string): boolean;
  size(): number;
}

/**
 * LoRA engine interface for neural adaptation
 */
export interface ILoRAEngine {
  createAdapter(category: string, rank: number): Promise<LoRAAdapter>;
  updateAdapter(adapterId: string, gradient: Float32Array, learningRate: number): Promise<void>;
  applyEWC?(adapterId: string, lambda: number): Promise<void>;
  computeGradient(input: Float32Array, target: Float32Array): Float32Array;
}

export interface LoRAAdapter {
  id: string;
  category: string;
  rank: number;
  alpha: number;
}

// ============================================================================
// Fallback Implementations
// ============================================================================

/**
 * Fallback vector database when @ruvector/wasm is not available.
 * Uses in-memory Map with brute-force cosine similarity search.
 */
export class FallbackVectorDB implements IVectorDB {
  private vectors = new Map<string, { vector: Float32Array; metadata: Record<string, unknown> }>();

  constructor(private dimensions: number) {}

  insert(vector: Float32Array, id: string, metadata: Record<string, unknown> = {}): string {
    this.vectors.set(id, { vector, metadata });
    return id;
  }

  search(query: Float32Array, k: number): Array<{ id: string; score: number; metadata?: Record<string, unknown> }> {
    const results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [];

    for (const [id, entry] of this.vectors) {
      const score = cosineSimilarity(query, entry.vector);
      results.push({ id, score, metadata: entry.metadata });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, k);
  }

  get(id: string): { vector: Float32Array; metadata: Record<string, unknown> } | null {
    return this.vectors.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.vectors.delete(id);
  }

  size(): number {
    return this.vectors.size;
  }
}

/**
 * Fallback LoRA engine when @ruvector/learning-wasm is not available.
 * Uses simple gradient descent with in-memory weights.
 */
export class FallbackLoRAEngine implements ILoRAEngine {
  private adapters = new Map<string, LoRAAdapter>();
  private adapterWeights = new Map<string, Float32Array>();
  private nextId = 1;

  async createAdapter(category: string, rank: number): Promise<LoRAAdapter> {
    const adapter: LoRAAdapter = {
      id: `adapter-${this.nextId++}`,
      category,
      rank,
      alpha: 16,
    };
    this.adapters.set(adapter.id, adapter);
    this.adapterWeights.set(adapter.id, new Float32Array(rank * 768));
    return adapter;
  }

  async updateAdapter(adapterId: string, gradient: Float32Array, learningRate: number): Promise<void> {
    const weights = this.adapterWeights.get(adapterId);
    if (weights) {
      const len = Math.min(weights.length, gradient.length);
      for (let i = 0; i < len; i++) {
        weights[i] -= learningRate * gradient[i];
      }
    }
  }

  async applyEWC(adapterId: string, lambda: number): Promise<void> {
    const weights = this.adapterWeights.get(adapterId);
    if (weights) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] *= 1 - lambda * 0.01;
      }
    }
  }

  computeGradient(input: Float32Array, target: Float32Array): Float32Array {
    const gradient = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      gradient[i] = (input[i] - (target[i] || 0)) * 0.01;
    }
    return gradient;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a vector database - uses @ruvector/wasm in production, fallback otherwise.
 */
export async function createVectorDB(dimensions: number): Promise<IVectorDB> {
  try {
    // @ts-expect-error - @ruvector/wasm types may not be available
    const { VectorDB: RuVectorDB } = await import('@ruvector/wasm');
    const db = new RuVectorDB({
      dimensions,
      indexType: 'hnsw',
      metric: 'cosine',
      efConstruction: 200,
      m: 16,
    });
    await db.initialize?.();
    return db as IVectorDB;
  } catch {
    console.warn('[@claude-flow/plugins] @ruvector/wasm not available, using fallback');
    return new FallbackVectorDB(dimensions);
  }
}

/**
 * Create a LoRA engine - uses @ruvector/learning-wasm in production, fallback otherwise.
 */
export async function createLoRAEngine(): Promise<ILoRAEngine> {
  try {
    // @ts-expect-error - @ruvector/learning-wasm types may not be available
    const { LoRAEngine } = await import('@ruvector/learning-wasm');
    const engine = new LoRAEngine({ defaultRank: 8, defaultAlpha: 16 });
    await engine.initialize?.();
    return engine as ILoRAEngine;
  } catch {
    console.warn('[@claude-flow/plugins] @ruvector/learning-wasm not available, using fallback');
    return new FallbackLoRAEngine();
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Returns value in range [-1, 1] where 1 = identical.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Generate a simple hash-based embedding for text.
 * Use for fallback when no embedding model is available.
 */
export function generateHashEmbedding(text: string, dimensions: number): Float32Array {
  const embedding = new Float32Array(dimensions);
  const normalized = text.toLowerCase();
  let hash = 0;

  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }

  for (let i = 0; i < dimensions; i++) {
    embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

/**
 * Lazy initialization mixin for async-initialized classes.
 */
export abstract class LazyInitializable {
  protected initPromise: Promise<void> | null = null;
  protected initialized = false;

  abstract doInitialize(): Promise<void>;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.doInitialize();
      this.initialized = true;
    })();

    return this.initPromise;
  }

  protected async ensureInitialized(): Promise<void> {
    await this.initialize();
  }
}
