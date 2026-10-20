/**
 * Regression test (Dream Cycle 2026-10-20): `hooks_codemod`'s path-containment
 * check used an unanchored string-prefix comparison (`abs.startsWith(cwd)`)
 * instead of anchoring at a path-separator boundary. A sibling directory
 * whose name happens to start with the project directory's name (e.g.
 * `/project` vs. `/project-staging`) passed the check and let the tool
 * read-and-write a file outside the intended project root — CWE-22.
 *
 * Real filesystem I/O (temp dirs), no mocks — proves the actual read+write
 * escape, not just the string comparison in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hooksCodemod } from '../src/mcp-tools/hooks-tools.js';

describe('hooks_codemod path containment', () => {
  let root: string;
  let projectDir: string;
  let siblingDir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dream-codemod-'));
    // Sibling directory name shares "project" as a literal string prefix —
    // the exact shape of the bypass (cwd="<root>/project", escape target
    // lives under "<root>/project-staging", one directory up from cwd).
    projectDir = join(root, 'project');
    siblingDir = join(root, 'project-staging');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(siblingDir, { recursive: true });
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = projectDir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects an absolute `file` path outside the project root that shares a string prefix with cwd', async () => {
    const target = join(siblingDir, 'evil.ts');
    writeFileSync(target, "console.log('leak');\n");

    const result = (await hooksCodemod.handler({ intent: 'remove-console', file: target })) as Record<
      string,
      unknown
    >;

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    // The file must be byte-identical — no write occurred outside the root.
    expect(readFileSync(target, 'utf-8')).toBe("console.log('leak');\n");
  });

  it('rejects the same escape via the `files[]` array form', async () => {
    const target = join(siblingDir, 'evil2.ts');
    writeFileSync(target, "console.log('leak');\n");

    const result = (await hooksCodemod.handler({ intent: 'remove-console', files: [target] })) as Record<
      string,
      unknown
    >;

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(readFileSync(target, 'utf-8')).toBe("console.log('leak');\n");
  });

  it('still allows a legitimate absolute path inside the project root (non-discriminating control)', async () => {
    const target = join(projectDir, 'ok.ts');
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

  it('still allows a relative path inside the project root (non-discriminating control)', async () => {
    writeFileSync(join(projectDir, 'rel.ts'), "console.log('inside');\n");

    const result = (await hooksCodemod.handler({ intent: 'remove-console', file: 'rel.ts' })) as Record<
      string,
      unknown
    >;

    expect(result.success).toBe(true);
    const results = result.results as Array<Record<string, unknown>>;
    expect(results[0].written).toBe(true);
  });
});
