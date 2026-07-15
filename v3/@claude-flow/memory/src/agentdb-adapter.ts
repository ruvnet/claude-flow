/**
 * V3 AgentDB Adapter
 *
 * Unified memory backend implementation using AgentDB with HNSW indexing
 * for 150x-12,500x faster vector search. Implements IMemoryBackend interface.
 *
 * @module v3/memory/agentdb-adapter
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
import { HNSWIndex } from './hnsw-index.js';
import { CacheManager } from './cache-manager.js';
import { SealedMemoryWriter, type SealedEnvelope } from './namespaces/sealed-writer.js';
import {
  checkWrite,
  MemoryWriteDenied,
  InProcessNamespaceRegistry,
  type NamespaceGrant,
  type NamespaceRegistry,
} from './namespaces/authorization.js';
import { computeVmgMetadata } from './namespaces/vmg.js';

/**
 * Configuration for AgentDB Adapter
 */
export interface AgentDBAdapterConfig {
  /** Vector dimensions for embeddings (default: 1536 for OpenAI) */
  dimensions: number;

  /** Maximum number of entries */
  maxEntries: number;

  /** Enable caching */
  cacheEnabled: boolean;

  /** Maximum cache size */
  cacheSize: number;

  /** Cache TTL in milliseconds */
  cacheTtl: number;

  /** HNSW M parameter (max connections per layer) */
  hnswM: number;

  /** HNSW efConstruction parameter */
  hnswEfConstruction: number;

  /** Default namespace */
  defaultNamespace: string;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Enable persistence to disk */
  persistenceEnabled: boolean;

  /** Persistence path */
  persistencePath?: string;

  /**
   * Default namespaces requiring ADR-321 HMAC sealing on write/read (P1
   * scope default: `collaboration` only), seeded into the adapter's
   * `NamespaceRegistry` (`./namespaces/authorization.ts`) at construction.
   *
   * ADR-321 P3: `sealed` is looked up per-namespace via
   * `NamespaceRegistry.getNamespaceConfig(namespace).sealed`, decoupled from
   * the per-agent `NamespaceGrant` (task #10) — sealing is a property of
   * the namespace, not of any one agent's grant, so two agents writing to
   * the same namespace must see the same answer. `markNamespaceSealed`
   * extends this at runtime via `NamespaceRegistry.setNamespaceConfig`.
   */
  sealedNamespaces: string[];
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: AgentDBAdapterConfig = {
  dimensions: 1536,
  maxEntries: 1000000,
  cacheEnabled: true,
  cacheSize: 10000,
  cacheTtl: 300000, // 5 minutes
  hnswM: 16,
  hnswEfConstruction: 200,
  defaultNamespace: 'default',
  persistenceEnabled: false,
  sealedNamespaces: ['collaboration'],
};

/** Shape persisted at `entry.metadata.sealed` for an ADR-321-sealed entry. */
interface SealedMetadataFields {
  seal: string;
  writerId: string;
  sealedAt: number;
  keyEpoch: number;
}

/**
 * AgentDB Memory Backend Adapter
 *
 * Provides unified memory storage with:
 * - HNSW-based vector search (150x-12,500x faster than brute force)
 * - LRU caching with TTL support
 * - Namespace-based organization
 * - Full-text and metadata filtering
 * - Event-driven architecture
 */
export class AgentDBAdapter extends EventEmitter implements IMemoryBackend {
  private config: AgentDBAdapterConfig;
  private entries: Map<string, MemoryEntry> = new Map();
  private index: HNSWIndex;
  private cache: CacheManager<MemoryEntry>;
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private keyIndex: Map<string, string> = new Map(); // namespace:key -> id
  private tagIndex: Map<string, Set<string>> = new Map();
  private initialized: boolean = false;

  /** ADR-321 P1 — HMAC sealing for `config.sealedNamespaces` writes/reads. */
  private sealedMemoryWriter: SealedMemoryWriter = new SealedMemoryWriter();

  /**
   * ADR-321 P3 — the real per-namespace `sealed` registry (see
   * `./namespaces/authorization.ts`'s `NamespaceRegistry` doc), seeded from
   * `config.sealedNamespaces` at construction. `markNamespaceSealed` extends
   * it at runtime so callers can opt a namespace into sealing without
   * reconstructing the adapter, without folding `sealed` onto the per-agent
   * `NamespaceGrant` (task #10) — sealing is namespace-scoped, not agent-scoped.
   */
  private readonly namespaceRegistry: NamespaceRegistry;

  /**
   * ADR-178 Primitive 1 — minimal VMG rollback history, keyed by entry
   * `id` (not `namespace:key`): `rollback(id)` takes an id, and `update()`
   * mutates a single entry object in place under a stable id, so keying by
   * id makes both push (`update()`) and pop (`rollback()`) O(1) without an
   * extra namespace:key -> id indirection. This is intentionally NOT a
   * full audit log (per ADR-178's "audit trail" framing, scoped down) —
   * just enough pre-update snapshots to support `rollback()`.
   */
  private versionHistory: Map<string, MemoryEntry[]> = new Map();

  // Performance tracking
  private stats = {
    queryCount: 0,
    totalQueryTime: 0,
    searchCount: 0,
    totalSearchTime: 0,
    writeCount: 0,
    totalWriteTime: 0,
  };

