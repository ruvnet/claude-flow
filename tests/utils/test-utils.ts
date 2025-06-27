/// <reference types="jest" />

/**
 * Comprehensive test utilities for Claude-Flow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config } from '../../src/utils/types.js';

// Jest-compatible test utilities
export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  expect(actual).toEqual(expected);
}

export function assertExists<T>(actual: T, message?: string): asserts actual is NonNullable<T> {
  expect(actual).toBeDefined();
  expect(actual).not.toBeNull();
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  errorClass?: new (...args: any[]) => Error,
  msgIncludes?: string
): Promise<Error> {
  await expect(fn).rejects.toThrow(errorClass);
  return new Error('Test assertion helper');
}

export function assertThrows(
  fn: () => unknown,
  errorClass?: new (...args: any[]) => Error,
  msgIncludes?: string
): Error {
  expect(fn).toThrow(errorClass);
  return new Error('Test assertion helper');
}

export const stub = jest.fn;

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class FakeTime {
  constructor() {
    jest.useFakeTimers();
  }

  tick(ms: number): void {
    jest.advanceTimersByTime(ms);
  }

  tickAsync(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    return Promise.resolve();
  }

  restore(): void {
    jest.useRealTimers();
  }
}

export type Spy = jest.SpyInstance;

/**
 * Test utilities for async operations
 */
export class AsyncTestUtils {
  /**
   * Wait for condition to be true with timeout
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number; interval?: number; message?: string } = {}
  ): Promise<void> {
    const { timeout = 5000, interval = 100, message = 'Condition not met' } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await delay(interval);
    }

    throw new Error(`${message} (timeout: ${timeout}ms)`);
  }

  /**
   * Wait for multiple conditions to be true
   */
  static async waitForAll(
    conditions: Array<() => boolean | Promise<boolean>>,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    await this.waitFor(
      async () => {
        const results = await Promise.all(conditions.map(c => c()));
        return results.every(r => r);
      },
      options
    );
  }

  /**
   * Wait for any of the conditions to be true
   */
  static async waitForAny(
    conditions: Array<() => boolean | Promise<boolean>>,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    await this.waitFor(
      async () => {
        const results = await Promise.all(conditions.map(c => c()));
        return results.some(r => r);
      },
      options
    );
  }

  /**
   * Race a promise against a timeout
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message?: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retry<T>(
    operation: () => Promise<T>,
    options: {
      maxAttempts?: number;
      initialDelay?: number;
      maxDelay?: number;
      backoffFactor?: number;
    } = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      initialDelay = 100,
      maxDelay = 5000,
      backoffFactor = 2
    } = options;

    let lastError: Error;
    let currentDelay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxAttempts) {
          throw lastError;
        }

        await delay(Math.min(currentDelay, maxDelay));
        currentDelay *= backoffFactor;
      }
    }

    throw lastError!;
  }
}

/**
 * Memory management utilities for tests
 */
export class MemoryTestUtils {
  /**
   * Monitor memory usage during test execution
   */
  static async monitorMemory<T>(
    operation: () => Promise<T>,
    options: { sampleInterval?: number; maxSamples?: number } = {}
  ): Promise<{ result: T; memoryStats: Array<{ timestamp: number; heapUsed: number; external: number }> }> {
    const { sampleInterval = 100, maxSamples = 100 } = options;
    const memoryStats: Array<{ timestamp: number; heapUsed: number; external: number }> = [];
    
    let monitoring = true;
    let sampleCount = 0;

    // Start memory monitoring
    const monitoringPromise = (async () => {
      while (monitoring && sampleCount < maxSamples) {
        const memInfo = process.memoryUsage();
        memoryStats.push({
          timestamp: Date.now(),
          heapUsed: memInfo.heapUsed,
          external: memInfo.external,
        });
        sampleCount++;
        await delay(sampleInterval);
      }
    })();

    try {
      const result = await operation();
      monitoring = false;
      await monitoringPromise;
      return { result, memoryStats };
    } catch (error) {
      monitoring = false;
      await monitoringPromise;
      throw error;
    }
  }

  /**
   * Trigger garbage collection (if available)
   */
  static async forceGC(): Promise<void> {
    // Force GC if exposed (requires --expose-gc flag in Node.js)
    if (global.gc) {
      global.gc();
    }
    await delay(10); // Give time for GC to run
  }

