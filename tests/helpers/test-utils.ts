/**
 * General Test Utilities
 * Common helpers and utilities for testing
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { nanoid } from 'nanoid';

/**
 * Creates a deferred promise for async testing
 */
export interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export function createDeferred<T>(): DeferredPromise<T> {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Waits for an event to be emitted
 */
export async function waitForEvent(
  emitter: EventEmitter,
  eventName: string,
  timeout = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);
    
    emitter.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Creates a spy that records all calls
 */
export interface SpyFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error }>;
  reset: () => void;
}

export function createSpy<T extends (...args: any[]) => any>(
  fn?: T
): SpyFunction<T> {
  const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error }> = [];
  
  const spy = ((...args: Parameters<T>) => {
    const call: any = { args };
    try {
      if (fn) {
        call.result = fn(...args);
        return call.result;
      }
    } catch (error) {
      call.error = error as Error;
      throw error;
    } finally {
      calls.push(call);
    }
  }) as SpyFunction<T>;
  
  spy.calls = calls;
  spy.reset = () => calls.length = 0;
  
  return spy;
}

/**
 * File system test helpers
 */
export const fsTestHelpers = {
  /**
   * Creates a temporary directory for testing
   */
  async createTempDir(prefix = 'test'): Promise<string> {
    const dir = join(tmpdir(), `${prefix}-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  },
  
  /**
   * Creates a test file with content
   */
  async createTestFile(dir: string, filename: string, content: string): Promise<string> {
    const filepath = join(dir, filename);
    await fs.writeFile(filepath, content, 'utf-8');
    return filepath;
  },
  
  /**
   * Creates multiple test files
   */
  async createTestFiles(dir: string, files: Record<string, string>): Promise<string[]> {
    const paths: string[] = [];
    for (const [filename, content] of Object.entries(files)) {
      const path = await fsTestHelpers.createTestFile(dir, filename, content);
      paths.push(path);
    }
    return paths;
  },
  
  /**
   * Cleans up a directory
   */
  async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors during cleanup
    }
  },
};

/**
 * Mock factories for common objects
 */
export const mockFactories = {
  /**
   * Creates a mock agent
   */
  createMockAgent(overrides?: Partial<any>) {
    return {
      id: nanoid(),
      name: 'test-agent',
      type: 'researcher',
      status: 'idle',
      capabilities: ['search', 'analyze'],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  },
  
  /**
   * Creates a mock task
   */
  createMockTask(overrides?: Partial<any>) {
    return {
      id: nanoid(),
      title: 'Test Task',
      description: 'A test task',
      status: 'pending',
      priority: 1,
      agentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  },
  
  /**
   * Creates a mock event
   */
  createMockEvent(type: string, data?: any) {
    return {
      id: nanoid(),
      type,
      timestamp: Date.now(),
      source: 'test',
      data: data || {},
    };
  },
  
  /**
   * Creates a mock logger
   */
  createMockLogger() {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
  },
};

/**
 * Async test helpers
 */
export const asyncHelpers = {
  /**
   * Retries a function until it succeeds or times out
   */
  async retry<T>(
    fn: () => T | Promise<T>,
    options: {
      retries?: number;
      delay?: number;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const { retries = 10, delay = 100, timeout = 5000 } = options;
    const startTime = Date.now();
    
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Retry timeout after ${timeout}ms`);
        }
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
    
    throw new Error('Retry failed');
  },
  
  /**
   * Runs multiple async operations in parallel with error handling
   */
  async parallel<T>(
    operations: Array<() => Promise<T>>
  ): Promise<Array<{ success: boolean; value?: T; error?: Error }>> {
    return Promise.all(
      operations.map(async (op) => {
        try {
          const value = await op();
          return { success: true, value };
        } catch (error) {
          return { success: false, error: error as Error };
        }
      })
    );
  },
  
  /**
   * Creates a timeout promise
   */
  timeout(ms: number, message = 'Operation timed out'): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  },
};

/**
 * Performance testing helpers
 */
export const perfHelpers = {
  /**
   * Measures execution time of a function
   */
  async measureTime<T>(fn: () => T | Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  },
  
  /**
   * Runs a benchmark
   */
  async benchmark(
    name: string,
    fn: () => any | Promise<any>,
    iterations = 100
  ): Promise<{ name: string; avg: number; min: number; max: number; total: number }> {
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const { duration } = await perfHelpers.measureTime(fn);
      times.push(duration);
    }
    
    return {
      name,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      total: times.reduce((a, b) => a + b, 0),
    };
  },
};

/**
 * Snapshot testing helpers
 */
export const snapshotHelpers = {
  /**
   * Normalizes data for consistent snapshots
   */
  normalize(data: any): any {
    const normalized = JSON.parse(JSON.stringify(data, (key, value) => {
      // Normalize dates
      if (value instanceof Date || typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value)) {
        return '<DATE>';
      }
      // Normalize IDs
      if (key === 'id' || key.endsWith('Id') || key.endsWith('_id')) {
        return '<ID>';
      }
      // Normalize timestamps
      if (key === 'timestamp' || key.endsWith('At')) {
        return '<TIMESTAMP>';
      }
      // Normalize file paths
      if (typeof value === 'string' && (value.includes('/') || value.includes('\\'))) {
        return '<PATH>';
      }
      return value;
    }));
    
    return normalized;
  },
};
