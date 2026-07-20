/**
 * Regression test for the memory-integrity wiring defect.
 *
 * The bug: a bare `ruflo doctor` run only ran `checkMemoryDatabase`
 * (existsSync + statSync), which returns 'pass' for ANY file on disk — even a
 * SQLite-malformed one. The real functional probe, `checkMemoryIntegrity`, was
 * registered ONLY under `--component memory`, so a corrupt store sailed through
 * the default run green.
 *
 * The fix wires the three functional memory probes into DEFAULT_CHECKS (the
 * bare-`doctor` list) immediately after the existence probe, and reworks
 * `checkMemoryIntegrity` to be native-first + WAL-aware (better-sqlite3
 * `PRAGMA quick_check`), mapping a malformed disk image to a hard 'fail'.
 *
 * These tests prove, on real on-disk fixtures:
 *   (a) `checkMemoryIntegrity` is wired into DEFAULT_CHECKS right after
 *       `checkMemoryDatabase`;
 *   (b) the DEFAULT check list yields a 'Memory Integrity' = 'fail' on a
 *       deliberately corrupted DB (native quick_check confirms malformed first);
 *   (c) the DEFAULT check list yields a 'Memory Integrity' = 'pass' on a
 *       healthy DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_CHECKS,
  checkMemoryDatabase,
  checkMemoryIntegrity,
} from '../src/commands/doctor.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

async function loadSqlite(): Promise<any> {
  const mod = 'better-sqlite3';
  return (await import(mod)).default;
}

/** Build a healthy, multi-page memory.db with a populated memory_entries table. */
function makeHealthyDb(Database: any, file: string): void {
  const db = new Database(file);
  db.exec('CREATE TABLE memory_entries (id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT, embedding BLOB)');
  const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content) VALUES (?,?,?,?)');
  // 600 rows forces the file well past a single page, so the mid-file splat
  // below lands on a real b-tree page rather than trailing free space.
  const tx = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) ins.run('id' + i, 'k' + i, 'default', 'content value number ' + i + ' '.repeat(20));
  });
  tx(600);
  db.close();
}

/** Splat garbage into the MIDDLE of the file, corrupting a data page while
 *  leaving the page-1 header intact (so the DB still opens, but quick_check
 *  detects a malformed image). */
function corruptMiddle(file: string): void {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r+');
  try {
    fs.writeSync(fd, Buffer.alloc(1024, 0xdb), 0, 1024, Math.floor(size / 2));
  } finally {
    fs.closeSync(fd);
  }
}

/** Native ground truth: does better-sqlite3's quick_check see this DB as
 *  corrupt? Returns true if quick_check throws "malformed" OR reports any
 *  non-'ok' row. Used to VERIFY the fixture is genuinely broken before we
 *  assert on doctor's behavior. */
function nativeIsCorrupt(Database: any, file: string): boolean {
  let db: any = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const rows: string[] = (db.prepare('PRAGMA quick_check(10)').all() as Array<Record<string, unknown>>)
      .map((r) => String(Object.values(r)[0] ?? ''));
    return !(rows.length === 1 && rows[0] === 'ok');
  } catch (e) {
    return /malformed/.test((e as Error).message || String(e));
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

/** Run the memory-check slice of DEFAULT_CHECKS (the existence probe plus the
 *  functional probes wired immediately after it) and return the 'Memory
 *  Integrity' row the default run would print. */
async function runDefaultMemoryIntegrityRow() {
  const dbIdx = DEFAULT_CHECKS.indexOf(checkMemoryDatabase);
  const slice = DEFAULT_CHECKS.slice(dbIdx, dbIdx + 4); // db, integrity, content, coverage
  const settled = await Promise.allSettled(slice.map((c) => c()));
  const rows = settled.map((s) => (s.status === 'fulfilled' ? s.value : null)).filter(Boolean) as Array<{ name: string; status: string; message: string }>;
  return rows.find((r) => r.name === 'Memory Integrity');
}

let tmp: string;
let prevMemPath: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mem-integrity-'));
  prevMemPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  // Point the doctor's memory-DB resolver (getMemoryRoot) at the fixture dir,
  // hermetically — env var takes precedence over cwd/config in getMemoryRoot.
  process.env.CLAUDE_FLOW_MEMORY_PATH = tmp;
  _resetMemoryRootCache();
});

afterEach(() => {
  if (prevMemPath === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  else process.env.CLAUDE_FLOW_MEMORY_PATH = prevMemPath;
  _resetMemoryRootCache();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('doctor memory-integrity wiring', () => {
  it('wires checkMemoryIntegrity into DEFAULT_CHECKS immediately after checkMemoryDatabase', () => {
    const dbIdx = DEFAULT_CHECKS.indexOf(checkMemoryDatabase);
    expect(dbIdx).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CHECKS[dbIdx + 1]).toBe(checkMemoryIntegrity);
  });

  it('DEFAULT run reports Memory Integrity = fail on a corrupted DB', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    makeHealthyDb(Database, dbPath);
    corruptMiddle(dbPath);

    // Ground truth: the fixture really is malformed as far as native SQLite
    // is concerned. If this ever fails, the corruption strategy — not doctor —
    // is the problem, and the assertion below would be meaningless.
    expect(nativeIsCorrupt(Database, dbPath)).toBe(true);

    const row = await runDefaultMemoryIntegrityRow();
    expect(row).toBeDefined();
    expect(row!.status).toBe('fail');
    expect(row!.message.toLowerCase()).toMatch(/malformed|quick_check/);
  });

  it('DEFAULT run reports Memory Integrity = pass on a healthy DB', async () => {
    const Database = await loadSqlite();
    const dbPath = path.join(tmp, 'memory.db');
    makeHealthyDb(Database, dbPath);

    expect(nativeIsCorrupt(Database, dbPath)).toBe(false);

    const row = await runDefaultMemoryIntegrityRow();
    expect(row).toBeDefined();
    expect(row!.status).toBe('pass');
  });
});