  /**
   * Check for memory leaks by comparing before/after memory usage
   */
  static async checkMemoryLeak<T>(
    operation: () => Promise<T>,
    options: { threshold?: number; samples?: number } = {}
  ): Promise<{ result: T; memoryIncrease: number; leaked: boolean }> {
    const { threshold = 1024 * 1024, samples = 3 } = options; // 1MB threshold

    // Take baseline measurements
    await this.forceGC();
    const baselineMemory = this.getAverageMemoryUsage(samples);

    // Run operation
    const result = await operation();

    // Take post-operation measurements
    await this.forceGC();
    const postMemory = this.getAverageMemoryUsage(samples);

    const memoryIncrease = postMemory - baselineMemory;
    const leaked = memoryIncrease > threshold;

    return { result, memoryIncrease, leaked };
  }

  private static getAverageMemoryUsage(samples: number): number {
    let total = 0;
    for (let i = 0; i < samples; i++) {
      total += process.memoryUsage().heapUsed;
    }
    return total / samples;
  }
}

/**
 * Performance testing utilities
 */
export class PerformanceTestUtils {
  /**
   * Measure execution time of operation
   */
  static async measureTime<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;
    return { result, duration };
  }

  /**
   * Run performance benchmark with multiple iterations
   */
  static async benchmark<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      warmupIterations?: number;
      concurrency?: number;
    } = {}
  ): Promise<{
    results: T[];
    stats: {
      mean: number;
      median: number;
      min: number;
      max: number;
      stdDev: number;
      p95: number;
      p99: number;
    };
  }> {
    const { iterations = 100, warmupIterations = 10, concurrency = 1 } = options;

    // Warmup
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Run benchmark
    const durations: number[] = [];
    const results: T[] = [];

    const runBatch = async (batchSize: number) => {
      const promises = Array.from({ length: batchSize }, async () => {
        const { result, duration } = await this.measureTime(operation);
        return { result, duration };
      });

      const batchResults = await Promise.all(promises);
      
      for (const { result, duration } of batchResults) {
        results.push(result);
        durations.push(duration);
      }
    };

    // Run in batches based on concurrency
    const batches = Math.ceil(iterations / concurrency);
    for (let i = 0; i < batches; i++) {
      const batchSize = Math.min(concurrency, iterations - i * concurrency);
      await runBatch(batchSize);
    }

    // Calculate statistics
    const sortedDurations = durations.sort((a, b) => a - b);
    const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const median = sortedDurations[Math.floor(sortedDurations.length / 2)];
    const min = sortedDurations[0];
    const max = sortedDurations[sortedDurations.length - 1];
    
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    
    const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
    const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)];

    return {
      results,
      stats: { mean, median, min, max, stdDev, p95, p99 }
    };
  }

  /**
   * Load testing utility
   */
  static async loadTest<T>(
    operation: () => Promise<T>,
    options: {
      duration?: number; // ms
      rampUpTime?: number; // ms
      maxConcurrency?: number;
      requestsPerSecond?: number;
    } = {}
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    requestsPerSecond: number;
    errors: Error[];
  }> {
    const {
      duration = 30000,
      rampUpTime = 5000,
      maxConcurrency = 10,
      requestsPerSecond = 10
    } = options;

    const results: Array<{ success: boolean; duration: number; error?: Error }> = [];
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    let currentConcurrency = 1;
    const targetInterval = 1000 / requestsPerSecond;

    const rampUpIncrement = (maxConcurrency - 1) / (rampUpTime / 1000);

    const runRequest = async () => {
      try {
        const { duration } = await this.measureTime(operation);
        results.push({ success: true, duration });
      } catch (error) {
        results.push({
          success: false,
          duration: 0,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    };

    const activeRequests = new Set<Promise<void>>();

    while (Date.now() < endTime) {
      // Ramp up concurrency
      const elapsed = Date.now() - startTime;
      if (elapsed < rampUpTime) {
        currentConcurrency = Math.min(
          maxConcurrency,
          1 + Math.floor((elapsed / 1000) * rampUpIncrement)
        );
      } else {
        currentConcurrency = maxConcurrency;
      }

      // Start new requests up to current concurrency
      while (activeRequests.size < currentConcurrency && Date.now() < endTime) {
        const requestPromise = runRequest().finally(() => {
          activeRequests.delete(requestPromise);
        });
        
        activeRequests.add(requestPromise);
        
        // Wait for interval
        await delay(targetInterval);
      }
    }

    // Wait for all active requests to complete
    await Promise.all(activeRequests);

    // Calculate results
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const averageResponseTime = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.duration, 0) / (successfulRequests || 1);
    const actualDuration = Date.now() - startTime;
    const actualRequestsPerSecond = totalRequests / (actualDuration / 1000);
    const errors = results.filter(r => r.error).map(r => r.error!);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime,
      requestsPerSecond: actualRequestsPerSecond,
      errors,
    };
  }
}

