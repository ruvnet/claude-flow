import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { safeGitArgv, safeGitTextSync } from '../src/safe-git.js';

const roots: string[] = [];

function rawGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-safe-git-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  rawGit(root, 'config', 'user.email', 'safe-git@example.invalid');
  rawGit(root, 'config', 'user.name', 'Safe Git Test');
  writeFileSync(join(root, 'README.md'), 'seed\n');
  rawGit(root, 'add', 'README.md');
  rawGit(root, 'commit', '--quiet', '-m', 'seed');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('safe Git subprocess policy', () => {
  it('places the fsmonitor override before repository selection', () => {
    expect(safeGitArgv('/tmp/repo', ['status', '--porcelain'])).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-C',
      '/tmp/repo',
      'status',
      '--porcelain',
    ]);
  });

  it.runIf(process.platform !== 'win32')('blocks repository-local core.fsmonitor execution', () => {
    const root = repository();
    const sentinel = join(root, '..', `gitspawn-sentinel-${process.pid}`);
    const payload = join(root, '..', `gitspawn-payload-${process.pid}.sh`);
    writeFileSync(payload, `#!/bin/sh\nprintf triggered > ${JSON.stringify(sentinel)}\nexit 0\n`);
    chmodSync(payload, 0o700);
    rawGit(root, 'config', 'core.fsmonitor', payload);

    rawGit(root, 'status', '--porcelain');
    expect(existsSync(sentinel)).toBe(true);
    rmSync(sentinel, { force: true });

    expect(safeGitTextSync(root, ['status', '--porcelain'])).toBe('');
    expect(existsSync(sentinel)).toBe(false);
  });

  it('rejects NUL bytes before spawning Git', () => {
    expect(() => safeGitArgv('/tmp/repo\0other', ['status'])).toThrow(/path is invalid/);
    expect(() => safeGitArgv('/tmp/repo', ['status\0other'])).toThrow(/NUL/);
  });
});
