/**
 * Regression guard: the ADR-324 policy lock (`.claude-flow/policy/state.lock`)
 * must not outlive the process that owns it, and must never be taken from a
 * process that is still alive.
 *
 * `acquireLock()` recorded `{ pid, acquiredAt }` but only ever reclaimed a
 * lock by mtime age (LOCK_STALE_MS = 30 s). Every MCP tool call — reads such
 * as `memory_retrieve` included — passes through `authorizeMcpTool()` →
 * `withPolicyTransaction()` → `acquireLock()`. When a server is killed inside
 * a transaction (SIGKILL, OOM, or a default-action SIGTERM) its
 * `finally { release() }` never runs, so each call on a fresh server waited
 * LOCK_WAIT_MS (5 s) and failed with `policy-state-lock-timeout` until the
 * orphan's mtime aged past 30 s.
 *
 * The fix mirrors #1799 (`isPidAlive()` in swarm-tools.ts): a lock whose owner
 * has exited is reclaimed at once. It trusts the pid only when the lock was
 * written by this OS, on this kernel boot and in this PID namespace, treats
 * only ESRCH as dead, reads only small regular files (no symlinks, FIFOs or
 * devices), and answers only for the lock it read, by re-reading its bytes
 * (not a lock a new owner created meanwhile). Every other lock keeps the old
 * mtime rule.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  authorizeMcpTool,
  autoMigratePolicyStateIfNeeded,
  classifyMcpTool,
  withPolicyTransaction,
} from '../src/services/policy-runtime.js';

// Mirror LOCK_WAIT_MS / LOCK_STALE_MS / LOCK_MAX_BYTES in policy-runtime.ts.
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_MAX_BYTES = 1_024;

type LockOwner = Record<string, unknown>;

const roots: string[] = [];
const children: Array<ReturnType<typeof spawn>> = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function signalProbe(pid: number): 'alive' | 'ESRCH' | 'EPERM' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code as 'ESRCH' | 'EPERM';
  }
}

/** A pid that is guaranteed dead: spawn a child, wait for it to exit and be reaped. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid!;
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  expect(signalProbe(pid)).toBe('ESRCH');
  return pid;
}

/** A pid that stays alive (same user) until afterEach kills it. */
function livePid(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  expect(signalProbe(child.pid!)).toBe('alive');
  return child.pid!;
}

/**
 * A migrated project plus the lock exactly as `acquireLock()` writes it in
 * this process, so planted locks can never drift from the real format.
 */
async function setup(): Promise<{ root: string; lock: string; owner: LockOwner }> {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-lock-dead-owner-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  roots.push(root);
  await autoMigratePolicyStateIfNeeded(root);
  const lock = join(root, '.claude-flow', 'policy', 'state.lock');
  let written = '';
  await withPolicyTransaction(root, () => { written = readFileSync(lock, 'utf8'); });
  const owner = JSON.parse(written) as LockOwner;
  expect(owner.pid).toBe(process.pid);
  return { root, lock, owner };
}

/** Leave behind what a crashed owner would: the lock with a fresh mtime. */
function plantLock(lock: string, content: string): void {
  writeFileSync(lock, content);
}

/** The MCP chokepoint every tool call (reads included) passes through. */
function authorizeRead(root: string) {
  return authorizeMcpTool(
    'memory_retrieve',
    { key: 'k', namespace: 'default' },
    { projectRoot: root },
    classifyMcpTool('memory_retrieve'),
  );
}

/**
 * Start an authorization against a lock it must wait for, check it is still
 * pending (and the lock untouched) well after the first poll, then release the
 * lock the way its owner would and check the waiter proceeds. `midway` runs
 * after the first poll, 150 ms in.
 */
async function expectWaitsForOwner(
  root: string,
  lock: string,
  content: string,
  midway?: () => void,
): Promise<void> {
  let settled = false;
  const outcome = authorizeRead(root)
    .then((decision) => ({ decision }), (error: unknown) => ({ error }))
    .finally(() => { settled = true; });
  await sleep(150);
  midway?.();
  await sleep(150);
  expect(settled).toBe(false);
  expect(readFileSync(lock, 'utf8')).toBe(content);
  unlinkSync(lock); // the owner's release()
  expect(await outcome).toMatchObject({ decision: { enforcedOutcome: 'allowed' } });
}

