/**
 * SQLite-backed Persistent Cache for Embeddings (sql.js)
 *
 * Features:
 * - Cross-platform support (pure JavaScript/WASM, no native compilation)
 * - Disk persistence across sessions
 * - LRU eviction with configurable max size
 * - Automatic schema creation
 * - TTL support for cache entries
 * - Lazy initialization (no startup cost if not used)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// Use 'any' for sql.js types to avoid complex typing issues
// sql.js has its own types but they don't always match perfectly
type SqlJsDatabase = any;
type SqlJsStatic = any;

/**
 * Configuration for persistent cache
 */
export interface PersistentCacheConfig {
  /** Path to SQLite database file */
  dbPath: string;
  /** Maximum number of entries (default: 10000) */
  maxSize?: number;
  /** TTL in milliseconds (default: 7 days) */
  ttlMs?: number;
  /** Enable compression for large embeddings */
  compress?: boolean;
  /** Auto-save interval in ms (default: 30000) */
  autoSaveInterval?: number;
}

/**
 * Cache statistics
 */
export interface PersistentCacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  hits: number;
  misses: number;
  dbSizeBytes?: number;
}

/**
 * SQLite-backed persistent embedding cache using sql.js (pure JS/WASM)
 */
export class PersistentEmbeddingCache {
  private db: SqlJsDatabase | null = null;
  private SQL: SqlJsStatic | null = null;
  private initialized = false;
  private dirty = false;
  private hits = 0;
  private misses = 0;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  private readonly dbPath: string;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly autoSaveInterval: number;

  constructor(config: PersistentCacheConfig) {
    this.dbPath = config.dbPath;
    this.maxSize = config.maxSize ?? 10000;
    this.ttlMs = config.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.autoSaveInterval = config.autoSaveInterval ?? 30000; // 30 seconds
  }

