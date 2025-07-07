/**
 * Test Utils - Comprehensive testing utilities for Claude-Flow
 * Addresses Issue #120 - Unified test utilities with proper cleanup
 */

// Core cleanup utilities
export { TestCleanup, AsyncTestUtils, TestAssertions } from './test-cleanup.js';

// Performance testing utilities
export { 
  PerformanceTestUtils,
  type PerformanceMetrics,
  type BenchmarkStats,
  type LoadTestResults
} from './performance-test-utils.js';

// Test hooks and setup utilities
export { 
  TestHooks,
  testHooks,
  setupTest,
  teardownTest,
  isolatedTest,
  performanceTest,
  memoryLeakTest,
  wrapTest,
  type TestContext,
  type TestSetupOptions
} from './test-hooks.js';

// Import TestHooks for convenience functions
import { TestHooks } from './test-hooks.js';

// Convenience re-exports for common patterns
export const createTestSuite = TestHooks.createSuite.bind(TestHooks);
export const createJestHooks = TestHooks.createJestHooks.bind(TestHooks);
export const getCurrentContext = TestHooks.getCurrentContext.bind(TestHooks);

/**
 * Quick setup for Jest tests with comprehensive cleanup
 * 
 * Usage:
 * ```typescript
 * import { setupJestTest } from '../test-utils';
 * 
 * const { beforeAll, beforeEach, afterEach, afterAll } = setupJestTest({
 *   timeout: 30000,
 *   trackPerformance: true,
 *   trackMemory: true
 * });
 * ```
 */
export const setupJestTest = (options: import('./test-hooks.js').TestSetupOptions = {}) => {
  return TestHooks.createJestHooks(options);
};

/**
 * Default test configuration for Claude-Flow
 */
export const DEFAULT_TEST_CONFIG = {
  timeout: 30000,
  trackPerformance: false,
  trackMemory: false,
  isolation: false,
  cleanup: true,
  tags: ['default']
} as const;

/**
 * Performance test configuration
 */
export const PERFORMANCE_TEST_CONFIG = {
  timeout: 60000,
  trackPerformance: true,
  trackMemory: true,
  isolation: true,
  cleanup: true,
  tags: ['performance']
} as const;

/**
 * Memory test configuration
 */
export const MEMORY_TEST_CONFIG = {
  timeout: 60000,
  trackPerformance: false,
  trackMemory: true,
  isolation: true,
  cleanup: true,
  tags: ['memory']
} as const;

/**
 * Integration test configuration
 */
export const INTEGRATION_TEST_CONFIG = {
  timeout: 120000,
  trackPerformance: true,
  trackMemory: true,
  isolation: false,
  cleanup: true,
  tags: ['integration']
} as const;