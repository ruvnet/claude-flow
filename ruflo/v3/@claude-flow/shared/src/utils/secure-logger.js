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
const DEFAULT_CONFIG = {
    environment: process.env.NODE_ENV || 'development',
    maxMessageLength: 1000,
    includeStackTrace: process.env.NODE_ENV === 'development',
    sensitiveKeys: [
        'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
        'authorization', 'auth', 'credential', 'private', 'key',
        'session', 'cookie', 'jwt', 'bearer', 'access_token', 'refresh_token',
    ],
    pathPatterns: [
        /\/home\/[^/]+/g, // Unix home directories
        /\/Users\/[^/]+/g, // macOS home directories
        /C:\\Users\\[^\\]+/gi, // Windows user directories
        /\/var\/[^/]+/g, // Var directories
        /\/tmp\/[^/]+/g, // Temp directories
    ],
};
// ============================================================================
// Sanitization Functions
// ============================================================================
/**
 * Sanitize a string message
 */
function sanitizeMessage(message, config) {
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
function sanitizeError(error, config) {
    if (error === null || error === undefined) {
        return { message: 'Unknown error' };
    }
    if (typeof error === 'string') {
        return { message: sanitizeMessage(error, config) };
    }
    if (error instanceof Error) {
        const sanitized = {
            name: error.name,
            message: sanitizeMessage(error.message, config),
        };
        // Only include stack in development
        if (config.includeStackTrace && error.stack) {
            sanitized.stack = sanitizeMessage(error.stack, config);
        }
        // Include code if present (common in Node.js errors)
        if ('code' in error) {
            sanitized.code = error.code;
        }
        return sanitized;
    }
    if (typeof error === 'object') {
        return sanitizeObject(error, config);
    }
    return { message: String(error) };
}
/**
 * Sanitize a plain object
 */
function sanitizeObject(obj, config) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        // Skip sensitive keys
        if (config.sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
            continue;
        }
        // Recursively sanitize nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            sanitized[key] = sanitizeObject(value, config);
        }
        else if (typeof value === 'string') {
            sanitized[key] = sanitizeMessage(value, config);
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
// ============================================================================
// Logger Class
// ============================================================================
export class SecureLogger {
    config;
    prefix;
    constructor(prefix = '', config = {}) {
        this.prefix = prefix;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Log an info message
     */
    info(message, data) {
        const sanitizedMessage = sanitizeMessage(message, this.config);
        const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;
        if (sanitizedData) {
            console.info(`[INFO]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
        }
        else {
            console.info(`[INFO]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
        }
    }
    /**
     * Log a warning message
     */
    warn(message, data) {
        const sanitizedMessage = sanitizeMessage(message, this.config);
        const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;
        if (sanitizedData) {
            console.warn(`[WARN]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
        }
        else {
            console.warn(`[WARN]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
        }
    }
    /**
     * Log an error (sanitized for security)
     */
    error(message, error) {
        const sanitizedMessage = sanitizeMessage(message, this.config);
        const sanitizedError = error ? sanitizeError(error, this.config) : undefined;
        if (sanitizedError) {
            console.error(`[ERROR]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedError);
        }
        else {
            console.error(`[ERROR]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
        }
    }
    /**
     * Log debug message (only in development)
     */
    debug(message, data) {
        if (this.config.environment !== 'development') {
            return;
        }
        const sanitizedMessage = sanitizeMessage(message, this.config);
        const sanitizedData = data ? sanitizeObject(data, this.config) : undefined;
        if (sanitizedData) {
            console.debug(`[DEBUG]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`, sanitizedData);
        }
        else {
            console.debug(`[DEBUG]${this.prefix ? ` [${this.prefix}]` : ''} ${sanitizedMessage}`);
        }
    }
    /**
     * Create a child logger with a sub-prefix
     */
    child(subPrefix) {
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
export function createSecureLogger(prefix, config) {
    return new SecureLogger(prefix, config);
}
/**
 * Default logger instance
 */
export const logger = createSecureLogger('claude-flow');
/**
 * Sanitize an error for safe logging/display
 */
export function sanitizeErrorForLogging(error) {
    return sanitizeError(error, DEFAULT_CONFIG);
}
/**
 * Sanitize a message for safe logging/display
 */
export function sanitizeMessageForLogging(message) {
    return sanitizeMessage(message, DEFAULT_CONFIG);
}
export default SecureLogger;
//# sourceMappingURL=secure-logger.js.map