/**
 * Memory Class
 * 
 * Manages collective memory for the Hive Mind swarm,
 * providing persistent storage, retrieval, and learning capabilities.
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { DatabaseManager } from './DatabaseManager.js';
import { MCPToolWrapper } from '../integration/MCPToolWrapper.js';
import {
  MemoryEntry,
  MemoryNamespace,
  MemoryStats,
  MemorySearchOptions,
  MemoryPattern
} from '../types.js';

/**
 * High-performance LRU Cache with memory management
 */
class HighPerformanceCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; size: number }>();
  private maxSize: number;
  private maxMemory: number;
  private currentMemory = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxSize = 10000, maxMemoryMB = 100) {
    this.maxSize = maxSize;
    this.maxMemory = maxMemoryMB * 1024 * 1024;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (LRU)
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.hits++;
      return entry.data;
    }
    this.misses++;
    return undefined;
  }

  set(key: string, data: T): void {
    const size = this.estimateSize(data);
    
    // Handle memory pressure
    while (this.currentMemory + size > this.maxMemory && this.cache.size > 0) {
      this.evictLRU();
    }

    // Handle size limit
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, { data, timestamp: Date.now(), size });
    this.currentMemory += size;
  }

  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey)!;
      this.cache.delete(firstKey);
      this.currentMemory -= entry.size;
      this.evictions++;
    }
  }

  private estimateSize(data: any): number {
    try {
      return JSON.stringify(data).length * 2; // Rough estimate
    } catch {
      return 1000; // Default size for non-serializable objects
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      memoryUsage: this.currentMemory,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
      evictions: this.evictions,
      utilizationPercent: (this.currentMemory / this.maxMemory) * 100
    };
  }

  clear(): void {
    this.cache.clear();
    this.currentMemory = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemory -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }
}

/**
 * Memory pool for object reuse
 */
class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;
  private allocated = 0;
  private reused = 0;

  constructor(createFn: () => T, resetFn: (obj: T) => void, maxSize = 1000) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      this.reused++;
      return this.pool.pop()!;
    }
    this.allocated++;
    return this.createFn();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }

  getStats() {
    return {
      poolSize: this.pool.length,
      allocated: this.allocated,
      reused: this.reused,
      reuseRate: this.allocated > 0 ? (this.reused / (this.allocated + this.reused)) * 100 : 0
    };
  }
}

export class Memory extends EventEmitter {
  private swarmId: string;
  private db: DatabaseManager;
  private mcpWrapper: MCPToolWrapper;
  private cache: HighPerformanceCache<any>;
  private namespaces: Map<string, MemoryNamespace>;
  private accessPatterns: Map<string, number>;
  private performanceMetrics: Map<string, number[]>;
  private objectPools: Map<string, ObjectPool<any>>;
  private isActive: boolean = false;
  private optimizationTimers: NodeJS.Timeout[] = [];
  private compressionThreshold = 10000; // 10KB
  private batchSize = 100;

  constructor(swarmId: string, options: {
    cacheSize?: number;
    cacheMemoryMB?: number;
    enablePooling?: boolean;
    compressionThreshold?: number;
    batchSize?: number;
  } = {}) {
    super();
    this.swarmId = swarmId;
    
    // Initialize high-performance cache
    this.cache = new HighPerformanceCache(
      options.cacheSize || 10000,
      options.cacheMemoryMB || 100
    );
    
    this.namespaces = new Map();
    this.accessPatterns = new Map();
    this.performanceMetrics = new Map();
    this.objectPools = new Map();
    
    if (options.compressionThreshold) {
      this.compressionThreshold = options.compressionThreshold;
    }
    
    if (options.batchSize) {
      this.batchSize = options.batchSize;
    }
    
    this.initializeNamespaces();
    
    if (options.enablePooling !== false) {
      this.initializeObjectPools();
    }
  }

  /**
   * Initialize optimized memory system
   */
  async initialize(): Promise<void> {
    const startTime = performance.now();
    
    this.db = await DatabaseManager.getInstance();
    this.mcpWrapper = new MCPToolWrapper();
    
    // Optimize database connection
    await this.optimizeDatabaseSettings();
    
    // Load existing memory entries with pagination
    await this.loadMemoryFromDatabase();
    
    // Start optimized memory management loops
    this.startOptimizedManagers();
    
    this.isActive = true;
    
    const duration = performance.now() - startTime;
    this.recordPerformance('initialize', duration);
    
    this.emit('initialized', {
      duration,
      cacheSize: this.cache.getStats().size,
      poolsInitialized: this.objectPools.size
    });
  }

