/**
 * Path Validator Tests - HIGH-2 Remediation Validation
 *
 * Tests verify:
 * - Path traversal prevention
 * - Prefix validation
 * - Symlink handling
 * - Blocked file detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import {
  PathValidator,
  PathValidatorError,
  createProjectPathValidator,
  createFullProjectPathValidator,
} from '../src/path-validator.js';

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

  // #3010 — validate() realpath's the candidate but the constructor only
  // path.resolve()d the allowed prefixes, so a prefix reached through a
  // real symlink (e.g. macOS os.tmpdir() under /var -> /private/var) could
  // never match its own realpath'd contents. Uses actual fs.symlinkSync,
  // not a path-traversal string, to reproduce the real-world failure mode.
  describe('Symlinked prefix handling (#3010)', () => {
    let tmpRoot: string;
    let realDir: string;
    let symlinkedPrefix: string;

    beforeEach(async () => {
      tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'path-validator-3010-'));
      realDir = path.join(tmpRoot, 'real-target');
      await fsPromises.mkdir(realDir, { recursive: true });
      symlinkedPrefix = path.join(tmpRoot, 'symlinked-prefix');
      await fsPromises.symlink(realDir, symlinkedPrefix, 'dir');
    });

    afterEach(async () => {
      await fsPromises.rm(tmpRoot, { recursive: true, force: true });
    });

    it('accepts a file under an allowedPrefix that is itself a symlink', async () => {
      const filePath = path.join(realDir, 'file.txt');
      await fsPromises.writeFile(filePath, 'content');

      const symlinkValidator = new PathValidator({
        allowedPrefixes: [symlinkedPrefix],
      });

      // Validate via the symlinked path, exactly as a caller resolving
      // through os.tmpdir() would.
      const result = await symlinkValidator.validate(path.join(symlinkedPrefix, 'file.txt'));
      expect(result.isValid).toBe(true);
      expect(result.errors).not.toContain('Path is outside allowed directories');
    });

    it('accepts the prefix directory itself, reached via the symlink', async () => {
      const symlinkValidator = new PathValidator({
        allowedPrefixes: [symlinkedPrefix],
      });
      const result = await symlinkValidator.validate(symlinkedPrefix);
      expect(result.isValid).toBe(true);
    });
  });

  /**
   * Regression: a prefix reached through a symlink.
   *
   * `validate()` canonicalizes the candidate with `fs.realpath` but the
   * prefixes were only ever `path.resolve()`d, so the two sides were compared
   * in different forms and NOTHING under such a prefix could ever match.
   *
   * This is not a hypothetical: on macOS `os.tmpdir()` is `/var/folders/...`
   * and `/var` is a symlink to `/private/var`, so every validator built over a
   * temp directory rejected its own contents — while the same code passed on
   * Linux, where `/tmp` is a real directory.
   *
   * These tests build the symlink explicitly instead of relying on that
   * platform quirk, so they exercise the property on every platform.
   */
  describe('Symlinked prefixes', () => {
    let root: string;
    let realDir: string;
    let linkDir: string;
    let outsideDir: string;
    let symlinksSupported: boolean;

    beforeEach(async () => {
      // Reset per case: a single denied link creation must not silently
      // suppress every later assertion in the block.
      symlinksSupported = true;
      root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'path-validator-'));
      realDir = path.join(root, 'real');
      linkDir = path.join(root, 'link');
      outsideDir = path.join(root, 'outside');
      await fsPromises.mkdir(realDir);
      await fsPromises.mkdir(outsideDir);

      try {
        // 'junction' is ignored on POSIX and avoids needing Developer Mode or
        // elevation for directory links on Windows.
        await fsPromises.symlink(realDir, linkDir, 'junction');
      } catch {
        // Unprivileged Windows without Developer Mode cannot create links.
        symlinksSupported = false;
      }
    });

    afterEach(async () => {
      await fsPromises.rm(root, { recursive: true, force: true });
    });

    it('accepts an existing file under a symlinked prefix', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      const file = path.join(realDir, 'binary');
      await fsPromises.writeFile(file, 'contents');

      const linkValidator = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
      });

      const result = await linkValidator.validate(path.join(linkDir, 'binary'));

      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.relativePath).toBe('binary');
    });

    it('accepts a not-yet-created file under a symlinked prefix', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      const linkValidator = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
        allowNonExistent: true,
      });

      const result = await linkValidator.validate(path.join(linkDir, 'not-written-yet'));

      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
    });

    it('still rejects a symlink that escapes the prefix', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      const secret = path.join(outsideDir, 'secret');
      await fsPromises.writeFile(secret, 'contents');
      await fsPromises.symlink(outsideDir, path.join(realDir, 'escape'), 'junction');

      const linkValidator = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
      });

      const result = await linkValidator.validate(path.join(linkDir, 'escape', 'secret'));

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is outside allowed directories');
    });

    it('rejects a not-yet-created file under an escaping symlink', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      await fsPromises.symlink(outsideDir, path.join(realDir, 'escape'), 'junction');

      const linkValidator = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
        allowNonExistent: true,
      });

      const result = await linkValidator.validate(path.join(linkDir, 'escape', 'not-written-yet'));

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is outside allowed directories');
    });

    it('keeps validateSync lexical, so a symlinked prefix still matches', (ctx) => {
      if (!symlinksSupported) ctx.skip();
      const linkValidator = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
      });

      // validateSync is documented as resolving no symlinks; it must keep
      // comparing lexical candidate against lexical prefix, or canonicalizing
      // the prefixes would break it in the mirror image of the async bug.
      const result = linkValidator.validateSync(path.join(linkDir, 'binary'));

      expect(result.isValid).toBe(true);
      expect(linkValidator.isWithinAllowed(path.join(linkDir, 'binary'))).toBe(true);
    });

    it('does not canonicalize when non-existent paths are forbidden', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      // The call already fails; canonicalizing anyway would rewrite the
      // resolvedPath and matchedPrefix that callers read off the result.
      const strict = new PathValidator({
        allowedPrefixes: [linkDir],
        allowHidden: true,
        allowNonExistent: false,
      });

      const result = await strict.validate(path.join(linkDir, 'missing'));

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path does not exist');
      expect(result.resolvedPath).toBe(path.join(linkDir, 'missing'));
    });

    it('pins an allowed prefix to the directory it named at construction', async (ctx) => {
      if (!symlinksSupported) ctx.skip();
      // Re-resolving the prefix on every call would let whoever can rewrite
      // the link redirect the allowlist afterwards. The prefix therefore keeps
      // denoting what it named when the validator was configured.
      const pinned = new PathValidator({ allowedPrefixes: [linkDir], allowHidden: true });
      await fsPromises.writeFile(path.join(realDir, 'file'), 'contents');
      await fsPromises.writeFile(path.join(outsideDir, 'file'), 'contents');

      await fsPromises.unlink(linkDir);
      await fsPromises.symlink(outsideDir, linkDir, 'junction');

      expect((await pinned.validate(path.join(realDir, 'file'))).isValid).toBe(true);
      expect((await pinned.validate(path.join(outsideDir, 'file'))).isValid).toBe(false);
    });

    it('validates a temp-directory tree the way an installer does', async () => {
      // The shape that broke `ruflo proxy install` on macOS: a validator built
      // over a freshly-created temp dir, checking a file extracted into it,
      // with the default options.
      const workDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'installer-'));
      try {
        const extractDir = path.join(workDir, 'extracted');
        await fsPromises.mkdir(extractDir);
        const binary = path.join(extractDir, 'meta-proxy');
        await fsPromises.writeFile(binary, 'contents');

        const installValidator = new PathValidator({ allowedPrefixes: [extractDir] });
        const result = await installValidator.validate(binary);

        expect(result.errors).toEqual([]);
        expect(result.isValid).toBe(true);
      } finally {
        await fsPromises.rm(workDir, { recursive: true, force: true });
      }
    });
  });

  /**
   * A root prefix already ends in a separator, so anchoring the match by
   * appending another looked for `//` and rejected every descendant. Reachable
   * as `/` or `C:\` directly, and now also whenever a prefix canonicalizes to
   * a root.
   */
  describe('Root prefixes', () => {
    const root = path.parse(process.cwd()).root;

    it('accepts descendants of a root prefix', async () => {
      const rootValidator = new PathValidator({
        allowedPrefixes: [root],
        allowHidden: true,
        blockedNames: [],
        blockedExtensions: [],
      });

      const result = await rootValidator.validate(path.join(root, 'etc', 'hosts'));

      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.matchedPrefix).toBe(root);
      // Not compared to a literal: `/etc` is itself a symlink on macOS, so the
      // canonical location is platform-dependent. What must hold everywhere is
      // that the relative path is relative — the old `prefix + sep` boundary
      // would have produced a leading separator had it matched at all.
      expect(result.relativePath.startsWith(path.sep)).toBe(false);
      expect(path.join(root, result.relativePath)).toBe(result.resolvedPath);
    });

    it('accepts descendants of a root prefix synchronously too', () => {
      const rootValidator = new PathValidator({
        allowedPrefixes: [root],
        allowHidden: true,
        blockedNames: [],
        blockedExtensions: [],
      });

      expect(rootValidator.validateSync(path.join(root, 'etc', 'hosts')).isValid).toBe(true);
      expect(rootValidator.isWithinAllowed(path.join(root, 'etc', 'hosts'))).toBe(true);
    });

    it('still anchors non-root prefixes at a separator boundary', async () => {
      const boundaryValidator = new PathValidator({
        allowedPrefixes: ['/srv/app'],
        allowHidden: true,
      });

      expect((await boundaryValidator.validate('/srv/app-secrets/key')).isValid).toBe(false);
      expect(boundaryValidator.isWithinAllowed('/srv/app-secrets/key')).toBe(false);
    });
  });
});