  constructor(config: Partial<AgentDBAdapterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.namespaceRegistry = new InProcessNamespaceRegistry(this.config.sealedNamespaces);

    // Initialize HNSW index
    this.index = new HNSWIndex({
      dimensions: this.config.dimensions,
      M: this.config.hnswM,
      efConstruction: this.config.hnswEfConstruction,
      maxElements: this.config.maxEntries,
      metric: 'cosine',
    });

    // Initialize cache
    this.cache = new CacheManager<MemoryEntry>({
      maxSize: this.config.cacheSize,
      ttl: this.config.cacheTtl,
      lruEnabled: true,
    });

    // Forward events
    this.index.on('point:added', (data) => this.emit('index:added', data));
    this.cache.on('cache:hit', (data) => this.emit('cache:hit', data));
    this.cache.on('cache:miss', (data) => this.emit('cache:miss', data));
  }

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted data if enabled
    if (this.config.persistenceEnabled && this.config.persistencePath) {
      await this.loadFromDisk();
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Persist data if enabled
    if (this.config.persistenceEnabled && this.config.persistencePath) {
      await this.saveToDisk();
    }

    this.cache.shutdown();
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry, grant?: NamespaceGrant): Promise<void> {
    const startTime = performance.now();

    // ADR-145 Part B: check the (optional) write grant before any other
    // storage logic runs. Pure decision via `checkWrite`; the strict/warn
    // gate lives here. `grant === undefined` is always legacy-permissive —
    // grants are opt-in in P1 (see authorization.ts doc header).
    const writeNamespace = entry.namespace || this.config.defaultNamespace;
    const writeDecision = checkWrite(grant, writeNamespace);
    if (!writeDecision.allowed) {
      if (process.env.CLAUDE_FLOW_STRICT_MEMORY === 'true') {
        throw new MemoryWriteDenied(writeNamespace, grant?.agentId, writeDecision.reason);
      }
      console.warn(
        `[AgentDBAdapter] Write to namespace "${writeNamespace}" would be denied` +
          `${grant?.agentId ? ` for agent "${grant.agentId}"` : ''} (${writeDecision.reason})` +
          ' — persisting anyway (CLAUDE_FLOW_STRICT_MEMORY is not "true").',
      );
    }

    // ADR-178 Primitive 1 (VMG): compute and attach write-time governance
    // metadata BEFORE the ADR-321 sealing block below. Ordering choice:
    // `entry.vmg.writeHash` is a plain SHA-256 of the unsealed content, so
    // computing it before `sealEntry` (which only touches
    // `entry.metadata.sealed`, not `entry.content`) vs. after makes no
    // difference to the hash itself — but computing it first means VMG
    // metadata reflects the actual persisted content even if a future
    // change makes sealing mutate `entry.content` in place. The prior
    // entry is looked up via the raw `entries`/`keyIndex` maps (NOT the
    // public `get`/`getByKey` methods) specifically to avoid re-triggering
    // ADR-321 seal/verify side effects (tamper-detection emits, access-count
    // bumps, cache churn) purely as a byproduct of computing a hash chain.
    const priorEntryId = this.keyIndex.get(`${writeNamespace}:${entry.key}`);
    const priorEntry = priorEntryId ? this.entries.get(priorEntryId) ?? null : null;
    entry.vmg = computeVmgMetadata({
      content: entry.content,
      ownerId: entry.ownerId,
      type: entry.type,
      priorEntry,
    });

    // ADR-321 P1: seal writes into namespaces marked sealed (collaboration
    // only, P1 scope) before any other storage logic runs.
    if (this.isNamespaceSealed(writeNamespace)) {
      this.sealEntry(entry, writeNamespace);
    }

    // Generate embedding if content provided but no embedding
    if (entry.content && !entry.embedding && this.config.embeddingGenerator) {
      entry.embedding = await this.config.embeddingGenerator(entry.content);
    }

    // Store in main storage
    this.entries.set(entry.id, entry);

    // Update namespace index
    const namespace = entry.namespace || this.config.defaultNamespace;
    if (!this.namespaceIndex.has(namespace)) {
      this.namespaceIndex.set(namespace, new Set());
    }
    this.namespaceIndex.get(namespace)!.add(entry.id);

    // Update key index
    const keyIndexKey = `${namespace}:${entry.key}`;
    this.keyIndex.set(keyIndexKey, entry.id);

    // Update tag index
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(entry.id);
    }

    // Index embedding if available
    if (entry.embedding) {
      await this.index.addPoint(entry.id, entry.embedding);
    }

    // Update cache
    if (this.config.cacheEnabled) {
      this.cache.set(entry.id, entry);
    }

    const duration = performance.now() - startTime;
    this.stats.writeCount++;
    this.stats.totalWriteTime += duration;

    this.emit('entry:stored', { id: entry.id, duration });
  }

  /**
   * Get a memory entry by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(id);
      if (cached) {
        this.updateAccessStats(cached);
        return this.verifySealedEntry(cached);
      }
    }

    const entry = this.entries.get(id);
    if (entry) {
      this.updateAccessStats(entry);
      if (this.config.cacheEnabled) {
        this.cache.set(id, entry);
      }
    }

    return entry ? this.verifySealedEntry(entry) : null;
  }

  /**
   * Get a memory entry by key within a namespace
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    const keyIndexKey = `${namespace}:${key}`;
    const id = this.keyIndex.get(keyIndexKey);
    if (!id) return null;
    return this.get(id);
  }

  /**
   * Update a memory entry
   */
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // ADR-178 Primitive 1 (VMG): snapshot the PRE-update entry onto the
    // rollback history before mutating `entry` in place below. A shallow
    // clone is sufficient — `update()` never mutates `entry.metadata` or
    // `entry.vmg` object identity in place, it always reassigns them (see
    // `metadata` handling a few lines down), so the snapshot's nested
    // objects can't be silently changed out from under it afterward.
    const preUpdateSnapshot: MemoryEntry = { ...entry };
    const history = this.versionHistory.get(id) ?? [];
    history.push(preUpdateSnapshot);
    this.versionHistory.set(id, history);

