/**
 * Test Helpers Index
 * Central export for all test utilities
 */

// Database utilities
export {
  createTestDatabase,
  createFileTestDatabase,
  dbTestHelpers,
  type TestDatabase,
  type SeedData,
} from './database-utils.js';

// General test utilities
export {
  createDeferred,
  waitForEvent,
  createSpy,
  fsTestHelpers,
  mockFactories,
  asyncHelpers,
  perfHelpers,
  snapshotHelpers,
  type DeferredPromise,
  type SpyFunction,
} from './test-utils.js';

// Mock utilities
export {
  createMockExpressApp,
  createMockWebSocket,
  createMockMCPClient,
  createMockChildProcess,
  createMockWatcher,
  createMockRedisClient,
  createMockRequest,
  createMockResponse,
  createMockEventBus,
  mockTimers,
} from './mock-utils.js';

// Re-export common test utilities
export { testUtils } from '../../jest.setup.js';
