/**
 * Input Validator Tests
 *
 * Tests verify:
 * - Zod schema validation
 * - Input sanitization
 * - Authentication schemas
 * - Command and path schemas
 */

import { describe, it, expect } from 'vitest';
import {
  InputValidator,
  sanitizeString,
  sanitizeHtml,
  sanitizePath,
  SafeStringSchema,
  IdentifierSchema,
  EmailSchema,
  PasswordSchema,
  UUIDSchema,
  HttpsUrlSchema,
  PortSchema,
  UserRoleSchema,
  PermissionSchema,
  LoginRequestSchema,
  CreateUserSchema,
  TaskInputSchema,
  CommandArgumentSchema,
  PathSchema,
  PATTERNS,
  LIMITS,
} from '../../security/input-validator.js';

describe('InputValidator', () => {
  describe('SafeStringSchema', () => {
    it('should accept safe strings', () => {
      expect(() => SafeStringSchema.parse('hello world')).not.toThrow();
    });

    it('should reject empty strings', () => {
      expect(() => SafeStringSchema.parse('')).toThrow();
    });

    it('should reject strings with shell metacharacters', () => {
      const dangerous = [';', '&&', '||', '|', '`', '$()', '${}', '>', '<'];
      for (const char of dangerous) {
        expect(() => SafeStringSchema.parse(`hello${char}world`)).toThrow();
      }
    });
  });

  describe('IdentifierSchema', () => {
    it('should accept valid identifiers', () => {
      expect(() => IdentifierSchema.parse('validId')).not.toThrow();
      expect(() => IdentifierSchema.parse('valid-id')).not.toThrow();
      expect(() => IdentifierSchema.parse('valid_id')).not.toThrow();
      expect(() => IdentifierSchema.parse('validId123')).not.toThrow();
    });

    it('should reject identifiers starting with number', () => {
      expect(() => IdentifierSchema.parse('123invalid')).toThrow();
    });

    it('should reject identifiers with special characters', () => {
      expect(() => IdentifierSchema.parse('invalid@id')).toThrow();
      expect(() => IdentifierSchema.parse('invalid id')).toThrow();
    });

    it('should reject empty identifiers', () => {
      expect(() => IdentifierSchema.parse('')).toThrow();
    });
  });

  describe('EmailSchema', () => {
    it('should accept valid emails', () => {
      expect(() => EmailSchema.parse('user@example.com')).not.toThrow();
      expect(() => EmailSchema.parse('user.name@example.co.uk')).not.toThrow();
    });

    it('should reject invalid emails', () => {
      expect(() => EmailSchema.parse('notanemail')).toThrow();
      expect(() => EmailSchema.parse('@nodomain.com')).toThrow();
      expect(() => EmailSchema.parse('no@')).toThrow();
    });

    it('should lowercase emails', () => {
      const result = EmailSchema.parse('USER@EXAMPLE.COM');
      expect(result).toBe('user@example.com');
    });

    it('should reject too long emails', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      expect(() => EmailSchema.parse(longEmail)).toThrow();
    });
  });

  describe('PasswordSchema', () => {
    it('should accept valid passwords', () => {
      expect(() => PasswordSchema.parse('SecurePass123')).not.toThrow();
    });

    it('should reject short passwords', () => {
      expect(() => PasswordSchema.parse('Short1')).toThrow();
    });

    it('should reject passwords without uppercase', () => {
      expect(() => PasswordSchema.parse('lowercase123')).toThrow();
    });

    it('should reject passwords without lowercase', () => {
      expect(() => PasswordSchema.parse('UPPERCASE123')).toThrow();
    });

    it('should reject passwords without digits', () => {
      expect(() => PasswordSchema.parse('NoDigitsHere')).toThrow();
    });
  });

  describe('UUIDSchema', () => {
    it('should accept valid UUIDs', () => {
      expect(() => UUIDSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });

    it('should reject invalid UUIDs', () => {
      expect(() => UUIDSchema.parse('not-a-uuid')).toThrow();
      expect(() => UUIDSchema.parse('550e8400-e29b-41d4-a716')).toThrow();
    });
  });

  describe('HttpsUrlSchema', () => {
    it('should accept HTTPS URLs', () => {
      expect(() => HttpsUrlSchema.parse('https://example.com')).not.toThrow();
      expect(() => HttpsUrlSchema.parse('https://example.com/path')).not.toThrow();
    });

    it('should reject HTTP URLs', () => {
      expect(() => HttpsUrlSchema.parse('http://example.com')).toThrow();
    });

    it('should reject invalid URLs', () => {
      expect(() => HttpsUrlSchema.parse('not-a-url')).toThrow();
    });
  });

  describe('PortSchema', () => {
    it('should accept valid ports', () => {
      expect(() => PortSchema.parse(80)).not.toThrow();
      expect(() => PortSchema.parse(443)).not.toThrow();
      expect(() => PortSchema.parse(3000)).not.toThrow();
      expect(() => PortSchema.parse(65535)).not.toThrow();
    });

    it('should reject invalid ports', () => {
      expect(() => PortSchema.parse(0)).toThrow();
      expect(() => PortSchema.parse(-1)).toThrow();
      expect(() => PortSchema.parse(65536)).toThrow();
      expect(() => PortSchema.parse(3.14)).toThrow();
    });
  });

  describe('UserRoleSchema', () => {
    it('should accept valid roles', () => {
      expect(() => UserRoleSchema.parse('admin')).not.toThrow();
      expect(() => UserRoleSchema.parse('operator')).not.toThrow();
      expect(() => UserRoleSchema.parse('developer')).not.toThrow();
      expect(() => UserRoleSchema.parse('viewer')).not.toThrow();
      expect(() => UserRoleSchema.parse('service')).not.toThrow();
    });

    it('should reject invalid roles', () => {
      expect(() => UserRoleSchema.parse('superuser')).toThrow();
      expect(() => UserRoleSchema.parse('root')).toThrow();
    });
  });

  describe('PermissionSchema', () => {
    it('should accept valid permissions', () => {
      expect(() => PermissionSchema.parse('swarm.create')).not.toThrow();
      expect(() => PermissionSchema.parse('agent.spawn')).not.toThrow();
      expect(() => PermissionSchema.parse('system.admin')).not.toThrow();
    });

    it('should reject invalid permissions', () => {
      expect(() => PermissionSchema.parse('invalid.permission')).toThrow();
    });
  });

  describe('LoginRequestSchema', () => {
    it('should accept valid login request', () => {
      expect(() => LoginRequestSchema.parse({
        email: 'user@example.com',
        password: 'password123',
      })).not.toThrow();
    });

    it('should accept login with MFA code', () => {
      expect(() => LoginRequestSchema.parse({
        email: 'user@example.com',
        password: 'password123',
        mfaCode: '123456',
      })).not.toThrow();
    });

    it('should reject invalid MFA code length', () => {
      expect(() => LoginRequestSchema.parse({
        email: 'user@example.com',
        password: 'password123',
        mfaCode: '12345', // 5 digits instead of 6
      })).toThrow();
    });
  });

  describe('CreateUserSchema', () => {
    it('should accept valid user creation', () => {
      expect(() => CreateUserSchema.parse({
        email: 'user@example.com',
        password: 'SecurePass123',
        role: 'developer',
      })).not.toThrow();
    });

    it('should require strong password', () => {
      expect(() => CreateUserSchema.parse({
        email: 'user@example.com',
        password: 'weak',
        role: 'developer',
      })).toThrow();
    });
  });

  describe('TaskInputSchema', () => {
    it('should accept valid task input', () => {
      expect(() => TaskInputSchema.parse({
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        content: 'Implement new feature',
        agentType: 'coder',
      })).not.toThrow();
    });

    it('should reject task with shell characters in content', () => {
      expect(() => TaskInputSchema.parse({
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        content: 'Implement feature; rm -rf /',
        agentType: 'coder',
      })).toThrow();
    });
  });

  describe('CommandArgumentSchema', () => {
    it('should accept safe arguments', () => {
      expect(() => CommandArgumentSchema.parse('--flag')).not.toThrow();
      expect(() => CommandArgumentSchema.parse('value')).not.toThrow();
      expect(() => CommandArgumentSchema.parse('path/to/file')).not.toThrow();
    });

    it('should reject arguments with null bytes', () => {
      expect(() => CommandArgumentSchema.parse('arg\x00injected')).toThrow();
    });

    it('should reject arguments with shell metacharacters', () => {
      expect(() => CommandArgumentSchema.parse('arg;injected')).toThrow();
      expect(() => CommandArgumentSchema.parse('arg&&injected')).toThrow();
      expect(() => CommandArgumentSchema.parse('arg|injected')).toThrow();
    });
  });

  describe('PathSchema', () => {
    it('should accept valid paths', () => {
      expect(() => PathSchema.parse('/path/to/file.ts')).not.toThrow();
      expect(() => PathSchema.parse('./relative/path')).not.toThrow();
    });

    it('should reject paths with traversal', () => {
      expect(() => PathSchema.parse('/path/../etc/passwd')).toThrow();
    });

    it('should reject paths with null bytes', () => {
      expect(() => PathSchema.parse('/path/file\x00.jpg')).toThrow();
    });
  });

  describe('Sanitization Functions', () => {
    describe('sanitizeString', () => {
      it('should remove null bytes', () => {
        expect(sanitizeString('hello\x00world')).toBe('helloworld');
      });

      it('should remove HTML brackets', () => {
        expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
      });

      it('should remove javascript: protocol', () => {
        expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
      });

      it('should trim whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
      });
    });

    describe('sanitizeHtml', () => {
      it('should escape HTML entities', () => {
        expect(sanitizeHtml('<script>')).toBe('&lt;script&gt;');
        expect(sanitizeHtml('"quoted"')).toBe('&quot;quoted&quot;');
        expect(sanitizeHtml("'apostrophe'")).toBe('&#x27;apostrophe&#x27;');
        expect(sanitizeHtml('a & b')).toBe('a &amp; b');
      });
    });

    describe('sanitizePath', () => {
      it('should remove null bytes', () => {
        expect(sanitizePath('/path\x00/file')).toBe('path/file');
      });

      it('should remove traversal patterns', () => {
        expect(sanitizePath('../etc/passwd')).toBe('/etc/passwd');
      });

      it('should normalize slashes', () => {
        expect(sanitizePath('/path//to///file')).toBe('path/to/file');
      });

      it('should remove leading slash', () => {
        expect(sanitizePath('/absolute/path')).toBe('absolute/path');
      });
    });
  });

  describe('InputValidator Class', () => {
    it('should validate email', () => {
      expect(InputValidator.validateEmail('user@example.com')).toBe('user@example.com');
    });

    it('should validate password', () => {
      expect(() => InputValidator.validatePassword('SecurePass123')).not.toThrow();
    });

    it('should validate identifier', () => {
      expect(InputValidator.validateIdentifier('myId')).toBe('myId');
    });

    it('should validate path', () => {
      expect(InputValidator.validatePath('/valid/path')).toBe('/valid/path');
    });

    it('should validate command argument', () => {
      expect(InputValidator.validateCommandArg('--flag')).toBe('--flag');
    });

    it('should validate login request', () => {
      const result = InputValidator.validateLoginRequest({
        email: 'USER@example.com',
        password: 'password',
      });
      expect(result.email).toBe('user@example.com');
    });

    it('should safely parse with result', () => {
      const success = InputValidator.safeParse(EmailSchema, 'user@example.com');
      expect(success.success).toBe(true);

      const failure = InputValidator.safeParse(EmailSchema, 'invalid');
      expect(failure.success).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should export PATTERNS', () => {
      expect(PATTERNS.SAFE_IDENTIFIER).toBeDefined();
      expect(PATTERNS.SAFE_FILENAME).toBeDefined();
      expect(PATTERNS.NO_SHELL_CHARS).toBeDefined();
    });

    it('should export LIMITS', () => {
      expect(LIMITS.MIN_PASSWORD_LENGTH).toBe(8);
      expect(LIMITS.MAX_PASSWORD_LENGTH).toBe(128);
      expect(LIMITS.MAX_PATH_LENGTH).toBe(4096);
    });
  });
});
