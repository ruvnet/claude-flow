/**
 * Bounded Collections Implementation
 * Provides size-limited alternatives to unbounded collections
 */

export interface BoundedCollectionConfig {
  maxSize: number;
  evictionPolicy?: 'lru' | 'fifo' | 'priority';
  onEviction?: (item: any) => void;
}

/**
 * Bounded Map with automatic eviction
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private config: BoundedCollectionConfig;
  private accessOrder: Map<K, number> = new Map(); // For LRU tracking
  private accessCounter = 0;

  constructor(config: BoundedCollectionConfig) {
    super();
    this.config = { evictionPolicy: 'lru', ...config };
  }

  set(key: K, value: V): this {
    // Track access for LRU
    if (this.config.evictionPolicy === 'lru') {
      this.accessOrder.set(key, ++this.accessCounter);
    }

    // If already exists, just update
    if (this.has(key)) {
      super.set(key, value);
      return this;
    }

    // Check if we need to evict
    if (this.size >= this.config.maxSize) {
      this.evictOne();
    }

    super.set(key, value);
    return this;
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    
    // Update access order for LRU
    if (value !== undefined && this.config.evictionPolicy === 'lru') {
      this.accessOrder.set(key, ++this.accessCounter);
    }
    
    return value;
  }

  delete(key: K): boolean {
    this.accessOrder.delete(key);
    return super.delete(key);
  }

  clear(): void {
    this.accessOrder.clear();
    super.clear();
  }

  private evictOne(): void {
    let keyToEvict: K | undefined;

    switch (this.config.evictionPolicy) {
      case 'lru':
        keyToEvict = this.getLRUKey();
        break;
      case 'fifo':
        keyToEvict = this.keys().next().value;
        break;
      case 'priority':
        // For priority, we'd need the value to have a priority property
        keyToEvict = this.keys().next().value;
        break;
      default:
        keyToEvict = this.keys().next().value;
    }

    if (keyToEvict !== undefined) {
      const evictedValue = this.get(keyToEvict);
      this.delete(keyToEvict);
      
      if (this.config.onEviction && evictedValue !== undefined) {
        this.config.onEviction(evictedValue);
      }
    }
  }

  private getLRUKey(): K | undefined {
    let oldestKey: K | undefined;
    let oldestAccess = Infinity;

    for (const [key, access] of this.accessOrder) {
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  getStats() {
    return {
      size: this.size,
      maxSize: this.config.maxSize,
      utilization: this.size / this.config.maxSize,
      evictionPolicy: this.config.evictionPolicy
    };
  }
}

/**
 * Bounded Array with automatic rotation
 */
export class BoundedArray<T> extends Array<T> {
  private config: BoundedCollectionConfig;

  constructor(config: BoundedCollectionConfig) {
    super();
    this.config = { evictionPolicy: 'fifo', ...config };
  }

  push(...items: T[]): number {
    for (const item of items) {
      if (this.length >= this.config.maxSize) {
        this.evictOne();
      }
      super.push(item);
    }
    return this.length;
  }

  unshift(...items: T[]): number {
    for (let i = items.length - 1; i >= 0; i--) {
      if (this.length >= this.config.maxSize) {
        this.evictOne();
      }
      super.unshift(items[i]);
    }
    return this.length;
  }

  private evictOne(): void {
    let evictedItem: T | undefined;

    switch (this.config.evictionPolicy) {
      case 'fifo':
        evictedItem = this.shift();
        break;
      case 'lru':
        // For arrays, LIFO (last in, first out) approximates LRU
        evictedItem = this.pop();
        break;
      default:
        evictedItem = this.shift();
    }

    if (this.config.onEviction && evictedItem !== undefined) {
      this.config.onEviction(evictedItem);
    }
  }

  getStats() {
    return {
      size: this.length,
      maxSize: this.config.maxSize,
      utilization: this.length / this.config.maxSize,
      evictionPolicy: this.config.evictionPolicy
    };
  }
}

/**
 * Bounded Set with automatic eviction
 */
export class BoundedSet<T> extends Set<T> {
  private config: BoundedCollectionConfig;
  private accessOrder: Map<T, number> = new Map();
  private accessCounter = 0;

  constructor(config: BoundedCollectionConfig) {
    super();
    this.config = { evictionPolicy: 'lru', ...config };
  }

