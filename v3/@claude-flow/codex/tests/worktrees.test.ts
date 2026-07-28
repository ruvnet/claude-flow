import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexWorktreeCoordinator } from '../src/worktrees/index.js';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function repo(): string {
  const parent = mkdtempSync(join(tmpdir(), 'ruflo-codex-worktrees-'));
  roots.push(parent);
  const root = join(parent, 'repo');
  execFileSync('git', ['init', root]);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'seed');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CodexWorktreeCoordinator', () => {
  it('creates distinct owned worktrees and cleans only clean assignments', () => {
    const root = repo();
    const coordinator = new CodexWorktreeCoordinator(root);
    const record = coordinator.prepare('run-1', [{ id: 'coder' }, { id: 'tester' }, { id: 'research', readOnly: true }]);
    expect(new Set(record.assignments.map((item) => item.path)).size).toBe(3);
    expect(coordinator.prepare('run-1', [{ id: 'ignored' }])).toEqual(record);
    expect(coordinator.cleanup('run-1')).toEqual({
      removed: ['coder', 'tester', 'research'],
      retained: [],
    });
  });

  it('refuses dirty coordinator state and unsafe identifiers', () => {
    const root = repo();
    writeFileSync(join(root, 'README.md'), 'dirty\n');
    const coordinator = new CodexWorktreeCoordinator(root);
    expect(() => coordinator.prepare('run-2', [{ id: 'coder' }])).toThrow(/dirty repository/);
    expect(() => coordinator.prepare('../escape', [{ id: 'coder' }], { allowDirty: true })).toThrow(/invalid run id/);
  });

  it('retains dirty worker worktrees during cleanup', () => {
    const root = repo();
    const coordinator = new CodexWorktreeCoordinator(root);
    const record = coordinator.prepare('run-3', [{ id: 'coder' }]);
    writeFileSync(join(record.assignments[0]!.path, 'uncommitted.txt'), 'keep me\n');
    expect(coordinator.cleanup('run-3')).toEqual({ removed: [], retained: ['coder'] });
    expect(coordinator.status('run-3').assignments[0]!.agentId).toBe('coder');
    git(record.assignments[0]!.path, 'add', 'uncommitted.txt');
    git(record.assignments[0]!.path, 'commit', '-m', 'preserve');
    expect(coordinator.cleanup('run-3')).toEqual({ removed: ['coder'], retained: [] });
  });
});
