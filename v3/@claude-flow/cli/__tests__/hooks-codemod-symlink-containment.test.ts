/**
 * Regression test (Dream Cycle 2026-10-21): `hooks_codemod`'s path-containment
 * check (hardened 2026-10-20 against CWE-22, PR #4313) still compared the
 * resolved-but-not-realpath'd candidate against a non-realpath'd `cwd`. A
 * symlink living INSIDE the project root but pointing OUTSIDE it passes the
 * lexical anchored-prefix check unchanged (the candidate path is lexically
 * `<project>/escape-link/secret.ts`, which does start with `<project>` at a
 * path-separator boundary) yet its real location is outside the root —
 * CWE-59, disclosed as a known limitation in that same 2026-10-20 commit and
 * fixed here via a realpath-based containment check.
 *
 * Real filesystem I/O (temp dirs + real symlinks), no mocks — proves the
 * actual read+write escape, not just the string comparison in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hooksCodemod } from '../src/mcp-tools/hooks-tools.js';

describe('hooks_codemod symlink containment', () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dream-codemod-symlink-'));
    projectDir = join(root, 'project');
    outsideDir = join(root, 'outside');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    // A symlink living INSIDE the project root but resolving OUTSIDE it —
    // the exact shape of the CWE-59 bypass (lexically contained, really not).
    symlinkSync(outsideDir, join(projectDir, 'escape-link'), 'dir');
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = projectDir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a `file` path that is lexically inside the root but resolves outside it via a symlink', async () => {
    const target = join(outsideDir, 'secret.ts');
    writeFileSync(target, "console.log('leak');\n");
    const viaSymlink = join(projectDir, 'escape-link', 'secret.ts');

    const result = (await hooksCodemod.handler({ intent: 'remove-console', file: viaSymlink })) as Record<
      string,
      unknown
    >;

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(readFileSync(target, 'utf-8')).toBe("console.log('leak');\n");
  });

  it('rejects the same escape via the `files[]` array form, using a relative path', async () => {
    const target = join(outsideDir, 'secret2.ts');
    writeFileSync(target, "console.log('leak');\n");

    const result = (await hooksCodemod.handler({
      intent: 'remove-console',
      files: [join('escape-link', 'secret2.ts')],
    })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(readFileSync(target, 'utf-8')).toBe("console.log('leak');\n");
  });

  it('rejects the same escape via a `glob` that traverses the symlinked directory', async () => {
    const target = join(outsideDir, 'secret3.ts');
    writeFileSync(target, "console.log('leak');\n");

    const result = (await hooksCodemod.handler({ intent: 'remove-console', glob: 'escape-link/*.ts' })) as Record<
      string,
      unknown
    >;

    // The glob resolves to zero *contained* targets once the symlinked match
    // is filtered out — same observable outcome as "nothing safe to codemod".
    expect(result.success).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe("console.log('leak');\n");
  });

  it('still allows a legitimate symlink that resolves back inside the project root (non-discriminating control)', async () => {
    const realSubdir = join(projectDir, 'real-sub');
    mkdirSync(realSubdir, { recursive: true });
    symlinkSync(realSubdir, join(projectDir, 'alias'), 'dir');
    const target = join(realSubdir, 'ok.ts');
    writeFileSync(target, "console.log('inside');\n");

    const result = (await hooksCodemod.handler({
      intent: 'remove-console',
      file: join(projectDir, 'alias', 'ok.ts'),
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const results = result.results as Array<Record<string, unknown>>;
    expect(results[0].written).toBe(true);
    expect(readFileSync(target, 'utf-8')).not.toMatch(/console\.log/);
  });

  it('still allows a legitimate absolute path inside the project root with no symlink involved (non-discriminating control)', async () => {
    const target = join(projectDir, 'plain.ts');
    writeFileSync(target, "console.log('inside');\n");

    const result = (await hooksCodemod.handler({ intent: 'remove-console', file: target })) as Record<
      string,
      unknown
    >;

    expect(result.success).toBe(true);
    const results = result.results as Array<Record<string, unknown>>;
    expect(results[0].written).toBe(true);
    expect(readFileSync(target, 'utf-8')).not.toMatch(/console\.log/);
  });
});
