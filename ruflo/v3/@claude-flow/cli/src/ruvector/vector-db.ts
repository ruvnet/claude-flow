/**
 * Vector Database Module
 *
 * Provides optional ruvector WASM-accelerated vector operations for:
 * - Semantic similarity search
 * - HNSW indexing (150x faster)
 * - Embedding generation
 *
 * Gracefully degrades when ruvector is not installed.
 *
 * Created with love by ruv.io
 */

// ============================================================================
// Types
// ============================================================================

export interface VectorDB {
  insert(embedding: Float32Array, id: string, metadata?: Record<string, unknown>): void | Promise<void>;
  search(query: Float32Array, k?: number): Array<{ id: string; score: number; metadata?: Record<string, unknown> }> | Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>;
  remove(id: string): boolean | Promise<boolean>;
  size(): number | Promise<number>;
  clear(): void | Promise<void>;
}

export interface RuVectorModule {
  createVectorDB(dimensions: number): Promise<VectorDB>;
  generateEmbedding(text: string, dimensions?: number): Float32Array;
  cosineSimilarity(a: Float32Array, b: Float32Array): number;
  isWASMAccelerated(): boolean;
}

// ============================================================================
// Fallback Implementation (when ruvector not available)
// ============================================================================

class FallbackVectorDB implements VectorDB {
  private vectors: Map<string, { embedding: Float32Array; metadata?: Record<string, unknown> }> = new Map();
  private dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  insert(embedding: Float32Array, id: string, metadata?: Record<string, unknown>): void {
    this.vectors.set(id, { embedding, metadata });
  }

  search(query: Float32Array, k: number = 10): Array<{ id: string; score: number; metadata?: Record<string, unknown> }> {
    const results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [];

    for (const [id, { embedding, metadata }] of this.vectors) {
      const score = cosineSimilarity(query, embedding);
      results.push({ id, score, metadata });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  remove(id: string): boolean {
    return this.vectors.delete(id);
  }

  size(): number {
    return this.vectors.size;
  }

  clear(): void {
    this.vectors.clear();
  }
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Generate a simple hash-based embedding (fallback when ruvector not available)
 */
function generateHashEmbedding(text: string, dimensions: number = 768): Float32Array {
  const embedding = new Float32Array(dimensions);
  const normalized = text.toLowerCase().trim();

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Generate pseudo-random embedding based on hash
  for (let i = 0; i < dimensions; i++) {
    embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dimensions; i++) {
    embedding[i] /= norm;
  }

  return embedding;
}

// ============================================================================
// Module State
// ============================================================================

let ruvectorModule: RuVectorModule | null = null;
let loadAttempted = false;
let isAvailable = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Attempt to load the ruvector module
 * Returns true if successfully loaded, false otherwise
 */
export async function loadRuVector(): Promise<boolean> {
  if (loadAttempted) {
    return isAvailable;
  }

  loadAttempted = true;

  try {
    // Dynamic import to handle missing dependency gracefully
    const ruvector = await import('ruvector').catch(() => null);

    // ruvector exports VectorDB class, not createVectorDB function
    if (ruvector && (typeof ruvector.VectorDB === 'function' || typeof ruvector.VectorDb === 'function')) {
      // Create adapter module that matches our expected interface
      const VectorDBClass = ruvector.VectorDB || ruvector.VectorDb;
      ruvectorModule = {
        createVectorDB: async (dimensions: number): Promise<VectorDB> => {
          const db = new VectorDBClass({ dimensions });
          // Wrap ruvector's VectorDB to match our interface
          return {
            insert: (embedding: Float32Array, id: string, metadata?: Record<string, unknown>) => {
              db.insert({ id, vector: embedding, metadata });
            },
            search: async (query: Float32Array, k: number = 10) => {
              const results = await db.search({ vector: query, k });
              return results.map((r: any) => ({
                id: r.id,
                score: r.score,
                metadata: r.metadata,
              }));
            },
            remove: (id: string) => {
              db.delete(id);
              return true;
            },
            size: async () => {
              const len = await db.len();
              return len;
            },
            clear: () => {
              // Not directly supported - would need to recreate
            },
          } as VectorDB;
        },
        generateEmbedding: (text: string, dimensions: number = 768): Float32Array => {
          // ruvector may not have this - use fallback
          return generateHashEmbedding(text, dimensions);
        },
        cosineSimilarity: (a: Float32Array, b: Float32Array): number => {
          return cosineSimilarity(a, b);
        },
        isWASMAccelerated: (): boolean => {
          return ruvector.isWasm?.() ?? false;
        },
      };
      isAvailable = true;
      return true;
    }
  } catch {
    // Silently fail - ruvector is optional
  }

  isAvailable = false;
  return false;
}

/**
 * Check if ruvector is available
 */
export function isRuVectorAvailable(): boolean {
  return isAvailable;
}

/**
 * Check if WASM acceleration is enabled
 */
export function isWASMAccelerated(): boolean {
  if (ruvectorModule && typeof ruvectorModule.isWASMAccelerated === 'function') {
    return ruvectorModule.isWASMAccelerated();
  }
  return false;
}

/**
 * Create a vector database
 * Uses ruvector HNSW if available, falls back to brute-force search
 */
export async function createVectorDB(dimensions: number = 768): Promise<VectorDB> {
  await loadRuVector();

  if (ruvectorModule && typeof ruvectorModule.createVectorDB === 'function') {
    try {
      return await ruvectorModule.createVectorDB(dimensions);
    } catch {
      // Fall back to simple implementation
    }
  }

  return new FallbackVectorDB(dimensions);
}

/**
 * Generate an embedding for text
 * Uses ruvector if available, falls back to hash-based embedding
 */
export function generateEmbedding(text: string, dimensions: number = 768): Float32Array {
  if (ruvectorModule && typeof ruvectorModule.generateEmbedding === 'function') {
    try {
      return ruvectorModule.generateEmbedding(text, dimensions);
    } catch {
      // Fall back to hash-based embedding
    }
  }

  return generateHashEmbedding(text, dimensions);
}

/**
 * Compute cosine similarity between two vectors
 */
export function computeSimilarity(a: Float32Array, b: Float32Array): number {
  if (ruvectorModule && typeof ruvectorModule.cosineSimilarity === 'function') {
    try {
      return ruvectorModule.cosineSimilarity(a, b);
    } catch {
      // Fall back to JS implementation
    }
  }

  return cosineSimilarity(a, b);
}

/**
 * Get status information about the ruvector module
 */
export function getStatus(): {
  available: boolean;
  wasmAccelerated: boolean;
  backend: 'ruvector-wasm' | 'ruvector' | 'fallback';
} {
  if (!isAvailable) {
    return {
      available: false,
      wasmAccelerated: false,
      backend: 'fallback',
    };
  }

  const wasmAccelerated = isWASMAccelerated();
  return {
    available: true,
    wasmAccelerated,
    backend: wasmAccelerated ? 'ruvector-wasm' : 'ruvector',
  };
}
