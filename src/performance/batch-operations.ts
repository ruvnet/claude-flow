/**
 * Batch Operations Utility for Performance Optimization
 * Provides batching, debouncing, and throttling mechanisms with bounded collections
 */

import { BoundedQueue, BoundedMap } from './bounded-collections.js';

export interface BatchConfig {
  maxBatchSize: number;
  maxWaitTime: number; // milliseconds
  flushOnSize?: boolean;
  maxQueueSize?: number;
  onQueueFull?: (item: any) => void;
}

interface BatchItem<T, R> {
  item: T;
  resolve: (result: R) => void;
  reject: (error: any) => void;
}

export class BatchProcessor<T, R> {
  private queue: BoundedQueue<BatchItem<T, R>>;
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  
  constructor(
    private processor: (items: T[]) => Promise<R[]>,
    private config: BatchConfig
  ) {
    this.queue = new BoundedQueue<BatchItem<T, R>>({
      maxSize: config.maxQueueSize || 10000,
      evictionPolicy: 'fifo',
      onEviction: (item) => {
        item.reject(new Error('Item evicted from batch queue due to capacity limits'));
        if (config.onQueueFull) {
          config.onQueueFull(item.item);
        }
      }
    });
  }

  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      try {
        this.queue.enqueue({ item, resolve, reject });
        
        if (this.config.flushOnSize && this.queue.size >= this.config.maxBatchSize) {
          this.flush();
        } else if (!this.timer) {
          this.timer = setTimeout(() => this.flush(), this.config.maxWaitTime);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.processing || this.queue.isEmpty) return;
    
    this.processing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Extract batch items from queue
    const batch: BatchItem<T, R>[] = [];
    for (let i = 0; i < this.config.maxBatchSize && !this.queue.isEmpty; i++) {
      const item = this.queue.dequeue();
      if (item) {
        batch.push(item);
      }
    }

    if (batch.length === 0) {
      this.processing = false;
      return;
    }

    const items = batch.map(b => b.item);

    try {
      const results = await this.processor(items);
      batch.forEach((b, i) => b.resolve(results[i]));
    } catch (error) {
      batch.forEach(b => b.reject(error));
    } finally {
      this.processing = false;
      if (!this.queue.isEmpty) {
        this.timer = setTimeout(() => this.flush(), this.config.maxWaitTime);
      }
    }
  }

  async flushAll(): Promise<void> {
    while (!this.queue.isEmpty) {
      await this.flush();
    }
  }

  getStats() {
    return {
      ...this.queue.getStats(),
      processing: this.processing,
      hasTimer: this.timer !== null
    };
  }
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function(this: any, ...args: Parameters<T>) {
    const context = this;
    
    if (timeout) clearTimeout(timeout);
    
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return function(this: any, ...args: Parameters<T>) {
    const context = this;
    
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Memoize function results with bounded cache
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  options: {
    getKey?: (...args: Parameters<T>) => string;
    maxCacheSize?: number;
    evictionPolicy?: 'lru' | 'fifo';
  } = {}
): T {
  const { getKey, maxCacheSize = 1000, evictionPolicy = 'lru' } = options;
  
  const cache = new BoundedMap<string, ReturnType<T>>({
    maxSize: maxCacheSize,
    evictionPolicy
  });
  
  return function(this: any, ...args: Parameters<T>): ReturnType<T> {
    const key = getKey ? getKey(...args) : JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    const result = func.apply(this, args);
    cache.set(key, result);
    
    return result;
  } as T;
}

/**
 * Connection pool for database operations
 */
export class ConnectionPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  private waiting: Array<(conn: T) => void> = [];
  
  constructor(
    private factory: () => Promise<T>,
    private destroyer: (conn: T) => Promise<void>,
    private config: { min: number; max: number }
  ) {}

  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.config.min; i++) {
      promises.push(this.createConnection());
    }
    await Promise.all(promises);
  }

  private async createConnection(): Promise<void> {
    const conn = await this.factory();
    this.available.push(conn);
  }

  async acquire(): Promise<T> {
    if (this.available.length > 0) {
      const conn = this.available.pop()!;
      this.inUse.add(conn);
      return conn;
    }

    if (this.available.length + this.inUse.size < this.config.max) {
      await this.createConnection();
      return this.acquire();
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(conn: T): void {
    this.inUse.delete(conn);
    
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.inUse.add(conn);
      resolve(conn);
    } else {
      this.available.push(conn);
    }
  }

  async destroy(): Promise<void> {
    const allConnections = [...this.available, ...this.inUse];
    await Promise.all(allConnections.map(conn => this.destroyer(conn)));
    this.available = [];
    this.inUse.clear();
    this.waiting = [];
  }
}

/**
 * Efficient size calculation for objects
 */
export class SizeCalculator {
  private cache = new WeakMap<object, number>();

  calculate(obj: any): number {
    if (obj === null || obj === undefined) return 0;
    
    const type = typeof obj;
    
    if (type === 'boolean') return 4;
    if (type === 'number') return 8;
    if (type === 'string') return obj.length * 2;
    
    if (type === 'object') {
      if (this.cache.has(obj)) {
        return this.cache.get(obj)!;
      }

      let size = 0;
      
      if (Array.isArray(obj)) {
        size = obj.reduce((sum, item) => sum + this.calculate(item), 0);
      } else {
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            size += this.calculate(key) + this.calculate(obj[key]);
          }
        }
      }
      
      this.cache.set(obj, size);
      return size;
    }
    
    return 0;
  }
}