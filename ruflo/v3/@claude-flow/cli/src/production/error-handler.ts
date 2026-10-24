/**
 * Production Error Handling
 *
 * Provides standardized error handling with:
 * - Error classification
 * - Sanitization (no sensitive data leak)
 * - Structured error responses
 * - Error aggregation and reporting
 *
 * @module @claude-flow/cli/production/error-handler
 */

// ============================================================================
// Types
// ============================================================================

export interface ErrorContext {
  operation: string;
  tool?: string;
  input?: Record<string, unknown>;
  userId?: string;
  agentId?: string;
  requestId?: string;
  timestamp: string;
}

export interface ErrorHandlerConfig {
  includeStack: boolean;
  sanitize: boolean;
  reportToMonitoring: boolean;
  maxErrorsPerMinute: number;
  errorCategories: Record<string, string[]>;
}

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'rate_limit'
  | 'timeout'
  | 'circuit_open'
  | 'external_service'
  | 'internal'
  | 'unknown';

export interface StructuredError {
  success: false;
  error: {
    code: string;
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
  context?: Partial<ErrorContext>;
  timestamp: string;
}

// ============================================================================
// Error Classification
// ============================================================================

const ERROR_PATTERNS: Record<ErrorCategory, RegExp[]> = {
  validation: [
    /invalid/i,
    /required/i,
    /missing/i,
    /must be/i,
    /cannot be/i,
    /validation/i,
  ],
  authentication: [
    /unauthorized/i,
    /unauthenticated/i,
    /not authenticated/i,
    /invalid token/i,
    /expired token/i,
  ],
  authorization: [
    /forbidden/i,
    /permission denied/i,
    /access denied/i,
    /not allowed/i,
  ],
  not_found: [
    /not found/i,
    /does not exist/i,
    /no such/i,
    /unknown/i,
  ],
  rate_limit: [
    /rate limit/i,
    /too many requests/i,
    /throttled/i,
  ],
  timeout: [
    /timeout/i,
    /timed out/i,
    /deadline/i,
  ],
  circuit_open: [
    /circuit open/i,
    /service unavailable/i,
    /temporarily unavailable/i,
  ],
  external_service: [
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /network/i,
    /connection/i,
  ],
  internal: [
    /internal/i,
    /unexpected/i,
  ],
  unknown: [],
};

const RETRYABLE_CATEGORIES: ErrorCategory[] = [
  'timeout',
  'external_service',
  'rate_limit',
  'circuit_open',
];

// Sensitive keys to sanitize
const SENSITIVE_KEYS = [
  'password',
  'token',
  'api_key',
  'apiKey',
  'secret',
  'authorization',
  'bearer',
  'credential',
  'private',
];

// ============================================================================
// Error Handler
// ============================================================================

const DEFAULT_CONFIG: ErrorHandlerConfig = {
  includeStack: process.env.NODE_ENV !== 'production',
  sanitize: true,
  reportToMonitoring: true,
  maxErrorsPerMinute: 100,
  errorCategories: {},
};

export class ErrorHandler {
  private config: ErrorHandlerConfig;
  private errorCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private errorLog: StructuredError[] = [];
  private maxLogSize = 1000;

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify an error into a category
   */
  classifyError(error: Error | string): ErrorCategory {
    const message = typeof error === 'string' ? error : error.message;

    for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return category as ErrorCategory;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Check if an error category is retryable
   */
  isRetryable(category: ErrorCategory): boolean {
    return RETRYABLE_CATEGORIES.includes(category);
  }

  /**
   * Sanitize input to remove sensitive data
   */
  sanitize(input: Record<string, unknown>): Record<string, unknown> {
    if (!this.config.sanitize) return input;

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_KEYS.some(sk => lowerKey.includes(sk));

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Handle an error and return a structured response
   */
  handle(
    error: Error | string,
    context: Partial<ErrorContext> = {}
  ): StructuredError {
    const message = typeof error === 'string' ? error : error.message;
    const category = this.classifyError(error);
    const retryable = this.isRetryable(category);
    const now = new Date().toISOString();

    // Track error counts for rate limiting
    this.trackError(category);

    // Build structured error
    const structured: StructuredError = {
      success: false,
      error: {
        code: this.getErrorCode(category),
        message: this.sanitizeMessage(message),
        category,
        retryable,
        retryAfterMs: retryable ? this.getRetryDelay(category) : undefined,
      },
      context: context.input
        ? { ...context, input: this.sanitize(context.input) }
        : context,
      timestamp: now,
    };

    // Include stack trace in non-production
    if (this.config.includeStack && error instanceof Error && error.stack) {
      structured.error.details = { stack: error.stack };
    }

    // Log error
    this.logError(structured);

    return structured;
  }

  /**
   * Wrap a handler with error handling
   */
  wrap<T extends (...args: unknown[]) => Promise<unknown>>(
    handler: T,
    context: Partial<ErrorContext>
  ): T {
    return (async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        return this.handle(error as Error, {
          ...context,
          input: args[0] as Record<string, unknown>,
        });
      }
    }) as T;
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalErrors: number;
    byCategory: Record<string, number>;
    recentErrors: StructuredError[];
    errorRate: number;
  } {
    const byCategory: Record<string, number> = {};

    for (const error of this.errorLog) {
      const cat = error.error.category;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // Calculate error rate (errors per minute in last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentCount = this.errorLog.filter(
      e => new Date(e.timestamp).getTime() > fiveMinutesAgo
    ).length;
    const errorRate = recentCount / 5;

    return {
      totalErrors: this.errorLog.length,
      byCategory,
      recentErrors: this.errorLog.slice(-10),
      errorRate,
    };
  }

