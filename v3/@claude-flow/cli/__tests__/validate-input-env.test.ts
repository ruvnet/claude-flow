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
      // dream-cycle 2026-10-16: 2026-09-21 covered Python/Perl/Ruby/git/shell
      // search-path vars but missed credential vars in the same git family,
      // interpreter-flag-injection vars for Perl/Ruby/Java, and two more
      // search-path vars. See validate-input.ts's denylist comment for the
      // source grading behind each of these.
      'GIT_ASKPASS',
      'GIT_PROXY_COMMAND',
      'GIT_CONFIG_NOSYSTEM',
      'PERL5OPT',
      'RUBYOPT',
      'JAVA_TOOL_OPTIONS',
      '_JAVA_OPTIONS',
      'JDK_JAVA_OPTIONS',
      'PYTHONHOME',
      'CLASSPATH',
      'PYTHONSTARTUP',
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
      const caseVariants = ['path', 'Path', 'PaTh', 'node_options', 'Node_Options', 'git_askpass', 'Java_Tool_Options'];

      for (const name of caseVariants) {
        it(`rejects ${name}`, () => {
          const r = validateEnv({ [name]: '/tmp/whatever' });
          expect(r.valid).toBe(false);
          expect(r.error).toContain('denylisted');
          expect(r.sanitized).toEqual({});
        });
      }
    });

    // dream-cycle 2026-10-16: git's numbered runtime-config-injection family
    // (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n>) lets a
    // caller set arbitrary git config (core.sshCommand, core.hooksPath,
    // http.*, …) at runtime — strictly broader than any single fixed name,
    // so it's matched by pattern rather than exact Set membership.
    describe('GIT_CONFIG_* numbered family (pattern match)', () => {
      const names = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_12', 'git_config_key_3'];

      for (const name of names) {
        it(`rejects ${name}`, () => {
          const r = validateEnv({ [name]: 'x' });
          expect(r.valid).toBe(false);
          expect(r.error).toContain('denylisted');
          expect(r.sanitized).toEqual({});
        });
      }

      it('does not reject an unrelated GIT_CONFIG-prefixed name', () => {
        const r = validateEnv({ GIT_CONFIGURATION_PROFILE: 'x' });
        expect(r.valid).toBe(true);
      });
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
