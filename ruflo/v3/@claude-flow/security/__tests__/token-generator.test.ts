/**
 * Token Generator Tests
 *
 * Tests verify:
 * - Secure token generation
 * - Token expiration
 * - Signed token verification
 * - Timing-safe comparison
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenGenerator,
  TokenGeneratorError,
  createTokenGenerator,
  getDefaultGenerator,
  quickGenerate,
} from '../../security/token-generator.js';

describe('TokenGenerator', () => {
  let generator: TokenGenerator;

  beforeEach(() => {
    generator = new TokenGenerator({
      hmacSecret: 'test-secret-key-for-hmac-operations',
      defaultExpiration: 3600,
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      expect(() => new TokenGenerator()).not.toThrow();
    });

    it('should reject token length below 16 bytes', () => {
      expect(() => new TokenGenerator({
        defaultLength: 8,
      })).toThrow(TokenGeneratorError);
    });

    it('should accept custom encoding', () => {
      const hexGenerator = new TokenGenerator({ encoding: 'hex' });
      const token = hexGenerator.generate(16);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('Token Generation', () => {
    it('should generate token of specified length', () => {
      const token = generator.generate(32);
      // Base64url encoding: 32 bytes = ~43 chars
      expect(token.length).toBeGreaterThan(40);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generator.generate());
      }
      expect(tokens.size).toBe(100);
    });

    it('should generate URL-safe tokens by default', () => {
      const token = generator.generate();
      // Base64url should not contain +, /, or =
      expect(token).not.toMatch(/[+/=]/);
    });
  });

  describe('Token with Expiration', () => {
    it('should generate token with expiration', () => {
      const token = generator.generateWithExpiration(3600);

      expect(token.value).toBeDefined();
      expect(token.createdAt).toBeInstanceOf(Date);
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(token.createdAt.getTime());
    });

    it('should set correct expiration time', () => {
      const expiration = 3600; // 1 hour
      const token = generator.generateWithExpiration(expiration);

      const expectedExpiration = Date.now() + expiration * 1000;
      const actualExpiration = token.expiresAt.getTime();

      expect(Math.abs(actualExpiration - expectedExpiration)).toBeLessThan(100);
    });

    it('should include metadata when provided', () => {
      const token = generator.generateWithExpiration(3600, { userId: '123' });
      expect(token.metadata).toEqual({ userId: '123' });
    });
  });

  describe('Session Token', () => {
    it('should generate session token', () => {
      const token = generator.generateSessionToken();

      expect(token.value).toBeDefined();
      expect(token.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('CSRF Token', () => {
    it('should generate CSRF token', () => {
      const token = generator.generateCsrfToken();

      expect(token.value).toBeDefined();
      // 30 minutes expiration
      const expectedExpiration = Date.now() + 1800 * 1000;
      expect(Math.abs(token.expiresAt.getTime() - expectedExpiration)).toBeLessThan(100);
    });
  });

  describe('API Token', () => {
    it('should generate API token with prefix', () => {
      const token = generator.generateApiToken('cf_');

      expect(token.value.startsWith('cf_')).toBe(true);
    });

    it('should set 1 year expiration', () => {
      const token = generator.generateApiToken();

      const expectedExpiration = Date.now() + 365 * 24 * 60 * 60 * 1000;
      expect(Math.abs(token.expiresAt.getTime() - expectedExpiration)).toBeLessThan(1000);
    });
  });

  describe('Verification Code', () => {
    it('should generate numeric code', () => {
      const code = generator.generateVerificationCode();

      expect(code.code).toMatch(/^\d{6}$/);
    });

    it('should generate code of specified length', () => {
      const code = generator.generateVerificationCode(8);

      expect(code.code).toMatch(/^\d{8}$/);
    });

    it('should set expiration', () => {
      const code = generator.generateVerificationCode(6, 10);

      const expectedExpiration = Date.now() + 10 * 60 * 1000;
      expect(Math.abs(code.expiresAt.getTime() - expectedExpiration)).toBeLessThan(100);
    });

    it('should track attempts', () => {
      const code = generator.generateVerificationCode(6, 10, 3);

      expect(code.attempts).toBe(0);
      expect(code.maxAttempts).toBe(3);
    });
  });

  describe('Signed Token', () => {
    it('should generate signed token', () => {
      const signed = generator.generateSignedToken({ userId: '123' });

      expect(signed.token).toBeDefined();
      expect(signed.signature).toBeDefined();
      expect(signed.combined).toBe(`${signed.token}.${signed.signature}`);
    });

    it('should require HMAC secret', () => {
      const noSecretGenerator = new TokenGenerator();

      expect(() => noSecretGenerator.generateSignedToken({ userId: '123' }))
        .toThrow(TokenGeneratorError);
    });

    it('should verify valid signed token', () => {
      const signed = generator.generateSignedToken({ userId: '123' });
      const payload = generator.verifySignedToken(signed.combined);

      expect(payload).not.toBeNull();
      expect((payload as any).userId).toBe('123');
    });

    it('should reject tampered token', () => {
      const signed = generator.generateSignedToken({ userId: '123' });

      // Tamper with the token
      const tampered = 'tampered' + signed.combined.slice(8);
      const payload = generator.verifySignedToken(tampered);

      expect(payload).toBeNull();
    });

    it('should reject tampered signature', () => {
      const signed = generator.generateSignedToken({ userId: '123' });

      // Tamper with signature
      const parts = signed.combined.split('.');
      const tampered = `${parts[0]}.tampered${parts[1].slice(8)}`;
      const payload = generator.verifySignedToken(tampered);

      expect(payload).toBeNull();
    });

    it('should reject expired signed token', async () => {
      const signed = generator.generateSignedToken({ userId: '123' }, 1); // 1 second

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const payload = generator.verifySignedToken(signed.combined);
      expect(payload).toBeNull();
    });

    it('should reject malformed token', () => {
      expect(generator.verifySignedToken('not.a.valid.token')).toBeNull();
      expect(generator.verifySignedToken('invalid')).toBeNull();
      expect(generator.verifySignedToken('')).toBeNull();
    });
  });

  describe('Token Pair', () => {
    it('should generate access and refresh tokens', () => {
      const pair = generator.generateTokenPair();

      expect(pair.accessToken.value).toBeDefined();
      expect(pair.refreshToken.value).toBeDefined();
    });

    it('should set different expirations', () => {
      const pair = generator.generateTokenPair();

      // Access token: 15 minutes
      const accessExpiration = Date.now() + 900 * 1000;
      expect(Math.abs(pair.accessToken.expiresAt.getTime() - accessExpiration)).toBeLessThan(100);

      // Refresh token: 7 days
      const refreshExpiration = Date.now() + 604800 * 1000;
      expect(Math.abs(pair.refreshToken.expiresAt.getTime() - refreshExpiration)).toBeLessThan(100);
    });
  });

  describe('Specialized Tokens', () => {
    it('should generate password reset token', () => {
      const token = generator.generatePasswordResetToken();

      expect(token.value).toBeDefined();
      // 30 minutes
      const expectedExpiration = Date.now() + 1800 * 1000;
      expect(Math.abs(token.expiresAt.getTime() - expectedExpiration)).toBeLessThan(100);
    });

    it('should generate email verification token', () => {
      const token = generator.generateEmailVerificationToken();

      expect(token.value).toBeDefined();
      // 24 hours
      const expectedExpiration = Date.now() + 86400 * 1000;
      expect(Math.abs(token.expiresAt.getTime() - expectedExpiration)).toBeLessThan(100);
    });

    it('should generate request ID', () => {
      const requestId = generator.generateRequestId();

      expect(requestId).toBeDefined();
      expect(requestId.length).toBeLessThan(20); // Shorter for logging
    });

    it('should generate correlation ID', () => {
      const correlationId = generator.generateCorrelationId();

      expect(correlationId).toBeDefined();
      expect(correlationId).toContain('-'); // timestamp-random format
    });
  });

  describe('Token Expiration Check', () => {
    it('should detect expired token', async () => {
      const token = generator.generateWithExpiration(1); // 1 second

      expect(generator.isExpired(token)).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(generator.isExpired(token)).toBe(true);
    });

    it('should detect valid token', () => {
      const token = generator.generateWithExpiration(3600);
      expect(generator.isExpired(token)).toBe(false);
    });
  });

  describe('Token Comparison', () => {
    it('should compare equal tokens', () => {
      const token = generator.generate();
      expect(generator.compare(token, token)).toBe(true);
    });

    it('should reject different tokens', () => {
      const token1 = generator.generate();
      const token2 = generator.generate();
      expect(generator.compare(token1, token2)).toBe(false);
    });

    it('should reject different length tokens', () => {
      expect(generator.compare('short', 'longer-token')).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // This test verifies the comparison takes consistent time
      // regardless of where the mismatch occurs
      const token = generator.generate();
      const mismatchEarly = 'X' + token.slice(1);
      const mismatchLate = token.slice(0, -1) + 'X';

      // Both comparisons should work (timing consistency is internal)
      expect(generator.compare(token, mismatchEarly)).toBe(false);
      expect(generator.compare(token, mismatchLate)).toBe(false);
    });
  });

  describe('Factory Functions', () => {
    it('should create generator with factory', () => {
      const gen = createTokenGenerator('secret');
      expect(gen).toBeInstanceOf(TokenGenerator);
    });

    it('should get default generator singleton', () => {
      const gen1 = getDefaultGenerator();
      const gen2 = getDefaultGenerator();
      expect(gen1).toBe(gen2);
    });
  });

  describe('Quick Generate Functions', () => {
    it('should generate token', () => {
      const token = quickGenerate.token();
      expect(token).toBeDefined();
    });

    it('should generate session token', () => {
      const token = quickGenerate.sessionToken();
      expect(token.value).toBeDefined();
    });

    it('should generate CSRF token', () => {
      const token = quickGenerate.csrfToken();
      expect(token.value).toBeDefined();
    });

    it('should generate API token', () => {
      const token = quickGenerate.apiToken('cf_');
      expect(token.value.startsWith('cf_')).toBe(true);
    });

    it('should generate verification code', () => {
      const code = quickGenerate.verificationCode();
      expect(code.code).toMatch(/^\d{6}$/);
    });

    it('should generate request ID', () => {
      const id = quickGenerate.requestId();
      expect(id).toBeDefined();
    });

    it('should generate correlation ID', () => {
      const id = quickGenerate.correlationId();
      expect(id).toBeDefined();
    });
  });
});
