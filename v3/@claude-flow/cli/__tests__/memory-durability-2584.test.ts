/**
 * Data-durability regression tests for issue #2584 — AgentDB (sql.js) corruption
 * under torn/concurrent full-image flushes.
 *
 * Covers:
 *   1. writeFileAtomic() — the temp→fsync→rename primitive that makes every
 *      full-image DB flush crash-safe (no torn image, no leftover temp).
 *   2. restoreMemoryDbFromBackup() + recoverMemoryDatabase() — the missing
 *      recovery half: when the live image is torn badly enough that an in-place
 *      rebuild salvages nothing (the exact ruvultra failure mode), recovery must
 *      fall back to the newest integrity-ok backup instead of erroring forever.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFileAtomic } from '../src/fs-secure.js';
import { backupMemoryDb, restoreMemoryDbFromBackup } from '../src/services/memory-backup.js';
import { recoverMemoryDatabase } from '../src/memory/memory-initializer.js';

async function loadSqlite(): Promise<any | null> {
  try { const mod = 'better-sqlite3'; return (await import(mod)).default; } catch { return null; }
}

function makeMemoryDb(Database: any, file: string, rows: number): void {
  const db = new Database(file);
  db.exec('CREATE TABLE memory_entries (id TEXT PRIMARY KEY, namespace TEXT, value TEXT, embedding BLOB)');
  const ins = db.prepare('INSERT INTO memory_entries (id, namespace, value) VALUES (?,?,?)');
  const tx = db.transaction((n: number) => { for (let i = 0; i < n; i++) ins.run('k' + i, 'default', 'v' + i); });
  tx(rows);
  db.close();
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-2584-')); });
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

describe('writeFileAtomic (#2584)', () => {
  it('writes content and leaves no temp file behind', () => {
    const p = path.join(tmp, 'a.bin');
    writeFileAtomic(p, Buffer.from('hello'));
    expect(fs.readFileSync(p, 'utf8')).toBe('hello');
    expect(fs.readdirSync(tmp).filter(f => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('overwrites atomically — the new image fully replaces the old', () => {
    const p = path.join(tmp, 'a.bin');
    writeFileAtomic(p, Buffer.alloc(4096, 1));
    writeFileAtomic(p, Buffer.from('x'));
    expect(fs.statSync(p).size).toBe(1);
    expect(fs.readFileSync(p, 'utf8')).toBe('x');
  });

  it('cleans up the temp file if the write throws (bad target dir)', () => {
    // Writing into a non-existent directory throws; no temp should survive.
    const bad = path.join(tmp, 'does-not-exist', 'a.bin');
    expect(() => writeFileAtomic(bad, Buffer.from('x'))).toThrow();
    expect(fs.readdirSync(tmp)).not.toContain('does-not-exist');
  });
});

describe('backup auto-restore fallback (#2584)', () => {
  it('recoverMemoryDatabase restores the newest good backup when the live image is torn', async () => {
    const Database = await loadSqlite();
    if (!Database) return; // native recovery dep absent — nothing to exercise

    const dbPath = path.join(tmp, '.swarm', 'memory.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    makeMemoryDb(Database, dbPath, 25);

    // A real, consistent backup via the shipped backup service.
    const bk = await backupMemoryDb({ dbPath, timestamp: 1000 });
    expect(bk.backedUp).toBe(true);

    // Tear the live image: overwrite the header + first pages with 0xFF so
    // integrity_check fails and an in-place rebuild salvages nothing — i.e. the
    // ruvultra case where `sqlite3 .recover` produced 0 rows.
    const size = fs.statSync(dbPath).size;
    const n = Math.min(size, 16384);
    const fd = fs.openSync(dbPath, 'r+');
    fs.writeSync(fd, Buffer.alloc(n, 0xff), 0, n, 0);
    fs.closeSync(fd);

    const rec = await recoverMemoryDatabase(dbPath, { verbose: false });
    expect(rec.recovered).toBe(true);
    expect(rec.restoredFromBackup).toBe(true);

    // The restored DB is healthy and has the data back.
    const db = new Database(dbPath, { readonly: true });
    const integ = String(db.pragma('integrity_check', { simple: true }));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM memory_entries').get() as { c: number }).c;
    db.close();
    expect(integ.toLowerCase()).toBe('ok');
    expect(count).toBe(25);

    // The corrupt original was parked, not silently discarded.
    const parked = fs.readdirSync(path.dirname(dbPath)).some(f => f.startsWith('memory.db.corrupt-'));
    expect(parked).toBe(true);
  });

  it('restoreMemoryDbFromBackup reports no-backups when the dir is empty', async () => {
    const Database = await loadSqlite();
    if (!Database) return;
    const dbPath = path.join(tmp, '.swarm', 'memory.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    makeMemoryDb(Database, dbPath, 3);
    const r = await restoreMemoryDbFromBackup(dbPath);
    expect(r.restored).toBe(false);
    expect(r.skipped).toMatch(/no-backups/);
  });

  it('restoreMemoryDbFromBackup skips a corrupt backup and picks an older good one', async () => {
    const Database = await loadSqlite();
    if (!Database) return;
    const dbPath = path.join(tmp, '.swarm', 'memory.db');
    const backups = path.join(tmp, '.swarm', 'backups');
    fs.mkdirSync(backups, { recursive: true });
    makeMemoryDb(Database, dbPath, 10);

    // Older good backup, newer torn backup — restore must pick the older good one.
    const good = path.join(backups, 'memory-2020-01-01T00-00-00-000Z.db');
    const bad = path.join(backups, 'memory-2020-01-02T00-00-00-000Z.db');
    makeMemoryDb(Database, good, 10);
    makeMemoryDb(Database, bad, 10);
    const fd = fs.openSync(bad, 'r+'); fs.writeSync(fd, Buffer.alloc(16384, 0xff), 0, 16384, 0); fs.closeSync(fd);

    const r = await restoreMemoryDbFromBackup(dbPath, { timestamp: 2000 });
    expect(r.restored).toBe(true);
    expect(r.from).toBe(good);
    expect(r.rows).toBe(10);
  });
});
