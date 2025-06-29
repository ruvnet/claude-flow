/**
 * Test Stability Helpers
 * Utilities to help prevent flaky tests and race conditions
 */

/**
 * Retry a test function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    onRetry
  } = options;

  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      if (onRetry) {
        onRetry(attempt, error);
      }
      
      const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Wait for a value to stabilize (stop changing)
 */
export async function waitForStableValue<T>(
  getValue: () => T | Promise<T>,
  options: {
    stableTime?: number;
    timeout?: number;
    checkInterval?: number;
    equals?: (a: T, b: T) => boolean;
  } = {}
): Promise<T> {
  const {
    stableTime = 200,
    timeout = 5000,
    checkInterval = 50,
    equals = (a, b) => a === b
  } = options;

  const startTime = Date.now();
  let lastValue: T | undefined;
  let stableStartTime: number | undefined;

  while (Date.now() - startTime < timeout) {
    const currentValue = await getValue();
    
    if (lastValue === undefined || !equals(lastValue, currentValue)) {
      lastValue = currentValue;
      stableStartTime = Date.now();
    } else if (stableStartTime && Date.now() - stableStartTime >= stableTime) {
      return currentValue;
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  throw new Error(`Value did not stabilize within ${timeout}ms`);
}

/**
 * Ensure async operations complete before continuing
 */
export async function flushPromises(cycles = 1): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/**
 * Mock timer utilities for consistent async testing
 */
export class MockTimers {
  private realSetTimeout = global.setTimeout;
  private realSetInterval = global.setInterval;
  private realSetImmediate = global.setImmediate;
  private timers: Array<{ id: number; callback: Function; delay: number; type: 'timeout' | 'interval' }> = [];
  private nextId = 1;
  private currentTime = 0;

  install(): void {
    global.setTimeout = ((callback: Function, delay = 0) => {
      const id = this.nextId++;
      this.timers.push({ id, callback, delay, type: 'timeout' });
      return id as any;
    }) as any;

    global.setInterval = ((callback: Function, delay = 0) => {
      const id = this.nextId++;
      this.timers.push({ id, callback, delay, type: 'interval' });
      return id as any;
    }) as any;
  }

  uninstall(): void {
    global.setTimeout = this.realSetTimeout;
    global.setInterval = this.realSetInterval;
    global.setImmediate = this.realSetImmediate;
    this.timers = [];
    this.currentTime = 0;
  }

  async tick(ms: number): Promise<void> {
    const targetTime = this.currentTime + ms;
    
    while (this.currentTime < targetTime) {
      const nextTimer = this.timers
        .filter(t => t.delay <= targetTime - this.currentTime)
        .sort((a, b) => a.delay - b.delay)[0];
      
      if (!nextTimer) {
        this.currentTime = targetTime;
        break;
      }
      
      this.currentTime += nextTimer.delay;
      
      if (nextTimer.type === 'timeout') {
        this.timers = this.timers.filter(t => t.id !== nextTimer.id);
      }
      
      await nextTimer.callback();
      
      if (nextTimer.type === 'interval') {
        nextTimer.delay = nextTimer.delay; // Reset for next iteration
      }
    }
  }

  getTimerCount(): number {
    return this.timers.length;
  }
}

/**
 * Debounce helper for testing debounced functions
 */
export function createDebouncedTest(
  fn: Function,
  wait: number
): {
  call: (...args: any[]) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: any[] | null = null;
  let lastThis: any = null;

  const call = function(this: any, ...args: any[]) {
    lastArgs = args;
    lastThis = this;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      if (lastArgs) {
        fn.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }
      timeoutId = null;
    }, wait);
  };

  const flush = async () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      fn.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
      timeoutId = null;
    }
    await flushPromises();
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
      lastThis = null;
    }
  };

  return { call, flush, cancel };
}

/**
 * Create a test-friendly event emitter with debugging
 */
export class TestEventEmitter {
  private events: Map<string, Array<{ handler: Function; once: boolean }>> = new Map();
  private emitHistory: Array<{ event: string; data: any; timestamp: number }> = [];

  on(event: string, handler: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push({ handler, once: false });
  }

  once(event: string, handler: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push({ handler, once: true });
  }

  emit(event: string, data?: any): void {
    this.emitHistory.push({ event, data, timestamp: Date.now() });
    
    const handlers = this.events.get(event) || [];
    const handlersToCall = [...handlers];
    
    // Remove once handlers
    this.events.set(event, handlers.filter(h => !h.once));
    
    // Call handlers
    handlersToCall.forEach(({ handler }) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  getEmitHistory(): Array<{ event: string; data: any; timestamp: number }> {
    return [...this.emitHistory];
  }

  clearHistory(): void {
    this.emitHistory = [];
  }

  async waitForEvent(event: string, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(event);
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      this.once(event, (data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }
}

/**
 * Leak detector for tests
 */
export class LeakDetector {
  private initialMemory: NodeJS.MemoryUsage;
  private resourceCounts: Map<string, number> = new Map();

  constructor() {
    this.initialMemory = process.memoryUsage();
  }

  trackResource(type: string, delta: number = 1): void {
    const current = this.resourceCounts.get(type) || 0;
    this.resourceCounts.set(type, current + delta);
  }

  releaseResource(type: string, delta: number = 1): void {
    this.trackResource(type, -delta);
  }

  checkLeaks(): { hasLeaks: boolean; report: string } {
    const currentMemory = process.memoryUsage();
    const memoryGrowth = currentMemory.heapUsed - this.initialMemory.heapUsed;
    
    const leaks: string[] = [];
    
    // Check for excessive memory growth (>50MB)
    if (memoryGrowth > 50 * 1024 * 1024) {
      leaks.push(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Check for unreleased resources
    for (const [type, count] of this.resourceCounts) {
      if (count > 0) {
        leaks.push(`Unreleased ${type}: ${count}`);
      }
    }
    
    return {
      hasLeaks: leaks.length > 0,
      report: leaks.join(', ')
    };
  }
}

/**
 * Async test timeout helper
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ]);
}