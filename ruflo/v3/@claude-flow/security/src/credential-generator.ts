/**
 * Credential Generator - CVE-3 Remediation
 *
 * Fixes hardcoded default credentials by providing secure random
 * credential generation for installation and runtime.
 *
 * Security Properties:
 * - Uses crypto.randomBytes for cryptographically secure randomness
 * - Configurable entropy levels
 * - No hardcoded defaults stored in code
 * - Secure credential storage recommendations
 *
 * @module v3/security/credential-generator
 */

import { randomBytes, randomUUID } from 'crypto';

export interface CredentialConfig {
  /**
   * Length of generated passwords.
   * Default: 32 characters
   */
  passwordLength?: number;

  /**
   * Length of generated API keys.
   * Default: 48 characters
   */
  apiKeyLength?: number;

  /**
   * Length of generated secrets (JWT, session, etc.).
   * Default: 64 characters
   */
  secretLength?: number;

  /**
   * Character set for password generation.
   * Default: alphanumeric + special
   */
  passwordCharset?: string;

  /**
   * Character set for API key generation.
   * Default: alphanumeric only (URL-safe)
   */
  apiKeyCharset?: string;
}

export interface GeneratedCredentials {
  adminPassword: string;
  servicePassword: string;
  jwtSecret: string;
  sessionSecret: string;
  encryptionKey: string;
  generatedAt: Date;
  expiresAt?: Date;
}

export interface ApiKeyCredential {
  key: string;
  prefix: string;
  keyId: string;
  createdAt: Date;
}

export class CredentialGeneratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'CredentialGeneratorError';
  }
}

/**
 * Character sets for credential generation
 */
const CHARSETS = {
  UPPERCASE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  LOWERCASE: 'abcdefghijklmnopqrstuvwxyz',
  DIGITS: '0123456789',
  SPECIAL: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  // URL-safe characters for API keys
  URL_SAFE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  // Hex characters for secrets
  HEX: '0123456789abcdef',
} as const;

/**
 * Secure credential generator.
 *
 * This class provides cryptographically secure credential generation
 * to replace hardcoded default credentials.
 *
 * @example
 * ```typescript
 * const generator = new CredentialGenerator();
 * const credentials = generator.generateInstallationCredentials();
 * // Store credentials securely (environment variables, secrets manager)
 * ```
 */
export class CredentialGenerator {
  private readonly config: Required<CredentialConfig>;

  constructor(config: CredentialConfig = {}) {
    this.config = {
      passwordLength: config.passwordLength ?? 32,
      apiKeyLength: config.apiKeyLength ?? 48,
      secretLength: config.secretLength ?? 64,
      passwordCharset: config.passwordCharset ??
        CHARSETS.UPPERCASE + CHARSETS.LOWERCASE + CHARSETS.DIGITS + CHARSETS.SPECIAL,
      apiKeyCharset: config.apiKeyCharset ?? CHARSETS.URL_SAFE,
    };

    this.validateConfig();
  }

  /**
   * Validates configuration parameters.
   */
  private validateConfig(): void {
    if (this.config.passwordLength < 16) {
      throw new CredentialGeneratorError(
        'Password length must be at least 16 characters',
        'INVALID_PASSWORD_LENGTH'
      );
    }

    if (this.config.apiKeyLength < 32) {
      throw new CredentialGeneratorError(
        'API key length must be at least 32 characters',
        'INVALID_API_KEY_LENGTH'
      );
    }

    if (this.config.secretLength < 32) {
      throw new CredentialGeneratorError(
        'Secret length must be at least 32 characters',
        'INVALID_SECRET_LENGTH'
      );
    }
  }

  /**
   * Generates a cryptographically secure random string using rejection sampling
   * to eliminate modulo bias.
   *
   * @param length - Length of the string to generate
   * @param charset - Character set to use
   * @returns Random string
   */
  private generateSecureString(length: number, charset: string): string {
    const charsetLength = charset.length;
    const result = new Array(length);

    // Calculate rejection threshold to eliminate modulo bias
    // For a byte (0-255), we reject values >= (256 - (256 % charsetLength))
    // This ensures uniform distribution over charset indices
    const maxValidValue = 256 - (256 % charsetLength);

    let i = 0;
    while (i < length) {
      // Generate more random bytes than needed to reduce iterations
      const randomBuffer = randomBytes(Math.max(length - i, 16));

      for (let j = 0; j < randomBuffer.length && i < length; j++) {
        const randomValue = randomBuffer[j];

        // Rejection sampling: only accept values below threshold
        if (randomValue < maxValidValue) {
          result[i] = charset[randomValue % charsetLength];
          i++;
        }
        // Values >= maxValidValue are rejected to avoid bias
      }
    }

    return result.join('');
  }

