/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures by breaking the circuit after failures.
 *
 * @module v3/shared/resilience/circuit-breaker
 */

import { EventEmitter } from 'events';

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  /** Circuit is closed, requests flow normally */
  CLOSED = 'CLOSED',

  /** Circuit is open, requests are rejected immediately */
  OPEN = 'OPEN',

  /** Circuit is testing if service recovered */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  /** Name for identification */
  name: string;

  /** Failure threshold before opening circuit (default: 5) */
  failureThreshold: number;

  /** Success threshold in half-open state to close circuit (default: 3) */
  successThreshold: number;

  /** Time to wait before testing again in ms (default: 30000) */
  timeout: number;

  /** Time window to track failures in ms (default: 60000) */
  rollingWindow: number;

  /** Volume threshold - minimum requests before tripping (default: 10) */
  volumeThreshold: number;

  /** Custom failure detection */
  isFailure?: (error: Error) => boolean;

  /** Fallback function when circuit is open */
  fallback?: <T>(error: Error) => T | Promise<T>;

  /** Callback when state changes */
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  totalRequests: number;
  rejectedRequests: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openSince: Date | null;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
  rollingWindow: 60000,
  volumeThreshold: 10,
};

/**
 * Request tracking entry
 */
interface RequestEntry {
  timestamp: number;
  success: boolean;
}

/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures.
 *
 * @example
 * const breaker = new CircuitBreaker({
 *   name: 'external-api',
 *   failureThreshold: 5,
 *   timeout: 30000,
 * });
 *
 * try {
 *   const result = await breaker.execute(() => fetchExternalAPI());
 * } catch (error) {
 *   if (error.message === 'Circuit is open') {
 *     // Handle circuit open case
 *   }
 * }
 */
export class CircuitBreaker extends EventEmitter {
  private readonly options: CircuitBreakerOptions;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private requests: RequestEntry[] = [];
  private halfOpenSuccesses = 0;
  private openedAt: Date | null = null;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private rejectedCount = 0;
  private timeoutId?: ReturnType<typeof setTimeout>;

  constructor(options: CircuitBreakerOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Clean up old requests
    this.cleanOldRequests();

    // Check if circuit should be tested
    this.checkState();

    // If open, reject immediately or use fallback
    if (this.state === CircuitBreakerState.OPEN) {
      this.rejectedCount++;
      const error = new Error(`Circuit breaker '${this.options.name}' is open`);

      if (this.options.fallback) {
        return this.options.fallback(error);
      }

      throw error;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Check if this should be counted as failure
      const isFailure = this.options.isFailure?.(err) ?? true;

      if (isFailure) {
        this.onFailure(err);
      }

      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    this.checkState();
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    this.cleanOldRequests();

    return {
      state: this.state,
      failures: this.requests.filter((r) => !r.success).length,
      successes: this.requests.filter((r) => r.success).length,
      totalRequests: this.requests.length,
      rejectedRequests: this.rejectedCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openSince: this.openedAt,
    };
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    const previousState = this.state;
    this.state = CircuitBreakerState.CLOSED;
    this.requests = [];
    this.halfOpenSuccesses = 0;
    this.openedAt = null;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    if (previousState !== this.state) {
      this.notifyStateChange(previousState, this.state);
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.requests.push({ timestamp: Date.now(), success: true });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenSuccesses++;

      if (this.halfOpenSuccesses >= this.options.successThreshold) {
        this.transitionTo(CircuitBreakerState.CLOSED);
        this.halfOpenSuccesses = 0;
      }
    }
  }

  /**
   * Handle failed request
   */
  private onFailure(error: Error): void {
    this.lastFailure = new Date();
    this.requests.push({ timestamp: Date.now(), success: false });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Failed during half-open, go back to open
      this.transitionTo(CircuitBreakerState.OPEN);
      this.halfOpenSuccesses = 0;
      return;
    }

    // Check if we should open the circuit
    const failures = this.requests.filter((r) => !r.success).length;
    const totalRequests = this.requests.length;

    if (
      totalRequests >= this.options.volumeThreshold &&
      failures >= this.options.failureThreshold
    ) {
      this.transitionTo(CircuitBreakerState.OPEN);
    }
  }

  /**
   * Check if state should change based on timeout
   */
  private checkState(): void {
    if (this.state === CircuitBreakerState.OPEN && this.openedAt) {
      const elapsed = Date.now() - this.openedAt.getTime();

      if (elapsed >= this.options.timeout) {
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
      }
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const previousState = this.state;

    if (previousState === newState) {
      return;
    }

    this.state = newState;

    if (newState === CircuitBreakerState.OPEN) {
      this.openedAt = new Date();
      this.scheduleHalfOpen();
    } else if (newState === CircuitBreakerState.CLOSED) {
      this.openedAt = null;
      this.requests = [];

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = undefined;
      }
    }

    this.notifyStateChange(previousState, newState);
  }

  /**
   * Schedule transition to half-open
   */
  private scheduleHalfOpen(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      if (this.state === CircuitBreakerState.OPEN) {
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
      }
    }, this.options.timeout);
  }

  /**
   * Notify state change
   */
  private notifyStateChange(from: CircuitBreakerState, to: CircuitBreakerState): void {
    this.emit('stateChange', { from, to });
    this.options.onStateChange?.(from, to);
  }

  /**
   * Clean old requests outside rolling window
   */
  private cleanOldRequests(): void {
    const cutoff = Date.now() - this.options.rollingWindow;
    this.requests = this.requests.filter((r) => r.timestamp >= cutoff);
  }
}
