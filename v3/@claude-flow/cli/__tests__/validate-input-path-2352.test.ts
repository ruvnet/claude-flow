/**
 * Regression test for #2352 (Bug A): validatePath used to reject every
 * absolute Windows path because backslash was in the general SHELL_META set.
 * Claude Code hook events deliver absolute paths in `tool_input.file_path`,
 * so every forwarded `hooks post-edit` call failed on Windows — and Bug B
 * hid the failure behind a "[OK]" log.
 *
 * Pin the contract: Windows-shaped paths are accepted, dangerous shell
 * metacharacters and path traversal are still rejected.
 */

import { describe, it, expect } from 'vitest';
import { validatePath } from '../src/mcp-tools/validate-input.js';

describe('validatePath (#2352)', () => {
  describe('Windows paths (the regression)', () => {
    it('accepts an absolute Windows path with a drive letter', () => {
      const r = validatePath('E:\\Repos\\my-app\\middleware.ts', 'filePath');
      expect(r.valid).toBe(true);
      // Sanitized form normalizes backslashes to forward slashes
      expect(r.sanitized).toBe('E:/Repos/my-app/middleware.ts');
    });

    it('accepts a UNC-style Windows path', () => {
      const r = validatePath('\\\\server\\share\\file.txt', 'filePath');
      expect(r.valid).toBe(true);
    });

    it('accepts mixed separators', () => {
      const r = validatePath('C:\\Users\\ruv/Projects\\ruflo/file.ts', 'filePath');
      expect(r.valid).toBe(true);
    });
  });

  describe('POSIX paths (must keep working)', () => {
    it('accepts a relative forward-slash path', () => {
      const r = validatePath('app/page.tsx', 'filePath');
      expect(r.valid).toBe(true);
      expect(r.sanitized).toBe('app/page.tsx');
    });

    it('accepts an absolute POSIX path', () => {
      const r = validatePath('/home/ruv/repo/src/file.ts', 'filePath');
      expect(r.valid).toBe(true);
    });
  });

  describe('still rejects dangerous input', () => {
    it('rejects path traversal with forward slashes', () => {
      const r = validatePath('../etc/passwd', 'filePath');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/path traversal/);
    });

    it('rejects path traversal with backslashes (Windows form)', () => {
      const r = validatePath('..\\windows\\system32\\config', 'filePath');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/path traversal/);
    });

    it.each([
      ['semicolon', 'foo;rm -rf /'],
      ['pipe',      'foo|cat /etc/passwd'],
      ['ampersand', 'foo&calc.exe'],
      ['backtick',  'foo`whoami`'],
      ['dollar',    'foo$BAR'],
      ['parens',    'foo$(echo bar)'],
      ['braces',    'foo{a,b}.txt'],
      ['brackets',  'foo[1].txt'],
      ['redirect',  'foo>out.txt'],
      ['append',    'foo<in.txt'],
      ['bang',      'foo!bar'],
      ['hash',      'foo#bar'],
    ])('rejects %s in path', (_label, value) => {
      const r = validatePath(value, 'filePath');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/shell metacharacters/);
    });

    it('rejects an empty string', () => {
      expect(validatePath('', 'filePath').valid).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(validatePath(null, 'filePath').valid).toBe(false);
      expect(validatePath(undefined, 'filePath').valid).toBe(false);
      expect(validatePath(42, 'filePath').valid).toBe(false);
    });

    it('rejects an over-long path', () => {
      const long = 'a/'.repeat(2500) + 'file.ts';
      expect(validatePath(long, 'filePath').valid).toBe(false);
    });
  });
});
