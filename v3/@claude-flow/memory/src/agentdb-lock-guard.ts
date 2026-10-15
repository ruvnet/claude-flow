/**
 * AgentDB sql.js lock guard.
 *
 * agentdb >= 3.0.0-alpha.20 protects sql.js saves with an exclusive
 * `<db>.agentdb.lock` file (created with `wx`, content: the holder's PID) and
 * throws `AGENTDB_SQLJS_CONCURRENT_MODIFICATION` when the lock exists or the
 * database file changed under an open handle. A writer that dies between
 * creating and removing the lock leaves a lock that nothing ever clears, and
 * every later save then fails.
 *
 * This module (1) recognises that error, (2) removes a lock ONLY when it is
 * provably stale (regular file, exactly `<db>.agentdb.lock`, numeric PID that
 * is dead, old enough), and (3) retries once. Anything else surfaces as an
 * actionable `AgentdbLockError`. Writes are never dropped or silently
 * swallowed here.
 *
 * @module v3/memory/agentdb-lock-guard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export const AGENTDB_CONCURRENT_MODIFICATION_CODE = 'AGENTDB_SQLJS_CONCURRENT_MODIFICATION';
export const AGENTDB_LOCK_SUFFIX = '.agentdb.lock';

/** A lock younger than this is never considered stale (saves take milliseconds). */
export const DEFAULT_MIN_STALE_AGE_MS = 10_000;

export type LockState = 'absent' | 'live' | 'stale' | 'unverifiable';

export interface LockInspection {
  state: LockState;
  /** Path of the lock file that was inspected (the db path plus `.agentdb.lock`). */
  lockPath: string;
  pid?: number;
  reason: string;
}

