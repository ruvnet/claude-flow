/**
 * Real-agentdb regression tests for the sql.js lock/concurrency guard.
 * Reproduces the two alpha.20 failure modes (lost-update refusal, stale
 * `<db>.agentdb.lock` from a dead writer) against the actual agentdb build,
 * then proves the guard's behaviour. sql.js is forced so the lock path runs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentdbLockError,
  closeWithAgentdbLockRecovery,
  clearStaleAgentdbLock,
  inspectAgentdbLock,
  isConcurrentModificationError,
  withAgentdbLockRecovery,
} from './agentdb-lock-guard.js';

let createDatabase: (f: string) => Promise<any>;
let dir: string;
let dbFile: string;
let lockFile: string;

const DEAD_PID = 2_147_483_000; // far above pid_max on Linux/mac; ESRCH
const OLD = new Date(Date.now() - 3600_000);

function plantLock(content: string, mtime: Date = OLD): void {
  fs.writeFileSync(lockFile, content);
  fs.utimesSync(lockFile, mtime, mtime);
}

async function rows(file: string): Promise<string[]> {
  const db = await createDatabase(file);
  try {
    return db.prepare('SELECT x FROM t').all().map((r: { x: string }) => r.x);
  } finally {
    try { db.close(); } catch { /* read-only use */ }
  }
}

beforeAll(async () => {
  process.env.AGENTDB_FORCE_SQLJS = '1';
  ({ createDatabase } = (await import('agentdb/db-fallback')) as any);
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-lock-guard-'));
  dbFile = path.join(dir, 'test.db');
  lockFile = `${dbFile}.agentdb.lock`;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('failure reproduction (agentdb alpha.20 behaviour)', () => {
  it('a stale handle save is refused with AGENTDB_SQLJS_CONCURRENT_MODIFICATION and keeps the other writer row', async () => {
    const a = await createDatabase(dbFile);
    const b = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)');
    a.exec("INSERT INTO t VALUES('from-A')");
    a.close();
    b.exec('CREATE TABLE IF NOT EXISTS t(x)');
    b.exec("INSERT INTO t VALUES('from-B')");
    let err: unknown;
    try { b.close(); } catch (e) { err = e; }
    expect(isConcurrentModificationError(err)).toBe(true);
    expect(await rows(dbFile)).toEqual(['from-A']); // refused, not silently lost-updated
  });

  it('a lock left by a dead PID makes the first save fail and the db file is never created', async () => {
    plantLock(`${DEAD_PID}\n`);
    const a = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)');
    let err: unknown;
    try { a.close(); } catch (e) { err = e; }
    expect(isConcurrentModificationError(err)).toBe(true);
    expect(fs.existsSync(dbFile)).toBe(false);
  });
});

describe('inspectAgentdbLock / clearStaleAgentdbLock', () => {
  it('absent', () => {
    expect(inspectAgentdbLock(dbFile).state).toBe('absent');
  });
  it('stale: dead PID and old', () => {
    plantLock(`${DEAD_PID}\n`);
    expect(inspectAgentdbLock(dbFile).state).toBe('stale');
  });
  it('live: PID alive is never cleared', () => {
    plantLock(`${process.ppid}\n`);
    const r = clearStaleAgentdbLock(dbFile);
    expect(r.cleared).toBe(false);
    expect(r.inspection.state).toBe('live');
    expect(fs.existsSync(lockFile)).toBe(true);
  });
  it('own PID is treated as live', () => {
    plantLock(`${process.pid}\n`);
    expect(inspectAgentdbLock(dbFile).state).toBe('live');
  });
  it('dead PID but fresh lock is not cleared', () => {
    plantLock(`${DEAD_PID}\n`, new Date());
    const r = clearStaleAgentdbLock(dbFile);
    expect(r.cleared).toBe(false);
    expect(fs.existsSync(lockFile)).toBe(true);
  });
  it('non-PID content is unverifiable and untouched', () => {
    plantLock('hello\n');
    const r = clearStaleAgentdbLock(dbFile);
    expect(r.cleared).toBe(false);
    expect(r.inspection.state).toBe('unverifiable');
    expect(fs.readFileSync(lockFile, 'utf8')).toBe('hello\n');
  });
  it('a symlinked lock is never followed or removed', () => {
    const target = path.join(dir, 'victim.txt');
    fs.writeFileSync(target, `${DEAD_PID}\n`);
    fs.symlinkSync(target, lockFile);
    const r = clearStaleAgentdbLock(dbFile);
    expect(r.cleared).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.lstatSync(lockFile).isSymbolicLink()).toBe(true);
  });
  it('clears exactly the lock and leaves siblings alone', () => {
    plantLock(`${DEAD_PID}\n`);
    const sibling = path.join(dir, 'other.db.agentdb.lock');
    fs.writeFileSync(sibling, `${DEAD_PID}\n`);
    const r = clearStaleAgentdbLock(dbFile);
    expect(r.cleared).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.stale-'))).toEqual([]);
  });
});

