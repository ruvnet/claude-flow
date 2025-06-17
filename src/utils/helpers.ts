/**
 * Utility helper functions for Claude-Flow
 */

// Utility helper functions

/**
 * Simple calculator function that adds two numbers
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Simple hello world function
 */
export function helloWorld(): string {
  return "Hello, World!";
}

/**
 * Generates a unique identifier
 */
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Creates a timeout promise that rejects after the specified time
 */
export function timeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(new Error(message || 'Operation timed out'));
      }
    }, ms);
  });

  const wrappedPromise = promise.then((result) => {
    completed = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    return result;
  }, (error) => {
    completed = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    throw error;
  });

  return Promise.race([
    wrappedPromise,
    timeoutPromise,
  ]);
}

/**
 * Delays execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    onRetry,
  } = options;

  let lastError: Error;
  let delayMs = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        throw lastError;
      }

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await delay(Math.min(delayMs, maxDelay));
      delayMs *= factor;
    }
  }

  throw lastError!;
}

/**
 * Debounces a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, delayMs);
  };
}

/**
 * Throttles a function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limitMs: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;

      setTimeout(() => {
        inThrottle = false;
        if (lastArgs !== null) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, limitMs);
    } else {
      lastArgs = args;
    }
  };
}

/**
 * Deep clones an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item)) as T;
  }

  if (obj instanceof Map) {
    const map = new Map();
    obj.forEach((value, key) => {
      map.set(key, deepClone(value));
    });
    return map as T;
  }

  if (obj instanceof Set) {
    const set = new Set();
    obj.forEach((value) => {
      set.add(deepClone(value));
    });
    return set as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Merges multiple objects deeply
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  // Create a deep clone of the target to avoid mutation
  const result = deepClone(target);
  
  if (!sources.length) return result;

  const source = sources.shift();
  if (!source) return result;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const resultValue = result[key];

      if (isObject(resultValue) && isObject(sourceValue)) {
        result[key] = deepMerge(
          resultValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return deepMerge(result, ...sources);
}

/**
 * Checks if a value is a plain object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Creates a typed event emitter
 */
export class TypedEventEmitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<(data: unknown) => void>>();

  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: unknown) => void);
  }

  off<K extends keyof T>(event: K, handler: (data: T[K]) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as (data: unknown) => void);
    }
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): void {
    const onceHandler = (data: T[K]) => {
      handler(data);
      this.off(event, onceHandler);
    };
    this.on(event, onceHandler);
  }

  removeAllListeners(event?: keyof T): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

/**
 * Formats bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  // Handle negative numbers
  const absBytes = Math.abs(bytes);
  const i = Math.floor(Math.log(absBytes) / Math.log(k));

  const value = parseFloat((absBytes / Math.pow(k, i)).toFixed(dm));
  const sign = bytes < 0 ? '-' : '';
  
  return sign + value + ' ' + sizes[i];
}

/**
 * Parses duration string to milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Ensures a value is an array
 */
export function ensureArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Groups an array by a key function
 */
export function groupBy<T, K extends string | number | symbol>(
  items: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {} as Record<K, T[]>);
}

/**
 * Creates a promise that can be resolved/rejected externally
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Safely parses JSON with error handling
 */
export function safeParseJSON<T>(json: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}


/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  threshold: number;
  timeout: number;
  resetTimeout: number;
}

/**
 * Circuit breaker interface
 */
export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): CircuitBreakerState;
  reset(): void;
}

/**
 * Simple calculator function with basic operations
 */
export function calculator(a: number, b: number, operation: '+' | '-' | '*' | '/' | '^' | '%'): number {
  switch (operation) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) {
        throw new Error('Division by zero');
      }
      return a / b;
    case '^':
      return Math.pow(a, b);
    case '%':
      if (b === 0) {
        throw new Error('Modulo by zero');
      }
      return a % b;
    default:
      throw new Error(`Invalid operation: ${operation}`);
  }
}

/**
 * Creates a circuit breaker
 */
export function circuitBreaker(
  name: string,
  options: CircuitBreakerOptions,
): CircuitBreaker {
  const state: CircuitBreakerState = {
    failureCount: 0,
    lastFailureTime: 0,
    state: 'closed',
  };

  const isOpen = (): boolean => {
    if (state.state === 'open') {
      const now = Date.now();
      if (now - state.lastFailureTime >= options.resetTimeout) {
        state.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  };

  const recordSuccess = (): void => {
    state.failureCount = 0;
    state.state = 'closed';
  };

  const recordFailure = (): void => {
    state.failureCount++;
    state.lastFailureTime = Date.now();
    
    if (state.failureCount >= options.threshold) {
      state.state = 'open';
    }
  };

  return {
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      if (isOpen()) {
        throw new Error(`Circuit breaker ${name} is open`);
      }

      try {
        const result = await timeout(fn(), options.timeout);
        recordSuccess();
        return result;
      } catch (error) {
        recordFailure();
        throw error;
      }
    },

    getState(): CircuitBreakerState {
      return { ...state };
    },

    reset(): void {
      state.failureCount = 0;
      state.lastFailureTime = 0;
      state.state = 'closed';
    },
  };
}

/**
 * Greeting function that returns a personalized greeting
 */
export function greeting(name?: string, options?: {
  timeOfDay?: boolean;
  formal?: boolean;
  locale?: 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'zh';
}): string {
  const opts = {
    timeOfDay: false,
    formal: false,
    locale: 'en' as const,
    ...options
  };

  // Determine time-based greeting
  const getTimeGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Good night';
  };

  // Get greeting by locale
  const getLocaleGreeting = (): string => {
    const greetings: Record<string, { informal: string; formal: string }> = {
      en: { informal: 'Hello', formal: 'Greetings' },
      es: { informal: 'Hola', formal: 'Saludos' },
      fr: { informal: 'Salut', formal: 'Bonjour' },
      de: { informal: 'Hallo', formal: 'Guten Tag' },
      it: { informal: 'Ciao', formal: 'Salve' },
      pt: { informal: 'Olá', formal: 'Saudações' },
      ja: { informal: 'こんにちは', formal: 'ご挨拶' },
      zh: { informal: '你好', formal: '您好' }
    };

    const localeGreeting = greetings[opts.locale] || greetings.en;
    return opts.formal ? localeGreeting.formal : localeGreeting.informal;
  };

  // Build the greeting
  let greetingText = opts.timeOfDay ? getTimeGreeting() : getLocaleGreeting();
  
  if (name) {
    greetingText += `, ${name}`;
  }
  
  greetingText += '!';
  
  return greetingText;
}

