/**
 * Regression guard for #2737:
 *
 *   `doctor`'s real memory-database integrity check (`checkMemoryIntegrity`,
 *   plus `checkMemoryContent` / `checkMemoryEmbeddingCoverage`) was only
 *   registered under `componentMap['memory']` (`--component memory`), never
 *   in the `allChecks` array a bare `doctor` or `doctor --fix` actually runs.
 *   The default run's only memory probe was `checkMemoryDatabase` — plain
 *   `existsSync` + `statSync` — which reports `pass` for ANY file that
 *   exists and can be stat'd, corrupt or not. A genuinely corrupt
 *   `.swarm/memory.db` could sail through a bare `doctor` run reporting
 *   "All checks passed! System is healthy."
 *
 * The fix (three parts):
 *   1. A new, bounded, native `checkMemoryStructuralIntegrity` check (native
 *      better-sqlite3 `PRAGMA quick_check`, WAL-aware) is now IN `allChecks`,
 *      so a bare `doctor` run actually opens the file. `checkMemoryDatabase`
 *      is relabeled "Memory Database Presence" to be honest about its scope.
 *   2. `checkMemoryIntegrity` (deep, `--component memory` only) now prefers
 *      native better-sqlite3 `PRAGMA integrity_check` over the sql.js
 *      fallback, and the full #2677 trio stays registered there unchanged.
 *   3. A definitively malformed (and unencrypted) DB maps to `fail`, not
 *      `warn`, in both checks — WITH a carve-out for legitimately
 *      RFE1-encrypted-at-rest files (ADR-096), which are NOT malformed.
 *
 * This suite drives the checks through `doctorCommand.action()` — the same
 * entry point a real `doctor` / `doctor --component memory` invocation uses
 * — and inspects the returned `HealthCheck[]` plus the top-level
 * success/exitCode so the wiring gap itself (not just the check functions
 * in isolation) is what's under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { doctorCommand } from '../src/commands/doctor.js';
import { encryptBuffer } from '../src/encryption/vault.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

type HealthCheck = { name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string };
type DoctorData = { passed: number; warnings: number; failed: number; results: HealthCheck[] };

const ORIGINAL_CWD = process.cwd();
let workdir: string;

async function runDoctor(component?: string) {
  const ctx = {
    flags: component ? { component } : {},
    args: [],
    config: {} as Record<string, unknown>,
  } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
  return doctorCommand.action!(ctx);
}

function findCheck(results: HealthCheck[], namePart: string): HealthCheck | undefined {
  return results.find((r) => r.name.includes(namePart));
}

describe('doctor #2737 — bare `doctor` actually opens memory.db', () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'doctor-2737-'));
    process.chdir(workdir);
    _resetMemoryRootCache();
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    _resetMemoryRootCache();
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function plantDb(bytes: Buffer | string) {
    mkdirSync(join(workdir, '.swarm'), { recursive: true });
    writeFileSync(join(workdir, '.swarm', 'memory.db'), bytes);
  }

  it('default `doctor` run reports the renamed presence check and the new structural check', async () => {
    // No DB planted — both checks should degrade to warn (not-yet-initialized
    // project), never a silent pass/absence.
    const result = await runDoctor();
    const data = result.data as DoctorData;
    const presence = findCheck(data.results, 'Memory Database Presence');
    const structural = findCheck(data.results, 'Memory Structural Integrity');
    expect(presence).toBeDefined();
    expect(structural).toBeDefined();
    // The old, misleading "Memory Database" (unqualified) name must be gone.
    expect(data.results.some((r) => r.name === 'Memory Database')).toBe(false);
  }, 20000);

  it('healthy DB → default `doctor` run passes, including the new structural check', async () => {
    // Build a real, valid SQLite file via better-sqlite3 (same native module
    // the check under test uses) so this is an authentic positive case.
    const Database = (await import('better-sqlite3')).default as any;
    mkdirSync(join(workdir, '.swarm'), { recursive: true });
    const db = new Database(join(workdir, '.swarm', 'memory.db'));
    db.exec('CREATE TABLE memory_entries (id INTEGER PRIMARY KEY, content TEXT)');
    db.exec("INSERT INTO memory_entries (content) VALUES ('hello world')");
    db.close();

    const result = await runDoctor();
    const data = result.data as DoctorData;
    const structural = findCheck(data.results, 'Memory Structural Integrity');
    expect(structural?.status).toBe('pass');
    expect(structural?.message).toMatch(/quick_check: ok/);
    expect(structural?.message).toMatch(/structural-only/);

    const presence = findCheck(data.results, 'Memory Database Presence');
    expect(presence?.status).toBe('pass');
  }, 20000);

  it('malformed/corrupt DB → default `doctor` run FAILS the new structural check and does not report all-healthy', async () => {
    // Garbage bytes at the memory.db path — not a SQLite file, not RFE1-encrypted.
    plantDb(Buffer.from('this is definitely not a sqlite database, just garbage padding bytes to be safe'.repeat(3)));

    const result = await runDoctor();
    const data = result.data as DoctorData;
    const structural = findCheck(data.results, 'Memory Structural Integrity');

    // Core regression assertion: the old bug reported "pass" here (or the
    // check was entirely absent from the default run). It must now be a
    // hard `fail`, never `pass`, and never silently missing.
    expect(structural).toBeDefined();
    expect(structural?.status).toBe('fail');
    expect(structural?.status).not.toBe('pass');

    // And the wiring-gap regression: the overall doctor run must NOT report
    // success/no-failures when a memory check has failed — this is exactly
    // the "All checks passed! System is healthy." false-negative from #2737.
    expect(data.failed).toBeGreaterThan(0);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);

    // The old, presence-only check must still just report the file exists —
    // it is not being asked to change behavior, only to be honestly labeled.
    const presence = findCheck(data.results, 'Memory Database Presence');
    expect(presence?.status).toBe('pass');
  }, 20000);

  it('legitimately RFE1-encrypted-at-rest DB is NOT misclassified as corrupt', async () => {
    // Build a real encrypted blob with the product's own vault primitives —
    // this is exactly what an at-rest-encrypted memory.db looks like on disk.
    const key = randomBytes(32);
    const plaintext = Buffer.from('SQLite format 3\0'.padEnd(200, '\0'), 'binary');
    const blob = encryptBuffer(plaintext, key);
    plantDb(blob);

    const result = await runDoctor();
    const data = result.data as DoctorData;
    const structural = findCheck(data.results, 'Memory Structural Integrity');

    expect(structural).toBeDefined();
    // Must NOT be a hard fail — encryption is expected, not corruption.
    expect(structural?.status).not.toBe('fail');
    expect(structural?.status).toBe('warn');
    expect(structural?.message.toLowerCase()).toMatch(/encrypt/);
  }, 20000);

  it('`doctor --component memory` still runs the full #2677 trio unchanged', async () => {
    const Database = (await import('better-sqlite3')).default as any;
    mkdirSync(join(workdir, '.swarm'), { recursive: true });
    const db = new Database(join(workdir, '.swarm', 'memory.db'));
    db.exec('CREATE TABLE memory_entries (id INTEGER PRIMARY KEY, content TEXT)');
    db.exec("INSERT INTO memory_entries (content) VALUES ('hello world')");
    db.close();

    const result = await runDoctor('memory');
    const data = result.data as DoctorData;
    const names = data.results.map((r) => r.name);

    expect(names).toContain('Memory Database Presence');
    expect(names).toContain('Memory Integrity');
    expect(names).toContain('Memory Content');
    expect(names).toContain('Memory Embedding Coverage');
    // The new default-run-only check is deliberately NOT part of the deep
    // --component memory suite (it's the cheap default-run probe, not a
    // replacement for the trio).
    expect(names.some((n) => n.includes('Memory Structural Integrity'))).toBe(false);
  });

  it('`doctor --component memory`: checkMemoryIntegrity fails (not warns) on a definitively malformed, unencrypted DB', async () => {
    plantDb(Buffer.from('garbage not a database'.repeat(5)));
    const result = await runDoctor('memory');
    const data = result.data as DoctorData;
    const integrity = findCheck(data.results, 'Memory Integrity');
    expect(integrity?.status).toBe('fail');
  });

  it('`doctor --component memory`: checkMemoryIntegrity does not hard-fail a legitimately encrypted DB', async () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('SQLite format 3\0'.padEnd(200, '\0'), 'binary');
    const blob = encryptBuffer(plaintext, key);
    plantDb(blob);

    const result = await runDoctor('memory');
    const data = result.data as DoctorData;
    const integrity = findCheck(data.results, 'Memory Integrity');
    expect(integrity?.status).not.toBe('fail');
  });
});
