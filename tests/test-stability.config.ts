/**
 * Test Stability Configuration
 * Central configuration for test timeouts, retries, and stability settings
 */

export const TEST_STABILITY_CONFIG = {
  // Default timeouts for different test types
  timeouts: {
    unit: 5000,
    integration: 15000,
    e2e: 30000,
    performance: 60000,
    default: 10000,
  },

  // Retry configuration for flaky tests
  retry: {
    maxAttempts: process.env.CI === 'true' ? 3 : 1,
    backoffMultiplier: 2,
    initialDelay: 100,
    maxDelay: 5000,
  },

  // Resource cleanup settings
  cleanup: {
    gracePeriodMs: 100,
    forceCleanupAfterMs: 5000,
    enableGarbageCollection: true,
  },

  // Async operation settings
  async: {
    defaultPollInterval: 50,
    defaultStabilizationTime: 200,
    promiseFlushCycles: 2,
  },

  // Database test settings
  database: {
    connectionTimeout: 5000,
    queryTimeout: 3000,
    cleanupTimeout: 2000,
    retryableErrors: ['SQLITE_BUSY', 'SQLITE_LOCKED'],
  },

  // Terminal/process test settings
  terminal: {
    startupTimeout: 3000,
    commandTimeout: 5000,
    shutdownTimeout: 2000,
    outputStabilizationTime: 100,
  },

  // Event handling settings
  events: {
    defaultTimeout: 5000,
    debounceTime: 100,
    maxListeners: 100,
  },

  // Memory leak detection
  memoryLeaks: {
    enabled: process.env.DETECT_MEMORY_LEAKS === 'true',
    threshold: 50 * 1024 * 1024, // 50MB
    gcBeforeCheck: true,
  },

  // Parallel execution settings
  parallel: {
    maxWorkers: process.env.CI === 'true' ? 2 : 4,
    isolateTests: true,
    shareGlobalState: false,
  },
};

/**
 * Get timeout for a specific test type
 */
export function getTestTimeout(type: keyof typeof TEST_STABILITY_CONFIG.timeouts): number {
  return TEST_STABILITY_CONFIG.timeouts[type] || TEST_STABILITY_CONFIG.timeouts.default;
}

/**
 * Apply stability configuration to a test suite
 */
export function configureTestSuite(
  type: keyof typeof TEST_STABILITY_CONFIG.timeouts = 'default'
): void {
  const timeout = getTestTimeout(type);
  
  // Set Jest timeout
  jest.setTimeout(timeout);
  
  // Configure retry behavior
  if (TEST_STABILITY_CONFIG.retry.maxAttempts > 1) {
    jest.retryTimes(TEST_STABILITY_CONFIG.retry.maxAttempts - 1);
  }
  
  // Set up cleanup hooks
  afterEach(async () => {
    // Give async operations time to complete
    await new Promise(resolve => 
      setTimeout(resolve, TEST_STABILITY_CONFIG.cleanup.gracePeriodMs)
    );
    
    // Clear all timers
    jest.clearAllTimers();
    
    // Run garbage collection if available
    if (TEST_STABILITY_CONFIG.cleanup.enableGarbageCollection && global.gc) {
      global.gc();
    }
  });
}

/**
 * Mark a test as potentially flaky with automatic retries
 */
export function flakyTest(
  name: string,
  fn: () => void | Promise<void>,
  options: {
    maxRetries?: number;
    timeout?: number;
  } = {}
): void {
  const maxRetries = options.maxRetries || TEST_STABILITY_CONFIG.retry.maxAttempts;
  const timeout = options.timeout || TEST_STABILITY_CONFIG.timeouts.default;
  
  it(name, async () => {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await Promise.race([
          Promise.resolve(fn()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout)
          )
        ]);
        
        // Test passed
        return;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.warn(`Test "${name}" failed on attempt ${attempt}, retrying...`);
          
          // Exponential backoff
          const delay = TEST_STABILITY_CONFIG.retry.initialDelay * 
            Math.pow(TEST_STABILITY_CONFIG.retry.backoffMultiplier, attempt - 1);
          
          await new Promise(resolve => setTimeout(resolve, Math.min(delay, TEST_STABILITY_CONFIG.retry.maxDelay)));
        }
      }
    }
    
    // All retries failed
    throw lastError;
  }, timeout);
}

/**
 * Skip test in CI if it's known to be flaky
 */
export function skipInCI(reason: string): void {
  if (process.env.CI === 'true') {
    it.skip(`Skipped in CI: ${reason}`, () => {});
  }
}

/**
 * Run test only in CI environment
 */
export function ciOnly(name: string, fn: () => void | Promise<void>): void {
  if (process.env.CI === 'true') {
    it(name, fn);
  } else {
    it.skip(`${name} (CI only)`, () => {});
  }
}

/**
 * Create a test environment with automatic cleanup
 */
export class TestEnvironment {
  private cleanupFunctions: Array<() => void | Promise<void>> = [];
  private resources = new Map<string, any>();

  /**
   * Register a cleanup function
   */
  onCleanup(fn: () => void | Promise<void>): void {
    this.cleanupFunctions.push(fn);
  }

  /**
   * Store a resource for later cleanup
   */
  setResource(key: string, resource: any, cleanup?: () => void | Promise<void>): void {
    this.resources.set(key, resource);
    if (cleanup) {
      this.onCleanup(cleanup);
    }
  }

  /**
   * Get a stored resource
   */
  getResource<T>(key: string): T | undefined {
    return this.resources.get(key);
  }

  /**
   * Clean up all registered resources
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];
    
    // Run cleanup functions in reverse order
    for (const fn of this.cleanupFunctions.reverse()) {
      try {
        await Promise.race([
          Promise.resolve(fn()),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Cleanup timeout')),
              TEST_STABILITY_CONFIG.cleanup.forceCleanupAfterMs
            )
          )
        ]);
      } catch (error) {
        errors.push(error as Error);
      }
    }
    
    // Clear resources
    this.resources.clear();
    this.cleanupFunctions = [];
    
    // Throw aggregated error if any cleanup failed
    if (errors.length > 0) {
      throw new Error(`Cleanup failed: ${errors.map(e => e.message).join(', ')}`);
    }
  }
}

// Export a singleton instance for global test environment
export const globalTestEnv = new TestEnvironment();

// Ensure cleanup on test suite completion
afterAll(async () => {
  await globalTestEnv.cleanup();
});