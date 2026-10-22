/**
 * #2545 — Documented `npx ruflo init` path leaves self-learning silently
 * non-functional because `@claude-flow/memory` (an optionalDependency of the
 * CLI) lands in the npx cache, unreachable by a node_modules walk-up from the
 * user's project. The SessionStart auto-memory hook then no-op'd with no signal.
 *
 * Fix: init resolves the package from the CLI's own module context and records
 * its absolute path in `.claude-flow/memory-package.json`; the hook reads that
 * sidecar first. When the package is genuinely unresolvable, the hook now fails
 * LOUD instead of a silent dim skip.
 *
 * These tests pin all three behaviors:
 *   1. the resolver records + reads back a working sidecar (the "make it work" path)
 *   2. the deployed hook activates when the sidecar is present (was silent before)
 *   3. the deployed hook fails LOUD when memory is unresolvable (was silent before)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import Module from 'module';

import {
  MEMORY_SIDECAR_REL,
  resolveMemoryPackageFromCli,
  resolveMemoryPackageFromProject,
  recordMemoryPackagePath,
} from '../src/init/memory-package-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SRC = path.resolve(__dirname, '../.claude/helpers/auto-memory-hook.mjs');

// pnpm's Vitest shim exposes workspace packages through NODE_PATH. Node copies
// that path into Module.globalPaths at startup, so changing the env alone does
// not make an "unresolvable" project isolated inside this test worker.
function withoutNodePath<T>(run: () => T): T {
  const saved = process.env.NODE_PATH;
  const initPaths = () => (Module as typeof Module & { _initPaths(): void })._initPaths();
  delete process.env.NODE_PATH;
  initPaths();
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = saved;
    initPaths();
  }
}

function envWithoutNodePath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_PATH;
  return env;
}

/** Deploy the real init-copied hook into a temp project, like `ruflo init` does. */
function scaffoldProject(root: string): string {
  const helpers = path.join(root, '.claude', 'helpers');
  mkdirSync(helpers, { recursive: true });
  copyFileSync(HOOK_SRC, path.join(helpers, 'auto-memory-hook.mjs'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'repro-2545', version: '1.0.0' }),
  );
  return path.join(helpers, 'auto-memory-hook.mjs');
}

function runHook(hookPath: string, cwd: string, cmd: string): { stdout: string; ok: boolean } {
  try {
    const stdout = execFileSync('node', [hookPath, cmd], { cwd, encoding: 'utf-8', env: envWithoutNodePath() });
    return { stdout, ok: true };
  } catch (err) {
    // The hook must never crash Claude Code (exit 0); a throw here is a failure.
    const e = err as { stdout?: string };
    return { stdout: e.stdout ?? '', ok: false };
  }
}

describe('#2545 memory package resolver', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'cf-2545-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves @claude-flow/memory from the CLI module context', () => {
    // In the monorepo this mirrors the npx-cache situation: the package is
    // reachable from the CLI even though it is not in the user project.
    const dist = resolveMemoryPackageFromCli();
    expect(dist).toBeTruthy();
    expect(existsSync(dist as string)).toBe(true);
  });

  it('records a resolver sidecar and reads it back (the strategy the hook uses)', () => {
    const rec = recordMemoryPackagePath(tmp, 'init');
    expect(rec).toBeTruthy();

    const sidecar = path.join(tmp, MEMORY_SIDECAR_REL);
    expect(existsSync(sidecar)).toBe(true);

    const parsed = JSON.parse(readFileSync(sidecar, 'utf-8'));
    expect(parsed.distPath).toBe(rec!.distPath);
    expect(parsed.resolvedBy).toBe('init');

    // project-side resolution (what doctor + the hook do) finds it via the sidecar
    expect(resolveMemoryPackageFromProject(tmp)).toBe(rec!.distPath);
  });

  it('returns null for an isolated project with no package and no sidecar', () => {
    const nowhere = path.join(tmp, 'isolated', 'deep');
    mkdirSync(nowhere, { recursive: true });
    expect(withoutNodePath(() => resolveMemoryPackageFromProject(nowhere))).toBeNull();
  });

  it('deployed hook ACTIVATES self-learning when init has recorded the sidecar', () => {
    const dist = resolveMemoryPackageFromCli();
    if (!dist || !existsSync(dist)) {
      // Built memory dist required for this integration assertion.
      return;
    }
    const hookPath = scaffoldProject(tmp);
    recordMemoryPackagePath(tmp, 'init'); // what init now does after writeHelpers

    const { stdout, ok } = runHook(hookPath, tmp, 'status');
    expect(ok).toBe(true); // exit 0 — never crashes Claude Code
    expect(stdout).toContain('Package:        ✅ Available');
    expect(stdout).toContain('Resolver:       ✅');
    expect(stdout).not.toContain('DISABLED');
  });

  it('deployed hook fails LOUD (not a silent skip) when memory is unresolvable', () => {
    const hookPath = scaffoldProject(tmp); // NO sidecar, NO installed package

    const { stdout, ok } = runHook(hookPath, tmp, 'import');
    expect(ok).toBe(true); // still exit 0 — loud, but non-fatal
    // The pre-fix behavior was a dim "skipping" line with no remediation. Now:
    expect(stdout).toContain('self-learning imports are DISABLED');
    expect(stdout).toContain('npm i -D @claude-flow/memory');
    // and it must NOT create the store (proves it really was a no-op, loudly)
    expect(existsSync(path.join(tmp, '.claude-flow', 'data', 'auto-memory-store.json'))).toBe(false);
  });
});
