/**
 * V3 Unified Memory Types
 *
 * Type definitions for the unified memory system based on AgentDB with HNSW indexing.
 * Supports 150x-12,500x faster vector search compared to brute-force approaches.
 *
 * @module v3/memory/types
 */

// ===== Core Memory Entry Types =====

/**
 * Memory entry type classification
 */
export type MemoryType =
  | 'episodic'    // Time-based experiences and events
  | 'semantic'    // Facts, concepts, and knowledge
  | 'procedural'  // How-to knowledge and skills
  | 'working'     // Short-term operational memory
  | 'cache';      // Temporary cached data

/**
 * Access level for memory entries
 */
export type AccessLevel =
  | 'private'     // Only owner can access
  | 'team'        // Team members can access
  | 'swarm'       // All swarm agents can access
  | 'public'      // Publicly accessible
  | 'system';     // System-level access

/**
 * Consistency level for distributed memory operations
 */
export type ConsistencyLevel =
  | 'strong'      // Strong consistency (all nodes agree)
  | 'eventual'    // Eventual consistency (propagates over time)
  | 'session'     // Session-scoped consistency
  | 'weak';       // Weak consistency (best effort)

/**
 * Distance metrics for vector similarity search
 */
export type DistanceMetric =
  | 'cosine'      // Cosine similarity (default)
  | 'euclidean'   // Euclidean distance (L2)
  | 'dot'         // Dot product
  | 'manhattan';  // Manhattan distance (L1)

// ===== Memory Entry =====

/**
 * Core memory entry structure with vector embedding support
 */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;

  /** Human-readable key for retrieval */
  key: string;

  /** Actual content of the memory */
  content: string;

  /** Vector embedding for semantic search (Float32Array for efficiency) */
  embedding?: Float32Array;

  /** Type of memory */
  type: MemoryType;

  /** Namespace for organization */
  namespace: string;

  /** Tags for categorization and filtering */
  tags: string[];

  /** Additional metadata */
  metadata: Record<string, unknown>;

  /** Owner agent ID */
  ownerId?: string;

  /** Access level */
  accessLevel: AccessLevel;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;

  /** Expiration timestamp (optional) */
  expiresAt?: number;

  /** Version number for optimistic locking */
  version: number;

  /** References to other memory entries */
  references: string[];

  /** Access count for usage tracking */
  accessCount: number;

  /** Last access timestamp */
  lastAccessedAt: number;
}

/**
 * Input for creating a new memory entry
 */
export interface MemoryEntryInput {
  key: string;
  content: string;
  type?: MemoryType;
  namespace?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ownerId?: string;
  accessLevel?: AccessLevel;
  expiresAt?: number;
  references?: string[];
}

/**
 * Partial update for a memory entry
 */
export interface MemoryEntryUpdate {
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  accessLevel?: AccessLevel;
  expiresAt?: number;
  references?: string[];
}

// ===== Query Types =====

/**
 * Query type for memory retrieval
 */
export type QueryType =
  | 'semantic'    // Vector similarity search
  | 'exact'       // Exact key match
  | 'prefix'      // Key prefix match
  | 'tag'         // Tag-based search
  | 'hybrid';     // Combined semantic + filters

/**
 * Memory query specification
 */
export interface MemoryQuery {
  /** Type of query to perform */
  type: QueryType;

  /** Content for semantic search (will be embedded) */
  content?: string;

  /** Pre-computed embedding for semantic search */
  embedding?: Float32Array;

  /** Exact key to match */
  key?: string;

  /** Key prefix to match */
  keyPrefix?: string;

  /** Namespace filter */
  namespace?: string;

  /** Tag filters (entries must have all specified tags) */
  tags?: string[];

  /** Memory type filter */
  memoryType?: MemoryType;

  /** Access level filter */
  accessLevel?: AccessLevel;

  /** Owner filter */
  ownerId?: string;

