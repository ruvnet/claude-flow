/**
 * Secure Logger Utility
 *
 * Provides sanitized error logging that strips sensitive information
 * before logging to prevent information disclosure.
 *
 * Security features:
 * - Removes stack traces in production
 * - Sanitizes file paths to prevent internal structure disclosure
 * - Filters sensitive keys from error objects
 * - Truncates long messages to prevent log injection
 *
 * @module @claude-flow/shared/utils/secure-logger
 */

// ============================================================================
// Configuration
// ============================================================================

interface LoggerConfig {
  /** Environment mode */
  environment: 'development' | 'production' | 'test';
  /** Maximum message length */
  maxMessageLength: number;
  /** Whether to include stack traces */
  includeStackTrace: boolean;
  /** Sensitive keys to filter */
  sensitiveKeys: string[];
  /** Path patterns to sanitize */
  pathPatterns: RegExp[];
}

const DEFAULT_CONFIG: LoggerConfig = {
  environment: (process.env.NODE_ENV as LoggerConfig['environment']) || 'development',
  maxMessageLength: 1000,
  includeStackTrace: process.env.NODE_ENV === 'development',
  sensitiveKeys: [
    'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
    'authorization', 'auth', 'credential', 'private', 'key',
    'session', 'cookie', 'jwt', 'bearer', 'access_token', 'refresh_token',
  ],
  pathPatterns: [
    /\/home\/[^/]+/g,      // Unix home directories
    /\/Users\/[^/]+/g,     // macOS home directories
    /C:\\Users\\[^\\]+/gi, // Windows user directories
    /\/var\/[^/]+/g,       // Var directories
    /\/tmp\/[^/]+/g,       // Temp directories
  ],
};

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Sanitize a string message
 */
function sanitizeMessage(message: string, config: LoggerConfig): string {
  let sanitized = message;

  // Truncate long messages
  if (sanitized.length > config.maxMessageLength) {
    sanitized = sanitized.substring(0, config.maxMessageLength) + '... [truncated]';
  }

  // Sanitize paths
  for (const pattern of config.pathPatterns) {
    sanitized = sanitized.replace(pattern, '[PATH]');
  }

  // Remove potential sensitive data patterns
  sanitized = sanitized.replace(/[a-zA-Z0-9+/]{40,}={0,2}/g, '[REDACTED_KEY]');
  sanitized = sanitized.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]');

  return sanitized;
}

/**
 * Sanitize an error object
 */
function sanitizeError(error: unknown, config: LoggerConfig): Record<string, unknown> {
  if (error === null || error === undefined) {
    return { message: 'Unknown error' };
  }

  if (typeof error === 'string') {
    return { message: sanitizeMessage(error, config) };
  }

  if (error instanceof Error) {
    const sanitized: Record<string, unknown> = {
      name: error.name,
      message: sanitizeMessage(error.message, config),
    };

    // Only include stack in development
    if (config.includeStackTrace && error.stack) {
      sanitized.stack = sanitizeMessage(error.stack, config);
    }

    // Include code if present (common in Node.js errors)
    if ('code' in error) {
      sanitized.code = (error as { code: unknown }).code;
    }

    return sanitized;
  }

  if (typeof error === 'object') {
    return sanitizeObject(error as Record<string, unknown>, config);
  }

  return { message: String(error) };
}

/**
 * Sanitize a plain object
 */
function sanitizeObject(obj: Record<string, unknown>, config: LoggerConfig): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Skip sensitive keys
    if (config.sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>, config);
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeMessage(value, config);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================================
// Logger Class
// ============================================================================

export class SecureLogger {
  private config: LoggerConfig;
  private prefix: string;

  constructor(prefix: string = '', config: Partial<LoggerConfig> = {}) {
    this.prefix = prefix;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    const sanitizedMessage = sanitizeMessage(message, this.config);
    const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;

    if (sanitizedData) {
      console.info(`[INFO]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
    } else {
      console.info(`[INFO]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    const sanitizedMessage = sanitizeMessage(message, this.config);
    const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;

    if (sanitizedData) {
      console.warn(`[WARN]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
    } else {
      console.warn(`[WARN]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
    }
  }

  /**
   * Log an error (sanitized for security)
   */
  error(message: string, error?: unknown): void {
    const sanitizedMessage = sanitizeMessage(message, this.config);
    const sanitizedError = error ? sanitizeError(error, this.config) : undefined;

    if (sanitizedError) {
      console.error(`[ERROR]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedError);
    } else {
      console.error(`[ERROR]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
    }
  }

  /**
   * Log debug message (only in development)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (this.config.environment !== 'development') {
      return;
    }

    const sanitizedMessage = sanitizeMessage(message, this.config);
    const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;

    if (sanitizedData) {
      console.debug(`[DEBUG]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
    } else {
      console.debug(`[DEBUG]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): SecureLogger {
    const newPrefix = this.prefix ? `${this.prefix}:${subPrefix}` : subPrefix;
    return new SecureLogger(newPrefix, this.config);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a secure logger instance
 */
export function createSecureLogger(prefix?: string, config?: Partial<LoggerConfig>): SecureLogger {
  return new SecureLogger(prefix, config);
}

/**
 * Default logger instance
 */
export const logger = createSecureLogger('claude-flow');

/**
 * Sanitize an error for safe logging/display
 */
export function sanitizeErrorForLogging(error: unknown): Record<string, unknown> {
  return sanitizeError(error, DEFAULT_CONFIG);
}

/**
 * Sanitize a message for safe logging/display
 */
export function sanitizeMessageForLogging(message: string): string {
  return sanitizeMessage(message, DEFAULT_CONFIG);
}

export default SecureLogger;
