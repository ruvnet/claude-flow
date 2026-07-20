/**
 * Cooperative-drain recovery — hands-off self-healing restored.
 *
 * Contract: recovery posts `<db>.recovery-pending`; cooperating connections
 * (any same-build accessor) detach on sight and hold new opens until it
 * clears; recovery bounded-waits for zero holders, swaps, clears the marker.
 * The typed `live-handles` refusal fires ONLY for holders that never drain —
 * foreign/unpinned processes, exactly where a swap would corrupt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  isRecoveryPending,
  postRecoveryMarker,
  clearRecoveryMarker,
} from '../src/memory/db-handle-guard.js';
import { recoverMemoryDatabase } from '../src/memory/memory-initializer.js';

async function loadSqlite(): Promise<any> {
  const mod = 'better-sqlite3';
  return (await import(mod)).default;
}

function makeMemoryDb(Database: any, file: string, rows: number): void {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE memory_entries (id TEXT PRIMARY KEY, namespace TEXT, value TEXT, embedding BLOB)');
  const ins = db.prepare('INSERT INTO memory_entries (id, namespace, value) VALUES (?,?,?)');
  const tx = db.transaction((n: number) => { for (let i = 0; i < n; i++) ins.run('k' + i, 'default', 'v' + i); });
  tx(rows);
  db.close();
}

function corruptMiddle(file: string): void {
  const fd = fs.openSync(file, 'r+');
  try {
    const size = fs.statSync(file).size;
    fs.writeSync(fd, Buffer.alloc(512, 0xab), 0, 512, Math.floor(size / 2));
  } finally {
    fs.closeSync(fd);
  }
}

const BSQ = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', 'better-sqlite3');

/**
 * A real second OS process holding a native handle. cooperative=true makes it
 * poll for the recovery marker and CLOSE its handle on sight (the behavior
 * every same-build accessor now has); cooperative=false holds forever.
 */
function spawnHolder(dbFile: string, cooperative: boolean): Promise<ChildProcess> {
  const script = `
    const fs = require('node:fs');
    const D = require(${JSON.stringify(BSQ)});
    let db = new D(${JSON.stringify(dbFile)});
    try { db.prepare('SELECT COUNT(*) FROM memory_entries').get(); } catch { /* corrupt is fine — handle is what matters */ }
    process.stdout.write('HOLDING\\n');
    ${cooperative ? `
    const marker = ${JSON.stringify(dbFile)} + '.recovery-pending';
    const t = setInterval(() => {
      if (db && fs.existsSync(marker)) {
        db.close(); db = null;
        process.stdout.write('DETACHED\\n');
        clearInterval(t);
      }
    }, 100);` : ''}
    setInterval(() => {}, 1 << 30);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const timer = setTimeout(() => reject(new Error('holder did not start')), 15000);
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('HOLDING')) { clearTimeout(timer); resolve(child); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`holder exited early (${code})`)); });
  });
}

let tmp: string;
let holder: ChildProcess | null = null;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-recovery-')); });
afterEach(() => {
  if (holder) { try { holder.kill('SIGKILL'); } catch { /* */ } holder = null; }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

const onLinux = process.platform === 'linux' ? describe : describe.skip;

describe('recovery marker lifecycle', () => {
  it('fresh marker is pending; cleared marker is not', () => {
    const dbPath = path.join(tmp, 'memory.db');
    expect(isRecoveryPending(dbPath)).toBe(false);
    postRecoveryMarker(dbPath, 'test');
    expect(isRecoveryPending(dbPath)).toBe(true);
    clearRecoveryMarker(dbPath);
    expect(isRecoveryPending(dbPath)).toBe(false);
  });

  it('a stale marker (crashed recovery) self-clears', () => {
    const dbPath = path.join(tmp, 'memory.db');
    postRecoveryMarker(dbPath, 'test');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(`${dbPath}.recovery-pending`, old, old);
    expect(isRecoveryPending(dbPath)).toBe(false);
    expect(fs.existsSync(`${dbPath}.recovery-pending`)).toBe(false);
  });
});

onLinux('hands-off recovery in a live topology', () => {
  it('succeeds unattended while a COOPERATING process holds the DB', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    makeMemoryDb(Database, dbPath, 300);
    corruptMiddle(dbPath);
    holder = await spawnHolder(dbPath, true);

    const result = await recoverMemoryDatabase(dbPath, { drainTimeoutMs: 15_000 });

    // The holder detached on the marker; recovery completed without force,
    // without an operator, and without the refusal path.
    expect(result.reason).not.toBe('live-handles');
    expect(result.recovered).toBe(true);
    // Marker cleared afterwards so clients reattach.
    expect(isRecoveryPending(dbPath)).toBe(false);
    // The recovered DB is healthy.
    const check = new Database(dbPath, { readonly: true });
    expect(String(check.pragma('quick_check', { simple: true }))).toBe('ok');
    check.close();
  }, 60_000);

  it('still refuses (typed) when a NON-cooperating holder never detaches', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    makeMemoryDb(Database, dbPath, 300);
    corruptMiddle(dbPath);
    holder = await spawnHolder(dbPath, false);
    const before = fs.statSync(dbPath).ino;

    const result = await recoverMemoryDatabase(dbPath, { drainTimeoutMs: 2_000 });

    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('live-handles');
    expect((result.liveHandles ?? []).map(h => h.pid)).toContain(holder.pid);
    // Live path untouched; marker cleared (no wedged state left behind).
    expect(fs.statSync(dbPath).ino).toBe(before);
    expect(isRecoveryPending(dbPath)).toBe(false);
  }, 60_000);
});