export interface LockGuardOptions {
  /** Minimum lock age before it may be treated as stale. */
  minStaleAgeMs?: number;
  /** Injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
}

/** Thrown when a lock/concurrency failure cannot be (or was not) safely recovered. */
export class AgentdbLockError extends Error {
  readonly code = 'AGENTDB_LOCK_UNRECOVERABLE';
  constructor(message: string, readonly lockState: LockState, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AgentdbLockError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isConcurrentModificationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === AGENTDB_CONCURRENT_MODIFICATION_CODE
  );
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH: no such process. EPERM: exists but owned by someone else -> alive.
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function lockPathFor(dbPath: string): string {
  const resolved = path.resolve(dbPath);
  const lockPath = path.join(path.dirname(resolved), path.basename(resolved) + AGENTDB_LOCK_SUFFIX);
  return lockPath;
}

interface LockSnapshot {
  dev: number | bigint;
  ino: number | bigint;
  content: string;
  mtimeMs: number;
}

function readLockNoFollow(lockPath: string): LockSnapshot | 'absent' | 'not-regular' {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(lockPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw e;
  }
  if (!st.isFile()) return 'not-regular'; // symlink, directory, device...
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = fs.openSync(lockPath, flags);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'absent';
    if (code === 'ELOOP') return 'not-regular';
    throw e;
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > 64) return 'not-regular';
    const buf = Buffer.alloc(Math.max(1, fst.size));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { dev: fst.dev, ino: fst.ino, content: buf.subarray(0, n).toString('utf8'), mtimeMs: fst.mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}

function parsePid(content: string): number | null {
  const m = /^(\d{1,10})\n?$/.exec(content);
  if (!m) return null;
  const pid = Number(m[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function inspectAgentdbLock(dbPath: string, options: LockGuardOptions = {}): LockInspection {
  const lockPath = lockPathFor(dbPath);
  const isAlive = options.isPidAlive ?? defaultIsPidAlive;
  const now = (options.now ?? Date.now)();
  const minAge = options.minStaleAgeMs ?? DEFAULT_MIN_STALE_AGE_MS;

  let snap: LockSnapshot | 'absent' | 'not-regular';
  try {
    snap = readLockNoFollow(lockPath);
  } catch (e) {
    return { state: 'unverifiable', lockPath, reason: `cannot read lock file (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  if (snap === 'absent') return { state: 'absent', lockPath, reason: 'no lock file present' };
  if (snap === 'not-regular') {
    return { state: 'unverifiable', lockPath, reason: 'lock path is not a small regular file (symlink or unexpected type); refusing to touch it' };
  }
  const pid = parsePid(snap.content);
  if (pid === null) return { state: 'unverifiable', lockPath, reason: 'lock content is not a PID; refusing to touch it' };
  if (pid === process.pid || isAlive(pid)) return { state: 'live', lockPath, pid, reason: `lock holder PID ${pid} is alive` };
  const age = now - snap.mtimeMs;
  if (age < minAge) {
    return { state: 'live', lockPath, pid, reason: `holder PID ${pid} is dead but the lock is only ${Math.round(age)}ms old` };
  }
  return { state: 'stale', lockPath, pid, reason: `holder PID ${pid} is dead and the lock is ${Math.round(age / 1000)}s old` };
}

/**
 * Remove the lock only if it is provably stale. Returns true when a stale lock
 * was removed. The lock is first renamed aside (atomic) and re-verified as the
 * very same file that was inspected, so a lock recreated by a live writer in
 * the meantime is restored instead of deleted.
 */
export function clearStaleAgentdbLock(dbPath: string, options: LockGuardOptions = {}): { cleared: boolean; inspection: LockInspection } {
  const inspection = inspectAgentdbLock(dbPath, options);
  if (inspection.state !== 'stale') return { cleared: false, inspection };

  const lockPath = inspection.lockPath;
  const before = readLockNoFollow(lockPath);
  if (typeof before === 'string') return { cleared: false, inspection: { ...inspection, state: 'unverifiable', reason: 'lock changed during inspection' } };

  const aside = path.join(path.dirname(lockPath), `.${path.basename(lockPath)}.stale-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    fs.renameSync(lockPath, aside);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { cleared: false, inspection: { ...inspection, state: 'absent', reason: 'lock vanished before removal' } };
    return { cleared: false, inspection: { ...inspection, state: 'unverifiable', reason: `cannot move lock aside (${(e as NodeJS.ErrnoException).code ?? 'error'})` } };
  }

  const moved = readLockNoFollow(aside);
  const same = typeof moved !== 'string' && moved.ino === before.ino && moved.dev === before.dev && moved.content === before.content;
  if (!same) {
    // We displaced a different (possibly live) lock. Put it back; never delete it.
    try { fs.linkSync(aside, lockPath); } catch { /* a newer lock already exists; the displaced one is discarded below */ }
    try { fs.unlinkSync(aside); } catch { /* best effort */ }
    return { cleared: false, inspection: { ...inspection, state: 'live', reason: 'lock was replaced during removal; left in place' } };
  }
  try { fs.unlinkSync(aside); } catch { /* the stale lock is already out of the way */ }
  return { cleared: true, inspection };
}

/**
 * Run `fn`. If it fails with the AgentDB concurrent-modification error AND the
 * cause is a provably stale lock, clear it and retry exactly once. Otherwise
 * throw an actionable AgentdbLockError. Errors of other kinds pass through.
 */
export async function withAgentdbLockRecovery<T>(
  dbPath: string | undefined,
  fn: () => Promise<T> | T,
  options: LockGuardOptions = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isConcurrentModificationError(error) || !dbPath || dbPath === ':memory:') throw error;

    const { cleared, inspection } = clearStaleAgentdbLock(dbPath, options);
    if (!cleared) {
      throw new AgentdbLockError(
        `AgentDB could not save "${path.basename(dbPath)}": ${inspection.reason}. ` +
          (inspection.state === 'live'
            ? 'Another process is writing this database; retry when it finishes.'
            : inspection.state === 'absent'
              ? 'The database changed on disk after it was opened; reopen it and retry (no data was overwritten).'
              : `If no other process uses this database, remove "${path.basename(inspection.lockPath)}" manually and retry.`),
        inspection.state,
        { cause: error },
      );
    }
    try {
      return await fn();
    } catch (retryError) {
      if (isConcurrentModificationError(retryError)) {
        throw new AgentdbLockError(
          `AgentDB could not save "${path.basename(dbPath)}" even after removing a stale lock (${inspection.reason}); ` +
            'another process is writing it. Retry later.',
          'live',
          { cause: retryError },
        );
      }
      throw retryError;
    }
  }
}

/**
 * Close an AgentDB / sql.js handle safely. sql.js `close()` saves and then
 * destroys the handle even when the save fails, so a failed close cannot be
 * retried; the only safe recovery is to clear a provably stale lock BEFORE
 * closing. A concurrency failure that remains is surfaced as AgentdbLockError
 * (the caller must treat it as "not persisted"), never swallowed.
 */
export async function closeWithAgentdbLockRecovery(
  dbPath: string | undefined,
  close: () => Promise<unknown> | unknown,
  options: LockGuardOptions = {},
): Promise<void> {
  if (dbPath && dbPath !== ':memory:') clearStaleAgentdbLock(dbPath, options);
  try {
    await close();
  } catch (error) {
    if (!isConcurrentModificationError(error) || !dbPath || dbPath === ':memory:') throw error;
    const inspection = inspectAgentdbLock(dbPath, options);
    throw new AgentdbLockError(
      `AgentDB failed to persist "${path.basename(dbPath)}" on close and the pending changes were NOT saved: ${inspection.reason}.`,
      inspection.state,
      { cause: error },
    );
  }
}
