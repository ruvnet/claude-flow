/**
 * SQLiteBackend
 *
 * Persistent memory backend for structured storage.
 * Part of the hybrid memory system per ADR-009.
 *
 * Storage: memories are kept in an in-memory index and persisted to `dbPath`
 * as a JSON document. Every mutation rewrites the file atomically (write to a
 * temporary sibling file, then rename over the target), so a crash never
 * leaves a half-written database. A new instance opened on the same `dbPath`
 * sees everything a previous instance stored.
 *
 * This keeps the backend dependency-free (no native SQLite binding is
 * required, and it works on every supported Node version). The public API is
 * unchanged, so the storage engine can later move to real SQLite
 * (better-sqlite3 / node:sqlite) without touching callers.
 *
 * Pass ':memory:' (or an empty string) as `dbPath` for a non-persistent store.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  Memory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult
} from '../../shared/types';

/** On-disk format version for the JSON database file. */
const FILE_FORMAT_VERSION = 1;

interface PersistedDatabase {
  version: number;
  memories: Memory[];
}

export class SQLiteBackend implements MemoryBackend {
  private dbPath: string;
  private memories: Map<string, Memory>;
  private initialized: boolean = false;
  /** Serialises file writes so concurrent mutations cannot interleave renames. */
  private writeChain: Promise<void> = Promise.resolve();
  private tmpCounter = 0;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.memories = new Map();
  }

  /**
   * Open the database: load any existing data stored at dbPath.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.memories = new Map();
    if (this.isPersistent()) {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      const loaded = await this.readDatabaseFile();
      for (const memory of loaded) {
        this.memories.set(memory.id, memory);
      }
    }

    this.initialized = true;
  }

  /**
   * Close the database connection.
   *
   * Pending writes are flushed first. Only the in-memory cache is dropped; the
   * data on disk stays and is reloaded by the next initialize().
   */
  async close(): Promise<void> {
    await this.writeChain;
    this.memories.clear();
    this.initialized = false;
  }

  /**
   * Store a memory
   */
  async store(memory: Memory): Promise<Memory> {
    await this.ensureInitialized();
    this.memories.set(memory.id, { ...memory });
    await this.persist();
    return memory;
  }

  /**
   * Retrieve a memory by ID
   */
  async retrieve(id: string): Promise<Memory | undefined> {
    await this.ensureInitialized();
    return this.memories.get(id);
  }

  /**
   * Update a memory
   */
  async update(memory: Memory): Promise<void> {
    await this.ensureInitialized();
    if (this.memories.has(memory.id)) {
      this.memories.set(memory.id, { ...memory });
      await this.persist();
    }
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();
    if (this.memories.delete(id)) {
      await this.persist();
    }
  }

  /**
   * Query memories with filters
   */
  async query(query: MemoryQuery): Promise<Memory[]> {
    await this.ensureInitialized();
    let results = Array.from(this.memories.values());

    // Filter by agentId
    if (query.agentId) {
      results = results.filter(m => m.agentId === query.agentId);
    }

    // Filter by type
    if (query.type) {
      results = results.filter(m => m.type === query.type);
    }

    // Filter by time range
    if (query.timeRange) {
      results = results.filter(
        m => m.timestamp >= query.timeRange!.start && m.timestamp <= query.timeRange!.end
      );
    }

    // Filter by metadata
    if (query.metadata) {
      results = results.filter(m => {
        if (!m.metadata) return false;
        return Object.entries(query.metadata!).every(
          ([key, value]) => m.metadata![key] === value
        );
      });
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    if (query.offset !== undefined) {
      results = results.slice(query.offset);
    }
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Vector search (not supported in SQLite, returns empty)
   */
  async vectorSearch(embedding: number[], k?: number): Promise<MemorySearchResult[]> {
    // SQLite doesn't support vector search natively
    // Return empty array - vector search handled by AgentDB
    return [];
  }

  /**
   * Clear all memories for an agent
   */
  async clearAgent(agentId: string): Promise<void> {
    await this.ensureInitialized();
    let changed = false;
    for (const [id, memory] of this.memories.entries()) {
      if (memory.agentId === agentId) {
        this.memories.delete(id);
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  /**
   * Get database path
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Get memory count
   */
  getCount(): number {
    return this.memories.size;
  }

  // ==========================================================================
  // Persistence helpers
  // ==========================================================================

  private isPersistent(): boolean {
    return this.dbPath !== '' && this.dbPath !== ':memory:';
  }

  /**
   * Load lazily so that using the backend before initialize() (or after
   * close()) never overwrites data already stored on disk.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async readDatabaseFile(): Promise<Memory[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.dbPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    if (raw.trim() === '') {
      return [];
    }

    let parsed: PersistedDatabase;
    try {
      parsed = JSON.parse(raw) as PersistedDatabase;
    } catch (error) {
      // Refuse to open (and later overwrite) a file we cannot read.
      throw new Error(
        `SQLiteBackend: ${this.dbPath} is not a readable memory database: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== FILE_FORMAT_VERSION ||
      !Array.isArray(parsed.memories)
    ) {
      throw new Error(
        `SQLiteBackend: ${this.dbPath} has an unsupported format (expected version ${FILE_FORMAT_VERSION})`
      );
    }

    return parsed.memories;
  }

  /**
   * Write the current contents to dbPath atomically (tmp file + rename).
   * Writes are queued so they land on disk in mutation order.
   */
  private persist(): Promise<void> {
    if (!this.isPersistent()) {
      return Promise.resolve();
    }

    const snapshot: PersistedDatabase = {
      version: FILE_FORMAT_VERSION,
      memories: Array.from(this.memories.values())
    };
    const data = JSON.stringify(snapshot);
    const tmpPath = `${this.dbPath}.${process.pid}.${++this.tmpCounter}.tmp`;

    const write = async (): Promise<void> => {
      try {
        await fs.writeFile(tmpPath, data, 'utf8');
        await fs.rename(tmpPath, this.dbPath);
      } catch (error) {
        await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };

    const result = this.writeChain.then(write, write);
    // Keep the chain alive after a failed write; the caller still sees the error.
    this.writeChain = result.catch(() => undefined);
    return result;
  }
}

export { SQLiteBackend as default };
