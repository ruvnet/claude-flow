/**
 * Regression coverage for issue #2735: memory CRUD's sql.js fallback did a
 * whole-image read-modify-persist (export() + rename over the live
 * database path) with no regard for whether a native better-sqlite3 WAL
 * connection was already attached — corrupting the shared database or
 * silently losing an acknowledged write when the fallback fired while a
 * native writer (daemon, MCP server, another CLI invocation) held the file
 * open.
 *
 * #3161 found the original presence-only version of this guard ("-wal"/
 * "-shm" exists → refuse) was over-eager: `ruflo doctor`'s readonly
 * diagnostic connections leave orphaned sidecars behind after a plain
 * `.close()`, with no live holder at all, permanently blocking every later
 * write. The guard now probes LIVENESS (`PRAGMA wal_checkpoint(TRUNCATE)`,
 * then a post-close re-existence check — see `hasNativeWalSidecars`'s own
 * doc comment in memory-initializer.ts for why both steps are needed)
 * instead of treating mere sidecar presence as proof of a live connection.
 *
 * This file's cases below were rewritten accordingly: the "sidecar present"
 * cases now use a REAL WAL-mode database with a genuinely orphaned WAL (no
 * live holder) — the exact #3161 scenario — and assert the write now
 * PROCEEDS (the bug fix). A new case asserts the original #2735 guarantee
 * is intact: a WAL connection with a genuinely open, uncommitted transaction
 * still blocks the write. (Previously this file used empty hand-touched
 * `-wal`/`-shm` files as a presence proxy; that no longer exercises a
 * meaningful scenario once the guard is liveness-based, since such a file
 * isn't attached to any real WAL-mode database and the probe correctly
 * treats it as inert.)
 *
 * The bridge is force-disabled via CLAUDE_FLOW_DISABLE_BRIDGE=1 (the
 * package's own documented switch, dist/src/memory/memory-initializer.js)
 * so every case below exercises the sql.js fallback path directly,
 * deterministically.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_ENV = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

const sidecarsExist = () => existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);

function openNative(opts?: Record<string, unknown>) {
  const Database = createRequire(import.meta.url)('better-sqlite3');
  return new Database(dbPath, opts);
}

/**
 * Puts the database into real WAL mode with a committed write, then leaves
 * a genuinely orphaned WAL behind via a readonly open + plain `.close()` —
 * the same pattern `doctor.ts`'s diagnostic checks use. No connection is
 * left attached afterward; this is the exact #3161 scenario.
 */
function makeGenuineOrphan(): void {
  const writer = openNative();
  writer.pragma('journal_mode = WAL');
  writer.exec('CREATE TABLE IF NOT EXISTS _wal_probe_marker(x)');
  writer.close();
  expect(sidecarsExist()).toBe(false); // clean close, nothing else attached — sidecars gone

  const reader = openNative({ readonly: true, fileMustExist: true });
  reader.prepare('SELECT 1').get();
  reader.close();
  expect(sidecarsExist()).toBe(true); // orphaned by the readonly close, no live holder
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-2735-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  // Reset the module registry so each test gets a fresh dynamic import —
  // the module under test is pure-functional (no top-level state this
  // suite depends on), but sql.js's own WASM init is safest re-run clean.
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');
  const initResult = await initializeMemoryDatabase({ dbPath, verbose: false });
  expect(initResult.success).toBe(true);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_ENV;
  rmSync(dir, { recursive: true, force: true });
});

describe('memory sql.js fallback WAL-sidecar guard — issue #2735 / #3161', () => {
  it('storeEntry proceeds when a genuinely orphaned -wal/-shm pair is present (#3161)', async () => {
    makeGenuineOrphan();
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k1', value: 'v1', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(true);
    expect(result.id).not.toBe('');
    // The liveness probe's own checkpoint clears the orphan as a side effect.
    expect(sidecarsExist()).toBe(false);
  });

  it('storeEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k1', value: 'v1', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(true);
    expect(result.id).not.toBe('');
  });

  it('getEntry proceeds through the access_count-bump write past a genuine orphan (#3161)', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const stored = await storeEntry({ key: 'k2', value: 'v2', dbPath, generateEmbeddingFlag: false });
    expect(stored.success).toBe(true);

    makeGenuineOrphan();
    const { getEntry } = await import('../src/memory/memory-initializer.js');
    const result = await getEntry({ key: 'k2', dbPath });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
    expect(sidecarsExist()).toBe(false);
  });

  it('getEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry, getEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k3', value: 'v3', dbPath, generateEmbeddingFlag: false });
    const result = await getEntry({ key: 'k3', dbPath });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });

  it('deleteEntry proceeds past a genuinely orphaned sidecar pair (#3161)', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k4', value: 'v4', dbPath, generateEmbeddingFlag: false });

    makeGenuineOrphan();
    const { deleteEntry } = await import('../src/memory/memory-initializer.js');
    const result = await deleteEntry({ key: 'k4', dbPath });
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(sidecarsExist()).toBe(false);
  });

  it('deleteEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry, deleteEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k5', value: 'v5', dbPath, generateEmbeddingFlag: false });
    const result = await deleteEntry({ key: 'k5', dbPath });
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
  });

  it('storeEntry still refuses while a native connection genuinely holds an open transaction', async () => {
    const live = openNative();
    live.pragma('journal_mode = WAL');
    live.exec('BEGIN');
    live.exec('CREATE TABLE _wal_probe_marker(x)');
    live.exec('INSERT INTO _wal_probe_marker VALUES (1)');
    expect(sidecarsExist()).toBe(true);

    try {
      const { storeEntry } = await import('../src/memory/memory-initializer.js');
      const result = await storeEntry({ key: 'k7', value: 'v7', dbPath, generateEmbeddingFlag: false });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/native WAL connection/i);
    } finally {
      live.exec('COMMIT');
      live.close();
    }
  });

  it('a refused store never touches the database file (no whole-image write occurred)', async () => {
    const live = openNative();
    live.pragma('journal_mode = WAL');
    // Keep the table creation itself inside the uncommitted transaction —
    // if it were a separate, already-committed statement, the liveness
    // probe's own checkpoint would legitimately flush that committed frame
    // into the main file (a safe, incremental WAL checkpoint, not a
    // whole-image write) while still correctly reporting busy for the
    // uncommitted insert, which would change dbPath's mtime and produce a
    // false failure here even though nothing unsafe happened.
    live.exec('BEGIN');
    live.exec('CREATE TABLE _wal_probe_marker(x)');
    live.exec('INSERT INTO _wal_probe_marker VALUES (1)');

    try {
      const before = existsSync(dbPath) ? statSync(dbPath).mtimeMs : 0;
      const { storeEntry } = await import('../src/memory/memory-initializer.js');
      const result = await storeEntry({ key: 'k6', value: 'v6', dbPath });
      expect(result.success).toBe(false);
      const after = statSync(dbPath).mtimeMs;
      expect(after).toBe(before);
    } finally {
      live.exec('COMMIT');
      live.close();
    }
  });
});
