/**
 * Input Validator - Comprehensive Input Validation
 *
 * Provides Zod-based validation schemas for all security-critical inputs.
 *
 * Security Properties:
 * - Type-safe validation
 * - Custom error messages
 * - Sanitization transforms
 * - Reusable schemas
 *
 * @module v3/security/input-validator
 */

import { z } from 'zod';

/**
 * Custom error map for security-focused messages
 */
const securityErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.too_big:
      return { message: `Input exceeds maximum allowed size` };
    case z.ZodIssueCode.too_small:
      return { message: `Input below minimum required size` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') {
        return { message: 'Invalid email format' };
      }
      if (issue.validation === 'url') {
        return { message: 'Invalid URL format' };
      }
      if (issue.validation === 'uuid') {
        return { message: 'Invalid UUID format' };
      }
      return { message: 'Invalid string format' };
    default:
      return { message: ctx.defaultError };
  }
};

// Apply custom error map globally for this module
z.setErrorMap(securityErrorMap);

/**
 * Common validation patterns as reusable regex
 */
const PATTERNS = {
  // Safe identifier: alphanumeric with underscore/hyphen
  SAFE_IDENTIFIER: /^[a-zA-Z][a-zA-Z0-9_-]*$/,

  // Safe filename: alphanumeric with dot, underscore, hyphen
  SAFE_FILENAME: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,

  // Safe path segment: no traversal
  SAFE_PATH_SEGMENT: /^[^<>:"|?*\x00-\x1f]+$/,

  // No shell metacharacters
  NO_SHELL_CHARS: /^[^;&|`$(){}><\n\r\0]+$/,

  // Semantic version
  SEMVER: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
};

/**
 * Validation limits
 */
const LIMITS = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MAX_EMAIL_LENGTH: 254,
  MAX_IDENTIFIER_LENGTH: 64,
  MAX_PATH_LENGTH: 4096,
  MAX_CONTENT_LENGTH: 1024 * 1024, // 1MB
  MAX_ARRAY_LENGTH: 1000,
  MAX_OBJECT_KEYS: 100,
};

// ============================================================================
// Base Validation Schemas
// ============================================================================

/**
 * Safe string that cannot contain shell metacharacters
 */
export const SafeStringSchema = z.string()
  .min(1, 'String cannot be empty')
  .max(LIMITS.MAX_CONTENT_LENGTH, 'String too long')
  .regex(PATTERNS.NO_SHELL_CHARS, 'String contains invalid characters');

/**
 * Safe identifier for IDs, names, etc.
 */
export const IdentifierSchema = z.string()
  .min(1, 'Identifier cannot be empty')
  .max(LIMITS.MAX_IDENTIFIER_LENGTH, 'Identifier too long')
  .regex(PATTERNS.SAFE_IDENTIFIER, 'Invalid identifier format');

/**
 * Safe filename
 */
export const FilenameSchema = z.string()
  .min(1, 'Filename cannot be empty')
  .max(255, 'Filename too long')
  .regex(PATTERNS.SAFE_FILENAME, 'Invalid filename format');

/**
 * Email schema with length limit
 */
export const EmailSchema = z.string()
  .email('Invalid email format')
  .max(LIMITS.MAX_EMAIL_LENGTH, 'Email too long')
  .toLowerCase();

/**
 * Password schema with complexity requirements
 */
export const PasswordSchema = z.string()
  .min(LIMITS.MIN_PASSWORD_LENGTH, `Password must be at least ${LIMITS.MIN_PASSWORD_LENGTH} characters`)
  .max(LIMITS.MAX_PASSWORD_LENGTH, `Password must not exceed ${LIMITS.MAX_PASSWORD_LENGTH} characters`)
  .refine((val) => /[A-Z]/.test(val), 'Password must contain uppercase letter')
  .refine((val) => /[a-z]/.test(val), 'Password must contain lowercase letter')
  .refine((val) => /\d/.test(val), 'Password must contain digit');

/**
 * UUID schema
 */
export const UUIDSchema = z.string().uuid('Invalid UUID format');

/**
 * URL schema with HTTPS enforcement
 */
export const HttpsUrlSchema = z.string()
  .url('Invalid URL format')
  .refine(
    (val) => val.startsWith('https://'),
    'URL must use HTTPS'
  );

/**
 * URL schema (allows HTTP for development)
 */
export const UrlSchema = z.string()
  .url('Invalid URL format');

/**
 * Semantic version schema
 */
export const SemverSchema = z.string()
  .regex(PATTERNS.SEMVER, 'Invalid semantic version format');

/**
 * Port number schema
 */
export const PortSchema = z.number()
  .int('Port must be an integer')
  .min(1, 'Port must be at least 1')
  .max(65535, 'Port must be at most 65535');

/**
 * IP address schema (v4)
 */
export const IPv4Schema = z.string()
  .ip({ version: 'v4', message: 'Invalid IPv4 address' });

/**
 * IP address schema (v4 or v6)
 */
export const IPSchema = z.string()
  .ip({ message: 'Invalid IP address' });

// ============================================================================
// Authentication Schemas
// ============================================================================

/**
 * User role schema
 */
export const UserRoleSchema = z.enum([
  'admin',
  'operator',
  'developer',
  'viewer',
  'service',
]);

/**
 * Permission schema
 */
export const PermissionSchema = z.enum([
  'swarm.create',
  'swarm.read',
  'swarm.update',
  'swarm.delete',
  'swarm.scale',
  'agent.spawn',
  'agent.read',
  'agent.terminate',
  'task.create',
  'task.read',
  'task.cancel',
  'metrics.read',
  'system.admin',
  'api.access',
]);

/**
 * Login request schema
 */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().length(6, 'MFA code must be 6 digits').optional(),
});

/**
 * User creation schema
 */
export const CreateUserSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  role: UserRoleSchema,
  permissions: z.array(PermissionSchema).optional(),
  isActive: z.boolean().optional().default(true),
});

/**
 * API key creation schema
 */
export const CreateApiKeySchema = z.object({
  name: IdentifierSchema,
  permissions: z.array(PermissionSchema).optional(),
  expiresAt: z.date().optional(),
});

// ============================================================================
// Agent & Task Schemas
// ============================================================================

/**
 * Agent type schema
 */
export const AgentTypeSchema = z.enum([
  'coder',
  'reviewer',
  'tester',
  'planner',
  'researcher',
  'security-architect',
  'security-auditor',
  'memory-specialist',
  'swarm-specialist',
  'integration-architect',
  'performance-engineer',
  'core-architect',
  'test-architect',
  'queen-coordinator',
  'project-coordinator',
]);

/**
 * Agent spawn request schema
 */
export const SpawnAgentSchema = z.object({
  type: AgentTypeSchema,
  id: IdentifierSchema.optional(),
  config: z.record(z.unknown()).optional(),
  timeout: z.number().positive().optional(),
});

/**
 * Task input schema
 */
export const TaskInputSchema = z.object({
  taskId: UUIDSchema,
  content: SafeStringSchema.max(10000, 'Task content too long'),
  agentType: AgentTypeSchema,
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Command & Path Schemas
// ============================================================================

/**
 * Command argument schema
 */
export const CommandArgumentSchema = z.string()
  .max(1024, 'Argument too long')
  .refine(
    (val) => !val.includes('\0'),
    'Argument contains null byte'
  )
  .refine(
    (val) => !/[;&|`$(){}><]/.test(val),
    'Argument contains shell metacharacters'
  );

/**
 * Path schema
 */
export const PathSchema = z.string()
  .max(LIMITS.MAX_PATH_LENGTH, 'Path too long')
  .refine(
    (val) => !val.includes('\0'),
    'Path contains null byte'
  )
  .refine(
    (val) => !val.includes('..'),
    'Path contains traversal pattern'
  );

// ============================================================================
// Configuration Schemas
// ============================================================================

/**
 * Security configuration schema
 */
export const SecurityConfigSchema = z.object({
  bcryptRounds: z.number().int().min(10).max(20).default(12),
  jwtExpiresIn: z.string().default('24h'),
  sessionTimeout: z.number().positive().default(3600000),
  maxLoginAttempts: z.number().int().positive().default(5),
  lockoutDuration: z.number().positive().default(900000),
  requireMFA: z.boolean().default(false),
});

/**
 * Executor configuration schema
 */
export const ExecutorConfigSchema = z.object({
  allowedCommands: z.array(IdentifierSchema).min(1),
  blockedPatterns: z.array(z.string()).optional(),
  timeout: z.number().positive().default(30000),
  maxBuffer: z.number().positive().default(10 * 1024 * 1024),
  cwd: PathSchema.optional(),
  allowSudo: z.boolean().default(false),
});

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Sanitizes a string by removing dangerous characters
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/\0/g, '')           // Remove null bytes
    .replace(/[<>]/g, '')          // Remove HTML brackets
    .replace(/javascript:/gi, '')  // Remove javascript: protocol
    .replace(/data:/gi, '')        // Remove data: protocol
    .trim();
}

