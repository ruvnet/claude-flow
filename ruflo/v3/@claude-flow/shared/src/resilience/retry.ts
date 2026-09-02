/**
 * Retry with Exponential Backoff
 *
 * Production-ready retry logic with jitter, max retries, and error filtering.
 *
 * @module v3/shared/resilience/retry
 */

/**
 * Retry options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;

  /** Initial delay in milliseconds (default: 100) */
  initialDelay: number;

  /** Maximum delay in milliseconds (default: 10000) */
  maxDelay: number;

  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;

  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitter: number;

  /** Timeout for each attempt in milliseconds (default: 30000) */
  timeout: number;

  /** Errors that should trigger a retry (default: all errors) */
  retryableErrors?: (error: Error) => boolean;

  /** Callback for each retry attempt */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  totalTime: number;
  errors: Error[];
}

/**
 * Retry error with attempt history
 */
export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly errors: Error[],
    public readonly totalTime: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: 0.1,
  timeout: 30000,
};

/**
 * Retry a function with exponential backoff
 *
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result with success/failure and metadata
 *
 * @example
 * const result = await retry(
 *   () => fetchData(),
 *   { maxAttempts: 5, initialDelay: 200 }
 * );
 *
 * if (result.success) {
 *   console.log('Data:', result.result);
 * } else {
 *   console.log('Failed after', result.attempts, 'attempts');
 * }
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: Error[] = [];
  const startTime = Date.now();

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Execute with timeout
      const result = await withTimeout(fn(), opts.timeout, attempt);

      return {
        success: true,
        result,
        attempts: attempt,
        totalTime: Date.now() - startTime,
        errors,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);

      // Check if error is retryable
      if (opts.retryableErrors && !opts.retryableErrors(err)) {
        return {
          success: false,
          attempts: attempt,
          totalTime: Date.now() - startTime,
          errors,
        };
      }

      // If this was the last attempt, don't delay
      if (attempt >= opts.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt - 1);
      const jitter = baseDelay * opts.jitter * (Math.random() * 2 - 1);
      const delay = Math.min(baseDelay + jitter, opts.maxDelay);

      // Callback before retry
      if (opts.onRetry) {
        opts.onRetry(err, attempt, delay);
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  return {
    success: false,
    attempts: opts.maxAttempts,
    totalTime: Date.now() - startTime,
    errors,
  };
}

/**
 * Wrap a function with retry behavior
 *
 * @param fn Function to wrap
 * @param options Retry configuration
 * @returns Wrapped function that retries on failure
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>> {
  return async (...args: Parameters<T>) => {
    return retry(() => fn(...args) as Promise<Awaited<ReturnType<T>>>, options);
  };
}

/**
 * Execute with timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeout: number, attempt: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Attempt ${attempt} timed out after ${timeout}ms`));
    }, timeout);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Common retryable error predicates
 */
export const RetryableErrors = {
  /** Network errors (ECONNRESET, ETIMEDOUT, etc.) */
  network: (error: Error): boolean => {
    const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
    return networkCodes.some((code) => error.message.includes(code));
  },

  /** Rate limit errors (429) */
  rateLimit: (error: Error): boolean => {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
  },

  /** Server errors (5xx) */
  serverError: (error: Error): boolean => {
    return /5\d\d/.test(error.message) || error.message.includes('Internal Server Error');
  },

  /** Transient errors (network + rate limit + 5xx) */
  transient: (error: Error): boolean => {
    return (
      RetryableErrors.network(error) ||
      RetryableErrors.rateLimit(error) ||
      RetryableErrors.serverError(error)
    );
  },

  /** All errors are retryable */
  all: (): boolean => true,
};
