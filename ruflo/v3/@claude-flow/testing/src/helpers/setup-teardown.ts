/**
 * @claude-flow/testing - Setup & Teardown Helpers
 *
 * Global setup and teardown utilities for V3 module testing.
 * Provides test isolation, resource cleanup, and environment management.
 */
import { vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

/**
 * Setup context for managing test resources
 */
export interface SetupContext {
  /**
   * Register a cleanup function to be called during teardown
   */
  addCleanup(cleanup: CleanupFunction): void;

  /**
   * Register a resource that needs to be closed/disposed
   */
  registerResource<T extends Disposable>(resource: T): T;

  /**
   * Get a registered resource by name
   */
  getResource<T>(name: string): T | undefined;

  /**
   * Set a named resource
   */
  setResource<T>(name: string, resource: T): void;

  /**
   * Run all cleanup functions
   */
  runCleanup(): Promise<void>;
}

/**
 * Cleanup function type
 */
export type CleanupFunction = () => void | Promise<void>;

/**
 * Disposable interface
 */
export interface Disposable {
  dispose?(): void | Promise<void>;
  close?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/**
 * Create a setup context for managing test resources
 *
 * @example
 * const ctx = createSetupContext();
 * ctx.addCleanup(() => server.close());
 * ctx.registerResource(database);
 * // ... run tests
 * await ctx.runCleanup();
 */
export function createSetupContext(): SetupContext {
  const cleanups: CleanupFunction[] = [];
  const resources = new Map<string, unknown>();
  const disposables: Disposable[] = [];

  return {
    addCleanup(cleanup: CleanupFunction): void {
      cleanups.push(cleanup);
    },

    registerResource<T extends Disposable>(resource: T): T {
      disposables.push(resource);
      return resource;
    },

    getResource<T>(name: string): T | undefined {
      return resources.get(name) as T | undefined;
    },

    setResource<T>(name: string, resource: T): void {
      resources.set(name, resource);
    },

    async runCleanup(): Promise<void> {
      // Run cleanups in reverse order
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          console.error('Cleanup error:', error);
        }
      }

      // Dispose resources
      for (const resource of disposables) {
        try {
          if (resource.dispose) {
            await resource.dispose();
          } else if (resource.close) {
            await resource.close();
          } else if (resource.destroy) {
            await resource.destroy();
          } else if (resource.shutdown) {
            await resource.shutdown();
          }
        } catch (error) {
          console.error('Resource disposal error:', error);
        }
      }

      cleanups.length = 0;
      resources.clear();
      disposables.length = 0;
    },
  };
}

/**
 * Global test context that persists across test files
 */
let globalContext: SetupContext | null = null;

/**
 * Get or create the global test context
 */
export function getGlobalContext(): SetupContext {
  if (!globalContext) {
    globalContext = createSetupContext();
  }
  return globalContext;
}

/**
 * Reset the global test context
 */
export async function resetGlobalContext(): Promise<void> {
  if (globalContext) {
    await globalContext.runCleanup();
    globalContext = null;
  }
}

/**
 * Test environment configuration
 */
export interface TestEnvironmentConfig {
  /**
   * Reset all mocks before each test
   */
  resetMocks?: boolean;

  /**
   * Use fake timers
   */
  fakeTimers?: boolean;

  /**
   * Initial fake time
   */
  initialTime?: Date | number;

  /**
   * Environment variables to set
   */
  env?: Record<string, string>;

  /**
   * Suppress console output during tests
   */
  suppressConsole?: boolean | ('log' | 'warn' | 'error' | 'info')[];

  /**
   * Timeout for async operations
   */
  timeout?: number;
}

/**
 * Configure test environment with standard settings
 *
 * @example
 * configureTestEnvironment({
 *   resetMocks: true,
 *   fakeTimers: true,
 *   suppressConsole: ['log', 'warn'],
 * });
 */
export function configureTestEnvironment(config: TestEnvironmentConfig = {}): void {
  const {
    resetMocks = true,
    fakeTimers = false,
    initialTime,
    env = {},
    suppressConsole = false,
  } = config;

  const originalEnv: Record<string, string | undefined> = {};
  const originalConsole: Partial<Console> = {};

  beforeAll(() => {
    // Set environment variables
    for (const [key, value] of Object.entries(env)) {
      originalEnv[key] = process.env[key];
      process.env[key] = value;
    }

    // Suppress console
    if (suppressConsole) {
      const methods = suppressConsole === true
        ? ['log', 'warn', 'error', 'info'] as const
        : suppressConsole;

      for (const method of methods) {
        originalConsole[method] = console[method];
        console[method] = vi.fn();
      }
    }
  });

  afterAll(() => {
    // Restore environment variables
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Restore console
    for (const [method, original] of Object.entries(originalConsole)) {
      if (original) {
        (console as unknown as Record<string, unknown>)[method] = original;
      }
    }
  });

  beforeEach(() => {
    if (resetMocks) {
      vi.clearAllMocks();
    }

    if (fakeTimers) {
      vi.useFakeTimers();
      if (initialTime) {
        vi.setSystemTime(initialTime);
      }
    }
  });

  afterEach(() => {
    if (fakeTimers) {
      vi.useRealTimers();
    }

    vi.restoreAllMocks();
  });
}

