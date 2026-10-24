/**
 * Path Validator Tests - HIGH-2 Remediation Validation
 *
 * Tests verify:
 * - Path traversal prevention
 * - Prefix validation
 * - Symlink handling
 * - Blocked file detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import {
  PathValidator,
  PathValidatorError,
  createProjectPathValidator,
  createFullProjectPathValidator,
} from '../../security/path-validator.js';

describe('PathValidator', () => {
  let validator: PathValidator;
  const projectRoot = '/workspaces/project';

  beforeEach(() => {
    validator = new PathValidator({
      allowedPrefixes: [projectRoot],
      allowHidden: false,
    });
  });

  describe('Configuration', () => {
    it('should require at least one prefix', () => {
      expect(() => new PathValidator({
        allowedPrefixes: [],
      })).toThrow(PathValidatorError);
    });

    it('should resolve prefixes to absolute paths', () => {
      const relativeValidator = new PathValidator({
        allowedPrefixes: ['./src'],
      });

      const prefixes = relativeValidator.getAllowedPrefixes();
      expect(prefixes[0]).toMatch(/^\//);
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should block ../ traversal', async () => {
      const result = await validator.validate('/workspaces/project/../etc/passwd');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path traversal pattern detected');
    });

    it('should block ..\\ traversal (Windows)', async () => {
      const result = await validator.validate('/workspaces/project\\..\\..\\etc\\passwd');
      expect(result.isValid).toBe(false);
    });

    it('should block URL-encoded traversal (%2e%2e)', async () => {
      const result = await validator.validate('/workspaces/project/%2e%2e/etc/passwd');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path traversal pattern detected');
    });

    it('should block double URL-encoded traversal', async () => {
      const result = await validator.validate('/workspaces/project/%252e%252e/etc/passwd');
      expect(result.isValid).toBe(false);
    });

    it('should block mixed encoding traversal', async () => {
      const result = await validator.validate('/workspaces/project/.%2e/etc/passwd');
      expect(result.isValid).toBe(false);
    });

    it('should block null byte injection', async () => {
      const result = await validator.validate('/workspaces/project/file.txt\x00.jpg');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path traversal pattern detected');
    });

    it('should block URL-encoded null byte', async () => {
      const result = await validator.validate('/workspaces/project/file.txt%00.jpg');
      expect(result.isValid).toBe(false);
    });
  });

  describe('Prefix Validation', () => {
    it('should allow paths within prefix', async () => {
      const result = await validator.validate('/workspaces/project/src/file.ts');
      expect(result.isValid).toBe(true);
      expect(result.matchedPrefix).toBe(projectRoot);
    });

    it('should block paths outside prefix', async () => {
      const result = await validator.validate('/etc/passwd');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is outside allowed directories');
    });

    it('should block paths that start with prefix but escape', async () => {
      const result = await validator.validate('/workspaces/project-other/file.ts');
      expect(result.isValid).toBe(false);
    });

    it('should handle exact prefix match', async () => {
      const result = await validator.validate(projectRoot);
      expect(result.isValid).toBe(true);
    });

    it('should calculate relative path correctly', async () => {
      const result = await validator.validate('/workspaces/project/src/deep/file.ts');
      expect(result.relativePath).toBe('src/deep/file.ts');
    });
  });

  describe('Hidden File Handling', () => {
    it('should block hidden files by default', async () => {
      const result = await validator.validate('/workspaces/project/.env');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Hidden'))).toBe(true);
    });

    it('should block hidden directories by default', async () => {
      const result = await validator.validate('/workspaces/project/.git/config');
      expect(result.isValid).toBe(false);
    });

    it('should allow hidden files when configured', async () => {
      const hiddenValidator = new PathValidator({
        allowedPrefixes: [projectRoot],
        allowHidden: true,
        blockedNames: [], // Remove .git from blocked names for this test
        blockedExtensions: [],
      });

      const result = await hiddenValidator.validate('/workspaces/project/.gitignore');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Blocked Files', () => {
    it('should block .env files', async () => {
      const hiddenValidator = new PathValidator({
        allowedPrefixes: [projectRoot],
        allowHidden: true,
      });

      const result = await hiddenValidator.validate('/workspaces/project/config/.env');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('.env'))).toBe(true);
    });

    it('should block .pem files', async () => {
      const result = await validator.validate('/workspaces/project/certs/key.pem');
      expect(result.isValid).toBe(false);
    });

    it('should block private key files', async () => {
      const hiddenValidator = new PathValidator({
        allowedPrefixes: [projectRoot],
        allowHidden: true,
      });

      const result = await hiddenValidator.validate('/workspaces/project/.ssh/id_rsa');
      expect(result.isValid).toBe(false);
    });

    it('should block .htpasswd files', async () => {
      const hiddenValidator = new PathValidator({
        allowedPrefixes: [projectRoot],
        allowHidden: true,
      });

      const result = await hiddenValidator.validate('/workspaces/project/.htpasswd');
      expect(result.isValid).toBe(false);
    });
  });

  describe('Path Length', () => {
    it('should block paths exceeding max length', async () => {
      const longPath = '/workspaces/project/' + 'a'.repeat(5000);
      const result = await validator.validate(longPath);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('maximum length'))).toBe(true);
    });

    it('should allow paths within max length', async () => {
      const result = await validator.validate('/workspaces/project/src/file.ts');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Empty Path', () => {
    it('should reject empty path', async () => {
      const result = await validator.validate('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is empty');
    });

    it('should reject whitespace-only path', async () => {
      const result = await validator.validate('   ');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is empty');
    });
  });

  describe('Synchronous Validation', () => {
    it('should validate synchronously', () => {
      const result = validator.validateSync('/workspaces/project/src/file.ts');
      expect(result.isValid).toBe(true);
    });

    it('should detect traversal synchronously', () => {
      const result = validator.validateSync('/workspaces/project/../etc/passwd');
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOrThrow', () => {
    it('should return path when valid', async () => {
      const resolved = await validator.validateOrThrow('/workspaces/project/src/file.ts');
      expect(resolved).toBe('/workspaces/project/src/file.ts');
    });

    it('should throw when invalid', async () => {
      await expect(
        validator.validateOrThrow('/etc/passwd')
      ).rejects.toThrow(PathValidatorError);
    });
  });

  describe('securePath', () => {
    it('should join paths securely', async () => {
      const resolved = await validator.securePath(projectRoot, 'src', 'file.ts');
      expect(resolved).toBe('/workspaces/project/src/file.ts');
    });

    it('should block traversal in segments', async () => {
      await expect(
        validator.securePath(projectRoot, '..', 'etc', 'passwd')
      ).rejects.toThrow(PathValidatorError);
    });
  });

  describe('isWithinAllowed', () => {
    it('should return true for allowed paths', () => {
      expect(validator.isWithinAllowed('/workspaces/project/src')).toBe(true);
    });

    it('should return false for disallowed paths', () => {
      expect(validator.isWithinAllowed('/etc/passwd')).toBe(false);
    });
  });

  describe('Factory Functions', () => {
    it('should create project path validator', () => {
      const projectValidator = createProjectPathValidator('/workspaces/project');
      const prefixes = projectValidator.getAllowedPrefixes();

      expect(prefixes).toContain('/workspaces/project/src');
      expect(prefixes).toContain('/workspaces/project/tests');
      expect(prefixes).toContain('/workspaces/project/docs');
    });

    it('should create full project path validator', () => {
      const fullValidator = createFullProjectPathValidator('/workspaces/project');
      const prefixes = fullValidator.getAllowedPrefixes();

      expect(prefixes).toContain('/workspaces/project');
    });
  });

  describe('HIGH-2 Security Verification', () => {
    it('should prevent access to system files via traversal', async () => {
      const attacks = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '....//....//....//etc/passwd',
        '..%252f..%252f..%252fetc/passwd',
        '..%c0%af..%c0%af..%c0%afetc/passwd',
      ];

      for (const attack of attacks) {
        const result = await validator.validate(`/workspaces/project/${attack}`);
        expect(result.isValid).toBe(false);
      }
    });

    it('should resolve symlink-like path attempts', async () => {
      // Even if the path looks like it's within bounds, resolution should catch escapes
      const result = await validator.validate('/workspaces/project/symlink/../../../etc/passwd');
      expect(result.isValid).toBe(false);
    });

    it('should not allow prefix manipulation', async () => {
      // Path starts with project root but escapes via traversal
      const result = await validator.validate('/workspaces/project/../../etc/passwd');
      expect(result.isValid).toBe(false);
    });
  });
});
