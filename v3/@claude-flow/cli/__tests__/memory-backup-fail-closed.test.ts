/**
 * #4287 — a native online-backup failure must fail CLOSED, not silently
 * fall back to a raw file copy and report success.
 *
 * The raw-copy fallback exists ONLY for the encrypted-at-rest (#2798 RFE1)
 * case, where better-sqlite3's online-backup API fundamentally cannot apply
 * because the source isn't a native SQLite image at all. It must never fire
 * for an ordinary (plaintext) source just because the native backup threw
 * (SQLITE_BUSY, a disk error, or anything else) — and even for a genuinely
 * encrypted source, it must refuse when an active WAL sidecar is present,
 * since a plain byte copy of the main file alone would silently drop
 * uncommitted WAL frames.
 *
 * These tests use fault injection (a fake native `Database`-like object
 * passed via the `Database` test seam) plus real temp files/fs — no real
 * SQLite database is opened.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { backupMemoryDb } from '../src/services/memory-backup.js';

// "RFE1" — same magic bytes as src/encryption/vault.ts MAGIC.
const RFE1_MAGIC = Buffer.from([0x52, 0x46, 0x45, 0x31]);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'memory-backup-fail-closed-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A fake native Database whose online-backup throws like a real SQLITE_BUSY failure. */
function fakeDatabaseThatThrows(message = 'database is locked'): any {
  return class FakeDatabase {
    constructor(_path: string, _opts?: unknown) { /* no-op: never opens a real file */ }
    async backup(_destPath: string): Promise<void> {
      throw Object.assign(new Error(message), { code: 'SQLITE_BUSY' });
    }
    close(): void { /* no-op */ }
  };
}

describe('backupMemoryDb — fail closed on native backup failure (#4287)', () => {
  it('repro: SQLITE_BUSY on an ORDINARY (non-encrypted) source must NOT report backedUp via raw copy', async () => {
    const dbPath = join(dir, 'memory.db');
    // Ordinary plaintext SQLite-shaped bytes — NOT the RFE1 magic header.
    writeFileSync(dbPath, Buffer.from('SQLite format 3\0' + 'x'.repeat(100)));
    const srcBytesBefore = readFileSync(dbPath);

    const r = await backupMemoryDb({
      dbPath,
      timestamp: 1_700_000_000_000,
      Database: fakeDatabaseThatThrows('database is locked'),
    } as any);

    expect(r.backedUp).toBe(false);
    expect(r.method).toBeUndefined();
    expect(r.skipped).toMatch(/native backup failed/);
    // No raw-copy snapshot was produced (the backups dir may exist — it's
    // created up front — but must be empty of any snapshot file), and the
    // live source is untouched.
    const snapDir = join(dir, 'backups');
    if (existsSync(snapDir)) {
      const { readdirSync } = await import('node:fs');
      expect(readdirSync(snapDir).filter((f: string) => f.endsWith('.db'))).toHaveLength(0);
    }
    expect(readFileSync(dbPath)).toEqual(srcBytesBefore);
  });

  it('confirmed-encrypted RFE1 source, native backup unavailable/failing, NO active WAL: raw-copy fallback succeeds', async () => {
    const dbPath = join(dir, 'memory.db');
    const encryptedBytes = Buffer.concat([RFE1_MAGIC, Buffer.from('ciphertext-not-real-sqlite')]);
    writeFileSync(dbPath, encryptedBytes);
    // No -wal sidecar present.

    const r = await backupMemoryDb({
      dbPath,
      timestamp: 1_700_000_000_000,
      Database: fakeDatabaseThatThrows('file is not a database'),
    } as any);

    expect(r.backedUp).toBe(true);
    expect(r.method).toBe('raw-copy-fallback');
    expect(r.path).toBeDefined();
    expect(existsSync(r.path!)).toBe(true);
    expect(readFileSync(r.path!)).toEqual(encryptedBytes);
    // Source untouched.
    expect(readFileSync(dbPath)).toEqual(encryptedBytes);
  });

  it('confirmed-encrypted RFE1 source but WITH an active WAL: refuses the raw-copy fallback', async () => {
    const dbPath = join(dir, 'memory.db');
    const encryptedBytes = Buffer.concat([RFE1_MAGIC, Buffer.from('ciphertext-not-real-sqlite')]);
    writeFileSync(dbPath, encryptedBytes);
    // Active (non-empty) WAL sidecar — a plain copy of dbPath alone would be inconsistent.
    writeFileSync(`${dbPath}-wal`, Buffer.from('uncommitted-wal-frames'));

    const r = await backupMemoryDb({
      dbPath,
      timestamp: 1_700_000_000_000,
      Database: fakeDatabaseThatThrows('file is not a database'),
    } as any);

    expect(r.backedUp).toBe(false);
    expect(r.method).toBeUndefined();
    const snapDir = join(dir, 'backups');
    if (existsSync(snapDir)) {
      const { readdirSync } = await import('node:fs');
      expect(readdirSync(snapDir).filter((f: string) => f.endsWith('.db'))).toHaveLength(0);
    }
    // Source and WAL sidecar untouched.
    expect(readFileSync(dbPath)).toEqual(encryptedBytes);
    expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(0);
  });

  it('a successful native online-backup is marked method: native-online-backup', async () => {
    const dbPath = join(dir, 'memory.db');
    let backupCalled = false;
    const FakeDatabase = class {
      constructor(_path: string, _opts?: unknown) { /* no-op */ }
      async backup(destPath: string): Promise<void> {
        backupCalled = true;
        writeFileSync(destPath, Buffer.from('fake-consistent-snapshot'));
      }
      close(): void { /* no-op */ }
    };
    writeFileSync(dbPath, Buffer.from('SQLite format 3\0' + 'x'.repeat(100)));

    const r = await backupMemoryDb({
      dbPath,
      timestamp: 1_700_000_000_000,
      Database: FakeDatabase as any,
    } as any);

    expect(backupCalled).toBe(true);
    expect(r.backedUp).toBe(true);
    expect(r.method).toBe('native-online-backup');
  });
});
