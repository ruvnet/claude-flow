/**
 * Bounded Collections for Performance Optimization
 * Provides memory-efficient data structures with size limits and eviction policies
 */

export interface BoundedMapOptions<K, V> {
  maxSize: number;
  evictionPolicy?: 'lru' | 'lfu' | 'fifo';
  onEviction?: (value: V, key: K) => void;
}

export interface BoundedSetOptions<T> {
  maxSize: number;
  evictionPolicy?: 'lru' | 'lfu' | 'fifo';
  onEviction?: (value: T) => void;
}

export interface MemoryPressureMonitorOptions {
  memoryThreshold: number; // in MB
  checkInterval: number; // in ms
  onPressure?: (pressure: number) => void;
}

/**
 * Bounded Map with configurable eviction policies
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private maxSize: number;
  private evictionPolicy: string;
  private onEviction?: (value: V, key: K) => void;
  private accessOrder: K[] = [];

  constructor(options: BoundedMapOptions<K, V>) {
    super();
    this.maxSize = options.maxSize;
    this.evictionPolicy = options.evictionPolicy || 'lru';
    this.onEviction = options.onEviction;
  }

  set(key: K, value: V): this {
    // Remove from access order if exists
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    // Add to end (most recent)
    this.accessOrder.push(key);

    // Set value
    super.set(key, value);

    // Check size and evict if necessary
    while (this.size > this.maxSize) {
      this.evictOldest();
    }

    return this;
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined && this.evictionPolicy === 'lru') {
      // Move to end (most recent)
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(key);
      }
    }
    return value;
  }

  delete(key: K): boolean {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    return super.delete(key);
  }

  private evictOldest(): void {
    if (this.accessOrder.length === 0) return;

    const keyToEvict = this.accessOrder.shift()!;
    const value = this.get(keyToEvict);
    
    if (value !== undefined && this.onEviction) {
      this.onEviction(value, keyToEvict);
    }
    
    super.delete(keyToEvict);
  }

  clear(): void {
    this.accessOrder = [];
    super.clear();
  }

  getStats(): any {
    return {
      size: this.size,
      maxSize: this.maxSize,
      evictionPolicy: this.evictionPolicy,
      accessOrderLength: this.accessOrder.length
    };
  }
}

/**
 * Bounded Set with configurable eviction policies
 */
export class BoundedSet<T> extends Set<T> {
  private maxSize: number;
  private evictionPolicy: string;
  private onEviction?: (value: T) => void;
  private accessOrder: T[] = [];

  constructor(options: BoundedSetOptions<T>) {
    super();
    this.maxSize = options.maxSize;
    this.evictionPolicy = options.evictionPolicy || 'lru';
    this.onEviction = options.onEviction;
  }

  add(value: T): this {
    // Remove from access order if exists
    const index = this.accessOrder.indexOf(value);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    // Add to end (most recent)
    this.accessOrder.push(value);

    // Add value
    super.add(value);

    // Check size and evict if necessary
    while (this.size > this.maxSize) {
      this.evictOldest();
    }

    return this;
  }

  has(value: T): boolean {
    const exists = super.has(value);
    if (exists && this.evictionPolicy === 'lru') {
      // Move to end (most recent)
      const index = this.accessOrder.indexOf(value);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(value);
      }
    }
    return exists;
  }

  delete(value: T): boolean {
    const index = this.accessOrder.indexOf(value);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    return super.delete(value);
  }

  private evictOldest(): void {
    if (this.accessOrder.length === 0) return;

    const valueToEvict = this.accessOrder.shift()!;
    
    if (this.onEviction) {
      this.onEviction(valueToEvict);
    }
    
    super.delete(valueToEvict);
  }

  clear(): void {
    this.accessOrder = [];
    super.clear();
  }
}

/**
 * Memory Pressure Monitor
 */
export class MemoryPressureMonitor {
  private memoryThreshold: number;
  private checkInterval: number;
  private onPressure?: (pressure: number) => void;
  private timer?: NodeJS.Timeout;
  private callbacks: Map<string, () => void> = new Map();
  private currentPressure: number = 0;

  constructor(options: MemoryPressureMonitorOptions) {
    this.memoryThreshold = options.memoryThreshold * 1024 * 1024; // Convert MB to bytes
    this.checkInterval = options.checkInterval;
    this.onPressure = options.onPressure;
    this.startMonitoring();
  }

  private startMonitoring(): void {
    this.timer = setInterval(() => {
      this.checkMemoryPressure();
    }, this.checkInterval);
  }

  private checkMemoryPressure(): void {
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapUsed + memUsage.external;
    this.currentPressure = totalMemory / this.memoryThreshold;

    if (totalMemory > this.memoryThreshold) {
      if (this.onPressure) {
        this.onPressure(this.currentPressure);
      }
      
      // Execute cleanup callbacks
      for (const [, callback] of this.callbacks) {
        try {
          callback();
        } catch (error) {
          console.error('Error executing cleanup callback:', error);
        }
      }
    }
  }

  registerCleanup(id: string, callback: () => void): void {
    this.callbacks.set(id, callback);
  }

  unregisterCleanup(id: string): void {
    this.callbacks.delete(id);
  }

  getCurrentPressure(): number {
    return this.currentPressure;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getMemoryStats(): any {
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapUsed + memUsage.external;
    return {
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      totalMemory,
      memoryThreshold: this.memoryThreshold,
      currentPressure: this.currentPressure,
      isOverThreshold: totalMemory > this.memoryThreshold
    };
  }
}

/**
 * Bounded queue interface options
 */
export interface BoundedQueueOptions<T> {
  maxSize: number;
  evictionPolicy?: 'fifo' | 'lifo';
  onEviction?: (item: T) => void;
}

/**
 * Bounded queue implementation with size limits
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  private readonly maxSize: number;
  private readonly evictionPolicy: 'fifo' | 'lifo';
  private readonly onEviction?: (item: T) => void;

  constructor(options: BoundedQueueOptions<T>) {
    this.maxSize = options.maxSize;
    this.evictionPolicy = options.evictionPolicy || 'fifo';
    this.onEviction = options.onEviction;
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  enqueue(item: T): boolean {
    if (this.isFull) {
      // Evict based on policy
      const evicted = this.evictionPolicy === 'fifo' 
        ? this.items.shift() 
        : this.items.pop();
      
      if (evicted !== undefined && this.onEviction) {
        this.onEviction(evicted);
      }
    }

    this.items.push(item);
    return true;
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return [...this.items];
  }
}