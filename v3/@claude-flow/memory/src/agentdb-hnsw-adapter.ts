/**
 * Adapter for agentdb's separately exported HNSWIndex, not a controller.
 *
 * alpha.20 requires buildIndex() before search/add, does not upsert duplicate
 * IDs, and does not remove native points on delete. Rebuild a disposable index
 * lazily from the authoritative in-memory entries after mutations. This trades
 * write-heavy performance for correctness; it is not a persistence layer.
 */
import type { HNSWIndex as NativeIndex } from 'agentdb';
import type { HNSWStats, MemoryEntry } from './types.js';

type IndexConstructor = new (
  db: unknown,
  config: ConstructorParameters<typeof NativeIndex>[1],
) => NativeIndex;

interface AdapterConfig {
  dimension: number;
  M: number;
  efConstruction: number;
  efSearch: number;
}

export class AgentDBHnswAdapter {
  private index?: NativeIndex;
  private ids = new Map<number, string>();
  private revision = 0;
  private building?: Promise<boolean>;
  private searching: Promise<unknown> = Promise.resolve();
  private failed = false;
  private buildTime = 0;

  constructor(
    private readonly Index: IndexConstructor,
    private readonly config: AdapterConfig,
  ) {
    // hnswlib-node coerces these values to uint32, rather than validating them.
    const uint = (value: number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;
    this.failed = !uint(config.dimension) || !uint(config.efConstruction) ||
      !uint(config.efSearch) || !uint(config.M) || config.M < 2 || config.M > 10000;
  }

  private normalize(vector: Float32Array): Float32Array {
    // Accumulate in JS double precision: the native cosine implementation can
    // overflow/underflow its float32 norm even when all coordinates are finite.
    let squaredNorm = 0;
    for (const value of vector) squaredNorm += value * value;
    const norm = Math.sqrt(squaredNorm);
    return Float32Array.from(vector, (value) => norm === 0 ? 0 : value / norm);
  }

  invalidate(): void {
    this.revision++;
    // An in-flight search owns its old instance until it completes. Do not
    // clear that instance beneath it; the revision check rejects stale results.
    this.index = undefined;
    this.ids = new Map();
  }

  private async build(getEntries: () => readonly MemoryEntry[]): Promise<boolean> {
    if (this.failed) return false;
    if (this.index) return true;
    if (this.building) return this.building;

    const revision = this.revision;
    const vectors = getEntries().filter((entry) => entry.embedding);
    if (vectors.length === 0) return false;
    // Never feed malformed data to a native addon. Preserve fallback behavior
    // for callers whose embedding dimensions do not match the configured index.
    if (vectors.some(({ embedding }) =>
      embedding!.length !== this.config.dimension ||
      !embedding!.every(Number.isFinite),
    )) return false;

    const ids = new Map(vectors.map((entry, id) => [id, entry.id]));
    const rows = vectors.map((entry, id) => ({
      id,
      embedding: this.normalize(entry.embedding!),
    }));
    this.building = (async () => {
      try {
        // HNSWIndex reads this one fixed query. No user-controlled SQL, tables,
        // filters, native persistence sidecars, or shared AgentDB controller.
        const db = {
          prepare(sql: string) {
            if (sql.replace(/\s+/g, ' ').trim() !==
                'SELECT pattern_id as id, embedding FROM pattern_embeddings') {
              throw new Error('Unsupported HNSW snapshot query');
            }
            return { all: () => rows };
          },
        };
        const candidate = new this.Index(db, {
          ...this.config,
          metric: 'cosine',
          persistIndex: false,
          // Do not preallocate the backend's million-entry default capacity.
          maxElements: rows.length,
        });
        const start = performance.now();
        await candidate.buildIndex();
        if (revision !== this.revision || !candidate.isReady()) return false;
        this.buildTime = performance.now() - start;
        this.index = candidate;
        this.ids = ids;
        return true;
      } catch {
        // A missing/incompatible native addon must not break semantic search or
        // throw/log the same exception on every request. Retry on reinitialize.
        this.failed = true;
        return false;
      }
    })();
    try {
      return await this.building;
    } finally {
      this.building = undefined;
    }
  }

  async search(
    getEntries: () => readonly MemoryEntry[],
    embedding: Float32Array,
    k: number,
    ef?: number,
  ): Promise<string[] | undefined> {
    embedding = new Float32Array(embedding);
    if (!Number.isInteger(k) || k <= 0 || k > 0xffffffff ||
        embedding.length !== this.config.dimension ||
        !embedding.every(Number.isFinite)) return undefined;
    const query = this.normalize(embedding);
    if (!await this.build(getEntries)) return undefined;
    const index = this.index;
    const ids = this.ids;
    const revision = this.revision;
    if (!index) return undefined;
    // Upstream search awaits initialize() before touching the native index.
    // Serialize calls so per-query ef cannot be changed by another request.
    const result = this.searching.then(async () => {
      if (revision !== this.revision || this.failed) return undefined;
      try {
        const expansion = ef ?? this.config.efSearch;
        if (Number.isInteger(expansion) && expansion > 0 && expansion <= 0xffffffff &&
            expansion !== index.getStats().efSearch) {
          index.setEfSearch(expansion);
        }
        const results = await index.search(query, Math.min(k, ids.size));
        if (revision !== this.revision) return undefined;
        return results.map((result) => ids.get(result.id)).filter(
          (id): id is string => id !== undefined,
        );
      } catch {
        this.failed = true;
        this.invalidate();
        return undefined;
      }
    });
    this.searching = result;
    return result;
  }

  getStats(): HNSWStats | undefined {
    if (!this.index?.isReady() || this.failed) return undefined;
    const stats = this.index.getStats();
    return {
      vectorCount: stats.numElements,
      memoryUsage: 0, // Native allocation size is not exposed by agentdb.
      avgSearchTime: stats.avgSearchTimeMs,
      buildTime: this.buildTime,
      compressionRatio: 1,
    };
  }
}
