/**
 * Regression guard for ruvnet/ruflo#2661 — scheduled AI workers must be
 * OPT-IN. Merely finding the Claude CLI on PATH must never authorize
 * recurring `claude --print` launches: a default install produces ZERO
 * autonomous Claude launches regardless of how many worktree daemons run.
 *
 * Consent gates (any one):
 *   - `daemon start --headless`            → constructor { aiWorkersEnabled: true }
 *   - `daemon.aiWorkers.enabled: true`     → .claude-flow/config.json
 *   - `RUFLO_DAEMON_AI_WORKERS=1`          → environment
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('#2661 — AI workers are opt-in', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-2661-test-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
    delete process.env.RUFLO_DAEMON_AI_WORKERS;
  });

  afterEach(() => {
    delete process.env.RUFLO_DAEMON_AI_WORKERS;
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  it('defaults to aiWorkersEnabled=false (invariant 1: zero autonomous launches)', () => {
    const daemon = new WorkerDaemon(tempDir);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(false);
  });

  it('never constructs a headless executor without consent — even with claude on PATH', async () => {
    const daemon = new WorkerDaemon(tempDir);
    // Let the (gated) init settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(daemon.isHeadlessAvailable()).toBe(false);
    expect(daemon.getHeadlessExecutor()).toBeNull();
  });

  it('enables via constructor config (the `--headless` flag path)', () => {
    const daemon = new WorkerDaemon(tempDir, { aiWorkersEnabled: true });
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(true);
  });

  it('enables via RUFLO_DAEMON_AI_WORKERS=1', () => {
    process.env.RUFLO_DAEMON_AI_WORKERS = '1';
    const daemon = new WorkerDaemon(tempDir);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(true);
  });

  it('enables via daemon.aiWorkers.enabled in .claude-flow/config.json', () => {
    writeFileSync(
      join(tempDir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.aiWorkers.enabled': true })
    );
    const daemon = new WorkerDaemon(tempDir);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(true);
  });

  it('config.json false beats env opt-in precedence is flag > file > env', () => {
    process.env.RUFLO_DAEMON_AI_WORKERS = '1';
    writeFileSync(
      join(tempDir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.aiWorkers.enabled': false })
    );
    const daemon = new WorkerDaemon(tempDir);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(false);
  });

  it('constructor consent beats config.json opt-out', () => {
    writeFileSync(
      join(tempDir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.aiWorkers.enabled': false })
    );
    const daemon = new WorkerDaemon(tempDir, { aiWorkersEnabled: true });
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(true);
  });

  it('is NOT resurrected from a stale daemon-state.json (consent is never persisted state)', () => {
    // Simulate an old state file written by a daemon that had AI enabled.
    writeFileSync(
      join(tempDir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: { aiWorkersEnabled: true, workers: [] },
        workers: {},
      })
    );
    const daemon = new WorkerDaemon(tempDir);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(false);
  });

  it('a headless-type worker triggered without consent runs the LOCAL path', async () => {
    const daemon = new WorkerDaemon(tempDir);
    // `audit` is a headless-capable worker; without consent it must fall
    // through to the $0 local implementation.
    const result = await daemon.triggerWorker('audit');
    expect(result.success).toBe(true);
    expect((result.output as { mode?: string })?.mode).not.toBe('headless');
  });
});
