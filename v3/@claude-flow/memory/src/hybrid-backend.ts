/**
 * HybridBackend - Combines SQLite (structured queries) + AgentDB (vector search)
 *
 * Per ADR-009: "HybridBackend (SQLite + AgentDB) as default"
 * - SQLite for: Structured queries, ACID transactions, exact matches
 * - AgentDB for: Semantic search, vector similarity, RAG
 *
 * @module v3/memory/hybrid-backend
 */

import { EventEmitter } from 'node:events';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,
  EmbeddingGenerator,
  createDefaultEntry,
  QueryType,
} from './types.js';
import { SQLiteBackend, SQLiteBackendConfig } from './sqlite-backend.js';
import { AgentDBBackend, AgentDBBackendConfig } from './agentdb-backend.js';

/**
 * Configuration for HybridBackend
 */
export interface HybridBackendConfig {
  /** SQLite configuration */
  sqlite?: Partial<SQLiteBackendConfig>;

  /** AgentDB configuration */
  agentdb?: Partial<AgentDBBackendConfig>;

  /** Default namespace */
  defaultNamespace?: string;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Query routing strategy */
  routingStrategy?: 'auto' | 'sqlite-first' | 'agentdb-first';

  /** Enable dual-write (write to both backends) */
  dualWrite?: boolean;

  /** Semantic search threshold for hybrid queries */
  semanticThreshold?: number;

  /** Maximum results to fetch from each backend in hybrid queries */
  hybridMaxResults?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<HybridBackendConfig> = {
  sqlite: {},
  agentdb: {},
  defaultNamespace: 'default',
  embeddingGenerator: undefined as any,
  routingStrategy: 'auto',
  dualWrite: true,
  semanticThreshold: 0.7,
  hybridMaxResults: 100,
};

/**
 * Structured Query Interface
 * Optimized for SQLite's strengths
 */
export interface StructuredQuery {
  /** Exact key match */
  key?: string;

  /** Key prefix match */
  keyPrefix?: string;

  /** Namespace filter */
  namespace?: string;

  /** Owner filter */
  ownerId?: string;

  /** Type filter */
  type?: string;

  /** Time range filters */
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;

  /** Pagination */
  limit?: number;
  offset?: number;
}

/**
 * Semantic Query Interface
 * Optimized for AgentDB's vector search
 */
export interface SemanticQuery {
  /** Content to search for (will be embedded) */
  content?: string;

  /** Pre-computed embedding */
  embedding?: Float32Array;

  /** Number of results */
  k?: number;

  /** Similarity threshold (0-1) */
  threshold?: number;

  /** Additional filters */
  filters?: Partial<MemoryQuery>;
}

/**
 * Hybrid Query Interface
 * Combines structured + semantic search
 */
export interface HybridQuery {
  /** Semantic component */
  semantic: SemanticQuery;

  /** Structured component */
  structured?: StructuredQuery;

  /** How to combine results */
  combineStrategy?: 'union' | 'intersection' | 'semantic-first' | 'structured-first';

  /** Weights for score combination */
  weights?: {
    semantic: number;
    structured: number;
  };
}

/**
 * HybridBackend Implementation
 *
 * Intelligently routes queries between SQLite and AgentDB:
 * - Exact matches, prefix queries → SQLite
 * - Semantic search, similarity → AgentDB
 * - Complex hybrid queries → Both backends with intelligent merging
 */
export class HybridBackend extends EventEmitter implements IMemoryBackend {
  private sqlite: SQLiteBackend;
  private agentdb: AgentDBBackend;
  private config: Required<HybridBackendConfig>;
  private initialized: boolean = false;

  // Performance tracking
  private stats = {
    sqliteQueries: 0,
    agentdbQueries: 0,
    hybridQueries: 0,
    totalQueryTime: 0,
  };

