/**
 * V3 Embedding Service Module
 *
 * Production embedding service aligned with agentic-flow@alpha:
 * - OpenAI provider (text-embedding-3-small/large)
 * - Transformers.js provider (local ONNX models)
 * - Agentic-flow provider (optimized ONNX with SIMD)
 * - Mock provider (development/testing)
 *
 * Additional features:
 * - Persistent SQLite cache
 * - Document chunking with overlap
 * - L2/L1/minmax/zscore normalization
 * - Hyperbolic embeddings (Poincaré ball)
 * - Neural substrate integration (drift, memory, swarm)
 *
 * @module @claude-flow/embeddings
 */

export * from './types.js';
export * from './embedding-service.js';

// Re-export commonly used items at top level
export {
  createEmbeddingService,
  createEmbeddingServiceAsync,
  getEmbedding,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  computeSimilarity,
  OpenAIEmbeddingService,
  TransformersEmbeddingService,
  MockEmbeddingService,
  AgenticFlowEmbeddingService,
} from './embedding-service.js';

export type { AutoEmbeddingConfig } from './embedding-service.js';

// Chunking utilities
export {
  chunkText,
  estimateTokens,
  reconstructFromChunks,
  type ChunkingConfig,
  type Chunk,
  type ChunkedDocument,
} from './chunking.js';

// Normalization utilities
export {
  l2Normalize,
  l2NormalizeInPlace,
  l1Normalize,
  minMaxNormalize,
  zScoreNormalize,
  normalize,
  normalizeBatch,
  l2Norm,
  isNormalized,
  centerEmbeddings,
  type NormalizationOptions,
} from './normalization.js';

// Hyperbolic embeddings (Poincaré ball)
export {
  euclideanToPoincare,
  poincareToEuclidean,
  hyperbolicDistance,
  mobiusAdd,
  mobiusScalarMul,
  hyperbolicCentroid,
  batchEuclideanToPoincare,
  pairwiseHyperbolicDistances,
  isInPoincareBall,
  type HyperbolicConfig,
} from './hyperbolic.js';

// Persistent cache
export {
  PersistentEmbeddingCache,
  isPersistentCacheAvailable,
  type PersistentCacheConfig as DiskCacheConfig,
  type PersistentCacheStats,
} from './persistent-cache.js';

// Neural substrate integration
export {
  NeuralEmbeddingService,
  createNeuralService,
  isNeuralAvailable,
  listEmbeddingModels,
  downloadEmbeddingModel,
  type DriftResult,
  type MemoryEntry,
  type AgentState,
  type CoherenceResult,
  type SubstrateHealth,
  type NeuralSubstrateConfig,
} from './neural-integration.js';

export type {
  EmbeddingProvider,
  EmbeddingConfig,
  OpenAIEmbeddingConfig,
  TransformersEmbeddingConfig,
  MockEmbeddingConfig,
  AgenticFlowEmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  IEmbeddingService,
  SimilarityMetric,
  SimilarityResult,
  NormalizationType,
  PersistentCacheConfig,
} from './types.js';