describe('withAgentdbLockRecovery', () => {
  it('recovers a stale lock and the save succeeds exactly once more (no data loss)', async () => {
    plantLock(`${DEAD_PID}\n`);
    const a = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)');
    a.exec("INSERT INTO t VALUES('kept')");
    await withAgentdbLockRecovery(dbFile, () => a.save());
    expect(fs.existsSync(lockFile)).toBe(false);
    a.close();
    expect(await rows(dbFile)).toEqual(['kept']);
  });

  it('does not retry or delete a live holder lock; surfaces an actionable error', async () => {
    plantLock(`${process.ppid}\n`);
    const a = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)');
    let err: unknown;
    try { await withAgentdbLockRecovery(dbFile, () => a.save()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AgentdbLockError);
    expect((err as AgentdbLockError).lockState).toBe('live');
    expect((err as Error).message).toMatch(/another process/i);
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(fs.existsSync(dbFile)).toBe(false);
  });

  it('a true lost-update (no lock) is surfaced, never retried, never overwritten', async () => {
    const a = await createDatabase(dbFile);
    const b = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)'); a.exec("INSERT INTO t VALUES('from-A')"); a.close();
    b.exec('CREATE TABLE IF NOT EXISTS t(x)'); b.exec("INSERT INTO t VALUES('from-B')");
    let calls = 0;
    let err: unknown;
    try { await withAgentdbLockRecovery(dbFile, () => { calls++; return b.save(); }); } catch (e) { err = e; }
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(AgentdbLockError);
    expect((err as AgentdbLockError).lockState).toBe('absent');
    expect(await rows(dbFile)).toEqual(['from-A']);
  });

  it('passes unrelated errors through untouched and never inspects the filesystem for them', async () => {
    const boom = new Error('boom');
    await expect(withAgentdbLockRecovery(dbFile, () => { throw boom; })).rejects.toBe(boom);
  });

  it(':memory: databases are not guarded', async () => {
    const e = Object.assign(new Error('x'), { code: 'AGENTDB_SQLJS_CONCURRENT_MODIFICATION' });
    await expect(withAgentdbLockRecovery(':memory:', () => { throw e; })).rejects.toBe(e);
  });

  it('error message does not leak the full directory path', async () => {
    plantLock(`${process.ppid}\n`);
    const e = Object.assign(new Error('x'), { code: 'AGENTDB_SQLJS_CONCURRENT_MODIFICATION' });
    let err: unknown;
    try { await withAgentdbLockRecovery(dbFile, () => { throw e; }); } catch (x) { err = x; }
    expect((err as Error).message).not.toContain(dir);
  });
});

describe('closeWithAgentdbLockRecovery', () => {
  it('clears a stale lock first so close persists the data', async () => {
    plantLock(`${DEAD_PID}\n`);
    const a = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)'); a.exec("INSERT INTO t VALUES('persisted')");
    await closeWithAgentdbLockRecovery(dbFile, () => a.close());
    expect(await rows(dbFile)).toEqual(['persisted']);
  });
  it('surfaces (never swallows) a close that cannot persist because of a live lock', async () => {
    plantLock(`${process.ppid}\n`);
    const a = await createDatabase(dbFile);
    a.exec('CREATE TABLE t(x)');
    await expect(closeWithAgentdbLockRecovery(dbFile, () => a.close())).rejects.toBeInstanceOf(AgentdbLockError);
    expect(fs.existsSync(lockFile)).toBe(true);
  });
});
