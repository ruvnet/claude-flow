/**
 * Data-durability regression tests for issue #2584 — AgentDB (sql.js) corruption
 * under torn/concurrent full-image flushes.
 *
 * Covers both recovery of historical corruption and prevention of recurrence:
 * native SQLite/WAL mutation on a stable inode, exact concurrent-write union,
 * complete-corpus recall, and verified backup recovery for an already-torn DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileAtomic } from '../src/fs-secure.js';
import { backupMemoryDb, restoreMemoryDbFromBackup } from '../src/services/memory-backup.js';
import {
  applyTemporalDecay,
  deleteEntry,
  ensureSchemaColumns,
  getEntry,
  initializeMemoryDatabase,
  purgeNamespace,
  recoverMemoryDatabase,
  searchEntries,
  storeEntry,
} from '../src/memory/memory-initializer.js';

async function loadSqlite(): Promise<any> {
  const mod = 'better-sqlite3';
  return (await import(mod)).default;
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

describe('live SQLite inode durability', () => {
  it('migrates schema in place while another native connection is open', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    makeMemoryDb(Database, dbPath, 3);
    const live = new Database(dbPath);
    const inode = fs.statSync(dbPath).ino;

    const first = await ensureSchemaColumns(dbPath);
    expect(first.success).toBe(true);
    expect(first.columnsAdded).toContain('status');
    expect(fs.statSync(dbPath).ino).toBe(inode);
    expect(
      (live.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('memory_entries') WHERE name = 'status'").get() as { c: number }).c,
    ).toBe(1);

    const second = await ensureSchemaColumns(dbPath);
    expect(second.success).toBe(true);
    expect(second.columnsAdded).toEqual([]);
    expect(fs.statSync(dbPath).ino).toBe(inode);

    live.close();
  });

  it('keeps the inode stable across fallback store, retrieve, and delete', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    const initialized = await initializeMemoryDatabase({ dbPath, migrate: false });
    expect(initialized.success).toBe(true);

    const previous = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const live = new Database(dbPath);
    const inode = fs.statSync(dbPath).ino;

    try {
      const stored = await storeEntry({
        key: 'durability-key',
        value: 'durability-value',
        namespace: 'durability',
        generateEmbeddingFlag: false,
        tags: ['preserved'],
        ttl: 60,
        dbPath,
      });
      expect(stored.success).toBe(true);
      expect(fs.statSync(dbPath).ino).toBe(inode);
      expect(
        (live.prepare('SELECT COUNT(*) AS c FROM memory_entries WHERE key = ?').get('durability-key') as { c: number }).c,
      ).toBe(1);

      const updated = await storeEntry({
        key: 'durability-key',
        value: 'durability-value-updated',
        namespace: 'durability',
        generateEmbeddingFlag: false,
        tags: ['updated'],
        dbPath,
      });
      expect(updated.success).toBe(true);
      expect(updated.id).toBe(stored.id);
      expect(fs.statSync(dbPath).ino).toBe(inode);
      expect(
        live.prepare('SELECT content, status FROM memory_entries WHERE key = ?').get('durability-key'),
      ).toMatchObject({ content: 'durability-value-updated', status: 'active' });
      expect(
        (live.prepare('SELECT COUNT(*) AS c FROM memory_entries WHERE key = ?').get('durability-key') as { c: number }).c,
      ).toBe(1);

      const retrieved = await getEntry({ key: 'durability-key', namespace: 'durability', dbPath });
      expect(retrieved.success).toBe(true);
      expect(retrieved.found).toBe(true);
      expect(fs.statSync(dbPath).ino).toBe(inode);

      const deleted = await deleteEntry({ key: 'durability-key', namespace: 'durability', dbPath });
      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(true);
      expect(fs.statSync(dbPath).ino).toBe(inode);
      expect(
        (live.prepare('SELECT status FROM memory_entries WHERE key = ?').get('durability-key') as { status: string }).status,
      ).toBe('deleted');

      for (const key of ['purge-a', 'purge-b']) {
        const extra = await storeEntry({
          key,
          value: key,
          namespace: 'purge-me',
          generateEmbeddingFlag: false,
          dbPath,
        });
        expect(extra.success).toBe(true);
      }
      const purged = await purgeNamespace({ namespace: 'purge-me', dbPath });
      expect(purged.success).toBe(true);
      expect(purged.deletedCount).toBe(2);
      expect(fs.statSync(dbPath).ino).toBe(inode);

      const decayed = await applyTemporalDecay(dbPath);
      expect(decayed.success).toBe(true);
      expect(fs.statSync(dbPath).ino).toBe(inode);
    } finally {
      live.close();
      if (previous === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
      else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = previous;
    }
  });

  it('uses the native bridge for default upsert without changing row identity', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    const initialized = await initializeMemoryDatabase({ dbPath, migrate: false });
    expect(initialized.success).toBe(true);
    const inode = fs.statSync(dbPath).ino;

    try {
      const first = await storeEntry({
        key: 'bridge-upsert',
        value: 'first',
        namespace: 'bridge',
        generateEmbeddingFlag: false,
        dbPath,
      });
      const second = await storeEntry({
        key: 'bridge-upsert',
        value: 'second',
        namespace: 'bridge',
        generateEmbeddingFlag: false,
        dbPath,
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.id).toBe(first.id);
      expect(fs.statSync(dbPath).ino).toBe(inode);
      const db = new Database(dbPath, { readonly: true });
      expect(db.prepare(
        `SELECT id, content, status FROM memory_entries
         WHERE namespace = 'bridge' AND key = 'bridge-upsert'`,
      ).all()).toEqual([{ id: first.id, content: 'second', status: 'active' }]);
      db.close();
    } finally {
      const { shutdownBridge } = await import('../src/memory/memory-bridge.js');
      await shutdownBridge();
    }
  });

  it('searches the complete authoritative corpus beyond the first 1,000 rows', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    const initialized = await initializeMemoryDatabase({ dbPath, migrate: false });
    expect(initialized.success).toBe(true);

    const db = new Database(dbPath);
    const insert = db.prepare(`
      INSERT INTO memory_entries
        (id, key, namespace, content, type, created_at, updated_at, status)
      VALUES (?, ?, 'recall', ?, 'semantic', ?, ?, 'active')
    `);
    const now = Date.now();
    db.transaction(() => {
      for (let i = 0; i < 1001; i++) {
        insert.run(`recall-${i}`, `recall-${i}`, i === 1000 ? 'unique-tail-needle' : `ordinary row ${i}`, now, now);
      }
    })();
    db.close();

    const previous = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    try {
      const result = await searchEntries({
        query: 'unique-tail-needle',
        namespace: 'recall',
        dbPath,
        threshold: 0.3,
        limit: 10,
      });
      expect(result.success).toBe(true);
      expect(result.results.map(row => row.key)).toContain('recall-1000');
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
      else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = previous;
    }
  });

  it('preserves the union of concurrent writes from independent processes', async () => {
    const Database = await loadSqlite();
    const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/src/memory/memory-initializer.js');
    expect(fs.existsSync(compiled)).toBe(true);

    const dbPath = path.join(tmp, 'memory.db');
    const initialized = await initializeMemoryDatabase({ dbPath, migrate: false });
    expect(initialized.success).toBe(true);
    const inode = fs.statSync(dbPath).ino;
    const run = promisify(execFile);
    const childScript = `
      process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
      const { storeEntry } = await import(process.argv[1]);
      const dbPath = process.argv[2];
      const prefix = process.argv[3];
      for (let i = 0; i < 25; i++) {
        const result = await storeEntry({
          key: prefix + '-' + i,
          value: prefix + '-value-' + i,
          namespace: 'concurrent',
          generateEmbeddingFlag: false,
          dbPath,
        });
        if (!result.success) throw new Error(result.error || 'store failed');
      }
    `;
    const moduleUrl = pathToFileURL(compiled).href;

    await Promise.all([
      run(process.execPath, ['--input-type=module', '-e', childScript, moduleUrl, dbPath, 'left']),
      run(process.execPath, ['--input-type=module', '-e', childScript, moduleUrl, dbPath, 'right']),
    ]);

    expect(fs.statSync(dbPath).ino).toBe(inode);
    const db = new Database(dbPath, { readonly: true });
    const count = (db.prepare(
      `SELECT COUNT(*) AS count FROM memory_entries WHERE namespace = 'concurrent'`,
    ).get() as { count: number }).count;
    db.close();
    expect(count).toBe(50);
  }, 30_000);
});

describe('backup auto-restore fallback (#2584)', () => {
  it('recoverMemoryDatabase restores the newest good backup when the live image is torn', async () => {
    const Database = await loadSqlite();
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
    const dbPath = path.join(tmp, '.swarm', 'memory.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    makeMemoryDb(Database, dbPath, 3);
    const r = await restoreMemoryDbFromBackup(dbPath);
    expect(r.restored).toBe(false);
    expect(r.skipped).toMatch(/no-backups/);
  });

  it('restoreMemoryDbFromBackup skips a corrupt backup and picks an older good one', async () => {
    const Database = await loadSqlite();
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
