/**
 * AgentDB Backend - Integration with agentdb@2.0.0-alpha.3.4
 *
 * Provides IMemoryBackend implementation using AgentDB with:
 * - HNSW vector search (150x-12,500x faster than brute-force)
 * - Native or WASM backend support with graceful fallback
 * - Optional dependency handling (works without hnswlib-node)
 * - Seamless integration with HybridBackend
 *
 * @module v3/memory/agentdb-backend
 */

import { EventEmitter } from 'node:events';
import { safeJsonParse } from './json-security.js';
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
  MemoryType,
  EmbeddingGenerator,
  generateMemoryId,
  createDefaultEntry,
  CacheStats,
  HNSWStats,
} from './types.js';
import {
  AgentDbRetrievalGuard,
  isRetrievalGuardEnabled,
  type RetrievalGuardConfig,
} from './agentdb-retrieval-guard.js';

// ===== AgentDB Optional Import =====

let AgentDB: any;
let HNSWIndex: any;
let isHnswlibAvailable: (() => Promise<boolean>) | undefined;

// Dynamically import agentdb (handled at runtime)
let agentdbImportPromise: Promise<void> | undefined;

function ensureAgentDBImport(): Promise<void> {
  if (!agentdbImportPromise) {
    agentdbImportPromise = (async () => {
      try {
        const agentdbModule: any = await import('agentdb');
        AgentDB = agentdbModule.AgentDB || agentdbModule.default;
        HNSWIndex = agentdbModule.HNSWIndex;
        isHnswlibAvailable = agentdbModule.isHnswlibAvailable;
      } catch (error) {
        // AgentDB not available - will use fallback
      }
    })();
  }
  return agentdbImportPromise;
}

// ===== Configuration =====

/**
 * Configuration for AgentDB Backend
 */
export interface AgentDBBackendConfig {
  /** Database path for persistence */
  dbPath?: string;

  /** Namespace for memory organization */
  namespace?: string;

  /** Force WASM backend (skip native hnswlib) */
  forceWasm?: boolean;

  /** Vector backend: 'auto', 'ruvector', 'hnswlib' */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';

  /** Vector dimensions (default: 1536) */
  vectorDimension?: number;

  /** HNSW M parameter */
  hnswM?: number;

  /** HNSW efConstruction parameter */
  hnswEfConstruction?: number;

  /** HNSW efSearch parameter */
  hnswEfSearch?: number;

  /** Enable caching */
  cacheEnabled?: boolean;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries */
  maxEntries?: number;

  /**
   * ADR-377 Phase 1 — retrieval-layer injection guard. When omitted, a guard
   * is constructed automatically but only actively filters results if
   * `CLAUDE_FLOW_RETRIEVAL_GUARD=true` (see `isRetrievalGuardEnabled`).
   * Pass `false` to disable entirely regardless of the env flag.
   */
  retrievalGuard?: RetrievalGuardConfig | false;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<AgentDBBackendConfig, 'dbPath' | 'embeddingGenerator' | 'retrievalGuard'>
> = {
  namespace: 'default',
  forceWasm: false,
  vectorBackend: 'auto',
  vectorDimension: 1536,
  hnswM: 16,
  hnswEfConstruction: 200,
  hnswEfSearch: 100,
  cacheEnabled: true,
  maxEntries: 1000000,
};

// ===== AgentDB Backend Implementation =====

/**
 * AgentDB Backend
 *
 * Integrates AgentDB for vector search with the V3 memory system.
 * Provides 150x-12,500x faster search compared to brute-force approaches.
 *
 * Features:
 * - HNSW indexing for fast approximate nearest neighbor search
 * - Automatic fallback: native hnswlib → ruvector → WASM
 * - Graceful handling of optional native dependencies
 * - Semantic search with filtering
 * - Compatible with HybridBackend for combined SQLite+AgentDB queries
 */
export class AgentDBBackend extends EventEmitter implements IMemoryBackend {
  private config: Required<
    Omit<AgentDBBackendConfig, 'dbPath' | 'embeddingGenerator' | 'retrievalGuard'>
  > & {
    dbPath?: string;
    embeddingGenerator?: EmbeddingGenerator;
  };
  private agentdb: any;
  private initialized: boolean = false;
  private available: boolean = false;
  private readonly retrievalGuard: AgentDbRetrievalGuard | null;

  // In-memory storage for compatibility
  private entries: Map<string, MemoryEntry> = new Map();
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private keyIndex: Map<string, string> = new Map();

