/**
 * SqlJsBackend - Pure JavaScript SQLite for Windows compatibility
 *
 * When better-sqlite3 native compilation fails on Windows,
 * sql.js provides a WASM-based fallback that works everywhere.
 *
 * @module v3/memory/sqljs-backend
 */

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
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
} from './types.js';

/**
 * Configuration for SqlJs Backend
 */
export interface SqlJsBackendConfig {
  /** Path to SQLite database file (:memory: for in-memory) */
  databasePath: string;

  /** Enable query optimization */
  optimize: boolean;

  /** Default namespace */
  defaultNamespace: string;

  /** Embedding generator (for compatibility with hybrid mode) */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries before auto-cleanup */
  maxEntries: number;

  /** Enable verbose logging */
  verbose: boolean;

  /** Auto-persist interval in milliseconds (0 = manual only) */
  autoPersistInterval: number;

  /** Path to sql.js WASM file (optional, will use CDN default) */
  wasmPath?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SqlJsBackendConfig = {
  databasePath: ':memory:',
  optimize: true,
  defaultNamespace: 'default',
  maxEntries: 1000000,
  verbose: false,
  autoPersistInterval: 5000, // 5 seconds
};

/**
 * SqlJs Backend for Cross-Platform Memory Storage
 *
 * Provides:
 * - Pure JavaScript/WASM implementation (no native compilation)
 * - Windows, macOS, Linux compatibility
 * - Same SQL interface as better-sqlite3
 * - In-memory with periodic disk persistence
 * - Fallback when native SQLite fails
 */
export class SqlJsBackend extends EventEmitter implements IMemoryBackend {
  private config: SqlJsBackendConfig;
  private db: SqlJsDatabase | null = null;
  private initialized: boolean = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private SQL: any = null;

  /** Whether the FTS5 virtual table is available on this build of sql.js. */
  private ftsAvailable: boolean = false;

  // Performance tracking
  private stats = {
    queryCount: 0,
    totalQueryTime: 0,
    writeCount: 0,
    totalWriteTime: 0,
  };