/**
 * Sanitizes HTML entities
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitizes a path by removing traversal patterns
 */
export function sanitizePath(input: string): string {
  return input
    .replace(/\0/g, '')           // Remove null bytes
    .replace(/\.\./g, '')         // Remove traversal patterns
    .replace(/\/+/g, '/')         // Normalize slashes
    .replace(/^\//, '')           // Remove leading slash
    .trim();
}

// ============================================================================
// Validation Helper Class
// ============================================================================

export class InputValidator {
  /**
   * Validates input against a schema
   */
  static validate<T>(schema: z.ZodSchema<T>, input: unknown): T {
    return schema.parse(input);
  }

  /**
   * Safely validates input, returning result
   */
  static safeParse<T>(schema: z.ZodSchema<T>, input: unknown): z.SafeParseReturnType<unknown, T> {
    return schema.safeParse(input);
  }

  /**
   * Validates email
   */
  static validateEmail(email: string): string {
    return EmailSchema.parse(email);
  }

  /**
   * Validates password
   */
  static validatePassword(password: string): string {
    return PasswordSchema.parse(password);
  }

  /**
   * Validates identifier
   */
  static validateIdentifier(id: string): string {
    return IdentifierSchema.parse(id);
  }

  /**
   * Validates path
   */
  static validatePath(path: string): string {
    return PathSchema.parse(path);
  }

  /**
   * Validates command argument
   */
  static validateCommandArg(arg: string): string {
    return CommandArgumentSchema.parse(arg);
  }

  /**
   * Validates login request
   */
  static validateLoginRequest(data: unknown): z.infer<typeof LoginRequestSchema> {
    return LoginRequestSchema.parse(data);
  }

  /**
   * Validates user creation request
   */
  static validateCreateUser(data: unknown): z.infer<typeof CreateUserSchema> {
    return CreateUserSchema.parse(data);
  }

  /**
   * Validates task input
   */
  static validateTaskInput(data: unknown): z.infer<typeof TaskInputSchema> {
    return TaskInputSchema.parse(data);
  }
}

// ============================================================================
// Export all schemas for direct use
// ============================================================================

export {
  z,
  PATTERNS,
  LIMITS,
};