describe('policy state.lock owned by a dead process', () => {
  it('reclaims the lock at once instead of stalling memory_retrieve until policy-state-lock-timeout', async () => {
    const { root, lock, owner } = await setup();
    plantLock(lock, JSON.stringify({ ...owner, pid: await deadPid() }));

    const started = Date.now();
    const decision = await authorizeRead(root);

    expect(decision.enforcedOutcome).toBe('allowed');
    // Before the fix this waited the full LOCK_WAIT_MS and threw.
    expect(Date.now() - started).toBeLessThan(LOCK_WAIT_MS / 5);
    // The transaction released its own lock afterwards.
    expect(existsSync(lock)).toBe(false);
  }, 15_000);

  it('recovers on every call: five crashes in a row cost no timeouts', async () => {
    const { root, lock, owner } = await setup();
    const started = Date.now();
    for (let i = 0; i < 5; i++) {
      plantLock(lock, JSON.stringify({ ...owner, pid: await deadPid(), acquiredAt: Date.now() }));
      expect((await authorizeRead(root)).enforcedOutcome).toBe('allowed');
    }
    expect(Date.now() - started).toBeLessThan(LOCK_WAIT_MS);
  }, 40_000);

  // The re-check after the probe asks "is this still the dead owner's lock?",
  // not "is this the same file?", so it compares the lock's bytes. This pins
  // that portably: the lock is replaced at every probe by a byte-identical
  // file, which `dev`/`ino`/`ctime` reads as a different lock and stalls on
  // forever. The same property is what makes the check sound on filesystems
  // where the stat triple is not an identity — ext4 reuses a freed inode
  // number at once, and before Linux 6.13 two files created in one clock tick
  // share a ctime, so there the triple matches a *different* lock.
  it('reclaims a dead owner whose lock file is replaced by an identical one while it is probed', async () => {
    const { root, lock, owner } = await setup();
    const dead = await deadPid();
    const content = JSON.stringify({ ...owner, pid: dead });
    plantLock(lock, content);
    let replacements = 0;
    const realKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === dead && signal === 0) {
        replacements++;
        unlinkSync(lock);             // a different file (new inode, new ctime)...
        writeFileSync(lock, content); // ...holding the same dead owner
      }
      return realKill(pid, signal);
    }) as typeof process.kill);
    try {
      const started = Date.now();
      expect((await authorizeRead(root)).enforcedOutcome).toBe('allowed');
      expect(replacements).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(LOCK_WAIT_MS / 5);
    } finally {
      kill.mockRestore();
    }
  }, 15_000);
});

