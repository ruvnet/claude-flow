/**
 * #2661 root-fix — worktree leases.
 *
 * A lease is how a worktree's daemon says "I'm alive" to the rest of the
 * repository. It must expire (15 min, no heartbeat) so a removed worktree
 * or a crashed daemon becomes ineligible instead of lingering forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkspaceLeaseRegistry, LEASE_TTL_MS } from '../../src/services/workspace-lease.js';

describe('#2661 root-fix — WorkspaceLeaseRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workspace-lease-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  const makeRegistry = () => new WorkspaceLeaseRegistry({ baseDir: dir });

  it('ships the 15-minute TTL from the issue spec', () => {
    expect(LEASE_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('a freshly-heartbeated lease is active', async () => {
    const registry = makeRegistry();
    await registry.heartbeat('repo-1', '/tmp/wt-1');
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(true);
    expect(registry.listActive('repo-1')).toHaveLength(1);
    expect(registry.listActive('repo-1')[0].worktreeRoot).toBe('/tmp/wt-1');
  });

  it('a worktree with no lease is not active', () => {
    const registry = makeRegistry();
    expect(registry.isLeaseActive('repo-1', '/tmp/never-registered')).toBe(false);
  });

  it('multiple worktrees of the same repository all show as active', async () => {
    const registry = makeRegistry();
    await registry.heartbeat('repo-1', '/tmp/wt-1');
    await registry.heartbeat('repo-1', '/tmp/wt-2');
    await registry.heartbeat('repo-1', '/tmp/wt-3');
    const active = registry.listActive('repo-1');
    expect(active).toHaveLength(3);
    expect(active.map((l) => l.worktreeRoot).sort()).toEqual(['/tmp/wt-1', '/tmp/wt-2', '/tmp/wt-3']);
  });

  it('leases for different repositories do not leak into each other', async () => {
    const registry = makeRegistry();
    await registry.heartbeat('repo-1', '/tmp/wt-1');
    await registry.heartbeat('repo-2', '/tmp/wt-2');
    expect(registry.listActive('repo-1')).toHaveLength(1);
    expect(registry.listActive('repo-2')).toHaveLength(1);
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-2')).toBe(false);
  });

  it('release() removes the lease immediately, not just letting it expire', async () => {
    const registry = makeRegistry();
    await registry.heartbeat('repo-1', '/tmp/wt-1');
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(true);
    await registry.release('repo-1', '/tmp/wt-1');
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(false);
  });

  it('a lease older than the 15-minute TTL is no longer active', async () => {
    const registry = makeRegistry();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await registry.heartbeat('repo-1', '/tmp/wt-1');
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:16:00Z')); // 16 minutes later
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(false);
    expect(registry.listActive('repo-1')).toHaveLength(0);
  });

  it('a heartbeat renews the TTL window', async () => {
    const registry = makeRegistry();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await registry.heartbeat('repo-1', '/tmp/wt-1');

    vi.setSystemTime(new Date('2026-01-01T00:14:00Z')); // just under TTL
    await registry.heartbeat('repo-1', '/tmp/wt-1'); // renew

    vi.setSystemTime(new Date('2026-01-01T00:20:00Z')); // 6 min after renewal, 20 after registration
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-1')).toBe(true);
  });

  it('a lease whose owning PID is dead is treated as inactive even within the TTL window', async () => {
    const registry = makeRegistry();
    // Write a lease record directly with a PID that (almost certainly) does
    // not exist, bypassing heartbeat()'s use of the real process.pid.
    const leasesDir = join(dir, 'leases');
    const crypto = await import('crypto');
    const key = crypto.createHash('sha256').update('/tmp/wt-dead').digest('hex').slice(0, 16);
    const { mkdirSync } = await import('fs');
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(
      join(leasesDir, 'repo-1.json'),
      JSON.stringify({ version: 1, leases: { [key]: { worktreeRoot: '/tmp/wt-dead', pid: 999999, registeredAt: Date.now(), lastHeartbeat: Date.now() } } }),
    );
    expect(registry.isLeaseActive('repo-1', '/tmp/wt-dead')).toBe(false);
  });

  it('rejects a symlinked lease file (invariant 9)', async () => {
    const registry = makeRegistry();
    const { mkdirSync } = await import('fs');
    const leasesDir = join(dir, 'leases');
    mkdirSync(leasesDir, { recursive: true });
    const real = join(dir, 'evil.json');
    writeFileSync(real, JSON.stringify({ version: 1, leases: {} }));
    symlinkSync(real, join(leasesDir, 'repo-1.json'));

    // heartbeat() is best-effort and must not throw even though the write
    // path refuses the symlinked target.
    await expect(registry.heartbeat('repo-1', '/tmp/wt-1')).resolves.toBeUndefined();
  });
});
