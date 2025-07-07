/**
 * Comprehensive Test Cleanup Patterns for Claude-Flow
 * Addresses Issue #120 - Pending promise errors and timer cleanup
 * 
 * Based on @mikkihugo's analysis for consistent test utilities
 */

/**
 * Standardized cleanup for all async operations
 * Prevents pending promise errors and timer leaks
 */
export class TestCleanup {
  private timers = new Set<NodeJS.Timeout>();
  private intervals = new Set<NodeJS.Timeout>();
  private promises = new Set<Promise<any>>();
  private abortControllers = new Set<AbortController>();
  private eventListeners = new Map<EventTarget, Array<{ event: string; listener: EventListener }>>();
  private openHandles = new Set<any>();

  /**
   * Register a timer for cleanup
   */
  registerTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
    this.timers.add(timer);
    return timer;
  }

  /**
   * Register an interval for cleanup
   */
  registerInterval(interval: NodeJS.Timeout): NodeJS.Timeout {
    this.intervals.add(interval);
    return interval;
  }

  /**
   * Register a promise for tracking
   */
  registerPromise<T>(promise: Promise<T>): Promise<T> {
    this.promises.add(promise);
    // Auto-remove when settled
    promise.finally(() => {
      this.promises.delete(promise);
    });
    return promise;
  }

  /**
   * Register an AbortController for cleanup
   */
  registerAbortController(controller: AbortController): AbortController {
    this.abortControllers.add(controller);
    return controller;
  }

  /**
   * Register event listener for cleanup
   */
  registerEventListener(target: EventTarget, event: string, listener: EventListener): void {
    if (!this.eventListeners.has(target)) {
      this.eventListeners.set(target, []);
    }
    this.eventListeners.get(target)!.push({ event, listener });
    target.addEventListener(event, listener);
  }

  /**
   * Register any handle that needs cleanup
   */
  registerHandle(handle: any): any {
    this.openHandles.add(handle);
    return handle;
  }

  /**
   * Create a timeout with automatic cleanup registration
   */
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    return this.registerTimer(timer);
  }

  /**
   * Create an interval with automatic cleanup registration
   */
  setInterval(callback: () => void, delay: number): NodeJS.Timeout {
    const interval = setInterval(callback, delay);
    return this.registerInterval(interval);
  }

  /**
   * Create a promise with timeout and automatic cleanup
   */
  createTimeoutPromise<T>(
    executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void,
    timeoutMs: number,
    timeoutMessage?: string
  ): Promise<T> {
    return this.registerPromise(
      new Promise<T>((resolve, reject) => {
        const timer = this.setTimeout(() => {
          reject(new Error(timeoutMessage || `Promise timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        executor(
          (value) => {
            clearTimeout(timer);
            this.timers.delete(timer);
            resolve(value);
          },
          (reason) => {
            clearTimeout(timer);
            this.timers.delete(timer);
            reject(reason);
          }
        );
      })
    );
  }

  /**
   * Wait for all registered promises to settle
   */
  async waitForPromises(timeoutMs: number = 5000): Promise<void> {
    if (this.promises.size === 0) return;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout waiting for ${this.promises.size} promises to settle`));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        Promise.allSettled([...this.promises]),
        timeoutPromise
      ]);
    } catch (error) {
      console.warn(`Warning: ${this.promises.size} promises did not settle within ${timeoutMs}ms`);
    }
  }

  /**
   * Comprehensive cleanup of all registered resources
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    try {
      // Clear all timers
      for (const timer of this.timers) {
        try {
          clearTimeout(timer);
        } catch (error) {
          errors.push(error as Error);
        }
      }
      this.timers.clear();

      // Clear all intervals
      for (const interval of this.intervals) {
        try {
          clearInterval(interval);
        } catch (error) {
          errors.push(error as Error);
        }
      }
      this.intervals.clear();

      // Abort all controllers
      for (const controller of this.abortControllers) {
        try {
          if (!controller.signal.aborted) {
            controller.abort();
          }
        } catch (error) {
          errors.push(error as Error);
        }
      }
      this.abortControllers.clear();

      // Remove all event listeners
      for (const [target, listeners] of this.eventListeners) {
        for (const { event, listener } of listeners) {
          try {
            target.removeEventListener(event, listener);
          } catch (error) {
            errors.push(error as Error);
          }
        }
      }
      this.eventListeners.clear();

      // Clean up open handles
      for (const handle of this.openHandles) {
        try {
          if (handle && typeof handle.close === 'function') {
            handle.close();
          } else if (handle && typeof handle.destroy === 'function') {
            handle.destroy();
          } else if (handle && typeof handle.end === 'function') {
            handle.end();
          }
        } catch (error) {
          errors.push(error as Error);
        }
      }
      this.openHandles.clear();

      // Wait for promises to settle (with timeout)
      await this.waitForPromises();

    } finally {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Report any cleanup errors
      if (errors.length > 0) {
        console.warn(`TestCleanup encountered ${errors.length} errors during cleanup:`, errors);
      }
    }
  }

  /**
   * Get statistics about registered resources
   */
  getStats(): {
    timers: number;
    intervals: number;
    promises: number;
    abortControllers: number;
    eventListeners: number;
    openHandles: number;
  } {
    return {
      timers: this.timers.size,
      intervals: this.intervals.size,
      promises: this.promises.size,
      abortControllers: this.abortControllers.size,
      eventListeners: Array.from(this.eventListeners.values()).reduce((sum, listeners) => sum + listeners.length, 0),
      openHandles: this.openHandles.size
    };
  }
}

/**
 * Enhanced async test utilities with proper cleanup
 */
export class AsyncTestUtils {
  private static cleanup = new TestCleanup();

  /**
   * Get the current test cleanup instance
   */
  static getCleanup(): TestCleanup {
    return this.cleanup;
  }

  /**
   * Reset cleanup for new test
   */
  static resetCleanup(): void {
    this.cleanup = new TestCleanup();
  }

  /**
   * Wait for condition to be true with timeout and cleanup
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number; interval?: number; message?: string } = {}
  ): Promise<void> {
    const { timeout = 5000, interval = 100, message = 'Condition not met' } = options;
    const start = Date.now();

    return this.cleanup.createTimeoutPromise<void>(
      (resolve, reject) => {
        const checkCondition = async () => {
          try {
            if (Date.now() - start >= timeout) {
              reject(new Error(`${message} (timeout: ${timeout}ms)`));
              return;
            }

            if (await condition()) {
              resolve();
              return;
            }

            this.cleanup.setTimeout(checkCondition, interval);
          } catch (error) {
            reject(error);
          }
        };

        checkCondition();
      },
      timeout + 1000, // Give extra time for the timeout logic
      message
    );
  }

  /**
   * Wait with proper cleanup registration
   */
  static async delay(ms: number): Promise<void> {
    return this.cleanup.createTimeoutPromise<void>(
      (resolve) => {
        this.cleanup.setTimeout(resolve, ms);
      },
      ms + 1000
    );
  }

  /**
   * Race a promise against a timeout with cleanup
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message?: string
  ): Promise<T> {
    return this.cleanup.createTimeoutPromise<T>(
      (resolve, reject) => {
        promise.then(resolve).catch(reject);
      },
      timeoutMs,
      message
    );
  }
}

/**
 * Test assertions with better error messages
 */
export class TestAssertions {
  /**
   * Assert that a promise throws with timeout
   */
  static async assertThrowsAsync<T>(
    fn: () => Promise<T>,
    expectedError?: string | RegExp | typeof Error,
    message?: string
  ): Promise<void> {
    try {
      await AsyncTestUtils.withTimeout(fn(), 5000, 'Test assertion timeout');
      throw new Error(message || 'Expected function to throw, but it did not');
    } catch (error) {
      if (expectedError) {
        if (typeof expectedError === 'string') {
          if (!(error as Error).message.includes(expectedError)) {
            throw new Error(`Expected error message to contain "${expectedError}", but got: ${(error as Error).message}`);
          }
        } else if (expectedError instanceof RegExp) {
          if (!expectedError.test((error as Error).message)) {
            throw new Error(`Expected error message to match ${expectedError}, but got: ${(error as Error).message}`);
          }
        } else if (expectedError.prototype instanceof Error) {
          if (!(error instanceof expectedError)) {
            throw new Error(`Expected error to be instance of ${expectedError.name}, but got: ${error.constructor.name}`);
          }
        }
      }
    }
  }

  /**
   * Assert that operation completes within time limit
   */
  static async assertCompletesWithin<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    message?: string
  ): Promise<T> {
    return AsyncTestUtils.withTimeout(
      operation(),
      timeoutMs,
      message || `Operation should complete within ${timeoutMs}ms`
    );
  }

  /**
   * Assert value is within range
   */
  static assertInRange(value: number, min: number, max: number, message?: string): void {
    if (value < min || value > max) {
      throw new Error(message || `Expected ${value} to be between ${min} and ${max}`);
    }
  }
}