/**
 * Create a test suite with automatic setup/teardown
 *
 * @example
 * const { beforeEachTest, afterEachTest, getContext } = createTestSuite({
 *   resetMocks: true,
 * });
 */
export function createTestSuite(config: TestEnvironmentConfig = {}): TestSuiteHelpers {
  const context = createSetupContext();

  configureTestEnvironment(config);

  return {
    beforeEachTest: (fn: (ctx: SetupContext) => void | Promise<void>) => {
      beforeEach(async () => {
        await fn(context);
      });
    },

    afterEachTest: (fn: (ctx: SetupContext) => void | Promise<void>) => {
      afterEach(async () => {
        await fn(context);
        await context.runCleanup();
      });
    },

    getContext: () => context,
  };
}

/**
 * Test suite helpers interface
 */
export interface TestSuiteHelpers {
  beforeEachTest: (fn: (ctx: SetupContext) => void | Promise<void>) => void;
  afterEachTest: (fn: (ctx: SetupContext) => void | Promise<void>) => void;
  getContext: () => SetupContext;
}

/**
 * Create isolated test scope
 *
 * @example
 * const scope = createTestScope();
 * scope.addMock(mockService);
 * await scope.run(async () => {
 *   // test code
 * });
 */
export function createTestScope(): TestScope {
  const mocks: ReturnType<typeof vi.fn>[] = [];
  const cleanups: CleanupFunction[] = [];

  return {
    addMock<T extends ReturnType<typeof vi.fn>>(mock: T): T {
      mocks.push(mock);
      return mock;
    },

    addCleanup(cleanup: CleanupFunction): void {
      cleanups.push(cleanup);
    },

    async run<T>(fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } finally {
        // Clear all mocks
        for (const mock of mocks) {
          mock.mockClear();
        }

        // Run cleanups
        for (const cleanup of cleanups.reverse()) {
          await cleanup();
        }
      }
    },

    clear(): void {
      for (const mock of mocks) {
        mock.mockClear();
      }
    },

    reset(): void {
      for (const mock of mocks) {
        mock.mockReset();
      }
    },
  };
}

/**
 * Test scope interface
 */
export interface TestScope {
  addMock<T extends ReturnType<typeof vi.fn>>(mock: T): T;
  addCleanup(cleanup: CleanupFunction): void;
  run<T>(fn: () => Promise<T>): Promise<T>;
  clear(): void;
  reset(): void;
}

/**
 * Database test helper for memory/agentdb testing
 */
export interface DatabaseTestHelper {
  setup(): Promise<void>;
  teardown(): Promise<void>;
  clear(): Promise<void>;
  seed(data: Record<string, unknown[]>): Promise<void>;
}

/**
 * Create in-memory database helper for testing
 *
 * @example
 * const db = createInMemoryDatabaseHelper();
 * await db.setup();
 * await db.seed({ users: [{ id: 1, name: 'Test' }] });
 * // ... run tests
 * await db.teardown();
 */
export function createInMemoryDatabaseHelper(): DatabaseTestHelper {
  const data = new Map<string, unknown[]>();

  return {
    async setup(): Promise<void> {
      data.clear();
    },

    async teardown(): Promise<void> {
      data.clear();
    },

    async clear(): Promise<void> {
      data.clear();
    },

    async seed(seedData: Record<string, unknown[]>): Promise<void> {
      for (const [table, records] of Object.entries(seedData)) {
        data.set(table, [...records]);
      }
    },
  };
}

/**
 * Network test helper for mocking HTTP/WebSocket
 */
export interface NetworkTestHelper {
  mockFetch(responses: MockFetchResponse[]): void;
  mockWebSocket(handler: (message: unknown) => unknown): void;
  clearMocks(): void;
}

/**
 * Mock fetch response
 */
export interface MockFetchResponse {
  url: string | RegExp;
  method?: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delay?: number;
}

/**
 * Create network test helper
 *
 * @example
 * const network = createNetworkTestHelper();
 * network.mockFetch([
 *   { url: '/api/users', body: [{ id: 1 }] },
 * ]);
 */