  constructor(config: HybridBackendConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize SQLite backend
    this.sqlite = new SQLiteBackend({
      ...this.config.sqlite,
      defaultNamespace: this.config.defaultNamespace,
      embeddingGenerator: this.config.embeddingGenerator,
    });

    // Initialize AgentDB backend
    this.agentdb = new AgentDBBackend({
      ...this.config.agentdb,
      namespace: this.config.defaultNamespace,
      embeddingGenerator: this.config.embeddingGenerator,
    });

    // Forward events from both backends
    this.sqlite.on('entry:stored', (data) => this.emit('sqlite:stored', data));
    this.sqlite.on('entry:updated', (data) => this.emit('sqlite:updated', data));
    this.sqlite.on('entry:deleted', (data) => this.emit('sqlite:deleted', data));

    this.agentdb.on('entry:stored', (data) => this.emit('agentdb:stored', data));
    this.agentdb.on('entry:updated', (data) => this.emit('agentdb:updated', data));
    this.agentdb.on('entry:deleted', (data) => this.emit('agentdb:deleted', data));
    this.agentdb.on('cache:hit', (data) => this.emit('cache:hit', data));
    this.agentdb.on('cache:miss', (data) => this.emit('cache:miss', data));
  }

  /**
   * Initialize both backends
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Promise.all([this.sqlite.initialize(), this.agentdb.initialize()]);

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown both backends
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    await Promise.all([this.sqlite.shutdown(), this.agentdb.shutdown()]);

    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Store in both backends (dual-write for consistency)
   */
  async store(entry: MemoryEntry): Promise<void> {
    if (this.config.dualWrite) {
      // Write to both backends in parallel
      await Promise.all([this.sqlite.store(entry), this.agentdb.store(entry)]);
    } else {
      // Write to primary backend only (AgentDB has vector search)
      await this.agentdb.store(entry);
    }

    this.emit('entry:stored', { id: entry.id });
  }

  /**
   * Get from AgentDB (has caching enabled)
   */
  async get(id: string): Promise<MemoryEntry | null> {
    return this.agentdb.get(id);
  }

  /**
   * Get by key (SQLite optimized for exact matches)
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.sqlite.getByKey(namespace, key);
  }

  /**
   * Update in both backends
   */
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    if (this.config.dualWrite) {
      // Update both backends
      const [sqliteResult, agentdbResult] = await Promise.all([
        this.sqlite.update(id, update),
        this.agentdb.update(id, update),
      ]);
      return agentdbResult || sqliteResult;
    } else {
      return this.agentdb.update(id, update);
    }
  }

  /**
   * Delete from both backends
   */
  async delete(id: string): Promise<boolean> {
    if (this.config.dualWrite) {
      const [sqliteResult, agentdbResult] = await Promise.all([
        this.sqlite.delete(id),
        this.agentdb.delete(id),
      ]);
      return sqliteResult || agentdbResult;
    } else {
      return this.agentdb.delete(id);
    }
  }

  /**
   * Query routing - semantic goes to AgentDB, structured to SQLite
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const startTime = performance.now();

    let results: MemoryEntry[];

    // Route based on query type
    switch (query.type) {
      case 'exact':
        // SQLite optimized for exact matches
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'prefix':
        // SQLite optimized for prefix queries
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'tag':
        // Both can handle tags, use SQLite for structured filtering
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'semantic':
        // AgentDB optimized for semantic search
        this.stats.agentdbQueries++;
        results = await this.agentdb.query(query);
        break;

      case 'hybrid':
        // Use hybrid query combining both backends
        this.stats.hybridQueries++;
        results = await this.queryHybridInternal(query);
        break;

      default:
        // Auto-routing based on query properties
        results = await this.autoRoute(query);
    }

    const duration = performance.now() - startTime;
    this.stats.totalQueryTime += duration;

    this.emit('query:completed', { type: query.type, duration, count: results.length });
    return results;
  }

  /**
   * Structured queries (SQL)
   * Routes to SQLite for optimal performance
   */
  async queryStructured(query: StructuredQuery): Promise<MemoryEntry[]> {
    this.stats.sqliteQueries++;

    const memoryQuery: MemoryQuery = {
      type: query.key ? 'exact' : query.keyPrefix ? 'prefix' : 'hybrid',
      key: query.key,
      keyPrefix: query.keyPrefix,
      namespace: query.namespace,
      ownerId: query.ownerId,
      memoryType: query.type as any,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      updatedAfter: query.updatedAfter,
      updatedBefore: query.updatedBefore,
      limit: query.limit || 100,
      offset: query.offset || 0,
    };

    return this.sqlite.query(memoryQuery);
  }

