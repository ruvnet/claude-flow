/**
 * InMemoryBackend (previously SQLiteBackend)
 *
 * In-memory storage backend using a Map. The original class name
 * "SQLiteBackend" was misleading — no SQL queries are executed here,
 * so claims about "parameterized SQL queries" in SECURITY.md are
 * inapplicable to this module. Renamed for clarity per security review.
 *
 * A real SQLite backend would be added in a future ADR.
 * Part of the hybrid memory system per ADR-009.
 */

import type {
  Memory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult
} from '../../shared/types';

export class InMemoryBackend implements MemoryBackend {
  private dbPath: string;
  private memories: Map<string, Memory>;
  private initialized: boolean = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.memories = new Map();
  }

  /**
   * Initialize the in-memory store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Pure in-memory storage — no SQLite, no SQL queries.
    // A real persistent backend would be plumbed in a future ADR.
    this.initialized = true;
  }

  /**
   * Clear the in-memory store
   */
  async close(): Promise<void> {
    this.memories.clear();
    this.initialized = false;
  }

  /**
   * Store a memory
   */
  async store(memory: Memory): Promise<Memory> {
    this.memories.set(memory.id, { ...memory });
    return memory;
  }

  /**
   * Retrieve a memory by ID
   */
  async retrieve(id: string): Promise<Memory | undefined> {
    return this.memories.get(id);
  }

  /**
   * Update a memory
   */
  async update(memory: Memory): Promise<void> {
    if (this.memories.has(memory.id)) {
      this.memories.set(memory.id, { ...memory });
    }
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<void> {
    this.memories.delete(id);
  }

  /**
   * Query memories with filters
   */
  async query(query: MemoryQuery): Promise<Memory[]> {
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
   * Vector search — not supported in the in-memory backend.
   * Returns empty; vector search is handled by AgentDB.
   */
  async vectorSearch(_embedding: number[], _k?: number): Promise<MemorySearchResult[]> {
    return [];
  }

  /**
   * Clear all memories for an agent
   */
  async clearAgent(agentId: string): Promise<void> {
    for (const [id, memory] of this.memories.entries()) {
      if (memory.agentId === agentId) {
        this.memories.delete(id);
      }
    }
  }

  /**
   * Get store path
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
}

// Keep the old name as an alias for backward compatibility.
export { InMemoryBackend as SQLiteBackend };
export { InMemoryBackend as default };
