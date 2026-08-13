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
 * Canonicalization is symmetric: a candidate is only ever compared against
 * prefixes held in the same form it was resolved in. Canonicalizing one side
 * and not the other silently denies everything under a symlinked prefix
 * (async) or silently accepts an escape through one (sync).
 *
 * @module v3/security/path-validator
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { realpathSync } from 'fs';

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
 * Canonicalizes a path that may not exist yet, by resolving the longest
 * ancestor that DOES exist and re-attaching the remaining segments.
 *
 * Plain `realpath` throws ENOENT for a path whose leaf is missing, which
 * would leave the caller comparing a canonical prefix against a merely
 * lexical candidate — the asymmetry this whole helper exists to avoid.
 * Walking up also means a symlinked PARENT is still resolved, so a
 * not-yet-created file under a symlinked directory canonicalizes to its
 * real location instead of its lexical one.
 *
 * Falls back to the lexical path if the ancestor walk itself fails (EACCES,
 * ELOOP, …), preserving the previous behaviour rather than throwing out of
 * a validation call.
 */
async function canonicalize(resolvedPath: string): Promise<string> {
  try {
    return await fs.realpath(resolvedPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      return resolvedPath;
    }
  }

  const parent = path.dirname(resolvedPath);
  // dirname() of a root ('/' or 'C:\\') is itself — stop instead of recursing.
  if (parent === resolvedPath) {
    return resolvedPath;
  }

  return path.join(await canonicalize(parent), path.basename(resolvedPath));
}

/**
 * Synchronous twin of {@link canonicalize}, for the constructor and
 * {@link PathValidator.addPrefix} which cannot await.
 */
function canonicalizeSync(resolvedPath: string): string {
  try {
    return realpathSync(resolvedPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      return resolvedPath;
    }
  }

  const parent = path.dirname(resolvedPath);
  if (parent === resolvedPath) {
    return resolvedPath;
  }

  return path.join(canonicalizeSync(parent), path.basename(resolvedPath));
}

/**
 * True if `resolvedPath` is the prefix itself or sits underneath it.
 *
 * The separator has to be appended to anchor the match at a path boundary, so
 * `/srv/app-secrets` does not count as inside `/srv/app` — but a root prefix
 * (`/`, `C:\`, a UNC share root) already ends in one, and appending a second
 * looked for `//`, which rejected every descendant of a root prefix.
 */
function isWithinPrefix(resolvedPath: string, prefix: string): boolean {
  if (resolvedPath === prefix) {
    return true;
  }
  const boundary = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
  return resolvedPath.startsWith(boundary);
}

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
  /** Lexically resolved prefixes — compared against lexically resolved candidates. */
  private readonly resolvedPrefixes: string[];
  /**
   * Symlink-resolved prefixes — compared against symlink-resolved candidates.
   *
   * Kept as a SECOND list rather than replacing `resolvedPrefixes`, because
   * the two comparison sites derive their candidate differently: `validate()`
   * canonicalizes through the filesystem, `validateSync()`/`isWithinAllowed()`
   * are documented as lexical-only. Canonicalizing one side without the other
   * is exactly the bug this fixes, in whichever direction it is done.
   *
   * Resolved once, at construction — so an allowed prefix denotes the
   * directory it named when the validator was configured, and retargeting a
   * symlink afterwards cannot silently redirect the allowlist. Re-resolving on
   * every call would hand that control to whoever can write the link, and cost
   * a syscall per validation. Callers needing to follow a moved target should
   * construct a new validator.
   */
  private readonly canonicalPrefixes: string[];

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

    // Pre-resolve all prefixes, lexically and canonically. #3010 — validate()
    // canonicalizes the *candidate* through fs.realpath (when resolveSymlinks
    // is on, the default) but prefixes were only ever path.resolve()d, never
    // realpath'd. On any platform where the prefix itself is reached through a
    // symlink (e.g. macOS os.tmpdir() -> /var/folders/... while /var is itself
    // a symlink to /private/var), the realpath'd candidate can never match the
    // non-realpath'd prefix, and every path under that prefix is rejected as
    // "outside allowed directories" — including the prefix's own contents.
    this.resolvedPrefixes = this.config.allowedPrefixes.map(p =>
      path.resolve(p)
    );
    // Always a distinct array — `addPrefix` appends to both, so aliasing the
    // lexical list would push twice. With resolveSymlinks off no candidate is
    // ever canonicalized and nothing reads this list, so skip the syscall.
    this.canonicalPrefixes = this.resolvedPrefixes.map(p =>
      this.config.resolveSymlinks ? canonicalizeSync(p) : p
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
    // Which prefix list this candidate may legitimately be compared against:
    // only a symlink-resolved candidate may be matched against symlink-resolved
    // prefixes. See `canonicalPrefixes`.
    let symlinksResolved = false;
    try {
      resolvedPath = path.resolve(inputPath);

      // Optionally resolve symlinks
      if (this.config.resolveSymlinks) {
        try {
          resolvedPath = await fs.realpath(resolvedPath);
          symlinksResolved = true;
        } catch (error: any) {
          // Path doesn't exist yet - use resolved path
          if (error.code !== 'ENOENT' || !this.config.allowNonExistent) {
            if (error.code === 'ENOENT') {
              errors.push('Path does not exist');
            } else {
              errors.push(`Failed to resolve path: ${error.message}`);
            }
          }
          if (error.code === 'ENOENT' && this.config.allowNonExistent) {
            // The leaf does not exist, but its ancestors may still be
            // symlinks. Canonicalize what exists so the candidate is in the
            // same form as `canonicalPrefixes` — otherwise every not-yet-
            // created path under a symlinked prefix (macOS `/var` ->
            // `/private/var`, `/tmp` -> `/private/tmp`) fails to match.
            //
            // Only when non-existent paths are actually allowed: with
            // `allowNonExistent: false` this call is already a failure, and
            // canonicalizing anyway would change the `resolvedPath` and
            // `matchedPrefix` reported to callers for no benefit.
            resolvedPath = await canonicalize(resolvedPath);
            symlinksResolved = true;
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

    const prefixes = symlinksResolved
      ? this.canonicalPrefixes
      : this.resolvedPrefixes;

    for (const prefix of prefixes) {
      if (isWithinPrefix(resolvedPath, prefix)) {
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
      if (isWithinPrefix(resolvedPath, prefix)) {
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
      this.canonicalPrefixes.push(
        this.config.resolveSymlinks ? canonicalizeSync(resolved) : resolved
      );
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
        prefix => isWithinPrefix(resolved, prefix)
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
