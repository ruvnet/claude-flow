/**
 * Rate Limiter
 *
 * Production-ready rate limiting implementations.
 *
 * @module v3/shared/resilience/rate-limiter
 */

/**
 * Rate limiter options
 */
export interface RateLimiterOptions {
  /** Maximum requests allowed in the window */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /** Enable sliding window (vs fixed window) */
  slidingWindow?: boolean;

  /** Key generator for per-key limiting */
  keyGenerator?: (context: unknown) => string;

  /** Skip limiter for certain requests */
  skip?: (context: unknown) => boolean;

  /** Handler when rate limit is exceeded */
  onRateLimited?: (key: string, remaining: number, resetAt: Date) => void;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter: number; // ms until reset
  total: number;
  used: number;
}

/**
 * Base Rate Limiter interface
 */
export interface RateLimiter {
  /** Check if request is allowed */
  check(key?: string): RateLimitResult;

  /** Consume a request token */
  consume(key?: string): RateLimitResult;

  /** Reset a specific key or all keys */
  reset(key?: string): void;

  /** Get current status */
  status(key?: string): RateLimitResult;
}

/**
 * Request entry for tracking
 */
interface RequestEntry {
  timestamp: number;
  key: string;
}

/**
 * Sliding Window Rate Limiter
 *
 * Uses sliding window algorithm for smooth rate limiting.
 *
 * @example
 * const limiter = new SlidingWindowRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000, // 100 requests per minute
 * });
 *
 * const result = limiter.consume('user-123');
 * if (!result.allowed) {
 *   throw new Error(`Rate limited. Retry in ${result.retryAfter}ms`);
 * }
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly options: RateLimiterOptions;
  private readonly requests: Map<string, RequestEntry[]> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(options: RateLimiterOptions) {
    this.options = {
      slidingWindow: true,
      ...options,
    };

    // Periodic cleanup of old entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.windowMs);
  }

  /**
   * Check if a request would be allowed without consuming
   */
  check(key: string = 'default'): RateLimitResult {
    this.cleanupKey(key);
    const entries = this.requests.get(key) || [];

    return {
      allowed: entries.length < this.options.maxRequests,
      remaining: Math.max(0, this.options.maxRequests - entries.length),
      resetAt: this.getResetTime(entries),
      retryAfter: this.getRetryAfter(entries),
      total: this.options.maxRequests,
      used: entries.length,
    };
  }

  /**
   * Consume a request token
   */
  consume(key: string = 'default'): RateLimitResult {
    // Clean old entries first
    this.cleanupKey(key);

    let entries = this.requests.get(key);
    if (!entries) {
      entries = [];
      this.requests.set(key, entries);
    }

    // Check if allowed
    if (entries.length >= this.options.maxRequests) {
      const result: RateLimitResult = {
        allowed: false,
        remaining: 0,
        resetAt: this.getResetTime(entries),
        retryAfter: this.getRetryAfter(entries),
        total: this.options.maxRequests,
        used: entries.length,
      };

      this.options.onRateLimited?.(key, 0, result.resetAt);
      return result;
    }

    // Add new entry
    entries.push({ timestamp: Date.now(), key });

    return {
      allowed: true,
      remaining: this.options.maxRequests - entries.length,
      resetAt: this.getResetTime(entries),
      retryAfter: 0,
      total: this.options.maxRequests,
      used: entries.length,
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }

  /**
   * Get current status
   */
  status(key: string = 'default'): RateLimitResult {
    return this.check(key);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.requests.clear();
  }

  /**
   * Clean old entries for a specific key
   */
  private cleanupKey(key: string): void {
    const entries = this.requests.get(key);
    if (!entries) return;

    const cutoff = Date.now() - this.options.windowMs;
    const filtered = entries.filter((e) => e.timestamp >= cutoff);

    if (filtered.length === 0) {
      this.requests.delete(key);
    } else if (filtered.length !== entries.length) {
      this.requests.set(key, filtered);
    }
  }

  /**
   * Clean all old entries
   */
  private cleanup(): void {
    for (const key of this.requests.keys()) {
      this.cleanupKey(key);
    }
  }

  /**
   * Get reset time based on oldest entry
   */
  private getResetTime(entries: RequestEntry[]): Date {
    if (entries.length === 0) {
      return new Date(Date.now() + this.options.windowMs);
    }

    const oldest = entries[0]!;
    return new Date(oldest.timestamp + this.options.windowMs);
  }

  /**
   * Get retry after time in ms
   */
  private getRetryAfter(entries: RequestEntry[]): number {
    if (entries.length < this.options.maxRequests) {
      return 0;
    }

    const oldest = entries[0]!;
    const resetAt = oldest.timestamp + this.options.windowMs;
    return Math.max(0, resetAt - Date.now());
  }
}