  /**
   * Semantic queries (vector)
   * Routes to AgentDB for HNSW-based vector search
   */
  async querySemantic(query: SemanticQuery): Promise<MemoryEntry[]> {
    const scored = await this.querySemanticScored(query);
    return scored.map((r) => r.entry);
  }

  /**
   * Semantic vector search, preserving each result's similarity score.
   *
   * `querySemantic()` above flattens to `MemoryEntry[]`, discarding score —
   * fine for callers that only need entries, but `queryHybrid()`'s weighted
   * fusion (`combineWeighted`) needs the score to survive, so it calls this
   * variant directly instead.
   */
  private async querySemanticScored(
    query: SemanticQuery
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    this.stats.agentdbQueries++;

    let embedding = query.embedding;

    // Generate embedding if content provided
    if (!embedding && query.content && this.config.embeddingGenerator) {
      embedding = await this.config.embeddingGenerator(query.content);
    }

    if (!embedding) {
      throw new Error('SemanticQuery requires either content or embedding');
    }

    const searchResults = await this.agentdb.search(embedding, {
      k: (query.k || 10) * 2, // Over-fetch to account for post-filtering
      threshold: query.threshold || this.config.semanticThreshold,
      filters: query.filters as MemoryQuery | undefined,
    });

    let scored = searchResults.map((r) => ({ entry: r.entry, score: r.score }));

    // Apply tag/namespace/type filters that AgentDB may not enforce
    if (query.filters) {
      const f = query.filters as Record<string, unknown>;
      if (f.tags && Array.isArray(f.tags)) {
        const requiredTags = f.tags as string[];
        scored = scored.filter((r) =>
          requiredTags.every((t) => r.entry.tags.includes(t))
        );
      }
      if (f.namespace && typeof f.namespace === 'string') {
        scored = scored.filter((r) => r.entry.namespace === f.namespace);
      }
      if (f.type && typeof f.type === 'string' && f.type !== 'semantic') {
        scored = scored.filter((r) => r.entry.type === f.type);
      }
    }

    return scored.slice(0, query.k || 10);
  }

  /**
   * Hybrid queries (combine both)
   * Intelligently merges results from both backends
   */
  async queryHybrid(query: HybridQuery): Promise<MemoryEntry[]> {
    this.stats.hybridQueries++;

    const strategy = query.combineStrategy || 'semantic-first';
    const weights = query.weights || { semantic: 0.7, structured: 0.3 };

    // Execute both queries in parallel. The scored semantic variant is
    // needed for weighted fusion (combineWeighted); other strategies only
    // need plain entries, derived from the same result rather than
    // querying AgentDB twice.
    const [semanticScored, structuredResults] = await Promise.all([
      this.querySemanticScored(query.semantic),
      query.structured ? this.queryStructured(query.structured) : Promise.resolve([]),
    ]);
    const semanticResults = semanticScored.map((r) => r.entry);

    // Combine results based on strategy
    switch (strategy) {
      case 'union':
        return this.combineWeighted(semanticScored, structuredResults, weights);

      case 'intersection':
        return this.combineIntersection(semanticResults, structuredResults);

      case 'semantic-first':
        return this.combineSemanticFirst(semanticResults, structuredResults);

      case 'structured-first':
        return this.combineStructuredFirst(semanticResults, structuredResults);

      default:
        return this.combineWeighted(semanticScored, structuredResults, weights);
    }
  }

