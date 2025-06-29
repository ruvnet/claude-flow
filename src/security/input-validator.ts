/**
 * Input validation and sanitization utilities
 */

import { z } from 'zod';
import { ILogger } from '../core/logger.js';

export interface IInputValidator {
  validateCommand(command: string): ValidationResult;
  validateProcessArgs(args: string[]): ValidationResult;
  validatePath(path: string): ValidationResult;
  validateJSON(data: unknown): ValidationResult;
  sanitizeString(input: string): string;
  sanitizeHTML(input: string): string;
  sanitizeFilename(filename: string): string;
}

export interface ValidationResult {
  valid: boolean;
  sanitized?: any;
  errors?: string[];
}

/**
 * Common validation schemas
 */
export const ValidationSchemas = {
  // Command validation schema
  command: z.string()
    .min(1, 'Command cannot be empty')
    .max(256, 'Command too long')
    .regex(/^[a-zA-Z0-9\-_]+$/, 'Command contains invalid characters'),

  // Process arguments schema
  processArgs: z.array(z.string()
    .max(1024, 'Argument too long')
    .refine((arg) => !arg.includes('\0'), 'Null bytes not allowed')
  ).max(100, 'Too many arguments'),

  // File path schema
  filePath: z.string()
    .min(1, 'Path cannot be empty')
    .max(4096, 'Path too long')
    .refine((path) => !path.includes('\0'), 'Null bytes not allowed in paths')
    .refine((path) => !path.includes('..'), 'Path traversal not allowed'),

  // Configuration schema
  config: z.object({
    name: z.string().min(1).max(128),
    value: z.unknown(),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  }),

  // User input schema
  userInput: z.string()
    .max(10000, 'Input too long')
    .refine((input) => !input.includes('\0'), 'Null bytes not allowed'),

  // Identifier schema (for IDs, names, etc.)
  identifier: z.string()
    .min(1, 'Identifier cannot be empty')
    .max(128, 'Identifier too long')
    .regex(/^[a-zA-Z0-9\-_]+$/, 'Identifier contains invalid characters'),
};

export class InputValidator implements IInputValidator {
  private commandBlacklist: Set<string>;
  private pathBlacklist: RegExp[];

  constructor(
    private config: {
      allowedCommands?: string[];
      blockedCommands?: string[];
      blockedPaths?: string[];
      maxInputLength?: number;
      enableStrictMode?: boolean;
    },
    private logger: ILogger,
  ) {
    // Initialize command blacklist
    this.commandBlacklist = new Set(config.blockedCommands || [
      'rm',
      'del',
      'format',
      'dd',
      'mkfs',
      'fdisk',
      'shutdown',
      'reboot',
      'kill',
      'killall',
      'pkill',
    ]);

    // Initialize path blacklist patterns
    this.pathBlacklist = (config.blockedPaths || [
      '/etc/*',
      '/sys/*',
      '/proc/*',
      '*/passwd',
      '*/shadow',
      '*.pem',
      '*.key',
      '*.env',
    ]).map((pattern) => this.globToRegex(pattern));
  }

  validateCommand(command: string): ValidationResult {
    try {
      // Basic validation
      const result = ValidationSchemas.command.safeParse(command);
      if (!result.success) {
        return {
          valid: false,
          errors: result.error.errors.map((e) => e.message),
        };
      }

      // Check against blacklist
      if (this.commandBlacklist.has(command.toLowerCase())) {
        this.logger.warn('Blocked command attempted', { command });
        return {
          valid: false,
          errors: [`Command '${command}' is not allowed`],
        };
      }

      // Check against whitelist if in strict mode
      if (this.config.enableStrictMode && this.config.allowedCommands) {
        if (!this.config.allowedCommands.includes(command)) {
          return {
            valid: false,
            errors: [`Command '${command}' is not in the allowed list`],
          };
        }
      }

      return {
        valid: true,
        sanitized: command,
      };
    } catch (error) {
      this.logger.error('Command validation error', error);
      return {
        valid: false,
        errors: ['Internal validation error'],
      };
    }
  }

