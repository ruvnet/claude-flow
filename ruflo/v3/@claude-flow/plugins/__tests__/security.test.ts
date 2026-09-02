/**
 * Security Module Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateString,
  validateNumber,
  validateBoolean,
  validateArray,
  validateEnum,
  validatePath,
  validateCommand,
  safePath,
  safeJsonParse,
  safeJsonStringify,
  escapeShellArg,
  sanitizeErrorMessage,
  sanitizeError,
  createRateLimiter,
  generateSecureId,
  generateSecureToken,
  hashString,
  constantTimeCompare,
  createResourceLimiter,
} from '../src/security/index.js';
import * as path from 'path';

describe('Input Validation', () => {
  describe('validateString', () => {
    it('should validate basic strings', () => {
      expect(validateString('hello')).toBe('hello');
      expect(validateString(123)).toBeNull();
      expect(validateString(null)).toBeNull();
    });

    it('should apply length constraints', () => {
      expect(validateString('ab', { minLength: 3 })).toBeNull();
      expect(validateString('abc', { minLength: 3 })).toBe('abc');
      expect(validateString('abcdef', { maxLength: 5 })).toBeNull();
      expect(validateString('abcde', { maxLength: 5 })).toBe('abcde');
    });

    it('should apply pattern matching', () => {
      expect(validateString('abc123', { pattern: /^[a-z]+$/ })).toBeNull();
      expect(validateString('abc', { pattern: /^[a-z]+$/ })).toBe('abc');
    });

    it('should apply transformations', () => {
      expect(validateString('  hello  ', { trim: true })).toBe('hello');
      expect(validateString('Hello', { lowercase: true })).toBe('hello');
      expect(validateString('hello', { uppercase: true })).toBe('HELLO');
    });
  });

  describe('validateNumber', () => {
    it('should validate numbers', () => {
      expect(validateNumber(42)).toBe(42);
      expect(validateNumber('42')).toBe(42);
      expect(validateNumber('abc')).toBeNull();
      expect(validateNumber(NaN)).toBeNull();
      expect(validateNumber(Infinity)).toBeNull();
    });

    it('should apply range constraints', () => {
      expect(validateNumber(5, { min: 10 })).toBeNull();
      expect(validateNumber(15, { min: 10 })).toBe(15);
      expect(validateNumber(15, { max: 10 })).toBeNull();
      expect(validateNumber(5, { max: 10 })).toBe(5);
    });

    it('should validate integers', () => {
      expect(validateNumber(5.5, { integer: true })).toBeNull();
      expect(validateNumber(5, { integer: true })).toBe(5);
    });
  });

  describe('validateBoolean', () => {
    it('should validate booleans', () => {
      expect(validateBoolean(true)).toBe(true);
      expect(validateBoolean(false)).toBe(false);
      expect(validateBoolean('true')).toBe(true);
      expect(validateBoolean('false')).toBe(false);
      expect(validateBoolean('1')).toBe(true);
      expect(validateBoolean('0')).toBe(false);
      expect(validateBoolean(1)).toBe(true);
      expect(validateBoolean(0)).toBe(false);
      expect(validateBoolean('maybe')).toBeNull();
    });
  });

  describe('validateArray', () => {
    it('should validate arrays with item validator', () => {
      expect(validateArray([1, 2, 3], (x) => validateNumber(x))).toEqual([1, 2, 3]);
      expect(validateArray([1, 'a', 3], (x) => validateNumber(x))).toBeNull();
    });

    it('should apply length constraints', () => {
      expect(validateArray([1, 2], (x) => validateNumber(x), { minLength: 3 })).toBeNull();
      expect(validateArray([1, 2, 3, 4], (x) => validateNumber(x), { maxLength: 3 })).toBeNull();
    });

    it('should enforce uniqueness', () => {
      expect(validateArray([1, 2, 2], (x) => validateNumber(x), { unique: true })).toBeNull();
      expect(validateArray([1, 2, 3], (x) => validateNumber(x), { unique: true })).toEqual([1, 2, 3]);
    });
  });

  describe('validateEnum', () => {
    it('should validate enum values', () => {
      const allowed = ['a', 'b', 'c'] as const;
      expect(validateEnum('a', allowed)).toBe('a');
      expect(validateEnum('d', allowed)).toBeNull();
      expect(validateEnum(123, allowed)).toBeNull();
    });
  });
});

describe('Path Security', () => {
  describe('validatePath', () => {
    it('should reject path traversal', () => {
      expect(validatePath('../etc/passwd')).toBeNull();
      expect(validatePath('/etc/../etc/passwd')).toBeNull();
    });

    it('should reject absolute paths by default', () => {
      expect(validatePath('/absolute/path')).toBeNull();
      expect(validatePath('/absolute/path', { allowAbsolute: true })).not.toBeNull();
    });

    it('should validate extensions', () => {
      expect(validatePath('file.txt', { allowedExtensions: ['.js'] })).toBeNull();
      expect(validatePath('file.js', { allowedExtensions: ['.js'] })).not.toBeNull();
    });

    it('should reject dangerous paths', () => {
      expect(validatePath('/etc/passwd')).toBeNull();
      expect(validatePath('/var/log/syslog')).toBeNull();
      expect(validatePath('C:\\Windows\\System32')).toBeNull();
    });
  });

  describe('safePath', () => {
    it('should create safe paths within base', () => {
      const base = '/project';
      const result = safePath(base, 'src', 'index.ts');
      expect(result).toBe(path.resolve(base, 'src', 'index.ts'));
    });

    it('should block path traversal attempts', () => {
      const base = '/project';
      expect(() => safePath(base, '..', 'etc', 'passwd')).toThrow('Path traversal blocked');
      expect(() => safePath(base, 'src', '..', '..', 'etc')).toThrow('Path traversal blocked');
    });
  });
});

describe('JSON Security', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"a": 1}')).toEqual({ a: 1 });
      expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('should strip dangerous keys', () => {
      const malicious = '{"__proto__": {"polluted": true}, "normal": 1}';
      const result = safeJsonParse<Record<string, unknown>>(malicious);
      expect(result.normal).toBe(1);
      expect(result.__proto__).toBeUndefined();
    });

    it('should throw on invalid JSON', () => {
      expect(() => safeJsonParse('not json')).toThrow();
    });
  });

  describe('safeJsonStringify', () => {
    it('should stringify objects', () => {
      expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    });

    it('should handle circular references', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      expect(() => safeJsonStringify(obj)).not.toThrow();
      expect(safeJsonStringify(obj)).toContain('[Circular]');
    });

    it('should respect max depth', () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      const result = safeJsonStringify(deep, { maxDepth: 3 });
      expect(result).toContain('[Max Depth Exceeded]');
    });
  });
});

describe('Command Security', () => {
  describe('validateCommand', () => {
    it('should validate allowed commands', () => {
      const result = validateCommand('npm install');
      expect(result?.command).toBe('npm');
      expect(result?.args).toEqual(['install']);
    });

    it('should reject blocked commands', () => {
      expect(validateCommand('rm -rf /')).toBeNull();
      expect(validateCommand('sudo apt install')).toBeNull();
    });

    it('should reject shell metacharacters', () => {
      expect(validateCommand('npm install; rm -rf /')).toBeNull();
      expect(validateCommand('npm install | cat')).toBeNull();
      expect(validateCommand('npm install && rm')).toBeNull();
    });
  });

  describe('escapeShellArg', () => {
    it('should escape special characters', () => {
      expect(escapeShellArg('hello')).toBe('hello');
      expect(escapeShellArg('hello world')).toBe("'hello world'");
      expect(escapeShellArg("it's")).toBe("'it'\"'\"'s'");
      expect(escapeShellArg('')).toBe("''");
    });
  });
});

describe('Error Sanitization', () => {
  describe('sanitizeErrorMessage', () => {
    it('should remove sensitive data', () => {
      expect(sanitizeErrorMessage('password=secret123')).not.toContain('secret123');
      expect(sanitizeErrorMessage('api_key: abc123')).not.toContain('abc123');
      expect(sanitizeErrorMessage('Bearer token123')).not.toContain('token123');
      expect(sanitizeErrorMessage('http://user:pass@host.com')).not.toContain('pass');
    });

    it('should truncate long messages', () => {
      const longMessage = 'a'.repeat(2000);
      const result = sanitizeErrorMessage(longMessage);
      expect(result.length).toBeLessThan(1100);
      expect(result).toContain('[truncated]');
    });
  });

  describe('sanitizeError', () => {
    it('should create safe error objects', () => {
      const error = new Error('password=secret');
      const result = sanitizeError(error);

      expect(result.name).toBe('Error');
      expect(result.message).not.toContain('secret');
    });

    it('should handle non-Error inputs', () => {
      const result = sanitizeError('string error');
      expect(result.name).toBe('Error');
      expect(result.message).toBe('string error');
    });
  });
});

describe('Rate Limiting', () => {
  it('should limit requests', () => {
    const limiter = createRateLimiter({
      maxTokens: 3,
      refillRate: 1,
      refillInterval: 1000,
    });

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.getRemaining()).toBe(0);
  });

  it('should reset tokens', () => {
    const limiter = createRateLimiter({
      maxTokens: 2,
      refillRate: 1,
      refillInterval: 1000,
    });

    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.getRemaining()).toBe(0);

    limiter.reset();
    expect(limiter.getRemaining()).toBe(2);
  });
});

describe('Crypto Utilities', () => {
  it('should generate secure IDs', () => {
    const id1 = generateSecureId();
    const id2 = generateSecureId();

    expect(id1).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(id1).not.toBe(id2);
    expect(/^[a-f0-9]+$/.test(id1)).toBe(true);
  });

  it('should generate secure tokens', () => {
    const token = generateSecureToken();

    expect(token.length).toBeGreaterThan(20);
    // URL-safe base64
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
  });

  it('should hash strings consistently', () => {
    const hash1 = hashString('hello');
    const hash2 = hashString('hello');
    const hash3 = hashString('world');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
  });

  it('should compare strings in constant time', () => {
    expect(constantTimeCompare('abc', 'abc')).toBe(true);
    expect(constantTimeCompare('abc', 'abd')).toBe(false);
    expect(constantTimeCompare('abc', 'abcd')).toBe(false);
  });
});

describe('Resource Limiting', () => {
  it('should check resource usage', () => {
    const limiter = createResourceLimiter({
      maxMemoryMB: 2048, // High limit to pass
    });

    const result = limiter.check();
    expect(result.ok).toBe(true);
  });

  it('should enforce execution time limits', async () => {
    const limiter = createResourceLimiter({
      maxExecutionTime: 100,
    });

    await expect(
      limiter.enforce(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      })
    ).rejects.toThrow('Execution time limit');
  });
});
