/**
 * Production Rate Limiting
 *
 * Provides token bucket rate limiting with:
 * - Per-operation limits
 * - Per-user/agent limits
 * - Burst allowance
 * - Sliding window tracking
 *
 * @module @claude-flow/cli/production/rate-limiter
 */

// ============================================================================
// Types
// ============================================================================

export interface RateLimiterConfig {
  // Requests per window
  maxRequests: number;
  // Window duration in milliseconds
  windowMs: number;
  // Allow bursts above limit temporarily
  burstMultiplier: number;
  // Skip rate limiting for these operations
  whitelist: string[];
  // Custom limits per operation
  operationLimits: Record<string, { maxRequests: number; windowMs: number }>;
  // Enable per-user tracking
  perUserLimits: boolean;
  // Max users to track
  maxTrackedUsers: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  requests: number[];
}

// ============================================================================
// Rate Limiter
// ============================================================================

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  burstMultiplier: 1.5,
  whitelist: [],
  operationLimits: {},
  perUserLimits: true,
  maxTrackedUsers: 10000,
};

export class RateLimiter {
  private config: RateLimiterConfig;
  private buckets: Map<string, TokenBucket> = new Map();
  private globalBucket: TokenBucket;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.globalBucket = this.createBucket();
  }

  /**
   * Check if a request is allowed
   */
  check(
    operation: string,
    userId?: string
  ): RateLimitResult {
    // Check whitelist
    if (this.config.whitelist.includes(operation)) {
      return { allowed: true, remaining: Infinity, resetAt: 0 };
    }

    // Get limits for this operation
    const limits = this.getLimits(operation);
    const now = Date.now();

    // Get or create bucket
    const bucketKey = userId && this.config.perUserLimits
      ? `${operation}:${userId}`
      : `global:${operation}`;

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = this.createBucket();
      this.buckets.set(bucketKey, bucket);
      this.cleanupBuckets();
    }

    // Clean old requests from sliding window
    bucket.requests = bucket.requests.filter(t => t > now - limits.windowMs);

    // Calculate remaining
    const maxWithBurst = Math.floor(limits.maxRequests * this.config.burstMultiplier);
    const remaining = maxWithBurst - bucket.requests.length;

    if (remaining <= 0) {
      // Rate limited
      const oldestRequest = bucket.requests[0];
      const resetAt = oldestRequest + limits.windowMs;
      const retryAfterMs = resetAt - now;

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Allow request
    bucket.requests.push(now);

    return {
      allowed: true,
      remaining: remaining - 1,
      resetAt: now + limits.windowMs,
    };
  }

  /**
   * Consume a token (use after successful request)
   */
  consume(operation: string, userId?: string): boolean {
    const result = this.check(operation, userId);
    return result.allowed;
  }

  /**
   * Get current rate limit status
   */
  getStatus(operation: string, userId?: string): {
    current: number;
    limit: number;
    remaining: number;
    resetAt: number;
  } {
    const limits = this.getLimits(operation);
    const bucketKey = userId && this.config.perUserLimits
      ? `${operation}:${userId}`
      : `global:${operation}`;

    const bucket = this.buckets.get(bucketKey);
    const now = Date.now();

    if (!bucket) {
      return {
        current: 0,
        limit: limits.maxRequests,
        remaining: limits.maxRequests,
        resetAt: now + limits.windowMs,
      };
    }

    // Clean old requests
    const validRequests = bucket.requests.filter(t => t > now - limits.windowMs);

    return {
      current: validRequests.length,
      limit: limits.maxRequests,
      remaining: Math.max(0, limits.maxRequests - validRequests.length),
      resetAt: validRequests.length > 0
        ? validRequests[0] + limits.windowMs
        : now + limits.windowMs,
    };
  }

  /**
   * Reset limits for a specific key
   */
  reset(operation: string, userId?: string): void {
    const bucketKey = userId && this.config.perUserLimits
      ? `${operation}:${userId}`
      : `global:${operation}`;

    this.buckets.delete(bucketKey);
  }

  /**
   * Reset all limits
   */
  resetAll(): void {
    this.buckets.clear();
    this.globalBucket = this.createBucket();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalBuckets: number;
    activeUsers: number;
    mostLimitedOperations: Array<{ operation: string; requests: number }>;
  } {
    const operationCounts = new Map<string, number>();
    const users = new Set<string>();

    for (const [key, bucket] of this.buckets) {
      const [operation, userId] = key.split(':');
      if (userId) users.add(userId);

      const current = operationCounts.get(operation) || 0;
      operationCounts.set(operation, current + bucket.requests.length);
    }

    const mostLimited = Array.from(operationCounts.entries())
      .map(([operation, requests]) => ({ operation, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10);

    return {
      totalBuckets: this.buckets.size,
      activeUsers: users.size,
      mostLimitedOperations: mostLimited,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getLimits(operation: string): { maxRequests: number; windowMs: number } {
    return this.config.operationLimits[operation] || {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    };
  }

  private createBucket(): TokenBucket {
    return {
      tokens: this.config.maxRequests,
      lastRefill: Date.now(),
      requests: [],
    };
  }

  private cleanupBuckets(): void {
    // Limit number of tracked buckets
    if (this.buckets.size > this.config.maxTrackedUsers) {
      const now = Date.now();
      const toDelete: string[] = [];

      // Find buckets with no recent requests
      for (const [key, bucket] of this.buckets) {
        const recent = bucket.requests.filter(t => t > now - this.config.windowMs * 2);
        if (recent.length === 0) {
          toDelete.push(key);
        }
      }

      // Delete stale buckets
      for (const key of toDelete) {
        this.buckets.delete(key);
        if (this.buckets.size <= this.config.maxTrackedUsers * 0.8) {
          break;
        }
      }
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a rate limiter with default config
 */
export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  return new RateLimiter(config);
}

export default RateLimiter;
