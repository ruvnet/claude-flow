#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmArgs = [
  'pnpm@8.15.0',
  '--dir',
  'v3',
  '--filter',
  '@claude-flow/hooks',
  '--filter',
  '@claude-flow/shared',
  '--filter',
  '@claude-flow/guidance',
  'run',
  'build',
];
const command = process.platform === 'win32'
  ? (process.env.ComSpec || 'cmd.exe')
  : 'corepack';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', `corepack ${pnpmArgs.join(' ')}`]
  : pnpmArgs;
const result = spawnSync(
  command,
  args,
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Required package build failed with exit code ${result.status ?? 'unknown'}`);
}