  /** Metadata filters */
  metadata?: Record<string, unknown>;

  /** Time range filters */
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;

  /** Maximum number of results */
  limit: number;

  /** Offset for pagination */
  offset?: number;

  /** Minimum similarity threshold (0-1) for semantic search */
  threshold?: number;

  /** Include expired entries */
  includeExpired?: boolean;

  /** Distance metric for semantic search */
  distanceMetric?: DistanceMetric;
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  /** The memory entry */
  entry: MemoryEntry;

  /** Similarity score (0-1, higher is better) */
  score: number;

  /** Distance from query vector */
  distance: number;
}

/**
 * Search options for HNSW vector search
 */
export interface SearchOptions {
  /** Number of results to return */
  k: number;

  /** Search expansion factor (higher = more accurate, slower) */
  ef?: number;

  /** Minimum similarity threshold (0-1) */
  threshold?: number;

  /** Distance metric */
  metric?: DistanceMetric;

  /** Additional filters to apply post-search */
  filters?: MemoryQuery;
}

// ===== HNSW Index Types =====

/**
 * HNSW index configuration
 */
export interface HNSWConfig {
  /** Vector dimensions (e.g., 1536 for OpenAI embeddings) */
  dimensions: number;

  /** Maximum number of connections per layer (default: 16) */
  M: number;

  /** Size of the dynamic candidate list during construction (default: 200) */
  efConstruction: number;

  /** Maximum elements the index can hold */
  maxElements: number;

  /** Distance metric */
  metric: DistanceMetric;

  /** Enable quantization for memory efficiency */
  quantization?: QuantizationConfig;
}

/**
 * Quantization configuration for memory reduction
 */
export interface QuantizationConfig {
  /** Quantization type */
  type: 'binary' | 'scalar' | 'product';

  /** Number of bits for scalar quantization */
  bits?: 4 | 8 | 16;

  /** Number of subquantizers for product quantization */
  subquantizers?: number;

  /** Codebook size for product quantization */
  codebookSize?: number;
}

/**
 * HNSW index statistics
 */
export interface HNSWStats {
  /** Total number of vectors in the index */
  vectorCount: number;

  /** Memory usage in bytes */
  memoryUsage: number;

  /** Average search time in milliseconds */
  avgSearchTime: number;

  /** Index build time in milliseconds */
  buildTime: number;

  /** Compression ratio if quantization is enabled */
  compressionRatio?: number;
}

// ===== Backend Interface =====

/**
 * Memory backend interface for storage and retrieval
 */
export interface IMemoryBackend {
  /** Initialize the backend */
  initialize(): Promise<void>;

  /** Shutdown the backend */
  shutdown(): Promise<void>;

  /** Store a memory entry */
  store(entry: MemoryEntry): Promise<void>;

  /** Retrieve a memory entry by ID */
  get(id: string): Promise<MemoryEntry | null>;

  /** Retrieve a memory entry by key within a namespace */
  getByKey(namespace: string, key: string): Promise<MemoryEntry | null>;

  /** Update a memory entry */
  update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null>;

  /** Delete a memory entry */
  delete(id: string): Promise<boolean>;

  /** Query memory entries */
  query(query: MemoryQuery): Promise<MemoryEntry[]>;

  /** Semantic vector search */
  search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]>;

  /** Bulk insert entries */
  bulkInsert(entries: MemoryEntry[]): Promise<void>;

  /** Bulk delete entries */
  bulkDelete(ids: string[]): Promise<number>;

  /** Get entry count */
  count(namespace?: string): Promise<number>;

  /** List all namespaces */
  listNamespaces(): Promise<string[]>;

  /** Clear all entries in a namespace */
  clearNamespace(namespace: string): Promise<number>;

  /** Get backend statistics */
  getStats(): Promise<BackendStats>;

  /** Perform health check */
  healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Backend statistics
 */
export interface BackendStats {
  /** Total number of entries */
  totalEntries: number;