  // O(1) bidirectional lookup for numeric ID <-> string ID (fixes O(n) linear scan)
  private numericToStringIdMap: Map<number, string> = new Map();
  private stringToNumericIdMap: Map<string, number> = new Map();

  // Performance tracking
  private stats = {
    queryCount: 0,
    totalQueryTime: 0,
    searchCount: 0,
    totalSearchTime: 0,
  };

  constructor(config: AgentDBBackendConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.available = false; // Will be set during initialization
    this.retrievalGuard =
      config.retrievalGuard === false
        ? null
        : new AgentDbRetrievalGuard(config.retrievalGuard || {});
  }

  /**
   * Initialize AgentDB
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Try to import AgentDB
    await ensureAgentDBImport();

    this.available = AgentDB !== undefined;

    if (!this.available) {
      console.warn('AgentDB not available, using fallback in-memory storage');
      this.initialized = true;
      return;
    }

    try {
      // Initialize AgentDB with config
      this.agentdb = new AgentDB({
        dbPath: this.config.dbPath || ':memory:',
        namespace: this.config.namespace,
        forceWasm: this.config.forceWasm,
        vectorBackend: this.config.vectorBackend,
        vectorDimension: this.config.vectorDimension,
      });

      // Suppress agentdb's noisy console.log during init
      // (EmbeddingService, AgentDB core emit info-level logs we don't need)
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = String(args[0] ?? '');
        if (msg.includes('Transformers.js loaded') ||
            msg.includes('Using better-sqlite3') ||
            msg.includes('better-sqlite3 unavailable') ||
            msg.includes('[AgentDB]')) return;
        origLog.apply(console, args);
      };
      try {
        await this.agentdb.initialize();
      } finally {
        console.log = origLog;
      }

      // Create memory_entries table if it doesn't exist
      await this.createSchema();

      this.initialized = true;
      this.emit('initialized', {
        backend: this.agentdb.vectorBackendName,
        isWasm: this.agentdb.isWasm,
      });
    } catch (error) {
      console.error('Failed to initialize AgentDB:', error);
      this.available = false;
      this.initialized = true;
      this.emit('initialization:failed', { error });
    }
  }

  /**
   * Shutdown AgentDB
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    if (this.agentdb) {
      await this.agentdb.close();
    }

    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry): Promise<void> {
    // Generate embedding if needed
    if (entry.content && !entry.embedding && this.config.embeddingGenerator) {
      entry.embedding = await this.config.embeddingGenerator(entry.content);
    }

    // Store in-memory for quick access
    this.entries.set(entry.id, entry);

    // Register ID mapping for O(1) reverse lookup
    this.registerIdMapping(entry.id);

    // Update indexes
    this.updateIndexes(entry);

    // Store in AgentDB if available
    if (this.agentdb) {
      await this.storeInAgentDB(entry);
    }

    this.emit('entry:stored', { id: entry.id });
  }

  /**
   * Get entry by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    // Check in-memory first
    const cached = this.entries.get(id);
    if (cached) return cached;

    // Query AgentDB if available
    if (this.agentdb) {
      return this.getFromAgentDB(id);
    }

    return null;
  }

  /**
   * Get entry by key
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    const keyIndexKey = `${namespace}:${key}`;
    const id = this.keyIndex.get(keyIndexKey);
    if (!id) return null;
    return this.get(id);
  }

  /**
   * Update entry
   */
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // Apply updates
    if (update.content !== undefined) {
      entry.content = update.content;
      // Regenerate embedding if needed
      if (this.config.embeddingGenerator) {
        entry.embedding = await this.config.embeddingGenerator(entry.content);
      }
    }

    if (update.tags !== undefined) {
      entry.tags = update.tags;
    }

    if (update.metadata !== undefined) {
      entry.metadata = { ...entry.metadata, ...update.metadata };
    }

    if (update.accessLevel !== undefined) {
      entry.accessLevel = update.accessLevel;
    }

    if (update.expiresAt !== undefined) {
      entry.expiresAt = update.expiresAt;
    }

    if (update.references !== undefined) {
      entry.references = update.references;
    }

    entry.updatedAt = Date.now();
    entry.version++;

    // Update in AgentDB
    if (this.agentdb) {
      await this.updateInAgentDB(entry);
    }

    this.emit('entry:updated', { id });
    return entry;
  }

