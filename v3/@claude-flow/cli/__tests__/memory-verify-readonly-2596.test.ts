/**
 * Regression guard for issue #2596 — verifyMemoryInit() must be read-only.
 *
 * Root cause (pre-fix): verifyMemoryInit() ran read/write self-tests on the
 * sql.js in-memory copy, then unconditionally serialized and wrote the buffer
 * back via writeFileRestricted() → atomic rename(tmp, dbPath). initializeMemoryDatabase()
 * activates ControllerRegistry and repairVectorIndexes() (better-sqlite3 in WAL
 * mode), both of which keep native handles open on the same path. On POSIX,
 * rename over an open fd succeeds; on Windows, MoveFileEx onto a path with any
 * open handle in the same process returns EPERM — a Windows-only false negative.
 * The self-test also DELETEs its own inserts before the writeback, so the write
 * was pointless.
 *
 * This guard: initialize a DB via the same initializer, snapshot the on-disk
 * bytes + mtime, call verifyMemoryInit, and assert the file was not touched.
 * Fails on the buggy code (writeback re-serializes → different bytes/mtime);
 * passes on the fix (sql.js in-memory copy discarded on close(), on-disk image
 * untouched).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initializeMemoryDatabase, verifyMemoryInit } from '../src/memory/memory-initializer.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-readonly-2596-'));
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('verifyMemoryInit is read-only (#2596)', () => {
  it('does not modify the on-disk DB file (no writeback race with better-sqlite3 handle)', async () => {
    const dbPath = path.join(tmp, 'memory.db');

    // Bootstrap a real DB the same way production does — this also activates the
    // ControllerRegistry / repairVectorIndexes handles that the writeback used to race.
    const init = await initializeMemoryDatabase({ dbPath, force: true, migrate: false });
    expect(init.success).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    // Snapshot on-disk state BEFORE verify.
    const before = fs.readFileSync(dbPath);
    const beforeMtime = fs.statSync(dbPath).mtimeMs;

    // Give mtime resolution a chance to advance so any writeback would be visible.
    await new Promise(r => setTimeout(r, 20));

    const result = await verifyMemoryInit(dbPath);
    expect(result).toBeDefined();

    // Assertion: the DB image on disk is byte-identical after verification.
    // On the pre-fix code, sql.js re-serialization + writeFileRestricted(encrypt)
    // rewrote the file with a different byte image AND a bumped mtime — both
    // detectable here regardless of platform (the Windows-only failure was the
    // EPERM crash of the writeback itself; the writeback is the disease).
    const after = fs.readFileSync(dbPath);
    const afterMtime = fs.statSync(dbPath).mtimeMs;

    expect(after.length).toBe(before.length);
    expect(after.equals(before)).toBe(true);
    expect(afterMtime).toBe(beforeMtime);
  }, 60_000);
});
