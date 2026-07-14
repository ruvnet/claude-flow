/**
 * ADR-322 — daemon becomes ADR-321's snapshot writer.
 *
 * ADR-322 changes only *who holds the pen*: the daemon writes ADR-321's exact
 * file/schema out-of-band with `sampledBy: 'daemon'`, and the hook reader is
 * unchanged. Contracts covered here:
 *  - the daemon's write call (worker-daemon.ts sampleForegroundSnapshot →
 *    writeSnapshot(id, root, { sampledBy: 'daemon', gitStatusSummary })) yields
 *    the ADR-321 schema shape;
 *  - the reader degrades gracefully to null when no daemon has written a cache
 *    (fallback (c): daemon absent / crashed / never started);
 *  - a daemon-written snapshot goes stale immediately when the daemon PID dies
 *    (ADR-321 PID-mismatch rule, made meaningful by the daemon stamping _pid);
 *  - with no daemon, the interim hook-side refresh path is reachable and
 *    single-flighted via the claim lock (ADR-322 (c) === ADR-321 interim mode).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeSnapshot,
  readSnapshot,
  isStale,
  claimLock,
  releaseLock,
} from '../src/session/foreground-snapshot.js';

const ID = 'sess-daemon';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adr322-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ADR-322 daemon writer produces the ADR-321 schema shape', () => {
  it('writes sampledBy="daemon" plus the full snapshot schema the reader expects', () => {
    // Mirrors the exact call the daemon makes in sampleForegroundSnapshot().
    const gitStatusSummary = { uncommittedCount: 2, branch: 'main' };
    const ok = writeSnapshot(ID, root, { sampledBy: 'daemon', gitStatusSummary });
    expect(ok).toBe(true);

    const snap = readSnapshot(ID, root)!;
    expect(snap).not.toBeNull();
    expect(snap.sampledBy).toBe('daemon'); // ADR-322 (e): distinguishes daemon vs hook writes
    expect(typeof snap._ts).toBe('number');
    expect(typeof snap._pid).toBe('number'); // daemon stamps its own long-lived PID
    expect(snap.gitStatusSummary).toEqual(gitStatusSummary);
  });
});

describe('ADR-322 (c) fallback — reader degrades when the daemon has not written', () => {
  it('returns null (no throw) when no snapshot exists (daemon never started / crashed)', () => {
    expect(readSnapshot(ID, root)).toBeNull();
  });

  it('a daemon-written snapshot is stale immediately once the daemon PID is dead', () => {
    writeSnapshot(ID, root, { sampledBy: 'daemon', _ts: 1000, _pid: 424242 });
    const snap = readSnapshot(ID, root)!;
    // Fresh _ts (no TTL expiry), but the writing daemon is gone → crash detection
    // must treat it as stale so a live hook re-derives instead of trusting it.
    expect(isStale(snap, { nowMs: snap._ts, pidAliveFn: () => false })).toBe(true);
  });
});

describe('ADR-322 (c) fallback — hook-side refresh is reachable and single-flighted', () => {
  it('with no daemon writing, one hook claims the refresh and a concurrent hook backs off', () => {
    // No snapshot present (daemon down). The first hook that needs fresh data
    // claims the lock and would spawn its own probe (today\'s behavior); a
    // concurrent hook fails to claim and reads stale rather than double-spawning.
    expect(readSnapshot(ID, root)).toBeNull();
    expect(claimLock(ID, root)).toBe(true);
    expect(claimLock(ID, root)).toBe(false);

    releaseLock(ID, root);
    expect(claimLock(ID, root)).toBe(true);
  });
});
