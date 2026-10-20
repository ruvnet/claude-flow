/**
 * Regression guard for ruvnet/ruflo#3547 (#1968 follow-up) — `daemon start
 * --workers <list>` must actually select which workers run.
 *
 * #1968 added forwarding of `--workers` to the forked background child's
 * argv, and #1972 added a CI invariant that checks the forwarding line
 * exists — but nothing ever read the flag into `DaemonConfig`, so
 * `WorkerDaemon` always fell back to `DEFAULT_WORKERS` (7 enabled)
 * regardless of what was requested, in both foreground and background
 * mode. This file exercises the actual selection logic on `WorkerDaemon`
 * directly: `config.enabledWorkers` (set by `commands/daemon.ts` from the
 * parsed `--workers` flag) must determine which workers end up `enabled`,
 * and must win over whatever a stale `daemon-state.json` last persisted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function enabledTypes(daemon: WorkerDaemon): string[] {
  return daemon
    .getStatus()
    .config.workers.filter((w) => w.enabled)
    .map((w) => w.type)
    .sort();
}

describe('#3547 — daemon start --workers actually selects workers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-3547-test-'));
    mkdirSync(join(tempDir, '.claude-flow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  it('without an explicit selection, falls back to the full default worker set (pre-existing behavior)', () => {
    const daemon = new WorkerDaemon(tempDir);
    const types = enabledTypes(daemon);
    expect(types.length).toBe(7);
    expect(types).toContain('map');
    expect(types).toContain('audit');
  });

  it('enables ONLY the requested workers when enabledWorkers is set', () => {
    const daemon = new WorkerDaemon(tempDir, { enabledWorkers: ['map', 'audit'] });
    expect(enabledTypes(daemon)).toEqual(['audit', 'map']);
  });

  it('disables every worker not in the selection, including ones DEFAULT_WORKERS turns on', () => {
    const daemon = new WorkerDaemon(tempDir, { enabledWorkers: ['optimize'] });
    const all = daemon.getStatus().config.workers;
    expect(all.find((w) => w.type === 'optimize')?.enabled).toBe(true);
    expect(all.find((w) => w.type === 'consolidate')?.enabled).toBe(false);
    expect(all.find((w) => w.type === 'testgaps')?.enabled).toBe(false);
  });

  it('an unknown worker name in the selection simply enables nothing extra (no match, no crash)', () => {
    const daemon = new WorkerDaemon(tempDir, { enabledWorkers: ['not-a-real-worker'] });
    expect(enabledTypes(daemon)).toEqual([]);
  });

  it('wins over a stale daemon-state.json that previously enabled a different set', () => {
    // Simulate an earlier daemon run that had the full default set enabled,
    // persisted to disk — the exact "stale saved state" scenario #3547
    // calls out: a plain restart must not silently resurrect it over an
    // explicit new --workers selection.
    writeFileSync(
      join(tempDir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: {
          workers: [
            { type: 'map', enabled: true },
            { type: 'audit', enabled: true },
            { type: 'optimize', enabled: true },
            { type: 'consolidate', enabled: true },
            { type: 'testgaps', enabled: true },
            { type: 'backup', enabled: true },
            { type: 'harness', enabled: true },
          ],
        },
        workers: {},
      })
    );
    const daemon = new WorkerDaemon(tempDir, { enabledWorkers: ['map'] });
    expect(enabledTypes(daemon)).toEqual(['map']);
  });

  it('a later plain `daemon start` (no --workers) restores the selection from daemon-state.json (sticky)', () => {
    // First run with an explicit selection; its result is what gets persisted
    // to daemon-state.json by the real save path. We simulate that saved
    // shape directly here rather than depending on saveState()'s timing.
    writeFileSync(
      join(tempDir, '.claude-flow', 'daemon-state.json'),
      JSON.stringify({
        running: false,
        config: {
          workers: [
            { type: 'map', enabled: true },
            { type: 'audit', enabled: false },
            { type: 'optimize', enabled: false },
            { type: 'consolidate', enabled: false },
            { type: 'testgaps', enabled: false },
            { type: 'backup', enabled: false },
            { type: 'harness', enabled: false },
          ],
        },
        workers: {},
      })
    );
    // No enabledWorkers passed this time — a plain restart.
    const daemon = new WorkerDaemon(tempDir);
    expect(enabledTypes(daemon)).toEqual(['map']);
  });
});
