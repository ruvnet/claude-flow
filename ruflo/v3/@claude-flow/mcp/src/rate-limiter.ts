/**
 * @claude-flow/mcp - Rate Limiter
 *
 * Token bucket rate limiting for DoS protection
 */

import { EventEmitter } from 'events';
import type { ILogger } from './types.js';

export interface RateLimitConfig {
  /** Requests per second */
  requestsPerSecond: number;
  /** Burst size (max tokens) */
  burstSize: number;
  /** Per-session limits (if different from global) */
  perSessionLimit?: number;
  /** Cleanup interval for expired sessions */
  cleanupInterval?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // ms until bucket refills
  retryAfter?: number; // seconds to wait (for 429 response)
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  requestsPerSecond: 100,
  burstSize: 200,
  perSessionLimit: 50,
  cleanupInterval: 60000, // 1 minute
};

export class RateLimiter extends EventEmitter {
  private readonly config: Required<RateLimitConfig>;
  private globalBucket: TokenBucket;
  private sessionBuckets: Map<string, TokenBucket> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly logger: ILogger,
    config: Partial<RateLimitConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<RateLimitConfig>;

    // Initialize global bucket
    this.globalBucket = {
      tokens: this.config.burstSize,
      lastRefill: Date.now(),
    };

    this.startCleanup();
  }

  /**
   * Check if request is allowed (global limit)
   */
  checkGlobal(): RateLimitResult {
    return this.checkBucket(this.globalBucket, this.config.requestsPerSecond, this.config.burstSize);
  }

  /**
   * Check if request is allowed (per-session limit)
   */
  checkSession(sessionId: string): RateLimitResult {
    let bucket = this.sessionBuckets.get(sessionId);
    if (!bucket) {
      bucket = {
        tokens: this.config.perSessionLimit,
        lastRefill: Date.now(),
      };
      this.sessionBuckets.set(sessionId, bucket);
    }

    return this.checkBucket(
      bucket,
      this.config.perSessionLimit / 10, // Refill rate (10 seconds to full)
      this.config.perSessionLimit
    );
  }

  /**
   * Check both global and session limits
   */
  check(sessionId?: string): RateLimitResult {
    const globalResult = this.checkGlobal();
    if (!globalResult.allowed) {
      this.emit('rate-limit:global', { remaining: globalResult.remaining });
      return globalResult;
    }

    if (sessionId) {
      const sessionResult = this.checkSession(sessionId);
      if (!sessionResult.allowed) {
        this.emit('rate-limit:session', { sessionId, remaining: sessionResult.remaining });
        return sessionResult;
      }
      return sessionResult;
    }

    return globalResult;
  }

  /**
   * Consume a token (call after request is processed)
   */
  consume(sessionId?: string): void {
    this.consumeFromBucket(this.globalBucket);
    if (sessionId) {
      const bucket = this.sessionBuckets.get(sessionId);
      if (bucket) {
        this.consumeFromBucket(bucket);
      }
    }
  }

  /**
   * Reset session bucket
   */
  resetSession(sessionId: string): void {
    this.sessionBuckets.delete(sessionId);
    this.logger.debug('Rate limit session reset', { sessionId });
  }

  /**
   * Get current stats
   */
  getStats(): {
    globalTokens: number;
    globalBurstSize: number;
    sessionCount: number;
    config: RateLimitConfig;
  } {
    this.refillBucket(this.globalBucket, this.config.requestsPerSecond, this.config.burstSize);
    return {
      globalTokens: Math.floor(this.globalBucket.tokens),
      globalBurstSize: this.config.burstSize,
      sessionCount: this.sessionBuckets.size,
      config: this.config,
    };
  }

  /**
   * Destroy the rate limiter
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.sessionBuckets.clear();
    this.removeAllListeners();
  }

  /**
   * Check bucket and refill tokens
   */
  private checkBucket(
    bucket: TokenBucket,
    refillRate: number,
    maxTokens: number
  ): RateLimitResult {
    this.refillBucket(bucket, refillRate, maxTokens);

    if (bucket.tokens >= 1) {
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens) - 1,
        resetIn: Math.ceil((maxTokens - bucket.tokens) / refillRate * 1000),
      };
    }

    // Calculate when bucket will have 1 token
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfter = Math.ceil(tokensNeeded / refillRate);

    return {
      allowed: false,
      remaining: 0,
      resetIn: retryAfter * 1000,
      retryAfter,
    };
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillBucket(bucket: TokenBucket, refillRate: number, maxTokens: number): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * refillRate;

    bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Consume a token from bucket
   */
  private consumeFromBucket(bucket: TokenBucket): void {
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
    }
  }

  /**
   * Start cleanup timer for expired sessions
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const expireTime = this.config.cleanupInterval * 2;

      for (const [sessionId, bucket] of this.sessionBuckets) {
        if (now - bucket.lastRefill > expireTime) {
          this.sessionBuckets.delete(sessionId);
          this.logger.debug('Rate limit session expired', { sessionId });
        }
      }
    }, this.config.cleanupInterval);
  }
}

export function createRateLimiter(
  logger: ILogger,
  config?: Partial<RateLimitConfig>
): RateLimiter {
  return new RateLimiter(logger, config);
}

/**
 * Express/Connect middleware for rate limiting
 */
export function rateLimitMiddleware(rateLimiter: RateLimiter) {
  return (req: any, res: any, next: () => void) => {
    const sessionId = req.headers['x-session-id'] || req.ip;
    const result = rateLimiter.check(sessionId);

    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + Math.ceil(result.resetIn / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);
      res.status(429).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Rate limit exceeded',
          data: { retryAfter: result.retryAfter },
        },
      });
      return;
    }

    rateLimiter.consume(sessionId);
    next();
  };
}
