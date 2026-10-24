/**
 * Cancelling a running WorkerDispatchService worker must be terminal.
 *
 * The placeholder executors cannot be aborted mid-flight, so cancel() marks the
 * worker cancelled and keeps its concurrency slot until the executor settles.
 * Previously executeWorker() unconditionally overwrote the status with
 * 'completed' and emitted worker:completed after cancel(), and cancel()
 * released the slot immediately so a second worker could exceed maxConcurrent.
 */

import { describe, expect, it } from 'vitest';
// Import the TS source explicitly: src/workers/worker-dispatch.js is a stale
// tracked build artifact that would otherwise shadow the implementation.
import { WorkerDispatchService } from '../src/workers/worker-dispatch.ts';

describe('WorkerDispatchService running-worker cancellation', () => {
  it('keeps a cancelled worker cancelled and does not release its slot early', async () => {
    const service = new WorkerDispatchService({ maxConcurrent: 1 });
    const completed: string[] = [];
    const failed: string[] = [];
    const cancelled: string[] = [];

    service.on('worker:completed', ({ workerId }: { workerId: string }) => completed.push(workerId));
    service.on('worker:failed', ({ workerId }: { workerId: string }) => failed.push(workerId));
    service.on('worker:cancelled', ({ workerId }: { workerId: string }) => cancelled.push(workerId));

    let firstStartedResolve!: (workerId: string) => void;
    const firstStarted = new Promise<string>(resolve => {
      firstStartedResolve = resolve;
    });
    service.once('worker:started', ({ workerId }: { workerId: string }) => firstStartedResolve(workerId));

    const sessionId = 'cancel-running-session';
    const firstId = await service.dispatch('ultralearn', 'first', sessionId);
    expect(await firstStarted).toBe(firstId);

    const cancelledAt = Date.now();
    expect(await service.cancel(firstId)).toBe(true);
    expect(service.getWorker(firstId)?.status).toBe('cancelled');

    // maxConcurrent is 1. The second worker must not start until the cancelled
    // worker's in-flight executor has settled; baseline released the slot in
    // cancel() and started this one immediately.
    let secondStartedResolve!: (startedAt: number) => void;
    const secondStarted = new Promise<number>(resolve => {
      secondStartedResolve = resolve;
    });
    service.once('worker:started', ({ workerId }: { workerId: string }) => {
      if (workerId !== firstId) secondStartedResolve(Date.now());
    });

    const secondId = await service.dispatch('preload', 'second', sessionId);
    const secondDone = new Promise<void>(resolve => {
      service.once('worker:completed', ({ workerId }: { workerId: string }) => {
        if (workerId === secondId) resolve();
      });
    });

    const secondStartedAt = await secondStarted;
    expect(secondStartedAt - cancelledAt).toBeGreaterThanOrEqual(10);
    await secondDone;

    const first = service.getWorker(firstId);
    expect(first?.status).toBe('cancelled');
    expect(first?.phase).toBe('cancelled');
    expect(first?.result).toBeUndefined();
    expect(completed).not.toContain(firstId);
    expect(failed).not.toContain(firstId);
    expect(cancelled).toContain(firstId);
  });
});
