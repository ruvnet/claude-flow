import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PerformanceTestUtils,
  TestCleanup,
  TimeoutError,
  createTestCleanupScope,
} from './utils/test-cleanup.js';

describe('TestCleanup (#120)', () => {
  let cleanup: TestCleanup;

  beforeEach(() => {
    cleanup = new TestCleanup();
  });

  afterEach(async () => {
    await cleanup.cleanup();
  });

  it('registers and clears pending timers and intervals without firing after cleanup', async () => {
    let timerFired = false;
    let intervalTicks = 0;

    cleanup.setTimeout(() => {
      timerFired = true;
    }, 80);

    cleanup.setInterval(() => {
      intervalTicks += 1;
    }, 40);

    expect(cleanup.getStats().timers).toBe(1);
    expect(cleanup.getStats().intervals).toBe(1);

    await cleanup.cleanup();

    expect(cleanup.getStats().timers).toBe(0);
    expect(cleanup.getStats().intervals).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(timerFired).toBe(false);
    expect(intervalTicks).toBe(0);
  });

  it('awaits both resolved and rejected promises in Promise.allSettled during cleanup', async () => {
    const events: string[] = [];

    const resolvedPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        events.push('resolved');
        resolve('ok');
      }, 20);
    });

    const rejectedPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        events.push('rejected');
        reject(new Error('expected test rejection'));
      }, 25);
    });

    cleanup.registerPromise(resolvedPromise);
    cleanup.registerPromise(rejectedPromise);

    const results = await cleanup.cleanup();

    expect(events).toEqual(['resolved', 'rejected']);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    expect(cleanup.getStats().promises).toBe(0);
  });

  it('executes registered disposables in LIFO order and continues on error', async () => {
    const order: string[] = [];

    cleanup.registerDisposable(() => {
      order.push('first');
    });
    cleanup.registerDisposable(async () => {
      order.push('second-throws');
      throw new Error('teardown error');
    });
    cleanup.registerDisposable(() => {
      order.push('third');
    });

    await cleanup.cleanup();
    expect(order).toEqual(['third', 'second-throws', 'first']);
  });

  it('withTimeout resolves fast operations and rejects slow operations with TimeoutError', async () => {
    const fast = await cleanup.withTimeout(async () => 'done', 200, 'fast-op');
    expect(fast).toBe('done');
    expect(cleanup.getStats().timers).toBe(0);

    await expect(
      cleanup.withTimeout(
        () => new Promise((resolve) => cleanup.setTimeout(() => resolve('late'), 200)),
        30,
        'slow-op',
      ),
    ).rejects.toThrow(TimeoutError);
  });

  it('createTestCleanupScope provides an isolated scope and teardown helper', async () => {
    const scope = createTestCleanupScope();
    let disposed = false;
    scope.cleanup.registerDisposable(() => {
      disposed = true;
    });

    await scope.teardown();
    expect(disposed).toBe(true);
  });
});

describe('PerformanceTestUtils (#120)', () => {
  it('measureAsync records elapsed duration and returns the operation result', async () => {
    const { result, durationMs } = await PerformanceTestUtils.measureAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return 42;
    });

    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(10);
  });

  it('assertWithinBudget succeeds within budget and throws when budget is exceeded', async () => {
    const ok = await PerformanceTestUtils.assertWithinBudget(async () => 'fast', 250, 'fast-task');
    expect(ok.result).toBe('fast');

    await expect(
      PerformanceTestUtils.assertWithinBudget(
        () => new Promise((resolve) => setTimeout(resolve, 60)),
        10,
        'slow-task',
      ),
    ).rejects.toThrow(/Performance budget exceeded/);
  });

  it('benchmark computes min, max, mean, and p95 latency across iterations', async () => {
    const stats = await PerformanceTestUtils.benchmark(
      'noop-async',
      async (i) => i * 2,
      { iterations: 5, warmupIterations: 1 },
    );

    expect(stats.name).toBe('noop-async');
    expect(stats.iterations).toBe(5);
    expect(stats.minMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxMs).toBeGreaterThanOrEqual(stats.minMs);
    expect(stats.p95Ms).toBeGreaterThanOrEqual(stats.minMs);
  });
});
