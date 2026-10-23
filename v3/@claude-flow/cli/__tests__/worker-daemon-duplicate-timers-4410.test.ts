/**
 * #4410 automation scan: `setWorkerEnabled(type, true)` scheduled another
 * timeout on every call without clearing the previous one. `timers` kept only
 * the newest handle, so the older timer leaked, survived `stop()`, and could
 * run the worker again untracked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerDaemon } from '../src/services/worker-daemon.js';

let dir: string;
let daemon: WorkerDaemon;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-daemon-timers-4410-'));
  mkdirSync(join(dir, '.claude-flow', 'logs'), { recursive: true });
  vi.useFakeTimers();
  daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
  (daemon as any).running = true;
});

afterEach(() => {
  (daemon as any).running = false;
  vi.clearAllTimers();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGHUP');
});

describe('WorkerDaemon duplicate worker timers (#4410)', () => {
  it('keeps one pending timer when enable is called repeatedly', () => {
    daemon.setWorkerEnabled('map', true);
    daemon.setWorkerEnabled('map', true);
    daemon.setWorkerEnabled('map', true);

    expect(vi.getTimerCount()).toBe(1);
  });

  it('drops a disabled worker from the deferred queue', () => {
    (daemon as any).pendingWorkers.push('map');
    daemon.setWorkerEnabled('map', false);

    expect((daemon as any).pendingWorkers).not.toContain('map');
  });
});
