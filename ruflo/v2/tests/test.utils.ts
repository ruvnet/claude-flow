import { jest } from '@jest/globals';

// Mock logger utilities
export const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
};

// Mock event bus utilities
export const mockEventBus = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  removeAllListeners: jest.fn()
};

// Mock coordination system utilities
export const mockCoordinationSystem = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  getStatus: jest.fn(),
  addAgent: jest.fn(),
  removeAgent: jest.fn(),
  orchestrateTask: jest.fn()
};

// Mock memory backend utilities
export const mockMemoryBackend = {
  store: jest.fn(),
  retrieve: jest.fn(),
  delete: jest.fn(),
  list: jest.fn(),
  clear: jest.fn()
};

// Mock orchestrator utilities
export const mockOrchestrator = {
  start: jest.fn(),
  stop: jest.fn(),
  executeTask: jest.fn(),
  getAgents: jest.fn(),
  getTaskStatus: jest.fn()
};

// Test helper functions
export const createMockAgent = (id: string, type: string = 'test') => ({
  id,
  type,
  capabilities: ['test'],
  status: 'idle',
  execute: jest.fn(),
  initialize: jest.fn(),
  shutdown: jest.fn()
});

export const createMockTask = (id: string, description: string) => ({
  id,
  description,
  status: 'pending',
  priority: 'medium',
  createdAt: new Date(),
  updatedAt: new Date()
});

// Async test utilities
export const waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const waitForCondition = async (
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> => {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Condition not met within timeout');
    }
    await waitFor(interval);
  }
};

// Environment setup utilities
export const setupTestEnvironment = () => {
  // Reset all mocks
  jest.clearAllMocks();
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  
  return {
    logger: mockLogger,
    coordinationSystem: mockCoordinationSystem,
    memoryBackend: mockMemoryBackend,
    orchestrator: mockOrchestrator
  };
};

export const teardownTestEnvironment = () => {
  jest.clearAllMocks();
  
  // Clean up environment variables
  delete process.env.LOG_LEVEL;
};

// Re-export commonly used test utilities
export { jest } from '@jest/globals';
export { describe, it, test, beforeEach, afterEach, beforeAll, afterAll, expect } from '@jest/globals';

// Export assertion utilities
export const assert = (condition: boolean, message?: string) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

export const assertEquals = (actual: any, expected: any, message?: string) => {
  expect(actual).toEqual(expected);
};

export const assertExists = (value: any, message?: string) => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
};

export const assertRejects = async (fn: () => Promise<any>, errorType?: any) => {
  if (errorType) {
    await expect(fn()).rejects.toThrow(errorType);
  } else {
    await expect(fn()).rejects.toThrow();
  }
};

export const assertThrows = (fn: () => any, errorType?: any) => {
  if (errorType) {
    expect(fn).toThrow(errorType);
  } else {
    expect(fn).toThrow();
  }
};

// Export assertion utilities for spies
export const assertSpyCalls = (spyFn: any, expectedCalls: number) => {
  expect(spyFn).toHaveBeenCalledTimes(expectedCalls);
};

// Export FakeTime for timer mocking
export class FakeTime {
  constructor() {
    jest.useFakeTimers();
  }
  
  install() {
    jest.useFakeTimers();
  }
  
  restore() {
    jest.useRealTimers();
  }
  
  uninstall() {
    jest.useRealTimers();
  }
  
  tick(ms: number) {
    jest.advanceTimersByTime(ms);
  }
  
  async tickAsync(ms: number) {
    await jest.advanceTimersByTimeAsync(ms);
  }
  
  runAll() {
    jest.runAllTimers();
  }
  
  runPending() {
    jest.runOnlyPendingTimers();
  }
}

// Additional spy utilities with sinon-like API
export const spy = (obj?: any, method?: string) => {
  if (obj && method) {
    return jest.spyOn(obj, method);
  }
  // Return a standalone spy function
  const spyFn = jest.fn();
  (spyFn as any).calls = {
    get length() { return spyFn.mock.calls.length; },
    get count() { return spyFn.mock.calls.length; }
  };
  return spyFn;
};

export const stub = () => {
  const stubFn = jest.fn();
  (stubFn as any).calls = {
    get length() { return stubFn.mock.calls.length; },
    get count() { return stubFn.mock.calls.length; }
  };
  return stubFn;
};

// Additional testing utilities
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test data builder utilities
export class TestDataBuilder {
  static createTestAgent(overrides?: any) {
    return {
      id: 'test-agent-1',
      name: 'Test Agent',
      type: 'test',
      status: 'active',
      ...overrides
    };
  }
  
  static createTestTask(overrides?: any) {
    return {
      id: 'test-task-1',
      description: 'Test task description',
      status: 'pending',
      priority: 'medium',
      ...overrides
    };
  }
  
  static createTestMemory(overrides?: any) {
    return {
      id: 'test-memory-1',
      key: 'test-key',
      value: { data: 'test data' },
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      },
      ...overrides
    };
  }
  
  static config() {
    return {
      orchestrator: {
        maxConcurrentAgents: 10,
        taskQueueSize: 100,
        healthCheckInterval: 10000,
        sessionRetentionMs: 3600000
      },
      coordination: {
        deadlockDetection: false,
        maxTaskRetries: 3
      },
      memory: {
        defaultBackend: 'memory',
        maxCacheSize: 1000
      }
    };
  }
  
  static agentProfile(overrides?: any) {
    return {
      id: 'test-agent-' + Math.random().toString(36).substr(2, 9),
      name: 'Test Agent',
      type: 'test',
      capabilities: ['test'],
      maxConcurrentTasks: 5,
      priority: 5,
      ...overrides
    };
  }
  
  static task(overrides?: any) {
    return {
      id: 'test-task-' + Math.random().toString(36).substr(2, 9),
      type: 'test',
      description: 'Test task',
      priority: 50,
      status: 'pending',
      dependencies: [],
      metadata: {},
      ...overrides
    };
  }
}