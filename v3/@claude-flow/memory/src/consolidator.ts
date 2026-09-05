/**
 * MemoryConsolidator — ADR-125 Phase 4
 *
 * Periodic maintenance for the in-memory state owned by {@link UnifiedMemoryService}.
 *
 * Operations:
 * - `sweepExpired()` — drop entries past `expiresAt` from all indexes (including HNSW).
 * - `dedup(strategy)` — collapse content-hash duplicates per strategy.
 * - `compactHnsw()` — rebuild the HNSW index from current `entries`.
 * - `runAll()` — sweep → dedup → compact in order.
 *
 * Invoked from two paths:
 * 1. {@link UnifiedMemoryService}'s lifecycle (background timer when
 *    `consolidator.autoRun === true`, plus `close()`).
 * 2. The AgentDB `nightlyLearner` controller (`src/controller-registry.ts`)
 *    delegates to `runAll()` instead of hitting AgentDB directly.
 *
 * Phase 3 placeholder lives in this file too — it provides the typed
 * surface that {@link UnifiedMemoryService.getConsolidator} resolves to.
 * The real implementation lands with Phase 4.
 *
 * @module v3/memory/consolidator
 */

import { createHash } from 'node:crypto';
import { HNSWIndex } from './hnsw-index.js';
import type { MemoryEntry } from './types.js';

/**
 * Strategy for resolving content-hash duplicates inside {@link MemoryConsolidator.dedup}.
 */
export type DedupStrategy = 'keep-newest' | 'keep-oldest' | 'merge-tags';

export interface ConsolidatorOptions {
  /** Default strategy when `dedup()` is invoked with no argument. */
  dedupStrategy?: DedupStrategy;
  /** Used by `MemoryService` when scheduling automatic runs (ms). */
  intervalMs?: number;
}

export interface SweepResult {
  removed: number;
  remaining: number;
  hnswRemoved: number;
}

export interface DedupResult {
  merged: number;
  groups: number;
}

export interface CompactResult {
  before: number;
  after: number;
  durationMs: number;
}

export interface ConsolidationResult {
  sweep: SweepResult;
  dedup: DedupResult;
  compact: CompactResult;
  totalDurationMs: number;
}

/**
 * Minimal surface the consolidator needs from `UnifiedMemoryService`. Avoids
 * a circular type import.
 */
interface ServiceLike {
  getAdapter(): {
    // Internals we mutate. Cast-safe at runtime.
    entries: Map<string, MemoryEntry>;
    namespaceIndex: Map<string, Set<string>>;
    keyIndex: Map<string, string>;
    tagIndex: Map<string, Set<string>>;
    // Public HNSW accessor exists on AgentDBAdapter; cast through.
    [key: string]: any;
  };
}

export class MemoryConsolidator {
  constructor(
    private readonly service: ServiceLike,
    private readonly opts: ConsolidatorOptions = {}
  ) {}

  /**
   * Drop all entries whose `expiresAt` is in the past.
   */
  async sweepExpired(): Promise<SweepResult> {
    const adapter = this.service.getAdapter() as any;
    const entries: Map<string, MemoryEntry> = adapter.entries;
    const namespaceIndex: Map<string, Set<string>> = adapter.namespaceIndex;
    const keyIndex: Map<string, string> = adapter.keyIndex;
    const tagIndex: Map<string, Set<string>> = adapter.tagIndex;
    const index: HNSWIndex = adapter.index;

    const now = Date.now();
    const toRemove: MemoryEntry[] = [];
    for (const entry of entries.values()) {
      if (entry.expiresAt != null && entry.expiresAt < now) {
        toRemove.push(entry);
      }
    }

    let hnswRemoved = 0;
    for (const entry of toRemove) {
      entries.delete(entry.id);
      namespaceIndex.get(entry.namespace)?.delete(entry.id);
      keyIndex.delete(`${entry.namespace}:${entry.key}`);
      for (const tag of entry.tags) tagIndex.get(tag)?.delete(entry.id);
      if (entry.embedding) {
        const removed = await index.removePoint(entry.id);
        if (removed) hnswRemoved += 1;
      }
    }

    // Clean up empty namespace/tag sets to keep memory bounded
    for (const [ns, ids] of namespaceIndex) {
      if (ids.size === 0) namespaceIndex.delete(ns);
    }
    for (const [tag, ids] of tagIndex) {
      if (ids.size === 0) tagIndex.delete(tag);
    }

    return {
      removed: toRemove.length,
      remaining: entries.size,
      hnswRemoved,
    };
  }

