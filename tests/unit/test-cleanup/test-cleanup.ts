/**
 * Test Cleanup Utilities for Issue #120
 * Comprehensive async operation cleanup patterns for reliable testing
 */

export interface CleanupStats {
  timers: number;
  intervals: number;
  promises: number;
  abortControllers: number;
  eventListeners: number;
  openHandles: number;
}

export class TestCleanup {
  private timers = new Set<number>();
  private intervals = new Set<number>();
  private promises = new Set<Promise<unknown>>();
  private abortControllers = new Set<AbortController>();
  private eventListeners = new Map<EventTarget, Array<{ event: string; listener: EventListener }>>();
  private openHandles = new Set<{ close?: () => void | Promise<void>; destroy?: () => void | Promise<void> }>();

  /**
   * Register a timeout for automatic cleanup
   */
  setTimeout(callback: (...args: unknown[]) => void, ms: number): number {
    const id = globalThis.setTimeout(callback, ms);
    this.timers.add(id);
    return id;
  }

  /**
   * Register an interval for automatic cleanup
   */
  setInterval(callback: (...args: unknown[]) => void, ms: number): number {
    const id = globalThis.setInterval(callback, ms);
    this.intervals.add(id);
    return id;
  }

  /**
   * Register a promise for tracking and cleanup
   */
  registerPromise<T>(promise: Promise<T>): Promise<T> {
    this.promises.add(promise);
    
    // Remove from tracking when settled
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
   * Register an event listener for cleanup
   */
  registerEventListener(
    target: EventTarget,
    event: string,
    listener: EventListener
  ): void {
    target.addEventListener(event, listener);
    
    if (!this.eventListeners.has(target)) {
      this.eventListeners.set(target, []);
    }
    this.eventListeners.get(target)!.push({ event, listener });
  }

  /**
   * Register a handle (file, stream, etc.) for cleanup
   */
  registerHandle(handle: { close?: () => void | Promise<void>; destroy?: () => void | Promise<void> }): typeof handle {
    this.openHandles.add(handle);
    return handle;
  }

  /**
   * Create a promise with timeout that auto-registers for cleanup
   */
  createTimeoutPromise<T>(
    executor: (resolve: (value: T) => void, reject: (reason?: Error) => void) => void,
    timeoutMs: number,
    timeoutMessage?: string
  ): Promise<T> {
    return this.registerPromise(
      new Promise<T>((resolve, reject) => {
        const timer = this.setTimeout(() => {
          reject(new Error(timeoutMessage || `Promise timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        executor(
          (value: T) => {
            globalThis.clearTimeout(timer);
            this.timers.delete(timer);
            resolve(value);
          },
          (reason?: Error) => {
            globalThis.clearTimeout(timer);
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
  async waitForPromises(timeoutMs = 5000): Promise<void> {
    if (this.promises.size === 0) return;

    const allPromises = Array.from(this.promises);
    
    try {
      await Promise.race([
        Promise.allSettled(allPromises),
        new Promise((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error(`Promises did not settle within ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    } catch (_error) {
      console.warn(`Warning: ${this.promises.size} promises did not settle within ${timeoutMs}ms`);
    }
  }

  /**
   * Get current cleanup statistics
   */
  getStats(): CleanupStats {
    return {
      timers: this.timers.size,
      intervals: this.intervals.size,
      promises: this.promises.size,
      abortControllers: this.abortControllers.size,
      eventListeners: Array.from(this.eventListeners.values()).reduce((sum, listeners) => sum + listeners.length, 0),
      openHandles: this.openHandles.size,
    };
  }

  /**
   * Force garbage collection if available
   */
  private forceGC(): void {
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }
  }

  /**
   * Perform complete cleanup of all registered resources
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    // Clear all timers
    for (const id of this.timers) {
      try {
        globalThis.clearTimeout(id);
      } catch (error) {
        errors.push(error as Error);
      }
    }
    this.timers.clear();

    // Clear all intervals
    for (const id of this.intervals) {
      try {
        globalThis.clearInterval(id);
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

    // Close all handles
    for (const handle of this.openHandles) {
      try {
        if (handle.close) {
          await handle.close();
        } else if (handle.destroy) {
          await handle.destroy();
        }
      } catch (error) {
        errors.push(error as Error);
      }
    }
    this.openHandles.clear();

    // Wait for promises to settle
    await this.waitForPromises();

    // Force garbage collection
    this.forceGC();

    // Report any errors encountered during cleanup
    if (errors.length > 0) {
      console.warn(`TestCleanup encountered ${errors.length} errors during cleanup:`, errors);
    }
  }
}

/**
 * Async testing utilities with automatic cleanup integration
 */
export class AsyncTestUtils {
  private static cleanup = new TestCleanup();

  static getCleanup(): TestCleanup {
    return this.cleanup;
  }

  static resetCleanup(): void {
    this.cleanup = new TestCleanup();
  }

  /**
   * Wait for a condition to become true with timeout
   */
  static waitFor(
    condition: () => boolean,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    const { timeout = 5000, interval = 100 } = options;
    
    return this.cleanup.createTimeoutPromise<void>(
      (resolve, reject) => {
        const checkCondition = () => {
          if (condition()) {
            resolve();
          } else {
            this.cleanup.setTimeout(checkCondition, interval);
          }
        };
        checkCondition();
      },
      timeout,
      `Condition not met (timeout: ${timeout}ms)`
    );
  }

  /**
   * Delay execution for specified milliseconds
   */
  static delay(ms: number): Promise<void> {
    return this.cleanup.createTimeoutPromise<void>(
      (resolve) => {
        this.cleanup.setTimeout(() => resolve(), ms);
      },
      ms + 1000 // Add buffer for timeout
    );
  }

  /**
   * Add timeout to any promise
   */
  static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        this.cleanup.setTimeout(() => {
          reject(new Error('Promise timed out'));
        }, timeoutMs);
      })
    ]);
  }
}

/**
 * Test assertions with async support
 */
export class TestAssertions {
  /**
   * Assert that an async function throws an error
   */
  static async assertThrowsAsync(
    fn: () => Promise<unknown>,
    expectedMessage?: string
  ): Promise<void> {
    let threwError = false;
    try {
      await fn();
    } catch (error) {
      threwError = true;
      if (expectedMessage && (error as Error).message !== expectedMessage) {
        throw new Error(`Expected error message "${expectedMessage}", got "${(error as Error).message}"`);
      }
    }
    
    if (!threwError) {
      throw new Error('Expected function to throw an error');
    }
  }

  /**
   * Assert that a promise completes within the specified time
   */
  static async assertCompletesWithin<T>(
    promiseFactory: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return AsyncTestUtils.withTimeout(promiseFactory(), timeoutMs);
  }

  /**
   * Assert that a value is within a numeric range
   */
  static assertInRange(value: number, min: number, max: number): void {
    if (value < min || value > max) {
      throw new Error(`Expected ${value} to be between ${min} and ${max}`);
    }
  }
}