export function createNetworkTestHelper(): NetworkTestHelper {
  const fetchResponses: MockFetchResponse[] = [];
  let originalFetch: typeof global.fetch;

  return {
    mockFetch(responses: MockFetchResponse[]): void {
      fetchResponses.push(...responses);

      if (!originalFetch) {
        originalFetch = global.fetch;

        global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          const method = init?.method ?? 'GET';

          const match = fetchResponses.find(r => {
            const urlMatch = typeof r.url === 'string'
              ? url.includes(r.url)
              : r.url.test(url);
            const methodMatch = !r.method || r.method === method;
            return urlMatch && methodMatch;
          });

          if (!match) {
            throw new Error(`No mock found for ${method} ${url}`);
          }

          if (match.delay) {
            await new Promise(resolve => setTimeout(resolve, match.delay));
          }

          return new Response(JSON.stringify(match.body), {
            status: match.status ?? 200,
            headers: match.headers ?? { 'Content-Type': 'application/json' },
          });
        });
      }
    },

    mockWebSocket(handler: (message: unknown) => unknown): void {
      // WebSocket mocking would require more setup
      // This is a placeholder for the interface
      console.warn('WebSocket mocking not yet implemented');
    },

    clearMocks(): void {
      fetchResponses.length = 0;
      if (originalFetch) {
        global.fetch = originalFetch;
      }
    },
  };
}

/**
 * File system test helper
 */
export interface FileSystemTestHelper {
  createTempDir(): Promise<string>;
  createFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  cleanup(): Promise<void>;
}

/**
 * Create in-memory file system helper
 *
 * @example
 * const fs = createInMemoryFileSystemHelper();
 * await fs.createFile('/test.txt', 'content');
 * const content = await fs.readFile('/test.txt');
 */
export function createInMemoryFileSystemHelper(): FileSystemTestHelper {
  const files = new Map<string, string>();
  const tempDirs: string[] = [];

  return {
    async createTempDir(): Promise<string> {
      const dir = `/tmp/test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      tempDirs.push(dir);
      return dir;
    },

    async createFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },

    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    },

    async cleanup(): Promise<void> {
      files.clear();
      tempDirs.length = 0;
    },
  };
}

/**
 * Performance test helper
 */
export interface PerformanceTestHelper {
  startMeasurement(name: string): void;
  endMeasurement(name: string): number;
  getMeasurements(): Record<string, number[]>;
  getStats(name: string): { min: number; max: number; avg: number; p95: number };
  clear(): void;
}

/**
 * Create performance test helper
 *
 * @example
 * const perf = createPerformanceTestHelper();
 * perf.startMeasurement('search');
 * await search();
 * const duration = perf.endMeasurement('search');
 */
export function createPerformanceTestHelper(): PerformanceTestHelper {
  const measurements = new Map<string, number[]>();
  const starts = new Map<string, number>();

  return {
    startMeasurement(name: string): void {
      starts.set(name, performance.now());
    },

    endMeasurement(name: string): number {
      const start = starts.get(name);
      if (start === undefined) {
        throw new Error(`No measurement started for: ${name}`);
      }

      const duration = performance.now() - start;
      starts.delete(name);

      if (!measurements.has(name)) {
        measurements.set(name, []);
      }
      measurements.get(name)!.push(duration);

      return duration;
    },

    getMeasurements(): Record<string, number[]> {
      return Object.fromEntries(measurements);
    },

    getStats(name: string): { min: number; max: number; avg: number; p95: number } {
      const values = measurements.get(name);
      if (!values || values.length === 0) {
        return { min: 0, max: 0, avg: 0, p95: 0 };
      }

      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);

      return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / sorted.length,
        p95: sorted[Math.floor(sorted.length * 0.95)],
      };
    },

    clear(): void {
      measurements.clear();
      starts.clear();
    },
  };
}

/**
 * Standard V3 test setup
 *
 * @example
 * // In your test file:
 * setupV3Tests();
 *
 * describe('MyModule', () => {
 *   // tests...
 * });
 */
export function setupV3Tests(config: V3TestConfig = {}): void {
  configureTestEnvironment({
    resetMocks: true,
    suppressConsole: config.suppressConsole ?? false,
    env: {
      NODE_ENV: 'test',
      CLAUDE_FLOW_MODE: 'test',
      ...config.env,
    },
  });
}

/**
 * V3 test configuration
 */
export interface V3TestConfig {
  suppressConsole?: boolean | ('log' | 'warn' | 'error' | 'info')[];
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Wait for all pending promises to resolve
 *
 * @example
 * await flushPromises();
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Run with timeout
 *
 * @example
 * await withTimeout(async () => {
 *   await longRunningOperation();
 * }, 5000);
 */
export async function withTestTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}
