/**
 * Comprehensive Test Cleanup & Performance Utilities (#120)
 *
 * Implements standardized resource tracking, timeout wrappers, and performance
 * measurement utilities from @mikkihugo's test analysis (PR #44):
 * - Prevents unhandled timer warnings and dangling promises in test teardown
 * - Provides deterministic timeout wrappers for async operations
 * - Implements PerformanceTestUtils for latency benchmarking and budget assertions
 */

export type TimerId = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
export type CleanupHook = () => void | Promise<void>;

export interface BenchmarkStats {
  name: string;
  iterations: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p95Ms: number;
  totalMs: number;
}

export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly operationName: string;

  constructor(operationName: string, timeoutMs: number) {
    super(`Operation "${operationName}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
  }
}

export class TestCleanup {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private readonly promises = new Set<Promise<unknown>>();
  private readonly disposables: CleanupHook[] = [];

  /**
   * Register an active timeout handle so it is automatically cleared on cleanup().
   */
  registerTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
    this.timers.add(timer);
    return timer;
  }

  /**
   * Register an active interval handle so it is automatically cleared on cleanup().
   */
  registerInterval<T extends ReturnType<typeof setInterval>>(interval: T): T {
    this.intervals.add(interval);
    return interval;
  }

  /**
   * Register an in-flight promise so cleanup() awaits its settlement before teardown completes.
   */
  registerPromise<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.finally(() => {
      this.promises.delete(tracked);
    });
    this.promises.add(tracked);
    // Attach no-op catch to tracked reference so settled rejections do not trigger unhandledRejection
    tracked.catch(() => {});
    return promise;
  }

  /**
   * Register a custom synchronous or asynchronous teardown callback (LIFO order).
   */
  registerDisposable(fn: CleanupHook): void {
    this.disposables.push(fn);
  }

  /**
   * Convenience wrapper that creates and registers a timeout in one step.
   */
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      callback();
    }, ms);
    return this.registerTimer(handle);
  }

  /**
   * Convenience wrapper that creates and registers an interval in one step.
   */
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval> {
    const handle = setInterval(callback, ms);
    return this.registerInterval(handle);
  }

  /**
   * Wrap an async operation with a deterministic timeout that cleans up its timer immediately on settlement.
   */
  async withTimeout<T>(
    operation: () => Promise<T> | T,
    timeoutMs: number,
    operationName = 'async operation',
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = this.setTimeout(() => {
        reject(new TimeoutError(operationName, timeoutMs));
      }, timeoutMs);
    });

    const taskPromise = Promise.resolve().then(operation);
    this.registerPromise(taskPromise);

    try {
      return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        this.timers.delete(timeoutHandle);
      }
    }
  }

  /**
   * Return current counts of tracked resources for diagnostics/assertions.
   */
  getStats(): { timers: number; intervals: number; promises: number; disposables: number } {
    return {
      timers: this.timers.size,
      intervals: this.intervals.size,
      promises: this.promises.size,
      disposables: this.disposables.length,
    };
  }

  /**
   * Clear all timers/intervals, await all pending promises via Promise.allSettled,
   * and run all registered disposable callbacks in reverse registration order.
   */
  async cleanup(): Promise<PromiseSettledResult<unknown>[]> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();

    const pending = [...this.promises];
    this.promises.clear();
    const settled = await Promise.allSettled(pending);

    const hooks = this.disposables.splice(0, this.disposables.length).reverse();
    for (const hook of hooks) {
      try {
        await hook();
      } catch {
        // Ensure all remaining disposables still run during teardown
      }
    }

    return settled;
  }
}

export class PerformanceTestUtils {
  /**
   * Measure wall-clock execution duration (ms) of a sync or async function.
   */
  static async measureAsync<T>(fn: () => Promise<T> | T): Promise<{ result: T; durationMs: number }> {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    return { result, durationMs };
  }

  /**
   * Assert that an operation completes within maxBudgetMs (and finishes before a hard timeout).
   */
  static async assertWithinBudget<T>(
    fn: () => Promise<T> | T,
    maxBudgetMs: number,
    label = 'operation',
  ): Promise<{ result: T; durationMs: number }> {
    const cleanup = new TestCleanup();
    try {
      const { result, durationMs } = await cleanup.withTimeout(
        () => PerformanceTestUtils.measureAsync(fn),
        Math.max(maxBudgetMs * 4, maxBudgetMs + 250),
        label,
      );
      if (durationMs > maxBudgetMs) {
        throw new Error(
          `Performance budget exceeded for "${label}": took ${durationMs.toFixed(2)}ms (budget: ${maxBudgetMs}ms)`,
        );
      }
      return { result, durationMs };
    } finally {
      await cleanup.cleanup();
    }
  }

  /**
   * Run an operation over multiple iterations and compute summary latency statistics.
   */
  static async benchmark(
    name: string,
    fn: (iteration: number) => Promise<unknown> | unknown,
    options: { iterations?: number; warmupIterations?: number } = {},
  ): Promise<BenchmarkStats> {
    const iterations = Math.max(1, options.iterations ?? 10);
    const warmup = Math.max(0, options.warmupIterations ?? 1);

    for (let i = 0; i < warmup; i++) {
      await fn(i);
    }

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await PerformanceTestUtils.measureAsync(() => fn(i));
      samples.push(durationMs);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const totalMs = samples.reduce((acc, v) => acc + v, 0);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

    return {
      name,
      iterations,
      minMs: sorted[0]!,
      maxMs: sorted[sorted.length - 1]!,
      meanMs: totalMs / iterations,
      p95Ms: sorted[p95Idx]!,
      totalMs,
    };
  }
}

/**
 * Helper to create a per-test TestCleanup instance suitable for beforeEach/afterEach hooks.
 */
export function createTestCleanupScope(): {
  cleanup: TestCleanup;
  teardown: () => Promise<void>;
} {
  const cleanup = new TestCleanup();
  return {
    cleanup,
    teardown: async () => {
      await cleanup.cleanup();
    },
  };
}
