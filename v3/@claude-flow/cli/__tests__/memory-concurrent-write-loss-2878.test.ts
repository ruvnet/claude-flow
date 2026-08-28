/**
 * Regression guard for issue #2878 — concurrent sql.js whole-image writes
 * were acknowledged and then silently lost.
 *
 * sql.js has no incremental persistence: every mutator loads the entire db
 * image into memory, mutates it, and writes the whole image back. Two
 * writers whose load→mutate→persist windows overlap therefore both start
 * from the same predecessor image, and the last one to flush silently
 * discards the other's row — while both return `success: true`.
 * `PRAGMA integrity_check` still passes, because the file isn't corrupt;
 * the data is simply gone.
 *
 * #2666 introduced `withMemoryDbLock` but only `purgeNamespace` opted in.
 * These tests assert the whole-image read-modify-write paths now serialize
 * through it, so a success acknowledgement means the mutation is durable.
 *
 * Reproducing it needs an `await` between the image read and the image
 * write. `storeEntry` has one — embedding generation sits between them — so
 * N concurrent stores with embeddings enabled all read the same predecessor
 * image before any of them flushes. That is the exact lost-update shape the
 * issue reported with 12 processes, and it exercises the same `O_EXCL` lock
 * file (which is process-agnostic, so in-process contention is real
 * contention).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  initializeMemoryDatabase,
  storeEntry,
  listEntries,
  getEntry,
  deleteEntry,
  withMemoryDbLock,
} from '../src/memory/memory-initializer.js';

let tmp: string;
let dbPath: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-write-2878-'));
  dbPath = path.join(tmp, 'memory.db');
  const init = await initializeMemoryDatabase({ dbPath, force: true, migrate: false });
  expect(init.success).toBe(true);
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('concurrent memory.db writes (#2878)', () => {
  it('persists every acknowledged storeEntry when 12 writers overlap', async () => {
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        storeEntry({
          key: `concurrent-${i}`,
          value: `value for concurrent writer number ${i}`,
          namespace: 'concurrency',
          dbPath,
          // Embedding generation is the await that opens the read→write
          // window every concurrent writer used to race through.
          generateEmbeddingFlag: true,
        })
      )
    );

    expect(results.filter((r) => r.success).length).toBe(N);

    const listed = await listEntries({ namespace: 'concurrency', dbPath, limit: 100 });
    const keys = new Set(listed.entries.map((e) => e.key));
    const missing = Array.from({ length: N }, (_, i) => `concurrent-${i}`).filter((k) => !keys.has(k));

    // Every acknowledged write must be on disk — no silent loss.
    expect(missing).toEqual([]);
    expect(listed.total).toBe(N);
  }, 60_000);

  it('does not lose a concurrent store while other writers hold the image', async () => {
    const [storeResults, lateResult] = await Promise.all([
      Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          storeEntry({
            key: `batch-${i}`,
            value: `batch value ${i}`,
            namespace: 'concurrency',
            dbPath,
            generateEmbeddingFlag: true,
          })
        )
      ),
      storeEntry({
        key: 'written-during-batch',
        value: 'must survive',
        namespace: 'concurrency',
        dbPath,
        generateEmbeddingFlag: true,
      }),
    ]);

    expect(storeResults.every((r) => r.success)).toBe(true);
    expect(lateResult.success).toBe(true);

    const listed = await listEntries({ namespace: 'concurrency', dbPath, limit: 100 });
    const keys = new Set(listed.entries.map((e) => e.key));
    expect(keys.has('written-during-batch')).toBe(true);
    expect(listed.total).toBe(7);
  }, 60_000);

  it('serializes getEntry access_count bumps instead of losing them', async () => {
    await storeEntry({
      key: 'read-me',
      value: 'seed',
      namespace: 'concurrency',
      dbPath,
      generateEmbeddingFlag: false,
    });

    // getEntry rewrites the whole image to bump access_count, so N concurrent
    // reads are N concurrent writers. Every bump must land.
    const N = 8;
    const reads = await Promise.all(
      Array.from({ length: N }, () => getEntry({ key: 'read-me', namespace: 'concurrency', dbPath }))
    );
    expect(reads.every((r) => r.success && r.found)).toBe(true);

    const final = await getEntry({ key: 'read-me', namespace: 'concurrency', dbPath });
    // N concurrent bumps + this one; a lost update would leave it lower.
    expect(final.entry?.accessCount).toBe(N + 1);
  }, 60_000);

  it('does not resurrect concurrently deleted entries', async () => {
    const N = 6;
    for (let i = 0; i < N; i++) {
      const r = await storeEntry({
        key: `del-${i}`,
        value: `v${i}`,
        namespace: 'concurrency',
        dbPath,
        generateEmbeddingFlag: false,
      });
      expect(r.success).toBe(true);
    }

    const deletes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        deleteEntry({ key: `del-${i}`, namespace: 'concurrency', dbPath })
      )
    );
    expect(deletes.filter((d) => d.success && d.deleted).length).toBe(N);

    const listed = await listEntries({ namespace: 'concurrency', dbPath, limit: 100 });
    // A lost delete resurrects a tombstoned row from a stale predecessor image.
    expect(listed.entries.map((e) => e.key)).toEqual([]);
  }, 60_000);

  it('withMemoryDbLock is reentrant, so nested critical sections do not self-deadlock', async () => {
    // storeEntry/deleteEntry/purgeNamespace all call ensureSchemaColumns from
    // inside their own critical section. A non-reentrant O_EXCL lock would
    // block there until the acquire timeout.
    const inner = await withMemoryDbLock(dbPath, async () =>
      withMemoryDbLock(dbPath, async () => 'reached')
    );
    expect(inner).toBe('reached');
    // Lock file released on the way out.
    expect(fs.existsSync(`${dbPath}.lock`)).toBe(false);
  }, 20_000);

  it('normalizes the lock path so relative and absolute callers contend on one lock', async () => {
    const relative = path.relative(process.cwd(), dbPath);
    let innerRan = false;
    await withMemoryDbLock(dbPath, async () => {
      // Same file, different spelling — must be seen as already held, not as
      // a second independent lock.
      await withMemoryDbLock(relative, async () => { innerRan = true; });
    });
    expect(innerRan).toBe(true);
  }, 20_000);
});
