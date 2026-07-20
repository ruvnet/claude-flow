/**
 * WASM-host write capability — topology-aware sql.js fallback.
 *
 * Contract: a host without better-sqlite3 keeps FULL memory write capability
 * through the gated sql.js adapter; the gate refuses ONLY when a native WAL
 * engine provably owns the database (WAL header / -wal//-shm sidecars / live
 * foreign holders — the 2026-07 corruption topology). Concurrent WASM writers
 * are serialized by the advisory db lock and never lose each other's writes.
 *
 * CLAUDE_FLOW_FORCE_WASM_WRITES=1 forces the fallback branch so the suite
 * runs on hosts where the native module is installed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { assessSqljsWriteSafety } from '../src/memory/sqljs-write-fallback.js';
import { storeEntry, getEntry, deleteEntry, initializeMemoryDatabase } from '../src/memory/memory-initializer.js';

const execFileP = promisify(execFile);

async function loadSqlite(): Promise<any> {
  const mod = 'better-sqlite3';
  return (await import(mod)).default;
}

let tmp: string;
let holder: ChildProcess | null = null;
const OLD_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-writes-'));
  OLD_ENV.force = process.env.CLAUDE_FLOW_FORCE_WASM_WRITES;
  OLD_ENV.bridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  process.env.CLAUDE_FLOW_FORCE_WASM_WRITES = '1';
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1'; // exercise the fallback, not the native bridge
});
afterEach(() => {
  if (holder) { try { holder.kill('SIGKILL'); } catch { /* */ } holder = null; }
  if (OLD_ENV.force === undefined) delete process.env.CLAUDE_FLOW_FORCE_WASM_WRITES;
  else process.env.CLAUDE_FLOW_FORCE_WASM_WRITES = OLD_ENV.force;
  if (OLD_ENV.bridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = OLD_ENV.bridge;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('assessSqljsWriteSafety', () => {
  it('allows a fresh path and a sql.js-created (non-WAL) database', async () => {
    const dbPath = path.join(tmp, 'memory.db');
    expect(assessSqljsWriteSafety(dbPath).safe).toBe(true);

    await initializeMemoryDatabase({ dbPath, verbose: false });
    const verdict = assessSqljsWriteSafety(dbPath);
    expect(verdict.safe).toBe(true);
    expect(verdict.reason).toBe('unowned-at-rest');
  });

  it('allows a WAL-header database AT REST (checkpointed, no sidecars, no holders)', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t(x)');
    db.close(); // checkpoints and removes sidecars — complete content in the main image
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    const verdict = assessSqljsWriteSafety(dbPath);
    expect(verdict.safe).toBe(true);
    expect(verdict.reason).toBe('unowned-at-rest');
  });

  it('refuses while a native WAL connection is attached (sidecars present)', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1)');
    try {
      expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
      const verdict = assessSqljsWriteSafety(dbPath);
      expect(verdict.safe).toBe(false);
      expect(['wal-sidecars', 'live-holders']).toContain(verdict.reason);
    } finally {
      db.close();
    }
  });

  it('refuses when -wal/-shm sidecars exist even with a non-WAL header', () => {
    const dbPath = path.join(tmp, 'memory.db');
    fs.writeFileSync(dbPath, Buffer.alloc(100)); // not a WAL header
    fs.writeFileSync(`${dbPath}-wal`, Buffer.alloc(0));
    const verdict = assessSqljsWriteSafety(dbPath);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toBe('wal-sidecars');
  });
});

describe('WASM-host CRUD (forced fallback, bridge disabled)', () => {
  it('store → retrieve → delete roundtrip works with no native engine path', async () => {
    const dbPath = path.join(tmp, 'memory.db');
    await initializeMemoryDatabase({ dbPath, verbose: false });

    const stored = await storeEntry({ key: 'wasm-k', value: 'wasm-v', namespace: 'wasm', generateEmbeddingFlag: false, dbPath });
    expect(stored.success).toBe(true);

    const got = await getEntry({ key: 'wasm-k', namespace: 'wasm', dbPath });
    expect(got?.found ?? got?.success).toBeTruthy();

    const del = await deleteEntry({ key: 'wasm-k', namespace: 'wasm', dbPath });
    expect(del.success).toBe(true);

    // The database must never have entered WAL mode on this path.
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(assessSqljsWriteSafety(dbPath).safe).toBe(true);
  });

  it('refuses mutation while a native WAL writer is attached, with a typed reason', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    await initializeMemoryDatabase({ dbPath, verbose: false });
    // A native writer attaches and commits (sidecars appear, handle stays open).
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS t(x); INSERT INTO t VALUES (1)');
    try {
      const stored = await storeEntry({ key: 'k', value: 'v', namespace: 'n', generateEmbeddingFlag: false, dbPath });
      expect(stored.success).toBe(false);
      expect(String(stored.error)).toMatch(/wal-sidecars|live-holders|attached/i);
    } finally {
      db.close();
    }
  });

  it('two concurrent WASM writer PROCESSES preserve the union of writes', async () => {
    const dbPath = path.join(tmp, 'memory.db');
    await initializeMemoryDatabase({ dbPath, verbose: false });

    const distInit = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'src', 'memory', 'memory-initializer.js');
    const child = (tag: string) => execFileP(process.execPath, ['--input-type=module', '-e', `
      const { storeEntry } = await import(${JSON.stringify('file://' + distInit)});
      for (let i = 0; i < 8; i++) {
        const r = await storeEntry({ key: '${tag}-' + i, value: 'v', namespace: 'race', generateEmbeddingFlag: false, dbPath: ${JSON.stringify(dbPath)} });
        if (!r.success) { console.error('STORE-FAIL', r.error); process.exit(1); }
      }
    `], { env: { ...process.env, CLAUDE_FLOW_FORCE_WASM_WRITES: '1', CLAUDE_FLOW_DISABLE_BRIDGE: '1' }, timeout: 60_000 });

    await Promise.all([child('left'), child('right')]);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const stmt = db.prepare("SELECT COUNT(*) AS c FROM memory_entries WHERE namespace='race'");
    stmt.step();
    const { c } = stmt.getAsObject() as { c: number };
    stmt.free();
    db.close();
    expect(c).toBe(16); // 8 + 8, no lost updates
  }, 120_000);
});
