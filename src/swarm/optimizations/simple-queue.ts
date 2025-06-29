/**
 * Bounded queue implementation with performance optimizations
 */

import { BoundedQueue } from '../../performance/bounded-collections.js';

export interface QueueOptions {
  concurrency?: number;
  interval?: number;
  intervalCap?: number;
  maxQueueSize?: number;
  onQueueFull?: (rejectedTask: () => Promise<any>) => void;
}

interface QueueTask {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export default class PQueue {
  private queue: BoundedQueue<QueueTask>;
  private running = 0;
  private concurrency: number;
  private options: QueueOptions;

  constructor(options: QueueOptions = {}) {
    this.options = { 
      maxQueueSize: 1000, // Default bounded size
      ...options 
    };
    this.concurrency = options.concurrency || 1;
    
    this.queue = new BoundedQueue<QueueTask>({
      maxSize: this.options.maxQueueSize!,
      evictionPolicy: 'fifo',
      onEviction: (task: QueueTask) => {
        // Reject evicted tasks with a helpful error
        task.reject(new Error('Task evicted from queue due to capacity limits'));
        
        // Call user-defined handler if provided
        if (this.options.onQueueFull) {
          this.options.onQueueFull(task.fn);
        }
      }
    });
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: QueueTask = {
        fn,
        resolve,
        reject
      };
      
      try {
        this.queue.enqueue(task);
        this.process();
      } catch (error) {
        // If queue is full and eviction happens, this might throw
        reject(error);
      }
    });
  }

  private async process(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.isEmpty) {
      return;
    }

    this.running++;
    const task = this.queue.dequeue();
    
    if (task) {
      try {
        const result = await task.fn();
        task.resolve(result);
      } catch (error) {
        task.reject(error);
      } finally {
        this.running--;
        this.process();
      }
    } else {
      this.running--;
    }
  }

  async onIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.isEmpty && this.running === 0) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.size;
  }

  clear(): void {
    // Clear pending tasks by rejecting them
    while (!this.queue.isEmpty) {
      const task = this.queue.dequeue();
      if (task) {
        task.reject(new Error('Queue cleared'));
      }
    }
  }

  getStats() {
    return {
      ...this.queue.getStats(),
      running: this.running,
      concurrency: this.concurrency
    };
  }
}