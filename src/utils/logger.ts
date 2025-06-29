/**
 * Consistent logging utilities for Claude-Flow
 * Provides structured logging with levels and optional formatting
 */

import { colors } from './colors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: string;
  data?: unknown;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  level: LogLevel;
  colors: boolean;
  timestamps: boolean;
  context?: string;
}

/**
 * Default logger configuration
 */
const defaultConfig: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  colors: !process.env.NO_COLOR && process.env.NODE_ENV !== 'test',
  timestamps: process.env.LOG_TIMESTAMPS === 'true',
  context: undefined
};

/**
 * Log level hierarchy for filtering
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Check if a log level should be shown
 */
function shouldLog(level: LogLevel, configLevel: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

/**
 * Format log message with colors and context
 */
function formatMessage(entry: LogEntry, config: LoggerConfig): string {
  const { level, message, timestamp, context, data } = entry;
  
  let formatted = '';
  
  // Add timestamp
  if (config.timestamps) {
    const time = timestamp.toISOString();
    formatted += config.colors ? colors.gray(`[${time}]`) : `[${time}]`;
    formatted += ' ';
  }
  
  // Add level with colors
  const levelUpper = level.toUpperCase().padEnd(5);
  if (config.colors) {
    switch (level) {
      case 'debug':
        formatted += colors.gray(levelUpper);
        break;
      case 'info':
        formatted += colors.blue(levelUpper);
        break;
      case 'warn':
        formatted += colors.warning(levelUpper);
        break;
      case 'error':
        formatted += colors.error(levelUpper);
        break;
    }
  } else {
    formatted += levelUpper;
  }
  
  formatted += ' ';
  
  // Add context
  if (context || config.context) {
    const ctx = context || config.context!;
    formatted += config.colors ? colors.cyan(`[${ctx}]`) : `[${ctx}]`;
    formatted += ' ';
  }
  
  // Add message
  formatted += message;
  
  // Add data if present
  if (data !== undefined) {
    formatted += ' ';
    formatted += typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }
  
  return formatted;
}

/**
 * Core logger class
 */
class Logger {
  private config: LoggerConfig;
  
  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }
  
  /**
   * Create a child logger with additional context
   */
  child(context: string): Logger {
    return new Logger({
      ...this.config,
      context: this.config.context ? `${this.config.context}:${context}` : context
    });
  }
  
  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Generic log method
   */
  private log(level: LogLevel, message: string, data?: unknown, context?: string): void {
    if (!shouldLog(level, this.config.level)) {
      return;
    }
    
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
      data
    };
    
    const formatted = formatMessage(entry, this.config);
    
    // Use appropriate console method
    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }
  
  /**
   * Debug level logging
   */
  debug(message: string, data?: unknown, context?: string): void {
    this.log('debug', message, data, context);
  }
  
  /**
   * Info level logging
   */
  info(message: string, data?: unknown, context?: string): void {
    this.log('info', message, data, context);
  }
  
  /**
   * Warning level logging
   */
  warn(message: string, data?: unknown, context?: string): void {
    this.log('warn', message, data, context);
  }
  
  /**
   * Error level logging
   */
  error(message: string, data?: unknown, context?: string): void {
    this.log('error', message, data, context);
  }
  
  /**
   * Fatal error logging (logs and exits)
   */
  fatal(message: string, data?: unknown, context?: string): never {
    this.error(message, data, context);
    process.exit(1);
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Simple logging functions for backward compatibility
 */
export const log = {
  debug: (message: string, data?: unknown) => logger.debug(message, data),
  info: (message: string, data?: unknown) => logger.info(message, data),
  warn: (message: string, data?: unknown) => logger.warn(message, data),
  error: (message: string, data?: unknown) => logger.error(message, data),
  fatal: (message: string, data?: unknown) => logger.fatal(message, data)
};

/**
 * Create a new logger with specific configuration
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  return new Logger(config);
}

/**
 * Specialized loggers for common use cases
 */
export const loggers = {
  cli: createLogger({ context: 'CLI', colors: true }),
  swarm: createLogger({ context: 'SWARM' }),
  memory: createLogger({ context: 'MEMORY' }),
  mcp: createLogger({ context: 'MCP' }),
  task: createLogger({ context: 'TASK' }),
  coordination: createLogger({ context: 'COORD' })
};

// Export the Logger class
export { Logger };