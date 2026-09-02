/**
 * Token Generator - Secure Token Generation
 *
 * Provides cryptographically secure token generation for:
 * - JWT tokens
 * - Session tokens
 * - CSRF tokens
 * - API tokens
 * - Verification codes
 *
 * Security Properties:
 * - Uses crypto.randomBytes for all randomness
 * - Configurable entropy levels
 * - Timing-safe comparison
 * - Token expiration handling
 *
 * @module v3/security/token-generator
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

export interface TokenConfig {
  /**
   * Default token length in bytes.
   * Default: 32 (256 bits)
   */
  defaultLength?: number;

  /**
   * Token encoding format.
   * Default: 'base64url'
   */
  encoding?: 'hex' | 'base64' | 'base64url';

  /**
   * HMAC secret for signed tokens.
   */
  hmacSecret?: string;

  /**
   * Default expiration time in seconds.
   * Default: 3600 (1 hour)
   */
  defaultExpiration?: number;
}

export interface Token {
  value: string;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface SignedToken {
  token: string;
  signature: string;
  combined: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface VerificationCode {
  code: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

export class TokenGeneratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'TokenGeneratorError';
  }
}

/**
 * Secure token generator.
 *
 * @example
 * ```typescript
 * const generator = new TokenGenerator({ hmacSecret: 'secret' });
 *
 * // Generate session token
 * const session = generator.generateSessionToken();
 *
 * // Generate signed token
 * const signed = generator.generateSignedToken({ userId: '123' });
 *
 * // Verify signed token
 * const isValid = generator.verifySignedToken(signed.combined);
 * ```
 */
export class TokenGenerator {
  private readonly config: Required<TokenConfig>;

  constructor(config: TokenConfig = {}) {
    this.config = {
      defaultLength: config.defaultLength ?? 32,
      encoding: config.encoding ?? 'base64url',
      hmacSecret: config.hmacSecret ?? '',
      defaultExpiration: config.defaultExpiration ?? 3600,
    };

    if (this.config.defaultLength < 16) {
      throw new TokenGeneratorError(
        'Token length must be at least 16 bytes',
        'INVALID_LENGTH'
      );
    }
  }

  /**
   * Generates a random token.
   *
   * @param length - Token length in bytes
   * @returns Random token string
   */
  generate(length?: number): string {
    const len = length ?? this.config.defaultLength;
    const buffer = randomBytes(len);
    return this.encode(buffer);
  }

  /**
   * Generates a token with expiration.
   *
   * @param expirationSeconds - Expiration time in seconds
   * @param metadata - Optional metadata to attach
   * @returns Token with expiration
   */
  generateWithExpiration(
    expirationSeconds?: number,
    metadata?: Record<string, unknown>
  ): Token {
    const expiration = expirationSeconds ?? this.config.defaultExpiration;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiration * 1000);

    return {
      value: this.generate(),
      createdAt: now,
      expiresAt,
      metadata,
    };
  }

  /**
   * Generates a session token (URL-safe).
   *
   * @param length - Token length in bytes (default: 32)
   * @returns Session token
   */
  generateSessionToken(length = 32): Token {
    return this.generateWithExpiration(this.config.defaultExpiration);
  }

  /**
   * Generates a CSRF token.
   *
   * @returns CSRF token (shorter expiration)
   */
  generateCsrfToken(): Token {
    return this.generateWithExpiration(1800); // 30 minutes
  }

  /**
   * Generates an API token with prefix.
   *
   * @param prefix - Token prefix (e.g., 'cf_')
   * @returns Prefixed API token
   */
  generateApiToken(prefix = 'cf_'): Token {
    const tokenBody = this.generate(32);
    const now = new Date();

    return {
      value: `${prefix}${tokenBody}`,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year
    };
  }

  /**
   * Generates a numeric verification code.
   *
   * @param length - Number of digits (default: 6)
   * @param expirationMinutes - Expiration in minutes (default: 10)
   * @param maxAttempts - Maximum verification attempts (default: 3)
   * @returns Verification code
   */
  generateVerificationCode(
    length = 6,
    expirationMinutes = 10,
    maxAttempts = 3
  ): VerificationCode {
    const buffer = randomBytes(length);
    let code = '';

    for (let i = 0; i < length; i++) {
      code += (buffer[i] % 10).toString();
    }

    const now = new Date();

    return {
      code,
      createdAt: now,
      expiresAt: new Date(now.getTime() + expirationMinutes * 60 * 1000),
      attempts: 0,
      maxAttempts,
    };
  }

  /**
   * Generates a signed token using HMAC.
   *
   * @param payload - Data to include in token
   * @param expirationSeconds - Token expiration
   * @returns Signed token
   */
  generateSignedToken(
    payload: Record<string, unknown>,
    expirationSeconds?: number
  ): SignedToken {
    if (!this.config.hmacSecret) {
      throw new TokenGeneratorError(
        'HMAC secret required for signed tokens',
        'NO_SECRET'
      );
    }

    const expiration = expirationSeconds ?? this.config.defaultExpiration;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiration * 1000);

