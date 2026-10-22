/**
 * V3 Cache Manager
 *
 * High-performance LRU cache with TTL support, memory pressure handling,
 * and write-through caching for the unified memory system.
 *
 * @module v3/memory/cache-manager
 */

import { EventEmitter } from 'node:events';
import {
  CacheConfig,
  CacheStats,
  CachedEntry,
  MemoryEntry,
  MemoryEvent,
} from './types.js';

/**
 * Doubly-linked list node for LRU implementation
 */
interface LRUNode<T> {
  key: string;
  value: CachedEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

/**
 * High-performance LRU Cache with TTL support
 *
 * Features:
 * - O(1) get, set, delete operations
 * - LRU eviction policy
 * - TTL-based expiration
 * - Memory pressure handling
 * - Write-through caching support
 * - Performance statistics
 */
export class CacheManager<T = MemoryEntry> extends EventEmitter {
  private config: CacheConfig;
  private cache: Map<string, LRUNode<T>> = new Map();
  private head: LRUNode<T> | null = null;
  private tail: LRUNode<T> | null = null;
  private currentMemory: number = 0;

  // Statistics
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
    expirations: number;
    writes: number;
  } = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
    writes: 0,
  };

  // Cleanup timer
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
    this.startCleanupTimer();
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | null {
    const node = this.cache.get(key);

    if (!node) {
      this.stats.misses++;
      this.emit('cache:miss', { key });
      return null;
    }

    // Check if expired
    if (this.isExpired(node.value)) {
      this.delete(key);
      this.stats.misses++;
      this.stats.expirations++;
      this.emit('cache:expired', { key });
      return null;
    }

    // Update access time and count
    node.value.lastAccessedAt = Date.now();
    node.value.accessCount++;

    // Move to front (most recently used)
    this.moveToFront(node);

    this.stats.hits++;
    this.emit('cache:hit', { key });

    return node.value.data;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    const entryTtl = ttl || this.config.ttl;

    const entryMemory = this.estimateSize(data);
    // A value larger than the entire budget cannot be cached. Invalidate an
    // older value for this key, but preserve unrelated useful entries.
    if (this.config.maxMemory && entryMemory > this.config.maxMemory) {
      this.delete(key);
      return;
    }

    // Check if key already exists
    const existingNode = this.cache.get(key);
    if (existingNode) {
      // Account for the old value before overwriting it.
      this.currentMemory += entryMemory - this.estimateSize(existingNode.value.data);
      // Update existing entry
      existingNode.value.data = data;
      existingNode.value.cachedAt = now;
      existingNode.value.expiresAt = now + entryTtl;
      existingNode.value.lastAccessedAt = now;

      this.moveToFront(existingNode);
      if (this.config.maxMemory) {
        while (this.currentMemory > this.config.maxMemory && this.cache.size > 0) {
          this.evictLRU();
        }
      }
      this.stats.writes++;
      return;
    }

    // Evict entries if needed for memory pressure
    if (this.config.maxMemory) {
      while (
        this.currentMemory + entryMemory > this.config.maxMemory &&
        this.cache.size > 0
      ) {
        this.evictLRU();
      }
    }

    // Evict entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    // Create new node
    const cachedEntry: CachedEntry<T> = {
      data,
      cachedAt: now,
      expiresAt: now + entryTtl,
      lastAccessedAt: now,
      accessCount: 0,
    };

    const node: LRUNode<T> = {
      key,
      value: cachedEntry,
      prev: null,
      next: null,
    };

    // Add to cache
    this.cache.set(key, node);
    this.addToFront(node);
    this.currentMemory += entryMemory;
    this.stats.writes++;

    this.emit('cache:set', { key, ttl: entryTtl });
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.cache.delete(key);
    this.currentMemory -= this.estimateSize(node.value.data);

    this.emit('cache:delete', { key });
    return true;
  }

  /**
   * Check if a key exists in the cache (without affecting LRU order)
   */
  has(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;
    if (this.isExpired(node.value)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentMemory = 0;

    this.emit('cache:cleared', { previousSize: this.cache.size });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      memoryUsage: this.currentMemory,
    };
  }

  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Prefetch multiple keys in a single batch
   */
  async prefetch(
    keys: string[],
    loader: (keys: string[]) => Promise<Map<string, T>>,
    ttl?: number
  ): Promise<void> {
    const missing = keys.filter((key) => !this.has(key));

    if (missing.length === 0) {
      return;
    }

    const data = await loader(missing);

    for (const [key, value] of data) {
      this.set(key, value, ttl);
    }

    this.emit('cache:prefetched', { keys: missing.length });
  }

  /**
   * Get or set pattern - get from cache or load and cache
   */
  async getOrSet(
    key: string,
    loader: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await loader();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * Warm the cache with initial data
   */
  warmUp(entries: Array<{ key: string; data: T; ttl?: number }>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.data, entry.ttl);
    }
    this.emit('cache:warmedUp', { count: entries.length });
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let invalidated = 0;

    for (const key of this.cache.keys()) {
      // RegExp cursors belong to a single input, not the whole key sequence.
      const stateful = regex.global || regex.sticky;
      const lastIndex = regex.lastIndex;
      if (stateful) regex.lastIndex = 0;
      const matches = regex.test(key);
      if (stateful) regex.lastIndex = lastIndex;
      if (matches) {
        this.delete(key);
        invalidated++;
      }
    }

    this.emit('cache:invalidated', { pattern: pattern.toString(), count: invalidated });
    return invalidated;
  }

  /**
   * Shutdown the cache manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    this.emit('cache:shutdown');
  }

  // ===== Private Methods =====

  private mergeConfig(config: Partial<CacheConfig>): CacheConfig {
    return {
      maxSize: config.maxSize || 10000,
      ttl: config.ttl || 300000, // 5 minutes default
      lruEnabled: config.lruEnabled !== false,
      maxMemory: config.maxMemory,
      writeThrough: config.writeThrough || false,
    };
  }

  private isExpired(entry: CachedEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  private estimateSize(data: T): number {
    try {
      return JSON.stringify(data).length * 2; // Rough UTF-16 estimate
    } catch {
      return 1000; // Default for non-serializable objects
    }
  }

  private addToFront(node: LRUNode<T>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToFront(node: LRUNode<T>): void {
    if (node === this.head) return;

    this.removeNode(node);
    this.addToFront(node);
  }

  private evictLRU(): void {
    if (!this.tail) return;

    const evictedKey = this.tail.key;
    const evictedSize = this.estimateSize(this.tail.value.data);

    this.removeNode(this.tail);
    this.cache.delete(evictedKey);
    this.currentMemory -= evictedSize;
    this.stats.evictions++;

    this.emit('cache:eviction', { key: evictedKey });
  }

  private startCleanupTimer(): void {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, node] of this.cache) {
      if (node.value.expiresAt < now) {
        this.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit('cache:cleanup', { expired: cleaned });
    }
  }
}

/**
 * Multi-layer cache with L1 (memory) and L2 (storage) tiers
 */