    // Apply updates
    if (update.content !== undefined) {
      entry.content = update.content;
      // Regenerate embedding if content changed
      if (this.config.embeddingGenerator) {
        entry.embedding = await this.config.embeddingGenerator(entry.content);
        // Re-index
        await this.index.removePoint(id);
        await this.index.addPoint(id, entry.embedding);
      }

      // ADR-178 Primitive 1 (VMG): `entry.vmg.writeHash` is a hash of
      // `entry.content` — if content changes without recomputing it, the
      // hash chain silently goes stale (writeHash no longer matches the
      // actual content, defeating tamper detection). Recompute here,
      // chaining off `preUpdateSnapshot` so `version`/`parentHash` extend
      // the same chain `store()` maintains. Deliberately scoped to
      // content-only changes — tag/metadata/accessLevel-only updates don't
      // touch hashed content, so they don't need a new chain link.
      entry.vmg = computeVmgMetadata({
        content: entry.content,
        ownerId: entry.ownerId,
        type: entry.type,
        priorEntry: preUpdateSnapshot,
      });
    }

    if (update.tags !== undefined) {
      // Update tag index
      for (const oldTag of entry.tags) {
        this.tagIndex.get(oldTag)?.delete(id);
      }
      entry.tags = update.tags;
      for (const newTag of update.tags) {
        if (!this.tagIndex.has(newTag)) {
          this.tagIndex.set(newTag, new Set());
        }
        this.tagIndex.get(newTag)!.add(id);
      }
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

    // Update cache
    if (this.config.cacheEnabled) {
      this.cache.set(id, entry);
    }

    this.emit('entry:updated', { id });
    return entry;
  }

  /**
   * ADR-178 Primitive 1 (VMG) — rolls `id` back to its most recent
   * pre-update snapshot.
   *
   * Pops the last snapshot `update()` pushed onto `versionHistory` for
   * `id` and re-persists it via `store()`. Re-using `store()` (rather than
   * writing `entries.set(id, snapshot)` directly) is deliberate: it means
   * the restored entry goes back through the exact same VMG/ACL/sealing/
   * embedding/index/cache machinery as any other write, so `entry.vmg`
   * comes out correctly chained — `computeVmgMetadata` looks up the
   * CURRENT (about-to-be-replaced) entry as `priorEntry`, so the restored
   * entry's `vmg.version` is `current.vmg.version + 1` and its
   * `vmg.parentHash` is the current (pre-rollback) entry's `writeHash`.
   * Rollback is therefore a forward-moving, auditable write in the hash
   * chain, not a silent history rewrite.
   *
   * Returns `null` when there is no history to roll back to (unknown id,
   * or an id that was only ever `store()`-d and never `update()`-d).
   */
  async rollback(id: string): Promise<MemoryEntry | null> {
    const history = this.versionHistory.get(id);
    if (!history || history.length === 0) return null;

    const snapshot = history.pop()!;
    const restored: MemoryEntry = { ...snapshot, id, updatedAt: Date.now() };

    await this.store(restored);

    const stored = this.entries.get(id) ?? restored;
    this.emit('entry:rolled-back', { id, version: stored.vmg?.version });
    return stored;
  }

  /**
   * Delete a memory entry
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Remove from main storage
    this.entries.delete(id);

    // Remove from namespace index
    this.namespaceIndex.get(entry.namespace)?.delete(id);

    // Remove from key index
    const keyIndexKey = `${entry.namespace}:${entry.key}`;
    this.keyIndex.delete(keyIndexKey);

    // Remove from tag index
    for (const tag of entry.tags) {
      this.tagIndex.get(tag)?.delete(id);
    }

    // ADR-178: drop rollback history for a deleted id — nothing left to
    // roll back to, and retaining it would leak memory for every
    // create/update/delete cycle over an id's lifetime.
    this.versionHistory.delete(id);

    // Remove from vector index
    if (entry.embedding) {
      await this.index.removePoint(id);
    }

    // Remove from cache
    if (this.config.cacheEnabled) {
      this.cache.delete(id);
    }

    this.emit('entry:deleted', { id });
    return true;
  }

  /**
   * Query memory entries with filters
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const startTime = performance.now();
    let results: MemoryEntry[] = [];

    switch (query.type) {
      case 'exact':
        if (query.key && query.namespace) {
          const entry = await this.getByKey(query.namespace, query.key);
          if (entry) results = [entry];
        }
        break;

      case 'prefix':
        results = this.queryByPrefix(query);
        break;

      case 'tag':
        results = this.queryByTags(query);
        break;

      case 'semantic':
      case 'hybrid':
        results = await this.querySemanticWithFilters(query);
        break;

      default:
        results = this.queryWithFilters(query);
    }

    // Apply common filters
    results = this.applyFilters(results, query);

    // Apply pagination
    const offset = query.offset || 0;
    results = results.slice(offset, offset + query.limit);

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

    const indexResults = await this.index.search(embedding, options.k, options.ef);

    const results: SearchResult[] = [];
    for (const { id, distance } of indexResults) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      // Apply threshold filter
      const score = 1 - distance; // Convert distance to similarity
      if (options.threshold && score < options.threshold) continue;

      // Apply additional filters if provided
      if (options.filters) {
        const filtered = this.applyFilters([entry], options.filters);
        if (filtered.length === 0) continue;
      }

      results.push({ entry, score, distance });
    }

    const duration = performance.now() - startTime;
    this.stats.searchCount++;
    this.stats.totalSearchTime += duration;

    return results;
  }

  /**
   * Bulk insert entries (OPTIMIZED: 2-3x faster with batched operations)
   *
   * Performance improvements:
   * - Parallel embedding generation
   * - Batched index updates
   * - Deferred cache population
   * - Single event emission
   */
  async bulkInsert(
    entries: MemoryEntry[],
    options?: { batchSize?: number },
    grant?: NamespaceGrant,
  ): Promise<void> {
    const startTime = performance.now();
    const batchSize = options?.batchSize || 100;

    // ADR-145 Part B: the same grant applies to every entry in the batch
    // (one caller/agent per bulkInsert call, same as store()). Under strict
    // mode, reject the WHOLE call if any entry is denied — matching store()'s
    // "reject and don't persist" behavior rather than partial-batch semantics,
    // which would be confusing (some entries silently missing).
    if (process.env.CLAUDE_FLOW_STRICT_MEMORY === 'true') {
      for (const entry of entries) {
        const ns = entry.namespace || this.config.defaultNamespace;
        const decision = checkWrite(grant, ns);
        if (!decision.allowed) {
          throw new MemoryWriteDenied(ns, grant?.agentId, decision.reason);
        }
      }
    } else {
      for (const entry of entries) {
        const ns = entry.namespace || this.config.defaultNamespace;
        const decision = checkWrite(grant, ns);
        if (!decision.allowed) {
          console.warn(
            `[AgentDBAdapter] Write to namespace "${ns}" would be denied` +
              `${grant?.agentId ? ` for agent "${grant.agentId}"` : ''} (${decision.reason})` +
              ' — persisting anyway (CLAUDE_FLOW_STRICT_MEMORY is not "true").',
          );
        }
      }
    }

    // Phase 1: Generate embeddings in parallel batches
    if (this.config.embeddingGenerator) {
      const needsEmbedding = entries.filter(e => e.content && !e.embedding);
      for (let i = 0; i < needsEmbedding.length; i += batchSize) {
        const batch = needsEmbedding.slice(i, i + batchSize);
        await Promise.all(batch.map(async (entry) => {
          entry.embedding = await this.config.embeddingGenerator!(entry.content);
        }));
      }
    }

    // Phase 2: Store all entries (skip individual cache updates)
    const embeddings: Array<{ id: string; embedding: Float32Array }> = [];

    for (const entry of entries) {
      // Store in main storage
      this.entries.set(entry.id, entry);

      // Update namespace index
      const namespace = entry.namespace || this.config.defaultNamespace;
      if (!this.namespaceIndex.has(namespace)) {
        this.namespaceIndex.set(namespace, new Set());
      }
      this.namespaceIndex.get(namespace)!.add(entry.id);

      // Update key index
      const keyIndexKey = `${namespace}:${entry.key}`;
      this.keyIndex.set(keyIndexKey, entry.id);

      // Update tag index
      for (const tag of entry.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(entry.id);
      }

      // Collect embeddings for batch indexing
      if (entry.embedding) {
        embeddings.push({ id: entry.id, embedding: entry.embedding });
      }
    }

    // Phase 3: Batch index embeddings
    for (let i = 0; i < embeddings.length; i += batchSize) {
      const batch = embeddings.slice(i, i + batchSize);
      await Promise.all(batch.map(({ id, embedding }) => this.index.addPoint(id, embedding)));
    }

    // Phase 4: Batch cache update (only populate hot entries)
    if (this.config.cacheEnabled && entries.length <= this.config.cacheSize) {
      for (const entry of entries) {
        this.cache.set(entry.id, entry);
      }
    }

    const duration = performance.now() - startTime;
    this.stats.writeCount += entries.length;
    this.stats.totalWriteTime += duration;

    this.emit('bulk:inserted', { count: entries.length, duration, avgPerEntry: duration / entries.length });
  }

