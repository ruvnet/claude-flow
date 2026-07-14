/**
 * ADR-321 — cross-event foreground-window / PID snapshot cache.
 *
 * Behavior-contract tests for the cache module
 * (`src/session/foreground-snapshot.ts`): cold-cache read, atomic
 * write round-trip + schema, TTL / PID-mismatch staleness (pure, injected
 * clock + liveness so no timing dependence), session-start/session-end
 * invalidation, and the concurrent-refresh claim-lock (exclusive-create,
 * dead-man steal). Plus a parity guard that the hand-ported `.cjs` twin
 * hook-handler.cjs consumes stays in sync on API + TTL constants + on-disk
 * schema (ADR-321 "keep both in sync").
 *
 * Real isolated tmpdir per test (deterministic, exercises the real atomic
 * rename); the write→rename *interaction* is asserted separately with a
 * mocked fs in adr321-atomic-write.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  FOREGROUND_SNAPSHOT_TTL_MS,
  LOCK_TTL_MS,
  isPidAlive,
  isStale,
  isLockStale,
  readSnapshot,
  writeSnapshot,
  deleteSnapshot,
  claimLock,
  releaseLock,
} from '../src/session/foreground-snapshot.js';

const SESSION_ID = 'sess-abc';
let root: string;

function sessionDir(): string {
  return join(root, '.claude-flow', 'session', SESSION_ID);
}
function snapshotFile(): string {
  return join(sessionDir(), 'foreground-snapshot.json');
}
function lockFile(): string {
  return join(sessionDir(), 'foreground-snapshot.json.lock');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adr321-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ADR-321 pure staleness decisions (no fs, no spawn)', () => {
  it('exports the ADR-321 default TTLs', () => {
    expect(FOREGROUND_SNAPSHOT_TTL_MS).toBe(2000);
    expect(LOCK_TTL_MS).toBe(5000);
  });

  it('treats a null (cache-miss) snapshot as stale', () => {
    expect(isStale(null)).toBe(true);
  });

  it('is fresh inside the TTL with a live producer', () => {
    const snap = { _ts: 1000, _pid: 1, sampledBy: 'x' };
    expect(isStale(snap as never, { nowMs: 1500, pidAliveFn: () => true })).toBe(false);
  });

  it('is fresh exactly AT the TTL boundary (> is strict)', () => {
    const snap = { _ts: 1000, _pid: 1, sampledBy: 'x' };
    // 3000 - 1000 === 2000, not > 2000 → still fresh
    expect(isStale(snap as never, { nowMs: 3000, pidAliveFn: () => true })).toBe(false);
  });

  it('is stale one ms past the TTL', () => {
    const snap = { _ts: 1000, _pid: 1, sampledBy: 'x' };
    expect(isStale(snap as never, { nowMs: 3001, pidAliveFn: () => true })).toBe(true);
  });

  it('is stale when the producing PID is dead, even with a fresh _ts (crash detection)', () => {
    const snap = { _ts: 1000, _pid: 999, sampledBy: 'x' };
    expect(isStale(snap as never, { nowMs: 1000, pidAliveFn: () => false })).toBe(true);
  });

  it('isLockStale defaults to the 5s dead-man TTL', () => {
    expect(isLockStale({ _ts: 0, _pid: 1 }, { nowMs: 5000, pidAliveFn: () => true })).toBe(false);
    expect(isLockStale({ _ts: 0, _pid: 1 }, { nowMs: 5001, pidAliveFn: () => true })).toBe(true);
  });

  it('isPidAlive reports the current process as alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
});

describe('ADR-321 read side', () => {
  it('returns null on a cold cache without throwing', () => {
    expect(readSnapshot(SESSION_ID, root)).toBeNull();
  });

  it('returns null (not a throw) when the JSON is corrupt', () => {
    const dir = sessionDir();
    writeFileSync(join(root, 'ignore'), '');
    // create dir + garbage file
    writeSnapshot(SESSION_ID, root, { sampledBy: 'x' });
    writeFileSync(snapshotFile(), '{ not json');
    expect(readSnapshot(SESSION_ID, root)).toBeNull();
    expect(dir).toContain(SESSION_ID);
  });
});

describe('ADR-321 write side (schema + round-trip)', () => {
  it('injects _ts/_pid defaults and persists the full schema', () => {
    const ok = writeSnapshot(SESSION_ID, root, {
      sampledBy: 'hook:pre-tool-use',
      foregroundProcessName: 'claude.exe',
      gitStatusSummary: { uncommittedCount: 3, branch: 'main' },
    });
    expect(ok).toBe(true);

    const snap = readSnapshot(SESSION_ID, root)!;
    expect(snap).not.toBeNull();
    expect(typeof snap._ts).toBe('number');
    expect(snap._pid).toBe(process.pid);
    expect(snap.sampledBy).toBe('hook:pre-tool-use');
    expect(snap.foregroundProcessName).toBe('claude.exe');
    expect(snap.gitStatusSummary).toEqual({ uncommittedCount: 3, branch: 'main' });
  });

  it('honors explicit _ts/_pid overrides', () => {
    writeSnapshot(SESSION_ID, root, { sampledBy: 'x', _ts: 42, _pid: 7 });
    const snap = readSnapshot(SESSION_ID, root)!;
    expect(snap._ts).toBe(42);
    expect(snap._pid).toBe(7);
  });

  it('leaves no leftover temp file after the atomic rename', () => {
    writeSnapshot(SESSION_ID, root, { sampledBy: 'x' });
    const entries = readdirSync(sessionDir());
    expect(entries).toContain('foreground-snapshot.json');
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([]);
  });

  it('never yields a torn file under back-to-back writes (last write wins, valid JSON)', () => {
    writeSnapshot(SESSION_ID, root, { sampledBy: 'first', _ts: 111 });
    writeSnapshot(SESSION_ID, root, { sampledBy: 'second', _ts: 222 });

    const entries = readdirSync(sessionDir()).filter((e) => e.startsWith('foreground-snapshot.json'));
    expect(entries).toEqual(['foreground-snapshot.json']); // no .lock, no .tmp leftover

    const snap = readSnapshot(SESSION_ID, root)!;
    expect(snap.sampledBy).toBe('second');
    expect(snap._ts).toBe(222);
  });
});

describe('ADR-321 invalidation (session-start / session-end both delete)', () => {
  it('deleteSnapshot removes the file', () => {
    writeSnapshot(SESSION_ID, root, { sampledBy: 'x' });
    expect(existsSync(snapshotFile())).toBe(true);
    deleteSnapshot(SESSION_ID, root);
    expect(existsSync(snapshotFile())).toBe(false);
  });

  it('deleteSnapshot on an already-absent file is a no-op (no throw)', () => {
    expect(() => deleteSnapshot(SESSION_ID, root)).not.toThrow();
  });
});

describe('ADR-321 claim-lock (concurrent-refresh coordination)', () => {
  it('grants the lock to the first claimer and denies a second live claimer', () => {
    expect(claimLock(SESSION_ID, root)).toBe(true);
    expect(existsSync(lockFile())).toBe(true);
    // Lock held by this (live) process, fresh _ts → second claimer must back off
    // (reads stale snapshot instead of spawning a redundant refresh).
    expect(claimLock(SESSION_ID, root)).toBe(false);
  });

  it('re-grants after release', () => {
    expect(claimLock(SESSION_ID, root)).toBe(true);
    releaseLock(SESSION_ID, root);
    expect(existsSync(lockFile())).toBe(false);
    expect(claimLock(SESSION_ID, root)).toBe(true);
  });

  it('steals a dead-man-expired lock rather than honoring it forever', () => {
    // Pre-plant a stale lock (older than LOCK_TTL_MS) so a crashed holder
    // cannot wedge refreshes. PID is this live process, so only the TTL
    // makes it stale — proves the dead-man path, not the PID path.
    writeSnapshot(SESSION_ID, root, { sampledBy: 'seed' }); // ensure dir exists
    writeFileSync(lockFile(), JSON.stringify({ _ts: Date.now() - (LOCK_TTL_MS + 10_000), _pid: process.pid }));
    expect(claimLock(SESSION_ID, root)).toBe(true);
  });
});

describe('ADR-321 .cjs twin parity (kept in manual sync per the module doc)', () => {
  const require = createRequire(import.meta.url);
  const twin = require(join(process.cwd(), '.claude/helpers/foreground-snapshot.cjs')) as {
    FOREGROUND_SNAPSHOT_TTL_MS: number;
    LOCK_TTL_MS: number;
    writeSnapshot: (id: string, root: string, data: Record<string, unknown>) => boolean;
    readSnapshot: (id: string, root: string) => Record<string, unknown> | null;
    [k: string]: unknown;
  };

  it('exports the same public API as the TS module', () => {
    for (const name of [
      'FOREGROUND_SNAPSHOT_TTL_MS',
      'LOCK_TTL_MS',
      'isPidAlive',
      'isStale',
      'isLockStale',
      'readSnapshot',
      'writeSnapshot',
      'deleteSnapshot',
      'claimLock',
      'releaseLock',
    ]) {
      expect(twin[name], `twin missing export: ${name}`).toBeDefined();
    }
  });

  it('uses identical TTL constants to the TS module', () => {
    expect(twin.FOREGROUND_SNAPSHOT_TTL_MS).toBe(FOREGROUND_SNAPSHOT_TTL_MS);
    expect(twin.LOCK_TTL_MS).toBe(LOCK_TTL_MS);
  });

  it('writes an on-disk schema the TS reader can consume (cross-impl schema parity)', () => {
    expect(twin.writeSnapshot(SESSION_ID, root, { sampledBy: 'daemon' })).toBe(true);
    // TS reader reads what the CJS twin wrote → same path + same schema.
    const viaTs = readSnapshot(SESSION_ID, root)!;
    expect(viaTs.sampledBy).toBe('daemon');
    expect(typeof viaTs._ts).toBe('number');
    expect(typeof viaTs._pid).toBe('number');
  });
});
