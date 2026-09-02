/**
 * V3 Embedding Service Types
 *
 * Type definitions for embedding service aligned with agentic-flow@alpha:
 * - OpenAI provider
 * - Transformers.js provider
 * - Mock provider
 *
 * Performance Targets:
 * - Single embedding: <100ms (API), <50ms (local)
 * - Batch embedding: <500ms for 10 items
 * - Cache hit: <1ms
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported embedding providers
 */
export type EmbeddingProvider = 'openai' | 'transformers' | 'mock' | 'agentic-flow';

/**
 * Normalization type for embeddings
 */
export type NormalizationType = 'l2' | 'l1' | 'minmax' | 'zscore' | 'none';

/**
 * Persistent cache configuration
 */
export interface PersistentCacheConfig {
  /** Enable persistent disk cache (requires better-sqlite3) */
  enabled: boolean;
  /** Path to SQLite database file (default: .cache/embeddings.db) */
  dbPath?: string;
  /** Maximum entries in persistent cache (default: 10000) */
  maxSize?: number;
  /** TTL in milliseconds (default: 7 days) */
  ttlMs?: number;
}

/**
 * Base configuration for all providers
 */
export interface EmbeddingBaseConfig {
  /** Provider identifier */
  provider: EmbeddingProvider;

  /** Embedding dimensions */
  dimensions?: number;

  /** Cache size (number of embeddings) */
  cacheSize?: number;

  /** Enable caching */
  enableCache?: boolean;

  /** Normalization type (default: 'none' - most providers pre-normalize) */
  normalization?: NormalizationType;

  /** Persistent disk cache configuration */
  persistentCache?: PersistentCacheConfig;
}

/**
 * OpenAI provider configuration
 */
export interface OpenAIEmbeddingConfig extends EmbeddingBaseConfig {
  provider: 'openai';

  /** OpenAI API key */
  apiKey: string;

  /** Model to use */
  model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';

  /** Target dimensions (for text-embedding-3-* models) */
  dimensions?: number;

  /** Base URL override */
  baseURL?: string;

  /** Request timeout in ms */
  timeout?: number;

  /** Max retries */
  maxRetries?: number;
}

/**
 * Transformers.js provider configuration
 */
export interface TransformersEmbeddingConfig extends EmbeddingBaseConfig {
  provider: 'transformers';

  /** Model name from Hugging Face */
  model?: string;

  /** Quantization level */
  quantized?: boolean;

  /** Use web worker */
  useWorker?: boolean;
}

/**
 * Mock provider configuration
 */
export interface MockEmbeddingConfig extends EmbeddingBaseConfig {
  provider: 'mock';

  /** Output dimensions */
  dimensions?: number;

  /** Simulated latency in ms */
  simulatedLatency?: number;
}

/**
 * Agentic-flow provider configuration
 * Uses optimized ONNX embeddings with:
 * - Float32Array with flattened matrices
 * - 256-entry LRU cache with FNV-1a hash
 * - SIMD-friendly loop unrolling (4x)
 * - Pre-allocated buffers (no GC pressure)
 */
export interface AgenticFlowEmbeddingConfig extends EmbeddingBaseConfig {
  provider: 'agentic-flow';

  /** Model ID (default: all-MiniLM-L6-v2) */
  modelId?: string;

  /** Embedding dimensions (default: 384) */
  dimensions?: number;

  /** Internal cache size for embedder (default: 256) */
  embedderCacheSize?: number;

  /** Model directory path */
  modelDir?: string;

  /** Auto-download model if not present */
  autoDownload?: boolean;
}

/**
 * Union of all provider configs
 */
export type EmbeddingConfig =
  | OpenAIEmbeddingConfig
  | TransformersEmbeddingConfig
  | MockEmbeddingConfig
  | AgenticFlowEmbeddingConfig;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Single embedding result
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: Float32Array | number[];

  /** Latency in milliseconds */
  latencyMs: number;

  /** Token usage (for API providers) */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };

  /** Whether result was from cache */
  cached?: boolean;

  /** Whether result was from persistent cache */
  persistentCached?: boolean;

  /** Whether embedding was normalized */
  normalized?: boolean;
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
  /** Array of embeddings */
  embeddings: Array<Float32Array | number[]>;

  /** Total latency in milliseconds */
  totalLatencyMs: number;

  /** Average latency per embedding */
  avgLatencyMs: number;

  /** Token usage (for API providers) */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };

  /** Cache statistics */
  cacheStats?: {
    hits: number;
    misses: number;
  };
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Embedding service interface
 */
export interface IEmbeddingService {
  /** Provider identifier */
  readonly provider: EmbeddingProvider;

  /** Get embedding for single text */
  embed(text: string): Promise<EmbeddingResult>;

  /** Get embeddings for multiple texts */
  embedBatch(texts: string[]): Promise<BatchEmbeddingResult>;

  /** Clear cache */
  clearCache(): void;

  /** Get cache statistics */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  };

  /** Shutdown service */
  shutdown(): Promise<void>;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Embedding service events
 */
export type EmbeddingEvent =
  | { type: 'embed_start'; text: string }
  | { type: 'embed_complete'; text: string; latencyMs: number }
  | { type: 'embed_error'; text: string; error: string }
  | { type: 'batch_start'; count: number }
  | { type: 'batch_complete'; count: number; latencyMs: number }
  | { type: 'cache_hit'; text: string }
  | { type: 'cache_eviction'; size: number };

/**
 * Event listener type
 */
export type EmbeddingEventListener = (event: EmbeddingEvent) => void | Promise<void>;

// ============================================================================
// Similarity Functions
// ============================================================================

/**
 * Similarity metric type
 */
export type SimilarityMetric = 'cosine' | 'euclidean' | 'dot';

/**
 * Similarity result
 */
export interface SimilarityResult {
  /** Similarity score (0-1 for cosine, unbounded for others) */
  score: number;

  /** Metric used */
  metric: SimilarityMetric;
}
