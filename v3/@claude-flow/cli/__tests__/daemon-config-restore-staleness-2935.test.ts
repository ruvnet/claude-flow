/**
 * Regression guard for ruvnet/ruflo#2935.
 *
 * A resourceThresholds value set explicitly in .claude-flow/config.json is
 * just as much a deliberate override as a constructor arg — but
 * initializeWorkerStates()'s stale-state restoration guard only ever
 * checked the constructor arg (`originalConfig`), so a config.json override
 * (e.g. working around the Darwin os.freemem() skew with
 * `minFreeMemoryPercent: 0`) silently lost to whatever a stale
 * .claude-flow/daemon-state.json had persisted from a previous run. Same
 * bug class as #2661 (aiWorkersEnabled), fixed the same way: exclude the
 * field from restoration once an explicit source (constructor OR file) set
 * it.
 *
 * Also covers #2935's secondary diagnostic bug: readDaemonConfigFromFile()
 * used to log "Daemon config loaded from ..." via this.log() while running
 * from the constructor BEFORE this.config exists, so the log() call threw
 * inside its own try/catch and the line never reached daemon.log.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('#2935 — config.json resourceThresholds override survives a stale daemon-state.json', () => {
  let tempDir: string;

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  function setup(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-2935-test-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
    return tempDir;
  }

  it('a config.json minFreeMemoryPercent override is NOT overwritten by stale daemon-state.json', () => {
    const dir = setup();
    writeFileSync(
      join(dir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.resourceThresholds.minFreeMemoryPercent': 0 }),
    );
    // Simulate a daemon-state.json persisted by an earlier run BEFORE the
    // override existed — this is exactly the reporter's 13-day-stale case.
    writeFileSync(
      join(dir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: { resourceThresholds: { maxCpuLoad: 8, minFreeMemoryPercent: 5 } },
        workers: {},
      }),
    );

    const daemon = new WorkerDaemon(dir);
    expect(daemon.getStatus().config.resourceThresholds.minFreeMemoryPercent).toBe(0);
  });

  it('a maxCpuLoad NOT set in config.json can still restore from daemon-state.json (per-field granularity)', () => {
    const dir = setup();
    writeFileSync(
      join(dir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.resourceThresholds.minFreeMemoryPercent': 0 }),
    );
    writeFileSync(
      join(dir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: { resourceThresholds: { maxCpuLoad: 8, minFreeMemoryPercent: 5 } },
        workers: {},
      }),
    );

    const daemon = new WorkerDaemon(dir);
    const rt = daemon.getStatus().config.resourceThresholds;
    // minFreeMemoryPercent: file override wins (0, not the stale 5).
    expect(rt.minFreeMemoryPercent).toBe(0);
    // maxCpuLoad: no explicit source set it, so restoring the saved value
    // is still correct behavior — unlike an all-or-nothing gate, this field
    // isn't collateral damage from the other field's override.
    expect(rt.maxCpuLoad).toBe(8);
  });

  it('constructor arg for resourceThresholds still beats stale daemon-state.json (existing #originalConfig behavior)', () => {
    const dir = setup();
    writeFileSync(
      join(dir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: { resourceThresholds: { maxCpuLoad: 8, minFreeMemoryPercent: 5 } },
        workers: {},
      }),
    );

    const daemon = new WorkerDaemon(dir, { resourceThresholds: { maxCpuLoad: 3, minFreeMemoryPercent: 1 } });
    const rt = daemon.getStatus().config.resourceThresholds;
    expect(rt.maxCpuLoad).toBe(3);
    expect(rt.minFreeMemoryPercent).toBe(1);
  });

  it('logs "Daemon config loaded from" to daemon.log once this.config exists (was silently swallowed)', () => {
    const dir = setup();
    writeFileSync(
      join(dir, '.claude-flow', 'config.json'),
      JSON.stringify({ 'daemon.resourceThresholds.minFreeMemoryPercent': 0 }),
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const daemon = new WorkerDaemon(dir);
    const logContent = readFileSync(join(dir, '.claude-flow', 'logs', 'daemon.log'), 'utf-8');
    expect(logContent).toMatch(/Daemon config loaded from .*config\.json/);
  });
});
