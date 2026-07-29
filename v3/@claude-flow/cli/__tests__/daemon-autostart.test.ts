/**
 * Self-running daemon auto-start — single-instance, opt-out, safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureDaemonRunning,
  isDaemonAlive,
  isRufloProject,
} from '../src/services/daemon-autostart.js';
import { applyChampion } from '../src/config/harness-feedback-applier.js';

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-as-'));
  mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
  writeFileSync(join(cwd, '.claude-flow', 'config.yaml'), 'version: 3\n');
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

  it('does not treat a Claude Code-only .claude directory as Ruflo initialization (#2834)', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = mkdtempSync(join(tmpdir(), 'claude-only-'));
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'settings.json'), '{}');
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r).toEqual({ started: false, reason: 'not a ruflo project' });
    expect(spawned).toBe(0);
    expect(existsSync(join(cwd, '.claude-flow'))).toBe(false);
  });

  it('does not let startup-created policy state authorize daemon auto-start (#2852)', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = mkdtempSync(join(tmpdir(), 'claude-policy-only-'));
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'proven-config.json'),
      JSON.stringify({ championId: `sha256:${'a'.repeat(64)}` }),
    );

    // This mirrors the startup ordering in CLI.run(): applying a shipped
    // champion creates .claude-flow before daemon auto-start is evaluated.
    expect(applyChampion(cwd).applied).toBe(true);
    expect(existsSync(join(cwd, '.claude-flow'))).toBe(true);
    expect(isRufloProject(cwd)).toBe(false);

    let spawned = 0;
    const result = ensureDaemonRunning(cwd, {
      isAlive: () => false,
      spawnFn: () => { spawned++; },
    });
    expect(result).toEqual({ started: false, reason: 'not a ruflo project' });
    expect(spawned).toBe(0);
  });

  it('recognizes only explicit Ruflo markers, not generic state directories', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ruflo-markers-'));
    mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
    expect(isRufloProject(cwd)).toBe(false);

    writeFileSync(join(cwd, '.claude-flow', 'config.json'), '{}');
    expect(isRufloProject(cwd)).toBe(true);
  });

  it('respects a project-local claude-flow.config.json opt-out (survives env vars not propagating)', () => {
    // The real-world gap this closes: a non-interactive shell never sources
    // ~/.bashrc (its own top-of-file `case $- in *i*) ;; *) return;; esac`
    // guard skips it outright), so `export RUFLO_DAEMON_AUTOSTART=0` in one
    // such shell does not carry to the next command's shell. A file on disk
    // has no such gap.
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = project();
    writeFileSync(join(cwd, 'claude-flow.config.json'), JSON.stringify({ daemon: { autostart: false } }));
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(false);
    expect(r.reason).toMatch(/disabled/);
    expect(spawned).toBe(0);
  });

  it('a malformed claude-flow.config.json is treated as not-disabled (fails open on parse errors, not silently blocking)', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = project();
    writeFileSync(join(cwd, 'claude-flow.config.json'), 'this is not valid json {{{');
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(true);
    expect(spawned).toBe(1);
  });

  it('a config file present but without daemon.autostart:false does not disable it', () => {
    delete process.env.RUFLO_DAEMON_AUTOSTART;
    const cwd = project();
    writeFileSync(join(cwd, 'claude-flow.config.json'), JSON.stringify({ funnel: { enabled: false } }));
    let spawned = 0;
    const r = ensureDaemonRunning(cwd, { isAlive: () => false, spawnFn: () => { spawned++; } });
    expect(r.started).toBe(true);
    expect(spawned).toBe(1);
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
