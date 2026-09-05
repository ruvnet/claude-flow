import { describe, expect, it } from 'vitest';
import { runBoundedPool } from '../src/services/bounded-worker-pool.js';

describe('runBoundedPool', () => {
  it('rejects invalid limits and duplicate task identities', async () => {
    await expect(runBoundedPool([], { maxConcurrency: 0 }))
      .rejects.toThrow('maxConcurrency must be a positive integer');
    await expect(runBoundedPool([
      { id: 'same', run: async () => 1 },
      { id: 'same', run: async () => 2 },
    ], { maxConcurrency: 2 })).rejects.toThrow('duplicate or empty task id');
  });

  it('enforces the hard concurrency cap and preserves input order', async () => {
    let active = 0;
    let observedPeak = 0;
    const result = await runBoundedPool(
      Array.from({ length: 12 }, (_, index) => ({
        id: `candidate-${String(index).padStart(2, '0')}`,
        run: async () => {
          active += 1;
          observedPeak = Math.max(observedPeak, active);
          await new Promise((resolve) => setTimeout(resolve, 5 + ((11 - index) % 3)));
          active -= 1;
          return index;
        },
      })),
      { maxConcurrency: 3 },
    );
    expect(result.peakConcurrency).toBe(3);
    expect(observedPeak).toBe(3);
    expect(result.results.map((item) => item.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `candidate-${String(index).padStart(2, '0')}`),
    );
    expect(result.results.every((item) => item.status === 'fulfilled')).toBe(true);
  });

  it('cancels queued work after timeout without oversubscription', async () => {
    const result = await runBoundedPool(
      Array.from({ length: 6 }, (_, index) => ({
        id: `task-${index}`,
        run: async (signal: AbortSignal) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 100);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(signal.reason);
            }, { once: true });
          });
          return index;
        },
      })),
      { maxConcurrency: 2, timeoutMs: 10 },
    );
    expect(result.peakConcurrency).toBe(2);
    expect(result.results.every((item) => item.status === 'cancelled')).toBe(true);
  });

  it('returns at the wall-time bound when a task ignores cancellation', async () => {
    const started = Date.now();
    const result = await runBoundedPool([{
      id: 'hung-third-party',
      run: async () => new Promise<number>(() => {}),
    }], { maxConcurrency: 1, timeoutMs: 15 });

    expect(Date.now() - started).toBeLessThan(250);
    expect(result.results[0]?.status).toBe('cancelled');
  });
});
