/**
 * #2661 — Git workspace identity: separate WORKTREE identity from
 * REPOSITORY identity.
 *
 * Daemon dedup, state, and scheduling have historically been keyed on the
 * worktree path (`process.cwd()`), so N Git worktrees of the same repository
 * behave as N unrelated projects — the cardinality bug behind the worktree
 * daemon fanout. This service resolves the identity that is SHARED across
 * worktrees:
 *
 *   worktreeRoot   `git rev-parse --show-toplevel`   — per-worktree
 *   commonGitDir   `git rev-parse --git-common-dir`  — shared by all worktrees
 *   repositoryId   sha256(canonical commonGitDir)    — stable repo key
 *   head           `git rev-parse HEAD`              — current commit
 *
 * Two worktrees of one repository resolve to the SAME repositoryId (and,
 * when checked out at the same commit, the same head) — the key ingredient
 * for cross-worktree job dedup (issue invariant 5).
 *
 * Non-git directories degrade gracefully: repositoryId falls back to a hash
 * of the resolved directory path (prefixed `dir:`-style via isGit=false), so
 * callers never need a special case.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { resolve } from 'path';
import * as fs from 'fs';

export interface GitWorkspaceIdentity {
  /** Absolute root of this worktree (or the input dir when not a git repo). */
  worktreeRoot: string;
  /** Absolute path of the shared .git directory (equals worktreeRoot/.git for non-worktree clones). */
  commonGitDir: string;
  /** Stable id shared by ALL worktrees of one repository. */
  repositoryId: string;
  /** Current HEAD commit sha ('' when not a git repo or unborn HEAD). */
  head: string;
  /** False when the directory is not inside a git repository. */
  isGit: boolean;
}

const GIT_TIMEOUT_MS = 3000;

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Identity is stable for the life of a process (repo location doesn't move),
// but HEAD is not — cache only the expensive, stable parts per directory.
const identityCache = new Map<string, Omit<GitWorkspaceIdentity, 'head'>>();

/**
 * Resolve the git workspace identity for a directory. Never throws.
 */
export function resolveGitWorkspaceIdentity(dir: string): GitWorkspaceIdentity {
  const resolved = resolve(dir);

  let stable = identityCache.get(resolved);
  if (!stable) {
    const worktreeRoot = git(resolved, 'rev-parse', '--show-toplevel');
    if (!worktreeRoot) {
      stable = {
        worktreeRoot: resolved,
        commonGitDir: '',
        // 'dir:' prefix keeps non-git ids from ever colliding with repo ids.
        repositoryId: sha256(`dir:${canonicalPath(resolved)}`),
        isGit: false,
      };
    } else {
      // --git-common-dir may be relative to the worktree root (git < 2.31
      // and some invocation contexts) — resolve against it.
      const rawCommon = git(worktreeRoot, 'rev-parse', '--git-common-dir') ?? '.git';
      const commonGitDir = resolve(worktreeRoot, rawCommon);
      stable = {
        worktreeRoot,
        commonGitDir,
        repositoryId: sha256(`git:${canonicalPath(commonGitDir)}`),
        isGit: true,
      };
    }
    identityCache.set(resolved, stable);
  }

  const head = stable.isGit ? (git(stable.worktreeRoot, 'rev-parse', 'HEAD') ?? '') : '';
  return { ...stable, head };
}

/**
 * Canonicalize a path so the same repository yields the same repositoryId
 * regardless of symlinked prefixes (/tmp vs /private/tmp on macOS, etc.).
 */
function canonicalPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Test hook: clear the per-process identity cache. */
export function resetGitIdentityCacheForTests(): void {
  identityCache.clear();
}