  add(value: T): this {
    // Track access for LRU
    if (this.config.evictionPolicy === 'lru') {
      this.accessOrder.set(value, ++this.accessCounter);
    }

    // If already exists, just update access
    if (this.has(value)) {
      return this;
    }

    // Check if we need to evict
    if (this.size >= this.config.maxSize) {
      this.evictOne();
    }

    super.add(value);
    return this;
  }

  has(value: T): boolean {
    const exists = super.has(value);
    
    // Update access order for LRU
    if (exists && this.config.evictionPolicy === 'lru') {
      this.accessOrder.set(value, ++this.accessCounter);
    }
    
    return exists;
  }

  delete(value: T): boolean {
    this.accessOrder.delete(value);
    return super.delete(value);
  }

  clear(): void {
    this.accessOrder.clear();
    super.clear();
  }

  private evictOne(): void {
    let valueToEvict: T | undefined;

    switch (this.config.evictionPolicy) {
      case 'lru':
        valueToEvict = this.getLRUValue();
        break;
      case 'fifo':
        valueToEvict = this.values().next().value;
        break;
      default:
        valueToEvict = this.values().next().value;
    }

    if (valueToEvict !== undefined) {
      this.delete(valueToEvict);
      
      if (this.config.onEviction) {
        this.config.onEviction(valueToEvict);
      }
    }
  }

  private getLRUValue(): T | undefined {
    let oldestValue: T | undefined;
    let oldestAccess = Infinity;

    for (const [value, access] of this.accessOrder) {
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestValue = value;
      }
    }

    return oldestValue;
  }

  getStats() {
    return {
      size: this.size,
      maxSize: this.config.maxSize,
      utilization: this.size / this.config.maxSize,
      evictionPolicy: this.config.evictionPolicy
    };
  }
}

/**
 * Bounded Queue with automatic eviction
 */
export class BoundedQueue<T> {
  private queue: T[] = [];
  private config: BoundedCollectionConfig;

  constructor(config: BoundedCollectionConfig) {
    this.config = { evictionPolicy: 'fifo', ...config };
  }

  enqueue(item: T): void {
    if (this.queue.length >= this.config.maxSize) {
      this.evictOne();
    }
    this.queue.push(item);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  peek(): T | undefined {
    return this.queue[0];
  }

  get size(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  clear(): void {
    this.queue = [];
  }

  private evictOne(): void {
    let evictedItem: T | undefined;

    switch (this.config.evictionPolicy) {
      case 'fifo':
        evictedItem = this.queue.shift();
        break;
      case 'lru':
        // For queues, we could track access but for simplicity use LIFO
        evictedItem = this.queue.pop();
        break;
      default:
        evictedItem = this.queue.shift();
    }

    if (this.config.onEviction && evictedItem !== undefined) {
      this.config.onEviction(evictedItem);
    }
  }

  getStats() {
    return {
      size: this.queue.length,
      maxSize: this.config.maxSize,
      utilization: this.queue.length / this.config.maxSize,
      evictionPolicy: this.config.evictionPolicy
    };
  }

  toArray(): T[] {
    return [...this.queue];
  }
}

/**
 * Memory pressure monitor for proactive cleanup
 */
export class MemoryPressureMonitor {
  private monitors: Map<string, () => void> = new Map();
  private config: {
    checkInterval: number;
    memoryThreshold: number; // MB
  };

  constructor(config: { checkInterval?: number; memoryThreshold?: number } = {}) {
    this.config = {
      checkInterval: config.checkInterval || 30000, // 30 seconds
      memoryThreshold: config.memoryThreshold || 100, // 100 MB
      ...config
    };

    this.startMonitoring();
  }

  registerCleanup(name: string, cleanup: () => void): void {
    this.monitors.set(name, cleanup);
  }

  unregisterCleanup(name: string): void {
    this.monitors.delete(name);
  }

  private startMonitoring(): void {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      if (heapUsedMB > this.config.memoryThreshold) {
        console.log(`Memory pressure detected: ${heapUsedMB.toFixed(2)}MB used`);
        this.triggerCleanups();
      }
    }, this.config.checkInterval);
  }

  private triggerCleanups(): void {
    for (const [name, cleanup] of this.monitors) {
      try {
        cleanup();
        console.log(`Triggered cleanup for: ${name}`);
      } catch (error) {
        console.error(`Cleanup failed for ${name}:`, error);
      }
    }
  }

  getMemoryStats() {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024)
    };
  }
}