/**
 * File system test utilities
 */
export class FileSystemTestUtils {
  /**
   * Create temporary directory for testing
   */
  static async createTempDir(prefix = 'claude-flow-test-'): Promise<string> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return tempDir;
  }

  /**
   * Create temporary file with content
   */
  static async createTempFile(
    content: string,
    options: { suffix?: string; dir?: string } = {}
  ): Promise<string> {
    const { suffix = '.tmp', dir = os.tmpdir() } = options;
    const tempPrefix = path.join(dir, 'temp-');
    const tempFile = fs.mkdtempSync(tempPrefix) + suffix;
    fs.writeFileSync(tempFile, content, 'utf8');
    return tempFile;
  }

  /**
   * Create test fixture files
   */
  static async createFixtures(
    fixtures: Record<string, string>,
    baseDir?: string
  ): Promise<string> {
    const fixtureDir = baseDir || await this.createTempDir('fixtures-');
    
    for (const [fileName, content] of Object.entries(fixtures)) {
      const filePath = path.join(fixtureDir, fileName);
      const dirPath = path.dirname(filePath);
      
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch {
        // Directory already exists
      }
      
      fs.writeFileSync(filePath, content, 'utf8');
    }

    return fixtureDir;
  }

  /**
   * Clean up temporary files and directories
   */
  static async cleanup(paths: string[]): Promise<void> {
    await Promise.all(
      paths.map(async pathToRemove => {
        try {
          fs.rmSync(pathToRemove, { recursive: true, force: true });
        } catch {
          // Ignore if already removed
        }
      })
    );
  }
}

/**
 * Mock factory for creating test doubles
 */
export class MockFactory {
  /**
   * Create a mock object with spied methods
   */
  static createMock<T extends Record<string, any>>(
    original: T,
    overrides: Partial<T> = {}
  ): T & { [K in keyof T]: T[K] extends (...args: any[]) => any ? Spy<T, K> : T[K] } {
    const mock = { ...original, ...overrides };
    
    for (const [key, value] of Object.entries(mock)) {
      if (typeof value === 'function') {
        // Create a jest mock function with the provided implementation
        mock[key] = jest.fn(value);
      }
    }

    return mock as any;
  }

  /**
   * Create a spy that tracks calls and can be configured
   */
  static createSpy<T extends (...args: any[]) => any>(
    implementation?: T
  ): Spy<any, any> & T {
    const obj = {};
    const methodName = 'method';
    
    if (implementation) {
      obj[methodName] = implementation;
    } else {
      obj[methodName] = () => {};
    }

    return jest.spyOn(obj, methodName) as any;
  }

  /**
   * Create a failing mock that throws errors
   */
  static createFailingMock<T extends Record<string, any>>(
    original: T,
    failingMethods: (keyof T)[],
    error: Error = new Error('Mock failure')
  ): T {
    const mock = { ...original };
    
    for (const method of failingMethods) {
      if (typeof original[method] === 'function') {
        mock[method] = jest.spyOn(mock, method, () => {
          throw error;
        });
      }
    }

    return mock;
  }
}

/**
 * Test data generators
 */
export class TestDataGenerator {
  /**
   * Generate random string
   */
  static randomString(length = 10): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate random number in range
   */
  static randomNumber(min = 0, max = 100): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate random boolean
   */
  static randomBoolean(): boolean {
    return Math.random() < 0.5;
  }

  /**
   * Generate array of random data
   */
  static randomArray<T>(generator: () => T, length?: number): T[] {
    const arrayLength = length || this.randomNumber(1, 10);
    return Array.from({ length: arrayLength }, generator);
  }