  /**
   * Collapse content-hash duplicates across all namespaces per `strategy`.
   *
   * - `keep-newest`: keep the entry with the highest `updatedAt`, drop the rest.
   * - `keep-oldest`: keep the entry with the lowest `createdAt`, drop the rest.
   * - `merge-tags`: keep newest, but union the tag sets of the duplicates first.
   */
  async dedup(strategy?: DedupStrategy): Promise<DedupResult> {
    const adapter = this.service.getAdapter() as any;
    const entries: Map<string, MemoryEntry> = adapter.entries;
    const namespaceIndex: Map<string, Set<string>> = adapter.namespaceIndex;
    const keyIndex: Map<string, string> = adapter.keyIndex;
    const tagIndex: Map<string, Set<string>> = adapter.tagIndex;
    const index: HNSWIndex = adapter.index;

    const effective = strategy ?? this.opts.dedupStrategy ?? 'keep-newest';

    // Bucket by content hash
    const buckets = new Map<string, MemoryEntry[]>();
    for (const entry of entries.values()) {
      const hash = createHash('sha256').update(entry.content).digest('hex');
      const bucket = buckets.get(hash);
      if (bucket) bucket.push(entry);
      else buckets.set(hash, [entry]);
    }

    let merged = 0;
    let dupGroups = 0;
    for (const bucket of buckets.values()) {
      if (bucket.length <= 1) continue;
      dupGroups += 1;

      // Choose keeper
      let keeper: MemoryEntry;
      if (effective === 'keep-oldest') {
        keeper = bucket.reduce((acc, e) =>
          e.createdAt < acc.createdAt ? e : acc
        );
      } else {
        // keep-newest + merge-tags share this branch
        keeper = bucket.reduce((acc, e) =>
          e.updatedAt > acc.updatedAt ? e : acc
        );
      }

      if (effective === 'merge-tags') {
        const tagSet = new Set<string>(keeper.tags);
        for (const e of bucket) for (const t of e.tags) tagSet.add(t);
        const oldTags = keeper.tags;
        keeper.tags = [...tagSet];
        // Update tagIndex membership for newly-added tags
        for (const t of keeper.tags) {
          if (!oldTags.includes(t)) {
            if (!tagIndex.has(t)) tagIndex.set(t, new Set());
            tagIndex.get(t)!.add(keeper.id);
          }
        }
      }

      // Drop everyone except the keeper
      for (const e of bucket) {
        if (e.id === keeper.id) continue;
        entries.delete(e.id);
        namespaceIndex.get(e.namespace)?.delete(e.id);
        const compositeKey = `${e.namespace}:${e.key}`;
        if (keyIndex.get(compositeKey) === e.id) {
          keyIndex.delete(compositeKey);
        }
        for (const tag of e.tags) tagIndex.get(tag)?.delete(e.id);
        if (e.embedding) {
          await index.removePoint(e.id);
        }
        merged += 1;
      }
    }

    return { merged, groups: dupGroups };
  }

  /**
   * Rebuild the HNSW index from the current set of entries with embeddings.
   * Returns a count snapshot + duration.
   */
  async compactHnsw(): Promise<CompactResult> {
    const adapter = this.service.getAdapter() as any;
    const entries: Map<string, MemoryEntry> = adapter.entries;
    const index: HNSWIndex = adapter.index;

    const before = index.size;
    const t0 = Date.now();

    // Build a fresh HNSW from current entries that have embeddings.
    const cfg = index.getConfig();
    const fresh = new HNSWIndex({
      dimensions: cfg.dimensions,
      M: cfg.M,
      efConstruction: cfg.efConstruction,
      maxElements: cfg.maxElements,
      metric: cfg.metric,
    });

    for (const entry of entries.values()) {
      if (entry.embedding) {
        try {
          await fresh.addPoint(entry.id, entry.embedding);
        } catch {
          // Tolerate dimension mismatches in malformed datasets.
        }
      }
    }

    // Swap pointers atomically and re-forward events
    adapter.index = fresh;
    if (typeof adapter.emit === 'function') {
      fresh.on('point:added', (data: any) => adapter.emit('index:added', data));
    }

    const durationMs = Date.now() - t0;
    return { before, after: fresh.size, durationMs };
  }

  /**
   * Sweep → dedup → compact. Used by the background timer and by the
   * `nightlyLearner` AgentDB controller.
   */
  async runAll(): Promise<ConsolidationResult> {
    const start = Date.now();
    const sweep = await this.sweepExpired();
    const dedup = await this.dedup();
    const compact = await this.compactHnsw();
    return {
      sweep,
      dedup,
      compact,
      totalDurationMs: Date.now() - start,
    };
  }
}

export default MemoryConsolidator;