  /**
   * Bulk delete entries (OPTIMIZED: parallel deletion)
   */
  async bulkDelete(ids: string[]): Promise<number> {
    const startTime = performance.now();
    let deleted = 0;

    // Batch delete from cache first (fast)
    if (this.config.cacheEnabled) {
      for (const id of ids) {
        this.cache.delete(id);
      }
    }

    // Process deletions in parallel batches
    const batchSize = 100;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (id) => {
        const entry = this.entries.get(id);
        if (!entry) return false;

        // Remove from main storage
        this.entries.delete(id);

        // Remove from namespace index
        this.namespaceIndex.get(entry.namespace)?.delete(id);

        // Remove from key index
        const keyIndexKey = `${entry.namespace}:${entry.key}`;
        this.keyIndex.delete(keyIndexKey);

        // Remove from tag index
        for (const tag of entry.tags) {
          this.tagIndex.get(tag)?.delete(id);
        }

        // Remove from vector index
        if (entry.embedding) {
          await this.index.removePoint(id);
        }

        return true;
      }));

      deleted += results.filter(Boolean).length;
    }

    const duration = performance.now() - startTime;
    this.emit('bulk:deleted', { count: deleted, duration });

    return deleted;
  }

  /**
   * Bulk get entries by IDs (OPTIMIZED: parallel fetch with cache)
   */
  async bulkGet(ids: string[]): Promise<Map<string, MemoryEntry | null>> {
    const results = new Map<string, MemoryEntry | null>();
    const uncached: string[] = [];

    // Check cache first
    if (this.config.cacheEnabled) {
      for (const id of ids) {
        const cached = this.cache.get(id);
        if (cached) {
          results.set(id, cached);
        } else {
          uncached.push(id);
        }
      }
    } else {
      uncached.push(...ids);
    }

    // Fetch uncached entries
    for (const id of uncached) {
      const entry = this.entries.get(id) || null;
      results.set(id, entry);
      if (entry && this.config.cacheEnabled) {
        this.cache.set(id, entry);
      }
    }

    return results;
  }

  /**
   * Bulk update entries (OPTIMIZED: batched updates)
   */
  async bulkUpdate(
    updates: Array<{ id: string; update: MemoryEntryUpdate }>
  ): Promise<Map<string, MemoryEntry | null>> {
    const results = new Map<string, MemoryEntry | null>();

    // Process updates in parallel
    await Promise.all(updates.map(async ({ id, update }) => {
      const updated = await this.update(id, update);
      results.set(id, updated);
    }));

    return results;
  }

  /**
   * Get entry count
   */
  async count(namespace?: string): Promise<number> {
    if (namespace) {
      return this.namespaceIndex.get(namespace)?.size || 0;
    }
    return this.entries.size;
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<string[]> {
    return Array.from(this.namespaceIndex.keys());
  }

  /**
   * Clear all entries in a namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    const ids = this.namespaceIndex.get(namespace);
    if (!ids) return 0;

    let deleted = 0;
    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get backend statistics
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

    return {
      totalEntries: this.entries.size,
      entriesByNamespace,
      entriesByType,
      memoryUsage: this.estimateMemoryUsage(),
      hnswStats: this.index.getStats(),
      cacheStats: this.cache.getStats(),
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
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check storage health
    const storageHealth = this.checkStorageHealth(issues, recommendations);

    // Check index health
    const indexHealth = this.checkIndexHealth(issues, recommendations);

    // Check cache health
    const cacheHealth = this.checkCacheHealth(issues, recommendations);

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (
      storageHealth.status === 'unhealthy' ||
      indexHealth.status === 'unhealthy' ||
      cacheHealth.status === 'unhealthy'
    ) {
      status = 'unhealthy';
    } else if (
      storageHealth.status === 'degraded' ||
      indexHealth.status === 'degraded' ||
      cacheHealth.status === 'degraded'
    ) {
      status = 'degraded';
    }

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

  // ===== Convenience Methods =====

  /**
   * Store a new entry from input
   */
  async storeEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    const entry = createDefaultEntry(input);
    await this.store(entry);
    return entry;
  }

  /**
   * Semantic search by content string.
   *
   * ADR-125 Phase 5 — degrades gracefully when the embedding generator is
   * unavailable. Instead of throwing, emits `health:embedder` with
   * `status: 'degraded'` and falls back to {@link searchKeyword} so the
   * memory subsystem remains usable when `@claude-flow/embeddings` is
   * unreachable (per ADR-124's lazy/degrade posture).
   */
  async semanticSearch(
    content: string,
    k: number = 10,
    threshold?: number
  ): Promise<SearchResult[]> {
    if (!this.config.embeddingGenerator) {
      this.emit('health:embedder', { status: 'degraded', reason: 'no-generator' });
      return this.searchKeyword(content, { k, threshold } as SearchOptions);
    }

    try {
      const embedding = await this.config.embeddingGenerator(content);
      return this.search(embedding, { k, threshold });
    } catch (err) {
      this.emit('health:embedder', {
        status: 'degraded',
        reason: err instanceof Error ? err.message : String(err),
      });
      return this.searchKeyword(content, { k, threshold } as SearchOptions);
    }
  }

  /**
   * Keyword search — in-memory token-overlap ranking against the
   * `entries` map. Used as a fallback when the embedder is unavailable
   * and as the "sparse" arm of the hybridSearch controller.
   *
   * Falls back to the SqlJs / SQLite backend FTS5 path when a backend is
   * wired that exposes a `searchKeyword` method. The AgentDBAdapter itself
   * keeps the implementation cheap and dependency-free.
   *
   * @internal ADR-125 Phase 5
   */
  async searchKeyword(
    query: string,
    options: SearchOptions = { k: 10 } as SearchOptions
  ): Promise<SearchResult[]> {
    const k = options.k ?? 10;
    const tokens = tokenize(query);
    if (tokens.size === 0) return [];

    const scored: SearchResult[] = [];
    for (const entry of this.entries.values()) {
      const entryTokens = tokenize(entry.content);
      let overlap = 0;
      for (const t of tokens) if (entryTokens.has(t)) overlap += 1;
      if (overlap === 0) continue;
      // Simple token-overlap ratio in [0,1]. Adequate for fallback ranking.
      const score = overlap / Math.max(tokens.size, 1);
      if (options.threshold && score < options.threshold) continue;
      // Apply additional filters if provided
      if (options.filters) {
        const filtered = this.applyFilters([entry], options.filters);
        if (filtered.length === 0) continue;
      }
      scored.push({ entry, score, distance: 1 - score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // ===== Private Methods =====

  private queryByPrefix(query: MemoryQuery): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    const prefix = query.keyPrefix || '';
    const namespace = query.namespace || this.config.defaultNamespace;

    for (const [key, id] of this.keyIndex) {
      if (key.startsWith(`${namespace}:${prefix}`)) {
        const entry = this.entries.get(id);
        if (entry) results.push(entry);
      }
    }

    return results;
  }

  private queryByTags(query: MemoryQuery): MemoryEntry[] {
    if (!query.tags || query.tags.length === 0) {
      return Array.from(this.entries.values());
    }

    // Get intersection of entries for all tags
    let matchingIds: Set<string> | null = null;

    for (const tag of query.tags) {
      const tagIds = this.tagIndex.get(tag);
      if (!tagIds) {
        return []; // Tag doesn't exist
      }

      if (matchingIds === null) {
        matchingIds = new Set(tagIds);
      } else {
        // Intersect with previous results
        for (const id of matchingIds) {
          if (!tagIds.has(id)) {
            matchingIds.delete(id);
          }
        }
      }
    }

    if (!matchingIds) return [];

    const results: MemoryEntry[] = [];
    for (const id of matchingIds) {
      const entry = this.entries.get(id);
      if (entry) results.push(entry);
    }

    return results;
  }

  private async querySemanticWithFilters(
    query: MemoryQuery
  ): Promise<MemoryEntry[]> {
    if (!query.content && !query.embedding) {
      return this.queryWithFilters(query);
    }

    let embedding = query.embedding;
    if (!embedding && query.content && this.config.embeddingGenerator) {
      embedding = await this.config.embeddingGenerator(query.content);
    }

    if (!embedding) {
      return this.queryWithFilters(query);
    }

    const searchResults = await this.search(embedding, {
      k: query.limit * 2, // Over-fetch for filtering
      threshold: query.threshold,
      filters: query,
    });

    return searchResults.map((r) => r.entry);
  }

  private queryWithFilters(query: MemoryQuery): MemoryEntry[] {
    let entries: MemoryEntry[] = [];

    // Start with namespace filter if provided
    if (query.namespace) {
      const namespaceIds = this.namespaceIndex.get(query.namespace);
      if (!namespaceIds) return [];
      for (const id of namespaceIds) {
        const entry = this.entries.get(id);
        if (entry) entries.push(entry);
      }
    } else {
      entries = Array.from(this.entries.values());
    }

    return entries;
  }

  private applyFilters(
    entries: MemoryEntry[],
    query: MemoryQuery
  ): MemoryEntry[] {
    return entries.filter((entry) => {
      // Namespace filter
      if (query.namespace && entry.namespace !== query.namespace) {
        return false;
      }

      // Memory type filter
      if (query.memoryType && entry.type !== query.memoryType) {
        return false;
      }

      // Access level filter
      if (query.accessLevel && entry.accessLevel !== query.accessLevel) {
        return false;
      }

      // Owner filter
      if (query.ownerId && entry.ownerId !== query.ownerId) {
        return false;
      }

      // Tags filter
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.every((tag) => entry.tags.includes(tag))) {
          return false;
        }
      }

      // Time range filters
      if (query.createdAfter && entry.createdAt < query.createdAfter) {
        return false;
      }
      if (query.createdBefore && entry.createdAt > query.createdBefore) {
        return false;
      }
      if (query.updatedAfter && entry.updatedAt < query.updatedAfter) {
        return false;
      }
      if (query.updatedBefore && entry.updatedAt > query.updatedBefore) {
        return false;
      }

      // Expiration filter
      if (!query.includeExpired && entry.expiresAt) {
        if (entry.expiresAt < Date.now()) {
          return false;
        }
      }

      // Metadata filters
      if (query.metadata) {
        for (const [key, value] of Object.entries(query.metadata)) {
          if (entry.metadata[key] !== value) {
            return false;
          }
        }
      }

      return true;
    });
  }

  private updateAccessStats(entry: MemoryEntry): void {
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
  }

  /**
   * ADR-321 P1/P3: is `namespace` one of the namespaces requiring sealing?
   * Public so callers (and `post-edit`-style hook integrations) can check
   * opt-in status without reaching into adapter internals. Backed by the
   * real per-namespace `NamespaceRegistry` (`./namespaces/authorization.ts`),
   * decoupled from the per-agent `NamespaceGrant`.
   */
  isNamespaceSealed(namespace: string): boolean {
    return this.namespaceRegistry.getNamespaceConfig(namespace).sealed;
  }

  /**
   * ADR-321 P3 — opts `namespace` into HMAC sealing at runtime, without
   * reconstructing the adapter or editing this file's `DEFAULT_CONFIG`.
   *
   * This is the extensibility point the ADR describes as "extend
   * `sealed: true` opt-in to any namespace" — implemented via the real
   * `NamespaceRegistry.setNamespaceConfig`, a namespace-scoped registry
   * decoupled from the per-agent `NamespaceGrant` (task #10) so two agents
   * writing to the same namespace always agree on whether it's sealed.
   * Idempotent: marking an already-sealed namespace is a no-op.
   */
  markNamespaceSealed(namespace: string): void {
    this.namespaceRegistry.setNamespaceConfig(namespace, { sealed: true });
  }

  /**
   * ADR-321 P4 — manual `keyEpoch` bump tooling. Delegates to
   * `SealedMemoryWriter.rotateKey`, which discards `namespace`'s current
   * HMAC key and bumps its epoch; any envelope sealed under the retired
   * epoch fails `verify()` from this point on (deliberate — see the ADR's
   * "not per-write" rotation rationale). Emits `seal:key-rotated` so
   * callers/observability can log the (infrequent, deliberate) event.
   *
   * This is the programmatic entry point the ADR's P4 row calls "bump
   * tooling"; see `./namespaces/key-rotation.ts` for the policy layer
   * (`isRotationDue`/`rotateIfDue`/`rotateNow`) that decides WHEN to call
   * this. No CLI subcommand wraps this yet — the CLI's `memory` command
   * (`@claude-flow/cli/src/commands/memory.ts`) is built on a separate
   * sql.js-backed store, not this adapter, so exposing this via the CLI is
   * a larger, separate wiring task left as a follow-up.
   */
  rotateSealKey(namespace: string): void {
    this.sealedMemoryWriter.rotateKey(namespace);
    this.emit('seal:key-rotated', { namespace });
  }

  /**
   * Seals `entry.content` under `namespace` and stores the envelope's
   * non-content fields at `entry.metadata.sealed` (content itself is not
   * duplicated — it already lives at `entry.content`).
   */
  private sealEntry(entry: MemoryEntry, namespace: string): void {
    // Pass the real ADR-178 VMG writeHash (task #11) as the precomputed
    // content hash so the HMAC input matches ADR-321's literal composition
    // instead of SealedMemoryWriter recomputing its own hash independently.
    // `entry.vmg` is always set by this point — `store()` computes it
    // before calling `sealEntry` (see the ordering comment there).
    const envelope = this.sealedMemoryWriter.seal(
      entry.content,
      entry.ownerId ?? 'unknown',
      namespace,
      entry.vmg?.writeHash
    );
    entry.metadata = {
      ...entry.metadata,
      sealed: {
        seal: envelope.seal,
        writerId: envelope.writerId,
        sealedAt: envelope.sealedAt,
        keyEpoch: envelope.keyEpoch,
      } satisfies SealedMetadataFields,
    };
  }

  /**
   * ADR-321 P1/P2 read-side check. Reconstructs the `SealedEnvelope` from
   * `entry.metadata.sealed` (when present) and verifies it. On tamper
   * detection, always emits `seal:tamper-detected` (never silently
   * dropped); when `CLAUDE_FLOW_STRICT_SEALING === 'true'` the entry is
   * withheld (returns `null`), otherwise it is still returned with a
   * warning — the same warn-then-block rollout shape as ADR-144/145.
   *
   * ADR-321 P2: when the seal is valid but `propagationDetected` comes
   * back true (same content re-sealed under a different writerId within
   * `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS` — the ClawWorm propagation shape),
   * emits `seal:propagation-detected`. This is purely additive: it never
   * changes the existing tamper-detection blocking behavior above. No
   * escalation routing is built here — ADR-178's `CLAUDE_FLOW_IPI_MODE` /
   * RepE hook, which the ADR text names as the intended consumer, is
   * unimplemented in this repo (out of scope, different ADR); this event
   * just gives a future implementation something to subscribe to.
   */
  private verifySealedEntry(entry: MemoryEntry): MemoryEntry | null {
    const sealed = entry.metadata?.sealed as SealedMetadataFields | undefined;
    if (!sealed) return entry;

    const envelope: SealedEnvelope = {
      content: entry.content,
      seal: sealed.seal,
      writerId: sealed.writerId,
      sealedAt: sealed.sealedAt,
      keyEpoch: sealed.keyEpoch,
    };

    // Deliberately does NOT pass `entry.vmg?.writeHash` here (unlike
    // `sealEntry` above) — `verify()` always recomputes the content hash
    // from `envelope.content` itself, which is the load-bearing
    // tamper-detection property. See `SealedMemoryWriter.verify`'s doc for
    // why a cached/stored hash must never be trusted at verify time.
    const result = this.sealedMemoryWriter.verify(envelope, entry.namespace);

    if (result.valid && result.propagationDetected) {
      this.emit('seal:propagation-detected', {
        id: entry.id,
        namespace: entry.namespace,
        writerId: sealed.writerId,
      });
    }

    if (result.valid) return entry;

    this.emit('seal:tamper-detected', { id: entry.id, namespace: entry.namespace });

    if (process.env.CLAUDE_FLOW_STRICT_SEALING === 'true') {
      return null;
    }

    return entry;
  }

  private estimateMemoryUsage(): number {
    let total = 0;

    // Estimate entry storage
    for (const entry of this.entries.values()) {
      total += this.estimateEntrySize(entry);
    }

    // Add index memory
    total += this.index.getStats().memoryUsage;

    // Add cache memory
    total += this.cache.getStats().memoryUsage;

    return total;
  }

  private estimateEntrySize(entry: MemoryEntry): number {
    let size = 0;

    // Base object overhead
    size += 100;

    // String fields
    size += (entry.id.length + entry.key.length + entry.content.length) * 2;

    // Embedding (Float32Array)
    if (entry.embedding) {
      size += entry.embedding.length * 4;
    }

    // Tags and references
    size += entry.tags.join('').length * 2;
    size += entry.references.join('').length * 2;

    // Metadata (rough estimate)
    size += JSON.stringify(entry.metadata).length * 2;

    return size;
  }

  private checkStorageHealth(
    issues: string[],
    recommendations: string[]
  ): ComponentHealth {
    const utilizationPercent =
      (this.entries.size / this.config.maxEntries) * 100;

    if (utilizationPercent > 95) {
      issues.push('Storage utilization critical (>95%)');
      recommendations.push('Increase maxEntries or cleanup old data');
      return { status: 'unhealthy', latency: 0, message: 'Storage near capacity' };
    }

    if (utilizationPercent > 80) {
      issues.push('Storage utilization high (>80%)');
      recommendations.push('Consider cleanup or capacity increase');
      return { status: 'degraded', latency: 0, message: 'Storage utilization high' };
    }

    return { status: 'healthy', latency: 0 };
  }

  private checkIndexHealth(
    issues: string[],
    recommendations: string[]
  ): ComponentHealth {
    const stats = this.index.getStats();

    if (stats.avgSearchTime > 10) {
      issues.push('Index search time degraded (>10ms)');
      recommendations.push('Consider rebuilding index or increasing ef');
      return { status: 'degraded', latency: stats.avgSearchTime };
    }

    return { status: 'healthy', latency: stats.avgSearchTime };
  }

  private checkCacheHealth(
    issues: string[],
    recommendations: string[]
  ): ComponentHealth {
    const stats = this.cache.getStats();

    if (stats.hitRate < 0.5) {
      issues.push('Cache hit rate low (<50%)');
      recommendations.push('Consider increasing cache size');
      return {
        status: 'degraded',
        latency: 0,
        message: `Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`,
      };
    }

    return { status: 'healthy', latency: 0 };
  }

  /**
   * Path to the HNSW snapshot sidecar.
   * Convention: `<persistencePath>.hnsw`
   */
  private getHnswSidecarPath(): string | null {
    if (!this.config.persistencePath) return null;
    return `${this.config.persistencePath}.hnsw`;
  }

  /**
   * Path to the in-memory Maps (entries/namespaceIndex/keyIndex/tagIndex) sidecar.
   * Convention: `<persistencePath>.meta.json`
   */
  private getMetaSidecarPath(): string | null {
    if (!this.config.persistencePath) return null;
    return `${this.config.persistencePath}.meta.json`;
  }

  /**
   * Persist a snapshot of the in-memory state to disk.
   *
   * Writes two sidecar files alongside `persistencePath`:
   * - `<persistencePath>.hnsw`        — binary HNSW snapshot via {@link HNSWIndex.serialize}
   * - `<persistencePath>.meta.json`   — entries + indices in stable JSON
   *
   * Public so {@link MemoryService} can trigger periodic snapshots (ADR-125 Phase 3).
   */
  async saveSnapshot(): Promise<void> {
    await this.saveToDisk();
  }

  /**
   * ADR-125 Phase 3 — real persistence implementation.
   *
   * Loads two sidecar files alongside `persistencePath` (when both exist):
   * - `<persistencePath>.hnsw`        — binary HNSW snapshot
   * - `<persistencePath>.meta.json`   — entries + namespaceIndex + keyIndex + tagIndex
   *
   * Emits `persistence:loaded` with `{ status: 'restored' | 'fresh' | 'corrupt' }`.
   * Falls back to a fresh state on any deserialize / IO error so callers don't throw.
   */
  private async loadFromDisk(): Promise<void> {
    const hnswPath = this.getHnswSidecarPath();
    const metaPath = this.getMetaSidecarPath();

    if (!hnswPath || !metaPath) {
      this.emit('persistence:loaded', { status: 'fresh', reason: 'no-path' });
      return;
    }

    let hnswExists = false;
    let metaExists = false;
    try { hnswExists = fs.existsSync(hnswPath); } catch { /* ignore */ }
    try { metaExists = fs.existsSync(metaPath); } catch { /* ignore */ }

    if (!hnswExists || !metaExists) {
      this.emit('persistence:loaded', { status: 'fresh', reason: 'no-sidecar' });
      return;
    }

    try {
      const metaRaw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw) as PersistedMeta;

      // Restore entries (rehydrate Float32Array embeddings if present)
      this.entries.clear();
      this.namespaceIndex.clear();
      this.keyIndex.clear();
      this.tagIndex.clear();

      for (const persisted of meta.entries) {
        const entry: MemoryEntry = {
          ...persisted,
          embedding: persisted.embedding
            ? Float32Array.from(persisted.embedding)
            : undefined,
        };
        this.entries.set(entry.id, entry);
      }
      for (const [ns, ids] of Object.entries(meta.namespaceIndex)) {
        this.namespaceIndex.set(ns, new Set(ids));
      }
      for (const [key, id] of Object.entries(meta.keyIndex)) {
        this.keyIndex.set(key, id);
      }
      for (const [tag, ids] of Object.entries(meta.tagIndex)) {
        this.tagIndex.set(tag, new Set(ids));
      }

      // Restore HNSW
      const hnswBuf = fs.readFileSync(hnswPath);
      const restored = HNSWIndex.deserialize(hnswBuf);
      // Swap pointers — preserves forwarded events because we only re-listen
      // when the adapter is reconstructed (which happens on a fresh instance).
      this.index = restored;
      // Re-forward HNSW events
      this.index.on('point:added', (data) => this.emit('index:added', data));

      this.emit('persistence:loaded', { status: 'restored', count: this.entries.size });
    } catch (err) {
      // Corrupt sidecar — start fresh, leave existing files in place for
      // operator inspection.
      this.entries.clear();
      this.namespaceIndex.clear();
      this.keyIndex.clear();
      this.tagIndex.clear();
      this.emit('persistence:loaded', {
        status: 'corrupt',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * ADR-125 Phase 3 — real snapshot implementation.
   *
   * Writes both sidecars atomically via a temp-file-and-rename dance so a
   * crash mid-write doesn't leave half-baked state on disk.
   */
  private async saveToDisk(): Promise<void> {
    const hnswPath = this.getHnswSidecarPath();
    const metaPath = this.getMetaSidecarPath();

    if (!hnswPath || !metaPath) {
      this.emit('persistence:saved', { status: 'skipped', reason: 'no-path' });
      return;
    }

    try {
      // Ensure parent dir exists
      const dir = path.dirname(hnswPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Build stable JSON representation
      const meta = this.buildPersistedMeta();
      const metaText = JSON.stringify(meta);

      // Build HNSW snapshot
      const hnswBuf = this.index.serialize();

      // Atomic write via temp + rename
      const hnswTmp = `${hnswPath}.tmp`;
      const metaTmp = `${metaPath}.tmp`;
      fs.writeFileSync(hnswTmp, hnswBuf);
      fs.writeFileSync(metaTmp, metaText);
      fs.renameSync(hnswTmp, hnswPath);
      fs.renameSync(metaTmp, metaPath);

      this.emit('persistence:saved', {
        status: 'ok',
        bytes: hnswBuf.length + Buffer.byteLength(metaText, 'utf-8'),
      });
    } catch (err) {
      this.emit('persistence:saved', {
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Build a stable, diff-friendly JSON representation of the in-memory Maps.
   * Keys are sorted; embeddings are serialized as plain number arrays.
   */
  private buildPersistedMeta(): PersistedMeta {
    const entriesArr = [...this.entries.values()].sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const persistedEntries = entriesArr.map((e) => ({
      ...e,
      embedding: e.embedding ? Array.from(e.embedding) : undefined,
    }));

    const namespaceIndex: Record<string, string[]> = {};
    for (const ns of [...this.namespaceIndex.keys()].sort()) {
      namespaceIndex[ns] = [...this.namespaceIndex.get(ns)!].sort();
    }
    const keyIndex: Record<string, string> = {};
    for (const k of [...this.keyIndex.keys()].sort()) {
      keyIndex[k] = this.keyIndex.get(k)!;
    }
    const tagIndex: Record<string, string[]> = {};
    for (const t of [...this.tagIndex.keys()].sort()) {
      tagIndex[t] = [...this.tagIndex.get(t)!].sort();
    }

    return { version: 1, entries: persistedEntries, namespaceIndex, keyIndex, tagIndex };
  }
}

/**
 * Wire-format for the meta sidecar (`<persistencePath>.meta.json`).
 * `embedding` is stored as a plain number[] to keep the JSON canonical.
 */
interface PersistedMeta {
  version: 1;
  entries: Array<Omit<MemoryEntry, 'embedding'> & { embedding?: number[] }>;
  namespaceIndex: Record<string, string[]>;
  keyIndex: Record<string, string>;
  tagIndex: Record<string, string[]>;
}

// ADR-125 Phase 5 — minimal tokenizer for the in-memory keyword fallback.
// Mirrors the shape used in `smart-retrieval.ts` but is duplicated here so the
// adapter has no dependency on the retrieval layer.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy',
  'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with', 'this',
  'that', 'have', 'from', 'they', 'will', 'been', 'were', 'what', 'when',
  'your',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

export default AgentDBAdapter;
