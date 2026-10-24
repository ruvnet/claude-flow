/**
 * Regression guard for ruvnet/ruflo#4462.
 *
 * #2935 stopped a stale .claude-flow/daemon-state.json from overriding an
 * explicit resourceThresholds value, but the maxConcurrent and
 * workerTimeoutMs restores directly below it were left unconditional. A
 * `daemon.maxConcurrent` raised in config.json therefore had no effect while
 * a saved value existed. Precedence for both fields is now
 * constructor arg > config.json > saved state > default.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('#4462 — explicit maxConcurrent / workerTimeoutMs beat daemon-state.json', () => {
  let tempDir: string;

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  function setup(file?: Record<string, unknown>): string {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-4462-test-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
    if (file) writeFileSync(join(tempDir, '.claude-flow', 'config.json'), JSON.stringify(file));
    writeFileSync(
      join(tempDir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({ running: false, config: { maxConcurrent: 2, workerTimeoutMs: 111000 }, workers: {} }),
    );
    return tempDir;
  }

  it('config.json daemon.maxConcurrent / workerTimeoutMs win over saved state', () => {
    const dir = setup({ 'daemon.maxConcurrent': 5, 'daemon.workerTimeoutMs': 222000 });
    const c = new WorkerDaemon(dir).getStatus().config;
    expect(c.maxConcurrent).toBe(5);
    expect(c.workerTimeoutMs).toBe(222000);
  });

  it('constructor args win over saved state', () => {
    const dir = setup();
    const c = new WorkerDaemon(dir, { maxConcurrent: 7, workerTimeoutMs: 333000 }).getStatus().config;
    expect(c.maxConcurrent).toBe(7);
    expect(c.workerTimeoutMs).toBe(333000);
  });

  it('constructor arg wins over config.json', () => {
    const dir = setup({ 'daemon.maxConcurrent': 5 });
    expect(new WorkerDaemon(dir, { maxConcurrent: 7 }).getStatus().config.maxConcurrent).toBe(7);
  });

  it('with no explicit source, saved state is still restored', () => {
    const dir = setup();
    const c = new WorkerDaemon(dir).getStatus().config;
    expect(c.maxConcurrent).toBe(2);
    expect(c.workerTimeoutMs).toBe(111000);
  });

  it('per-field: an explicit maxConcurrent does not block restoring workerTimeoutMs', () => {
    const dir = setup({ 'daemon.maxConcurrent': 5 });
    const c = new WorkerDaemon(dir).getStatus().config;
    expect(c.maxConcurrent).toBe(5);
    expect(c.workerTimeoutMs).toBe(111000);
  });
});
