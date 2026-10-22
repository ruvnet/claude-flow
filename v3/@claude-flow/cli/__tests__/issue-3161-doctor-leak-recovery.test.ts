/**
 * Regression coverage for issue #3161: `ruflo doctor`'s readonly diagnostic
 * better-sqlite3 connections against `.swarm/memory.db` (see
 * `src/commands/doctor.ts`, e.g. the structural `quick_check` probe) call
 * `.close()` with no checkpoint. WAL mode does not guarantee a checkpoint on
 * a plain close, so this can leave orphaned, non-empty `-wal`/`-shm`
 * sidecars on disk — and the #2735 guard (`hasNativeWalSidecars` in
 * `src/memory/memory-initializer.ts`) used to treat sidecar *presence*
 * alone as proof of a live native holder, permanently refusing every later
 * `memory store`/`memory list` in the project until someone manually
 * deleted the two sidecar files. Running the tool users are told to run when
 * something's wrong (`doctor`) is what caused the lockout. (Empirically the
 * doctor-leaked `-wal` file is present but zero-byte — there is no pending
 * WAL data to lose, which is exactly why the old presence-only check was
 * overbroad and the #3161 fix probes liveness instead of presence.)
 *
 * The #3161 fix makes the guard probe liveness directly
 * (`PRAGMA wal_checkpoint(TRUNCATE)`, refusing only when the checkpoint
 * reports `busy`) instead of trusting sidecar presence. This suite
 * reproduces the bug's exact mechanism end-to-end: a real doctor-style
 * readonly open+close that leaks real, non-empty sidecars, then a real
 * subsequent write through `storeEntry`'s sql.js fallback path — confirming
 * it now self-heals instead of failing permanently.
 *
 * The bridge is force-disabled via CLAUDE_FLOW_DISABLE_BRIDGE=1 (same
 * convention as the #2735/#3397 suites) so the write goes through the
 * sql.js fallback the guard protects, deterministically.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_ENV = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

const walSize = () => (existsSync(`${dbPath}-wal`) ? statSync(`${dbPath}-wal`).size : 0);

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-3161-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');
  const initResult = await initializeMemoryDatabase({ dbPath, verbose: false });
  expect(initResult.success).toBe(true);
  expect(existsSync(`${dbPath}-wal`)).toBe(false);
  expect(existsSync(`${dbPath}-shm`)).toBe(false);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_ENV;
  rmSync(dir, { recursive: true, force: true });
});

describe('doctor-leaked WAL sidecar self-heals on next write — issue #3161', () => {
  it('a doctor-style readonly open+close really does leak non-empty sidecars (precondition)', async () => {
    const { loadBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');
    const Database = await loadBetterSqlite3();

    // Exact pattern from src/commands/doctor.ts's structural quick_check probe:
    // readonly, fileMustExist, one pragma query, then a plain close() in a
    // finally block — no checkpoint anywhere in that path.
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      probe.pragma('quick_check');
    } finally {
      try { probe.close(); } catch { /* best-effort, matches doctor.ts */ }
    }

    expect(existsSync(`${dbPath}-wal`)).toBe(true);
  });

  it('a subsequent memory store self-heals the leaked sidecars instead of failing permanently', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const { loadBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');
    const Database = await loadBetterSqlite3();

    // Reproduce the doctor.ts leak.
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      probe.pragma('quick_check');
    } finally {
      try { probe.close(); } catch { /* best-effort, matches doctor.ts */ }
    }
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    // Before #3161: this failed with "active native WAL connection" forever,
    // until someone manually deleted the sidecar files.
    const result = await storeEntry({
      key: 'after-doctor-leak',
      value: 'survives the leak',
      dbPath,
      generateEmbeddingFlag: false,
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    // Self-healed: the checkpoint that proved liveness ran as a side effect,
    // truncating the WAL — no manual sidecar deletion required.
    expect(walSize()).toBe(0);

    // And the lockout doesn't recur on the next call either.
    const again = await storeEntry({
      key: 'after-doctor-leak-2',
      value: 'still fine',
      dbPath,
      generateEmbeddingFlag: false,
    });
    expect(again.success).toBe(true);
  });

  it('a subsequent memory list also self-heals the leaked sidecars', async () => {
    const { storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'seed', value: 'v0', dbPath, generateEmbeddingFlag: false });

    const { loadBetterSqlite3 } = await import('../src/memory/shared-sqlite.js');
    const Database = await loadBetterSqlite3();
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      probe.pragma('quick_check');
    } finally {
      try { probe.close(); } catch { /* best-effort */ }
    }
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    const result = await listEntries({ dbPath });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(walSize()).toBe(0);
  });
});
