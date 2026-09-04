/**
 * AgentDBBackend
 *
 * Vector database backend using HNSW for semantic search.
 * Part of the hybrid memory system per ADR-009.
 * Provides logarithmic-time approximate nearest-neighbor search via
 * hnswlib-node, honoring the constructor's `hnswM` and `efConstruction`
 * parameters that were previously stored but unused.
 *
 * Algorithmic complexity:
 *   - vectorSearch:  O(log N) expected (HNSW), vs O(N) brute-force prior
 *   - store/update:  O(log N) expected (HNSW addPoint), vs O(1) prior
 *   - delete:        O(1) markDelete (deleted points are tombstoned;
 *                    space is reclaimed when the index resizes)
 *
 * Persistence:
 *   When `dbPath` is a real filesystem path (not ':memory:' / empty),
 *   the HNSW index is loaded on initialize() if the file exists, and
 *   persisted on close() via writeIndex(). The Memory map and the
 *   id ↔ label mapping are persisted to a sibling JSON file.
 *
 * Replaces the prior in-memory Map + brute-force cosine stub. The
 * constructor and MemoryBackend interface contracts are preserved.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HierarchicalNSW } from 'hnswlib-node';
import type {
  Memory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult,
  AgentDBOptions,
} from '../../shared/types';

const INITIAL_CAPACITY = 10_000;
const RESIZE_FACTOR = 2;

interface SidecarState {
  memories: Memory[];
  idToLabel: Array<[string, number]>;
  nextLabel: number;
  maxElements: number;
}

export class AgentDBBackend implements MemoryBackend {
  private dbPath: string;
  private dimensions: number;
  private hnswM: number;
  private efConstruction: number;

  private memories: Map<string, Memory>;
  private idToLabel: Map<string, number>;
  private labelToId: Map<number, string>;

  private hnsw: HierarchicalNSW | null;
  private nextLabel: number;
  private maxElements: number;
  private initialized: boolean;

  constructor(options: AgentDBOptions) {
    this.dbPath = options.dbPath;
    this.dimensions = options.dimensions || 384;
    this.hnswM = options.hnswM || 16;
    this.efConstruction = options.efConstruction || 200;

    this.memories = new Map();
    this.idToLabel = new Map();
    this.labelToId = new Map();

    this.hnsw = null;
    this.nextLabel = 0;
    this.maxElements = INITIAL_CAPACITY;
    this.initialized = false;
  }

  /**
   * Initialize the HNSW index. Loads existing index + sidecar from disk
   * when `dbPath` points to an existing file pair.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.hnsw = new HierarchicalNSW('cosine', this.dimensions);

    const indexPath = this.indexFilePath();
    const sidecarPath = this.sidecarFilePath();
    const canPersist = this.isPersistent();
    const indexExists =
      canPersist && fs.existsSync(indexPath) && fs.existsSync(sidecarPath);

    if (indexExists) {
      const sidecar = JSON.parse(
        fs.readFileSync(sidecarPath, 'utf-8')
      ) as SidecarState;
      this.hnsw.readIndex(indexPath, true);
      this.hnsw.resizeIndex(sidecar.maxElements);
      this.maxElements = sidecar.maxElements;
      this.nextLabel = sidecar.nextLabel;
      for (const memory of sidecar.memories) {
        this.memories.set(memory.id, memory);
      }
      for (const [id, label] of sidecar.idToLabel) {
        this.idToLabel.set(id, label);
        this.labelToId.set(label, id);
      }
    } else {
      this.hnsw.initIndex(this.maxElements, this.hnswM, this.efConstruction);
    }

    // Set query-time ef (controls recall vs latency). Default to a value
    // that's never lower than the configured efConstruction's floor.
    this.hnsw.setEf(Math.max(50, this.hnswM * 4));

    this.initialized = true;
  }

  /**
   * Close the database connection and persist if dbPath is set.
   */
  async close(): Promise<void> {
    if (this.hnsw && this.isPersistent()) {
      try {
        const indexPath = this.indexFilePath();
        const sidecarPath = this.sidecarFilePath();
        const dir = path.dirname(indexPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.hnsw.writeIndex(indexPath);
        const sidecar: SidecarState = {
          memories: Array.from(this.memories.values()),
          idToLabel: Array.from(this.idToLabel.entries()),
          nextLabel: this.nextLabel,
          maxElements: this.maxElements,
        };
        fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
      } catch {
        // Persistence is best-effort; never let it break shutdown.
      }
    }
    this.memories.clear();
    this.idToLabel.clear();
    this.labelToId.clear();
    this.hnsw = null;
    this.nextLabel = 0;
    this.maxElements = INITIAL_CAPACITY;
    this.initialized = false;
  }

  /**
   * Store a memory with optional embedding. If the memory has an
   * embedding, it's added to the HNSW index too.
   */
  async store(memory: Memory): Promise<Memory> {
    this.assertInitialized();
    this.memories.set(memory.id, { ...memory });
    if (memory.embedding && memory.embedding.length > 0) {
      this.assertDimension(memory.embedding);
      const existingLabel = this.idToLabel.get(memory.id);
      if (existingLabel === undefined) {
        const label = this.nextLabel++;
        this.idToLabel.set(memory.id, label);
        this.labelToId.set(label, memory.id);
        this.ensureCapacity(label + 1);
        this.hnsw!.addPoint(memory.embedding, label);
      } else {
        // Re-storing an existing id with a new embedding: tombstone the
        // old vector, allocate a fresh label so the new vector is queried.
        try {
          this.hnsw!.markDelete(existingLabel);
        } catch {
          /* not previously indexed — fine */
        }
        const newLabel = this.nextLabel++;
        this.idToLabel.set(memory.id, newLabel);
        this.labelToId.delete(existingLabel);
        this.labelToId.set(newLabel, memory.id);
        this.ensureCapacity(newLabel + 1);
        this.hnsw!.addPoint(memory.embedding, newLabel);
      }
    }
    return memory;
  }

  async retrieve(id: string): Promise<Memory | undefined> {
    return this.memories.get(id);
  }

  /**
   * Update a memory. Re-indexes the embedding if it changed.
   */
  async update(memory: Memory): Promise<void> {
    if (!this.memories.has(memory.id)) return;
    await this.store(memory);
  }

  /**
   * Delete a memory. Tombstones its vector in the HNSW index.
   */
  async delete(id: string): Promise<void> {
    this.memories.delete(id);
    const label = this.idToLabel.get(id);
    if (label !== undefined && this.hnsw) {
      try {
        this.hnsw.markDelete(label);
      } catch {
        /* not in index — nothing to delete */
      }
      this.idToLabel.delete(id);
      this.labelToId.delete(label);
    }
  }

  /**
   * Filter-based query (agent / type / time / metadata / pagination).
   * The HNSW index is not used here — this is a metadata scan, not a
   * vector search; for vector search use vectorSearch().
   */
  async query(query: MemoryQuery): Promise<Memory[]> {
    let results = Array.from(this.memories.values());

    if (query.agentId) {
      results = results.filter(m => m.agentId === query.agentId);
    }
    if (query.type) {
      results = results.filter(m => m.type === query.type);
    }
    if (query.timeRange) {
      const { start, end } = query.timeRange;
      results = results.filter(m => m.timestamp >= start && m.timestamp <= end);
    }
    if (query.metadata) {
      const expected = query.metadata;
      results = results.filter(m => {
        if (!m.metadata) return false;
        return Object.entries(expected).every(([k, v]) => m.metadata![k] === v);
      });
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (query.offset !== undefined) results = results.slice(query.offset);
    if (query.limit !== undefined) results = results.slice(0, query.limit);

    return results;
  }

  /**
   * Vector similarity search using HNSW.
   * Expected complexity O(log N). 'cosine' space distance d corresponds
   * to similarity = 1 - d, so results are sorted by similarity descending.
   */
  async vectorSearch(
    embedding: number[],
    k: number = 10
  ): Promise<MemorySearchResult[]> {
    this.assertInitialized();
    if (this.idToLabel.size === 0) return [];
    this.assertDimension(embedding);

    const knn = Math.min(k, this.idToLabel.size);
    const result = this.hnsw!.searchKnn(embedding, knn);

    const out: MemorySearchResult[] = [];
    for (let i = 0; i < result.neighbors.length; i++) {
      const label = result.neighbors[i];
      const id = this.labelToId.get(label);
      if (!id) continue; // tombstoned or stale
      const memory = this.memories.get(id);
      if (!memory) continue;
      out.push({
        ...memory,
        similarity: 1 - result.distances[i],
      });
    }
    return out;
  }

  /**
   * Clear all memories for a specific agent.
   */
  async clearAgent(agentId: string): Promise<void> {
    const idsToDelete: string[] = [];
    for (const [id, memory] of this.memories.entries()) {
      if (memory.agentId === agentId) idsToDelete.push(id);
    }
    for (const id of idsToDelete) {
      await this.delete(id);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.initialized || !this.hnsw) {
      throw new Error(
        'AgentDBBackend not initialized; call initialize() first'
      );
    }
  }

  private assertDimension(vec: number[]): void {
    if (vec.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: got ${vec.length}, expected ${this.dimensions}`
      );
    }
  }

  private ensureCapacity(needed: number): void {
    if (!this.hnsw) return;
    if (needed > this.maxElements) {
      const newMax = Math.max(
        this.maxElements * RESIZE_FACTOR,
        needed + 1000
      );
      this.hnsw.resizeIndex(newMax);
      this.maxElements = newMax;
    }
  }

  private isPersistent(): boolean {
    return Boolean(this.dbPath) && this.dbPath !== ':memory:';
  }

  private indexFilePath(): string {
    return this.dbPath;
  }

  private sidecarFilePath(): string {
    return `${this.dbPath}.sidecar.json`;
  }

  // ── existing public accessors (preserved) ────────────────────────

  getDbPath(): string {
    return this.dbPath;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getHnswM(): number {
    return this.hnswM;
  }

  /**
   * New: report the index size for observability. Replaces the
   * hardcoded `0` in HybridBackend.getStats().agentdb.
   */
  getIndexSize(): number {
    return this.idToLabel.size;
  }

  /**
   * New: report HNSW efConstruction (read-back of constructor arg).
   */
  getEfConstruction(): number {
    return this.efConstruction;
  }
}

export { AgentDBBackend as default };
