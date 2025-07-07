/**
 * Test Hooks and Setup Utilities
 * Addresses Issue #120 - Consistent test setup/teardown with proper cleanup
 */

import { TestCleanup } from './test-cleanup.js';
import { PerformanceTestUtils } from './performance-test-utils.js';

/**
 * Test context shared across setup/teardown
 */
export interface TestContext {
  cleanup: TestCleanup;
  performance: typeof PerformanceTestUtils;
  testId: string;
  startTime: number;
  metadata: Record<string, any>;
}

/**
 * Test setup options
 */
export interface TestSetupOptions {
  timeout?: number;
  trackPerformance?: boolean;
  trackMemory?: boolean;
  isolation?: boolean;
  cleanup?: boolean;
  tags?: string[];
}

/**
 * Global test context manager
 */
class TestContextManager {
  private contexts = new Map<string, TestContext>();
  private globalCleanup = new TestCleanup();

  createContext(testId: string, options: TestSetupOptions = {}): TestContext {
    const context: TestContext = {
      cleanup: new TestCleanup(),
      performance: PerformanceTestUtils,
      testId,
      startTime: performance.now(),
      metadata: {
        options,
        tags: options.tags || []
      }
    };

    this.contexts.set(testId, context);
    return context;
  }

  getContext(testId: string): TestContext | undefined {
    return this.contexts.get(testId);
  }

  async cleanupContext(testId: string): Promise<void> {
    const context = this.contexts.get(testId);
    if (context) {
      await context.cleanup.cleanup();
      this.contexts.delete(testId);
    }
  }

  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.contexts.keys()).map(
      id => this.cleanupContext(id)
    );
    await Promise.all(cleanupPromises);
    await this.globalCleanup.cleanup();
  }

  getGlobalCleanup(): TestCleanup {
    return this.globalCleanup;
  }
}

// Global instance
const contextManager = new TestContextManager();

/**
 * Test hooks utility class
 */
export class TestHooks {
  private static currentContext: TestContext | null = null;

