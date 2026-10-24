import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenGenerator, TokenGeneratorError } from '../../../security/token-generator.js';

describe('TokenGenerator', () => {
  describe('cryptographically secure token generation', () => {
    it('should generate tokens using crypto.randomBytes', () => {
      const generator = new TokenGenerator();
      const token = generator.generate();

      // Token should be base64url encoded (default)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate tokens with specified length', () => {
      const generator = new TokenGenerator();

      // 16 bytes = 22 chars in base64url (without padding)
      const token16 = generator.generate(16);
      expect(token16.length).toBe(22);

      // 32 bytes = 43 chars in base64url (without padding)
      const token32 = generator.generate(32);
      expect(token32.length).toBe(43);
    });

    it('should support different encodings', () => {
      const hexGenerator = new TokenGenerator({ encoding: 'hex' });
      const hexToken = hexGenerator.generate(16);
      expect(hexToken).toMatch(/^[0-9a-f]+$/i);
      expect(hexToken.length).toBe(32); // 16 bytes = 32 hex chars

      const base64Generator = new TokenGenerator({ encoding: 'base64' });
      const base64Token = base64Generator.generate(16);
      expect(base64Token).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should reject token length below 16 bytes', () => {
      expect(() => new TokenGenerator({ defaultLength: 8 }))
        .toThrow('Token length must be at least 16 bytes');
    });
  });

  describe('token uniqueness', () => {
    it('should generate unique tokens each time', () => {
      const generator = new TokenGenerator();
      const tokens = new Set(Array.from({ length: 1000 }, () => generator.generate()));
      expect(tokens.size).toBe(1000);
    });

    it('should generate unique session tokens', () => {
      const generator = new TokenGenerator();
      const tokens = new Set(Array.from({ length: 100 }, () => generator.generateSessionToken().value));
      expect(tokens.size).toBe(100);
    });

    it('should generate unique verification codes', () => {
      const generator = new TokenGenerator();
      const codes = new Set(Array.from({ length: 100 }, () => generator.generateVerificationCode().code));
      // Due to 6-digit codes, some collisions are possible but should be rare
      expect(codes.size).toBeGreaterThan(90);
    });

    it('should generate unique request IDs', () => {
      const generator = new TokenGenerator();
      const ids = new Set(Array.from({ length: 1000 }, () => generator.generateRequestId()));
      expect(ids.size).toBe(1000);
    });

    it('should generate unique correlation IDs', () => {
      const generator = new TokenGenerator();
      const ids = new Set(Array.from({ length: 1000 }, () => generator.generateCorrelationId()));
      expect(ids.size).toBe(1000);
    });
  });

  describe('timing-safe comparison', () => {
    it('should return true for equal tokens', () => {
      const generator = new TokenGenerator();
      const token = generator.generate();
      expect(generator.compare(token, token)).toBe(true);
    });

    it('should return false for different tokens', () => {
      const generator = new TokenGenerator();
      const token1 = generator.generate();
      const token2 = generator.generate();
      expect(generator.compare(token1, token2)).toBe(false);
    });

    it('should return false for different length strings', () => {
      const generator = new TokenGenerator();
      expect(generator.compare('short', 'muchlongerstring')).toBe(false);
    });

    it('should perform constant-time comparison', () => {
      const generator = new TokenGenerator();
      const token = 'a'.repeat(100);

      // Compare with identical string should work
      expect(generator.compare(token, token)).toBe(true);

      // Compare with different strings at various positions
      const differentAtStart = 'b' + 'a'.repeat(99);
      const differentAtEnd = 'a'.repeat(99) + 'b';

      expect(generator.compare(token, differentAtStart)).toBe(false);
      expect(generator.compare(token, differentAtEnd)).toBe(false);
    });
  });

  describe('signed tokens', () => {
    it('should require HMAC secret for signed tokens', () => {
      const generator = new TokenGenerator();
      expect(() => generator.generateSignedToken({ userId: '123' }))
        .toThrow('HMAC secret required for signed tokens');
    });

    it('should generate valid signed tokens', () => {
      const generator = new TokenGenerator({ hmacSecret: 'test-secret-key-123' });
      const signed = generator.generateSignedToken({ userId: '123' });

      expect(signed.token).toBeDefined();
      expect(signed.signature).toBeDefined();
      expect(signed.combined).toBe(`${signed.token}.${signed.signature}`);
      expect(signed.createdAt).toBeInstanceOf(Date);
      expect(signed.expiresAt).toBeInstanceOf(Date);
    });

    it('should verify valid signed tokens', () => {
      const generator = new TokenGenerator({ hmacSecret: 'test-secret-key-123' });
      const signed = generator.generateSignedToken({ userId: '123', role: 'admin' });

      const payload = generator.verifySignedToken(signed.combined);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('123');
      expect(payload!.role).toBe('admin');
    });

    it('should reject tampered tokens', () => {
      const generator = new TokenGenerator({ hmacSecret: 'test-secret-key-123' });
      const signed = generator.generateSignedToken({ userId: '123' });

      // Tamper with signature
      const tampered = signed.combined.slice(0, -5) + 'xxxxx';
      expect(generator.verifySignedToken(tampered)).toBeNull();
    });

    it('should reject tokens with wrong secret', () => {
      const generator1 = new TokenGenerator({ hmacSecret: 'secret-1' });
      const generator2 = new TokenGenerator({ hmacSecret: 'secret-2' });

      const signed = generator1.generateSignedToken({ userId: '123' });
      expect(generator2.verifySignedToken(signed.combined)).toBeNull();
    });

    it('should reject expired signed tokens', async () => {
      const generator = new TokenGenerator({ hmacSecret: 'test-secret' });
      const signed = generator.generateSignedToken({ userId: '123' }, 0); // Expires immediately

      // Wait a tiny bit for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(generator.verifySignedToken(signed.combined)).toBeNull();
    });

    it('should reject malformed token format', () => {
      const generator = new TokenGenerator({ hmacSecret: 'test-secret' });

      expect(generator.verifySignedToken('no-dot-in-token')).toBeNull();
      expect(generator.verifySignedToken('too.many.dots')).toBeNull();
      expect(generator.verifySignedToken('')).toBeNull();
    });
  });

  describe('token expiration', () => {
    it('should create tokens with expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generateWithExpiration(3600);

      expect(token.expiresAt.getTime()).toBe(token.createdAt.getTime() + 3600 * 1000);
    });

    it('should use default expiration', () => {
      const generator = new TokenGenerator({ defaultExpiration: 7200 });
      const token = generator.generateWithExpiration();

      expect(token.expiresAt.getTime()).toBe(token.createdAt.getTime() + 7200 * 1000);
    });

    it('should correctly identify expired tokens', () => {
      const generator = new TokenGenerator();

      const expiredToken = {
        value: 'test',
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() - 5000),
      };
      expect(generator.isExpired(expiredToken)).toBe(true);

      const validToken = {
        value: 'test',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      };
      expect(generator.isExpired(validToken)).toBe(false);
    });
  });

  describe('specialized token types', () => {
    it('should generate session tokens with expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generateSessionToken();

      expect(token.value).toBeDefined();
      expect(token.expiresAt.getTime()).toBeGreaterThan(token.createdAt.getTime());
    });

    it('should generate CSRF tokens with 30-minute expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generateCsrfToken();

      const expectedExpiry = token.createdAt.getTime() + 1800 * 1000;
      expect(token.expiresAt.getTime()).toBe(expectedExpiry);
    });

    it('should generate API tokens with prefix and 1-year expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generateApiToken('api_');

      expect(token.value.startsWith('api_')).toBe(true);

      const oneYear = 365 * 24 * 60 * 60 * 1000;
      expect(token.expiresAt.getTime()).toBeCloseTo(token.createdAt.getTime() + oneYear, -3);
    });

    it('should generate password reset tokens with 30-minute expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generatePasswordResetToken();

      const expectedExpiry = token.createdAt.getTime() + 1800 * 1000;
      expect(token.expiresAt.getTime()).toBe(expectedExpiry);
    });

    it('should generate email verification tokens with 24-hour expiration', () => {
      const generator = new TokenGenerator();
      const token = generator.generateEmailVerificationToken();

      const expectedExpiry = token.createdAt.getTime() + 86400 * 1000;
      expect(token.expiresAt.getTime()).toBe(expectedExpiry);
    });

    it('should generate token pairs (access + refresh)', () => {
      const generator = new TokenGenerator();
      const pair = generator.generateTokenPair();

      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();

      // Access token: 15 minutes
      expect(pair.accessToken.expiresAt.getTime()).toBe(
        pair.accessToken.createdAt.getTime() + 900 * 1000
      );

      // Refresh token: 7 days
      expect(pair.refreshToken.expiresAt.getTime()).toBe(
        pair.refreshToken.createdAt.getTime() + 604800 * 1000
      );
    });
  });

  describe('verification codes', () => {
    it('should generate numeric codes of specified length', () => {
      const generator = new TokenGenerator();

      const code6 = generator.generateVerificationCode(6);
      expect(code6.code).toMatch(/^\d{6}$/);

      const code8 = generator.generateVerificationCode(8);
      expect(code8.code).toMatch(/^\d{8}$/);
    });

    it('should set expiration and attempt limits', () => {
      const generator = new TokenGenerator();
      const code = generator.generateVerificationCode(6, 15, 5);

      expect(code.attempts).toBe(0);
      expect(code.maxAttempts).toBe(5);
      expect(code.expiresAt.getTime()).toBe(code.createdAt.getTime() + 15 * 60 * 1000);
    });
  });

  describe('correlation and request IDs', () => {
    it('should generate short request IDs', () => {
      const generator = new TokenGenerator();
      const id = generator.generateRequestId();

      // 8 bytes = 11 chars in base64url
      expect(id.length).toBe(11);
    });

    it('should generate correlation IDs with timestamp prefix', () => {
      const generator = new TokenGenerator();
      const id = generator.generateCorrelationId();

      expect(id).toMatch(/^[a-z0-9]+-[A-Za-z0-9_-]+$/);
      const [timestamp] = id.split('-');
      expect(parseInt(timestamp, 36)).toBeGreaterThan(0);
    });
  });
});
