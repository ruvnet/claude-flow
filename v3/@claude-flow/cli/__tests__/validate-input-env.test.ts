/**
 * Regression test for audit_1776853149979: terminal_create previously merged
 * caller-supplied env straight into execSync's environment for every command
 * in the session. Setting LD_PRELOAD or NODE_OPTIONS via that path was
 * functionally RCE on the host. validateEnv enforces a denylist + POSIX
 * shape — these tests pin the contract so the denylist can't silently
 * regress.
 */

import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/mcp-tools/validate-input.js';

describe('validateEnv (audit_1776853149979)', () => {
  describe('happy path', () => {
    it('accepts undefined / null as empty env', () => {
      expect(validateEnv(undefined)).toEqual({ valid: true, sanitized: {} });
      expect(validateEnv(null)).toEqual({ valid: true, sanitized: {} });
    });

    it('accepts an empty object', () => {
      expect(validateEnv({})).toEqual({ valid: true, sanitized: {} });
    });

    it('passes through a valid env unchanged', () => {
      const r = validateEnv({ FOO: 'bar', MY_VAR: '1', _UNDERSCORE: 'ok' });
      expect(r.valid).toBe(true);
      expect(r.sanitized).toEqual({ FOO: 'bar', MY_VAR: '1', _UNDERSCORE: 'ok' });
    });
  });

  describe('loader-hijack denylist', () => {
    // Names that let an attacker hijack a child process before any user code
    // runs. Each MUST be rejected — adding an exemption is a real CVE.
    const denylisted = [
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'LD_AUDIT',
      'DYLD_INSERT_LIBRARIES',
      'DYLD_LIBRARY_PATH',
      'DYLD_FALLBACK_LIBRARY_PATH',
      'DYLD_FORCE_FLAT_NAMESPACE',
      'NODE_OPTIONS',
      'NODE_PATH',
      // dream-cycle 2026-09-21 (CWE-427, Uncontrolled Search Path Element):
      // PATH itself and the equivalent interpreter/VCS search-path vars were
      // missing — a caller could override PATH for every subsequent command
      // in the terminal session.
      'PATH',
      'PYTHONPATH',
      'PERL5LIB',
      'RUBYLIB',
      'GIT_EXTERNAL_DIFF',
      'GIT_SSH_COMMAND',
      'BASH_ENV',
      'IFS',
    ];

    for (const name of denylisted) {
      it(`rejects ${name}`, () => {
        const r = validateEnv({ [name]: '/tmp/whatever' });
        expect(r.valid).toBe(false);
        expect(r.error).toContain(name);
        expect(r.error).toContain('denylisted');
        expect(r.sanitized).toEqual({});
      });
    }

    // dream-cycle 2026-09-21 (adversarial critique caveat): Windows env vars
    // are case-insensitive, so `path`/`Path` must be denylisted the same as
    // `PATH` even though they're distinct object keys here.
    describe('case-insensitive denylist match', () => {
      const caseVariants = ['path', 'Path', 'PaTh', 'node_options', 'Node_Options'];

      for (const name of caseVariants) {
        it(`rejects ${name}`, () => {
          const r = validateEnv({ [name]: '/tmp/whatever' });
          expect(r.valid).toBe(false);
          expect(r.error).toContain('denylisted');
          expect(r.sanitized).toEqual({});
        });
      }
    });
  });

  describe('shape validation', () => {
    it('rejects a name containing =', () => {
      const r = validateEnv({ 'A=B': 'x' });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('not a valid POSIX env name');
    });

    it('rejects a digit-first name', () => {
      const r = validateEnv({ '1FOO': 'x' });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('not a valid POSIX env name');
    });

    it('rejects a name with whitespace', () => {
      const r = validateEnv({ 'BAD NAME': 'x' });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('not a valid POSIX env name');
    });

    it('rejects an array (not an object)', () => {
      const r = validateEnv(['FOO', 'BAR'] as unknown);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('object of string→string');
    });

    it('rejects a non-string value', () => {
      const r = validateEnv({ FOO: 42 });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('FOO');
      expect(r.error).toContain('must be a string');
    });

    it('rejects a value with a null byte', () => {
      const value = ['a', String.fromCharCode(0), 'b'].join('');
      const r = validateEnv({ FOO: value });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('null byte');
    });

    it('rejects a value over 32K', () => {
      const r = validateEnv({ FOO: 'x'.repeat(40_000) });
      expect(r.valid).toBe(false);
      expect(r.error).toContain('exceeds 32768');
    });
  });
});
