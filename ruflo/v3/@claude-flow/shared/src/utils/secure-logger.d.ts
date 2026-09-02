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
export declare class SecureLogger {
    private config;
    private prefix;
    constructor(prefix?: string, config?: Partial<LoggerConfig>);
    /**
     * Log an info message
     */
    info(message: string, data?: Record<string, unknown>): void;
    /**
     * Log a warning message
     */
    warn(message: string, data?: Record<string, unknown>): void;
    /**
     * Log an error (sanitized for security)
     */
    error(message: string, error?: unknown): void;
    /**
     * Log debug message (only in development)
     */
    debug(message: string, data?: Record<string, unknown>): void;
    /**
     * Create a child logger with a sub-prefix
     */
    child(subPrefix: string): SecureLogger;
}
/**
 * Create a secure logger instance
 */
export declare function createSecureLogger(prefix?: string, config?: Partial<LoggerConfig>): SecureLogger;
/**
 * Default logger instance
 */
export declare const logger: SecureLogger;
/**
 * Sanitize an error for safe logging/display
 */
export declare function sanitizeErrorForLogging(error: unknown): Record<string, unknown>;
/**
 * Sanitize a message for safe logging/display
 */
export declare function sanitizeMessageForLogging(message: string): string;
export default SecureLogger;
//# sourceMappingURL=secure-logger.d.ts.map