/**
 * Test Lifecycle Hooks and Management
 * Provides setup/teardown automation with cleanup integration
 */

import { TestCleanup } from "./test-cleanup.ts";
import { PerformanceTestUtils } from "./performance-test-utils.ts";

export interface TestContext {
  testId: string;
  cleanup: TestCleanup;
  performance: typeof PerformanceTestUtils;
  startTime: number;
}

export interface TestSetupOptions {
  timeout?: number;
  trackPerformance?: boolean;
  trackMemory?: boolean;
  enableGC?: boolean;
}

export interface MemoryLeakTestResult {
  result: unknown;
  memoryLeak: boolean;
  memoryIncrease: number;
  iterations: number;
}

export class TestHooks {
  private static contexts = new Map<string, TestContext>();

  /**
   * Setup a test with automatic cleanup and performance tracking
   */
  static setupTest(testName: string, options: TestSetupOptions = {}): TestContext {
    const testId = `${testName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const context: TestContext = {
      testId,
      cleanup: new TestCleanup(),
      performance: PerformanceTestUtils,
      startTime: performance.now(),
    };

    this.contexts.set(testId, context);

    // Force GC if enabled
    if (options.enableGC && (globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }

    return context;
  }

  /**
   * Teardown a test with automatic cleanup
   */
  static async teardownTest(testId: string): Promise<void> {
    const context = this.contexts.get(testId);
    if (!context) {
      throw new Error(`Test context not found for ID: ${testId}`);
    }

    try {
      await context.cleanup.cleanup();
    } finally {
      this.contexts.delete(testId);
    }
  }

  /**
   * Run a test in isolation with automatic setup/teardown
   */
  static async isolatedTest<T>(
    testFunction: (context: TestContext) => Promise<T>,
    options: TestSetupOptions = {}
  ): Promise<T> {
    const context = this.setupTest('isolated_test', options);
    
    try {
      const result = await testFunction(context);
      return result;
    } finally {
      await this.teardownTest(context.testId);
    }
  }

  /**
   * Wrap a test function with automatic cleanup
   */
  static wrapTest<T extends unknown[]>(
    testFunction: (context: TestContext, ...args: T) => Promise<void>,
    options: TestSetupOptions = {}
  ): (...args: T) => Promise<void> {
    return async (...args: T) => {
      const context = this.setupTest('wrapped_test', options);
      
      try {
        await testFunction(context, ...args);
      } finally {
        await this.teardownTest(context.testId);
      }
    };
  }

  /**
   * Run a test with memory leak detection
   */
  static async memoryLeakTest<T>(
    testFunction: () => Promise<T>,
    options: {
      iterations?: number;
      memoryThreshold?: number;
    } = {}
  ): Promise<MemoryLeakTestResult> {
    const { iterations = 10, memoryThreshold = 1024 * 1024 * 10 } = options; // 10MB default

    // Force GC before starting
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }

    let baselineMemory = 0;
    try {
      baselineMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
    } catch {
      baselineMemory = 0;
    }

    let result: T | undefined;

    // Run the test function multiple times
    for (let i = 0; i < iterations; i++) {
      result = await testFunction();
      
      // Periodic GC to identify true leaks vs temporary allocations
      if (i % 3 === 0 && (globalThis as { gc?: () => void }).gc) {
        (globalThis as { gc: () => void }).gc();
      }
    }

    // Final GC and memory check
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }

    let finalMemory = 0;
    try {
      finalMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
    } catch {
      finalMemory = 0;
    }

    const memoryIncrease = finalMemory - baselineMemory;
    const memoryLeak = memoryIncrease > memoryThreshold;

    return {
      result: result as T,
      memoryLeak,
      memoryIncrease,
      iterations,
    };
  }

  /**
   * Create a test suite with shared cleanup context
   */
  static createTestSuite(suiteName: string) {
    const suiteCleanup = new TestCleanup();
    
    return {
      /**
       * Add a resource to the suite-wide cleanup
       */
      addCleanup: <T>(resource: T, cleanupFn: (resource: T) => void | Promise<void>): T => {
        suiteCleanup.registerHandle({
          close: () => cleanupFn(resource)
        });
        return resource;
      },

      /**
       * Run a test within the suite context
       */
      runTest: async <T>(
        testName: string,
        testFn: (context: TestContext) => Promise<T>
      ): Promise<T> => {
        const testContext = TestHooks.setupTest(`${suiteName}_${testName}`);
        
        try {
          return await testFn(testContext);
        } finally {
          await TestHooks.teardownTest(testContext.testId);
        }
      },

      /**
       * Cleanup all suite-wide resources
       */
      cleanup: async (): Promise<void> => {
        await suiteCleanup.cleanup();
      },

      /**
       * Get suite statistics
       */
      getStats: () => suiteCleanup.getStats(),
    };
  }

  /**
   * Utility for testing async operations with timeouts
   */
  static async withTestTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    testName = 'unknown'
  ): Promise<T> {
    const cleanup = new TestCleanup();
    
    try {
      return await Promise.race([
        operation(),
        cleanup.createTimeoutPromise<never>(
          () => {
            // Never resolve - this will timeout
          },
          timeoutMs,
          `Test "${testName}" timed out after ${timeoutMs}ms`
        )
      ]);
    } finally {
      await cleanup.cleanup();
    }
  }

  /**
   * Run multiple tests in parallel with isolated contexts
   */
  static async parallelTests<T>(
    tests: Array<{
      name: string;
      fn: (context: TestContext) => Promise<T>;
      options?: TestSetupOptions;
    }>
  ): Promise<Array<{ name: string; result: T; duration: number }>> {
    const testPromises = tests.map(async ({ name, fn, options = {} }) => {
      const startTime = performance.now();
      
      const result = await this.isolatedTest(fn, options);
      
      return {
        name,
        result,
        duration: performance.now() - startTime,
      };
    });

    return Promise.all(testPromises);
  }

  /**
   * Get all active test contexts (for debugging)
   */
  static getActiveContexts(): Map<string, TestContext> {
    return new Map(this.contexts);
  }

  /**
   * Force cleanup of all active contexts (emergency cleanup)
   */
  static async cleanupAllContexts(): Promise<void> {
    const cleanupPromises = Array.from(this.contexts.keys()).map(testId =>
      this.teardownTest(testId).catch(error => {
        console.warn(`Failed to cleanup test context ${testId}:`, error);
      })
    );

    await Promise.all(cleanupPromises);
  }
}