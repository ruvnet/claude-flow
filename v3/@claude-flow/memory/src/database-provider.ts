/**
 * DatabaseProvider - Platform-aware database selection
 *
 * Automatically selects best backend:
 * - Linux/macOS: better-sqlite3 (native, fast)
 * - Windows: sql.js (WASM, universal) when native fails
 * - Fallback: JSON file storage
 *
 * @module v3/memory/database-provider
 */

import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  MemoryEntryUpdate,
} from './types.js';
import { SQLiteBackend, SQLiteBackendConfig } from './sqlite-backend.js';
import { SqlJsBackend, SqlJsBackendConfig } from './sqljs-backend.js';
import type { EmbeddingGenerator } from './types.js';

/**
 * Available database provider types.
 *
 * ADR-125 Phase 2 added `'hybrid'` and `'agentdb'` so the package can deliver
 * ADR-009's "HybridBackend by default" promise through `createDatabase`.
 */
export type DatabaseProvider =
  | 'better-sqlite3'
  | 'sql.js'
  | 'json'
  | 'rvf'
  | 'hybrid'
  | 'agentdb'
  | 'auto';

/**
 * Database creation options
 */
export interface DatabaseOptions {
  /** Preferred provider (auto = platform-aware selection) */
  provider?: DatabaseProvider;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Enable WAL mode (better-sqlite3 only) */
  walMode?: boolean;

  /** Enable query optimization */
  optimize?: boolean;

  /** Default namespace */
  defaultNamespace?: string;

  /** Maximum entries before auto-cleanup */
  maxEntries?: number;

  /** Auto-persist interval for sql.js (milliseconds) */
  autoPersistInterval?: number;

  /** Path to sql.js WASM file */
  wasmPath?: string;

  /**
   * Embedding generator. Required for `'hybrid'` and `'agentdb'` providers
   * (and recommended for semantic search on any provider).
   */
  embeddingGenerator?: EmbeddingGenerator;

  /** Vector dimensions for `'hybrid'` and `'agentdb'` providers (default 1536) */
  dimensions?: number;
}

/**
 * Platform detection result
 */
interface PlatformInfo {
  os: string;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  recommendedProvider: DatabaseProvider;
}

/**
 * Detect platform and recommend provider
 */
function detectPlatform(): PlatformInfo {
  const os = platform();
  const isWindows = os === 'win32';
  const isMacOS = os === 'darwin';
  const isLinux = os === 'linux';

  // Recommend better-sqlite3 for Unix-like systems, sql.js for Windows
  const recommendedProvider: DatabaseProvider = isWindows ? 'sql.js' : 'better-sqlite3';

  return {
    os,
    isWindows,
    isMacOS,
    isLinux,
    recommendedProvider,
  };
}

/**
 * Test if RVF backend is available (always true — pure-TS fallback)
 */
async function testRvf(): Promise<boolean> {
  return true;
}

/**
 * Test if better-sqlite3 is available and working
 */
