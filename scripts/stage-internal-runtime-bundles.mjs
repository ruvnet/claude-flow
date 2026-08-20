#!/usr/bin/env node

import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const INTERNAL_RUNTIME_PACKAGES = [
  {
    directory: 'security',
    name: '@claude-flow/security',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md'],
  },
  {
    directory: 'codex',
    name: '@claude-flow/codex',
    requiredAssets: ['dist', '.agents/skills'],
    optionalAssets: ['README.md'],
  },
  {
    directory: 'mcp',
    name: '@claude-flow/mcp',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md'],
  },
  {
    directory: 'plugin-agent-federation',
    name: '@claude-flow/plugin-agent-federation',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md', 'LICENSE'],
  },
];

const BUILD_PREREQUISITES = ['shared'];

function runBuild(packageDirectory) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['run', 'build'], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Internal runtime build failed for ${packageDirectory} with exit code ${result.status ?? 'unknown'}`,
    );
  }
}

async function copyIfPresent(source, target) {
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function copyRequired(source, target) {
  await access(source);
  await cp(source, target, { recursive: true });
}

function collectEntrypoints(value, entrypoints) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) entrypoints.add(value.slice(2));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntrypoints(item, entrypoints);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEntrypoints(item, entrypoints);
  }
}

async function validateEntrypoints(packageRoot, packageJson) {
  const entrypoints = new Set();
  collectEntrypoints(packageJson.main, entrypoints);
  collectEntrypoints(packageJson.types, entrypoints);
  collectEntrypoints(packageJson.bin, entrypoints);
  collectEntrypoints(packageJson.exports, entrypoints);
  for (const entrypoint of entrypoints) {
    if (entrypoint.includes('*')) {
      const entrypointDirectory = dirname(entrypoint);
      const expression = new RegExp(
        `^${entrypoint
          .slice(entrypointDirectory.length + 1)
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      const matches = (await readdir(join(packageRoot, entrypointDirectory))).filter(
        (name) => expression.test(name),
      );
      if (matches.length === 0) {
        throw new Error(`No staged entrypoints match ${entrypoint}`);
      }
      continue;
    }
    await access(join(packageRoot, entrypoint));
  }
}

export function createBundledRuntimeManifest(packageJson) {
  const dependencyMetadata = {};
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    if (packageJson[field] && Object.keys(packageJson[field]).length > 0) {
      dependencyMetadata[field] = packageJson[field];
    }
  }

  const bundledManifest = {
    ...packageJson,
    rufloBundledRuntime: {
      format: 1,
      sourceDependencies: dependencyMetadata,
    },
  };
  delete bundledManifest.dependencies;
  delete bundledManifest.optionalDependencies;
  delete bundledManifest.peerDependencies;
  delete bundledManifest.peerDependenciesMeta;
  return bundledManifest;
}

export function alignBundledRuntimeVersion(targetPackageJson, runtimePackageJson) {
  const current = targetPackageJson.dependencies?.[runtimePackageJson.name];
  if (current === undefined) {
    throw new Error(`${runtimePackageJson.name} must be a dependency of ${targetPackageJson.name}`);
  }
  if (current === runtimePackageJson.version) return false;
  targetPackageJson.dependencies[runtimePackageJson.name] = runtimePackageJson.version;
  return true;
}

/**
 * Build reviewed internal packages and stage only their runtime artifacts under
 * a public package's node_modules tree. npm's bundledDependencies mechanism
 * then embeds them in the public tarball, so installation never depends on an
 * unpublished internal package coordinate.
 */
export async function stageInternalRuntimeBundles(
  targetPackageDirectory,
  { build = true } = {},
) {
  const targetRoot = resolve(targetPackageDirectory);
  const scopeRoot = join(targetRoot, 'node_modules', '@claude-flow');
  const targetPackageJson = JSON.parse(
    await readFile(join(targetRoot, 'package.json'), 'utf8'),
  );
  // npm normalizes `bundledDependencies` to `bundleDependencies` when it
  // rewrites a manifest. Accept both documented spellings so staging remains
  // stable after lockfile/version maintenance.
  const declaredBundles = new Set(
    targetPackageJson.bundleDependencies ??
      targetPackageJson.bundledDependencies ??
      [],
  );
  for (const runtimePackage of INTERNAL_RUNTIME_PACKAGES) {
    if (targetPackageJson.dependencies?.[runtimePackage.name] === undefined) {
      throw new Error(`${runtimePackage.name} must be a dependency of ${targetPackageJson.name}`);
    }
    if (!declaredBundles.has(runtimePackage.name)) {
      throw new Error(`${runtimePackage.name} must be bundled by ${targetPackageJson.name}`);
    }
  }
  await mkdir(scopeRoot, { recursive: true });

  if (build) {
    for (const packageDirectory of BUILD_PREREQUISITES) {
      runBuild(join(repoRoot, 'v3', '@claude-flow', packageDirectory));
    }
  }

  let targetManifestChanged = false;

  for (const runtimePackage of INTERNAL_RUNTIME_PACKAGES) {
    const sourceRoot = join(repoRoot, 'v3', '@claude-flow', runtimePackage.directory);
    if (build) runBuild(sourceRoot);

    const packageJson = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
    if (packageJson.name !== runtimePackage.name) {
      throw new Error(
        `Internal bundle identity mismatch: expected ${runtimePackage.name}, got ${String(packageJson.name)}`,
      );
    }
    targetManifestChanged =
      alignBundledRuntimeVersion(targetPackageJson, packageJson) || targetManifestChanged;

    const packageLeaf = runtimePackage.name.slice('@claude-flow/'.length);
    const target = join(scopeRoot, packageLeaf);
    const temporary = `${target}.${process.pid}.tmp`;
    await rm(temporary, { recursive: true, force: true });
    try {
      await mkdir(temporary, { recursive: true });
      await writeFile(
        join(temporary, 'package.json'),
        `${JSON.stringify(createBundledRuntimeManifest(packageJson), null, 2)}\n`,
      );
      for (const asset of runtimePackage.requiredAssets) {
        await copyRequired(join(sourceRoot, asset), join(temporary, asset));
      }
      for (const asset of runtimePackage.optionalAssets) {
        await copyIfPresent(join(sourceRoot, asset), join(temporary, asset));
      }
      await validateEntrypoints(temporary, packageJson);
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  // The source-built runtime may be newer than the registry bootstrap used by
  // `npm ci`. The packed manifest must name the bytes actually embedded in the
  // archive or npm correctly reports the bundle as invalid during install.
  if (targetManifestChanged) {
    await writeFile(
      join(targetRoot, 'package.json'),
      `${JSON.stringify(targetPackageJson, null, 2)}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetIndex = process.argv.indexOf('--target');
  if (targetIndex === -1 || !process.argv[targetIndex + 1]) {
    throw new Error('Usage: stage-internal-runtime-bundles.mjs --target <package-directory>');
  }
  await stageInternalRuntimeBundles(process.argv[targetIndex + 1], {
    build: !process.argv.includes('--no-build'),
  });
}