  /**
   * Semantic vector search (routes to AgentDB)
   */
  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    this.stats.agentdbQueries++;
    return this.agentdb.search(embedding, options);
  }

  /**
   * Bulk insert to both backends
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    if (this.config.dualWrite) {
      await Promise.all([this.sqlite.bulkInsert(entries), this.agentdb.bulkInsert(entries)]);
    } else {
      await this.agentdb.bulkInsert(entries);
    }
  }

  /**
   * Bulk delete from both backends
   */
  async bulkDelete(ids: string[]): Promise<number> {
    if (this.config.dualWrite) {
      const [sqliteCount, agentdbCount] = await Promise.all([
        this.sqlite.bulkDelete(ids),
        this.agentdb.bulkDelete(ids),
      ]);
      return Math.max(sqliteCount, agentdbCount);
    } else {
      return this.agentdb.bulkDelete(ids);
    }
  }

  /**
   * Count entries (use SQLite for efficiency)
   */
  async count(namespace?: string): Promise<number> {
    return this.sqlite.count(namespace);
  }

  /**
   * List namespaces (use SQLite)
   */
  async listNamespaces(): Promise<string[]> {
    return this.sqlite.listNamespaces();
  }

  /**
   * Clear namespace in both backends
   */
  async clearNamespace(namespace: string): Promise<number> {
    if (this.config.dualWrite) {
      const [sqliteCount, agentdbCount] = await Promise.all([
        this.sqlite.clearNamespace(namespace),
        this.agentdb.clearNamespace(namespace),
      ]);
      return Math.max(sqliteCount, agentdbCount);
    } else {
      return this.agentdb.clearNamespace(namespace);
    }
  }

  /**
   * Get combined statistics from both backends
   */
  async getStats(): Promise<BackendStats> {
    const [sqliteStats, agentdbStats] = await Promise.all([
      this.sqlite.getStats(),
      this.agentdb.getStats(),
    ]);

    return {
      totalEntries: Math.max(sqliteStats.totalEntries, agentdbStats.totalEntries),
      entriesByNamespace: agentdbStats.entriesByNamespace,
      entriesByType: agentdbStats.entriesByType,
      memoryUsage: sqliteStats.memoryUsage + agentdbStats.memoryUsage,
      hnswStats: agentdbStats.hnswStats ?? {
        vectorCount: agentdbStats.totalEntries,
        memoryUsage: 0,
        avgSearchTime: agentdbStats.avgSearchTime,
        buildTime: 0,
        compressionRatio: 1.0,
      },
      cacheStats: (agentdbStats as any).cacheStats ?? {
        hitRate: 0,
        size: 0,
        maxSize: 1000,
      },
      avgQueryTime:
        this.stats.hybridQueries + this.stats.sqliteQueries + this.stats.agentdbQueries > 0
          ? this.stats.totalQueryTime /
            (this.stats.hybridQueries + this.stats.sqliteQueries + this.stats.agentdbQueries)
          : 0,
      avgSearchTime: agentdbStats.avgSearchTime,
    };
  }

  /**
   * Health check for both backends
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const [sqliteHealth, agentdbHealth] = await Promise.all([
      this.sqlite.healthCheck(),
      this.agentdb.healthCheck(),
    ]);

    const allIssues = [...sqliteHealth.issues, ...agentdbHealth.issues];
    const allRecommendations = [
      ...sqliteHealth.recommendations,
      ...agentdbHealth.recommendations,
    ];

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (
      sqliteHealth.status === 'unhealthy' ||
      agentdbHealth.status === 'unhealthy'
    ) {
      status = 'unhealthy';
    } else if (
      sqliteHealth.status === 'degraded' ||
      agentdbHealth.status === 'degraded'
    ) {
      status = 'degraded';
    }

    return {
      status,
      components: {
        storage: sqliteHealth.components.storage,
        index: agentdbHealth.components.index,
        cache: agentdbHealth.components.cache,
      },
      timestamp: Date.now(),
      issues: allIssues,
      recommendations: allRecommendations,
    };
  }

  // ===== Private Methods =====

  /**
   * Auto-route queries based on properties
   */
  private async autoRoute(query: MemoryQuery): Promise<MemoryEntry[]> {
    // If has embedding or content, use semantic search (AgentDB)
    const hasEmbeddingGenerator = typeof this.config.embeddingGenerator === 'function';
    if (query.embedding || (query.content && hasEmbeddingGenerator)) {
      this.stats.agentdbQueries++;
      return this.agentdb.query(query);
    }

    // If has exact key or prefix, use structured search (SQLite)
    if (query.key || query.keyPrefix) {
      this.stats.sqliteQueries++;
      return this.sqlite.query(query);
    }

    // For other filters, use routing strategy
    switch (this.config.routingStrategy) {
      case 'sqlite-first':
        this.stats.sqliteQueries++;
        return this.sqlite.query(query);

      case 'agentdb-first':
        this.stats.agentdbQueries++;
        return this.agentdb.query(query);

      case 'auto':
      default:
        // Default to AgentDB (has caching)
        this.stats.agentdbQueries++;
        return this.agentdb.query(query);
    }
  }

  /**
   * Internal hybrid query implementation
   */
  private async queryHybridInternal(query: MemoryQuery): Promise<MemoryEntry[]> {
    // If semantic component exists, use hybrid
    if (query.embedding || query.content) {
      const semanticQuery: SemanticQuery = {
        content: query.content,
        embedding: query.embedding,
        k: query.limit || 10,
        threshold: query.threshold,
        filters: query,
      };

      const structuredQuery: StructuredQuery = {
        namespace: query.namespace,
        key: query.key,
        keyPrefix: query.keyPrefix,
        ownerId: query.ownerId,
        type: query.memoryType,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
        updatedAfter: query.updatedAfter,
        updatedBefore: query.updatedBefore,
        limit: query.limit,
        offset: query.offset,
      };

      return this.queryHybrid({
        semantic: semanticQuery,
        structured: structuredQuery,
        combineStrategy: 'semantic-first',
      });
    }

    // Otherwise, route to structured
    return this.autoRoute(query);
  }

  /**
   * Weighted union: fuses semantic + structured results via reciprocal-rank
   * fusion (RRF), each arm scaled by its `weights` multiplier before
   * summation — the same shape documented for Azure AI Search/Qdrant/
   * Weaviate (a per-arm weight applied to that arm's RRF contribution,
   * not a raw-score blend, since SQLite's structured results carry no
   * similarity score comparable to AgentDB's). Dream Cycle 2026-08-28:
   * `weights` used to be computed by the caller and discarded — this is
   * the fusion that actually consumes it.
   */
  private combineWeighted(
    semanticScored: Array<{ entry: MemoryEntry; score: number }>,
    structuredResults: MemoryEntry[],
    weights: { semantic: number; structured: number }
  ): MemoryEntry[] {
    const RRF_K = 60; // matches smart-retrieval.ts's applyRRF default

    // Review (PR #3119): an unvalidated malformed weight (NaN, negative,
    // Infinity) gives RRF undefined ranking semantics — NaN poisons every
    // sum it touches (breaking the sort comparator below), a negative
    // weight silently inverts that arm's intended preference, and
    // Infinity swamps the other arm outright. Sanitize per-component: any
    // non-finite or negative value falls back to that component's own
    // documented default rather than failing the whole hybrid query (this
    // mirrors `weights` itself already being optional with a default —
    // a malformed field degrades the same way a missing one does).
    const safeWeight = (value: number, fallback: number): number =>
      Number.isFinite(value) && value >= 0 ? value : fallback;
    const safeWeights = {
      semantic: safeWeight(weights.semantic, 0.7),
      structured: safeWeight(weights.structured, 0.3),
    };

    const fused = new Map<string, { entry: MemoryEntry; rrf: number }>();

    semanticScored.forEach(({ entry }, rank) => {
      const contribution = safeWeights.semantic * (1 / (RRF_K + rank + 1));
      const existing = fused.get(entry.id);
      fused.set(entry.id, { entry, rrf: (existing?.rrf ?? 0) + contribution });
    });

    structuredResults.forEach((entry, rank) => {
      const contribution = safeWeights.structured * (1 / (RRF_K + rank + 1));
      const existing = fused.get(entry.id);
      fused.set(entry.id, { entry, rrf: (existing?.rrf ?? 0) + contribution });
    });

    // Review (PR #3119): break rrf ties deterministically by entry.id
    // rather than relying on Array.sort's stability + Map insertion order
    // (semantic-arm-first) as an undocumented accident of iteration order.
    return Array.from(fused.values())
      .sort((a, b) => b.rrf - a.rrf || a.entry.id.localeCompare(b.entry.id))
      .map((r) => r.entry);
  }

  /**
   * Combine results using intersection (only common results)
   */
  private combineIntersection(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const semanticIds = new Set(semanticResults.map((e) => e.id));
    return structuredResults.filter((e) => semanticIds.has(e.id));
  }

  /**
   * Semantic-first: Prefer semantic results, add structured if not present
   */
  private combineSemanticFirst(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const semanticIds = new Set(semanticResults.map((e) => e.id));
    const additional = structuredResults.filter((e) => !semanticIds.has(e.id));
    return [...semanticResults, ...additional];
  }

  /**
   * Structured-first: Prefer structured results, add semantic if not present
   */
  private combineStructuredFirst(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const structuredIds = new Set(structuredResults.map((e) => e.id));
    const additional = semanticResults.filter((e) => !structuredIds.has(e.id));
    return [...structuredResults, ...additional];
  }

  // ===== Proxy Methods for AgentDB v3 Controllers (ADR-053 #1212) =====

  /**
   * Record feedback for a memory entry.
   * Delegates to AgentDB's recordFeedback when available.
   * Gracefully degrades to a no-op when AgentDB is unavailable.
   */
  async recordFeedback(
    entryId: string,
    feedback: { score: number; label?: string; context?: Record<string, unknown> },
  ): Promise<boolean> {
    const agentdbInstance = this.agentdb.getAgentDB?.();
    if (agentdbInstance && typeof agentdbInstance.recordFeedback === 'function') {
      try {
        await agentdbInstance.recordFeedback(entryId, feedback);
        this.emit('feedback:recorded', { entryId, score: feedback.score });
        return true;
      } catch {
        // AgentDB feedback recording failed — degrade silently
      }
    }
    return false;
  }

  /**
   * Verify a witness chain for a memory entry.
   * Delegates to AgentDB's verifyWitnessChain when available.
   */
  async verifyWitnessChain(entryId: string): Promise<{
    valid: boolean;
    chainLength: number;
    errors: string[];
  }> {
    const agentdbInstance = this.agentdb.getAgentDB?.();
    if (agentdbInstance && typeof agentdbInstance.verifyWitnessChain === 'function') {
      try {
        return await agentdbInstance.verifyWitnessChain(entryId);
      } catch {
        // Verification failed — return degraded result
      }
    }
    return { valid: false, chainLength: 0, errors: ['AgentDB not available'] };
  }

  /**
   * Get the witness chain for a memory entry.
   * Delegates to AgentDB's getWitnessChain when available.
   */
  async getWitnessChain(entryId: string): Promise<Array<{
    hash: string;
    timestamp: number;
    operation: string;
  }>> {
    const agentdbInstance = this.agentdb.getAgentDB?.();
    if (agentdbInstance && typeof agentdbInstance.getWitnessChain === 'function') {
      try {
        return await agentdbInstance.getWitnessChain(entryId);
      } catch {
        // Chain retrieval failed
      }
    }
    return [];
  }

  // ===== Backend Access =====

  /**
   * Get underlying backends for advanced operations
   */
  getSQLiteBackend(): SQLiteBackend {
    return this.sqlite;
  }

  getAgentDBBackend(): AgentDBBackend {
    return this.agentdb;
  }
}

export default HybridBackend;
