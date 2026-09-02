/**
 * Input Validation Utilities
 *
 * Secure input validation and sanitization.
 *
 * @module v3/shared/security/input-validation
 */

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: unknown;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  allowedChars?: RegExp;
  required?: boolean;
  trim?: boolean;
}

/**
 * Default validation options
 */
const DEFAULT_OPTIONS: ValidationOptions = {
  maxLength: 10000,
  minLength: 0,
  required: false,
  trim: true,
};

/**
 * Validate and sanitize string input
 * @param input Input string
 * @param options Validation options
 * @returns Validation result
 */
export function validateInput(
  input: unknown,
  options: ValidationOptions = {}
): ValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check if input exists
  if (input === null || input === undefined) {
    if (opts.required) {
      return { valid: false, error: 'Input is required' };
    }
    return { valid: true, sanitized: null };
  }

  // Convert to string
  if (typeof input !== 'string') {
    return { valid: false, error: 'Input must be a string' };
  }

  let sanitized = input;

  // Trim whitespace
  if (opts.trim) {
    sanitized = sanitized.trim();
  }

  // Check length
  if (opts.minLength && sanitized.length < opts.minLength) {
    return {
      valid: false,
      error: `Input must be at least ${opts.minLength} characters`,
    };
  }

  if (opts.maxLength && sanitized.length > opts.maxLength) {
    return {
      valid: false,
      error: `Input must be at most ${opts.maxLength} characters`,
    };
  }

  // Check pattern
  if (opts.pattern && !opts.pattern.test(sanitized)) {
    return { valid: false, error: 'Input does not match required pattern' };
  }

  // Check allowed characters
  if (opts.allowedChars && !opts.allowedChars.test(sanitized)) {
    return { valid: false, error: 'Input contains invalid characters' };
  }

  return { valid: true, sanitized };
}

/**
 * Sanitize string by removing dangerous characters
 * @param input Input string
 * @returns Sanitized string
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
    .replace(/[\u2028\u2029]/g, '') // Remove line/paragraph separators
    .trim();
}

/**
 * Validate file path (prevent path traversal)
 * @param path File path
 * @param allowedBase Allowed base directory
 * @returns Validation result
 */
export function validatePath(
  path: string,
  allowedBase?: string
): ValidationResult {
  // Normalize and check for path traversal
  const normalized = path
    .replace(/\\/g, '/') // Normalize Windows paths
    .replace(/\/+/g, '/'); // Remove duplicate slashes

  // Check for dangerous patterns
  if (normalized.includes('..') || normalized.includes('~')) {
    return {
      valid: false,
      error: 'Path contains directory traversal characters',
    };
  }

  // Check for absolute paths outside allowed base
  if (allowedBase && !normalized.startsWith(allowedBase)) {
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
    if (isAbsolute) {
      return { valid: false, error: 'Path is outside allowed directory' };
    }
  }

  // Check for null bytes
  if (normalized.includes('\0')) {
    return { valid: false, error: 'Path contains null bytes' };
  }

  // Check length
  if (normalized.length > 4096) {
    return { valid: false, error: 'Path is too long' };
  }

  return { valid: true, sanitized: normalized };
}

/**
 * Validate command (prevent command injection)
 * @param command Command string
 * @param allowedCommands Optional whitelist of allowed commands
 * @returns Validation result
 */
export function validateCommand(
  command: string,
  allowedCommands?: string[]
): ValidationResult {
  // Extract base command
  const parts = command.trim().split(/\s+/);
  const baseCommand = parts[0]?.toLowerCase();

  if (!baseCommand) {
    return { valid: false, error: 'Empty command' };
  }

  // Check whitelist if provided
  if (allowedCommands && !allowedCommands.includes(baseCommand)) {
    return { valid: false, error: `Command '${baseCommand}' is not allowed` };
  }

  // Check for dangerous shell characters
  const dangerousPatterns = [
    /[;&|`$]/,     // Shell operators
    /\$\(/,        // Command substitution
    /`.*`/,        // Backtick substitution
    /\|\|/,        // OR operator
    /&&/,          // AND operator
    />\s*>/,       // Append redirection
    /<\s*</,       // Here document
    /\r|\n/,       // Newlines (command chaining)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { valid: false, error: 'Command contains dangerous characters' };
    }
  }

  return { valid: true, sanitized: command };
}

/**
 * Validate tags for safe SQL usage
 * @param tags Array of tag strings
 * @returns Validation result with sanitized tags
 */
export function validateTags(tags: unknown): ValidationResult {
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'Tags must be an array' };
  }

  const sanitized: string[] = [];
  const tagPattern = /^[a-zA-Z0-9_\-.:]+$/;

  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'Each tag must be a string' };
    }

    const trimmed = tag.trim();

    if (trimmed.length === 0) {
      continue; // Skip empty tags
    }

    if (trimmed.length > 100) {
      return { valid: false, error: 'Tag is too long (max 100 characters)' };
    }

    if (!tagPattern.test(trimmed)) {
      return {
        valid: false,
        error: `Invalid tag: '${trimmed}'. Tags can only contain alphanumeric characters, underscores, hyphens, dots, and colons`,
      };
    }

    sanitized.push(trimmed);
  }

  return { valid: true, sanitized };
}

/**
 * Check if string is a valid identifier
 * @param id Identifier string
 * @returns True if valid
 */
export function isValidIdentifier(id: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(id) && id.length <= 256;
}

/**
 * Escape string for safe SQL usage (use parameterized queries instead when possible)
 * This is a LAST RESORT - always prefer parameterized queries
 * @param value String to escape
 * @returns Escaped string
 */
export function escapeForSql(value: string): string {
  return value
    .replace(/'/g, "''") // Escape single quotes
    .replace(/\\/g, '\\\\') // Escape backslashes
    .replace(/\x00/g, '') // Remove null bytes
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\x1a/g, '\\Z'); // Escape ctrl+Z (EOF in Windows)
}