/**
 * Token Bucket Rate Limiter
 *
 * Uses token bucket algorithm for burst-friendly rate limiting.
 *
 * @example
 * const limiter = new TokenBucketRateLimiter({
 *   maxRequests: 10, // bucket size
 *   windowMs: 1000,  // refill interval
 * });
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly options: RateLimiterOptions;
  private readonly buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(options: RateLimiterOptions) {
    this.options = options;

    // Periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.windowMs * 10);
  }

  /**
   * Check if a request would be allowed
   */
  check(key: string = 'default'): RateLimitResult {
    this.refill(key);
    const bucket = this.getBucket(key);

    return {
      allowed: bucket.tokens >= 1,
      remaining: Math.floor(bucket.tokens),
      resetAt: new Date(bucket.lastRefill + this.options.windowMs),
      retryAfter: bucket.tokens >= 1 ? 0 : this.options.windowMs,
      total: this.options.maxRequests,
      used: this.options.maxRequests - Math.floor(bucket.tokens),
    };
  }

  /**
   * Consume a token
   */
  consume(key: string = 'default'): RateLimitResult {
    this.refill(key);
    const bucket = this.getBucket(key);

    if (bucket.tokens < 1) {
      const result: RateLimitResult = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(bucket.lastRefill + this.options.windowMs),
        retryAfter: this.options.windowMs,
        total: this.options.maxRequests,
        used: this.options.maxRequests,
      };

      this.options.onRateLimited?.(key, 0, result.resetAt);
      return result;
    }

    bucket.tokens -= 1;

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: new Date(bucket.lastRefill + this.options.windowMs),
      retryAfter: 0,
      total: this.options.maxRequests,
      used: this.options.maxRequests - Math.floor(bucket.tokens),
    };
  }

  /**
   * Reset bucket for a key
   */
  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  /**
   * Get current status
   */
  status(key: string = 'default'): RateLimitResult {
    return this.check(key);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.buckets.clear();
  }

  /**
   * Get or create bucket for key
   */
  private getBucket(key: string): { tokens: number; lastRefill: number } {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.options.maxRequests, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(key: string): void {
    const bucket = this.getBucket(key);
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;

    if (elapsed >= this.options.windowMs) {
      // Full refill after window
      const intervals = Math.floor(elapsed / this.options.windowMs);
      bucket.tokens = Math.min(
        this.options.maxRequests,
        bucket.tokens + intervals * this.options.maxRequests
      );
      bucket.lastRefill = now;
    }
  }

  /**
   * Clean inactive buckets
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.options.windowMs * 10;

    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff && bucket.tokens >= this.options.maxRequests) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Rate limiter middleware for Express-like frameworks
 */
export function createRateLimiterMiddleware(limiter: RateLimiter) {
  return (req: { ip?: string; headers?: Record<string, string> }, res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string) => void;
  }, next: () => void): void => {
    // Get key from IP or header
    const key = req.ip || req.headers?.['x-forwarded-for'] || 'anonymous';

    const result = limiter.consume(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(result.total));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt.getTime() / 1000)));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfter / 1000)));
      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter: result.retryAfter,
        resetAt: result.resetAt.toISOString(),
      });
      return;
    }

    next();
  };
}