async function testBetterSqlite3(): Promise<boolean> {
  try {
    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(':memory:');
    testDb.close();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Test if sql.js is available and working
 */
async function testSqlJs(): Promise<boolean> {
  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const testDb = new SQL.Database();
    testDb.close();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Select best available provider
 */
async function selectProvider(
  preferred?: DatabaseProvider,
  verbose: boolean = false
): Promise<DatabaseProvider> {
  if (preferred && preferred !== 'auto') {
    if (verbose) {
      console.log(`[DatabaseProvider] Using explicitly specified provider: ${preferred}`);
    }
    return preferred;
  }

  const platformInfo = detectPlatform();

  if (verbose) {
    console.log(`[DatabaseProvider] Platform detected: ${platformInfo.os}`);
    console.log(`[DatabaseProvider] Recommended provider: ${platformInfo.recommendedProvider}`);
  }

  // Try RVF first (always available via pure-TS fallback, native when @ruvector/rvf installed)
  if (await testRvf()) {
    if (verbose) {
      console.log('[DatabaseProvider] RVF backend available');
    }
    return 'rvf';
  }

  // Try recommended provider
  if (platformInfo.recommendedProvider === 'better-sqlite3') {
    if (await testBetterSqlite3()) {
      if (verbose) {
        console.log('[DatabaseProvider] better-sqlite3 available and working');
      }
      return 'better-sqlite3';
    } else if (verbose) {
      console.log('[DatabaseProvider] better-sqlite3 not available, trying sql.js');
    }
  }

  // Try sql.js as fallback
  if (await testSqlJs()) {
    if (verbose) {
      console.log('[DatabaseProvider] sql.js available and working');
    }
    return 'sql.js';
  } else if (verbose) {
    console.log('[DatabaseProvider] sql.js not available, using JSON fallback');
  }

  // Final fallback to JSON
  return 'json';
}

/**
 * Create a database instance with platform-aware provider selection
 *
 * @param path - Database file path (:memory: for in-memory)
 * @param options - Database configuration options
 * @returns Initialized database backend
 *
 * @example
 * ```typescript
 * // Auto-select best provider for platform
 * const db = await createDatabase('./data/memory.db');
 *
 * // Force specific provider
 * const db = await createDatabase('./data/memory.db', {
 *   provider: 'sql.js'
 * });
 *
 * // With custom options
 * const db = await createDatabase('./data/memory.db', {
 *   verbose: true,
 *   optimize: true,
 *   autoPersistInterval: 10000
 * });
 * ```
 */
export async function createDatabase(
  path: string,
  options: DatabaseOptions = {}
): Promise<IMemoryBackend> {
  const {
    provider = 'auto',
    verbose = false,
    walMode = true,
    optimize = true,
    defaultNamespace = 'default',
    maxEntries = 1000000,
    autoPersistInterval = 5000,
    wasmPath,
    embeddingGenerator,
    dimensions = 1536,
  } = options;

  // Select provider
  const selectedProvider = await selectProvider(provider, verbose);

  if (verbose) {
    console.log(`[DatabaseProvider] Creating database with provider: ${selectedProvider}`);
    console.log(`[DatabaseProvider] Database path: ${path}`);
  }

  let backend: IMemoryBackend;

  switch (selectedProvider) {
    case 'better-sqlite3': {
      const config: Partial<SQLiteBackendConfig> = {
        databasePath: path,
        walMode,
        optimize,
        defaultNamespace,
        maxEntries,
        verbose,
      };

      backend = new SQLiteBackend(config);
      break;
    }

    case 'sql.js': {
      const config: Partial<SqlJsBackendConfig> = {
        databasePath: path,
        optimize,
        defaultNamespace,
        maxEntries,
        verbose,
        autoPersistInterval,
        wasmPath,
      };

      backend = new SqlJsBackend(config);
      break;
    }

    case 'rvf': {
      const { RvfBackend } = await import('./rvf-backend.js');
      backend = new RvfBackend({
        databasePath: path.replace(/\.(db|json)$/, '.rvf'),
        dimensions,
        verbose,
        defaultNamespace,
        autoPersistInterval,
      });
      break;
    }

    case 'hybrid': {
      // ADR-009: SQLite for structured queries + AgentDB for semantic search.
      const { HybridBackend } = await import('./hybrid-backend.js');
      backend = new HybridBackend({
        sqlite: {
          databasePath: path,
          walMode,
          optimize,
          defaultNamespace,
          maxEntries,
          verbose,
        },
        agentdb: {
          dbPath: path.replace(/\.(db|json|rvf)$/, '.agentdb'),
          namespace: defaultNamespace,
          vectorDimension: dimensions,
          embeddingGenerator,
          maxEntries,
        },
        defaultNamespace,
        embeddingGenerator,
      });
      break;
    }

    case 'agentdb': {
      const { AgentDBBackend } = await import('./agentdb-backend.js');
      backend = new AgentDBBackend({
        dbPath: path,
        namespace: defaultNamespace,
        vectorDimension: dimensions,
        embeddingGenerator,
        maxEntries,
      });
      break;
    }

    case 'json': {
      // Simple JSON file backend (minimal implementation)
      backend = new JsonBackend(path, verbose);
      break;
    }

    default:
      throw new Error(`Unknown database provider: ${selectedProvider}`);
  }

  // Initialize the backend
  await backend.initialize();

  if (verbose) {
    console.log(`[DatabaseProvider] Database initialized successfully`);
  }

  return backend;
}

/**
 * Get platform information
 */
export function getPlatformInfo(): PlatformInfo {
  return detectPlatform();
}

/**
 * Check which providers are available
 */
export async function getAvailableProviders(): Promise<{
  rvf: boolean;
  betterSqlite3: boolean;
  sqlJs: boolean;
  json: boolean;
}> {
  return {
    rvf: true,
    betterSqlite3: await testBetterSqlite3(),
    sqlJs: await testSqlJs(),
    json: true,
  };
}

// ===== JSON Fallback Backend =====

/**
 * Simple JSON file backend for when no SQLite is available
 */
class JsonBackend implements IMemoryBackend {
  private entries: Map<string, MemoryEntry> = new Map();
  private path: string;
  private verbose: boolean;
  private initialized: boolean = false;

  constructor(path: string, verbose: boolean = false) {
    this.path = path;
    this.verbose = verbose;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load from file if exists
    if (this.path !== ':memory:' && existsSync(this.path)) {
      try {
        const fs = await import('node:fs/promises');
        const data = await fs.readFile(this.path, 'utf-8');
        const entries = JSON.parse(data);

        for (const entry of entries) {
          // Convert embedding array back to Float32Array
          if (entry.embedding) {
            entry.embedding = new Float32Array(entry.embedding);
          }
          this.entries.set(entry.id, entry);
        }

        if (this.verbose) {
          console.log(`[JsonBackend] Loaded ${this.entries.size} entries from ${this.path}`);
        }
      } catch (error) {
        if (this.verbose) {
          console.error('[JsonBackend] Error loading file:', error);
        }
      }
    }

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    await this.persist();
    this.initialized = false;
  }

  async store(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    await this.persist();
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) || null;
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    for (const entry of this.entries.values()) {
      if (entry.namespace === namespace && entry.key === key) {
        return entry;
      }
    }
    return null;
  }

  async update(id: string, updateData: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updated = { ...entry, ...updateData, updatedAt: Date.now(), version: entry.version + 1 };
    this.entries.set(id, updated);
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = this.entries.delete(id);
    await this.persist();
    return result;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = Array.from(this.entries.values());

    if (query.namespace) {
      results = results.filter((e) => e.namespace === query.namespace);
    }

    if (query.key) {
      results = results.filter((e) => e.key === query.key);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.every((tag) => e.tags.includes(tag)));
    }

    return results.slice(0, query.limit);
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    // Simple brute-force search
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue;

      const similarity = this.cosineSimilarity(embedding, entry.embedding);
      if (options.threshold && similarity < options.threshold) continue;

      results.push({ entry, score: similarity, distance: 1 - similarity });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.k);
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
    await this.persist();
  }

  async bulkDelete(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (this.entries.delete(id)) count++;
    }
    await this.persist();
    return count;
  }

  async count(namespace?: string): Promise<number> {
    if (!namespace) return this.entries.size;

    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.namespace === namespace) count++;
    }
    return count;
  }

  async listNamespaces(): Promise<string[]> {
    const namespaces = new Set<string>();
    for (const entry of this.entries.values()) {
      namespaces.add(entry.namespace);
    }
    return Array.from(namespaces);
  }

  async clearNamespace(namespace: string): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.namespace === namespace) {
        this.entries.delete(id);
        count++;
      }
    }
    await this.persist();
    return count;
  }

  async getStats(): Promise<BackendStats> {
    return {
      totalEntries: this.entries.size,
      entriesByNamespace: {},
      entriesByType: {} as any,
      memoryUsage: 0,
      avgQueryTime: 0,
      avgSearchTime: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues: [],
      recommendations: ['Consider using SQLite backend for better performance'],
    };
  }

  private async persist(): Promise<void> {
    if (this.path === ':memory:') return;

    const fs = await import('node:fs/promises');
    const entries = Array.from(this.entries.values()).map((e) => ({
      ...e,
      // Convert Float32Array to regular array for JSON serialization
      embedding: e.embedding ? Array.from(e.embedding) : undefined,
    }));

    await fs.writeFile(this.path, JSON.stringify(entries, null, 2));
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
