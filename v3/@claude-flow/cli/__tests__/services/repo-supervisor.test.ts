/**
 * #2661 root-fix — one elected repository-level supervisor.
 *
 * Exactly one daemon per repositoryId should own the recurring AI-worker
 * schedule at a time. Election must never let two live daemons both believe
 * they are supervisor, must take over promptly when the current supervisor
 * dies, and must never downgrade a healthy supervisor just because another
 * process asked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RepoSupervisorRegistry, SUPERVISOR_STALE_MS } from '../../src/services/repo-supervisor.js';

describe('#2661 root-fix — RepoSupervisorRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repo-supervisor-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  const makeRegistry = () => new RepoSupervisorRegistry({ baseDir: dir });

  it('the first daemon to elect for a repository becomes supervisor', async () => {
    const registry = makeRegistry();
    const result = await registry.electOrRenew('repo-1', '/tmp/wt-1');
    expect(result.isSupervisor).toBe(true);
    expect(result.record?.pid).toBe(process.pid);
    expect(registry.isSupervisor('repo-1', '/tmp/wt-1')).toBe(true);
  });

  it('a second (different) worktree does NOT become supervisor while the first is healthy', async () => {
    const registry = makeRegistry();
    await registry.electOrRenew('repo-1', '/tmp/wt-1');

    // Same test process (same real PID) attempting election under a
    // DIFFERENT worktreeRoot — isSupervisor() distinguishes by worktreeRoot,
    // not just PID, so this exercises the "never overwrite a healthy
    // supervisor" branch even though the PID matches.
    const second = await registry.electOrRenew('repo-1', '/tmp/wt-2');
    expect(second.isSupervisor).toBe(false);
    expect(second.record?.worktreeRoot).toBe('/tmp/wt-1'); // unchanged
    expect(registry.isSupervisor('repo-1', '/tmp/wt-1')).toBe(true); // still supervisor
    expect(registry.isSupervisor('repo-1', '/tmp/wt-2')).toBe(false);
  });

  it('renewing as the current supervisor keeps supervisor status (never a downgrade)', async () => {
    const registry = makeRegistry();
    const first = await registry.electOrRenew('repo-1', '/tmp/wt-1');
    expect(first.isSupervisor).toBe(true);

    const renewed = await registry.electOrRenew('repo-1', '/tmp/wt-1');
    expect(renewed.isSupervisor).toBe(true);
    expect(renewed.record!.electedAt).toBe(first.record!.electedAt); // election time unchanged, only heartbeat renews
  });

  it('leases for different repositories elect independently', async () => {
    const registry = makeRegistry();
    const a = await registry.electOrRenew('repo-1', '/tmp/wt-1');
    const b = await registry.electOrRenew('repo-2', '/tmp/wt-2');
    expect(a.isSupervisor).toBe(true);
    expect(b.isSupervisor).toBe(true);
  });

  it('release() clears supervisor status so another worktree can take over immediately', async () => {
    const registry = makeRegistry();
    await registry.electOrRenew('repo-1', '/tmp/wt-1');
    expect(registry.isSupervisor('repo-1', '/tmp/wt-1')).toBe(true);

    await registry.release('repo-1', '/tmp/wt-1');
    expect(registry.isSupervisor('repo-1', '/tmp/wt-1')).toBe(false);
    expect(registry.getRecord('repo-1')).toBeNull();
  });

  it('release() only clears a record this exact worktree owns, never someone else\'s', async () => {
    const registry = makeRegistry();
    await registry.electOrRenew('repo-1', '/tmp/wt-1');
    // A different (non-owning) worktree attempting release must be a no-op.
    await registry.release('repo-1', '/tmp/wt-2');
    expect(registry.isSupervisor('repo-1', '/tmp/wt-1')).toBe(true);
  });

  it('a supervisor record with a dead PID is treated as stale — takeover is allowed', async () => {
    const registry = makeRegistry();
    const supDir = join(dir, 'supervisors');
    mkdirSync(supDir, { recursive: true });
    writeFileSync(
      join(supDir, 'repo-1.json'),
      JSON.stringify({ worktreeRoot: '/tmp/wt-dead', pid: 999999, electedAt: Date.now(), lastHeartbeat: Date.now() }),
    );
    expect(registry.isSupervisor('repo-1', '/tmp/wt-dead')).toBe(false); // dead pid never reads as supervisor

    const result = await registry.electOrRenew('repo-1', '/tmp/wt-live');
    expect(result.isSupervisor).toBe(true);
    expect(result.record?.worktreeRoot).toBe('/tmp/wt-live');
  });

  it('a supervisor record whose heartbeat is older than SUPERVISOR_STALE_MS allows takeover, even with a live PID', async () => {
    const registry = makeRegistry();
    const supDir = join(dir, 'supervisors');
    mkdirSync(supDir, { recursive: true });
    // Use OUR OWN pid so isProcessAlive() would say "alive" — staleness must
    // still win on the heartbeat age alone.
    writeFileSync(
      join(supDir, 'repo-1.json'),
      JSON.stringify({
        worktreeRoot: '/tmp/wt-old',
        pid: process.pid,
        electedAt: Date.now() - SUPERVISOR_STALE_MS - 1000,
        lastHeartbeat: Date.now() - SUPERVISOR_STALE_MS - 1000,
      }),
    );
    const result = await registry.electOrRenew('repo-1', '/tmp/wt-new');
    expect(result.isSupervisor).toBe(true);
    expect(result.record?.worktreeRoot).toBe('/tmp/wt-new');
  });

  it('getRecord() returns null once the record is stale, without mutating anything', async () => {
    const registry = makeRegistry();
    const supDir = join(dir, 'supervisors');
    mkdirSync(supDir, { recursive: true });
    writeFileSync(
      join(supDir, 'repo-1.json'),
      JSON.stringify({ worktreeRoot: '/tmp/wt-old', pid: 999999, electedAt: Date.now(), lastHeartbeat: Date.now() }),
    );
    expect(registry.getRecord('repo-1')).toBeNull();
  });

  it('rejects a symlinked supervisor file (invariant 9) and fails closed (not supervisor)', async () => {
    const registry = makeRegistry();
    const supDir = join(dir, 'supervisors');
    mkdirSync(supDir, { recursive: true });
    const real = join(dir, 'evil.json');
    writeFileSync(real, JSON.stringify({ worktreeRoot: '/x', pid: 1, electedAt: 0, lastHeartbeat: 0 }));
    symlinkSync(real, join(supDir, 'repo-1.json'));

    const result = await registry.electOrRenew('repo-1', '/tmp/wt-1');
    expect(result.isSupervisor).toBe(false); // fails closed, never overwrites/uses a symlinked path
  });
});
