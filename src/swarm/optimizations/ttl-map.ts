/**
 * TTL Map Implementation
 * Map with time-to-live for automatic entry expiration
 */

interface TTLItem<T> {
  value: T;
  expiry: number;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface TTLMapOptions {
  defaultTTL?: number;
  cleanupInterval?: number;
  maxSize?: number;
  onExpire?: <K, V>(key: K, value: V) => void;
}

export class TTLMap<K, V> {
  private items = new Map<K, TTLItem<V>>();
  private cleanupTimer?: NodeJS.Timeout;
  private defaultTTL: number;
  private cleanupInterval: number;
  private maxSize?: number;
  private onExpire?: <K, V>(key: K, value: V) => void;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0
  };
  
  constructor(options: TTLMapOptions = {}) {
    this.defaultTTL = options.defaultTTL || 3600000; // 1 hour default
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute default
    this.maxSize = options.maxSize;
    this.onExpire = options.onExpire;
    
    this.startCleanup();
  }
  
  set(key: K, value: V, ttl?: number): void {
    const now = Date.now();
    const expiry = now + (ttl || this.defaultTTL);
    
    // Check if we need to evict items due to size limit
    if (this.maxSize && this.items.size >= this.maxSize && !this.items.has(key)) {
      this.evictLRU();
    }
    
    this.items.set(key, {
      value,
      expiry,
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: now
    });
  }
  
  get(key: K): V | undefined {
    const item = this.items.get(key);
    
    if (!item) {
      this.stats.misses++;
      return undefined;
    }
    
    const now = Date.now();
    
    if (now > item.expiry) {
      this.items.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      
      if (this.onExpire) {
        this.onExpire(key, item.value);
      }
      
      return undefined;
    }
    
    // Update access stats
    item.accessCount++;
    item.lastAccessedAt = now;
    this.stats.hits++;
    
    return item.value;
  }
  
  has(key: K): boolean {
    const item = this.items.get(key);
    
    if (!item) {
      return false;
    }
    
    if (Date.now() > item.expiry) {
      this.items.delete(key);
      this.stats.expirations++;
      
      if (this.onExpire) {
        this.onExpire(key, item.value);
      }
      
      return false;
    }
    
    return true;
  }
  
  delete(key: K): boolean {
    return this.items.delete(key);
  }
  
  clear(): void {
    this.items.clear();
  }
  
  /**
   * Update TTL for an existing key
   */
  touch(key: K, ttl?: number): boolean {
    const item = this.items.get(key);
    
    if (!item || Date.now() > item.expiry) {
      return false;
    }
    
    item.expiry = Date.now() + (ttl || this.defaultTTL);
    item.lastAccessedAt = Date.now();
    
    return true;
  }
  
  /**
   * Get remaining TTL for a key
   */
  getTTL(key: K): number {
    const item = this.items.get(key);
    
    if (!item) {
      return -1;
    }
    
    const remaining = item.expiry - Date.now();
    return remaining > 0 ? remaining : -1;
  }
  
  /**
   * Get all keys (excluding expired ones)
   */
  keys(): K[] {
    const now = Date.now();
    const validKeys: K[] = [];
    
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        validKeys.push(key);
      }
    }
    
    return validKeys;
  }
  
  /**
   * Get all values (excluding expired ones)
   */
  values(): V[] {
    const now = Date.now();
    const validValues: V[] = [];
    
    for (const item of this.items.values()) {
      if (now <= item.expiry) {
        validValues.push(item.value);
      }
    }
    
    return validValues;
  }
  
  /**
   * Get all entries (excluding expired ones)
   */
  entries(): Array<[K, V]> {
    const now = Date.now();
    const validEntries: Array<[K, V]> = [];
    
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        validEntries.push([key, item.value]);
      }
    }
    
    return validEntries;
  }
  
  /**
   * Get size (excluding expired items)
   */
  get size(): number {
    this.cleanup(); // Clean up expired items first
    return this.items.size;
  }
  
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
  
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, item] of this.items) {
      if (now > item.expiry) {
        this.items.delete(key);
        cleaned++;
        this.stats.expirations++;
        
        if (this.onExpire) {
          this.onExpire(key, item.value);
        }
      }
    }
    
    if (cleaned > 0) {
      // Optional: Log cleanup stats
    }
  }
  
  private evictLRU(): void {
    let lruKey: K | undefined;
    let lruTime = Infinity;
    
    // Find least recently used item
    for (const [key, item] of this.items) {
      if (item.lastAccessedAt < lruTime) {
        lruTime = item.lastAccessedAt;
        lruKey = key;
      }
    }
    
    if (lruKey !== undefined) {
      this.items.delete(lruKey);
      this.stats.evictions++;
    }
  }
  
  /**
   * Stop the cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.items.clear();
  }
  
  /**
   * Get statistics about the map
   */
  getStats() {
    return {
      ...this.stats,
      size: this.items.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
    };
  }
  
  /**
   * Get detailed information about all items
   */
  inspect(): Map<K, {
    value: V;
    ttl: number;
    age: number;
    accessCount: number;
    lastAccessed: number;
  }> {
    const now = Date.now();
    const result = new Map();
    
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        result.set(key, {
          value: item.value,
          ttl: item.expiry - now,
          age: now - item.createdAt,
          accessCount: item.accessCount,
          lastAccessed: now - item.lastAccessedAt
        });
      }
    }
    
    return result;
  }
}