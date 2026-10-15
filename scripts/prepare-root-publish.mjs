#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageInternalRuntimeBundles } from './stage-internal-runtime-bundles.mjs';

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

const cliDirectory = resolve(repoRoot, 'v3', '@claude-flow', 'cli');
await stageInternalRuntimeBundles(cliDirectory);

// CreateProcess cannot launch a .cmd directly, and Node has refused to
// implicitly shell out to one since CVE-2024-27980 — spawnSync('npm.cmd', ...)
// without shell:true throws EINVAL on Windows (see stage-internal-runtime-
// bundles.mjs's runBuild(), same bug, same fix). command/args here are
// constant literals, never externally derived, so shell:true is safe.
const win32 = process.platform === 'win32';
for (const packageDirectory of [
  resolve(repoRoot, 'v3', '@claude-flow', 'swarm'),
  cliDirectory,
]) {
  const build = win32
    ? spawnSync('npm.cmd run build', { cwd: packageDirectory, stdio: 'inherit', shell: true })
    : spawnSync('npm', ['run', 'build'], { cwd: packageDirectory, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    throw new Error(
      `Required package build failed for ${packageDirectory} with exit code ${build.status ?? 'unknown'}`,
    );
  }
}

await stageInternalRuntimeBundles(repoRoot, { build: false });
