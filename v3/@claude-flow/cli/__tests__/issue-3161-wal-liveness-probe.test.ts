/**
 * Issue #3161 — liveness-probe behavior of `hasNativeWalSidecars`
 * (`src/memory/memory-initializer.ts`). The #2735 guard used to treat
 * `-wal`/`-shm` sidecar *presence* as proof of a live native writer; #3161
 * found that's false (a doctor-style readonly open+close leaks them too,
 * see `issue-3161-doctor-leak-recovery.test.ts`) and replaced it with a
 * direct `PRAGMA wal_checkpoint(TRUNCATE)` liveness probe: refuse only when
 * the checkpoint reports `busy`.
 *
 * This file covers what that change must still get right beyond the
 * doctor-leak repro itself:
 *  - the safety property #2735 existed for — a GENUINE live writer (mid
 *    transaction, pending WAL frames) must still block the sql.js write;
 *  - fail-closed behavior on a probe error (corrupted sidecar, not merely
 *    absent);
 *  - a nonexistent dbPath still can't crash the guard's callers;
 *  - the no-sidecars fast path never opens a database connection at all.
 *
 * The bridge is force-disabled via CLAUDE_FLOW_DISABLE_BRIDGE=1, same
 * convention as the #2735/#3397/#3161 suites, so every case exercises the
 * sql.js fallback path the guard protects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_ENV = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-3161-liveness-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
});

afterEach(() => {
  vi.doUnmock('better-sqlite3');
  vi.resetModules();
  if (ORIGINAL_ENV === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_ENV;
  rmSync(dir, { recursive: true, force: true });
});

describe('#3161 — genuine live writer is still refused (the #2735 property)', () => {
  it('refuses the sql.js write while a foreign connection holds an uncommitted transaction', async () => {
    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);

    const Database = createRequire(import.meta.url)('better-sqlite3');
    const foreign = new Database(dbPath);
    try {
      foreign.pragma('journal_mode = WAL');
      // A genuine, still-open write transaction — pending WAL frames that
      // wal_checkpoint(TRUNCATE) cannot flush while it's held.
      foreign.exec('BEGIN IMMEDIATE');
      foreign.prepare(
        "INSERT INTO memory_entries (id, key, namespace, content) VALUES ('live-1', 'live-1', 'default', 'x')",
      ).run();
      expect(existsSync(`${dbPath}-wal`)).toBe(true);

      const result = await storeEntry({ key: 'blocked', value: 'v', dbPath, generateEmbeddingFlag: false });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/native WAL connection/i);
    } finally {
      try { foreign.exec('ROLLBACK'); } catch { /* best-effort cleanup */ }
      foreign.close();
    }
  });

  it('allows the write again once the foreign writer commits and closes', async () => {
    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);

    const Database = createRequire(import.meta.url)('better-sqlite3');
    const foreign = new Database(dbPath);
    foreign.pragma('journal_mode = WAL');
    foreign.exec('BEGIN IMMEDIATE');
    foreign.prepare(
      "INSERT INTO memory_entries (id, key, namespace, content) VALUES ('live-2', 'live-2', 'default', 'x')",
    ).run();

    const blocked = await storeEntry({ key: 'still-blocked', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(blocked.success).toBe(false);

    foreign.exec('COMMIT');
    foreign.close();

    const result = await storeEntry({ key: 'now-allowed', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(true);
  });

  it('two concurrent sql.js callers racing the guard both correctly refuse while the real holder is attached', async () => {
    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);

    const Database = createRequire(import.meta.url)('better-sqlite3');
    const foreign = new Database(dbPath);
    foreign.pragma('journal_mode = WAL');
    foreign.exec('BEGIN IMMEDIATE');
    foreign.prepare(
      "INSERT INTO memory_entries (id, key, namespace, content) VALUES ('live-3', 'live-3', 'default', 'x')",
    ).run();

    try {
      // Two callers race the guard concurrently while the real holder is
      // still attached — the real holder's uncommitted write must keep
      // winning and both checkers must independently refuse, not just
      // whichever ran first.
      const [a, b] = await Promise.all([
        storeEntry({ key: 'racer-a', value: 'v', dbPath, generateEmbeddingFlag: false }),
        storeEntry({ key: 'racer-b', value: 'v', dbPath, generateEmbeddingFlag: false }),
      ]);
      expect(a.success).toBe(false);
      expect(b.success).toBe(false);
    } finally {
      try { foreign.exec('ROLLBACK'); } catch { /* best-effort cleanup */ }
      foreign.close();
    }

    // Once the real holder is gone, a racer-style retry succeeds normally.
    const after = await storeEntry({ key: 'racer-after', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(after.success).toBe(true);
  });
});

describe('#3161 — fail-closed on probe error (corrupted sidecar, not merely absent)', () => {
  it('garbage (but structurally valid-length) bytes in -wal are safely ignored by SQLite\'s own WAL validation, not a probe error', async () => {
    // Documents actual behavior so it isn't mistaken for a regression: SQLite
    // validates the WAL header/frame checksums itself. Bytes that fail that
    // validation are treated as "no real pending WAL data", not as an error —
    // wal_checkpoint succeeds (busy: 0) and the write proceeds. This is
    // correct: a WAL file whose own integrity check fails has nothing
    // recoverable to lose.
    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);
    writeFileSync(`${dbPath}-wal`, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]));

    const result = await storeEntry({ key: 'corrupt-wal', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(true);
  });

  it('refuses the write when a sidecar path cannot be opened at all (probe genuinely errors)', async () => {
    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);

    // A directory where SQLite needs to open/create a file — the probe
    // (opening the main db, which touches its -wal companion) must fail
    // closed rather than crash or silently proceed.
    mkdirSync(`${dbPath}-wal`);

    const result = await storeEntry({ key: 'unopenable-wal', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native WAL connection/i);
  });
});

describe('#3161 — a nonexistent dbPath cannot crash the guard\'s callers', () => {
  it('storeEntry reports a clean error instead of throwing when dbPath does not exist', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const missing = path.join(dir, 'never-initialized.db');
    await expect(storeEntry({ key: 'k', value: 'v', dbPath: missing, generateEmbeddingFlag: false }))
      .resolves.toMatchObject({ success: false });
  });

  it('getEntry reports a clean error instead of throwing when dbPath does not exist', async () => {
    const { getEntry } = await import('../src/memory/memory-initializer.js');
    const missing = path.join(dir, 'never-initialized.db');
    await expect(getEntry({ key: 'k', dbPath: missing })).resolves.toMatchObject({ success: false, found: false });
  });
});

describe('#3161 — no-sidecars fast path never opens a database connection', () => {
  it('storeEntry succeeds with no sidecars even if constructing a native connection would throw', async () => {
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw new Error('fast path must not reach here — no sidecars means no probe connection');
        }
      },
    }));
    vi.resetModules();

    const { initializeMemoryDatabase, storeEntry } = await import('../src/memory/memory-initializer.js');
    expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);

    const result = await storeEntry({ key: 'fast-path', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
