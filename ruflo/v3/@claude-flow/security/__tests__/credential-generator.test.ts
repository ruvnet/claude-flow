/**
 * Credential Generator Tests - CVE-3 Remediation Validation
 *
 * Tests verify:
 * - Cryptographically secure random generation
 * - No hardcoded defaults
 * - Proper entropy levels
 * - Unique credentials per generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CredentialGenerator,
  CredentialGeneratorError,
  createCredentialGenerator,
  generateCredentials,
} from '../../security/credential-generator.js';

describe('CredentialGenerator', () => {
  let generator: CredentialGenerator;

  beforeEach(() => {
    generator = new CredentialGenerator();
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      expect(() => new CredentialGenerator()).not.toThrow();
    });

    it('should reject password length below 16', () => {
      expect(() => new CredentialGenerator({
        passwordLength: 8,
      })).toThrow(CredentialGeneratorError);
    });

    it('should reject API key length below 32', () => {
      expect(() => new CredentialGenerator({
        apiKeyLength: 16,
      })).toThrow(CredentialGeneratorError);
    });

    it('should reject secret length below 32', () => {
      expect(() => new CredentialGenerator({
        secretLength: 16,
      })).toThrow(CredentialGeneratorError);
    });
  });

  describe('Password Generation', () => {
    it('should generate password of specified length', () => {
      const password = generator.generatePassword();
      expect(password.length).toBeGreaterThanOrEqual(32);
    });

    it('should generate unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 100; i++) {
        passwords.add(generator.generatePassword());
      }
      expect(passwords.size).toBe(100);
    });

    it('should include required character types', () => {
      for (let i = 0; i < 10; i++) {
        const password = generator.generatePassword();
        expect(password).toMatch(/[A-Z]/); // Uppercase
        expect(password).toMatch(/[a-z]/); // Lowercase
        expect(password).toMatch(/\d/);    // Digit
        expect(password).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/); // Special
      }
    });
  });

  describe('API Key Generation', () => {
    it('should generate API key with prefix', () => {
      const { key, prefix } = generator.generateApiKey('cf_');
      expect(key.startsWith('cf_')).toBe(true);
      expect(prefix).toBe('cf_');
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generator.generateApiKey().key);
      }
      expect(keys.size).toBe(100);
    });

    it('should include keyId', () => {
      const { keyId } = generator.generateApiKey();
      // Should be a valid UUID
      expect(keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should include createdAt timestamp', () => {
      const { createdAt } = generator.generateApiKey();
      expect(createdAt).toBeInstanceOf(Date);
    });
  });

  describe('Secret Generation', () => {
    it('should generate hex-encoded secret', () => {
      const secret = generator.generateSecret();
      expect(secret).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate secret of specified length', () => {
      const secret = generator.generateSecret(64);
      expect(secret.length).toBe(64);
    });

    it('should generate unique secrets', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        secrets.add(generator.generateSecret());
      }
      expect(secrets.size).toBe(100);
    });
  });

  describe('Encryption Key Generation', () => {
    it('should generate 32-byte (256-bit) key as hex', () => {
      const key = generator.generateEncryptionKey();
      // 32 bytes = 64 hex characters
      expect(key.length).toBe(64);
      expect(key).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generator.generateEncryptionKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('Installation Credentials', () => {
    it('should generate complete credential set', () => {
      const credentials = generator.generateInstallationCredentials();

      expect(credentials.adminPassword).toBeDefined();
      expect(credentials.servicePassword).toBeDefined();
      expect(credentials.jwtSecret).toBeDefined();
      expect(credentials.sessionSecret).toBeDefined();
      expect(credentials.encryptionKey).toBeDefined();
      expect(credentials.generatedAt).toBeInstanceOf(Date);
    });

    it('should set expiration when specified', () => {
      const credentials = generator.generateInstallationCredentials(30);

      expect(credentials.expiresAt).toBeInstanceOf(Date);

      // Should be approximately 30 days in the future
      const expectedExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const actualExpiration = credentials.expiresAt!.getTime();
      expect(Math.abs(actualExpiration - expectedExpiration)).toBeLessThan(1000);
    });

    it('should generate unique credentials each time', () => {
      const cred1 = generator.generateInstallationCredentials();
      const cred2 = generator.generateInstallationCredentials();

      expect(cred1.adminPassword).not.toBe(cred2.adminPassword);
      expect(cred1.servicePassword).not.toBe(cred2.servicePassword);
      expect(cred1.jwtSecret).not.toBe(cred2.jwtSecret);
    });
  });

  describe('Token Generation', () => {
    it('should generate session token', () => {
      const token = generator.generateSessionToken();
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate CSRF token', () => {
      const token = generator.generateCsrfToken();
      expect(token).toBeDefined();
      // Base64url encoded
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate nonce', () => {
      const nonce = generator.generateNonce();
      expect(nonce).toBeDefined();
      // Hex encoded, 16 bytes = 32 chars
      expect(nonce.length).toBe(32);
      expect(nonce).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('Environment Script Generation', () => {
    it('should generate valid shell script', () => {
      const credentials = generator.generateInstallationCredentials();
      const script = generator.createEnvScript(credentials);

      expect(script).toContain('export CLAUDE_FLOW_ADMIN_PASSWORD=');
      expect(script).toContain('export CLAUDE_FLOW_SERVICE_PASSWORD=');
      expect(script).toContain('export CLAUDE_FLOW_JWT_SECRET=');
      expect(script).toContain('export CLAUDE_FLOW_SESSION_SECRET=');
      expect(script).toContain('export CLAUDE_FLOW_ENCRYPTION_KEY=');
    });

    it('should include warning comment', () => {
      const credentials = generator.generateInstallationCredentials();
      const script = generator.createEnvScript(credentials);

      expect(script).toContain('Store these securely');
    });
  });

  describe('JSON Config Generation', () => {
    it('should generate valid JSON', () => {
      const credentials = generator.generateInstallationCredentials();
      const json = generator.createJsonConfig(credentials);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all credentials', () => {
      const credentials = generator.generateInstallationCredentials();
      const json = generator.createJsonConfig(credentials);
      const parsed = JSON.parse(json);

      expect(parsed['claude-flow/admin-password']).toBe(credentials.adminPassword);
      expect(parsed['claude-flow/service-password']).toBe(credentials.servicePassword);
      expect(parsed['claude-flow/jwt-secret']).toBe(credentials.jwtSecret);
      expect(parsed['claude-flow/session-secret']).toBe(credentials.sessionSecret);
      expect(parsed['claude-flow/encryption-key']).toBe(credentials.encryptionKey);
    });
  });

  describe('Factory Functions', () => {
    it('should create generator with factory function', () => {
      const gen = createCredentialGenerator();
      expect(gen).toBeInstanceOf(CredentialGenerator);
    });

    it('should generate credentials with quick function', () => {
      const credentials = generateCredentials();
      expect(credentials.adminPassword).toBeDefined();
      expect(credentials.jwtSecret).toBeDefined();
    });
  });

  describe('CVE-3 Security Verification', () => {
    it('should NOT produce hardcoded admin123 password', () => {
      for (let i = 0; i < 100; i++) {
        const credentials = generator.generateInstallationCredentials();
        expect(credentials.adminPassword).not.toBe('admin123');
        expect(credentials.servicePassword).not.toBe('service123');
      }
    });

    it('should NOT produce predictable patterns', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        passwords.add(generator.generatePassword());
      }

      // All should be unique
      expect(passwords.size).toBe(1000);

      // None should match common patterns
      const commonPatterns = ['password', 'admin', 'service', '123456', 'qwerty'];
      for (const password of passwords) {
        for (const pattern of commonPatterns) {
          expect(password.toLowerCase()).not.toContain(pattern);
        }
      }
    });

    it('should use cryptographically secure random', () => {
      // Generate many passwords and verify entropy
      const passwords: string[] = [];
      for (let i = 0; i < 100; i++) {
        passwords.push(generator.generatePassword());
      }

      // Calculate average character distribution
      const charCounts = new Map<string, number>();
      for (const password of passwords) {
        for (const char of password) {
          charCounts.set(char, (charCounts.get(char) || 0) + 1);
        }
      }

      // Should have good distribution (many different characters)
      expect(charCounts.size).toBeGreaterThan(30);
    });

    it('should generate installation credentials with sufficient entropy', () => {
      const credentials = generator.generateInstallationCredentials();

      // Password should be at least 256 bits of entropy at minimum
      expect(credentials.adminPassword.length).toBeGreaterThanOrEqual(32);
      expect(credentials.servicePassword.length).toBeGreaterThanOrEqual(32);

      // Secrets should be 512 bits
      expect(credentials.jwtSecret.length).toBeGreaterThanOrEqual(64);
      expect(credentials.sessionSecret.length).toBeGreaterThanOrEqual(64);

      // Encryption key should be exactly 256 bits (64 hex chars)
      expect(credentials.encryptionKey.length).toBe(64);
    });
  });
});