  /**
   * Generate random object
   */
  static randomObject(schema: Record<string, () => any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, generator] of Object.entries(schema)) {
      result[key] = generator();
    }
    return result;
  }

  /**
   * Generate large dataset for performance testing
   */
  static largeDataset(size: number): Array<{ id: string; name: string; value: number; data: string }> {
    return Array.from({ length: size }, (_, i) => ({
      id: `item-${i}`,
      name: this.randomString(20),
      value: this.randomNumber(1, 1000),
      data: this.randomString(100),
    }));
  }
}

/**
 * Test assertions with better error messages
 */
export class TestAssertions {
  /**
   * Assert that async operation completes within timeout
   */
  static async assertCompletesWithin<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    message?: string
  ): Promise<T> {
    return AsyncTestUtils.withTimeout(
      operation(),
      timeoutMs,
      message || `Operation should complete within ${timeoutMs}ms`
    );
  }

  /**
   * Assert that operation throws specific error
   */
  static async assertThrowsAsync<T extends Error>(
    operation: () => Promise<any>,
    ErrorClass?: new (...args: any[]) => T,
    msgIncludes?: string
  ): Promise<T> {
    try {
      await operation();
      throw new Error('Expected operation to throw, but it succeeded');
    } catch (error) {
      if (ErrorClass && !(error instanceof ErrorClass)) {
        throw new Error(
          `Expected error of type ${ErrorClass.name}, but got ${error.constructor.name}`
        );
      }
      
      if (msgIncludes && !error.message.includes(msgIncludes)) {
        throw new Error(
          `Expected error message to include "${msgIncludes}", but got: ${error.message}`
        );
      }

      return error as T;
    }
  }

  /**
   * Assert that value is within range
   */
  static assertInRange(
    actual: number,
    min: number,
    max: number,
    message?: string
  ): void {
    if (actual < min || actual > max) {
      throw new Error(
        message || `Expected ${actual} to be between ${min} and ${max}`
      );
    }
  }

  /**
   * Assert that arrays have same elements (order independent)
   */
  static assertSameElements<T>(
    actual: T[],
    expected: T[],
    message?: string
  ): void {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    
    expect(
      actualSorted,
      expectedSorted,
      message || 'Arrays should contain same elements'
    );
  }

  /**
   * Assert that spy was called with specific arguments
   */
  static assertSpyCalledWith(
    spy: Spy,
    expectedArgs: any[],
    message?: string
  ): void {
    const found = spy.calls.some(call => 
      call.args.length === expectedArgs.length &&
      call.args.every((arg, i) => arg === expectedArgs[i])
    );

    if (!found) {
      throw new Error(
        message || `Expected spy to be called with ${JSON.stringify(expectedArgs)}, but it wasn't`
      );
    }
  }
}

/**
 * Create a test configuration with all required sections
 */
export function createTestConfig(overrides?: Partial<Config>): Config {
  const defaultTestConfig: Config = {
    orchestrator: {
      maxConcurrentAgents: 10,
      taskQueueSize: 100,
      healthCheckInterval: 30000,
      shutdownTimeout: 30000,
      dataDir: './test-data',
      maintenanceInterval: 60000,
      metricsInterval: 30000,
      persistSessions: false,
      sessionRetentionMs: 86400000,
    },
    terminal: {
      type: 'auto',
      poolSize: 5,
      recycleAfter: 10,
      healthCheckInterval: 60000,
      commandTimeout: 300000,
    },
    memory: {
      backend: 'hybrid',
      cacheSizeMB: 100,
      syncInterval: 5000,
      conflictResolution: 'crdt',
      retentionDays: 30,
    },
    coordination: {
      maxRetries: 3,
      retryDelay: 1000,
      deadlockDetection: true,
      resourceTimeout: 60000,
      messageTimeout: 30000,
    },
    mcp: {
      transport: 'stdio',
      port: 3000,
      tlsEnabled: false,
    },
    logging: {
      level: 'info',
      format: 'json',
      destination: 'console',
    },
  };

  return deepMerge(defaultTestConfig, overrides || {});
}

/**
 * Deep merge utility for test configurations
 */
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (isObject(source[key]) && isObject(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }
  
  return output;
}

function isObject(obj: any): boolean {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}