describe('policy state.lock that must still be waited for', () => {
  it('a live owner', async () => {
    const { root, lock, owner } = await setup();
    const content = JSON.stringify({ ...owner, pid: livePid() });
    plantLock(lock, content);
    await expectWaitsForOwner(root, lock, content);
  }, 15_000);

  // POSIX only: Windows has no pid 1.
  it.skipIf(process.platform === 'win32')('an owner signal 0 cannot reach (EPERM counts as alive)', async () => {
    const { root, lock, owner } = await setup();
    // pid 1 (init/launchd) always exists. As a non-root user signal 0 to it
    // fails with EPERM, which must mean "alive", not "dead". Under root it
    // simply succeeds, so the assertion below holds either way.
    expect(['alive', 'EPERM']).toContain(signalProbe(1));
    const content = JSON.stringify({ ...owner, pid: 1 });
    plantLock(lock, content);
    await expectWaitsForOwner(root, lock, content);
  }, 15_000);

  it('a new owner that acquired while the previous owner was being probed', async () => {
    const { root, lock, owner } = await setup();
    const dead = await deadPid();
    plantLock(lock, JSON.stringify({ ...owner, pid: dead }));
    const next = JSON.stringify({ ...owner, pid: livePid() });
    let handedOver = false;
    const handOver = () => {
      if (handedOver) return;
      handedOver = true;
      unlinkSync(lock); // the old lock goes away...
      writeFileSync(lock, next); // ...and a new owner creates a fresh one
    };
    // Hand the lock over exactly between the waiter reading it and probing
    // its pid. A waiter that never probes pids gets the same handover midway.
    const realKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === dead && signal === 0) handOver();
      return realKill(pid, signal);
    }) as typeof process.kill);
    try {
      await expectWaitsForOwner(root, lock, next, handOver);
    } finally {
      kill.mockRestore();
    }
  }, 15_000);

  // A pid is only meaningful where it was written. Each of these carries a
  // dead (or impossible) pid, so only the identity/format check keeps it.
  it.each<[string, (owner: LockOwner, dead: number) => string]>([
    ['written on another host', (o, dead) => JSON.stringify({ ...o, pid: dead, host: 'another-host.invalid' })],
    ['written by another OS (a WSL1 owner read from Windows)',
      (o, dead) => JSON.stringify({
        ...o, pid: dead, platform: process.platform === 'linux' ? 'win32' : 'linux',
      })],
    ['written in another PID namespace (bwrap --unshare-pid, containers)',
      (o, dead) => JSON.stringify({ ...o, pid: dead, pidns: 'pid:[0]' })],
    ['written by ruflo <= 3.42.4 (no identity)',
      (_o, dead) => JSON.stringify({ pid: dead, acquiredAt: Date.now() })],
    ['with a non-positive pid', (o) => JSON.stringify({ ...o, pid: -2147483000 })],
    ['with a pid beyond 2^31 - 1', (o) => JSON.stringify({ ...o, pid: 2 ** 31 })],
    // `process.kill` coerces a numeric string, so "1234" would be probed as a
    // pid and answer ESRCH; only the `typeof pid !== 'number'` guard stops it.
    ['with a pid that is not a number', (o, dead) => JSON.stringify({ ...o, pid: `${dead}` })],
    ['larger than LOCK_MAX_BYTES',
      (o, dead) => JSON.stringify({ ...o, pid: dead }).padEnd(LOCK_MAX_BYTES + 1, ' ')],
    ['that is empty (crash between create and write)', () => ''],
  ])('a lock %s', async (_name, build) => {
    const { root, lock, owner } = await setup();
    const content = build(owner, await deadPid());
    plantLock(lock, content);
    await expectWaitsForOwner(root, lock, content);
  }, 15_000);

  // Linux only: `boot` is only written where /proc/sys/kernel/random/boot_id
  // exists. It is what tells two machines apart when they share a filesystem
  // and report the same hostname.
  it.skipIf(process.platform !== 'linux')('a lock written on another kernel boot (same hostname)', async () => {
    const { root, lock, owner } = await setup();
    expect(typeof owner.boot).toBe('string');
    const content = JSON.stringify({ ...owner, pid: await deadPid(), boot: '00000000-0000-0000-0000-000000000000' });
    plantLock(lock, content);
    await expectWaitsForOwner(root, lock, content);
  }, 15_000);
});

describe('policy state.lock mtime fallback', () => {
  it('still reclaims an old lock with no parsable pid', async () => {
    const { root, lock } = await setup();
    plantLock(lock, '{"pid":');
    const old = (Date.now() - LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(lock, old, old);

    const started = Date.now();
    expect((await authorizeRead(root)).enforcedOutcome).toBe('allowed');
    expect(Date.now() - started).toBeLessThan(LOCK_WAIT_MS / 5);
  }, 15_000);

  // POSIX only: needs mkfifo and symlinks. Opening a FIFO for reading blocks
  // the whole event loop until a writer appears, so the lock must never be
  // read through a symlink or from a non-regular file.
  it.skipIf(process.platform === 'win32')('never reads a symlinked FIFO lock, so it cannot block the event loop', async () => {
    const { root, lock } = await setup();
    const fifo = join(root, 'owner.fifo');
    execFileSync('mkfifo', [fifo]);
    symlinkSync(fifo, lock);
    const old = (Date.now() - LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(fifo, old, old);
    // A regression here blocks the event loop inside open(), which no test
    // timeout can interrupt: the run would hang instead of failing. This
    // writer opens the FIFO after 2 s, so a regressed reader unblocks in time
    // to fail the 1 s assertion below. Correct code never opens the FIFO, so
    // the writer stays blocked in its own open() until afterEach kills it.
    children.push(spawn('sh', ['-c', 'sleep 2; : > "$1"', 'sh', fifo], { stdio: 'ignore' }));

    const started = Date.now();
    expect((await authorizeRead(root)).enforcedOutcome).toBe('allowed');
    expect(Date.now() - started).toBeLessThan(1_000);
    // The mtime rule removed the symlink, not its target.
    expect(existsSync(fifo)).toBe(true);
  }, 15_000);
});
