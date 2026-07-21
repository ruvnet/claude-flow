/** Regression coverage for issue #2742: getPkgVersion() in the generated
 * statusline.cjs missed the project install when CWD is a linked git
 * worktree (no node_modules of its own), silently falling back to the
 * baked-in default version instead of resolving the main repo's install a
 * few directories away.
 *
 * Follows the same generate-script-then-execute-as-a-real-subprocess
 * pattern as issue-2682-statusline-identity.test.ts. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

describe('statusline worktree version resolution — issue #2742', () => {
  it('resolves the main repo package.json version from a linked-worktree CWD with no local node_modules', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'ruflo-worktree-'));
    const mainRoot = path.join(parent, 'main-repo');
    const worktreeRoot = path.join(parent, 'main-repo-worktree');
    const script = path.join(parent, 'statusline.cjs');

    // Simulate a real repo with an installed @claude-flow/cli at a known
    // version, plus a linked worktree that has no node_modules of its own —
    // exactly the topology `git worktree add` produces.
    mkdirSync(path.join(mainRoot, 'v3', '@claude-flow', 'cli'), { recursive: true });
    writeFileSync(
      path.join(mainRoot, 'v3', '@claude-flow', 'cli', 'package.json'),
      JSON.stringify({ name: '@claude-flow/cli', version: '9.9.9-worktree-test' }),
    );
    mkdirSync(path.join(mainRoot, '.git', 'worktrees', 'main-repo-worktree'), { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });
    // A linked worktree's `.git` is a plain FILE pointing at the main
    // repo's `.git/worktrees/<name>` — git writes this with forward
    // slashes even on Windows, which is exactly what tripped up a naive
    // path.sep-based parser during development of this fix.
    writeFileSync(
      path.join(worktreeRoot, '.git'),
      `gitdir: ${mainRoot.replace(/\\/g, '/')}/.git/worktrees/main-repo-worktree\n`,
    );

    try {
      writeFileSync(script, SCRIPT, 'utf8');
      const output = execFileSync(process.execPath, [script], {
        cwd: worktreeRoot,
        input: JSON.stringify({ model: { display_name: 'Codex' } }),
        encoding: 'utf8',
        // Deny every OTHER version-resolution candidate (global installs,
        // marketplace checkout, npm prefix) by pointing HOME somewhere with
        // none of those, and PATH nowhere — isolates the assertion to the
        // worktree-crawl candidate specifically, not just "some candidate
        // happened to resolve".
        env: { PATH: '/nonexistent', HOME: parent },
        timeout: 15_000,
      });
      expect(stripAnsi(output)).toContain('9.9.9-worktree-test');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('does not misidentify a real (non-worktree) .git directory as a worktree', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'ruflo-nonworktree-'));
    const cwd = path.join(parent, 'plain-repo');
    const script = path.join(parent, 'statusline.cjs');
    mkdirSync(path.join(cwd, '.git'), { recursive: true }); // a real repo: .git is a DIRECTORY
    mkdirSync(cwd, { recursive: true });
    writeFileSync(script, SCRIPT, 'utf8');
    try {
      // Should render without throwing — a real .git dir must short-circuit
      // resolveWorktreeMainRoot() cleanly (return null), not be misread as
      // worktree-pointer content.
      const output = execFileSync(process.execPath, [script], {
        cwd,
        input: JSON.stringify({ model: { display_name: 'Codex' } }),
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: parent },
        timeout: 15_000,
      });
      expect(output.length).toBeGreaterThan(0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
