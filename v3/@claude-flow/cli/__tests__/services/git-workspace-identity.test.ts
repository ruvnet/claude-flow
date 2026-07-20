/**
 * #2661 — Git workspace identity: worktrees of one repository must resolve
 * to the SAME repositoryId (the shared scheduler/dedup key), while the
 * worktreeRoot stays per-worktree. Non-git directories degrade gracefully.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveGitWorkspaceIdentity,
  resetGitIdentityCacheForTests,
} from '../../src/services/git-workspace-identity.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('#2661 — git workspace identity', () => {
  let repo: string;
  let worktree: string;

  beforeEach(() => {
    resetGitIdentityCacheForTests();
    repo = mkdtempSync(join(tmpdir(), 'gwi-repo-'));
    worktree = join(mkdtempSync(join(tmpdir(), 'gwi-wt-')), 'wt');
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@test.local');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    resetGitIdentityCacheForTests();
    rmSync(worktree, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('resolves root, common git dir, repositoryId, and HEAD for a plain clone', () => {
    const id = resolveGitWorkspaceIdentity(repo);
    expect(id.isGit).toBe(true);
    expect(id.worktreeRoot).toBeTruthy();
    expect(id.commonGitDir).toContain('.git');
    expect(id.repositoryId).toMatch(/^[0-9a-f]{64}$/);
    expect(id.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('two worktrees of one repository share repositoryId and HEAD', () => {
    git(repo, 'worktree', 'add', '-q', worktree, '-b', 'wt-branch');

    const a = resolveGitWorkspaceIdentity(repo);
    const b = resolveGitWorkspaceIdentity(worktree);

    // The fanout key insight: DIFFERENT worktree roots...
    expect(a.worktreeRoot).not.toBe(b.worktreeRoot);
    // ...but ONE repository identity (same commit → same dedup scope).
    expect(b.repositoryId).toBe(a.repositoryId);
    expect(b.head).toBe(a.head);
  });

  it('different repositories get different repositoryIds', () => {
    const other = mkdtempSync(join(tmpdir(), 'gwi-other-'));
    try {
      git(other, 'init', '-q');
      const a = resolveGitWorkspaceIdentity(repo);
      const b = resolveGitWorkspaceIdentity(other);
      expect(b.repositoryId).not.toBe(a.repositoryId);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('HEAD changes when a new commit lands (identity cache does not pin it)', () => {
    const before = resolveGitWorkspaceIdentity(repo);
    writeFileSync(join(repo, 'b.txt'), 'more');
    git(repo, 'add', 'b.txt');
    git(repo, 'commit', '-q', '-m', 'second');
    const after = resolveGitWorkspaceIdentity(repo);
    expect(after.repositoryId).toBe(before.repositoryId);
    expect(after.head).not.toBe(before.head);
  });

  it('degrades gracefully for non-git directories', () => {
    const plain = mkdtempSync(join(tmpdir(), 'gwi-plain-'));
    try {
      const id = resolveGitWorkspaceIdentity(plain);
      expect(id.isGit).toBe(false);
      expect(id.head).toBe('');
      expect(id.repositoryId).toMatch(/^[0-9a-f]{64}$/);
      // Distinct non-git dirs must not collide.
      const other = mkdtempSync(join(tmpdir(), 'gwi-plain2-'));
      try {
        expect(resolveGitWorkspaceIdentity(other).repositoryId).not.toBe(id.repositoryId);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
