/**
 * Self-running daemon auto-start — single-instance, opt-out, safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDaemonRunning, isDaemonAlive } from '../src/services/daemon-autostart.js';

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-as-'));
  mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
  return cwd;
}

describe('ensureDaemonRunning', () => {
  const saved = process.env.RUFLO_DAEMON_AUTOSTART;
  afterEach(() => { if (saved === undefined) delete process.env.RUFLO_DAEMON_AUTOSTART; else process.env.RUFLO_DAEMON_AUTOSTART = saved; });

  it('starts (spawns) when no daemon is alive in a ruflo project', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = project();
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(true);
    expect(spawned).toBe(1);
  });

  it('is a no-op when a daemon is already alive (single-instance)', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    let spawned = 0;
    const r = ensureDaemonRunning(project(), { isAlive: () => true, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(false);
    expect(r.reason).toMatch(/already running/);
    expect(spawned).toBe(0);
  });

  it('respects the opt-out (RUFLO_DAEMON_AUTOSTART=0)', () => {
    process.env.RUFLO_DAEMON_AUTOSTART = '0';
    let spawned = 0;
    const r = ensureDaemonRunning(project(), { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(false);
    expect(r.reason).toMatch(/disabled/);
    expect(spawned).toBe(0);
  });

  it('does not spawn in a non-ruflo directory', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = mkdtempSync(join(tmpdir(), 'not-ruflo-'));
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(false);
    expect(spawned).toBe(0);
  });
});

describe('isDaemonAlive', () => {
  it('false + cleans a stale pidfile for a dead pid', () => {
    const cwd = project();
    const pidFile = join(cwd, '.claude-flow', 'daemon.pid');
    writeFileSync(pidFile, '999999999'); // almost certainly not a live pid
    expect(isDaemonAlive(cwd)).toBe(false);
    expect(existsSync(pidFile)).toBe(false); // stale file cleaned
  });

  it('false when no pidfile', () => {
    expect(isDaemonAlive(project())).toBe(false);
  });

  it('true for a live pid (our own test process, written as the pid)', () => {
    // Using a DIFFERENT live pid: the test can only prove liveness of a real pid.
    // process.ppid is alive and != our pid, so it should read as alive.
    const cwd = project();
    writeFileSync(join(cwd, '.claude-flow', 'daemon.pid'), String(process.ppid));
    expect(isDaemonAlive(cwd)).toBe(true);
  });
});