  /** Entries by namespace */
  entriesByNamespace: Record<string, number>;

  /** Entries by type */
  entriesByType: Record<MemoryType, number>;

  /** Total memory usage in bytes */
  memoryUsage: number;

  /** HNSW index statistics */
  hnswStats?: HNSWStats;

  /** Cache statistics */
  cacheStats?: CacheStats;

  /** Average query time in milliseconds */
  avgQueryTime: number;

  /** Average search time in milliseconds */
  avgSearchTime: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Individual component health */
  components: {
    storage: ComponentHealth;
    index: ComponentHealth;
    cache: ComponentHealth;
  };

  /** Health check timestamp */
  timestamp: number;

  /** Any issues detected */
  issues: string[];

  /** Recommendations for improvement */
  recommendations: string[];
}

/**
 * Individual component health status
 */
export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  message?: string;
}

// ===== Cache Types =====

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Maximum number of entries in the cache */
  maxSize: number;

  /** Default TTL in milliseconds */
  ttl: number;

  /** Enable LRU eviction */
  lruEnabled: boolean;

  /** Maximum memory usage in bytes */
  maxMemory?: number;

  /** Enable write-through caching */
  writeThrough: boolean;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of entries in cache */
  size: number;

  /** Cache hit rate (0-1) */
  hitRate: number;

  /** Total cache hits */
  hits: number;

  /** Total cache misses */
  misses: number;

  /** Total evictions */
  evictions: number;

  /** Memory usage in bytes */
  memoryUsage: number;
}

/**
 * Cached entry wrapper
 */
export interface CachedEntry<T> {
  /** The cached data */
  data: T;

  /** When the entry was cached */
  cachedAt: number;

  /** When the entry expires */
  expiresAt: number;

  /** Last access timestamp */
  lastAccessedAt: number;

  /** Access count */
  accessCount: number;
}

// ===== Migration Types =====

/**
 * Migration source type
 */
export type MigrationSource =
  | 'sqlite'
  | 'markdown'
  | 'json'
  | 'memory-manager'
  | 'swarm-memory'
  | 'distributed-memory';

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /** Source backend type */
  source: MigrationSource;

  /** Source path or connection string */
  sourcePath: string;

  /** Batch size for migration */
  batchSize: number;

  /** Generate embeddings during migration */
  generateEmbeddings: boolean;

  /** Validate data during migration */
  validateData: boolean;

  /** Continue on error */
  continueOnError: boolean;

  /** Namespace mapping */
  namespaceMapping?: Record<string, string>;

  /** Type mapping */
  typeMapping?: Record<string, MemoryType>;

  /**
   * Max concurrent single-entry embedding calls per migration batch when
   * no batch embedding generator is available (default: 8). Set to 1 to
   * restore fully sequential embedding.
   */
  embeddingConcurrency?: number;
}

/**
 * Migration progress
 */
export interface MigrationProgress {
  /** Total entries to migrate */
  total: number;

  /** Entries migrated so far */
  migrated: number;

  /** Entries failed */
  failed: number;

  /** Entries skipped */
  skipped: number;

  /** Current batch number */
  currentBatch: number;

  /** Total batches */
  totalBatches: number;

  /** Progress percentage (0-100) */
  percentage: number;

  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining: number;

  /** Errors encountered */
  errors: MigrationError[];
}

/**
 * Migration error
 */
export interface MigrationError {
  /** Entry ID or key that failed */
  entryId: string;

  /** Error message */
  message: string;

  /** Error code */
  code: string;

  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Whether migration completed successfully */
  success: boolean;

  /** Final progress state */
  progress: MigrationProgress;

  /** Total time taken in milliseconds */
  duration: number;

  /** Summary message */
  summary: string;
}

// ===== Event Types =====

/**
 * Memory event types
 */
