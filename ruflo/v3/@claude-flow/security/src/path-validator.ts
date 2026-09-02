/**
 * Path Validator - HIGH-2 Remediation
 *
 * Fixes path traversal vulnerabilities by:
 * - Validating all file paths against allowed prefixes
 * - Using path.resolve() for canonicalization
 * - Blocking traversal patterns (../, etc.)
 * - Enforcing path length limits
 *
 * Security Properties:
 * - Path canonicalization
 * - Prefix validation
 * - Symlink resolution (optional)
 * - Traversal pattern detection
 *
 * @module v3/security/path-validator
 */

import * as path from 'path';
import * as fs from 'fs/promises';

export interface PathValidatorConfig {
  /**
   * Allowed directory prefixes.
   * Paths must start with one of these after resolution.
   */
  allowedPrefixes: string[];

  /**
   * Blocked file extensions.
   * Files with these extensions are rejected.
   */
  blockedExtensions?: string[];

  /**
   * Blocked file names.
   * Files matching these names are rejected.
   */
  blockedNames?: string[];

  /**
   * Maximum path length.
   * Default: 4096 characters
   */
  maxPathLength?: number;

  /**
   * Whether to resolve symlinks.
   * Default: true
   */
  resolveSymlinks?: boolean;

  /**
   * Whether to allow paths that don't exist.
   * Default: true (for write operations)
   */
  allowNonExistent?: boolean;

  /**
   * Whether to allow hidden files/directories.
   * Default: false
   */
  allowHidden?: boolean;
}

export interface PathValidationResult {
  isValid: boolean;
  resolvedPath: string;
  relativePath: string;
  matchedPrefix: string;
  errors: string[];
}

export class PathValidatorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'PathValidatorError';
  }
}

/**
 * Dangerous path patterns that indicate traversal attempts.
 */
const TRAVERSAL_PATTERNS = [
  /\.\.\//,              // ../
  /\.\.\\/,              // ..\
  /\.\./,                // .. anywhere
  /%2e%2e/i,             // URL-encoded ..
  /%252e%252e/i,         // Double URL-encoded ..
  /\.%2e/i,              // Mixed encoding
  /%2e\./i,              // Mixed encoding
  /\0/,                  // Null byte
  /%00/,                 // URL-encoded null
];

/**
 * Default blocked file extensions (sensitive files).
 */
const DEFAULT_BLOCKED_EXTENSIONS = [
  '.env',
  '.pem',
  '.key',
  '.crt',
  '.pfx',
  '.p12',
  '.jks',
  '.keystore',
  '.secret',
  '.credentials',
];

/**
 * Default blocked file names (sensitive files).
 */
const DEFAULT_BLOCKED_NAMES = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.htpasswd',
  '.htaccess',
  'shadow',
  'passwd',
  'authorized_keys',
  'known_hosts',
  '.git',
  '.gitconfig',
  '.npmrc',
  '.docker',
];

/**
 * Path validator that prevents traversal attacks.
 *
 * This class validates file paths to ensure they stay within
 * allowed directories and don't access sensitive files.
 *
 * @example
 * ```typescript
 * const validator = new PathValidator({
 *   allowedPrefixes: ['/workspaces/project']
 * });
 *
 * const result = await validator.validate('/workspaces/project/src/file.ts');
 * if (result.isValid) {
 *   // Safe to use result.resolvedPath
 * }
 * ```
 */
export class PathValidator {
  private readonly config: Required<PathValidatorConfig>;
  private readonly resolvedPrefixes: string[];

  constructor(config: PathValidatorConfig) {
    this.config = {
      allowedPrefixes: config.allowedPrefixes,
      blockedExtensions: config.blockedExtensions ?? DEFAULT_BLOCKED_EXTENSIONS,
      blockedNames: config.blockedNames ?? DEFAULT_BLOCKED_NAMES,
      maxPathLength: config.maxPathLength ?? 4096,
      resolveSymlinks: config.resolveSymlinks ?? true,
      allowNonExistent: config.allowNonExistent ?? true,
      allowHidden: config.allowHidden ?? false,
    };

    if (this.config.allowedPrefixes.length === 0) {
      throw new PathValidatorError(
        'At least one allowed prefix must be specified',
        'EMPTY_PREFIXES'
      );
    }

    // Pre-resolve all prefixes
    this.resolvedPrefixes = this.config.allowedPrefixes.map(p =>
      path.resolve(p)
    );
  }