    const tokenData = {
      ...payload,
      iat: now.getTime(),
      exp: expiresAt.getTime(),
      nonce: this.generate(8),
    };

    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64url');
    const signature = this.sign(token);

    return {
      token,
      signature,
      combined: `${token}.${signature}`,
      createdAt: now,
      expiresAt,
    };
  }

  /**
   * Verifies a signed token.
   *
   * @param combined - Combined token string (token.signature)
   * @returns Decoded payload if valid, null otherwise
   */
  verifySignedToken(combined: string): Record<string, unknown> | null {
    if (!this.config.hmacSecret) {
      throw new TokenGeneratorError(
        'HMAC secret required for signed tokens',
        'NO_SECRET'
      );
    }

    const parts = combined.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [token, signature] = parts;

    // Verify signature
    const expectedSignature = this.sign(token);

    try {
      const sigBuffer = Buffer.from(signature, 'base64url');
      const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

      if (sigBuffer.length !== expectedBuffer.length) {
        return null;
      }

      if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
        return null;
      }
    } catch {
      return null;
    }

    // Decode and validate payload
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString());

      // Check expiration
      if (payload.exp && payload.exp < Date.now()) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Generates a refresh token pair.
   *
   * @returns Access and refresh tokens
   */
  generateTokenPair(): {
    accessToken: Token;
    refreshToken: Token;
  } {
    return {
      accessToken: this.generateWithExpiration(900), // 15 minutes
      refreshToken: this.generateWithExpiration(604800), // 7 days
    };
  }

  /**
   * Generates a password reset token.
   *
   * @returns Password reset token (short expiration)
   */
  generatePasswordResetToken(): Token {
    return this.generateWithExpiration(1800); // 30 minutes
  }

  /**
   * Generates an email verification token.
   *
   * @returns Email verification token
   */
  generateEmailVerificationToken(): Token {
    return this.generateWithExpiration(86400); // 24 hours
  }

  /**
   * Generates a unique request ID.
   *
   * @returns Request ID (shorter, for logging)
   */
  generateRequestId(): string {
    return this.generate(8);
  }

  /**
   * Generates a correlation ID for distributed tracing.
   *
   * @returns Correlation ID
   */
  generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const random = this.generate(8);
    return `${timestamp}-${random}`;
  }

  /**
   * Checks if a token has expired.
   *
   * @param token - Token to check
   * @returns True if expired
   */
  isExpired(token: Token | VerificationCode): boolean {
    return token.expiresAt < new Date();
  }

  /**
   * Compares two tokens in constant time.
   *
   * @param a - First token
   * @param b - Second token
   * @returns True if equal
   */
  compare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    try {
      const bufferA = Buffer.from(a);
      const bufferB = Buffer.from(b);
      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  /**
   * Signs data using HMAC-SHA256.
   */
  private sign(data: string): string {
    return createHmac('sha256', this.config.hmacSecret)
      .update(data)
      .digest('base64url');
  }

  /**
   * Encodes bytes according to configuration.
   */
  private encode(buffer: Buffer): string {
    switch (this.config.encoding) {
      case 'hex':
        return buffer.toString('hex');
      case 'base64':
        return buffer.toString('base64');
      case 'base64url':
      default:
        return buffer.toString('base64url');
    }
  }
}

/**
 * Factory function to create a production token generator.
 *
 * @param hmacSecret - HMAC secret for signed tokens
 * @returns Configured TokenGenerator
 */
export function createTokenGenerator(hmacSecret: string): TokenGenerator {
  return new TokenGenerator({
    hmacSecret,
    defaultLength: 32,
    encoding: 'base64url',
  });
}

/**
 * Singleton instance for quick token generation without configuration.
 */
let defaultGenerator: TokenGenerator | null = null;

/**
 * Gets or creates the default token generator.
 * Note: Does not support signed tokens without configuration.
 */
export function getDefaultGenerator(): TokenGenerator {
  if (!defaultGenerator) {
    defaultGenerator = new TokenGenerator();
  }
  return defaultGenerator;
}

/**
 * Quick token generation functions.
 */
export const quickGenerate = {
  token: (length = 32) => getDefaultGenerator().generate(length),
  sessionToken: () => getDefaultGenerator().generateSessionToken(),
  csrfToken: () => getDefaultGenerator().generateCsrfToken(),
  apiToken: (prefix = 'cf_') => getDefaultGenerator().generateApiToken(prefix),
  verificationCode: (length = 6) => getDefaultGenerator().generateVerificationCode(length),
  requestId: () => getDefaultGenerator().generateRequestId(),
  correlationId: () => getDefaultGenerator().generateCorrelationId(),
};
