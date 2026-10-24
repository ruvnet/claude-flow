/**
 * Hive Mind Collective Memory System
 * 
 * Provides distributed, persistent memory with intelligent caching,
 * pattern recognition, and cross-agent knowledge sharing
 */

import { EventEmitter } from 'node:events';
import { generateId } from '../utils/helpers.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export class CollectiveMemory extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      persistenceDir: config.persistenceDir || './data/hive-memory',
      maxMemorySize: config.maxMemorySize || 100 * 1024 * 1024, // 100MB
      compressionThreshold: config.compressionThreshold || 10 * 1024, // 10KB
      syncInterval: config.syncInterval || 30000, // 30 seconds
      defaultTTL: config.defaultTTL || 7 * 24 * 60 * 60 * 1000, // 7 days
      maxCacheSize: config.maxCacheSize || 1000,
      enableCompression: config.enableCompression !== false,
      enablePatternDetection: config.enablePatternDetection !== false,
      shardCount: config.shardCount || 16,
      ...config
    };
    
    // Memory storage
    this.memory = new Map(); // In-memory cache
    this.memoryIndex = new Map(); // Search index
    this.accessLog = new Map(); // Access patterns
    this.shards = new Map(); // Distributed shards
    
    // Pattern detection
    this.patterns = new Map();
    this.relationships = new Map(); // Key relationships
    this.hotKeys = new Set();
    this.coldKeys = new Set();
    
    // Persistence
    this.persistenceQueue = [];
    this.lastSync = 0;
    this.isDirty = false;
    
    // Statistics
    this.stats = {
      totalKeys: 0,
      totalSize: 0,
      cacheHits: 0,
      cacheMisses: 0,
      patternDetections: 0,
      compressionSaved: 0,
      lastCleanup: 0
    };
    
    this.initialized = false;
    this.init();
  }

  /**
   * Initialize the memory system
   */
  async init() {
    try {
      // Create persistence directory
      await fs.mkdir(this.config.persistenceDir, { recursive: true });
      
      // Load existing memory
      await this.loadFromDisk();
      
      // Initialize shards
      this.initializeShards();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.initialized = true;
      this.emit('initialized');
      
      console.log(`Collective memory initialized with ${this.memory.size} entries`);
    } catch (error) {
      console.error('Failed to initialize collective memory:', error);
      throw error;
    }
  }

  /**
   * Initialize distributed shards
   */
  initializeShards() {
    for (let i = 0; i < this.config.shardCount; i++) {
      this.shards.set(i, {
        id: i,
        keys: new Set(),
        size: 0,
        lastAccess: Date.now(),
        hotness: 0
      });
    }
  }

  /**
   * Get shard for a key
   */
  getShardForKey(key) {
    const hash = this.hashKey(key);
    return hash % this.config.shardCount;
  }

  /**
   * Simple hash function for key distribution
   */
  hashKey(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Store data in collective memory
   */
  async store(key, value, options = {}) {
    if (!this.initialized) {
      throw new Error('Memory system not initialized');
    }

    const namespace = options.namespace || 'default';
    const ttl = options.ttl || this.config.defaultTTL;
    const agent = options.agent || 'system';
    const tags = options.tags || [];
    const priority = options.priority || 'normal';
    const compression = options.compression !== false && this.config.enableCompression;
    
    const fullKey = `${namespace}:${key}`;
    const serializedValue = JSON.stringify(value);
    const originalSize = Buffer.byteLength(serializedValue, 'utf8');
    
    let storedValue = serializedValue;
    let compressed = false;
    let compressionRatio = 1;
    
    // Apply compression if beneficial
    if (compression && originalSize > this.config.compressionThreshold) {
      const compressedValue = await this.compressData(serializedValue);
      if (compressedValue.length < originalSize * 0.8) {
        storedValue = compressedValue;
        compressed = true;
        compressionRatio = originalSize / compressedValue.length;
        this.stats.compressionSaved += originalSize - compressedValue.length;
      }
    }
    
    const entry = {
      key: fullKey,
      value: storedValue,
      originalValue: value, // Keep uncompressed for cache
      size: Buffer.byteLength(storedValue, 'utf8'),
      originalSize,
      compressed,
      compressionRatio,
      namespace,
      agent,
      tags: new Set(tags),
      priority,
      
      // Metadata
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : null,
      version: 1,
      
      // Access tracking
      accessCount: 0,
      lastAccessed: Date.now(),
      accessHistory: [],
      
      // Relationships
      relationships: new Set(),
      derivedFrom: options.derivedFrom ? new Set([options.derivedFrom]) : new Set(),
      
      // Flags
      persistent: options.persistent !== false,
      shareable: options.shareable !== false,
      cacheable: options.cacheable !== false
    };
    
    // Update existing entry or create new
    const existingEntry = this.memory.get(fullKey);
    if (existingEntry) {
      entry.version = existingEntry.version + 1;
      entry.createdAt = existingEntry.createdAt;
      entry.accessCount = existingEntry.accessCount;
      entry.accessHistory = existingEntry.accessHistory;
      entry.relationships = existingEntry.relationships;
    }
    
    // Store in memory
    this.memory.set(fullKey, entry);
    this.updateIndex(fullKey, entry);
    this.updateShard(fullKey, entry);
    
    // Update statistics
    this.stats.totalKeys = this.memory.size;
    this.stats.totalSize += entry.size;
    if (existingEntry) {
      this.stats.totalSize -= existingEntry.size;
    }
    
    // Mark as dirty for persistence
    this.isDirty = true;
    this.queueForPersistence(entry);
    
    // Detect patterns if enabled
    if (this.config.enablePatternDetection) {
      this.detectPatterns(entry);
    }
    
    // Update relationships
    this.updateRelationships(fullKey, entry);
    
    this.emit('stored', {
      key: fullKey,
      size: entry.size,
      compressed,
      agent,
      namespace
    });
    
    // Cleanup if memory is getting full
    if (this.memory.size > this.config.maxCacheSize) {
      await this.cleanup();
    }
    
    return fullKey;
  }

  /**
   * Retrieve data from memory
   */
  async retrieve(key, options = {}) {
    const namespace = options.namespace || 'default';
    const fullKey = `${namespace}:${key}`;
    const agent = options.agent || 'system';
    const decompress = options.decompress !== false;
    
    let entry = this.memory.get(fullKey);
    
    if (entry) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
      
      // Try to load from disk
      entry = await this.loadFromDisk(fullKey);
      if (entry) {
        this.memory.set(fullKey, entry);
      }
    }
    
    if (!entry) {
      return null;
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await this.delete(key, { namespace });
      return null;
    }
    
    // Update access tracking
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    entry.accessHistory.push({
      agent,
      timestamp: Date.now(),
      operation: 'read'
    });
    
    // Keep recent access history limited
    if (entry.accessHistory.length > 100) {
      entry.accessHistory = entry.accessHistory.slice(-50);
    }
    
    // Update hotness tracking
    this.updateHotness(fullKey, entry);
    
    // Log access pattern
    this.logAccess(fullKey, agent, 'read');
    
    this.emit('retrieved', {
      key: fullKey,
      agent,
      accessCount: entry.accessCount
    });
    
    // Return decompressed value if needed
    if (entry.compressed && decompress) {
      if (entry.originalValue) {
        return entry.originalValue;
      }
      try {
        const decompressed = await this.decompressData(entry.value);
        const parsed = JSON.parse(decompressed);
        entry.originalValue = parsed; // Cache for future access
        return parsed;
      } catch (error) {
        console.error(`Failed to decompress data for key ${fullKey}:`, error);
        return null;
      }
    }
    
    if (entry.originalValue) {
      return entry.originalValue;
    }
    
    try {
      return JSON.parse(entry.value);
    } catch (error) {
      console.error(`Failed to parse data for key ${fullKey}:`, error);
      return null;
    }
  }

  /**
   * Delete data from memory
   */
  async delete(key, options = {}) {
    const namespace = options.namespace || 'default';
    const fullKey = `${namespace}:${key}`;
    
    const entry = this.memory.get(fullKey);
    if (!entry) {
      return false;
    }
    
    // Remove from memory
    this.memory.delete(fullKey);
    this.removeFromIndex(fullKey);
    this.removeFromShard(fullKey);
    
    // Update statistics
    this.stats.totalKeys = this.memory.size;
    this.stats.totalSize -= entry.size;
    
    // Remove relationships
    this.removeRelationships(fullKey);
    
    // Mark for persistence cleanup
    this.queueForDeletion(fullKey);
    
    this.emit('deleted', { key: fullKey });
    
    return true;
  }

  /**
   * Search memory entries
   */
  async search(query, options = {}) {
    const namespace = options.namespace;
    const tags = options.tags;
    const agent = options.agent;
    const limit = options.limit || 100;
    const sortBy = options.sortBy || 'relevance';
    
    let results = [];
    
    // Search through memory entries
    for (const [key, entry] of this.memory) {
      if (namespace && entry.namespace !== namespace) continue;
      if (agent && entry.agent !== agent) continue;
      
      let score = 0;
      
      // Key matching
      if (key.toLowerCase().includes(query.toLowerCase())) {
        score += 10;
      }
      
      // Tag matching
      if (tags && tags.length > 0) {
        const matchingTags = tags.filter(tag => entry.tags.has(tag));
        score += matchingTags.length * 5;
      }
      
      // Content search (basic)
      if (entry.originalValue) {
        const content = JSON.stringify(entry.originalValue).toLowerCase();
        if (content.includes(query.toLowerCase())) {
          score += 3;
        }
      }
      
      if (score > 0) {
        results.push({
          key,
          entry,
          score,
          relevance: score
        });
      }
    }
    
    // Sort results
    switch (sortBy) {
      case 'relevance':
        results.sort((a, b) => b.score - a.score);
        break;
      case 'recent':
        results.sort((a, b) => b.entry.lastAccessed - a.entry.lastAccessed);
        break;
      case 'created':
        results.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
        break;
      case 'access':
        results.sort((a, b) => b.entry.accessCount - a.entry.accessCount);
        break;
    }
    
    return results.slice(0, limit).map(r => ({
      key: r.key,
      value: r.entry.originalValue || JSON.parse(r.entry.value),
      score: r.score,
      metadata: {
        namespace: r.entry.namespace,
        agent: r.entry.agent,
        tags: Array.from(r.entry.tags),
        accessCount: r.entry.accessCount,
        lastAccessed: r.entry.lastAccessed,
        createdAt: r.entry.createdAt
      }
    }));
  }

  /**
   * Get related keys
   */
  getRelatedKeys(key, options = {}) {
    const namespace = options.namespace || 'default';
    const fullKey = `${namespace}:${key}`;
    const maxResults = options.limit || 10;
    
    const relationships = this.relationships.get(fullKey);
    if (!relationships) {
      return [];
    }
    
    return Array.from(relationships.entries())
      .map(([relatedKey, strength]) => ({
        key: relatedKey,
        strength,
        entry: this.memory.get(relatedKey)
      }))
      .filter(r => r.entry)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxResults);
  }

  /**
   * Share memory between agents
   */
  async shareMemory(fromAgent, toAgent, keys, options = {}) {
    const shared = [];
    const namespace = options.namespace || 'default';
    
    for (const key of keys) {
      const fullKey = `${namespace}:${key}`;
      const entry = this.memory.get(fullKey);
      
      if (!entry || !entry.shareable) {
        continue;
      }
      
      // Create shared copy
      const sharedKey = `shared:${toAgent}:${key}`;
      await this.store(sharedKey, entry.originalValue || JSON.parse(entry.value), {
        namespace: 'shared',
        agent: toAgent,
        derivedFrom: fullKey,
        tags: [...entry.tags, 'shared', 'from:' + fromAgent],
        ttl: options.ttl || entry.expiresAt ? entry.expiresAt - Date.now() : undefined
      });
      
      shared.push({
        originalKey: fullKey,
        sharedKey: `shared:${sharedKey}`,
        agent: toAgent
      });
    }
    
    this.emit('memory:shared', {
      fromAgent,
      toAgent,
      keys: shared.length
    });
    
    return shared;
  }

  /**
   * Pattern detection
   */
  detectPatterns(entry) {
    // Co-access patterns
    this.detectCoAccessPatterns(entry);
    
    // Temporal patterns
    this.detectTemporalPatterns(entry);
    
    // Content similarity patterns
    this.detectContentPatterns(entry);
    
    // Agent behavior patterns
    this.detectAgentPatterns(entry);
  }

  /**
   * Detect co-access patterns
   */
  detectCoAccessPatterns(entry) {
    const recentAccesses = Array.from(this.accessLog.entries())
      .filter(([_, log]) => Date.now() - log.timestamp < 3600000) // Last hour
      .map(([key, log]) => key);
    
    if (recentAccesses.length < 2) return;
    
    for (const accessedKey of recentAccesses) {
      if (accessedKey === entry.key) continue;
      
      const pattern = this.patterns.get(`co-access:${entry.key}:${accessedKey}`) || {
        type: 'co-access',
        keys: [entry.key, accessedKey],
        frequency: 0,
        confidence: 0,
        lastSeen: 0
      };
      
      pattern.frequency++;
      pattern.lastSeen = Date.now();
      pattern.confidence = Math.min(1.0, pattern.frequency / 10);
      
      this.patterns.set(`co-access:${entry.key}:${accessedKey}`, pattern);
      
      if (pattern.confidence > 0.7) {
        this.updateRelationship(entry.key, accessedKey, pattern.confidence);
      }
    }
  }

  /**
   * Detect temporal access patterns
   */
  detectTemporalPatterns(entry) {
    if (entry.accessHistory.length < 5) return;
    
    const intervals = [];
    for (let i = 1; i < entry.accessHistory.length; i++) {
      intervals.push(entry.accessHistory[i].timestamp - entry.accessHistory[i-1].timestamp);
    }
    
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => 
      sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    
    if (variance < avgInterval * 0.2) { // Low variance indicates pattern
      const pattern = {
        type: 'temporal',
        key: entry.key,
        avgInterval,
        confidence: 1 - (variance / avgInterval),
        nextPredicted: entry.lastAccessed + avgInterval
      };
      
      this.patterns.set(`temporal:${entry.key}`, pattern);
    }
  }

  /**
   * Update key relationships
   */
  updateRelationship(key1, key2, strength) {
    if (!this.relationships.has(key1)) {
      this.relationships.set(key1, new Map());
    }
    if (!this.relationships.has(key2)) {
      this.relationships.set(key2, new Map());
    }
    
    this.relationships.get(key1).set(key2, strength);
    this.relationships.get(key2).set(key1, strength);
  }

  /**
   * Update memory index for search
   */
  updateIndex(key, entry) {
    // Index by tags
    for (const tag of entry.tags) {
      if (!this.memoryIndex.has(`tag:${tag}`)) {
        this.memoryIndex.set(`tag:${tag}`, new Set());
      }
      this.memoryIndex.get(`tag:${tag}`).add(key);
    }
    
    // Index by agent
    if (!this.memoryIndex.has(`agent:${entry.agent}`)) {
      this.memoryIndex.set(`agent:${entry.agent}`, new Set());
    }
    this.memoryIndex.get(`agent:${entry.agent}`).add(key);
    
    // Index by namespace
    if (!this.memoryIndex.has(`namespace:${entry.namespace}`)) {
      this.memoryIndex.set(`namespace:${entry.namespace}`, new Set());
    }
    this.memoryIndex.get(`namespace:${entry.namespace}`).add(key);
  }

  /**
   * Update shard information
   */
  updateShard(key, entry) {
    const shardId = this.getShardForKey(key);
    const shard = this.shards.get(shardId);
    
    if (!shard.keys.has(key)) {
      shard.keys.add(key);
      shard.size += entry.size;
    }
    
    shard.lastAccess = Date.now();
    shard.hotness = Math.min(10, shard.hotness + 0.1);
  }

  /**
   * Update hotness tracking
   */
  updateHotness(key, entry) {
    const now = Date.now();
    const recentAccesses = entry.accessHistory.filter(
      access => now - access.timestamp < 3600000 // Last hour
    ).length;
    
    if (recentAccesses > 5) {
      this.hotKeys.add(key);
      this.coldKeys.delete(key);
    } else if (recentAccesses === 0 && now - entry.lastAccessed > 86400000) {
      this.coldKeys.add(key);
      this.hotKeys.delete(key);
    }
  }

  /**
   * Log access pattern
   */
  logAccess(key, agent, operation) {
    this.accessLog.set(key, {
      key,
      agent,
      operation,
      timestamp: Date.now()
    });
    
    // Limit access log size
    if (this.accessLog.size > 10000) {
      const entries = Array.from(this.accessLog.entries())
        .sort(([,a], [,b]) => b.timestamp - a.timestamp)
        .slice(0, 5000);
      
      this.accessLog.clear();
      for (const [key, log] of entries) {
        this.accessLog.set(key, log);
      }
    }
  }

  /**
   * Compress data
   */
  async compressData(data) {
    // Simple compression - in production, use actual compression library
    return Buffer.from(data).toString('base64');
  }

  /**
   * Decompress data
   */
  async decompressData(data) {
    // Simple decompression - in production, use actual compression library
    return Buffer.from(data, 'base64').toString();
  }

  /**
   * Queue entry for persistence
   */
  queueForPersistence(entry) {
    this.persistenceQueue.push({
      action: 'store',
      entry
    });
  }

  /**
   * Queue key for deletion
   */
  queueForDeletion(key) {
    this.persistenceQueue.push({
      action: 'delete',
      key
    });
  }

  /**
   * Save memory to disk
   */
  async saveToDisk() {
    if (!this.isDirty && this.persistenceQueue.length === 0) {
      return;
    }
    
    try {
      // Process persistence queue
      for (const item of this.persistenceQueue) {
        if (item.action === 'store') {
          const filename = path.join(
            this.config.persistenceDir,
            `${item.entry.namespace}_${this.hashKey(item.entry.key) % 100}.json`
          );
          
          let data = {};
          try {
            const existing = await fs.readFile(filename, 'utf8');
            data = JSON.parse(existing);
          } catch (error) {
            // File doesn't exist, start with empty object
          }
          
          data[item.entry.key] = {
            ...item.entry,
            accessHistory: [], // Don't persist full history
            originalValue: undefined // Don't persist cached value
          };
          
          await fs.writeFile(filename, JSON.stringify(data, null, 2));
        } else if (item.action === 'delete') {
          // Handle deletion from disk
          const namespace = item.key.split(':')[0];
          const filename = path.join(
            this.config.persistenceDir,
            `${namespace}_${this.hashKey(item.key) % 100}.json`
          );
          
          try {
            const existing = await fs.readFile(filename, 'utf8');
            const data = JSON.parse(existing);
            delete data[item.key];
            await fs.writeFile(filename, JSON.stringify(data, null, 2));
          } catch (error) {
            // File doesn't exist or other error - ignore
          }
        }
      }
      
      this.persistenceQueue = [];
      this.isDirty = false;
      this.lastSync = Date.now();
      
      this.emit('persisted', { entries: this.memory.size });
    } catch (error) {
      console.error('Failed to save memory to disk:', error);
      this.emit('persistence:error', error);
    }
  }

  /**
   * Load memory from disk
   */
  async loadFromDisk(specificKey = null) {
    try {
      const files = await fs.readdir(this.config.persistenceDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filepath = path.join(this.config.persistenceDir, file);
        const data = JSON.parse(await fs.readFile(filepath, 'utf8'));
        
        for (const [key, entry] of Object.entries(data)) {
          if (specificKey && key !== specificKey) continue;
          
          // Restore entry
          entry.tags = new Set(entry.tags || []);
          entry.relationships = new Set(entry.relationships || []);
          entry.derivedFrom = new Set(entry.derivedFrom || []);
          entry.accessHistory = [];
          entry.originalValue = undefined;
          
          this.memory.set(key, entry);
          this.updateIndex(key, entry);
          this.updateShard(key, entry);
          
          if (specificKey === key) {
            return entry;
          }
        }
      }
      
      return specificKey ? null : true;
    } catch (error) {
      console.error('Failed to load memory from disk:', error);
      return null;
    }
  }

  /**
   * Start background maintenance tasks
   */
  startBackgroundTasks() {
    // Sync to disk periodically
    setInterval(() => {
      this.saveToDisk();
    }, this.config.syncInterval);
    
    // Cleanup expired entries
    setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
    
    // Update statistics
    setInterval(() => {
      this.updateStatistics();
    }, 10000); // Every 10 seconds
  }

  /**
   * Cleanup expired entries and optimize memory
   */
  async cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.memory) {
      // Remove expired entries
      if (entry.expiresAt && now > entry.expiresAt) {
        await this.delete(key.split(':')[1], { namespace: entry.namespace });
        cleaned++;
        continue;
      }
      
      // Remove old, rarely accessed entries if memory is full
      if (this.memory.size > this.config.maxCacheSize * 0.9) {
        const daysSinceAccess = (now - entry.lastAccessed) / 86400000;
        if (daysSinceAccess > 7 && entry.accessCount < 2) {
          await this.delete(key.split(':')[1], { namespace: entry.namespace });
          cleaned++;
        }
      }
    }
    
    this.stats.lastCleanup = now;
    
    if (cleaned > 0) {
      this.emit('cleanup:completed', { entriesRemoved: cleaned });
    }
  }

  /**
   * Update internal statistics
   */
  updateStatistics() {
    this.stats.totalKeys = this.memory.size;
    this.stats.totalSize = Array.from(this.memory.values())
      .reduce((sum, entry) => sum + entry.size, 0);
  }

  /**
   * Get memory statistics
   */
  getStatistics() {
    const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0 ?
      this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) : 0;
    
    return {
      ...this.stats,
      hitRate,
      hotKeys: this.hotKeys.size,
      coldKeys: this.coldKeys.size,
      patterns: this.patterns.size,
      relationships: this.relationships.size,
      shards: Array.from(this.shards.values()).map(s => ({
        id: s.id,
        keyCount: s.keys.size,
        size: s.size,
        hotness: s.hotness
      })),
      memoryUsage: {
        used: this.stats.totalSize,
        max: this.config.maxMemorySize,
        percentage: (this.stats.totalSize / this.config.maxMemorySize) * 100
      }
    };
  }

  /**
   * Remove entry from index
   */
  removeFromIndex(key) {
    for (const [indexKey, keys] of this.memoryIndex) {
      if (keys.has(key)) {
        keys.delete(key);
        if (keys.size === 0) {
          this.memoryIndex.delete(indexKey);
        }
      }
    }
  }

  /**
   * Remove entry from shard
   */
  removeFromShard(key) {
    const shardId = this.getShardForKey(key);
    const shard = this.shards.get(shardId);
    
    if (shard && shard.keys.has(key)) {
      shard.keys.delete(key);
      const entry = this.memory.get(key);
      if (entry) {
        shard.size -= entry.size;
      }
    }
  }

  /**
   * Remove relationships for a key
   */
  removeRelationships(key) {
    const relationships = this.relationships.get(key);
    if (relationships) {
      for (const relatedKey of relationships.keys()) {
        const relatedRels = this.relationships.get(relatedKey);
        if (relatedRels) {
          relatedRels.delete(key);
          if (relatedRels.size === 0) {
            this.relationships.delete(relatedKey);
          }
        }
      }
      this.relationships.delete(key);
    }
  }

  /**
   * Shutdown memory system
   */
  async shutdown() {
    console.log('Shutting down collective memory...');
    
    // Save all pending changes
    await this.saveToDisk();
    
    this.emit('shutdown');
    this.removeAllListeners();
  }
}