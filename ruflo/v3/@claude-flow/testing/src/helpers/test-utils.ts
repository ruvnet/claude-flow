/**
 * @claude-flow/testing - Test Utilities
 *
 * Common test utilities for async operations, timing, retries, and more.
 * Designed for robust V3 module testing.
 */
import { vi } from 'vitest';

/**
 * Wait for a condition to be true with timeout
 *
 * @example
 * await waitFor(() => element.isVisible(), { timeout: 5000 });
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: WaitForOptions = {}
): Promise<T> {
  const {
    timeout = 5000,
    interval = 50,
    timeoutMessage = 'Condition not met within timeout',
  } = options;

  const startTime = Date.now();

  while (true) {
    try {
      const result = await condition();
      if (result) {
        return result;
      }
    } catch (error) {
      // Condition threw, continue waiting
    }

    if (Date.now() - startTime >= timeout) {
      throw new Error(timeoutMessage);
    }

    await sleep(interval);
  }
}

/**
 * Options for waitFor utility
 */
export interface WaitForOptions {
  timeout?: number;
  interval?: number;
  timeoutMessage?: string;
}

/**
 * Wait until a value changes
 *
 * @example
 * await waitUntilChanged(() => counter.value, { from: 0 });
 */
export async function waitUntilChanged<T>(
  getValue: () => T | Promise<T>,
  options: WaitUntilChangedOptions<T> = {}
): Promise<T> {
  const { from, timeout = 5000, interval = 50 } = options;
  const initialValue = from ?? await getValue();
  const startTime = Date.now();

  while (true) {
    const currentValue = await getValue();
    if (currentValue !== initialValue) {
      return currentValue;
    }

    if (Date.now() - startTime >= timeout) {
      throw new Error(`Value did not change from ${String(initialValue)} within timeout`);
    }

    await sleep(interval);
  }
}

/**
 * Options for waitUntilChanged utility
 */
export interface WaitUntilChangedOptions<T> {
  from?: T;
  timeout?: number;
  interval?: number;
}

/**
 * Retry an operation with exponential backoff
 *
 * @example
 * const result = await retry(
 *   async () => await fetchData(),
 *   { maxAttempts: 3, backoff: 100 }
 * );
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    backoff = 100,
    maxBackoff = 10000,
    exponential = true,
    onError,
    shouldRetry = () => true,
  } = options;

  let lastError: Error | undefined;
  let currentBackoff = backoff;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      onError?.(lastError, attempt);

      await sleep(currentBackoff);

      if (exponential) {
        currentBackoff = Math.min(currentBackoff * 2, maxBackoff);
      }
    }
  }

  throw lastError;
}

/**
 * Options for retry utility
 */
