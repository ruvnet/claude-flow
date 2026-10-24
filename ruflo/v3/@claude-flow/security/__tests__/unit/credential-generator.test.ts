import { describe, it, expect } from 'vitest';
import { CredentialGenerator } from '../../../security/credential-generator.js';

describe('CredentialGenerator', () => {
  describe('generatePassword', () => {
    it('should generate passwords meeting complexity requirements', () => {
      const generator = new CredentialGenerator();
      const password = generator.generatePassword();

      expect(password.length).toBeGreaterThanOrEqual(32);
      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/\d/.test(password)).toBe(true);
    });

    it('should generate unique passwords each time', () => {
      const generator = new CredentialGenerator();
      const passwords = new Set(Array.from({ length: 100 }, () => generator.generatePassword()));
      expect(passwords.size).toBe(100);
    });

    it('should respect custom length parameter', () => {
      const generator = new CredentialGenerator();
      const password = generator.generatePassword(64);
      expect(password.length).toBe(64);
    });

    it('should include special characters by default', () => {
      const generator = new CredentialGenerator();
      const password = generator.generatePassword();
      expect(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)).toBe(true);
    });
  });

  describe('generateApiKey', () => {
    it('should generate API keys with prefix', () => {
      const generator = new CredentialGenerator();
      const key = generator.generateApiKey('test_');
      expect(key.key.startsWith('test_')).toBe(true);
    });

    it('should generate API keys with default prefix', () => {
      const generator = new CredentialGenerator();
      const key = generator.generateApiKey();
      expect(key.key.startsWith('cf_')).toBe(true);
    });

    it('should include keyId as UUID', () => {
      const generator = new CredentialGenerator();
      const key = generator.generateApiKey();
      expect(key.keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should include createdAt timestamp', () => {
      const generator = new CredentialGenerator();
      const before = new Date();
      const key = generator.generateApiKey();
      const after = new Date();
      expect(key.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(key.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should generate unique keys each time', () => {
      const generator = new CredentialGenerator();
      const keys = new Set(Array.from({ length: 100 }, () => generator.generateApiKey().key));
      expect(keys.size).toBe(100);
    });
  });

  describe('generateSecret', () => {
    it('should generate hex-encoded secrets', () => {
      const generator = new CredentialGenerator();
      const secret = generator.generateSecret();
      expect(/^[0-9a-f]+$/i.test(secret)).toBe(true);
    });

    it('should generate secrets with default length', () => {
      const generator = new CredentialGenerator();
      const secret = generator.generateSecret();
      expect(secret.length).toBe(64);
    });

    it('should generate secrets with custom length', () => {
      const generator = new CredentialGenerator();
      const secret = generator.generateSecret(128);
      expect(secret.length).toBe(128);
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate 64-character hex key (32 bytes)', () => {
      const generator = new CredentialGenerator();
      const key = generator.generateEncryptionKey();
      expect(key.length).toBe(64);
      expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
    });
  });

  describe('generateInstallationCredentials', () => {
    it('should generate complete credential set', () => {
      const generator = new CredentialGenerator();
      const creds = generator.generateInstallationCredentials();

      expect(creds.adminPassword).toBeDefined();
      expect(creds.servicePassword).toBeDefined();
      expect(creds.jwtSecret).toBeDefined();
      expect(creds.sessionSecret).toBeDefined();
      expect(creds.encryptionKey).toBeDefined();
      expect(creds.generatedAt).toBeInstanceOf(Date);
    });

    it('should set expiration when specified', () => {
      const generator = new CredentialGenerator();
      const creds = generator.generateInstallationCredentials(30);

      expect(creds.expiresAt).toBeDefined();
      const expectedExpiry = new Date(creds.generatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(creds.expiresAt!.getTime()).toBeCloseTo(expectedExpiry.getTime(), -3);
    });
  });

  describe('configuration validation', () => {
    it('should reject password length below 16', () => {
      expect(() => new CredentialGenerator({ passwordLength: 8 }))
        .toThrow('Password length must be at least 16 characters');
    });

    it('should reject API key length below 32', () => {
      expect(() => new CredentialGenerator({ apiKeyLength: 16 }))
        .toThrow('API key length must be at least 32 characters');
    });

    it('should reject secret length below 32', () => {
      expect(() => new CredentialGenerator({ secretLength: 16 }))
        .toThrow('Secret length must be at least 32 characters');
    });
  });

  describe('utility methods', () => {
    it('should generate session tokens', () => {
      const generator = new CredentialGenerator();
      const token = generator.generateSessionToken();
      expect(token.length).toBe(64);
    });

    it('should generate CSRF tokens', () => {
      const generator = new CredentialGenerator();
      const token = generator.generateCsrfToken();
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate nonces', () => {
      const generator = new CredentialGenerator();
      const nonce = generator.generateNonce();
      expect(nonce.length).toBe(32);
      expect(/^[0-9a-f]+$/i.test(nonce)).toBe(true);
    });
  });

  describe('output generation', () => {
    it('should create env script format', () => {
      const generator = new CredentialGenerator();
      const creds = generator.generateInstallationCredentials();
      const script = generator.createEnvScript(creds);

      expect(script).toContain('CLAUDE_FLOW_ADMIN_PASSWORD');
      expect(script).toContain('CLAUDE_FLOW_JWT_SECRET');
      expect(script).toContain('export');
    });

    it('should create JSON config format', () => {
      const generator = new CredentialGenerator();
      const creds = generator.generateInstallationCredentials();
      const json = generator.createJsonConfig(creds);

      const parsed = JSON.parse(json);
      expect(parsed['claude-flow/admin-password']).toBeDefined();
      expect(parsed['claude-flow/jwt-secret']).toBeDefined();
    });
  });
});