export type MemoryEventType =
  | 'entry:created'
  | 'entry:updated'
  | 'entry:deleted'
  | 'entry:accessed'
  | 'entry:expired'
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:eviction'
  | 'index:rebuilt'
  | 'migration:started'
  | 'migration:progress'
  | 'migration:completed'
  | 'migration:failed';

/**
 * Memory event payload
 */
export interface MemoryEvent {
  type: MemoryEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Memory event handler
 */
export type MemoryEventHandler = (event: MemoryEvent) => void | Promise<void>;

// ===== SONA Integration Types =====

/**
 * SONA learning mode for adaptive memory
 */
export type SONAMode =
  | 'real-time'   // <0.05ms adaptation
  | 'balanced'    // Balance between speed and accuracy
  | 'research'    // Maximum accuracy, slower
  | 'edge'        // Optimized for edge devices
  | 'batch';      // Batch processing mode

/**
 * Learning pattern from SONA integration
 */
export interface LearningPattern {
  /** Pattern ID */
  id: string;

  /** Pattern data */
  data: Record<string, unknown>;

  /** SONA mode used */
  mode: SONAMode;

  /** Reward signal */
  reward: number;

  /** Trajectory data */
  trajectory: unknown[];

  /** Adaptation time in milliseconds */
  adaptationTime: number;

  /** Creation timestamp */
  createdAt: number;
}

// ===== Utility Types =====

/**
 * Embedding generator function type
 */
export type EmbeddingGenerator = (content: string) => Promise<Float32Array>;

/**
 * Batch embedding generator function type.
 *
 * Implementations that can run a single padded forward pass over many
 * texts (e.g. transformers.js `tokenizer(texts[])` + one model call)
 * should be exposed through this type — it is dramatically cheaper than
 * N sequential single-text inferences in import/migration hot paths.
 *
 * Contract: MUST return one embedding per input text, in input order.
 */
export type BatchEmbeddingGenerator = (contents: string[]) => Promise<Float32Array[]>;

/**
 * Generates a unique memory ID
 */
export function generateMemoryId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `mem_${timestamp}_${random}`;
}

/**
 * Creates a default memory entry
 */
export function createDefaultEntry(input: MemoryEntryInput): MemoryEntry {
  const now = Date.now();
  return {
    id: generateMemoryId(),
    key: input.key,
    content: input.content,
    type: input.type || 'semantic',
    namespace: input.namespace || 'default',
    tags: input.tags || [],
    metadata: input.metadata || {},
    ownerId: input.ownerId,
    accessLevel: input.accessLevel || 'private',
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
    version: 1,
    references: input.references || [],
    accessCount: 0,
    lastAccessedAt: now,
  };
}

/**
 * Performance targets for V3 memory system
 */
export const PERFORMANCE_TARGETS = {
  /** Maximum vector search time for 100k vectors */
  MAX_SEARCH_TIME_100K: 1, // ms

  /** Maximum write time per entry */
  MAX_WRITE_TIME: 5, // ms

  /** Maximum batch insert time per entry */
  MAX_BATCH_INSERT_TIME: 1, // ms

  /** Target memory reduction from legacy systems */
  MEMORY_REDUCTION_TARGET: 0.5, // 50%

  /** Minimum search improvement over brute force */
  MIN_SEARCH_IMPROVEMENT: 150, // 150x

  /** Maximum search improvement over brute force */
  MAX_SEARCH_IMPROVEMENT: 12500, // 12,500x
} as const;

// ===== Re-exports from ADR-049 modules =====

export type {
  LearningBridgeConfig,
  LearningStats,
  ConsolidateResult,
  PatternMatch,
} from './learning-bridge.js';

export type {
  MemoryGraphConfig,
  GraphNode,
  GraphEdge,
  GraphStats,
  RankedResult,
  EdgeType,
} from './memory-graph.js';

export type {
  AgentMemoryScope,
  AgentScopedConfig,
  TransferOptions,
  TransferResult,
} from './agent-memory-scope.js';