export interface RetryOptions {
  maxAttempts?: number;
  backoff?: number;
  maxBackoff?: number;
  exponential?: boolean;
  onError?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Wrap an operation with a timeout
 *
 * @example
 * const result = await withTimeout(
 *   async () => await longRunningOperation(),
 *   5000
 * );
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMessage ?? `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Cleanup timer if operation completes first
    operation().finally(() => clearTimeout(timer));
  });

  return Promise.race([operation(), timeoutPromise]);
}

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Sleep for a specified duration
 *
 * @example
 * await sleep(1000); // Sleep for 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise that can be resolved/rejected externally
 *
 * @example
 * const deferred = createDeferred<string>();
 * setTimeout(() => deferred.resolve('done'), 1000);
 * const result = await deferred.promise;
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Deferred promise interface
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Run operations in parallel with concurrency limit
 *
 * @example
 * const results = await parallelLimit(
 *   items.map(item => () => processItem(item)),
 *   5 // max 5 concurrent operations
 * );
 */
export async function parallelLimit<T>(
  operations: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const operation of operations) {
    const promise = (async () => {
      const result = await operation();
      results.push(result);
    })();

    executing.add(promise);
    promise.finally(() => executing.delete(promise));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Measure execution time of an operation
 *
 * @example
 * const { result, duration } = await measureTime(async () => {
 *   return await expensiveOperation();
 * });
 */
export async function measureTime<T>(
  operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await operation();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Create a mock clock for time-dependent tests
 *
 * @example
 * const clock = createMockClock();
 * clock.install();
 * // ... tests with controlled time
 * clock.uninstall();
 */
export function createMockClock(): MockClock {
  let installed = false;
  let currentTime = Date.now();

  return {
    install() {
      if (installed) return;
      vi.useFakeTimers();
      vi.setSystemTime(currentTime);
      installed = true;
    },

    uninstall() {
      if (!installed) return;
      vi.useRealTimers();
      installed = false;
    },

    tick(ms: number) {
      if (!installed) {
        throw new Error('Clock not installed. Call install() first.');
      }
      currentTime += ms;
      vi.advanceTimersByTime(ms);
    },

    setTime(time: number | Date) {
      currentTime = typeof time === 'number' ? time : time.getTime();
      if (installed) {
        vi.setSystemTime(currentTime);
      }
    },

    getTime() {
      return currentTime;
    },

    runAllTimers() {
      if (!installed) {
        throw new Error('Clock not installed. Call install() first.');
      }
      vi.runAllTimers();
    },

    runPendingTimers() {
      if (!installed) {
        throw new Error('Clock not installed. Call install() first.');
      }
      vi.runOnlyPendingTimers();
    },
  };
}

/**
 * Mock clock interface
 */
export interface MockClock {
  install(): void;
  uninstall(): void;
  tick(ms: number): void;
  setTime(time: number | Date): void;
  getTime(): number;
  runAllTimers(): void;
  runPendingTimers(): void;
}

/**
 * Create an event emitter for testing
 *
 * @example
 * const emitter = createTestEmitter<{ message: string }>();
 * const handler = vi.fn();
 * emitter.on('message', handler);
 * emitter.emit('message', 'hello');
 */
export function createTestEmitter<T extends Record<string, unknown>>(): TestEmitter<T> {
  const listeners = new Map<keyof T, Set<(data: unknown) => void>>();

  return {
    on<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler as (data: unknown) => void);

      return () => {
        listeners.get(event)?.delete(handler as (data: unknown) => void);
      };
    },

    once<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void {
      const wrappedHandler = (data: T[K]) => {
        this.off(event, wrappedHandler);
        handler(data);
      };
      return this.on(event, wrappedHandler);
    },

    off<K extends keyof T>(event: K, handler: (data: T[K]) => void): void {
      listeners.get(event)?.delete(handler as (data: unknown) => void);
    },

    emit<K extends keyof T>(event: K, data: T[K]): void {
      listeners.get(event)?.forEach(handler => handler(data));
    },

    removeAllListeners(event?: keyof T): void {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    },

    listenerCount(event: keyof T): number {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

/**
 * Test emitter interface
 */
export interface TestEmitter<T extends Record<string, unknown>> {
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void;
  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void;
  off<K extends keyof T>(event: K, handler: (data: T[K]) => void): void;
  emit<K extends keyof T>(event: K, data: T[K]): void;
  removeAllListeners(event?: keyof T): void;
  listenerCount(event: keyof T): number;
}

/**
 * Create a test spy that records all calls
 *
 * @example
 * const spy = createCallSpy();
 * myFunction = spy.wrap(myFunction);
 * // ... use myFunction
 * expect(spy.calls).toHaveLength(3);
 */
export function createCallSpy<T extends (...args: unknown[]) => unknown>(): CallSpy<T> {
  const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error; timestamp: number }> = [];

  return {
    calls,

    wrap(fn: T): T {
      return ((...args: Parameters<T>) => {
        const call = { args, timestamp: Date.now() } as typeof calls[number];
        calls.push(call);

        try {
          const result = fn(...args);
          call.result = result as ReturnType<T>;
          return result;
        } catch (error) {
          call.error = error as Error;
          throw error;
        }
      }) as T;
    },

    clear() {
      calls.length = 0;
    },

    getLastCall() {
      return calls[calls.length - 1];
    },

    getCallCount() {
      return calls.length;
    },

    wasCalledWith(...args: Partial<Parameters<T>>): boolean {
      return calls.some(call =>
        args.every((arg, i) => arg === undefined || call.args[i] === arg)
      );
    },
  };
}

/**
 * Call spy interface
 */
export interface CallSpy<T extends (...args: unknown[]) => unknown> {
  calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error; timestamp: number }>;
  wrap(fn: T): T;
  clear(): void;
  getLastCall(): { args: Parameters<T>; result?: ReturnType<T>; error?: Error; timestamp: number } | undefined;
  getCallCount(): number;
  wasCalledWith(...args: Partial<Parameters<T>>): boolean;
}

/**
 * Create a mock stream for testing streaming operations
 *
 * @example
 * const stream = createMockStream(['chunk1', 'chunk2', 'chunk3']);
 * for await (const chunk of stream) {
 *   console.log(chunk);
 * }
 */
export function createMockStream<T>(
  chunks: T[],
  options: MockStreamOptions = {}
): AsyncIterable<T> {
  const { delayMs = 0, errorAt, errorMessage = 'Stream error' } = options;

  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < chunks.length; i++) {
        if (errorAt !== undefined && i === errorAt) {
          throw new Error(errorMessage);
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }

        yield chunks[i];
      }
    },
  };
}

/**
 * Mock stream options
 */
export interface MockStreamOptions {
  delayMs?: number;
  errorAt?: number;
  errorMessage?: string;
}

/**
 * Collect all items from an async iterable
 *
 * @example
 * const items = await collectStream(asyncGenerator());
 */
export async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

/**
 * Generate a unique ID for testing
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a test context that provides isolated test data
 *
 * @example
 * const ctx = createTestContext();
 * ctx.set('user', { id: 1, name: 'Test' });
 * const user = ctx.get('user');
 */
export function createTestContext(): TestContext {
  const data = new Map<string, unknown>();

  return {
    set<T>(key: string, value: T): void {
      data.set(key, value);
    },

    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },

    has(key: string): boolean {
      return data.has(key);
    },

    delete(key: string): boolean {
      return data.delete(key);
    },

    clear(): void {
      data.clear();
    },

    keys(): string[] {
      return Array.from(data.keys());
    },
  };
}

/**
 * Test context interface
 */
export interface TestContext {
  set<T>(key: string, value: T): void;
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
}

/**
 * Assert that a promise rejects with a specific error type
 *
 * @example
 * await expectToReject(
 *   async () => await riskyOperation(),
 *   ValidationError
 * );
 */
export async function expectToReject<T extends Error>(
  operation: () => Promise<unknown>,
  ErrorClass?: new (...args: unknown[]) => T
): Promise<T> {
  try {
    await operation();
    throw new Error('Expected operation to reject, but it resolved');
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw new Error(
        `Expected error to be instance of ${ErrorClass.name}, but got ${(error as Error).constructor.name}`
      );
    }
    return error as T;
  }
}

/**
 * Create a mock function with tracking capabilities
 */
export function createTrackedMock<T extends (...args: unknown[]) => unknown>(
  implementation?: T
): TrackedMock<T> {
  // Use type assertion to handle the optional implementation
  const mock = implementation ? vi.fn(implementation) : vi.fn();
  const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error; duration: number }> = [];

  const tracked = ((...args: Parameters<T>) => {
    const start = performance.now();
    const call: typeof calls[number] = { args, duration: 0 };
    calls.push(call);

    try {
      const result = mock(...args);
      call.result = result as ReturnType<T>;
      call.duration = performance.now() - start;
      return result;
    } catch (error) {
      call.error = error as Error;
      call.duration = performance.now() - start;
      throw error;
    }
  }) as TrackedMock<T>;

  Object.assign(tracked, {
    mock,
    calls,
    getAverageDuration: () => {
      if (calls.length === 0) return 0;
      return calls.reduce((sum, c) => sum + c.duration, 0) / calls.length;
    },
    getTotalDuration: () => calls.reduce((sum, c) => sum + c.duration, 0),
    getErrors: () => calls.filter(c => c.error).map(c => c.error!),
  });

  return tracked;
}

/**
 * Tracked mock interface
 */
export interface TrackedMock<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): ReturnType<T>;
  mock: ReturnType<typeof vi.fn>;
  calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error; duration: number }>;
  getAverageDuration(): number;
  getTotalDuration(): number;
  getErrors(): Error[];
}