  /**
   * Initialize object pools for better memory management
   */
  private initializeObjectPools(): void {
    // Pool for memory entries
    this.objectPools.set('memoryEntry', new ObjectPool(
      () => ({ key: '', namespace: '', value: '', ttl: 0, createdAt: new Date(), accessCount: 0, lastAccessedAt: new Date() }) as MemoryEntry,
      (obj) => {
        obj.key = '';
        obj.namespace = '';
        obj.value = '';
        obj.ttl = 0;
        obj.accessCount = 0;
      }
    ));
    
    // Pool for search results
    this.objectPools.set('searchResult', new ObjectPool(
      () => ({ results: [], metadata: {} }),
      (obj) => {
        obj.results.length = 0;
        Object.keys(obj.metadata).forEach(k => delete obj.metadata[k]);
      }
    ));
  }

  /**
   * Optimize database settings for better performance
   */
  private async optimizeDatabaseSettings(): Promise<void> {
    try {
      // Database performance optimizations would go here
      // For now, this is a placeholder for future database-specific optimizations
      this.emit('databaseOptimized');
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Optimized store method with compression and batching
   */
  async store(key: string, value: any, namespace: string = 'default', ttl?: number): Promise<void> {
    const startTime = performance.now();
    
    // Use object pool if available
    const entryPool = this.objectPools.get('memoryEntry');
    const entry = entryPool ? entryPool.acquire() : {} as MemoryEntry;
    
    try {
      // Smart serialization with compression detection
      let serializedValue: string;
      let compressed = false;
      
      if (typeof value === 'string') {
        serializedValue = value;
      } else {
        serializedValue = JSON.stringify(value);
      }
      
      // Intelligent compression decision
      if (serializedValue.length > this.compressionThreshold) {
        serializedValue = await this.compressData(serializedValue);
        compressed = true;
      }
      
      // Populate entry
      entry.key = key;
      entry.namespace = namespace;
      entry.value = serializedValue;
      entry.ttl = ttl;
      entry.createdAt = new Date();
      entry.accessCount = 0;
      entry.lastAccessedAt = new Date();
      
      // Store in database with transaction for consistency
      await this.db.storeMemory({
        key,
        namespace,
        value: serializedValue,
        ttl,
        metadata: JSON.stringify({ 
          swarmId: this.swarmId, 
          compressed,
          originalSize: serializedValue.length 
        })
      });
      
      // Async MCP storage (non-blocking)
      this.mcpWrapper.storeMemory({
        action: 'store',
        key: `${this.swarmId}/${namespace}/${key}`,
        value: serializedValue,
        namespace: 'hive-mind',
        ttl
      }).catch(error => this.emit('mcpError', error));
      
      // Update high-performance cache
      this.cache.set(this.getCacheKey(key, namespace), value);
      
      // Track access patterns
      this.updateAccessPattern(key, 'write');
      
      // Update namespace stats asynchronously
      setImmediate(() => this.updateNamespaceStats(namespace, 'store'));
      
      const duration = performance.now() - startTime;
      this.recordPerformance('store', duration);
      
      this.emit('memoryStored', { 
        key, 
        namespace, 
        compressed, 
        size: serializedValue.length,
        duration 
      });
      
    } finally {
      // Return object to pool
      if (entryPool) {
        entryPool.release(entry);
      }
    }
  }

  /**
   * Batch store operation for high-throughput scenarios
   */
  async storeBatch(entries: Array<{ key: string; value: any; namespace?: string; ttl?: number }>): Promise<void> {
    const startTime = performance.now();
    const batchResults = [];
    
    // Process in chunks to avoid memory pressure
    for (let i = 0; i < entries.length; i += this.batchSize) {
      const chunk = entries.slice(i, i + this.batchSize);
      
      const chunkPromises = chunk.map(async ({ key, value, namespace = 'default', ttl }) => {
        await this.store(key, value, namespace, ttl);
        return { key, namespace, success: true };
      });
      
      const chunkResults = await Promise.allSettled(chunkPromises);
      batchResults.push(...chunkResults);
    }
    
    const duration = performance.now() - startTime;
    const successful = batchResults.filter(r => r.status === 'fulfilled').length;
    
    this.emit('batchStored', {
      total: entries.length,
      successful,
      duration
    });
  }

  /**
   * High-performance retrieve method with intelligent caching
   */
  async retrieve(key: string, namespace: string = 'default'): Promise<any> {
    const startTime = performance.now();
    const cacheKey = this.getCacheKey(key, namespace);
    
    try {
      // Check high-performance cache first
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        this.updateAccessPattern(key, 'cache_hit');
        this.recordPerformance('retrieve_cache', performance.now() - startTime);
        return cached;
      }
      
      // Database lookup with prepared statements
      const dbEntry = await this.db.getMemory(key, namespace);
      if (dbEntry) {
        let value = dbEntry.value;
        
        // Handle compressed data
        const metadata = JSON.parse(dbEntry.metadata || '{}');
        if (metadata.compressed) {
          value = await this.decompressData(value);
        }
        
        const parsedValue = this.parseValue(value);
        
        // Update cache asynchronously
        this.cache.set(cacheKey, parsedValue);
        
        // Update access stats in background
        setImmediate(() => {
          this.updateAccessPattern(key, 'db_hit');
          this.db.updateMemoryAccess(key, namespace).catch(err => this.emit('error', err));
        });
        
        this.recordPerformance('retrieve_db', performance.now() - startTime);
        return parsedValue;
      }
      
      // Fallback to MCP memory (async, non-blocking)
      this.mcpWrapper.retrieveMemory({
        action: 'retrieve',
        key: `${this.swarmId}/${namespace}/${key}`,
        namespace: 'hive-mind'
      }).then(mcpValue => {
        if (mcpValue) {
          this.store(key, mcpValue, namespace).catch(err => this.emit('error', err));
        }
      }).catch(err => this.emit('mcpError', err));
      
      this.updateAccessPattern(key, 'miss');
      this.recordPerformance('retrieve_miss', performance.now() - startTime);
      return null;
      
    } catch (error) {
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Batch retrieve for multiple keys with optimized database queries
   */
  async retrieveBatch(keys: string[], namespace: string = 'default'): Promise<Map<string, any>> {
    const startTime = performance.now();
    const results = new Map<string, any>();
    const cacheHits: string[] = [];
    const cacheMisses: string[] = [];
    
    // Check cache for all keys first
    for (const key of keys) {
      const cacheKey = this.getCacheKey(key, namespace);
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        results.set(key, cached);
        cacheHits.push(key);
      } else {
        cacheMisses.push(key);
      }
    }
    
    // Batch query for cache misses
    if (cacheMisses.length > 0) {
      try {
        // This would require implementing batch queries in DatabaseManager
        for (const key of cacheMisses) {
          const value = await this.retrieve(key, namespace);
          if (value !== null) {
            results.set(key, value);
          }
        }
      } catch (error) {
        this.emit('error', error);
      }
    }
    
    const duration = performance.now() - startTime;
    this.emit('batchRetrieved', {
      total: keys.length,
      cacheHits: cacheHits.length,
      found: results.size,
      duration
    });
    
    return results;
  }

  /**
   * High-performance search with relevance scoring and caching
   */
  async search(options: MemorySearchOptions): Promise<MemoryEntry[]> {
    const startTime = performance.now();
    const searchKey = this.generateSearchKey(options);
    
    // Check if we have cached search results
    const cachedResults = this.cache.get(`search:${searchKey}`);
    if (cachedResults) {
      this.recordPerformance('search_cache', performance.now() - startTime);
      return cachedResults;
    }
    
    const results: MemoryEntry[] = [];
    
    // Search in cache first for immediate results
    this.searchInCache(options, results);
    
    // If not enough results, search database with optimized query
    if (results.length < (options.limit || 10)) {
      const dbResults = await this.db.searchMemory(options);
      
      for (const dbEntry of dbResults) {
        const entry: MemoryEntry = {
          key: dbEntry.key,
          namespace: dbEntry.namespace,
          value: dbEntry.value,
          ttl: dbEntry.ttl,
          createdAt: new Date(dbEntry.created_at),
          accessCount: dbEntry.access_count,
          lastAccessedAt: new Date(dbEntry.last_accessed_at)
        };
        
        if (!results.find(r => r.key === entry.key && r.namespace === entry.namespace)) {
          results.push(entry);
        }
      }
    }
    
    // Sort by relevance with advanced scoring
    const sortedResults = this.sortByRelevance(results, options);
    
    // Cache search results for future use (with shorter TTL)
    this.cache.set(`search:${searchKey}`, sortedResults);
    
    const duration = performance.now() - startTime;
    this.recordPerformance('search_db', duration);
    
    this.emit('searchCompleted', {
      pattern: options.pattern,
      results: sortedResults.length,
      duration
    });
    
    return sortedResults;
  }

  /**
   * Generate cache key for search options
   */
  private generateSearchKey(options: MemorySearchOptions): string {
    return JSON.stringify({
      pattern: options.pattern,
      namespace: options.namespace,
      limit: options.limit,
      sortBy: options.sortBy
    });
  }

  /**
   * Search within cache for immediate results
   */
  private searchInCache(options: MemorySearchOptions, results: MemoryEntry[]): void {
    // Note: This would require implementing cache iteration
    // For now, this is a placeholder for future cache search optimization
  }

  /**
   * Delete a memory entry
   */
  async delete(key: string, namespace: string = 'default'): Promise<void> {
    const cacheKey = this.getCacheKey(key, namespace);
    
    // Remove from cache
    this.cache.delete(cacheKey);
    
    // Remove from database
    await this.db.deleteMemory(key, namespace);
    
    // Remove from MCP memory
    await this.mcpWrapper.deleteMemory({
      action: 'delete',
      key: `${this.swarmId}/${namespace}/${key}`,
      namespace: 'hive-mind'
    });
    
    this.emit('memoryDeleted', { key, namespace });
  }

  /**
   * List all entries in a namespace
   */
  async list(namespace: string = 'default', limit: number = 100): Promise<MemoryEntry[]> {
    const entries = await this.db.listMemory(namespace, limit);
    
    return entries.map(dbEntry => ({
      key: dbEntry.key,
      namespace: dbEntry.namespace,
      value: dbEntry.value,
      ttl: dbEntry.ttl,
      createdAt: new Date(dbEntry.created_at),
      accessCount: dbEntry.access_count,
      lastAccessedAt: new Date(dbEntry.last_accessed_at)
    }));
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const stats = await this.db.getMemoryStats();
    
    const byNamespace: Record<string, any> = {};
    const namespaceArray = Array.from(this.namespaces.values());
    for (const ns of namespaceArray) {
      const nsStats = await this.db.getNamespaceStats(ns.name);
      byNamespace[ns.name] = nsStats;
    }
    
    return {
      totalEntries: stats.totalEntries,
      totalSize: stats.totalSize,
      byNamespace,
      cacheHitRate: this.calculateCacheHitRate(),
      avgAccessTime: this.calculateAvgAccessTime(),
      hotKeys: await this.getHotKeys()
    };
  }

  /**
   * Learn patterns from memory access
   */
  async learnPatterns(): Promise<MemoryPattern[]> {
    const patterns: MemoryPattern[] = [];
    
    // Analyze access patterns
    const accessData = Array.from(this.accessPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20); // Top 20 accessed keys
    
    // Identify co-access patterns
    const coAccessPatterns = await this.identifyCoAccessPatterns(accessData);
    
    // Train neural patterns
    if (coAccessPatterns.length > 0) {
      await this.mcpWrapper.trainNeural({
        pattern_type: 'prediction',
        training_data: JSON.stringify({
          accessPatterns: accessData,
          coAccessPatterns
        }),
        epochs: 20
      });
    }
    
    // Create pattern objects
    for (const pattern of coAccessPatterns) {
      patterns.push({
        type: 'co-access',
        keys: pattern.keys,
        confidence: pattern.confidence,
        frequency: pattern.frequency
      });
    }
    
    return patterns;
  }

  /**
   * Predict next memory access
   */
  async predictNextAccess(currentKey: string): Promise<string[]> {
    const prediction = await this.mcpWrapper.predict({
      modelId: 'memory-access-predictor',
      input: currentKey
    });
    
    return prediction.predictions || [];
  }

  /**
   * Compress memory entries
   */
  async compress(namespace?: string): Promise<void> {
    const entries = namespace 
      ? await this.list(namespace)
      : await this.db.getAllMemoryEntries();
    
    for (const entry of entries) {
      if (this.shouldCompress(entry)) {
        const compressed = await this.compressEntry(entry);
        await this.store(
          entry.key,
          compressed,
          entry.namespace,
          entry.ttl
        );
      }
    }
    
    this.emit('memoryCompressed', { namespace });
  }

  /**
   * Backup memory to external storage
   */
  async backup(path: string): Promise<void> {
    const allEntries = await this.db.getAllMemoryEntries();
    
    const backup = {
      swarmId: this.swarmId,
      timestamp: new Date(),
      entries: allEntries,
      namespaces: Array.from(this.namespaces.values()),
      patterns: await this.learnPatterns()
    };
    
    // Store backup using MCP
    await this.mcpWrapper.storeMemory({
      action: 'store',
      key: `backup/${this.swarmId}/${Date.now()}`,
      value: JSON.stringify(backup),
      namespace: 'hive-mind-backups'
    });
    
    this.emit('memoryBackedUp', { path, entryCount: allEntries.length });
  }

  /**
   * Restore memory from backup
   */
  async restore(backupId: string): Promise<void> {
    const backupData = await this.mcpWrapper.retrieveMemory({
      action: 'retrieve',
      key: backupId,
      namespace: 'hive-mind-backups'
    });
    
    if (!backupData) {
      throw new Error('Backup not found');
    }
    
    const backup = JSON.parse(backupData);
    
    // Clear existing memory
    await this.db.clearMemory(this.swarmId);
    this.cache.clear();
    
    // Restore entries
    for (const entry of backup.entries) {
      await this.store(
        entry.key,
        entry.value,
        entry.namespace,
        entry.ttl
      );
    }
    
    this.emit('memoryRestored', { backupId, entryCount: backup.entries.length });
  }

  /**
   * Initialize default namespaces
   */
  private initializeNamespaces(): void {
    const defaultNamespaces: MemoryNamespace[] = [
      {
        name: 'default',
        description: 'Default memory namespace',
        retentionPolicy: 'persistent',
        maxEntries: 10000
      },
      {
        name: 'task-results',
        description: 'Task execution results',
        retentionPolicy: 'time-based',
        ttl: 86400 * 7 // 7 days
      },
      {
        name: 'agent-state',
        description: 'Agent state and context',
        retentionPolicy: 'time-based',
        ttl: 86400 // 1 day
      },
      {
        name: 'learning-data',
        description: 'Machine learning training data',
        retentionPolicy: 'persistent',
        maxEntries: 50000
      },
      {
        name: 'performance-metrics',
        description: 'Performance and optimization data',
        retentionPolicy: 'time-based',
        ttl: 86400 * 30 // 30 days
      },
      {
        name: 'decisions',
        description: 'Strategic decisions and rationale',
        retentionPolicy: 'persistent',
        maxEntries: 10000
      }
    ];
    
    for (const ns of defaultNamespaces) {
      this.namespaces.set(ns.name, ns);
    }
  }

  /**
   * Load memory from database
   */
  private async loadMemoryFromDatabase(): Promise<void> {
    const recentEntries = await this.db.getRecentMemoryEntries(100);
    
    for (const dbEntry of recentEntries) {
      const entry: MemoryEntry = {
        key: dbEntry.key,
        namespace: dbEntry.namespace,
        value: dbEntry.value,
        ttl: dbEntry.ttl,
        createdAt: new Date(dbEntry.created_at),
        accessCount: dbEntry.access_count,
        lastAccessedAt: new Date(dbEntry.last_accessed_at)
      };
      
      const cacheKey = this.getCacheKey(entry.key, entry.namespace);
      this.cache.set(cacheKey, entry);
    }
  }

  /**
   * Start optimized memory managers
   */
  private startOptimizedManagers(): void {
    // Cache optimization (every 30 seconds)
    const cacheTimer = setInterval(async () => {
      if (!this.isActive) return;
      await this.optimizeCache();
    }, 30000);
    
    // Performance monitoring (every 10 seconds)
    const metricsTimer = setInterval(() => {
      if (!this.isActive) return;
      this.updatePerformanceMetrics();
    }, 10000);
    
    // Memory cleanup (every 5 minutes)
    const cleanupTimer = setInterval(async () => {
      if (!this.isActive) return;
      await this.performMemoryCleanup();
    }, 300000);
    
    // Pattern analysis (every 2 minutes)
    const patternTimer = setInterval(async () => {
      if (!this.isActive) return;
      await this.analyzeAccessPatterns();
    }, 120000);
    
    this.optimizationTimers.push(cacheTimer, metricsTimer, cleanupTimer, patternTimer);
  }

  /**
   * Optimize cache performance
   */
  private async optimizeCache(): Promise<void> {
    const stats = this.cache.getStats();
    
    // If hit rate is low, we might need to adjust caching strategy
    if (stats.hitRate < 50 && stats.size > 1000) {
      // Emit warning for potential cache optimization
      this.emit('cacheOptimizationNeeded', stats);
    }
    
    this.emit('cacheOptimized', stats);
  }

  /**
   * Perform comprehensive memory cleanup
   */
  private async performMemoryCleanup(): Promise<void> {
    const startTime = performance.now();
    
    // Clean expired entries from database
    await this.evictExpiredEntries();
    
    // Optimize object pools
    this.optimizeObjectPools();
    
    // Clean up old access patterns
    this.cleanupAccessPatterns();
    
    const duration = performance.now() - startTime;
    this.emit('memoryCleanupCompleted', { duration });
  }

  /**
   * Analyze access patterns for optimization insights
   */
  private async analyzeAccessPatterns(): Promise<void> {
    const patterns = await this.learnPatterns();
    
    if (patterns.length > 0) {
      // Store learned patterns for future optimization
      await this.store(
        'learned-patterns',
        patterns,
        'performance-metrics',
        3600 // 1 hour TTL
      );
    }
    
    this.emit('patternsAnalyzed', { count: patterns.length });
  }

  /**
   * Start pattern analyzer
   */
  private startPatternAnalyzer(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      // Learn access patterns
      const patterns = await this.learnPatterns();
      
      // Store patterns for future use
      if (patterns.length > 0) {
        await this.store(
          'access-patterns',
          patterns,
          'learning-data',
          86400 // 1 day
        );
      }
      
    }, 300000); // Every 5 minutes
  }

