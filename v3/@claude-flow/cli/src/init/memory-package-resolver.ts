/**
 * Memory Package Resolver (#2545)
 *
 * `@claude-flow/memory` is an *optionalDependency* of `@claude-flow/cli`. On the
 * documented `npx ruflo` install path it lands in the npx cache
 * (`~/.npm/_npx/<hash>/node_modules`), which is NOT on the node_modules walk-up
 * path from the user's project. The SessionStart auto-memory hook therefore
 * could never resolve it and self-learning silently no-op'd.
 *
 * At init time, however, the CLI *can* resolve the package from its own module
 * context (it is installed alongside the CLI in that same npx cache). We resolve
 * it once and record the absolute path in a machine-local project sidecar
 * (`.claude-flow/memory-package.json`). The hook reads this sidecar first, so it
 * reuses the copy npx already downloaded — no second install, no vendoring.
 *
 * This module is deliberately dependency-free and best-effort: nothing here ever
 * throws into the init/doctor flow.
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

export const MEMORY_PACKAGE = '@claude-flow/memory';
/** Project-relative path of the resolver sidecar written by init / doctor --fix. */
export const MEMORY_SIDECAR_REL = path.join('.claude-flow', 'memory-package.json');

export interface MemoryPackageRecord {
  /** Absolute path to the package's main entry (dist/index.js). */
  distPath: string;
  /** Resolved package version, if readable. */
  version: string | null;
  /** What produced this record ("init" | "doctor" | "upgrade"). */
  resolvedBy: string;
  /** ISO timestamp of resolution. */
  resolvedAt: string;
}

/**
 * Resolve `@claude-flow/memory`'s main entry from the CLI's own module context.
 * Returns the absolute dist path, or null when the optional dependency is absent
 * (e.g. installed with `--omit=optional`).
 */
export function resolveMemoryPackageFromCli(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(MEMORY_PACKAGE);
  } catch {
    return null;
  }
}

/**
 * Resolve `@claude-flow/memory` the same way the runtime hook does, from a target
 * project directory: sidecar → project package.json → node_modules walk-up.
 * Used by `doctor` so its verdict matches what the hook will actually experience.
 */
export function resolveMemoryPackageFromProject(targetDir: string): string | null {
  // 1. Sidecar written by a previous init / doctor --fix
  try {
    const sidecar = path.join(targetDir, MEMORY_SIDECAR_REL);
    if (fs.existsSync(sidecar)) {
      const rec = JSON.parse(fs.readFileSync(sidecar, 'utf-8')) as Partial<MemoryPackageRecord>;
      if (rec?.distPath && fs.existsSync(rec.distPath)) return rec.distPath;
    }
  } catch {
    /* fall through */
  }

  // 2. createRequire from the project's package.json (direct/transitive dep)
  try {
    const require = createRequire(path.join(targetDir, 'package.json'));
    return require.resolve(MEMORY_PACKAGE);
  } catch {
    /* fall through */
  }

  // 3. node_modules walk-up from the project root
  let dir = path.resolve(targetDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, 'node_modules', '@claude-flow', 'memory', 'dist', 'index.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/** Read the version of the resolved memory package (dist/index.js → ../package.json). */
export function readMemoryPackageVersion(distPath: string): string | null {
  try {
    const pkgJson = path.resolve(path.dirname(distPath), '..', 'package.json');
    if (fs.existsSync(pkgJson)) {
      const parsed = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')) as { version?: string };
      return parsed.version ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Best-effort: resolve `@claude-flow/memory` from the CLI and record its path in
 * the project sidecar so the runtime hook can find it on the npx install path.
 * Returns the written record, or null when the package is not resolvable from the
 * CLI (in which case the hook fails loud and `doctor` flags it).
 */
export function recordMemoryPackagePath(
  targetDir: string,
  resolvedBy = 'init',
): MemoryPackageRecord | null {
  const distPath = resolveMemoryPackageFromCli();
  if (!distPath) return null;

  const record: MemoryPackageRecord = {
    distPath,
    version: readMemoryPackageVersion(distPath),
    resolvedBy,
    resolvedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(path.join(targetDir, '.claude-flow'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, MEMORY_SIDECAR_REL),
      JSON.stringify(record, null, 2),
      'utf-8',
    );
    return record;
  } catch {
    return null;
  }
}
