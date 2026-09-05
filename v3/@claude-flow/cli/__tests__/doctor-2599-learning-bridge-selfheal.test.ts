/**
 * Regression guard for #2599:
 *   Plain `doctor` (no --fix) must self-heal a missing/stale
 *   `.claude-flow/memory-package.json` sidecar when the CLI can still resolve
 *   `@claude-flow/memory` from its own module context.
 *
 * Root cause: `checkLearningBridge()` used `resolveMemoryPackageFromProject`
 * (project-side walk) and hard-failed on null. Only `--fix` invoked
 * `recordMemoryPackagePath` (CLI-side resolve + write sidecar). The scheduled
 * verification harness runs plain `doctor`, so it reported a hard fail for
 * something the CLI was fully capable of repairing automatically.
 *
 * This test drives the check via the `--component=learning-bridge` flag with
 * the project-side resolver mocked to null and the CLI-side recorder mocked
 * to write the sidecar. On the fixed code, plain `doctor` calls the recorder
 * exactly once (with `resolvedBy: "doctor-auto"`) and the sidecar file
 * appears. On the pre-fix code, the recorder is never called on the plain
 * path and the sidecar never appears — the test fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the resolver module BEFORE importing doctor. checkLearningBridge closes
// over these two functions — the mock reshapes the closure.
vi.mock('../src/init/memory-package-resolver.js', async () => {
  const actual = await vi.importActual<typeof import('../src/init/memory-package-resolver.js')>(
    '../src/init/memory-package-resolver.js',
  );
  return {
    ...actual,
    // Project-side walk fails (stale/missing sidecar, pruned npx cache path).
    resolveMemoryPackageFromProject: vi.fn(() => null),
    // CLI-side recorder succeeds — writes the sidecar and returns a record.
    recordMemoryPackagePath: vi.fn((targetDir: string, resolvedBy = 'init') => {
      const sidecarDir = join(targetDir, '.claude-flow');
      const sidecar = join(sidecarDir, 'memory-package.json');
      const record = {
        distPath: '/fake/npx/cache/@claude-flow/memory/dist/index.js',
        version: '3.25.2',
        resolvedBy,
        resolvedAt: new Date().toISOString(),
      };
      mkdirSync(sidecarDir, { recursive: true });
      writeFileSync(sidecar, JSON.stringify(record, null, 2), 'utf-8');
      return record;
    }),
    readMemoryPackageVersion: vi.fn(() => '3.25.2'),
  };
});

// Import AFTER mock so doctor's module closure picks up the mocked functions.
import { doctorCommand } from '../src/commands/doctor.js';
import * as resolver from '../src/init/memory-package-resolver.js';

const ORIGINAL_CWD = process.cwd();
let tempProject: string;

beforeEach(() => {
  tempProject = mkdtempSync(join(tmpdir(), 'doctor-2599-'));
  // Deploy the auto-memory hook so checkLearningBridge does NOT short-circuit
  // on the "hook not installed" quiet-pass path — we need it to enter the
  // resolver branch that #2599 fixed.
  mkdirSync(join(tempProject, '.claude', 'helpers'), { recursive: true });
  writeFileSync(
    join(tempProject, '.claude', 'helpers', 'auto-memory-hook.mjs'),
    '// stub auto-memory hook for #2599 test\n',
    'utf-8',
  );
  process.chdir(tempProject);
  vi.mocked(resolver.recordMemoryPackagePath).mockClear();
  vi.mocked(resolver.resolveMemoryPackageFromProject).mockClear();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  try {
    rmSync(tempProject, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('doctor #2599 — plain run self-heals Learning Bridge sidecar', () => {
  it('writes the sidecar automatically on plain `doctor` (no --fix)', async () => {
    // Run doctor scoped to just the Learning Bridge check.
    // Crucially: no `fix`, no `install` flags — this is the plain path
    // that #2599 was reported against.
    const ctx = {
      flags: { component: 'learning-bridge' as unknown as string },
      args: [],
      config: {} as Record<string, unknown>,
    } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];

    await doctorCommand.action!(ctx);

    // #2599: the fix calls recordMemoryPackagePath(cwd, 'doctor-auto') from
    // within checkLearningBridge itself when the project-side resolve fails.
    // On the buggy code this branch does not exist — the recorder is only
    // invoked from the --fix / --install repair block, which we did not set.
    expect(vi.mocked(resolver.recordMemoryPackagePath)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolver.recordMemoryPackagePath)).toHaveBeenCalledWith(
      expect.any(String),
      'doctor-auto',
    );

    // And the sidecar file must exist as observable filesystem side-effect —
    // otherwise the runtime hook still cannot find @claude-flow/memory.
    const sidecar = join(tempProject, '.claude-flow', 'memory-package.json');
    expect(existsSync(sidecar)).toBe(true);
  });
});