  /**
   * Generates a secure random password.
   *
   * @param length - Optional custom length (default from config)
   * @returns Secure random password
   */
  generatePassword(length?: number): string {
    const len = length ?? this.config.passwordLength;

    // Ensure password contains at least one of each required character type
    const password = this.generateSecureString(len, this.config.passwordCharset);

    // Validate the generated password meets requirements
    if (!this.hasRequiredCharacterTypes(password)) {
      // Regenerate if requirements not met (rare case)
      return this.generatePassword(length);
    }

    return password;
  }

  /**
   * Checks if password has required character types.
   */
  private hasRequiredCharacterTypes(password: string): boolean {
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);

    return hasUppercase && hasLowercase && hasDigit && hasSpecial;
  }

  /**
   * Generates a secure API key.
   *
   * @param prefix - Optional prefix for the key (e.g., 'cf_')
   * @returns API key credential with metadata
   */
  generateApiKey(prefix = 'cf_'): ApiKeyCredential {
    const keyBody = this.generateSecureString(
      this.config.apiKeyLength - prefix.length,
      this.config.apiKeyCharset
    );

    const key = `${prefix}${keyBody}`;
    const keyId = randomUUID();

    return {
      key,
      prefix,
      keyId,
      createdAt: new Date(),
    };
  }

  /**
   * Generates a secure secret for JWT, sessions, etc.
   *
   * @param length - Optional custom length (default from config)
   * @returns Hex-encoded secret
   */
  generateSecret(length?: number): string {
    const len = length ?? this.config.secretLength;
    // Generate raw bytes and encode as hex for consistent storage
    return randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  }

  /**
   * Generates an encryption key suitable for AES-256.
   *
   * @returns 32-byte key encoded as hex (64 characters)
   */
  generateEncryptionKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generates a complete set of installation credentials.
   *
   * These should be stored securely (environment variables,
   * secrets manager, etc.) and NEVER committed to version control.
   *
   * @param expirationDays - Optional expiration period in days
   * @returns Complete credential set
   */
  generateInstallationCredentials(expirationDays?: number): GeneratedCredentials {
    const now = new Date();
    const expiresAt = expirationDays
      ? new Date(now.getTime() + expirationDays * 24 * 60 * 60 * 1000)
      : undefined;

    return {
      adminPassword: this.generatePassword(),
      servicePassword: this.generatePassword(),
      jwtSecret: this.generateSecret(64),
      sessionSecret: this.generateSecret(64),
      encryptionKey: this.generateEncryptionKey(),
      generatedAt: now,
      expiresAt,
    };
  }

  /**
   * Generates a secure session token.
   *
   * @returns URL-safe session token
   */
  generateSessionToken(): string {
    return this.generateSecureString(64, CHARSETS.URL_SAFE);
  }

  /**
   * Generates a secure CSRF token.
   *
   * @returns CSRF token
   */
  generateCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generates a secure nonce for one-time use.
   *
   * @returns Unique nonce value
   */
  generateNonce(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Creates a setup script output for secure credential deployment.
   *
   * @param credentials - Generated credentials
   * @returns Environment variable export script
   */
  createEnvScript(credentials: GeneratedCredentials): string {
    return `# Claude Flow V3 - Generated Credentials
# Generated: ${credentials.generatedAt.toISOString()}
# IMPORTANT: Store these securely and delete this file after use

export CLAUDE_FLOW_ADMIN_PASSWORD="${credentials.adminPassword}"
export CLAUDE_FLOW_SERVICE_PASSWORD="${credentials.servicePassword}"
export CLAUDE_FLOW_JWT_SECRET="${credentials.jwtSecret}"
export CLAUDE_FLOW_SESSION_SECRET="${credentials.sessionSecret}"
export CLAUDE_FLOW_ENCRYPTION_KEY="${credentials.encryptionKey}"
`;
  }

  /**
   * Creates a JSON configuration output for secure credential deployment.
   *
   * @param credentials - Generated credentials
   * @returns JSON configuration (for secrets manager import)
   */
  createJsonConfig(credentials: GeneratedCredentials): string {
    return JSON.stringify({
      'claude-flow/admin-password': credentials.adminPassword,
      'claude-flow/service-password': credentials.servicePassword,
      'claude-flow/jwt-secret': credentials.jwtSecret,
      'claude-flow/session-secret': credentials.sessionSecret,
      'claude-flow/encryption-key': credentials.encryptionKey,
      'claude-flow/generated-at': credentials.generatedAt.toISOString(),
      'claude-flow/expires-at': credentials.expiresAt?.toISOString() ?? null,
    }, null, 2);
  }
}

/**
 * Factory function to create a production credential generator.
 *
 * @returns Configured CredentialGenerator instance
 */
export function createCredentialGenerator(): CredentialGenerator {
  return new CredentialGenerator();
}

/**
 * Quick credential generation for CLI usage.
 *
 * @returns Generated installation credentials
 */
export function generateCredentials(): GeneratedCredentials {
  const generator = new CredentialGenerator();
  return generator.generateInstallationCredentials();
}
