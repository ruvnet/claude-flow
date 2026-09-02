/**
 * Security Module
 *
 * Provides security utilities for plugin development.
 * Implements best practices for input validation, sanitization, and safe operations.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate and sanitize a string input.
 */
export function validateString(
  input: unknown,
  options?: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    trim?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
  }
): string | null {
  if (typeof input !== 'string') return null;

  let value = input;

  if (options?.trim) value = value.trim();
  if (options?.lowercase) value = value.toLowerCase();
  if (options?.uppercase) value = value.toUpperCase();

  if (options?.minLength !== undefined && value.length < options.minLength) return null;
  if (options?.maxLength !== undefined && value.length > options.maxLength) return null;
  if (options?.pattern && !options.pattern.test(value)) return null;

  return value;
}

/**
 * Validate a number input.
 */
export function validateNumber(
  input: unknown,
  options?: {
    min?: number;
    max?: number;
    integer?: boolean;
  }
): number | null {
  const num = typeof input === 'number' ? input : parseFloat(String(input));

  if (isNaN(num) || !isFinite(num)) return null;
  if (options?.min !== undefined && num < options.min) return null;
  if (options?.max !== undefined && num > options.max) return null;
  if (options?.integer && !Number.isInteger(num)) return null;

  return num;
}

/**
 * Validate a boolean input.
 */
export function validateBoolean(input: unknown): boolean | null {
  if (typeof input === 'boolean') return input;
  if (input === 'true' || input === '1' || input === 1) return true;
  if (input === 'false' || input === '0' || input === 0) return false;
  return null;
}

/**
 * Validate an array input.
 */
export function validateArray<T>(
  input: unknown,
  itemValidator: (item: unknown) => T | null,
  options?: {
    minLength?: number;
    maxLength?: number;
    unique?: boolean;
  }
): T[] | null {
  if (!Array.isArray(input)) return null;

  if (options?.minLength !== undefined && input.length < options.minLength) return null;
  if (options?.maxLength !== undefined && input.length > options.maxLength) return null;

  const result: T[] = [];
  for (const item of input) {
    const validated = itemValidator(item);
    if (validated === null) return null;
    result.push(validated);
  }

  if (options?.unique) {
    const uniqueSet = new Set(result.map(String));
    if (uniqueSet.size !== result.length) return null;
  }

  return result;
}

/**
 * Validate an enum value.
 */
export function validateEnum<T extends string>(
  input: unknown,
  allowedValues: readonly T[]
): T | null {
  if (typeof input !== 'string') return null;
  if (!allowedValues.includes(input as T)) return null;
  return input as T;
}

// ============================================================================
// Path Security
// ============================================================================

const MAX_PATH_LENGTH = 4096;
const BLOCKED_PATH_PATTERNS = [
  /\.\./,  // Parent directory traversal
  /^~/,    // Home directory expansion
  /^\/etc\//i,
  /^\/var\//i,
  /^\/tmp\//i,
  /^\/proc\//i,
  /^\/sys\//i,
  /^\/dev\//i,
  /^C:\\Windows/i,
  /^C:\\Program Files/i,
];

/**
 * Validate a file path for safety.
 */
export function validatePath(
  inputPath: unknown,
  options?: {
    allowedExtensions?: string[];
    blockedPatterns?: RegExp[];
    mustExist?: boolean;
    allowAbsolute?: boolean;
  }
): string | null {
  if (typeof inputPath !== 'string') return null;
  if (inputPath.length === 0 || inputPath.length > MAX_PATH_LENGTH) return null;

  // Normalize the path
  const normalized = path.normalize(inputPath);

  // Check blocked patterns
  const blockedPatterns = [...BLOCKED_PATH_PATTERNS, ...(options?.blockedPatterns ?? [])];
  for (const pattern of blockedPatterns) {
    if (pattern.test(normalized)) return null;
  }

  // Check absolute path restriction
  if (!options?.allowAbsolute && path.isAbsolute(normalized)) return null;

  // Check extension
  if (options?.allowedExtensions) {
    const ext = path.extname(normalized).toLowerCase();
    if (!options.allowedExtensions.includes(ext)) return null;
  }

  return normalized;
}