  constructor(config: Partial<SqlJsBackendConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the SqlJs backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load sql.js WASM
    this.SQL = await initSqlJs({
      locateFile: this.config.wasmPath
        ? () => this.config.wasmPath!
        : (file) => `https://sql.js.org/dist/${file}`,
    });

    // Load existing database if exists and not in-memory
    if (this.config.databasePath !== ':memory:' && existsSync(this.config.databasePath)) {
      const buffer = readFileSync(this.config.databasePath);
      this.db = new this.SQL.Database(new Uint8Array(buffer));

      if (this.config.verbose) {
        console.log(`[SqlJsBackend] Loaded database from ${this.config.databasePath}`);
      }
    } else {
      // Create new database
      this.db = new this.SQL.Database();

      if (this.config.verbose) {
        console.log('[SqlJsBackend] Created new in-memory database');
      }
    }

    // Create schema
    this.createSchema();

    // Set up auto-persist if enabled
    if (this.config.autoPersistInterval > 0 && this.config.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        this.persist().catch((err) => {
          this.emit('error', { operation: 'auto-persist', error: err });
        });
      }, this.config.autoPersistInterval);
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the backend
   */
  async shutdown(): Promise<void> {
    if (!this.initialized || !this.db) return;

    // Stop auto-persist timer
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    // Final persist before shutdown
    if (this.config.databasePath !== ':memory:') {
      await this.persist();
    }

    this.db.close();
    this.db = null;
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    if (!this.db) return;

    // Main entries table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        type TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tags TEXT NOT NULL,
        metadata TEXT NOT NULL,
        owner_id TEXT,
        access_level TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        "references" TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER NOT NULL
      )
    `);

    // Indexes for performance
    this.db.run('CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_created_at ON memory_entries(created_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_expires_at ON memory_entries(expires_at)');
    this.db.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_key ON memory_entries(namespace, key)'
    );

    // ADR-125 Phase 5 — FTS5 keyword index. sql.js ships FTS5 since 1.10.
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
          USING fts5(id UNINDEXED, content, tokenize='porter unicode61')
      `);
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }

    if (this.config.verbose) {
      console.log('[SqlJsBackend] Schema created successfully');
    }
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry): Promise<void> {
    this.ensureInitialized();
    const startTime = performance.now();

    const stmt = `
      INSERT OR REPLACE INTO memory_entries (
        id, key, content, embedding, type, namespace, tags, metadata,
        owner_id, access_level, created_at, updated_at, expires_at,
        version, "references", access_count, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const embeddingBuffer = entry.embedding
      ? Buffer.from(entry.embedding.buffer)
      : null;

    this.db!.run(stmt, [
      entry.id,
      entry.key,
      entry.content,
      embeddingBuffer,
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
    ]);

    // ADR-125 Phase 5 — mirror into FTS5 for keyword search.
    if (this.ftsAvailable) {
      this.db!.run('DELETE FROM memory_fts WHERE id = ?', [entry.id]);
      this.db!.run('INSERT INTO memory_fts(id, content) VALUES (?, ?)', [
        entry.id,
        entry.content,
      ]);
    }

    const duration = performance.now() - startTime;
    this.stats.writeCount++;
    this.stats.totalWriteTime += duration;

    this.emit('entry:stored', { entry, duration });
  }

  /**
   * Retrieve a memory entry by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    const stmt = this.db!.prepare('SELECT * FROM memory_entries WHERE id = ?');
    const row = stmt.getAsObject([id]);
    stmt.free();

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    const entry = this.rowToEntry(row);

    // Update access tracking
    this.updateAccessTracking(id);

    this.emit('entry:retrieved', { id, duration });
    return entry;
  }

  /**
   * Retrieve a memory entry by key within a namespace
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    const stmt = this.db!.prepare(
      'SELECT * FROM memory_entries WHERE namespace = ? AND key = ?'
    );
    const row = stmt.getAsObject([namespace, key]);
    stmt.free();

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    const entry = this.rowToEntry(row);

    // Update access tracking
    this.updateAccessTracking(entry.id);

    this.emit('entry:retrieved', { namespace, key, duration });
    return entry;
  }

  /**
   * Update a memory entry
   */
  async update(id: string, updateData: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const startTime = performance.now();

    // Get existing entry
    const existing = await this.get(id);
    if (!existing) return null;

    // Merge updates
    const updated: MemoryEntry = {
      ...existing,
      ...updateData,
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    // Store updated entry
    await this.store(updated);

    const duration = performance.now() - startTime;
    this.emit('entry:updated', { id, update: updateData, duration });

    return updated;
  }

  /**
   * Delete a memory entry
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();
    const startTime = performance.now();

    this.db!.run('DELETE FROM memory_entries WHERE id = ?', [id]);
    if (this.ftsAvailable) {
      this.db!.run('DELETE FROM memory_fts WHERE id = ?', [id]);
    }

    const duration = performance.now() - startTime;
    this.stats.writeCount++;
    this.stats.totalWriteTime += duration;

    this.emit('entry:deleted', { id, duration });
    return true;
  }

  /**
   * ADR-125 Phase 5 — keyword (FTS5) search.
   *
   * Mirrors the SQLiteBackend.searchKeyword shape. Falls back to a LIKE
   * scan when FTS5 isn't available on the sql.js build.
   */
  async searchKeyword(query: string, limit: number = 10): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!query || !query.trim()) return [];

    if (this.ftsAvailable) {
      try {
        const stmt = this.db!.prepare(`
          SELECT e.*, fts.rank as fts_rank
          FROM memory_fts AS fts
          JOIN memory_entries AS e ON e.id = fts.id
          WHERE memory_fts MATCH ?
          ORDER BY fts.rank
          LIMIT ?
        `);
        stmt.bind([escapeFtsQuery(query), limit]);
        const results: SearchResult[] = [];
        while (stmt.step()) {
          const row: any = stmt.getAsObject();
          const entry = this.rowToEntry(row);
          const score = 1 / (1 + Math.abs(row.fts_rank || 0));
          results.push({ entry, score, distance: 1 - score });
        }
        stmt.free();
        return results;
      } catch {
        // Fall through to LIKE
      }
    }

    // LIKE fallback
    const like = `%${query.replace(/[%_]/g, '')}%`;
    const stmt = this.db!.prepare(
      'SELECT * FROM memory_entries WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?'
    );
    stmt.bind([like, limit]);
    const results: SearchResult[] = [];
    while (stmt.step()) {
      const row: any = stmt.getAsObject();
      results.push({
        entry: this.rowToEntry(row),
        score: 0.5,
        distance: 0.5,
      });
    }
    stmt.free();
    return results;
  }

  /**
   * Query memory entries
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    let sql = 'SELECT * FROM memory_entries WHERE 1=1';
    const params: any[] = [];

    // Namespace filter
    if (query.namespace) {
      sql += ' AND namespace = ?';
      params.push(query.namespace);
    }

    // Type filter
    if (query.memoryType) {
      sql += ' AND type = ?';
      params.push(query.memoryType);
    }

    // Owner filter
    if (query.ownerId) {
      sql += ' AND owner_id = ?';
      params.push(query.ownerId);
    }

    // Access level filter
    if (query.accessLevel) {
      sql += ' AND access_level = ?';
      params.push(query.accessLevel);
    }

    // Key filters
    if (query.key) {
      sql += ' AND key = ?';
      params.push(query.key);
    } else if (query.keyPrefix) {
      sql += ' AND key LIKE ?';
      params.push(query.keyPrefix + '%');
    }

    // Time range filters
    if (query.createdAfter) {
      sql += ' AND created_at >= ?';
      params.push(query.createdAfter);
    }
    if (query.createdBefore) {
      sql += ' AND created_at <= ?';
      params.push(query.createdBefore);
    }
    if (query.updatedAfter) {
      sql += ' AND updated_at >= ?';
      params.push(query.updatedAfter);
    }
    if (query.updatedBefore) {
      sql += ' AND updated_at <= ?';
      params.push(query.updatedBefore);
    }

    // Expiration filter
    if (!query.includeExpired) {
      sql += ' AND (expires_at IS NULL OR expires_at > ?)';
      params.push(Date.now());
    }

    // Ordering and pagination
    sql += ' ORDER BY created_at DESC';
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db!.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const results: MemoryEntry[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const entry = this.rowToEntry(row);

      // Tag filtering (post-query since tags are JSON)
      if (query.tags && query.tags.length > 0) {
        const hasAllTags = query.tags.every((tag) => entry.tags.includes(tag));
        if (!hasAllTags) continue;
      }

      // Metadata filtering (post-query since metadata is JSON)
      if (query.metadata) {
        const matchesMetadata = Object.entries(query.metadata).every(
          ([key, value]) => entry.metadata[key] === value
        );
        if (!matchesMetadata) continue;
      }

      results.push(entry);
    }

    stmt.free();

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    this.emit('query:executed', { query, resultCount: results.length, duration });
    return results;
  }

  /**
   * Semantic vector search (limited without vector index)
   */
  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized();

    // Get all entries with embeddings
    const entries = await this.query({
      type: 'hybrid',
      limit: options.filters?.limit || 1000,
    });

    // Calculate cosine similarity for each entry
    const results: SearchResult[] = [];

    for (const entry of entries) {
      if (!entry.embedding) continue;

      const similarity = this.cosineSimilarity(embedding, entry.embedding);

      if (options.threshold && similarity < options.threshold) {
        continue;
      }

      results.push({
        entry,
        score: similarity,
        distance: 1 - similarity,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top k results
    return results.slice(0, options.k);
  }

  /**
   * Bulk insert entries
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    this.ensureInitialized();

    for (const entry of entries) {
      await this.store(entry);
    }

    this.emit('bulk:inserted', { count: entries.length });
  }

  /**
   * Bulk delete entries
   */
  async bulkDelete(ids: string[]): Promise<number> {
    this.ensureInitialized();

    let count = 0;
    for (const id of ids) {
      const success = await this.delete(id);
      if (success) count++;
    }

    this.emit('bulk:deleted', { count });
    return count;
  }

  /**
   * Get entry count
   */
  async count(namespace?: string): Promise<number> {
    this.ensureInitialized();

    let sql = 'SELECT COUNT(*) as count FROM memory_entries';
    const params: any[] = [];

    if (namespace) {
      sql += ' WHERE namespace = ?';
      params.push(namespace);
    }

    const stmt = this.db!.prepare(sql);
    const row = stmt.getAsObject(params);
    stmt.free();

    return (row.count as number) || 0;
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<string[]> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT DISTINCT namespace FROM memory_entries');
    const namespaces: string[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      namespaces.push(row.namespace as string);
    }

    stmt.free();
    return namespaces;
  }

  /**
   * Clear all entries in a namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    this.ensureInitialized();

    const countBefore = await this.count(namespace);
    this.db!.run('DELETE FROM memory_entries WHERE namespace = ?', [namespace]);

    this.emit('namespace:cleared', { namespace, count: countBefore });
    return countBefore;
  }

  /**
   * Get backend statistics
   */
  async getStats(): Promise<BackendStats> {
    this.ensureInitialized();

    const total = await this.count();

    // Count by namespace
    const entriesByNamespace: Record<string, number> = {};
    const namespaces = await this.listNamespaces();
    for (const ns of namespaces) {
      entriesByNamespace[ns] = await this.count(ns);
    }

    // Count by type
    const entriesByType: Record<MemoryType, number> = {} as any;
    const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'working', 'cache'];
    for (const type of types) {
      const stmt = this.db!.prepare('SELECT COUNT(*) as count FROM memory_entries WHERE type = ?');
      const row = stmt.getAsObject([type]);
      stmt.free();
      entriesByType[type] = (row.count as number) || 0;
    }

    return {
      totalEntries: total,
      entriesByNamespace,
      entriesByType,
      memoryUsage: this.estimateMemoryUsage(),
      avgQueryTime: this.stats.queryCount > 0 ? this.stats.totalQueryTime / this.stats.queryCount : 0,
      avgSearchTime: 0, // Not tracked separately
    };
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Storage health
    const storageStart = performance.now();
    const storageHealthy = this.db !== null;
    const storageLatency = performance.now() - storageStart;

    if (!storageHealthy) {
      issues.push('Database not initialized');
    }

    // Index health (sql.js doesn't have native vector index)
    const indexHealth: ComponentHealth = {
      status: 'healthy',
      latency: 0,
      message: 'No vector index (brute-force search)',
    };

    recommendations.push('Consider using better-sqlite3 with HNSW for faster vector search');

    // Cache health (not applicable for sql.js)
    const cacheHealth: ComponentHealth = {
      status: 'healthy',
      latency: 0,
      message: 'No separate cache layer',
    };

    const status = issues.length === 0 ? 'healthy' : 'degraded';

    return {
      status,
      components: {
        storage: {
          status: storageHealthy ? 'healthy' : 'unhealthy',
          latency: storageLatency,
        },
        index: indexHealth,
        cache: cacheHealth,
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  /**
   * Persist changes to disk (sql.js is in-memory, needs explicit save)
   */
  async persist(): Promise<void> {
    if (!this.db || this.config.databasePath === ':memory:') {
      return;
    }

    const data = this.db.export();
    const buffer = Buffer.from(data);

    writeFileSync(this.config.databasePath, buffer);

    if (this.config.verbose) {
      console.log(`[SqlJsBackend] Persisted ${buffer.length} bytes to ${this.config.databasePath}`);
    }

    this.emit('persisted', { size: buffer.length, path: this.config.databasePath });
  }

  // ===== Helper Methods =====

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SqlJsBackend not initialized. Call initialize() first.');
    }
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id as string,
      key: row.key as string,
      content: row.content as string,
      embedding: row.embedding
        ? new Float32Array(new Uint8Array(row.embedding as Uint8Array).buffer)
        : undefined,
      type: row.type as MemoryType,
      namespace: row.namespace as string,
      tags: safeJsonParse<string[]>((row.tags as string) || '[]'),
      metadata: safeJsonParse<Record<string, unknown>>((row.metadata as string) || '{}'),
      ownerId: row.owner_id as string | undefined,
      accessLevel: row.access_level as any,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      expiresAt: row.expires_at as number | undefined,
      version: row.version as number,
      references: safeJsonParse<string[]>((row.references as string) || '[]'),
      accessCount: row.access_count as number,
      lastAccessedAt: row.last_accessed_at as number,
    };
  }

  private updateAccessTracking(id: string): void {
    if (!this.db) return;

    this.db.run(
      'UPDATE memory_entries SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
      [Date.now(), id]
    );
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private estimateMemoryUsage(): number {
    if (!this.db) return 0;

    // Export to get size
    const data = this.db.export();
    return data.length;
  }
}

/**
 * Escape an FTS5 MATCH query string. Wraps each whitespace-separated
 * token as a quoted phrase so prose input doesn't trip FTS5's mini-language.
 * @internal
 */
function escapeFtsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `"${tok.replace(/"/g, '""')}"`)
    .join(' ');
}