export class TieredCacheManager<T = MemoryEntry> extends EventEmitter {
  private l1Cache: CacheManager<T>;
  private l2Loader: ((key: string) => Promise<T | null>) | null = null;
  private l2Writer: ((key: string, value: T) => Promise<void>) | null = null;

  constructor(
    l1Config: Partial<CacheConfig> = {},
    l2Options?: {
      loader: (key: string) => Promise<T | null>;
      writer?: (key: string, value: T) => Promise<void>;
    }
  ) {
    super();
    this.l1Cache = new CacheManager<T>(l1Config);

    if (l2Options) {
      this.l2Loader = l2Options.loader;
      this.l2Writer = l2Options.writer ?? null;
    }

    // Forward L1 events
    this.l1Cache.on('cache:hit', (data) => this.emit('l1:hit', data));
    this.l1Cache.on('cache:miss', (data) => this.emit('l1:miss', data));
    this.l1Cache.on('cache:eviction', (data) => this.emit('l1:eviction', data));
  }

  /**
   * Get from tiered cache
   */
  async get(key: string): Promise<T | null> {
    // Try L1 first
    const l1Result = this.l1Cache.get(key);
    if (l1Result !== null) {
      return l1Result;
    }

    // Try L2 if available
    if (this.l2Loader) {
      const l2Result = await this.l2Loader(key);
      if (l2Result !== null) {
        // Promote to L1
        this.l1Cache.set(key, l2Result);
        this.emit('l2:hit', { key });
        return l2Result;
      }
      this.emit('l2:miss', { key });
    }

    return null;
  }

  /**
   * Set in tiered cache
   */
  async set(key: string, value: T, ttl?: number): Promise<void> {
    // Write to L1
    this.l1Cache.set(key, value, ttl);

    // Write-through to L2 if configured
    if (this.l2Writer) {
      await this.l2Writer(key, value);
      this.emit('l2:write', { key });
    }
  }

  /**
   * Delete from tiered cache
   */
  delete(key: string): boolean {
    return this.l1Cache.delete(key);
  }

  /**
   * Get L1 cache statistics
   */
  getStats(): CacheStats {
    return this.l1Cache.getStats();
  }

  /**
   * Clear L1 cache
   */
  clear(): void {
    this.l1Cache.clear();
  }

  /**
   * Shutdown tiered cache
   */
  shutdown(): void {
    this.l1Cache.shutdown();
  }
}

export default CacheManager;
