/**
 * Integration Test Setup
 *
 * Global setup and utilities for V3 integration tests
 */
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

// Global test database directory
export const TEST_DB_DIR = path.join(__dirname, '.test-dbs');

/**
 * Global setup - runs once before all tests
 */
beforeAll(async () => {
  // Create test database directory
  try {
    await fs.mkdir(TEST_DB_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create test database directory:', error);
  }

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.CLAUDE_FLOW_ENV = 'test';
  process.env.CLAUDE_FLOW_MEMORY_PATH = TEST_DB_DIR;

  // Increase file descriptor limit for concurrent operations
  if (process.platform !== 'win32') {
    try {
      // @ts-ignore - ulimit available on Unix-like systems
      process.setMaxListeners(100);
    } catch (error) {
      // Ignore on platforms where this is not supported
    }
  }
});

/**
 * Global teardown - runs once after all tests
 */
afterAll(async () => {
  // Clean up test database directory
  try {
    await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error('Failed to clean up test database directory:', error);
  }

  // Clear environment variables
  delete process.env.CLAUDE_FLOW_ENV;
  delete process.env.CLAUDE_FLOW_MEMORY_PATH;
});

/**
 * Before each test - runs before every test
 */
beforeEach(() => {
  // Reset global mocks
  // (Vitest handles this automatically with clearMocks: true)
});

/**
 * After each test - runs after every test
 */
afterEach(async () => {
  // Give time for async cleanup
  await new Promise(resolve => setTimeout(resolve, 10));
});

/**
 * Test utilities
 */
export const TestUtils = {
  /**
   * Create a unique test database path
   */
  createTestDbPath(prefix: string): string {
    return path.join(TEST_DB_DIR, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  },

  /**
   * Create a unique test directory
   */
  async createTestDir(prefix: string): Promise<string> {
    const dirPath = path.join(TEST_DB_DIR, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  },

  /**
   * Wait for a condition to be true
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  },

  /**
   * Generate random embedding vector
   */
  generateEmbedding(dimension: number = 384): number[] {
    return new Array(dimension).fill(0).map(() => Math.random());
  },

  /**
   * Create mock agent configuration
   */
  createMockAgent(overrides: Partial<any> = {}): any {
    return {
      id: `agent-${Date.now()}`,
      type: 'coder',
      status: 'active',
      capabilities: ['code'],
      metadata: {},
      ...overrides
    };
  },

  /**
   * Create mock task configuration
   */
  createMockTask(overrides: Partial<any> = {}): any {
    return {
      id: `task-${Date.now()}`,
      type: 'code',
      description: 'Test task',
      priority: 'medium',
      status: 'pending',
      ...overrides
    };
  },

  /**
   * Create mock memory
   */
  createMockMemory(overrides: Partial<any> = {}): any {
    return {
      id: `memory-${Date.now()}`,
      agentId: 'test-agent',
      content: 'Test memory content',
      type: 'task',
      timestamp: Date.now(),
      ...overrides
    };
  },

  /**
   * Measure execution time
   */
  async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const result = await fn();
    const duration = Date.now() - startTime;
    return { result, duration };
  },

  /**
   * Run with timeout
   */
  async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
      )
    ]);
  },

  /**
   * Retry operation
   */
  async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 100
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw lastError!;
  },

  /**
   * Clean up test files
   */
  async cleanupTestFiles(pattern: string): Promise<void> {
    try {
      const files = await fs.readdir(TEST_DB_DIR);
      const matchingFiles = files.filter(f => f.includes(pattern));

      await Promise.all(
        matchingFiles.map(file =>
          fs.unlink(path.join(TEST_DB_DIR, file)).catch(() => {})
        )
      );
    } catch (error) {
      // Ignore cleanup errors
    }
  }
};

/**
 * Mock data generators
 */
export const MockData = {
  /**
   * Generate multiple agents
   */
  generateAgents(count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `agent-${i}`,
      type: ['coder', 'tester', 'reviewer'][i % 3],
      status: 'active',
      capabilities: [['code'], ['test'], ['review']][i % 3],
      metadata: { index: i }
    }));
  },

  /**
   * Generate multiple tasks
   */
  generateTasks(count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `task-${i}`,
      type: 'code',
      description: `Task ${i}`,
      priority: ['high', 'medium', 'low'][i % 3] as any,
      status: 'pending',
      metadata: { index: i }
    }));
  },

  /**
   * Generate multiple memories
   */
  generateMemories(count: number, agentId: string = 'test-agent'): any[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `memory-${i}`,
      agentId,
      content: `Memory content ${i}`,
      type: ['task', 'context', 'event'][i % 3],
      timestamp: Date.now() + i,
      metadata: { index: i }
    }));
  }
};

/**
 * Performance testing utilities
 */
export const PerfUtils = {
  /**
   * Benchmark function execution
   */
  async benchmark(
    name: string,
    fn: () => Promise<void>,
    iterations: number = 10
  ): Promise<{
    name: string;
    iterations: number;
    totalTime: number;
    averageTime: number;
    minTime: number;
    maxTime: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await fn();
      times.push(Date.now() - start);
    }

    return {
      name,
      iterations,
      totalTime: times.reduce((a, b) => a + b, 0),
      averageTime: times.reduce((a, b) => a + b, 0) / iterations,
      minTime: Math.min(...times),
      maxTime: Math.max(...times)
    };
  },

  /**
   * Assert performance target
   */
  assertPerformance(duration: number, targetMs: number, operation: string): void {
    if (duration > targetMs) {
      throw new Error(
        `Performance target missed: ${operation} took ${duration}ms, expected <${targetMs}ms`
      );
    }
  }
};

/**
 * Integration test matchers (custom assertions)
 */
export const IntegrationMatchers = {
  /**
   * Assert agent is valid
   */
  assertValidAgent(agent: any): void {
    if (!agent || typeof agent !== 'object') {
      throw new Error('Invalid agent: not an object');
    }
    if (!agent.id || typeof agent.id !== 'string') {
      throw new Error('Invalid agent: missing or invalid id');
    }
    if (!agent.type || typeof agent.type !== 'string') {
      throw new Error('Invalid agent: missing or invalid type');
    }
  },

  /**
   * Assert memory is valid
   */
  assertValidMemory(memory: any): void {
    if (!memory || typeof memory !== 'object') {
      throw new Error('Invalid memory: not an object');
    }
    if (!memory.id || typeof memory.id !== 'string') {
      throw new Error('Invalid memory: missing or invalid id');
    }
    if (!memory.agentId || typeof memory.agentId !== 'string') {
      throw new Error('Invalid memory: missing or invalid agentId');
    }
    if (!memory.content) {
      throw new Error('Invalid memory: missing content');
    }
  },

  /**
   * Assert task is valid
   */
  assertValidTask(task: any): void {
    if (!task || typeof task !== 'object') {
      throw new Error('Invalid task: not an object');
    }
    if (!task.id || typeof task.id !== 'string') {
      throw new Error('Invalid task: missing or invalid id');
    }
    if (!task.type || typeof task.type !== 'string') {
      throw new Error('Invalid task: missing or invalid type');
    }
  }
};

// Export everything as default for convenience
export default {
  TestUtils,
  MockData,
  PerfUtils,
  IntegrationMatchers,
  TEST_DB_DIR
};
