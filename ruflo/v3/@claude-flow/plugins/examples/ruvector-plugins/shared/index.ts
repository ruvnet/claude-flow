/**
 * Shared utilities for RuVector plugins
 */

export {
  // Interfaces
  IVectorDB,
  ILoRAEngine,
  LoRAAdapter,
  // Fallback implementations
  FallbackVectorDB,
  FallbackLoRAEngine,
  // Factory functions
  createVectorDB,
  createLoRAEngine,
  // Utilities
  cosineSimilarity,
  generateHashEmbedding,
  LazyInitializable,
} from './vector-utils.js';