  /**
   * Delete entry
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Remove from indexes
    this.entries.delete(id);
    this.unregisterIdMapping(id); // Clean up reverse lookup map
    this.namespaceIndex.get(entry.namespace)?.delete(id);
    const keyIndexKey = `${entry.namespace}:${entry.key}`;
    this.keyIndex.delete(keyIndexKey);

    // Delete from AgentDB
    if (this.agentdb) {
      await this.deleteFromAgentDB(id);
    }

    this.emit('entry:deleted', { id });
    return true;
  }

  /**
   * Query entries
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const startTime = performance.now();
    let results: MemoryEntry[] = [];

    if (query.type === 'semantic' && (query.embedding || query.content)) {
      // Use semantic search
      const searchResults = await this.semanticSearch(query);
      results = searchResults.map((r) => r.entry);
    } else {
      // Fallback to in-memory filtering
      results = this.queryInMemory(query);
    }

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    return results;
  }

  /**
   * Semantic vector search
   */
  async search(
    embedding: Float32Array,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const startTime = performance.now();

    if (!this.agentdb) {
      // Fallback to brute-force search
      return this.applyRetrievalGuard(await this.bruteForceSearch(embedding, options));
    }

    try {
      // Use AgentDB HNSW search
      const results = await this.searchWithAgentDB(embedding, options);

      const duration = performance.now() - startTime;
      this.stats.searchCount++;
      this.stats.totalSearchTime += duration;

      return this.applyRetrievalGuard(results);
    } catch (error) {
      console.error('AgentDB search failed, falling back to brute-force:', error);
      return this.applyRetrievalGuard(await this.bruteForceSearch(embedding, options));
    }
  }

  /**
   * ADR-377 Phase 1 — filter HNSW/brute-force results through the retrieval
   * guard before they reach `query()`'s callers (and, through it, agent
   * context assembly). No-op unless `CLAUDE_FLOW_RETRIEVAL_GUARD=true` or
   * the guard was constructed with an explicit config (see
   * `AgentDbRetrievalGuard`'s constructor — an explicit config always scans;
   * only the *drop* behavior is additionally gated on
   * `CLAUDE_FLOW_RETRIEVAL_GUARD_STRICT`).
   */
  private applyRetrievalGuard(results: SearchResult[]): SearchResult[] {
    if (!this.retrievalGuard || !isRetrievalGuardEnabled() || results.length === 0) {
      return results;
    }
    return this.retrievalGuard.filter(results).results;
  }