  validateProcessArgs(args: string[]): ValidationResult {
    try {
      const result = ValidationSchemas.processArgs.safeParse(args);
      if (!result.success) {
        return {
          valid: false,
          errors: result.error.errors.map((e) => e.message),
        };
      }

      // Check for shell injection attempts
      const dangerousPatterns = [
        /[;&|`$(){}]/,  // Shell metacharacters
        /\$\{.*\}/,     // Variable expansion
        /\$\(.*\)/,     // Command substitution
        /`.*`/,         // Backtick command substitution
      ];

      const sanitizedArgs = args.map((arg) => {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(arg)) {
            this.logger.warn('Dangerous pattern in argument', { arg, pattern: pattern.toString() });
            if (this.config.enableStrictMode) {
              throw new Error(`Dangerous pattern detected in argument: ${arg}`);
            }
            // Escape dangerous characters
            return arg.replace(/[;&|`$(){}]/g, '\\$&');
          }
        }
        return arg;
      });

      return {
        valid: true,
        sanitized: sanitizedArgs,
      };
    } catch (error) {
      this.logger.error('Process args validation error', error);
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Internal validation error'],
      };
    }
  }

  validatePath(path: string): ValidationResult {
    try {
      const result = ValidationSchemas.filePath.safeParse(path);
      if (!result.success) {
        return {
          valid: false,
          errors: result.error.errors.map((e) => e.message),
        };
      }

      // Normalize path to prevent tricks
      const normalizedPath = path.replace(/\\/g, '/').replace(/\/+/g, '/');

      // Check against blacklisted paths
      for (const pattern of this.pathBlacklist) {
        if (pattern.test(normalizedPath)) {
          this.logger.warn('Blocked path access attempted', { path });
          return {
            valid: false,
            errors: [`Access to path '${path}' is not allowed`],
          };
        }
      }

      // Additional security checks
      if (normalizedPath.includes('/../') || normalizedPath.startsWith('../')) {
        return {
          valid: false,
          errors: ['Path traversal detected'],
        };
      }

      return {
        valid: true,
        sanitized: normalizedPath,
      };
    } catch (error) {
      this.logger.error('Path validation error', error);
      return {
        valid: false,
        errors: ['Internal validation error'],
      };
    }
  }

  validateJSON(data: unknown): ValidationResult {
    try {
      // Check if it's already an object
      if (typeof data === 'object' && data !== null) {
        return {
          valid: true,
          sanitized: data,
        };
      }

      // Try to parse if it's a string
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return {
          valid: true,
          sanitized: parsed,
        };
      }

      return {
        valid: false,
        errors: ['Invalid JSON data'],
      };
    } catch (error) {
      return {
        valid: false,
        errors: ['Invalid JSON format'],
      };
    }
  }

  sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    // Remove null bytes
    let sanitized = input.replace(/\0/g, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    // Limit length
    const maxLength = this.config.maxInputLength || 10000;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    // Remove control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return sanitized;
  }

  sanitizeHTML(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    // Basic HTML entity encoding
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  sanitizeFilename(filename: string): string {
    if (typeof filename !== 'string') {
      return '';
    }

    // Remove path components
    const basename = filename.split(/[/\\]/).pop() || '';

    // Remove dangerous characters
    let sanitized = basename.replace(/[^a-zA-Z0-9._\-]/g, '_');

    // Prevent hidden files
    if (sanitized.startsWith('.')) {
      sanitized = '_' + sanitized.substring(1);
    }

    // Limit length
    if (sanitized.length > 255) {
      const ext = sanitized.lastIndexOf('.');
      if (ext > 0) {
        const name = sanitized.substring(0, ext);
        const extension = sanitized.substring(ext);
        sanitized = name.substring(0, 255 - extension.length) + extension;
      } else {
        sanitized = sanitized.substring(0, 255);
      }
    }

    return sanitized;
  }

  private globToRegex(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = escaped
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`);
  }
}

/**
 * Factory function for creating input validator
 */
export function createInputValidator(
  config: {
    allowedCommands?: string[];
    blockedCommands?: string[];
    blockedPaths?: string[];
    maxInputLength?: number;
    enableStrictMode?: boolean;
  },
  logger: ILogger,
): IInputValidator {
  return new InputValidator(config, logger);
}

/**
 * Pre-defined validation functions for common use cases
 */
export const Validators = {
  isAlphanumeric: (input: string): boolean => /^[a-zA-Z0-9]+$/.test(input),
  isEmail: (input: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input),
  isURL: (input: string): boolean => {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  },
  isUUID: (input: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input),
  isPort: (port: number): boolean => Number.isInteger(port) && port >= 1 && port <= 65535,
  isIPAddress: (ip: string): boolean => {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  },
};