  /**
   * Setup before each test with comprehensive cleanup
   */
  static setupTest(testName: string, options: TestSetupOptions = {}): TestContext {
    const testId = `${testName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const context = contextManager.createContext(testId, options);
    
    this.currentContext = context;
    
    // Set default Jest timeout if specified
    if (options.timeout && typeof jest !== 'undefined') {
      jest.setTimeout(options.timeout);
    }
    
    return context;
  }

  /**
   * Teardown after each test with comprehensive cleanup
   */
  static async teardownTest(testName?: string): Promise<void> {
    const context = this.currentContext;
    if (context) {
      try {
        // Log performance metrics if tracking enabled
        if (context.metadata.options.trackPerformance) {
          const duration = performance.now() - context.startTime;
          console.log(`Test ${context.testId} completed in ${duration.toFixed(2)}ms`);
        }

        // Cleanup all resources
        await context.cleanup.cleanup();
        
        // Cleanup context
        await contextManager.cleanupContext(context.testId);
        
      } catch (error) {
        console.error(`Error during test teardown for ${context.testId}:`, error);
      } finally {
        this.currentContext = null;
      }
    }
  }

  /**
   * Get current test context
   */
  static getCurrentContext(): TestContext | null {
    return this.currentContext;
  }

  /**
   * Global setup for all tests
   */
  static async globalSetup(): Promise<void> {
    // Enable verbose error reporting
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
    });
  }

  /**
   * Global teardown for all tests
   */
  static async globalTeardown(): Promise<void> {
    await contextManager.cleanupAll();
  }

  /**
   * Create Jest-compatible setup functions
   */
  static createJestHooks(options: TestSetupOptions = {}) {
    return {
      beforeAll: async () => {
        await this.globalSetup();
      },
      
      beforeEach: async () => {
        // Get test name from Jest context if available
        const testName = (expect as any).getState?.()?.currentTestName || 'unknown-test';
        return this.setupTest(testName, options);
      },
      
      afterEach: async () => {
        await this.teardownTest();
      },
      
      afterAll: async () => {
        await this.globalTeardown();
      }
    };
  }

  /**
   * Create test suite with automatic cleanup
   */
  static createSuite(
    suiteName: string,
    testFn: (context: TestContext) => Promise<void> | void,
    options: TestSetupOptions = {}
  ) {
    return async () => {
      const context = this.setupTest(suiteName, options);
      try {
        await testFn(context);
      } finally {
        await this.teardownTest();
      }
    };
  }

  /**
   * Wrap async test function with cleanup
   */
  static wrapTest<T extends any[]>(
    testFn: (context: TestContext, ...args: T) => Promise<void> | void,
    options: TestSetupOptions = {}
  ) {
    return async (...args: T) => {
      const testName = testFn.name || 'anonymous-test';
      const context = this.setupTest(testName, options);
      try {
        await testFn(context, ...args);
      } finally {
        await this.teardownTest();
      }
    };
  }

  /**
   * Create isolated test environment
   */
  static async isolatedTest<T>(
    testFn: (context: TestContext) => Promise<T> | T,
    options: TestSetupOptions = {}
  ): Promise<T> {
    const isolatedOptions = { ...options, isolation: true };
    const context = this.setupTest('isolated-test', isolatedOptions);
    
    try {
      return await testFn(context);
    } finally {
      await this.teardownTest();
    }
  }

  /**
   * Performance test wrapper
   */
  static async performanceTest<T>(
    testFn: (context: TestContext) => Promise<T> | T,
    options: TestSetupOptions & { 
      iterations?: number;
      warningThreshold?: number;
    } = {}
  ): Promise<{
    result: T;
    duration: number;
    memoryUsed: number;
    iterations: number;
  }> {
    const { iterations = 1, warningThreshold = 1000, ...testOptions } = options;
    const performanceOptions = { 
      ...testOptions, 
      trackPerformance: true, 
      trackMemory: true 
    };
    
    const context = this.setupTest('performance-test', performanceOptions);
    
    try {
      const { result, metrics } = await context.performance.measurePerformance(
        () => testFn(context),
        { trackMemory: true }
      );
      
      if (metrics.duration > warningThreshold) {
        console.warn(`Performance test exceeded ${warningThreshold}ms threshold: ${metrics.duration.toFixed(2)}ms`);
      }
      
      return {
        result,
        duration: metrics.duration,
        memoryUsed: metrics.memoryUsed,
        iterations
      };
    } finally {
      await this.teardownTest();
    }
  }

  /**
   * Memory leak detection test
   */
  static async memoryLeakTest<T>(
    testFn: (context: TestContext) => Promise<T> | T,
    options: TestSetupOptions & {
      iterations?: number;
      memoryThreshold?: number;
    } = {}
  ): Promise<{
    result: T;
    memoryLeak: boolean;
    memoryIncrease: number;
    iterations: number;
  }> {
    const { iterations = 100, memoryThreshold = 1024 * 1024, ...testOptions } = options;
    const context = this.setupTest('memory-leak-test', testOptions);
    
    try {
      // Force garbage collection
      if (global.gc) {
        global.gc();
      }
      
      const startMemory = process.memoryUsage().heapUsed;
      let result: T;
      
      // Run test multiple times to detect leaks
      for (let i = 0; i < iterations; i++) {
        result = await testFn(context);
        
        // Periodic garbage collection
        if (i % 10 === 0 && global.gc) {
          global.gc();
        }
      }
      
      // Final garbage collection
      if (global.gc) {
        global.gc();
      }
      
      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = endMemory - startMemory;
      const memoryLeak = memoryIncrease > memoryThreshold;
      
      return {
        result: result!,
        memoryLeak,
        memoryIncrease,
        iterations
      };
    } finally {
      await this.teardownTest();
    }
  }
}

/**
 * Convenience functions for common test patterns
 */
export const testHooks = TestHooks.createJestHooks();
export const setupTest = TestHooks.setupTest.bind(TestHooks);
export const teardownTest = TestHooks.teardownTest.bind(TestHooks);
export const isolatedTest = TestHooks.isolatedTest.bind(TestHooks);
export const performanceTest = TestHooks.performanceTest.bind(TestHooks);
export const memoryLeakTest = TestHooks.memoryLeakTest.bind(TestHooks);
export const wrapTest = TestHooks.wrapTest.bind(TestHooks);