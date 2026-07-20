/**
 * Storage-health probe regression tests — 2026-07-18 incident gate 34.
 *
 * `agentdb_health`'s `available: true` used to be pure object-graph liveness:
 * it reported healthy over a malformed database for days. The probe must
 * answer read-integrity and write-readiness separately, from the actual
 * on-disk database via the native WAL-aware engine, and a malformed database
 * must never be write-ready.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { probeStorageHealth } from '../src/memory/memory-bridge.js';

async function loadSqlite(): Promise<any> {
  const mod = 'better-sqlite3';
  return (await import(mod)).default;
}

function makeDb(Database: any, file: string, rows: number): void {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE memory_entries (id TEXT PRIMARY KEY, namespace TEXT, content TEXT)');
  const ins = db.prepare('INSERT INTO memory_entries VALUES (?,?,?)');
  const tx = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) ins.run('k' + i, 'ns', 'v'.repeat(200) + i);
  });
  tx(rows);
  db.close();
}

function corruptMiddle(file: string): void {
  const fd = fs.openSync(file, 'r+');
  try {
    const size = fs.statSync(file).size;
    fs.writeSync(fd, Buffer.alloc(1024, 0xdb), 0, 1024, Math.floor(size / 2));
  } finally {
    fs.closeSync(fd);
  }
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-probe-')); });
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

describe('probeStorageHealth', () => {
  it('reports ok + writeReady on a healthy database', async () => {
    const Database = await loadSqlite();
    const dbFile = path.join(tmp, 'memory.db');
    makeDb(Database, dbFile, 50);

    const h = await probeStorageHealth(dbFile);

    expect(h.integrity).toBe('ok');
    expect(h.writeReady).toBe(true);
    expect(h.writeProbe).toBe('ok');
  });

  it('reports the quick_check findings and NEVER writeReady on a malformed database', async () => {
    const Database = await loadSqlite();
    const dbFile = path.join(tmp, 'memory.db');
    makeDb(Database, dbFile, 600);
    corruptMiddle(dbFile);
    // Confirm the fixture is genuinely malformed before asserting the probe.
    let native = '';
    try {
      const v = new Database(dbFile, { readonly: true });
      native = v.pragma('quick_check', { simple: true });
      v.close();
    } catch (e) {
      native = (e as Error).message;
    }
    expect(native === 'ok').toBe(false);

    const h = await probeStorageHealth(dbFile);

    expect(h.integrity).not.toBe('ok');
    expect(h.writeReady).toBe(false);
    expect(h.writeProbe).toMatch(/^skipped/);
  });

  it('reports probe-failed (not ok) on a missing database', async () => {
    const h = await probeStorageHealth(path.join(tmp, 'nope.db'));
    expect(h.integrity).toMatch(/^probe-failed/);
    expect(h.writeReady).toBe(false);
  });
});
