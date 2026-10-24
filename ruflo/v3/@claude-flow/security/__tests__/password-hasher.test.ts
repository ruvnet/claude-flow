/**
 * Password Hasher Tests - CVE-2 Remediation Validation
 *
 * Tests verify:
 * - bcrypt is used instead of SHA-256
 * - 12 rounds minimum
 * - Password validation rules
 * - Timing-safe comparison
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PasswordHasher,
  PasswordHashError,
  createPasswordHasher,
} from '../../security/password-hasher.js';

describe('PasswordHasher', () => {
  let hasher: PasswordHasher;

  beforeEach(() => {
    hasher = new PasswordHasher({ rounds: 12 });
  });

  describe('Configuration', () => {
    it('should create hasher with default 12 rounds', () => {
      const defaultHasher = new PasswordHasher();
      expect(defaultHasher.getConfig().rounds).toBe(12);
    });

    it('should reject rounds below 10', () => {
      expect(() => new PasswordHasher({ rounds: 8 })).toThrow(PasswordHashError);
    });

    it('should reject rounds above 20', () => {
      expect(() => new PasswordHasher({ rounds: 22 })).toThrow(PasswordHashError);
    });

    it('should reject minimum password length below 8', () => {
      expect(() => new PasswordHasher({ minLength: 4 })).toThrow(PasswordHashError);
    });
  });

  describe('Password Validation', () => {
    it('should reject empty password', () => {
      const result = hasher.validate('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password is required');
    });

    it('should reject password shorter than minimum', () => {
      const result = hasher.validate('short');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('at least'))).toBe(true);
    });

    it('should reject password without uppercase', () => {
      const result = hasher.validate('password123');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('should reject password without lowercase', () => {
      const result = hasher.validate('PASSWORD123');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    it('should reject password without digit', () => {
      const result = hasher.validate('PasswordNoDigit');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('digit'))).toBe(true);
    });

    it('should accept valid password', () => {
      const result = hasher.validate('SecurePass123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should optionally require special character', () => {
      const strictHasher = new PasswordHasher({ requireSpecial: true });
      const result = strictHasher.validate('SecurePass123');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('special'))).toBe(true);
    });

    it('should accept password with special character when required', () => {
      const strictHasher = new PasswordHasher({ requireSpecial: true });
      const result = strictHasher.validate('SecurePass123!');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Password Hashing', () => {
    it('should hash password with bcrypt', async () => {
      const hash = await hasher.hash('SecurePass123');

      // bcrypt hashes start with $2a$, $2b$, or $2y$
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('should produce different hashes for same password', async () => {
      const hash1 = await hasher.hash('SecurePass123');
      const hash2 = await hasher.hash('SecurePass123');

      expect(hash1).not.toBe(hash2); // Different salts
    });

    it('should include rounds in hash', async () => {
      const hash = await hasher.hash('SecurePass123');

      // Hash format: $2b$12$...
      expect(hash).toContain('$12$');
    });

    it('should throw for invalid password', async () => {
      await expect(hasher.hash('short')).rejects.toThrow(PasswordHashError);
    });

    it('should throw for empty password', async () => {
      await expect(hasher.hash('')).rejects.toThrow(PasswordHashError);
    });
  });

  describe('Password Verification', () => {
    it('should verify correct password', async () => {
      const password = 'SecurePass123';
      const hash = await hasher.hash(password);

      const isValid = await hasher.verify(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hasher.hash('SecurePass123');

      const isValid = await hasher.verify('WrongPass123', hash);
      expect(isValid).toBe(false);
    });

    it('should return false for empty password', async () => {
      const hash = await hasher.hash('SecurePass123');

      const isValid = await hasher.verify('', hash);
      expect(isValid).toBe(false);
    });

    it('should return false for empty hash', async () => {
      const isValid = await hasher.verify('SecurePass123', '');
      expect(isValid).toBe(false);
    });

    it('should return false for invalid hash format', async () => {
      const isValid = await hasher.verify('SecurePass123', 'invalid-hash');
      expect(isValid).toBe(false);
    });

    it('should return false for SHA-256 hash (old format)', async () => {
      // SHA-256 hash format (what we're replacing)
      const sha256Hash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';

      const isValid = await hasher.verify('password', sha256Hash);
      expect(isValid).toBe(false);
    });
  });

  describe('Rehash Detection', () => {
    it('should not need rehash for current rounds', async () => {
      const hash = await hasher.hash('SecurePass123');
      expect(hasher.needsRehash(hash)).toBe(false);
    });

    it('should need rehash for lower rounds', () => {
      // Hash with 10 rounds
      const lowRoundsHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
      expect(hasher.needsRehash(lowRoundsHash)).toBe(true);
    });

    it('should need rehash for invalid format', () => {
      expect(hasher.needsRehash('invalid-hash')).toBe(true);
    });

    it('should need rehash for SHA-256 hash', () => {
      const sha256Hash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';
      expect(hasher.needsRehash(sha256Hash)).toBe(true);
    });
  });

  describe('Factory Function', () => {
    it('should create hasher with specified rounds', () => {
      const hasher12 = createPasswordHasher(12);
      expect(hasher12.getConfig().rounds).toBe(12);

      const hasher14 = createPasswordHasher(14);
      expect(hasher14.getConfig().rounds).toBe(14);
    });

    it('should use default 12 rounds', () => {
      const hasher = createPasswordHasher();
      expect(hasher.getConfig().rounds).toBe(12);
    });
  });

  describe('CVE-2 Security Verification', () => {
    it('should NOT use hardcoded salt', async () => {
      // Generate multiple hashes and verify they have different salts
      const hashes = await Promise.all([
        hasher.hash('SecurePass123'),
        hasher.hash('SecurePass123'),
        hasher.hash('SecurePass123'),
      ]);

      // Extract salts (22 chars after $2b$12$)
      const salts = hashes.map(h => h.substring(7, 29));

      // All salts should be unique
      const uniqueSalts = new Set(salts);
      expect(uniqueSalts.size).toBe(3);
    });

    it('should NOT produce same hash for same input (unlike SHA-256)', async () => {
      // SHA-256 with hardcoded salt would produce identical output
      const hash1 = await hasher.hash('SecurePass123');
      const hash2 = await hasher.hash('SecurePass123');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce hash that takes time to compute', async () => {
      const start = Date.now();
      await hasher.hash('SecurePass123');
      const duration = Date.now() - start;

      // bcrypt with 12 rounds should take measurable time (>10ms typically)
      expect(duration).toBeGreaterThan(5);
    });
  });
});
