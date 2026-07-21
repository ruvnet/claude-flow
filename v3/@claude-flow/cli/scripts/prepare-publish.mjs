#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..', '..');
const pluginsDir = join(packageDir, 'plugins');

// `dist` is intentionally ignored by Git, so publishing without a build can
// create a tarball whose declared entry point does not exist. Build the only
// emitted project reference CLI needs (`@claude-flow/swarm`) and then CLI.
// Do not use `tsc --build`: it recursively rebuilds unrelated optional
// workspace packages whose development-only dependencies are not required to
// package this CLI.
const compiler = join(packageDir, 'node_modules', 'typescript', 'bin', 'tsc');
for (const buildDir of [resolve(packageDir, '..', 'swarm'), packageDir]) {
  const build = spawnSync(process.execPath, [compiler], {
    cwd: buildDir,
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    throw new Error(`TypeScript release build failed for ${buildDir} with exit code ${build.status ?? 'unknown'}`);
  }
}

await cp(join(repoRoot, 'README.md'), join(packageDir, 'README.md'));
await rm(pluginsDir, { recursive: true, force: true });
await mkdir(pluginsDir, { recursive: true });
await cp(
  join(repoRoot, 'plugins', 'ruflo-metaharness'),
  join(pluginsDir, 'ruflo-metaharness'),
  { recursive: true },
);

for (const script of [
  'generate-catalog-manifest.mjs',
  'sign-helpers.mjs',
  'verify-helpers.mjs',
]) {
  const result = spawnSync(process.execPath, [join(packageDir, 'scripts', script)], {
    cwd: packageDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}`);
  }
}
