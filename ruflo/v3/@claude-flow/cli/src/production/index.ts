/**
 * V3 Production Hardening Module
 *
 * Provides production-grade utilities:
 * - Error handling middleware
 * - Rate limiting
 * - Retry mechanisms with exponential backoff
 * - Circuit breaker pattern
 * - Monitoring and observability hooks
 *
 * @module @claude-flow/cli/production
 */

export { ErrorHandler, withErrorHandling } from './error-handler.js';
export type { ErrorContext, ErrorHandlerConfig } from './error-handler.js';
export { RateLimiter, createRateLimiter } from './rate-limiter.js';
export type { RateLimiterConfig, RateLimitResult } from './rate-limiter.js';
export { withRetry } from './retry.js';
export type { RetryConfig, RetryResult, RetryStrategy } from './retry.js';
export { CircuitBreaker } from './circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitState } from './circuit-breaker.js';
export { MonitoringHooks, createMonitor } from './monitoring.js';
export type { MonitorConfig, MetricEvent } from './monitoring.js';
