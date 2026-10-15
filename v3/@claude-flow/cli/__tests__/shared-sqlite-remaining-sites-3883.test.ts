/**
 * #3883 — follow-up to #3693/#3871: the remaining read-write better-sqlite3
 * opens must resolve the constructor through the shared loader
 * (`../src/memory/shared-sqlite.ts`), not a separately-imported copy of the
 * package, so the CLI shares AgentDB's native better-sqlite3 identity.
 *
 * Each fixed call site is proven to route through `loadBetterSqlite3()` by
 * mocking that export and observing an outcome the call site can only
 * produce by going through the mock (a specific skip reason / thrown
 * message, or the spy being invoked during a real, successful restore) —
 * never a direct `import('better-sqlite3')` bypassing it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let RealDatabase: any;
let haveNative = false;
try {
  RealDatabase = (await import('better-sqlite3')).default;
  haveNative = true;
} catch {
  haveNative = false;
}

const loadBetterSqlite3Spy = vi.fn(async () => RealDatabase);

vi.mock('../src/memory/shared-sqlite.js', () => ({
  loadBetterSqlite3: loadBetterSqlite3Spy,
  resolveAgentdbBetterSqlite3: () => RealDatabase,
}));

afterEach(() => {
  loadBetterSqlite3Spy.mockReset();
  loadBetterSqlite3Spy.mockImplementation(async () => RealDatabase);
});

describe('#3883 remaining shared-sqlite call sites', () => {
  it('memory-distillation.ts runDistillation() loads Database via the shared loader', async () => {
    if (!haveNative) return;
    const { runDistillation } = await import('../src/services/memory-distillation.js');
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-3883-distill-'));
    const dbPath = join(dir, 'memory.db');
    writeFileSync(dbPath, '');

    const report = await runDistillation({ dbPath, dryRun: true });

    expect(loadBetterSqlite3Spy).toHaveBeenCalledTimes(1);
    expect(report.skipped).toBe('no memory_entries');
  });

  it('memory-distillation.ts maps a shared-loader failure to its own skip reason', async () => {
    if (!haveNative) return;
    loadBetterSqlite3Spy.mockImplementation(async () => {
      throw new Error('better-sqlite3 not installed');
    });
    const { runDistillation } = await import('../src/services/memory-distillation.js');
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-3883-distill-skip-'));
    const dbPath = join(dir, 'memory.db');
    writeFileSync(dbPath, '');

    const report = await runDistillation({ dbPath, dryRun: true });

    expect(loadBetterSqlite3Spy).toHaveBeenCalledTimes(1);
    expect(report.skipped).toBe('better-sqlite3 unavailable');
  });

  it('distill-tuning.ts tuneDistillation() loads Database via the shared loader (no local shadow)', async () => {
    if (!haveNative) return;
    loadBetterSqlite3Spy.mockImplementation(async () => {
      throw new Error('better-sqlite3 not installed');
    });
    const { tuneDistillation } = await import('../src/services/distill-tuning.js');
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-3883-tune-'));
    const dbPath = join(dir, 'memory.db');
    writeFileSync(dbPath, '');

    await expect(tuneDistillation({ dbPath })).rejects.toThrow(
      'tuneDistillation: better-sqlite3 unavailable — cannot run the tuning harness',
    );
    expect(loadBetterSqlite3Spy).toHaveBeenCalledTimes(1);
  });

  it('memory-backup.ts restoreMemoryDbFromBackup() loads Database via the shared loader during a real restore', async () => {
    if (!haveNative) return;
    const { restoreMemoryDbFromBackup } = await import('../src/services/memory-backup.js');
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-3883-backup-'));
    const destDir = join(dir, 'backups');
    mkdirSync(destDir, { recursive: true });

    // Snapshot filename must match isSnapshotFor()'s prefix + ISO-stamp regex
    // for a 'memory.db' target.
    const snapPath = join(destDir, 'memory-2024-01-01T00-00-00-000Z.db');
    const seed = new RealDatabase(snapPath);
    seed.exec('CREATE TABLE memory_entries (id TEXT)');
    seed.prepare('INSERT INTO memory_entries VALUES (?)').run('x1');
    seed.close();

    const dbPath = join(dir, 'memory.db');
    const result = await restoreMemoryDbFromBackup(dbPath, { destDir });

    expect(loadBetterSqlite3Spy).toHaveBeenCalled();
    expect(result.restored).toBe(true);
    expect(result.rows).toBe(1);
    expect(existsSync(dbPath)).toBe(true);
  });
});