/**
 * Create a safe path relative to a base directory.
 * Prevents path traversal attacks.
 */
export function safePath(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments);
  const normalizedBase = path.normalize(baseDir);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal blocked: ${resolved}`);
  }

  return resolved;
}

/**
 * Async version of safePath that uses realpath.
 * More secure as it resolves symlinks.
 */
export async function safePathAsync(baseDir: string, ...segments: string[]): Promise<string> {
  const resolved = path.resolve(baseDir, ...segments);

  try {
    const realResolved = await fs.realpath(resolved).catch(() => resolved);
    const realBase = await fs.realpath(baseDir).catch(() => baseDir);

    if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
      throw new Error(`Path traversal blocked: ${realResolved}`);
    }

    return realResolved;
  } catch (error) {
    // Handle non-existent files
    const normalizedBase = path.normalize(baseDir);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
      throw new Error(`Path traversal blocked: ${resolved}`);
    }
    return resolved;
  }
}

// ============================================================================
// JSON Security
// ============================================================================

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse JSON safely, stripping dangerous keys.
 */
export function safeJsonParse<T = unknown>(content: string): T {
  return JSON.parse(content, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) {
      return undefined;
    }
    return value;
  }) as T;
}

/**
 * Stringify JSON with circular reference detection.
 */
export function safeJsonStringify(
  value: unknown,
  options?: {
    space?: number;
    maxDepth?: number;
    replacer?: (key: string, value: unknown) => unknown;
  }
): string {
  const seen = new WeakSet();
  const maxDepth = options?.maxDepth ?? 100;
  let currentDepth = 0;

  const replacer = (key: string, val: unknown): unknown => {
    // Apply custom replacer first
    if (options?.replacer) {
      val = options.replacer(key, val);
    }

    // Strip dangerous keys
    if (DANGEROUS_KEYS.has(key)) {
      return undefined;
    }

    // Handle circular references
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }

    // Depth limiting
    if (key !== '') {
      currentDepth++;
      if (currentDepth > maxDepth) {
        return '[Max Depth Exceeded]';
      }
    }

    return val;
  };

  return JSON.stringify(value, replacer, options?.space);
}

// ============================================================================
// Command Security
// ============================================================================

const ALLOWED_COMMANDS = new Set([
  'npm', 'npx', 'node', 'git', 'tsc', 'vitest', 'jest',
  'prettier', 'eslint', 'ls', 'cat', 'grep', 'find',
]);

const BLOCKED_COMMANDS = new Set([
  'rm', 'del', 'format', 'dd', 'mkfs', 'fdisk',
  'shutdown', 'reboot', 'poweroff', 'halt',
  'passwd', 'sudo', 'su', 'chmod', 'chown',
  'curl', 'wget', 'nc', 'netcat',
]);

const SHELL_METACHARACTERS = /[|;&$`<>(){}[\]!\\]/;

/**
 * Validate a command for safe execution.
 */
export function validateCommand(
  command: unknown,
  options?: {
    allowedCommands?: Set<string>;
    blockedCommands?: Set<string>;
    allowShellMetachars?: boolean;
  }
): { command: string; args: string[] } | null {
  if (typeof command !== 'string') return null;

  const trimmed = command.trim();
  if (trimmed.length === 0) return null;

  // Check for shell metacharacters
  if (!options?.allowShellMetachars && SHELL_METACHARACTERS.test(trimmed)) {
    return null;
  }

  // Parse command and args
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Check allowed/blocked lists
  const allowed = options?.allowedCommands ?? ALLOWED_COMMANDS;
  const blocked = options?.blockedCommands ?? BLOCKED_COMMANDS;

  if (blocked.has(cmd)) return null;
  if (!allowed.has(cmd) && allowed.size > 0) return null;

  return { command: cmd, args };
}

/**
 * Escape a string for safe shell argument use.
 */
export function escapeShellArg(arg: string): string {
  // Empty string
  if (arg.length === 0) return "''";

  // If no special characters, return as-is
  if (!/[^a-zA-Z0-9_\-=./:@]/.test(arg)) return arg;

  // Single-quote the argument and escape any single quotes
  return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
}

// ============================================================================
// Error Sanitization
// ============================================================================

