/**
 * Password Hasher - CVE-2 Remediation
 *
 * Fixes weak password hashing by replacing SHA-256 with hardcoded salt
 * with bcrypt using 12 rounds (configurable).
 *
 * Security Properties:
 * - bcrypt with adaptive cost factor (12 rounds)
 * - Automatic salt generation per password
 * - Timing-safe comparison
 * - Minimum password length enforcement
 *
 * @module v3/security/password-hasher
 */

import * as bcrypt from 'bcrypt';

export interface PasswordHasherConfig {
  /**
   * Number of bcrypt rounds (cost factor).
   * Default: 12 (recommended minimum for production)
   * Each increment doubles the computation time.
   */
  rounds?: number;

  /**
   * Minimum password length.
   * Default: 8 characters
   */
  minLength?: number;

  /**
   * Maximum password length.
   * Default: 128 characters (bcrypt limit is 72 bytes)
   */
  maxLength?: number;

  /**
   * Require at least one uppercase letter.
   * Default: true
   */
  requireUppercase?: boolean;

  /**
   * Require at least one lowercase letter.
   * Default: true
   */
  requireLowercase?: boolean;

  /**
   * Require at least one digit.
   * Default: true
   */
  requireDigit?: boolean;

  /**
   * Require at least one special character.
   * Default: false
   */
  requireSpecial?: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export class PasswordHashError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PasswordHashError';
  }
}

/**
 * Secure password hasher using bcrypt.
 *
 * This class replaces the vulnerable SHA-256 + hardcoded salt implementation
 * with industry-standard bcrypt hashing.
 *
 * @example
 * ```typescript
 * const hasher = new PasswordHasher({ rounds: 12 });
 * const hash = await hasher.hash('securePassword123');
 * const isValid = await hasher.verify('securePassword123', hash);
 * ```
 */
export class PasswordHasher {
  private readonly config: Required<PasswordHasherConfig>;

  constructor(config: PasswordHasherConfig = {}) {
    this.config = {
      rounds: config.rounds ?? 12,
      minLength: config.minLength ?? 8,
      maxLength: config.maxLength ?? 128,
      requireUppercase: config.requireUppercase ?? true,
      requireLowercase: config.requireLowercase ?? true,
      requireDigit: config.requireDigit ?? true,
      requireSpecial: config.requireSpecial ?? false,
    };

    // Validate configuration
    if (this.config.rounds < 10 || this.config.rounds > 20) {
      throw new PasswordHashError(
        'Bcrypt rounds must be between 10 and 20 for security and performance balance',
        'INVALID_ROUNDS'
      );
    }

    if (this.config.minLength < 8) {
      throw new PasswordHashError(
        'Minimum password length must be at least 8 characters',
        'INVALID_MIN_LENGTH'
      );
    }
  }

  /**
   * Validates password against configured requirements.
   *
   * @param password - The password to validate
   * @returns Validation result with errors if any
   */
  validate(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (!password) {
      errors.push('Password is required');
      return { isValid: false, errors };
    }

    if (password.length < this.config.minLength) {
      errors.push(`Password must be at least ${this.config.minLength} characters`);
    }

    if (password.length > this.config.maxLength) {
      errors.push(`Password must not exceed ${this.config.maxLength} characters`);
    }

    if (this.config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.config.requireDigit && !/\d/.test(password)) {
      errors.push('Password must contain at least one digit');
    }

    if (this.config.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Hashes a password using bcrypt.
   *
   * @param password - The plaintext password to hash
   * @returns The bcrypt hash
   * @throws PasswordHashError if password is invalid
   */
  async hash(password: string): Promise<string> {
    const validation = this.validate(password);

    if (!validation.isValid) {
      throw new PasswordHashError(
        validation.errors.join('; '),
        'VALIDATION_FAILED'
      );
    }

    try {
      // bcrypt automatically generates a random salt per hash
      return await bcrypt.hash(password, this.config.rounds);
    } catch (error) {
      throw new PasswordHashError(
        'Failed to hash password',
        'HASH_FAILED'
      );
    }
  }

  /**
   * Verifies a password against a bcrypt hash.
   * Uses timing-safe comparison internally.
   *
   * @param password - The plaintext password to verify
   * @param hash - The bcrypt hash to compare against
   * @returns True if password matches, false otherwise
   */
  async verify(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) {
      return false;
    }

    // Validate hash format (bcrypt hashes start with $2a$, $2b$, or $2y$)
    if (!this.isValidBcryptHash(hash)) {
      return false;
    }

    try {
      // bcrypt.compare uses timing-safe comparison
      return await bcrypt.compare(password, hash);
    } catch (error) {
      // Return false on any error to prevent timing attacks
      return false;
    }
  }

  /**
   * Checks if a hash needs to be rehashed with updated parameters.
   * Useful for upgrading hash strength over time.
   *
   * @param hash - The bcrypt hash to check
   * @returns True if hash should be updated
   */
  needsRehash(hash: string): boolean {
    if (!this.isValidBcryptHash(hash)) {
      return true;
    }

    // Extract rounds from hash (format: $2b$XX$...)
    const match = hash.match(/^\$2[aby]\$(\d{2})\$/);
    if (!match) {
      return true;
    }

    const hashRounds = parseInt(match[1], 10);
    return hashRounds < this.config.rounds;
  }

  /**
   * Validates bcrypt hash format.
   *
   * @param hash - The hash to validate
   * @returns True if valid bcrypt hash format
   */
  private isValidBcryptHash(hash: string): boolean {
    // bcrypt hash format: $2a$XX$22charsSalt31charsHash
    // Total length: 60 characters
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
  }

  /**
   * Returns current configuration (without sensitive defaults).
   */
  getConfig(): Readonly<Omit<Required<PasswordHasherConfig>, never>> {
    return { ...this.config };
  }
}

/**
 * Factory function to create a production-ready password hasher.
 *
 * @param rounds - Bcrypt rounds (default: 12)
 * @returns Configured PasswordHasher instance
 */
export function createPasswordHasher(rounds = 12): PasswordHasher {
  return new PasswordHasher({ rounds });
}
