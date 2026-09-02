/**
 * V3 Memory Interfaces
 * Domain-Driven Design - Memory Management Bounded Context
 * Aligned with ADR-006 (Unified Memory Service) and ADR-009 (Hybrid Memory Backend)
 */

/**
 * Memory entry types
 */
export type MemoryType = 'session' | 'persistent' | 'vector' | 'cache' | 'pattern';

/**
 * Memory entry structure
 */
export interface IMemoryEntry {
  readonly id: string;
  readonly key: string;
  readonly type: MemoryType;
  readonly createdAt: Date;

  value: unknown;
  updatedAt: Date;
  expiresAt?: Date;

  metadata?: {
    source?: string;
    agentId?: string;
    sessionId?: string;
    version?: number;
    tags?: string[];
    embedding?: number[];
    [key: string]: unknown;
  };
}

/**
 * Memory entry creation parameters
 */
export interface IMemoryEntryCreate {
  key: string;
  value: unknown;
  type?: MemoryType;
  expiresAt?: Date;
  ttlMs?: number;
  metadata?: IMemoryEntry['metadata'];
}

/**
 * Vector search parameters
 */
export interface IVectorSearchParams {
  embedding: number[];
  k?: number;
  threshold?: number;
  filter?: {
    type?: MemoryType;
    tags?: string[];
    agentId?: string;
  };
}

/**
 * Vector search result
 */
export interface IVectorSearchResult {
  entry: IMemoryEntry;
  score: number;
  distance: number;
}

/**
 * Memory backend interface for storage operations
 */
export interface IMemoryBackend {
  /**
   * Initialize the backend
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the backend
   */
  shutdown(): Promise<void>;

  /**
   * Store a memory entry
   */
  store(entry: IMemoryEntryCreate): Promise<IMemoryEntry>;

  /**
   * Retrieve a memory entry by key
   */
  retrieve(key: string): Promise<IMemoryEntry | undefined>;

  /**
   * Retrieve by ID
   */
  retrieveById(id: string): Promise<IMemoryEntry | undefined>;

  /**
   * Update a memory entry
   */
  update(key: string, value: unknown, metadata?: Partial<IMemoryEntry['metadata']>): Promise<IMemoryEntry | undefined>;

  /**
   * Delete a memory entry
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * List all keys matching a pattern
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * Get all entries matching filter
   */
  list(filter?: { type?: MemoryType; tags?: string[] }): Promise<IMemoryEntry[]>;

  /**
   * Clear all entries
   */
  clear(): Promise<void>;

  /**
   * Get entry count
   */
  count(): Promise<number>;

  /**
   * Prune expired entries
   */
  prune(): Promise<number>;

  /**
   * Get health status
   */
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;
}

/**
 * Vector memory backend for similarity search
 */
export interface IVectorMemoryBackend extends IMemoryBackend {
  /**
   * Store with embedding
   */
  storeVector(entry: IMemoryEntryCreate & { embedding: number[] }): Promise<IMemoryEntry>;

  /**
   * Search by vector similarity
   */
  search(params: IVectorSearchParams): Promise<IVectorSearchResult[]>;

  /**
   * Update embedding for an entry
   */
  updateEmbedding(key: string, embedding: number[]): Promise<boolean>;

  /**
   * Build or rebuild index
   */
  buildIndex(): Promise<void>;

  /**
   * Get index statistics
   */
  getIndexStats(): Promise<{
    vectorCount: number;
    dimensions: number;
    indexType: string;
    memoryUsageMb: number;
  }>;
}

/**
 * Memory bank for agent-specific storage
 */
export interface IMemoryBank {
  readonly id: string;
  readonly agentId: string;
  readonly createdAt: Date;

  /**
   * Store in bank
   */
  store(key: string, value: unknown, options?: Partial<IMemoryEntryCreate>): Promise<IMemoryEntry>;

  /**
   * Retrieve from bank
   */
  retrieve(key: string): Promise<IMemoryEntry | undefined>;

  /**
   * Delete from bank
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all entries in bank
   */
  list(): Promise<IMemoryEntry[]>;

  /**
   * Clear all entries in bank
   */
  clear(): Promise<void>;

  /**
   * Get bank size
   */
  size(): Promise<number>;

  /**
   * Close the bank
   */
  close(): Promise<void>;
}

/**
 * Memory manager interface
 */
export interface IMemoryManager {
  /**
   * Initialize the manager
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the manager
   */
  shutdown(): Promise<void>;

  /**
   * Create a memory bank for an agent
   */
  createBank(agentId: string): Promise<string>;

  /**
   * Get a memory bank
   */
  getBank(bankId: string): IMemoryBank | undefined;

  /**
   * Close a memory bank
   */
  closeBank(bankId: string): Promise<void>;

  /**
   * Store in global memory
   */
  store(entry: IMemoryEntryCreate): Promise<IMemoryEntry>;

  /**
   * Retrieve from global memory
   */
  retrieve(key: string): Promise<IMemoryEntry | undefined>;

  /**
   * Search vectors (if vector backend available)
   */
  searchVectors?(params: IVectorSearchParams): Promise<IVectorSearchResult[]>;

  /**
   * Perform maintenance
   */
  performMaintenance(): Promise<void>;

  /**
   * Get health status
   */
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;

  /**
   * Get memory usage statistics
   */
  getStats(): Promise<{
    totalEntries: number;
    memoryUsageMb: number;
    banksCount: number;
    cacheHitRate?: number;
  }>;
}

/**
 * Pattern storage for ReasoningBank integration
 */
export interface IPatternStorage {
  /**
   * Store a learned pattern
   */
  storePattern(pattern: {
    sessionId: string;
    task: string;
    input: string;
    output: string;
    reward: number;
    success: boolean;
    critique?: string;
    tokensUsed?: number;
    latencyMs?: number;
  }): Promise<void>;

  /**
   * Search for similar patterns
   */
  searchPatterns(params: {
    task: string;
    k?: number;
    minReward?: number;
    onlyFailures?: boolean;
  }): Promise<Array<{
    task: string;
    reward: number;
    critique: string;
    output: string;
  }>>;

  /**
   * Get pattern statistics
   */
  getPatternStats(): Promise<{
    totalPatterns: number;
    avgReward: number;
    successRate: number;
  }>;
}
