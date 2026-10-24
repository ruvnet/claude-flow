/**
 * V3 Memory Types
 * Modernized type system for memory management
 * Aligned with AgentDB integration (ADR-006, ADR-009)
 */

import type { IMemoryEntry, MemoryType, IVectorSearchParams, IVectorSearchResult } from '../core/interfaces/memory.interface.js';

/**
 * Memory backend type
 */
export type MemoryBackendType = 'sqlite' | 'agentdb' | 'hybrid' | 'redis' | 'memory';

/**
 * Memory backend configuration
 */
export interface MemoryBackendConfig {
  type: MemoryBackendType;
  path?: string;
  maxSize?: number;
  ttlMs?: number;

  // SQLite specific
  sqlite?: {
    filename?: string;
    inMemory?: boolean;
    wal?: boolean;
  };

  // AgentDB specific (vector storage)
  agentdb?: {
    dimensions?: number;
    indexType?: 'hnsw' | 'flat' | 'ivf';
    efConstruction?: number;
    m?: number;
    quantization?: 'none' | 'scalar' | 'product';
  };

  // Redis specific
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };

  // Hybrid (SQLite + AgentDB)
  hybrid?: {
    sqliteConfig?: MemoryBackendConfig['sqlite'];
    agentdbConfig?: MemoryBackendConfig['agentdb'];
    vectorThreshold?: number;
  };
}

/**
 * Memory store options
 */
export interface MemoryStoreOptions {
  ttlMs?: number;
  type?: MemoryType;
  tags?: string[];
  embedding?: number[];
  overwrite?: boolean;
}

/**
 * Memory retrieve options
 */
export interface MemoryRetrieveOptions {
  includeExpired?: boolean;
  updateAccessTime?: boolean;
}

/**
 * Memory list options
 */
export interface MemoryListOptions {
  type?: MemoryType;
  tags?: string[];
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'key';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Memory search options (for vector search)
 */
export interface MemorySearchOptions extends IVectorSearchParams {
  includeMetadata?: boolean;
  rerank?: boolean;
  rerankModel?: string;
}

/**
 * Memory batch operation
 */
export interface MemoryBatchOperation {
  operation: 'store' | 'update' | 'delete';
  key: string;
  value?: unknown;
  options?: MemoryStoreOptions;
}

/**
 * Memory batch result
 */
export interface MemoryBatchResult {
  successful: string[];
  failed: Array<{ key: string; error: Error }>;
  duration: number;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalEntries: number;
  totalSizeBytes: number;
  memoryUsageMb: number;
  entriesByType: Record<MemoryType, number>;
  oldestEntry?: Date;
  newestEntry?: Date;
  avgEntrySize: number;
  cacheHitRate?: number;
  vectorCount?: number;
  indexSize?: number;
}

/**
 * Memory bank statistics
 */
export interface MemoryBankStats {
  bankId: string;
  agentId: string;
  entryCount: number;
  sizeMb: number;
  createdAt: Date;
  lastAccess: Date;
}

/**
 * Pattern for ReasoningBank integration
 */
export interface LearnedPattern {
  id: string;
  sessionId: string;
  task: string;
  input: string;
  output: string;
  reward: number;
  success: boolean;
  critique?: string;
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: Date;
  embedding?: number[];
}

/**
 * Pattern search result
 */
export interface PatternSearchResult {
  pattern: LearnedPattern;
  score: number;
  relevance: number;
}

/**
 * Memory event payloads
 */
export interface MemoryEventPayloads {
  'memory:stored': {
    entry: IMemoryEntry;
    isNew: boolean;
  };
  'memory:retrieved': {
    key: string;
    found: boolean;
    latencyMs: number;
  };
  'memory:updated': {
    entry: IMemoryEntry;
    previousValue: unknown;
  };
  'memory:deleted': {
    key: string;
    entry: IMemoryEntry;
  };
  'memory:cleared': {
    entriesRemoved: number;
  };
  'memory:pruned': {
    entriesRemoved: number;
    durationMs: number;
  };
  'memory:search:completed': {
    query: IVectorSearchParams;
    resultCount: number;
    latencyMs: number;
  };
  'memory:bank:created': {
    bankId: string;
    agentId: string;
  };
  'memory:bank:closed': {
    bankId: string;
    agentId: string;
    entriesCount: number;
  };
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  maxSize: number;
  ttlMs: number;
  strategy: 'lru' | 'lfu' | 'fifo';
  warmupKeys?: string[];
}

/**
 * Vector index configuration
 */
export interface VectorIndexConfig {
  type: 'hnsw' | 'flat' | 'ivf';
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot';

  // HNSW specific (150x faster search)
  hnsw?: {
    m: number;
    efConstruction: number;
    efSearch: number;
  };

  // IVF specific
  ivf?: {
    nlist: number;
    nprobe: number;
  };

  // Quantization (4-32x memory reduction)
  quantization?: {
    enabled: boolean;
    bits: 4 | 8 | 16;
    type: 'scalar' | 'product';
  };
}

/**
 * Flash Attention configuration (2.49x-7.47x speedup)
 */
export interface FlashAttentionConfig {
  enabled: boolean;
  blockSize: number;
  headDim: number;
  causal: boolean;
  softmaxScale?: number;
}
