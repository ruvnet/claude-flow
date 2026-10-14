/**
 * #4040: the RFE1 header sniff in graph-edge-writer must not raw-open and close
 * the database file while this process owns a live native SQLite handle.
 * POSIX close() drops ALL of the process's advisory locks on that inode
 * (https://www.sqlite.org/howtocorrupt.html), so a second process then believes
 * it is the only connection, and on close deletes the WAL the first process is
 * still using.
 *
 * Real better-sqlite3 and the kernel lock table (/proc/locks, Linux), no mocks.
 * The end-to-end WAL deletion from the report was NOT reproduced on Linux/Node 22
 * (the shm locks also guard it); the dropped db-file lock is the mechanism and
 * is what this pins.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isBridgeDbEncryptedAtRest } from '../src/memory/graph-edge-writer.js';

const req = createRequire(import.meta.url);
let Database: any;
let native = true;
let betterSqlitePath = '';

beforeAll(() => {
  try {
    betterSqlitePath = req.resolve('better-sqlite3');
    Database = req('better-sqlite3');
    new Database(':memory:').close();
  } catch {
    native = false;
  }
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ruflo-4040-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Byte-range locks this process holds on `file`, from the kernel lock table (Linux). */
function heldLocks(file: string): string[] {
  const ino = statSync(file).ino;
  return readFileSync('/proc/locks', 'utf8').split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(f => f[4] === String(process.pid) && f[5]?.endsWith(`:${ino}`))
    .map(f => `${f[3]} ${f[6]} ${f[7]}`);
}

/** A second process opens the same database, inserts a row and closes. */
function insertFromAnotherProcess(dbPath: string, value: string): void {
  const script = `
    const Database = require(${JSON.stringify(betterSqlitePath)});
    const db = new Database(${JSON.stringify(dbPath)});
    db.prepare('INSERT INTO t(v) VALUES (?)').run(${JSON.stringify(value)});
    db.close();
  `;
  execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', env: {} });
}

describe('graph-edge-writer header sniff vs live SQLite handles (#4040)', () => {
  it.skipIf(!native || process.platform !== 'linux')(
    'leaves the advisory locks of a live SQLite handle on the database inode untouched',
    () => {
      const dbPath = join(root, 'memory.db');
      const db = new Database(dbPath);
      try {
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        db.prepare('INSERT INTO t(v) VALUES (?)').run('parent-1');

        const before = heldLocks(dbPath);
        // Not vacuous: a WAL-mode handle holds a shared lock on the database file itself.
        expect(before.length).toBeGreaterThan(0);

        expect(isBridgeDbEncryptedAtRest(dbPath)).toBe(false);

        // A raw open+close in this process would have dropped every one of them.
        expect(heldLocks(dbPath)).toEqual(before);

        // And the handle keeps working next to a second process.
        insertFromAnotherProcess(dbPath, 'child-1');
        expect(existsSync(`${dbPath}-wal`)).toBe(true);
        expect(db.prepare('SELECT v FROM t ORDER BY id').all().map((r: { v: string }) => r.v)).toEqual(['parent-1', 'child-1']);
      } finally {
        db.close();
      }
    },
  );

  it('still recognises an RFE1-encrypted file and a plain file', () => {
    const enc = join(root, 'enc.db');
    // magic "RFE1" + iv(12) + ciphertext + tag(16): 64 bytes is past the minimum blob length.
    writeFileSync(enc, Buffer.concat([Buffer.from('RFE1'), randomBytes(60)]));
    const plain = join(root, 'plain.db');
    writeFileSync(plain, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(80)]));
    expect(isBridgeDbEncryptedAtRest(enc)).toBe(true);
    expect(isBridgeDbEncryptedAtRest(plain)).toBe(false);
  });

  it('treats a missing, empty or unreadable path as not encrypted', () => {
    expect(isBridgeDbEncryptedAtRest(join(root, 'absent.db'))).toBe(false);
    const empty = join(root, 'empty.db');
    writeFileSync(empty, '');
    expect(isBridgeDbEncryptedAtRest(empty)).toBe(false);
  });
});
