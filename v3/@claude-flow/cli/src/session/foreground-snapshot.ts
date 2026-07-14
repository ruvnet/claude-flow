/**
 * ADR-321: cross-event foreground-window / PID snapshot cache.
 *
 * Project-relative (`.claude-flow/session/<session-id>/foreground-snapshot.json`),
 * NOT the `~/.ruflo` user-level convention `funnel/state.ts` uses — two concurrent
 * Claude Code sessions in the same repo must never share or corrupt each other's
 * snapshot, so the cache is scoped per session, not per user or per workspace.
 *
 * Reuses `funnel/state.ts`'s write-to-temp-then-rename convention (same atomicity
 * guarantee, different path/schema) rather than inventing a new persistence
 * mechanism. `.claude/helpers/foreground-snapshot.cjs` is a hand-ported CJS twin
 * of this module for hook-handler.cjs, which has no build step and can't
 * require() compiled TS — keep both in sync on schema/TTL/lock changes.
 */

import * as fs from 'fs';
import * as path from 'path';

/** ADR-321 "Invalidation rules" #3 default. */
export const FOREGROUND_SNAPSHOT_TTL_MS = 2000;
/** Dead-man TTL for the claim lock so a crashed holder can't wedge refreshes forever. */
export const LOCK_TTL_MS = 5000;

export interface ForegroundSnapshot {
  _ts: number;
  _pid: number;
  foregroundWindowTitle?: string;
  foregroundProcessName?: string;
  processTree?: Array<{ pid: number; ppid: number; name: string }>;
  gitStatusSummary?: { uncommittedCount: number; branch: string };
  sampledBy: string;
}

export type ForegroundSnapshotInput = Omit<ForegroundSnapshot, '_ts' | '_pid'> &
  Partial<Pick<ForegroundSnapshot, '_ts' | '_pid'>>;

interface LockFileContents {
  _ts: number;
  _pid: number;
}

export interface StalenessOptions {
  nowMs?: number;
  ttlMs?: number;
  /** Injectable so TTL-boundary/lock-race tests don't need real processes. */
  pidAliveFn?: (pid: number) => boolean;
}

function sessionDir(projectRoot: string, sessionId: string): string {
  return path.join(projectRoot, '.claude-flow', 'session', sessionId);
}

function snapshotPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), 'foreground-snapshot.json');
}

function lockPath(projectRoot: string, sessionId: string): string {
  return path.join(sessionDir(projectRoot, sessionId), 'foreground-snapshot.json.lock');
}

/**
 * $0 liveness check (ADR-321 invalidation rule 4) — `process.kill(pid, 0)`
 * throws ESRCH for a dead process and EPERM for a live one we can't signal;
 * never spawns a `tasklist`/`ps` process-list command.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Pure decision function — no fs access, no process spawns. Given a
 * snapshot (or null for a cache miss) and the current time, decides
 * whether the cache should be treated as unusable (TTL rule 3, PID-mismatch
 * rule 4). `pidAliveFn` is injectable so tests can simulate a dead producer
 * without a real process to kill.
 */
export function isStale(snapshot: ForegroundSnapshot | LockFileContents | null, options: StalenessOptions = {}): boolean {
  if (!snapshot) return true;
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? FOREGROUND_SNAPSHOT_TTL_MS;
  const pidAliveFn = options.pidAliveFn ?? isPidAlive;
  if (nowMs - snapshot._ts > ttlMs) return true;
  if (!pidAliveFn(snapshot._pid)) return true;
  return false;
}

/** Same decision as {@link isStale}, defaulted to the lock's own dead-man TTL. */
export function isLockStale(lock: LockFileContents | null, options: StalenessOptions = {}): boolean {
  return isStale(lock, { ttlMs: LOCK_TTL_MS, ...options });
}

/**
 * ADR-322 — the `.claude-flow/session/<id>/session.json` marker
 * `hook-handler.cjs`'s session-restore writes (`{pid, startedAt}`, `pid`
 * being the hook's *parent* process, not its own short-lived pid) and
 * session-end deletes. `WorkerDaemon.sampleForegroundSnapshot()`'s
 * discovery loop calls this to decide whether a session directory is live
 * before sampling for it. Pure — no fs access — so the discovery/skip
 * decision is unit-testable without instantiating a real daemon or
 * touching timers; `pidAliveFn` is injectable for the same reason `isStale`
 * takes one.
 */
export interface SessionMarker {
  pid: number;
  startedAt: number;
}

export function isSessionMarkerLive(marker: SessionMarker | null, pidAliveFn: (pid: number) => boolean = isPidAlive): boolean {
  return !!marker && pidAliveFn(marker.pid);
}

export function readSnapshot(sessionId: string, projectRoot: string): ForegroundSnapshot | null {
  try {
    const raw = fs.readFileSync(snapshotPath(projectRoot, sessionId), 'utf-8');
    return JSON.parse(raw) as ForegroundSnapshot;
  } catch {
    return null;
  }
}

/** Write-to-temp-then-rename (same atomicity convention as `funnel/state.ts`). */
export function writeSnapshot(sessionId: string, projectRoot: string, data: ForegroundSnapshotInput): boolean {
  try {
    const dir = sessionDir(projectRoot, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const target = snapshotPath(projectRoot, sessionId);
    const value: ForegroundSnapshot = {
      _ts: data._ts ?? Date.now(),
      _pid: data._pid ?? process.pid,
      ...data,
    };
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

/** ADR-321 invalidation rules #1/#2 — session-start and session-end both delete. */
export function deleteSnapshot(sessionId: string, projectRoot: string): void {
  try {
    fs.unlinkSync(snapshotPath(projectRoot, sessionId));
  } catch {
    // already absent — fine
  }
}

/**
 * Claim the refresh lock (`wx`-flag exclusive create) so concurrent hooks
 * seeing the same stale snapshot don't both spawn a redundant refresh. A
 * stale (dead-man-expired or dead-holder) lock is stolen rather than
 * honored forever.
 */
export function claimLock(sessionId: string, projectRoot: string): boolean {
  const dir = sessionDir(projectRoot, sessionId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort — writeFileSync below will surface a real error if this matters
  }
  const lp = lockPath(projectRoot, sessionId);
  const contents = JSON.stringify({ _ts: Date.now(), _pid: process.pid } satisfies LockFileContents);
  try {
    fs.writeFileSync(lp, contents, { flag: 'wx' });
    return true;
  } catch {
    let existing: LockFileContents | null = null;
    try {
      existing = JSON.parse(fs.readFileSync(lp, 'utf-8')) as LockFileContents;
    } catch {
      // unreadable / racing delete — treat as unknown, don't steal
    }
    if (existing && isLockStale(existing)) {
      try {
        fs.unlinkSync(lp);
        fs.writeFileSync(lp, contents, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function releaseLock(sessionId: string, projectRoot: string): void {
  try {
    fs.unlinkSync(lockPath(projectRoot, sessionId));
  } catch {
    // already absent — fine
  }
}
