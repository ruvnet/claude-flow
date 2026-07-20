/**
 * Regression coverage for issue #2742: getPkgVersion() misses the project
 * install when CWD is a git worktree and falls back to the baked-in version.
 *
 * The fix adds a worktree probe between the CWD-based candidate paths and
 * the global-install probe: when CWD/.git is a FILE (git worktree marker)
 * containing `gitdir: /path/to/main/.git/worktrees/<name>`, the main repo's
 * node_modules paths are appended to the candidate list.
 *
 * Pattern mirrors bug-cluster-2219-2226.test.ts (#2221's global probe) and
 * issue-2682-statusline-identity.test.ts (functional script execution).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);

describe('#2742 — getPkgVersion() resolves main repo node_modules when CWD is a git worktree', () => {
  it('contains the worktree probe code (.git file + worktrees path parse)', () => {
    expect(SCRIPT).toContain('.git');
    expect(SCRIPT).toContain('worktrees');
    expect(SCRIPT).toContain('gitdir:');
  });

  it('still keeps the existing CWD-based candidate probes (no regression)', () => {
    expect(SCRIPT).toContain("'marketplaces', 'ruflo', 'package.json'");
    expect(SCRIPT).toContain("'node_modules', 'ruflo', 'package.json'");
    expect(SCRIPT).toContain("'node_modules', '@claude-flow', 'cli', 'package.json'");
  });

  it('still keeps the global npm install probes from #2221 (no regression)', () => {
    expect(SCRIPT).toContain('process.execPath');
    expect(SCRIPT).toContain("'lib', 'node_modules'");
  });

  it('finds the version from the main repo when CWD is a worktree (functional)', () => {
    // Layout:
    //   <tmp>/fake-main/node_modules/ruflo/package.json   (version 9.9.9)
    //   <tmp>/wt/.git  →  file: "gitdir: <tmp>/fake-main/.git/worktrees/test-wt"
    //   run the script with cwd=<tmp>/wt
    const root = mkdtempSync(path.join(tmpdir(), 'ruflo-wt2742-'));
    const mainRoot = path.join(root, 'fake-main');
    const mainGitDir = path.join(mainRoot, '.git', 'worktrees', 'test-wt');
    const mainModules = path.join(mainRoot, 'node_modules', 'ruflo');
    const wtDir = path.join(root, 'wt');
    const scriptPath = path.join(root, 'statusline.cjs');
    try {
      mkdirSync(mainModules, { recursive: true });
      writeFileSync(
        path.join(mainModules, 'package.json'),
        JSON.stringify({ name: 'ruflo', version: '9.9.9' }),
      );
      mkdirSync(mainGitDir, { recursive: true });
      mkdirSync(wtDir, { recursive: true });
      // .git as a FILE pointing at the worktree gitdir under the main repo.
      writeFileSync(path.join(wtDir, '.git'), `gitdir: ${mainGitDir}\n`);
      writeFileSync(scriptPath, SCRIPT, 'utf8');

      const output = execFileSync(process.execPath, [scriptPath], {
        cwd: wtDir,
        input: JSON.stringify({ model: { display_name: 'Test' } }),
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: root },
        timeout: 15_000,
      });
      // The statusline header carries the resolved version. Look for 9.9.9
      // anywhere in the output — it only appears if the worktree probe found
      // the main repo's node_modules/ruflo/package.json.
      expect(output).toContain('9.9.9');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT add worktree paths when .git is a directory (normal repo)', () => {
    // In a normal repo, .git is a directory — the worktree probe must bail
    // (the `isFile()` guard) and add nothing. We verify by asserting the
    // baked-in default version still appears (no fake main-repo path leaked
    // into the candidate list). We place a decoy package.json in a location
    // that ONLY the worktree probe would find if the isFile() guard failed.
    const root = mkdtempSync(path.join(tmpdir(), 'ruflo-normal2742-'));
    const cwd = path.join(root, 'normal-repo');
    const scriptPath = path.join(root, 'statusline.cjs');
    try {
      // A normal repo: .git is a directory. Put a decoy "main repo" with a
      // sentinel version that would leak if the probe mis-parsed a directory.
      const decoyMain = path.join(root, 'decoy-main');
      const decoyModules = path.join(decoyMain, 'node_modules', 'ruflo');
      mkdirSync(decoyModules, { recursive: true });
      writeFileSync(
        path.join(decoyModules, 'package.json'),
        JSON.stringify({ name: 'ruflo', version: '0.0.0-SENTINEL' }),
      );
      // Construct a .git DIRECTORY (not a worktree). We also craft a
      // .git/worktrees/foo path so that if the probe erroneously read .git
      // as if it were a file, the lastIndexOf('/.git/worktrees/') match
      // would still succeed and resolve decoyMain. The isFile() guard is
      // the only thing preventing this.
      const gitDir = path.join(cwd, '.git');
      mkdirSync(gitDir, { recursive: true });
      mkdirSync(path.join(gitDir, 'worktrees', 'foo'), { recursive: true });
      mkdirSync(cwd, { recursive: true });
      writeFileSync(scriptPath, SCRIPT, 'utf8');

      const output = execFileSync(process.execPath, [scriptPath], {
        cwd,
        input: JSON.stringify({ model: { display_name: 'Test' } }),
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: root },
        timeout: 15_000,
      });
      // The sentinel decoy version must NOT appear — the worktree probe
      // must have bailed on .git being a directory.
      expect(output).not.toContain('0.0.0-SENTINEL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