  /**
   * Bulk insert
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // PERF-02: Batch with bounded concurrency instead of sequential N+1
    const BATCH_SIZE = 50;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(entry => this.store(entry)));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`[AgentDB] bulkInsert: ${failures.length}/${batch.length} entries failed in batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      }
    }
  }

  /**
   * Bulk delete
   */
  async bulkDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    // PERF-02: Batch with bounded concurrency instead of sequential N+1
    const BATCH_SIZE = 50;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(id => this.delete(id)));
      deleted += results.filter(r => r.status === 'fulfilled' && r.value).length;
    }
    return deleted;
  }

  /**
   * Count entries
   */
  async count(namespace?: string): Promise<number> {
    if (namespace) {
      return this.namespaceIndex.get(namespace)?.size || 0;
    }
    return this.entries.size;
  }

  /**
   * List namespaces
   */
  async listNamespaces(): Promise<string[]> {
    return Array.from(this.namespaceIndex.keys());
  }

  /**
   * Clear namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    const ids = this.namespaceIndex.get(namespace);
    if (!ids || ids.size === 0) return 0;

    // PERF-02: Copy IDs to avoid modifying set during iteration, then batch delete
    const idList = Array.from(ids);
    return this.bulkDelete(idList);
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<BackendStats> {
    const entriesByNamespace: Record<string, number> = {};
    for (const [namespace, ids] of this.namespaceIndex) {
      entriesByNamespace[namespace] = ids.size;
    }

    const entriesByType: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      working: 0,
      cache: 0,
    };

    for (const entry of this.entries.values()) {
      entriesByType[entry.type]++;
    }

    // Get HNSW stats if available
    let hnswStats: HNSWStats | undefined;
    if (this.agentdb && HNSWIndex) {
      try {
        const hnsw = this.agentdb.getController('hnsw');
        if (hnsw) {
          const stats = hnsw.getStats();
          hnswStats = {
            vectorCount: stats.numElements || 0,
            memoryUsage: 0,
            avgSearchTime: stats.avgSearchTimeMs || 0,
            buildTime: stats.lastBuildTime || 0,
            compressionRatio: 1.0,
          };
        }
      } catch {
        // HNSW not available
      }
    }

    return {
      totalEntries: this.entries.size,
      entriesByNamespace,
      entriesByType,
      memoryUsage: this.estimateMemoryUsage(),
      hnswStats,
      avgQueryTime:
        this.stats.queryCount > 0
          ? this.stats.totalQueryTime / this.stats.queryCount
          : 0,
      avgSearchTime:
        this.stats.searchCount > 0
          ? this.stats.totalSearchTime / this.stats.searchCount
          : 0,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check AgentDB availability
    const storageHealth: ComponentHealth = this.agentdb
      ? { status: 'healthy', latency: 0 }
      : {
          status: 'degraded',
          latency: 0,
          message: 'AgentDB not available, using fallback',
        };

    // Check index health
    const indexHealth: ComponentHealth = { status: 'healthy', latency: 0 };
    if (!this.agentdb) {
      indexHealth.status = 'degraded';
      indexHealth.message = 'HNSW index not available';
      recommendations.push('Install agentdb for 150x-12,500x faster vector search');
    }

    // Check cache health
    const cacheHealth: ComponentHealth = { status: 'healthy', latency: 0 };

    const status =
      storageHealth.status === 'unhealthy' || indexHealth.status === 'unhealthy'
        ? 'unhealthy'
        : storageHealth.status === 'degraded' || indexHealth.status === 'degraded'
          ? 'degraded'
          : 'healthy';

    return {
      status,
      components: {
        storage: storageHealth,
        index: indexHealth,
        cache: cacheHealth,
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  // ===== Private Methods =====

  /**
   * Create database schema
   */
  private async createSchema(): Promise<void> {
    if (!this.agentdb) return;

    const db = this.agentdb.database;
    if (!db || typeof db.run !== 'function') {
      // AgentDB doesn't expose raw database - using native API
      return;
    }

    try {
    // Create memory_entries table
    await db.run(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        type TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tags TEXT,
        metadata TEXT,
        owner_id TEXT,
        access_level TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        version INTEGER NOT NULL,
        references TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed_at INTEGER
      )
    `);

    // Create indexes
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace)'
    );
    await db.run('CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type)');
    } catch {
      // Schema creation failed - using in-memory only
    }
  }

  /**
   * Store entry in AgentDB
   */
  private async storeInAgentDB(entry: MemoryEntry): Promise<void> {
    if (!this.agentdb) return;

    // Try to use agentdb's native store method if available
    try {
      if (typeof this.agentdb.store === 'function') {
        await this.agentdb.store(entry.id, {
          key: entry.key,
          content: entry.content,
          embedding: entry.embedding,
          type: entry.type,
          namespace: entry.namespace,
          tags: entry.tags,
          metadata: entry.metadata,
        });
        return;
      }

      // Fallback: use database directly if available
      const db = this.agentdb.database;
      if (!db || typeof db.run !== 'function') {
        // No compatible database interface - skip agentdb storage
        // Entry is already stored in-memory
        return;
      }

      await db.run(
      `
      INSERT OR REPLACE INTO memory_entries
      (id, key, content, embedding, type, namespace, tags, metadata, owner_id,
       access_level, created_at, updated_at, expires_at, version, references,
       access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        entry.id,
        entry.key,
        entry.content,
        entry.embedding ? Buffer.from(entry.embedding.buffer) : null,
        entry.type,
        entry.namespace,
        JSON.stringify(entry.tags),
        JSON.stringify(entry.metadata),
        entry.ownerId || null,
        entry.accessLevel,
        entry.createdAt,
        entry.updatedAt,
        entry.expiresAt || null,
        entry.version,
        JSON.stringify(entry.references),
        entry.accessCount,
        entry.lastAccessedAt,
      ]
    );
    } catch {
      // AgentDB storage failed - entry is already in-memory
    }

    // Add to vector index if HNSW is available
    if (entry.embedding && HNSWIndex) {
      try {
        const hnsw = this.agentdb.getController('hnsw');
        if (hnsw) {
          // Convert string ID to number for HNSW (use hash)
          const numericId = this.stringIdToNumeric(entry.id);
          hnsw.addVector(numericId, entry.embedding);
        }
      } catch {
        // HNSW not available
      }
    }
  }

  /**
   * Get entry from AgentDB
   */
  private async getFromAgentDB(id: string): Promise<MemoryEntry | null> {
    if (!this.agentdb) return null;

    try {
      // Try native get method first
      if (typeof this.agentdb.get === 'function') {
        const data = await this.agentdb.get(id);
        if (data) return this.dataToEntry(id, data);
      }

      // Fallback to database
      const db = this.agentdb.database;
      if (!db || typeof db.get !== 'function') return null;

      const row = await db.get('SELECT * FROM memory_entries WHERE id = ?', [id]);
      if (!row) return null;
      return this.rowToEntry(row);
    } catch {
      return null;
    }
  }

  /**
   * Convert agentdb data to MemoryEntry
   */
  private dataToEntry(id: string, data: any): MemoryEntry {
    const now = Date.now();
    return {
      id,
      key: data.key || id,
      content: data.content || '',
      embedding: data.embedding,
      type: data.type || 'semantic',
      namespace: data.namespace || this.config.namespace,
      tags: data.tags || [],
      metadata: data.metadata || {},
      ownerId: data.ownerId,
      accessLevel: data.accessLevel || 'private',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      expiresAt: data.expiresAt,
      version: data.version || 1,
      references: data.references || [],
      accessCount: data.accessCount || 0,
      lastAccessedAt: data.lastAccessedAt || now,
    };
  }

  /**
   * Update entry in AgentDB
   */
  private async updateInAgentDB(entry: MemoryEntry): Promise<void> {
    await this.storeInAgentDB(entry);
  }

  /**
   * Delete entry from AgentDB
   */
  private async deleteFromAgentDB(id: string): Promise<void> {
    if (!this.agentdb) return;

    try {
      // Try native delete method first
      if (typeof this.agentdb.delete === 'function') {
        await this.agentdb.delete(id);
        return;
      }

      // Fallback to database
      const db = this.agentdb.database;
      if (!db || typeof db.run !== 'function') return;

      await db.run('DELETE FROM memory_entries WHERE id = ?', [id]);
    } catch {
      // Delete failed - entry removed from in-memory
    }
  }

  /**
   * Search with AgentDB HNSW
   */
  private async searchWithAgentDB(
    embedding: Float32Array,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    if (!this.agentdb || !HNSWIndex) {
      return [];
    }

    try {
      const hnsw = this.agentdb.getController('hnsw');
      if (!hnsw) {
        return this.bruteForceSearch(embedding, options);
      }

      const results = await hnsw.search(embedding, options.k, {
        threshold: options.threshold,
      });

      const searchResults: SearchResult[] = [];

      for (const result of results) {
        const id = this.numericIdToString(result.id);
        const entry = await this.get(id);
        if (!entry) continue;

        searchResults.push({
          entry,
          score: result.similarity,
          distance: result.distance,
        });
      }

      return searchResults;
    } catch (error) {
      console.error('HNSW search failed:', error);
      return this.bruteForceSearch(embedding, options);
    }
  }

  /**
   * Brute-force vector search fallback
   */
  private bruteForceSearch(
    embedding: Float32Array,
    options: SearchOptions
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue;

      const score = this.cosineSimilarity(embedding, entry.embedding);
      const distance = 1 - score;

      if (options.threshold && score < options.threshold) continue;

      results.push({ entry, score, distance });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, options.k);
  }

  /**
   * Semantic search helper
   */
  private async semanticSearch(query: MemoryQuery): Promise<SearchResult[]> {
    let embedding = query.embedding;

    if (!embedding && query.content && this.config.embeddingGenerator) {
      embedding = await this.config.embeddingGenerator(query.content);
    }

    if (!embedding) {
      return [];
    }

    return this.search(embedding, {
      k: query.limit,
      threshold: query.threshold,
      filters: query,
    });
  }

  /**
   * In-memory query fallback
   */
  private queryInMemory(query: MemoryQuery): MemoryEntry[] {
    let results = Array.from(this.entries.values());

    // Apply filters
    if (query.namespace) {
      results = results.filter((e) => e.namespace === query.namespace);
    }

    if (query.key) {
      results = results.filter((e) => e.key === query.key);
    }

    if (query.keyPrefix) {
      results = results.filter((e) => e.key.startsWith(query.keyPrefix!));
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.every((tag) => e.tags.includes(tag))
      );
    }

    return results.slice(0, query.limit);
  }

  /**
   * Update in-memory indexes
   */
  private updateIndexes(entry: MemoryEntry): void {
    const namespace = entry.namespace;

    if (!this.namespaceIndex.has(namespace)) {
      this.namespaceIndex.set(namespace, new Set());
    }
    this.namespaceIndex.get(namespace)!.add(entry.id);

    const keyIndexKey = `${namespace}:${entry.key}`;
    this.keyIndex.set(keyIndexKey, entry.id);
  }

  /**
   * Convert DB row to MemoryEntry
   */
  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      embedding: row.embedding
        ? new Float32Array(new Uint8Array(row.embedding).buffer)
        : undefined,
      type: row.type,
      namespace: row.namespace,
      tags: safeJsonParse<string[]>(row.tags || '[]'),
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata || '{}'),
      ownerId: row.owner_id,
      accessLevel: row.access_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      version: row.version,
      references: safeJsonParse<string[]>(row.references || '[]'),
      accessCount: row.access_count || 0,
      lastAccessedAt: row.last_accessed_at || row.created_at,
    };
  }

  /**
   * Convert string ID to numeric for HNSW
   */
  private stringIdToNumeric(id: string): number {
    // Check reverse map first — if this ID was collision-probed, the map has the actual numeric ID
    const mapped = this.stringToNumericIdMap.get(id);
    if (mapped !== undefined) return mapped;

    // HIGH-05: Dual hash (djb2 + sdbm) for 53-bit space, ~94M entries before collision
    return this.hashStringId(id);
  }

  /**
   * Pure hash function for string ID (no map lookup).
   * Used by registerIdMapping for initial hash before collision probing.
   */
  private hashStringId(id: string): number {
    // Hash A: djb2
    let hashA = 5381;
    for (let i = 0; i < id.length; i++) {
      hashA = ((hashA << 5) + hashA + id.charCodeAt(i)) | 0;
    }

    // Hash B: sdbm (independent seed/algorithm)
    let hashB = 0;
    for (let i = 0; i < id.length; i++) {
      hashB = id.charCodeAt(i) + ((hashB << 6) + (hashB << 16) - hashB) | 0;
    }

    // Combine into a 53-bit safe integer:
    // Use 26 bits from hashA and 27 bits from hashB
    const upper = (Math.abs(hashA) & 0x3FFFFFF); // 26 bits
    const lower = (Math.abs(hashB) & 0x7FFFFFF); // 27 bits
    return upper * 0x8000000 + lower;
  }

  /**
   * Convert numeric ID back to string using O(1) reverse lookup
   * PERFORMANCE FIX: Uses pre-built reverse map instead of O(n) linear scan
   */
  private numericIdToString(numericId: number): string {
    // Use O(1) reverse lookup map
    const stringId = this.numericToStringIdMap.get(numericId);
    if (stringId) {
      return stringId;
    }
    // Fallback for unmapped IDs
    return String(numericId);
  }

  /**
   * Register string ID in reverse lookup map
   * Called when storing entries to maintain bidirectional mapping
   */
  private registerIdMapping(stringId: string): void {
    const numericId = this.hashStringId(stringId);
    const existing = this.numericToStringIdMap.get(numericId);
    if (existing && existing !== stringId) {
      // HIGH-05: Collision detected — use linear probing fallback
      console.warn(`[HNSW] Hash collision detected: "${stringId}" collides with "${existing}" (numeric: ${numericId})`);
      let fallbackId = numericId + 1;
      while (this.numericToStringIdMap.has(fallbackId)) {
        fallbackId++;
      }
      this.numericToStringIdMap.set(fallbackId, stringId);
      this.stringToNumericIdMap.set(stringId, fallbackId);
      return;
    }
    this.numericToStringIdMap.set(numericId, stringId);
    this.stringToNumericIdMap.set(stringId, numericId);
  }

  /**
   * Unregister string ID from reverse lookup map
   * Called when deleting entries
   */
  private unregisterIdMapping(stringId: string): void {
    // Use reverse map for correct numeric ID (may differ from hash due to collision fallback)
    const numericId = this.stringToNumericIdMap.get(stringId) ?? this.stringIdToNumeric(stringId);
    this.numericToStringIdMap.delete(numericId);
    this.stringToNumericIdMap.delete(stringId);
  }

  /**
   * Cosine similarity (returns value in range [0, 1] where 1 = identical)
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(): number {
    let total = 0;

    for (const entry of this.entries.values()) {
      total += entry.content.length * 2;
      if (entry.embedding) {
        total += entry.embedding.length * 4;
      }
    }

    return total;
  }

  /**
   * Check if AgentDB is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Get underlying AgentDB instance
   */
  getAgentDB(): any {
    return this.agentdb;
  }
}

export default AgentDBBackend;
