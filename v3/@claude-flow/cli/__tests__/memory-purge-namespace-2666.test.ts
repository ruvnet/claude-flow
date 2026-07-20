/**
 * Regression guard for issue #2666 — reconciling a deleted source (e.g. an
 * ADR file removed from disk) needs a *hard* delete, not the soft
 * tombstone `memory delete`/`deleteEntry` leaves behind.
 *
 * `deleteEntry` only ever does `UPDATE memory_entries SET status='deleted'`
 * — the row keeps occupying its `UNIQUE(namespace, key)` slot, so a
 * subsequent non-upsert `storeEntry` for the same (namespace, key) still
 * fails (#2652). `purgeNamespace` must do a real
 * `DELETE FROM memory_entries WHERE namespace = ?` so that slot is
 * genuinely free again — this is the concrete, observable difference this
 * suite asserts, not just "the row doesn't show up in a list anymore".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  initializeMemoryDatabase,
  storeEntry,
  listEntries,
  purgeNamespace,
  withMemoryDbLock,
} from '../src/memory/memory-initializer.js';

let tmp: string;
let dbPath: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-namespace-2666-'));
  dbPath = path.join(tmp, 'memory.db');
  const init = await initializeMemoryDatabase({ dbPath, force: true, migrate: false });
  expect(init.success).toBe(true);
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('purgeNamespace (#2666)', () => {
  it('hard-deletes every entry in the target namespace, leaving other namespaces untouched', async () => {
    await storeEntry({ key: 'ADR-001::adr-001-foo', value: 'foo', namespace: 'adr-patterns', dbPath, generateEmbeddingFlag: false });
    await storeEntry({ key: 'ADR-002::adr-002-bar', value: 'bar', namespace: 'adr-patterns', dbPath, generateEmbeddingFlag: false });
    await storeEntry({ key: 'keep-me', value: 'unrelated', namespace: 'other-namespace', dbPath, generateEmbeddingFlag: false });

    const before = await listEntries({ namespace: 'adr-patterns', dbPath });
    expect(before.total).toBe(2);

    const result = await purgeNamespace({ namespace: 'adr-patterns', dbPath });
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);

    const after = await listEntries({ namespace: 'adr-patterns', dbPath });
    expect(after.total).toBe(0);

    const other = await listEntries({ namespace: 'other-namespace', dbPath });
    expect(other.total).toBe(1);
  });

  it('is a genuine hard delete — a non-upsert re-store of a purged key does not hit the UNIQUE(namespace, key) constraint (#2652)', async () => {
    const key = 'ADR-002::adr-002-bar';
    const namespace = 'adr-patterns';

    await storeEntry({ key, value: 'original', namespace, dbPath, generateEmbeddingFlag: false, upsert: false });
    await purgeNamespace({ namespace, dbPath });

    // If the row were merely tombstoned (status='deleted'), this non-upsert
    // insert would fail the UNIQUE(namespace, key) constraint (#2652).
    const restore = await storeEntry({ key, value: 'rebuilt after reindex', namespace, dbPath, generateEmbeddingFlag: false, upsert: false });
    expect(restore.success).toBe(true);

    const after = await listEntries({ namespace, dbPath, includeContent: true });
    expect(after.total).toBe(1);
    expect(after.entries[0]?.content).toBe('rebuilt after reindex');
  });

  it('rejects an invalid namespace rather than silently no-op-ing', async () => {
    const result = await purgeNamespace({ namespace: 'not; a valid namespace', dbPath });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid namespace/i);
  });

  it('is a no-op (0 deleted) on an empty/absent namespace, not an error', async () => {
    const result = await purgeNamespace({ namespace: 'never-used', dbPath });
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(0);
  });
});

describe('withMemoryDbLock (#2666)', () => {
  it('creates and removes the lock file around the guarded operation', async () => {
    const lockFile = `${dbPath}.lock`;
    let sawLockDuringCall = false;

    await withMemoryDbLock(dbPath, () => {
      sawLockDuringCall = fs.existsSync(lockFile);
    });

    expect(sawLockDuringCall).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('releases the lock even when the guarded function throws', async () => {
    const lockFile = `${dbPath}.lock`;
    await expect(withMemoryDbLock(dbPath, () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('takes over a stale lock left by a crashed process instead of hanging', async () => {
    const lockFile = `${dbPath}.lock`;
    fs.writeFileSync(lockFile, '999999999'); // a pid that cannot be this test
    const staleTime = Date.now() / 1000 - 60; // 60s old — well past the stale threshold
    fs.utimesSync(lockFile, staleTime, staleTime);

    let ran = false;
    await withMemoryDbLock(dbPath, () => { ran = true; });

    expect(ran).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('serializes two concurrent purges on the same db so they do not interleave', async () => {
    await storeEntry({ key: 'a', value: '1', namespace: 'race-ns', dbPath, generateEmbeddingFlag: false });

    const order: string[] = [];
    const slow = withMemoryDbLock(dbPath, async () => {
      order.push('slow-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('slow-end');
    });
    const fast = withMemoryDbLock(dbPath, async () => {
      order.push('fast-start');
      order.push('fast-end');
    });

    await Promise.all([slow, fast]);

    // Whichever ran first, its start+end must be contiguous — the second
    // caller cannot start until the first fully released the lock.
    const firstIsSlow = order[0] === 'slow-start';
    if (firstIsSlow) {
      expect(order).toEqual(['slow-start', 'slow-end', 'fast-start', 'fast-end']);
    } else {
      expect(order).toEqual(['fast-start', 'fast-end', 'slow-start', 'slow-end']);
    }
  });
});
