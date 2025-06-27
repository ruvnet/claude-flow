/**
 * Jest Global Setup File
 * Configures the test environment before running tests
 */

import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Global test configuration
declare global {
  namespace NodeJS {
    interface Global {
      __TEST_DB_PATH__: string;
      __TEST_DATA_DIR__: string;
      __ORIGINAL_ENV__: NodeJS.ProcessEnv;
    }
  }
  var __TEST_DB_PATH__: string;
  var __TEST_DATA_DIR__: string;
  var __ORIGINAL_ENV__: NodeJS.ProcessEnv;
}

// Store original environment
global.__ORIGINAL_ENV__ = { ...process.env };

// Setup test environment variables
process.env.NODE_ENV = 'test';
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.CLAUDE_FLOW_LOG_LEVEL = process.env.DEBUG_TESTS ? 'debug' : 'silent';
process.env.CLAUDE_FLOW_DISABLE_METRICS = 'true';
process.env.CLAUDE_FLOW_DISABLE_TELEMETRY = 'true';

// Create test data directory
const testDataDir = join(tmpdir(), `claude-flow-test-${process.pid}`);
mkdirSync(testDataDir, { recursive: true });
global.__TEST_DATA_DIR__ = testDataDir;
process.env.CLAUDE_FLOW_DATA_DIR = testDataDir;

// Set test database path
global.__TEST_DB_PATH__ = join(testDataDir, 'test.db');
process.env.CLAUDE_FLOW_DB_PATH = global.__TEST_DB_PATH__;

// Configure console for tests
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Custom matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
  
  toContainObject(received: any[], expected: object) {
    const pass = received.some(item => 
      Object.keys(expected).every(key => 
        item[key] === (expected as any)[key]
      )
    );
    
    if (pass) {
      return {
        message: () => `expected array not to contain object matching ${JSON.stringify(expected)}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected array to contain object matching ${JSON.stringify(expected)}`,
        pass: false,
      };
    }
  },
  
  toBeValidJSON(received: string) {
    try {
      JSON.parse(received);
      return {
        message: () => `expected ${received} not to be valid JSON`,
        pass: true,
      };
    } catch {
      return {
        message: () => `expected ${received} to be valid JSON`,
        pass: false,
      };
    }
  },
});

// Increase timeout for CI environments
if (process.env.CI === 'true') {
  jest.setTimeout(30000);
}

// Global teardown
afterAll(() => {
  // Clean up test data directory
  try {
    if (global.__TEST_DATA_DIR__) {
      rmSync(global.__TEST_DATA_DIR__, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Failed to clean up test data directory:', error);
  }
  
  // Restore original environment
  process.env = { ...global.__ORIGINAL_ENV__ };
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  throw reason;
});

// Export test utilities
export const testUtils = {
  getTestDbPath: () => global.__TEST_DB_PATH__,
  getTestDataDir: () => global.__TEST_DATA_DIR__,
  
  // Create a temporary test directory
  createTempDir: (name: string): string => {
    const path = join(global.__TEST_DATA_DIR__, name);
    mkdirSync(path, { recursive: true });
    return path;
  },
  
  // Wait for a condition to be true
  waitFor: async (
    condition: () => boolean | Promise<boolean>,
    timeout = 5000,
    interval = 100
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },
  
  // Create a mock function with TypeScript support
  createMockFn: <T extends (...args: any[]) => any>(): jest.Mock<
    ReturnType<T>,
    Parameters<T>
  > => {
    return jest.fn<ReturnType<T>, Parameters<T>>();
  },
};