  /**
   * Validates a path against security rules.
   *
   * @param inputPath - The path to validate
   * @returns Validation result with resolved path
   */
  async validate(inputPath: string): Promise<PathValidationResult> {
    const errors: string[] = [];

    // Check for empty path
    if (!inputPath || inputPath.trim() === '') {
      return {
        isValid: false,
        resolvedPath: '',
        relativePath: '',
        matchedPrefix: '',
        errors: ['Path is empty'],
      };
    }

    // Check path length
    if (inputPath.length > this.config.maxPathLength) {
      return {
        isValid: false,
        resolvedPath: '',
        relativePath: '',
        matchedPrefix: '',
        errors: [`Path exceeds maximum length of ${this.config.maxPathLength}`],
      };
    }

    // Check for traversal patterns
    for (const pattern of TRAVERSAL_PATTERNS) {
      if (pattern.test(inputPath)) {
        return {
          isValid: false,
          resolvedPath: '',
          relativePath: '',
          matchedPrefix: '',
          errors: ['Path traversal pattern detected'],
        };
      }
    }

    // Resolve the path
    let resolvedPath: string;
    try {
      resolvedPath = path.resolve(inputPath);

      // Optionally resolve symlinks
      if (this.config.resolveSymlinks) {
        try {
          resolvedPath = await fs.realpath(resolvedPath);
        } catch (error: any) {
          // Path doesn't exist yet - use resolved path
          if (error.code !== 'ENOENT' || !this.config.allowNonExistent) {
            if (error.code === 'ENOENT') {
              errors.push('Path does not exist');
            } else {
              errors.push(`Failed to resolve path: ${error.message}`);
            }
          }
        }
      }
    } catch (error: any) {
      return {
        isValid: false,
        resolvedPath: '',
        relativePath: '',
        matchedPrefix: '',
        errors: [`Invalid path: ${error.message}`],
      };
    }

    // Check against allowed prefixes
    let matchedPrefix = '';
    let relativePath = '';
    let prefixMatched = false;

    for (const prefix of this.resolvedPrefixes) {
      if (resolvedPath === prefix || resolvedPath.startsWith(prefix + path.sep)) {
        prefixMatched = true;
        matchedPrefix = prefix;
        relativePath = resolvedPath.slice(prefix.length);
        if (relativePath.startsWith(path.sep)) {
          relativePath = relativePath.slice(1);
        }
        break;
      }
    }

    if (!prefixMatched) {
      return {
        isValid: false,
        resolvedPath,
        relativePath: '',
        matchedPrefix: '',
        errors: ['Path is outside allowed directories'],
      };
    }

    // Check for hidden files
    const pathParts = resolvedPath.split(path.sep);
    if (!this.config.allowHidden) {
      for (const part of pathParts) {
        if (part.startsWith('.') && part !== '.' && part !== '..') {
          errors.push('Hidden files/directories are not allowed');
          break;
        }
      }
    }

    // Check blocked file names
    const basename = path.basename(resolvedPath);
    if (this.config.blockedNames.includes(basename)) {
      errors.push(`File name "${basename}" is blocked`);
    }

    // Check blocked extensions
    const ext = path.extname(resolvedPath).toLowerCase();
    if (this.config.blockedExtensions.includes(ext)) {
      errors.push(`File extension "${ext}" is blocked`);
    }

    // Also check for double extensions (e.g., .tar.gz, .config.json)
    const fullname = basename.toLowerCase();
    for (const blockedExt of this.config.blockedExtensions) {
      if (fullname.endsWith(blockedExt)) {
        errors.push(`File extension "${blockedExt}" is blocked`);
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      resolvedPath,
      relativePath,
      matchedPrefix,
      errors,
    };
  }

  /**
   * Validates and returns resolved path, throwing on failure.
   *
   * @param inputPath - The path to validate
   * @returns Resolved path if valid
   * @throws PathValidatorError if validation fails
   */
  async validateOrThrow(inputPath: string): Promise<string> {
    const result = await this.validate(inputPath);

    if (!result.isValid) {
      throw new PathValidatorError(
        result.errors.join('; '),
        'VALIDATION_FAILED',
        inputPath
      );
    }

    return result.resolvedPath;
  }

  /**
   * Synchronous validation (without symlink resolution).
   *
   * @param inputPath - The path to validate
   * @returns Validation result
   */
  validateSync(inputPath: string): PathValidationResult {
    const errors: string[] = [];

    if (!inputPath || inputPath.trim() === '') {
      return {
        isValid: false,
        resolvedPath: '',
        relativePath: '',
        matchedPrefix: '',
        errors: ['Path is empty'],
      };
    }

    if (inputPath.length > this.config.maxPathLength) {
      return {
        isValid: false,
        resolvedPath: '',
        relativePath: '',
        matchedPrefix: '',
        errors: [`Path exceeds maximum length of ${this.config.maxPathLength}`],
      };
    }

    for (const pattern of TRAVERSAL_PATTERNS) {
      if (pattern.test(inputPath)) {
        return {
          isValid: false,
          resolvedPath: '',
          relativePath: '',
          matchedPrefix: '',
          errors: ['Path traversal pattern detected'],
        };
      }
    }

    const resolvedPath = path.resolve(inputPath);

    let matchedPrefix = '';
    let relativePath = '';
    let prefixMatched = false;

    for (const prefix of this.resolvedPrefixes) {
      if (resolvedPath === prefix || resolvedPath.startsWith(prefix + path.sep)) {
        prefixMatched = true;
        matchedPrefix = prefix;
        relativePath = resolvedPath.slice(prefix.length);
        if (relativePath.startsWith(path.sep)) {
          relativePath = relativePath.slice(1);
        }
        break;
      }
    }

    if (!prefixMatched) {
      return {
        isValid: false,
        resolvedPath,
        relativePath: '',
        matchedPrefix: '',
        errors: ['Path is outside allowed directories'],
      };
    }

    const pathParts = resolvedPath.split(path.sep);
    if (!this.config.allowHidden) {
      for (const part of pathParts) {
        if (part.startsWith('.') && part !== '.' && part !== '..') {
          errors.push('Hidden files/directories are not allowed');
          break;
        }
      }
    }

    const basename = path.basename(resolvedPath);
    if (this.config.blockedNames.includes(basename)) {
      errors.push(`File name "${basename}" is blocked`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (this.config.blockedExtensions.includes(ext)) {
      errors.push(`File extension "${ext}" is blocked`);
    }

    return {
      isValid: errors.length === 0,
      resolvedPath,
      relativePath,
      matchedPrefix,
      errors,
    };
  }

  /**
   * Securely joins path segments within allowed directories.
   *
   * @param prefix - Base directory (must be in allowedPrefixes)
   * @param segments - Path segments to join
   * @returns Validated resolved path
   */
  async securePath(prefix: string, ...segments: string[]): Promise<string> {
    // Join the segments
    const joined = path.join(prefix, ...segments);

    // Validate the result
    return this.validateOrThrow(joined);
  }

  /**
   * Adds a prefix to the allowed list at runtime.
   *
   * @param prefix - Prefix to add
   */
  addPrefix(prefix: string): void {
    const resolved = path.resolve(prefix);
    if (!this.resolvedPrefixes.includes(resolved)) {
      this.config.allowedPrefixes.push(prefix);
      this.resolvedPrefixes.push(resolved);
    }
  }

  /**
   * Returns the current allowed prefixes.
   */
  getAllowedPrefixes(): readonly string[] {
    return [...this.resolvedPrefixes];
  }

  /**
   * Checks if a path is within allowed prefixes (quick check).
   */
  isWithinAllowed(inputPath: string): boolean {
    try {
      const resolved = path.resolve(inputPath);
      return this.resolvedPrefixes.some(
        prefix => resolved === prefix || resolved.startsWith(prefix + path.sep)
      );
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create a path validator for a project directory.
 *
 * @param projectRoot - Root directory of the project
 * @returns Configured PathValidator
 */
export function createProjectPathValidator(projectRoot: string): PathValidator {
  const srcDir = path.join(projectRoot, 'src');
  const testDir = path.join(projectRoot, 'tests');
  const docsDir = path.join(projectRoot, 'docs');

  return new PathValidator({
    allowedPrefixes: [srcDir, testDir, docsDir],
    allowHidden: false,
  });
}

/**
 * Factory function to create a path validator for the entire project.
 *
 * @param projectRoot - Root directory of the project
 * @returns Configured PathValidator
 */
export function createFullProjectPathValidator(projectRoot: string): PathValidator {
  return new PathValidator({
    allowedPrefixes: [projectRoot],
    allowHidden: true, // Allow .gitignore, etc.
    blockedNames: [
      ...DEFAULT_BLOCKED_NAMES,
      'node_modules', // Block access to node_modules
    ],
  });
}
