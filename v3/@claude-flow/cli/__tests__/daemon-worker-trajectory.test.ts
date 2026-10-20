// Daemon worker jobs must feed the self-learning pipeline.
//
// Field report: a daemon ran 135+ map/audit/optimize/consolidate/testgaps/
// harness jobs at "100% success" while trajectoriesRecorded stayed 0 —
// WorkerDaemon.executeWorker() never called the intelligence module.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const recordTrajectory = vi.fn(async () => true);
vi.mock('../src/memory/intelligence.js', () => ({ recordTrajectory }));

import { WorkerDaemon } from '../src/services/worker-daemon.js';

const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException', 'unhandledRejection', 'exit'] as const;
const listeners = new Map(signals.map((s) => [s, process.listeners(s)]));
let dir: string;

beforeEach(() => {
  recordTrajectory.mockClear();
  dir = mkdtempSync(join(tmpdir(), 'daemon-learn-'));
  mkdirSync(join(dir, '.claude-flow', 'logs'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  for (const signal of signals) {
    for (const l of process.listeners(signal)) {
      if (!listeners.get(signal)!.includes(l)) process.removeListener(signal, l);
    }
  }
});

describe('daemon worker jobs record learning trajectories', () => {
  it('records a success trajectory for a completed worker job', async () => {
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    const result = await daemon.triggerWorker('map');
    expect(result.success).toBe(true);
    expect(recordTrajectory).toHaveBeenCalledTimes(1);
    const [steps, verdict] = recordTrajectory.mock.calls[0] as unknown as [Array<Record<string, any>>, string];
    expect(verdict).toBe('success');
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('result');
    expect(steps[0].content).toContain('map');
    expect(steps[0].metadata).toMatchObject({ source: 'worker-daemon', worker: 'map', success: true });
  });

  it('records a failure trajectory when a worker job fails', async () => {
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    vi.spyOn(daemon as any, 'runWorkerLogic').mockRejectedValue(new Error('boom'));
    const result = await daemon.triggerWorker('audit');
    expect(result.success).toBe(false);
    expect(recordTrajectory).toHaveBeenCalledTimes(1);
    const [steps, verdict] = recordTrajectory.mock.calls[0] as unknown as [Array<Record<string, any>>, string];
    expect(verdict).toBe('failure');
    expect(steps[0].content).toContain('boom');
  });

  it('a long worker error is cut before it is stored as learning content', async () => {
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    vi.spyOn(daemon as any, 'runWorkerLogic').mockRejectedValue(new Error('x'.repeat(100_000)));
    await daemon.triggerWorker('audit');
    const [steps] = recordTrajectory.mock.calls[0] as unknown as [Array<Record<string, any>>];
    expect(steps[0].content.length).toBeLessThan(400);
  });

  it('a recording failure never changes the worker result', async () => {
    recordTrajectory.mockRejectedValueOnce(new Error('intelligence down'));
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    const result = await daemon.triggerWorker('map');
    expect(result.success).toBe(true);
  });

  it('RUFLO_DAEMON_NO_LEARN=1 opts out', async () => {
    vi.stubEnv('RUFLO_DAEMON_NO_LEARN', '1');
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false });
    await daemon.triggerWorker('map');
    expect(recordTrajectory).not.toHaveBeenCalled();
  });
});
