/**
 * Integration Test Suite - Exports
 *
 * Centralized exports for all integration test utilities
 */

// Re-export setup utilities
export {
  TestUtils,
  MockData,
  PerfUtils,
  IntegrationMatchers,
  TEST_DB_DIR
} from './setup';

// Re-export fixtures
export {
  AgentFixtures,
  TaskFixtures,
  MemoryFixtures,
  WorkflowFixtures,
  PluginFixtures,
  ConfigFixtures,
  EventFixtures,
  ErrorFixtures,
  MockImplementations,
  Generators
} from './fixtures';

// Export commonly used types
export type IntegrationTestContext = {
  testDbPath: string;
  testDir: string;
  cleanup: () => Promise<void>;
};

// Export test helper functions
export const createTestContext = async (prefix: string): Promise<IntegrationTestContext> => {
  const { TestUtils } = await import('./setup');

  const testDbPath = TestUtils.createTestDbPath(prefix);
  const testDir = await TestUtils.createTestDir(prefix);

  return {
    testDbPath,
    testDir,
    cleanup: async () => {
      await TestUtils.cleanupTestFiles(prefix);
    }
  };
};

/**
 * Quick test setup for common scenarios
 */
export const quickSetup = {
  /**
   * Setup for memory tests
   */
  async memory() {
    const { TestUtils } = await import('./setup');
    const { MockImplementations } = await import('./fixtures');

    const dbPath = TestUtils.createTestDbPath('memory');
    const backend = MockImplementations.createMockMemoryBackend();

    return {
      dbPath,
      backend,
      cleanup: async () => {
        await backend.close();
        await TestUtils.cleanupTestFiles('memory');
      }
    };
  },

  /**
   * Setup for swarm tests
   */
  async swarm() {
    const { MockImplementations } = await import('./fixtures');

    const coordinator = MockImplementations.createMockCoordinator();

    return {
      coordinator,
      cleanup: async () => {
        await coordinator.shutdown();
      }
    };
  },

  /**
   * Setup for plugin tests
   */
  async plugin() {
    const { MockImplementations } = await import('./fixtures');

    const pluginManager = MockImplementations.createMockPluginManager();

    return {
      pluginManager,
      cleanup: async () => {
        await pluginManager.shutdown();
      }
    };
  },

  /**
   * Setup for full integration tests
   */
  async full() {
    const { TestUtils } = await import('./setup');
    const { MockImplementations } = await import('./fixtures');

    const dbPath = TestUtils.createTestDbPath('full');
    const backend = MockImplementations.createMockMemoryBackend();
    const coordinator = MockImplementations.createMockCoordinator();
    const pluginManager = MockImplementations.createMockPluginManager();

    return {
      dbPath,
      backend,
      coordinator,
      pluginManager,
      cleanup: async () => {
        await pluginManager.shutdown();
        await coordinator.shutdown();
        await backend.close();
        await TestUtils.cleanupTestFiles('full');
      }
    };
  }
};

/**
 * Common assertion helpers
 */
export const assert = {
  /**
   * Assert operation completed within time limit
   */
  async withinTime<T>(
    operation: () => Promise<T>,
    maxMs: number,
    message?: string
  ): Promise<T> {
    const start = Date.now();
    const result = await operation();
    const duration = Date.now() - start;

    if (duration > maxMs) {
      throw new Error(
        message || `Operation took ${duration}ms, expected <${maxMs}ms`
      );
    }

    return result;
  },

  /**
   * Assert operation succeeds after retries
   */
  async eventuallySucceeds<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 100
  ): Promise<T> {
    const { TestUtils } = await import('./setup');
    return TestUtils.retry(operation, maxAttempts, delayMs);
  },

  /**
   * Assert condition becomes true
   */
  async eventuallyTrue(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100
  ): Promise<void> {
    const { TestUtils } = await import('./setup');
    return TestUtils.waitFor(condition, timeoutMs, intervalMs);
  }
};

/**
 * Performance testing helpers
 */
export const perf = {
  /**
   * Measure execution time
   */
  async measure<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const { TestUtils } = await import('./setup');
    return TestUtils.measureTime(fn);
  },

  /**
   * Benchmark function
   */
  async benchmark(
    name: string,
    fn: () => Promise<void>,
    iterations: number = 10
  ) {
    const { PerfUtils } = await import('./setup');
    return PerfUtils.benchmark(name, fn, iterations);
  },

  /**
   * Assert performance target
   */
  assertTarget(duration: number, targetMs: number, operation: string): void {
    const { PerfUtils } = await import('./setup');
    PerfUtils.assertPerformance(duration, targetMs, operation);
  }
};

/**
 * Data generation helpers
 */
export const generate = {
  /**
   * Generate test agents
   */
  agents(count: number) {
    return import('./fixtures').then(({ MockData }) => MockData.generateAgents(count));
  },

  /**
   * Generate test tasks
   */
  tasks(count: number) {
    return import('./fixtures').then(({ MockData }) => MockData.generateTasks(count));
  },

  /**
   * Generate test memories
   */
  memories(count: number, agentId?: string) {
    return import('./fixtures').then(({ MockData }) =>
      MockData.generateMemories(count, agentId)
    );
  },

  /**
   * Generate embedding vector
   */
  embedding(dimension: number = 384) {
    return import('./setup').then(({ TestUtils }) =>
      TestUtils.generateEmbedding(dimension)
    );
  }
};

// Default export with all utilities
export default {
  quickSetup,
  assert,
  perf,
  generate,
  createTestContext
};