  /**
   * Clear error log
   */
  clearLog(): void {
    this.errorLog = [];
    this.errorCounts.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getErrorCode(category: ErrorCategory): string {
    const codes: Record<ErrorCategory, string> = {
      validation: 'ERR_VALIDATION',
      authentication: 'ERR_AUTHENTICATION',
      authorization: 'ERR_AUTHORIZATION',
      not_found: 'ERR_NOT_FOUND',
      rate_limit: 'ERR_RATE_LIMIT',
      timeout: 'ERR_TIMEOUT',
      circuit_open: 'ERR_CIRCUIT_OPEN',
      external_service: 'ERR_EXTERNAL_SERVICE',
      internal: 'ERR_INTERNAL',
      unknown: 'ERR_UNKNOWN',
    };
    return codes[category];
  }

  private getRetryDelay(category: ErrorCategory): number {
    const delays: Record<ErrorCategory, number> = {
      timeout: 1000,
      external_service: 2000,
      rate_limit: 5000,
      circuit_open: 30000,
      validation: 0,
      authentication: 0,
      authorization: 0,
      not_found: 0,
      internal: 0,
      unknown: 0,
    };
    return delays[category];
  }

  private sanitizeMessage(message: string): string {
    if (!this.config.sanitize) return message;

    // Remove potential sensitive data from message
    let sanitized = message;
    for (const key of SENSITIVE_KEYS) {
      const pattern = new RegExp(`${key}[=:]?\\s*["']?[^\\s"']+["']?`, 'gi');
      sanitized = sanitized.replace(pattern, `${key}=[REDACTED]`);
    }
    return sanitized;
  }

  private trackError(category: ErrorCategory): void {
    const now = Date.now();
    const key = category;
    const entry = this.errorCounts.get(key);

    if (!entry || now > entry.resetAt) {
      this.errorCounts.set(key, { count: 1, resetAt: now + 60000 });
    } else {
      entry.count++;
    }
  }

  private logError(error: StructuredError): void {
    this.errorLog.push(error);

    // Trim log if too large
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize / 2);
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

const defaultHandler = new ErrorHandler();

/**
 * Wrap a handler with error handling (convenience function)
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  handler: T,
  context: Partial<ErrorContext> = {}
): T {
  return defaultHandler.wrap(handler, context);
}

export default ErrorHandler;