const SENSITIVE_PATTERNS = [
  /password[=:]\s*\S+/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /auth[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /\/\/[^:]+:[^@]+@/g,  // Credentials in URLs
];

/**
 * Sanitize error messages to remove sensitive data.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate very long messages
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000) + '... [truncated]';
  }

  return sanitized;
}

/**
 * Create a safe error object for logging/transmission.
 */
export function sanitizeError(error: unknown): {
  name: string;
  message: string;
  code?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeErrorMessage(error),
      code: (error as NodeJS.ErrnoException).code,
    };
  }

  return {
    name: 'Error',
    message: sanitizeErrorMessage(error),
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimiter {
  tryAcquire(): boolean;
  getRemaining(): number;
  reset(): void;
}

/**
 * Create a token bucket rate limiter.
 */
export function createRateLimiter(options: {
  maxTokens: number;
  refillRate: number;
  refillInterval: number;
}): RateLimiter {
  let tokens = options.maxTokens;
  let lastRefill = Date.now();

  const refill = () => {
    const now = Date.now();
    const elapsed = now - lastRefill;
    const refillCount = Math.floor(elapsed / options.refillInterval) * options.refillRate;

    if (refillCount > 0) {
      tokens = Math.min(options.maxTokens, tokens + refillCount);
      lastRefill = now;
    }
  };

  return {
    tryAcquire(): boolean {
      refill();
      if (tokens > 0) {
        tokens--;
        return true;
      }
      return false;
    },
    getRemaining(): number {
      refill();
      return tokens;
    },
    reset(): void {
      tokens = options.maxTokens;
      lastRefill = Date.now();
    },
  };
}

// ============================================================================
// Crypto Utilities
// ============================================================================

/**
 * Generate a secure random ID.
 */
export function generateSecureId(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a secure random token (URL-safe).
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Hash a string securely.
 */
export function hashString(input: string, algorithm: string = 'sha256'): string {
  return crypto.createHash(algorithm).update(input).digest('hex');
}

/**
 * Compare two strings in constant time.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================================
// Resource Limits
// ============================================================================

export interface ResourceLimits {
  maxMemoryMB: number;
  maxCPUPercent: number;
  maxFileSize: number;
  maxOpenFiles: number;
  maxExecutionTime: number;
}

const DEFAULT_LIMITS: ResourceLimits = {
  maxMemoryMB: 512,
  maxCPUPercent: 80,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxOpenFiles: 100,
  maxExecutionTime: 30000, // 30s
};

/**
 * Create a resource limiter.
 */
export function createResourceLimiter(limits?: Partial<ResourceLimits>): {
  check(): { ok: boolean; violations: string[] };
  enforce<T>(fn: () => Promise<T>): Promise<T>;
} {
  const config = { ...DEFAULT_LIMITS, ...limits };

  return {
    check(): { ok: boolean; violations: string[] } {
      const violations: string[] = [];
      const memUsage = process.memoryUsage();
      const memMB = memUsage.heapUsed / 1024 / 1024;

      if (memMB > config.maxMemoryMB) {
        violations.push(`Memory usage ${memMB.toFixed(1)}MB exceeds limit ${config.maxMemoryMB}MB`);
      }

      return {
        ok: violations.length === 0,
        violations,
      };
    },

    async enforce<T>(fn: () => Promise<T>): Promise<T> {
      const check = this.check();
      if (!check.ok) {
        throw new Error(`Resource limits exceeded: ${check.violations.join(', ')}`);
      }

      return Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution time limit exceeded')), config.maxExecutionTime)
        ),
      ]);
    },
  };
}

// ============================================================================
// Export All
// ============================================================================

export const Security = {
  // Validation
  validateString,
  validateNumber,
  validateBoolean,
  validateArray,
  validateEnum,
  validatePath,
  validateCommand,

  // Path security
  safePath,
  safePathAsync,

  // JSON security
  safeJsonParse,
  safeJsonStringify,

  // Command security
  escapeShellArg,

  // Error sanitization
  sanitizeError,
  sanitizeErrorMessage,

  // Rate limiting
  createRateLimiter,

  // Crypto
  generateSecureId,
  generateSecureToken,
  hashString,
  constantTimeCompare,

  // Resource limits
  createResourceLimiter,
};