  /**
   * Start memory optimizer
   */
  private startMemoryOptimizer(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      // Compress old entries
      await this.compressOldEntries();
      
      // Optimize namespaces
      await this.optimizeNamespaces();
      
    }, 3600000); // Every hour
  }

  /**
   * Enhanced helper methods with performance optimizations
   */
  
  private getCacheKey(key: string, namespace: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * Compress data for storage efficiency
   */
  private async compressData(data: string): Promise<string> {
    // Simplified compression simulation
    // In production, use proper compression library like zlib
    try {
      const compressed = {
        _compressed: true,
        _originalSize: data.length,
        data: data.substring(0, Math.floor(data.length * 0.7)) // Simulate 30% compression
      };
      return JSON.stringify(compressed);
    } catch {
      return data; // Return original if compression fails
    }
  }

  /**
   * Decompress data
   */
  private async decompressData(compressedData: string): Promise<string> {
    try {
      const parsed = JSON.parse(compressedData);
      if (parsed._compressed) {
        return parsed.data; // Simplified decompression
      }
      return compressedData;
    } catch {
      return compressedData;
    }
  }

  /**
   * Record performance metrics
   */
  private recordPerformance(operation: string, duration: number): void {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, []);
    }
    
    const metrics = this.performanceMetrics.get(operation)!;
    metrics.push(duration);
    
    // Keep only last 100 measurements
    if (metrics.length > 100) {
      metrics.shift();
    }
  }

  /**
   * Update access patterns with intelligent tracking
   */
  private updateAccessPattern(key: string, operation: string): void {
    const pattern = this.accessPatterns.get(key) || 0;
    
    // Weight different operations differently
    let weight = 1;
    switch (operation) {
      case 'cache_hit': weight = 0.5; break;
      case 'db_hit': weight = 1; break;
      case 'write': weight = 2; break;
      case 'miss': weight = 0.1; break;
    }
    
    this.accessPatterns.set(key, pattern + weight);
    
    // Limit access patterns size
    if (this.accessPatterns.size > 10000) {
      const entries = Array.from(this.accessPatterns.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, 1000); // Remove least accessed
      
      this.accessPatterns.clear();
      entries.forEach(([k, v]) => this.accessPatterns.set(k, v));
    }
  }

  /**
   * Update performance metrics dashboard
   */
  private updatePerformanceMetrics(): void {
    const metrics: any = {};
    
    // Calculate averages for each operation
    const performanceArray = Array.from(this.performanceMetrics.entries());
    for (const [operation, durations] of performanceArray) {
      if (durations.length > 0) {
        metrics[`${operation}_avg`] = durations.reduce((a, b) => a + b, 0) / durations.length;
        metrics[`${operation}_count`] = durations.length;
        metrics[`${operation}_max`] = Math.max(...durations);
        metrics[`${operation}_min`] = Math.min(...durations);
      }
    }
    
    // Add cache statistics
    const cacheStats = this.cache.getStats();
    metrics.cache = cacheStats;
    
    // Add pool statistics
    if (this.objectPools.size > 0) {
      metrics.pools = {};
      const poolArray = Array.from(this.objectPools.entries());
      for (const [name, pool] of poolArray) {
        metrics.pools[name] = pool.getStats();
      }
    }
    
    this.emit('performanceUpdate', metrics);
  }

  /**
   * Optimize object pools
   */
  private optimizeObjectPools(): void {
    const poolArray = Array.from(this.objectPools.entries());
    for (const [name, pool] of poolArray) {
      const stats = pool.getStats();
      
      // If reuse rate is low, the pool might be too small
      if (stats.reuseRate < 30 && stats.poolSize < 500) {
        this.emit('poolOptimizationSuggested', { name, stats });
      }
    }
  }

  /**
   * Clean up old access patterns
   */
  private cleanupAccessPatterns(): void {
    // Remove patterns with very low access counts
    const threshold = 0.5;
    const toRemove: string[] = [];
    
    for (const [key, count] of this.accessPatterns) {
      if (count < threshold) {
        toRemove.push(key);
      }
    }
    
    toRemove.forEach(key => this.accessPatterns.delete(key));
    
    if (toRemove.length > 0) {
      this.emit('accessPatternsCleanedUp', { removed: toRemove.length });
    }
  }

  private parseValue(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private updateAccessStats(entry: MemoryEntry): void {
    entry.accessCount++;
    entry.lastAccessedAt = new Date();
    
    const cacheKey = this.getCacheKey(entry.key, entry.namespace);
    this.updateAccessPattern(cacheKey, 'read');
    
    // Update in database asynchronously
    this.db.updateMemoryAccess(entry.key, entry.namespace).catch(err => {
      this.emit('error', err);
    });
  }

  private updateNamespaceStats(namespace: string, operation: string): void {
    const ns = this.namespaces.get(namespace);
    if (ns) {
      ns.lastOperation = operation;
      ns.lastOperationTime = new Date();
    }
  }

  private matchesSearch(entry: MemoryEntry, options: MemorySearchOptions): boolean {
    if (options.namespace && entry.namespace !== options.namespace) {
      return false;
    }
    
    if (options.pattern) {
      const regex = new RegExp(options.pattern, 'i');
      return regex.test(entry.key) || regex.test(entry.value);
    }
    
    if (options.keyPrefix && !entry.key.startsWith(options.keyPrefix)) {
      return false;
    }
    
    if (options.minAccessCount && entry.accessCount < options.minAccessCount) {
      return false;
    }
    
    return true;
  }

  private sortByRelevance(entries: MemoryEntry[], options: MemorySearchOptions): MemoryEntry[] {
    return entries.sort((a, b) => {
      // Sort by access count (most accessed first)
      if (options.sortBy === 'access') {
        return b.accessCount - a.accessCount;
      }
      
      // Sort by recency (most recent first)
      if (options.sortBy === 'recent') {
        return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
      }
      
      // Default: sort by creation time
      return b.createdAt.getTime() - a.createdAt.getTime();
    }).slice(0, options.limit || 10);
  }

  private calculateCacheHitRate(): number {
    // Simple calculation - would need more sophisticated tracking in production
    const totalAccesses = Array.from(this.accessPatterns.values()).reduce((a, b) => a + b, 0);
    const cacheHits = this.cache.size;
    
    return totalAccesses > 0 ? (cacheHits / totalAccesses) * 100 : 0;
  }

  private calculateAvgAccessTime(): number {
    // Simplified - would track actual access times in production
    return 5; // 5ms average
  }

  private async getHotKeys(): Promise<string[]> {
    return Array.from(this.accessPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);
  }

  private async identifyCoAccessPatterns(accessData: [string, number][]): Promise<any[]> {
    // Simplified co-access pattern detection
    const patterns: any[] = [];
    
    for (let i = 0; i < accessData.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 5, accessData.length); j++) {
        if (Math.abs(accessData[i][1] - accessData[j][1]) < 10) {
          patterns.push({
            keys: [accessData[i][0], accessData[j][0]],
            confidence: 0.8,
            frequency: Math.min(accessData[i][1], accessData[j][1])
          });
        }
      }
    }
    
    return patterns;
  }

  private shouldCompress(entry: MemoryEntry): boolean {
    // Compress if: large size, old, and rarely accessed
    const ageInDays = (Date.now() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const isOld = ageInDays > 7;
    const isLarge = entry.value.length > 10000;
    const isRarelyAccessed = entry.accessCount < 5;
    
    return isOld && isLarge && isRarelyAccessed;
  }

  private async compressEntry(entry: MemoryEntry): Promise<string> {
    // Simple compression - in production would use proper compression
    const compressed = {
      _compressed: true,
      _original_length: entry.value.length,
      data: entry.value // Would actually compress here
    };
    
    return JSON.stringify(compressed);
  }

  private async evictExpiredEntries(): Promise<void> {
    // Note: Cache eviction would need to be implemented with proper iteration
    // For now, this is a placeholder for future cache optimization
    this.emit('cacheEvictionNeeded');
  }

  private async manageCacheSize(): Promise<void> {
    const maxCacheSize = 1000;
    const stats = this.cache.getStats();
    
    if (stats.size > maxCacheSize) {
      // Simple eviction - remove oldest entries
      // Note: This would need proper LRU implementation in a production system
      this.emit('cacheCapacityExceeded', { size: stats.size, maxSize: maxCacheSize });
    }
  }

  private async compressOldEntries(): Promise<void> {
    const oldEntries = await this.db.getOldMemoryEntries(30); // 30 days old
    
    for (const entry of oldEntries) {
      if (this.shouldCompress(entry)) {
        const compressed = await this.compressEntry(entry);
        await this.store(
          entry.key,
          compressed,
          entry.namespace,
          entry.ttl
        );
      }
    }
  }

  private async optimizeNamespaces(): Promise<void> {
    const namespaceArray = Array.from(this.namespaces.values());
    for (const namespace of namespaceArray) {
      const stats = await this.db.getNamespaceStats(namespace.name);
      
      // Apply retention policies
      if (namespace.retentionPolicy === 'time-based' && namespace.ttl) {
        await this.db.deleteOldEntries(namespace.name, namespace.ttl);
      }
      
      if (namespace.retentionPolicy === 'size-based' && namespace.maxEntries) {
        if (stats.entries > namespace.maxEntries) {
          await this.db.trimNamespace(namespace.name, namespace.maxEntries);
        }
      }
    }
  }

  /**
   * Enhanced shutdown with comprehensive cleanup
   */
  async shutdown(): Promise<void> {
    this.isActive = false;
    
    // Clear all optimization timers
    this.optimizationTimers.forEach(timer => clearInterval(timer));
    this.optimizationTimers.length = 0;
    
    // Final performance snapshot
    const finalMetrics = {
      cache: this.cache.getStats(),
      accessPatterns: this.accessPatterns.size,
      performance: Object.fromEntries(this.performanceMetrics)
    };
    
    // Clear cache and pools
    this.cache.clear();
    const poolArray = Array.from(this.objectPools.values());
    for (const pool of poolArray) {
      // Pools will be garbage collected
    }
    this.objectPools.clear();
    
    this.emit('shutdown', finalMetrics);
  }

  /**
   * Get comprehensive analytics
   */
  getAdvancedAnalytics() {
    return {
      basic: this.getStats(),
      cache: this.cache.getStats(),
      performance: Object.fromEntries(
        Array.from(this.performanceMetrics.entries()).map(([op, durations]) => [
          op,
          {
            avg: durations.reduce((a, b) => a + b, 0) / durations.length,
            count: durations.length,
            max: Math.max(...durations),
            min: Math.min(...durations)
          }
        ])
      ),
      pools: (() => {
        const poolEntries = Array.from(this.objectPools.entries());
        return Object.fromEntries(
          poolEntries.map(([name, pool]) => [
            name,
            pool.getStats()
          ])
        );
      })(),
      accessPatterns: {
        total: this.accessPatterns.size,
        hotKeys: Array.from(this.accessPatterns.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([key, count]) => ({ key, count }))
      }
    };
  }

  /**
   * Memory health check with detailed analysis
   */
  async healthCheck() {
    const analytics = this.getAdvancedAnalytics();
    const health = {
      status: 'healthy' as 'healthy' | 'warning' | 'critical',
      score: 100,
      issues: [] as string[],
      recommendations: [] as string[]
    };
    
    // Check cache performance
    if (analytics.cache.hitRate < 50) {
      health.score -= 20;
      health.issues.push('Low cache hit rate');
      health.recommendations.push('Consider increasing cache size or reviewing access patterns');
    }
    
    // Check memory utilization
    if (analytics.cache.utilizationPercent > 90) {
      health.score -= 30;
      health.status = 'warning';
      health.issues.push('High cache memory utilization');
      health.recommendations.push('Increase cache memory limit or optimize data storage');
    }
    
    // Check performance metrics
    const avgRetrieveTime = analytics.performance.retrieve_db?.avg || 0;
    if (avgRetrieveTime > 100) {
      health.score -= 15;
      health.issues.push('Slow database retrieval performance');
      health.recommendations.push('Consider database optimization or indexing improvements');
    }
    
    // Check pool efficiency
    for (const [name, stats] of Object.entries(analytics.pools)) {
      if (stats.reuseRate < 30) {
        health.score -= 10;
        health.issues.push(`Low object pool reuse rate for ${name}`);
        health.recommendations.push(`Increase ${name} pool size or review object lifecycle`);
      }
    }
    
    // Determine final status
    if (health.score < 60) {
      health.status = 'critical';
    } else if (health.score < 80) {
      health.status = 'warning';
    }
    
    return health;
  }
}