  /**
   * Lazily initialize database connection
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamically import sql.js
      const initSqlJs = (await import('sql.js')).default;

      // Initialize sql.js (loads WASM)
      this.SQL = await initSqlJs();

      // Ensure directory exists
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Load existing database or create new
      if (existsSync(this.dbPath)) {
        const fileBuffer = readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
      } else {
        this.db = new this.SQL.Database();
      }

      // Create schema
      this.db.run(`
        CREATE TABLE IF NOT EXISTS embeddings (
          key TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          dimensions INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          access_count INTEGER DEFAULT 1
        )
      `);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_accessed_at ON embeddings(accessed_at)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_created_at ON embeddings(created_at)');

      // Clean expired entries on startup
      this.cleanExpired();

      // Save after initialization to persist schema
      this.saveToFile();

      // Start auto-save timer
      this.startAutoSave();

      this.initialized = true;
    } catch (error) {
      // If sql.js not available, fall back gracefully
      console.warn('[persistent-cache] sql.js not available, cache disabled:',
        error instanceof Error ? error.message : error);
      this.initialized = true; // Mark as initialized to prevent retry
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) return;

    this.autoSaveTimer = setInterval(() => {
      if (this.dirty && this.db) {
        this.saveToFile();
      }
    }, this.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Save database to file
   */
  private saveToFile(): void {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this.dirty = false;
    } catch (error) {
      console.error('[persistent-cache] Save error:', error);
    }
  }

  /**
   * Generate cache key from text
   */
  private hashKey(text: string): string {
    // FNV-1a hash for fast, deterministic key generation
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return `emb_${hash.toString(16)}_${text.length}`;
  }

  /**
   * Serialize Float32Array to Uint8Array for sql.js
   */
  private serializeEmbedding(embedding: Float32Array): Uint8Array {
    return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }

  /**
   * Deserialize Uint8Array to Float32Array
   */
  private deserializeEmbedding(data: Uint8Array, dimensions: number): Float32Array {
    const buffer = new ArrayBuffer(data.length);
    const view = new Uint8Array(buffer);
    view.set(data);
    return new Float32Array(buffer);
  }

  /**
   * Get embedding from cache
   */
  async get(text: string): Promise<Float32Array | null> {
    await this.ensureInitialized();
    if (!this.db) {
      this.misses++;
      return null;
    }

    const key = this.hashKey(text);
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        SELECT embedding, dimensions, created_at
        FROM embeddings
        WHERE key = ?
      `);
      stmt.bind([key]);

      if (!stmt.step()) {
        stmt.free();
        this.misses++;
        return null;
      }

      const row = stmt.getAsObject() as {
        embedding: Uint8Array;
        dimensions: number;
        created_at: number;
      };
      stmt.free();

      // Check TTL
      if (now - row.created_at > this.ttlMs) {
        this.db.run('DELETE FROM embeddings WHERE key = ?', [key]);
        this.dirty = true;
        this.misses++;
        return null;
      }

      // Update access time and count
      this.db.run(`
        UPDATE embeddings
        SET accessed_at = ?, access_count = access_count + 1
        WHERE key = ?
      `, [now, key]);
      this.dirty = true;

      this.hits++;
      return this.deserializeEmbedding(row.embedding, row.dimensions);
    } catch (error) {
      console.error('[persistent-cache] Get error:', error);
      this.misses++;
      return null;
    }
  }

  /**
   * Store embedding in cache
   */
  async set(text: string, embedding: Float32Array): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    const key = this.hashKey(text);
    const now = Date.now();
    const data = this.serializeEmbedding(embedding);

    try {
      // Upsert entry using INSERT OR REPLACE
      this.db.run(`
        INSERT OR REPLACE INTO embeddings
        (key, embedding, dimensions, created_at, accessed_at, access_count)
        VALUES (?, ?, ?, ?, ?,
          COALESCE((SELECT access_count + 1 FROM embeddings WHERE key = ?), 1)
        )
      `, [key, data, embedding.length, now, now, key]);
      this.dirty = true;

      // Check size and evict if needed
      await this.evictIfNeeded();
    } catch (error) {
      console.error('[persistent-cache] Set error:', error);
    }
  }

  /**
   * Evict oldest entries if cache exceeds max size
   */
  private async evictIfNeeded(): Promise<void> {
    if (!this.db) return;

    const result = this.db.exec('SELECT COUNT(*) as count FROM embeddings');
    const count = result[0]?.values[0]?.[0] as number ?? 0;

    if (count > this.maxSize) {
      const toDelete = count - this.maxSize + Math.floor(this.maxSize * 0.1); // Delete 10% extra
      this.db.run(`
        DELETE FROM embeddings
        WHERE key IN (
          SELECT key FROM embeddings
          ORDER BY accessed_at ASC
          LIMIT ?
        )
      `, [toDelete]);
      this.dirty = true;
    }
  }

  /**
   * Clean expired entries
   */
  private cleanExpired(): void {
    if (!this.db) return;

    const cutoff = Date.now() - this.ttlMs;
    this.db.run('DELETE FROM embeddings WHERE created_at < ?', [cutoff]);
    this.dirty = true;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<PersistentCacheStats> {
    await this.ensureInitialized();

    const total = this.hits + this.misses;
    const stats: PersistentCacheStats = {
      size: 0,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    };

    if (this.db) {
      const result = this.db.exec('SELECT COUNT(*) as count FROM embeddings');
      stats.size = result[0]?.values[0]?.[0] as number ?? 0;

      // Get file size if exists
      if (existsSync(this.dbPath)) {
        try {
          const buffer = readFileSync(this.dbPath);
          stats.dbSizeBytes = buffer.length;
        } catch {
          // Ignore
        }
      }
    }

    return stats;
  }

  /**
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    this.db.run('DELETE FROM embeddings');
    this.dirty = true;
    this.hits = 0;
    this.misses = 0;
    this.saveToFile();
  }

  /**
   * Force save to disk
   */
  async flush(): Promise<void> {
    await this.ensureInitialized();
    if (this.db && this.dirty) {
      this.saveToFile();
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.stopAutoSave();

    if (this.db) {
      // Save before closing
      if (this.dirty) {
        this.saveToFile();
      }
      this.db.close();
      this.db = null;
      this.SQL = null;
      this.initialized = false;
    }
  }
}

/**
 * Check if persistent cache is available (sql.js installed)
 */
export async function isPersistentCacheAvailable(): Promise<boolean> {
  try {
    const initSqlJs = (await import('sql.js')).default;
    await initSqlJs();
    return true;
  } catch {
    return false;
  }
}
