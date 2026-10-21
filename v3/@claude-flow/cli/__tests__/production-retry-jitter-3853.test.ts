/**
 * #3853 - withRetry must never wait longer than maxDelayMs, jitter included.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry, type RetryStrategy } from '../src/production/retry.js';

const STRATEGIES: RetryStrategy[] = ['exponential', 'linear', 'constant', 'fibonacci'];

describe('withRetry jitter honours maxDelayMs (#3853)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  for (const strategy of STRATEGIES) {
    it(`${strategy}: high jitter sample never exceeds the cap`, async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
      let calls = 0;
      const seen: number[] = [];
      const p = withRetry(
        async () => {
          if (++calls < 2) throw new Error('boom');
          return 'ok';
        },
        {
          maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 100, jitter: 0.5,
          onRetry: (_e, _a, d) => seen.push(d),
        },
        strategy,
      );
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toEqual([100]); // checked before the wait so a regression fails fast, not by hanging
      await vi.advanceTimersByTimeAsync(100);
      const r = await p;
      expect(r.success).toBe(true);
      expect(r.retryHistory.map(h => h.delayMs)).toEqual([100]);
    });
  }

  it('negative jitter still reduces the delay below the cap', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const seen: number[] = [];
    let calls = 0;
    const p = withRetry(
      async () => { if (++calls < 2) throw new Error('x'); return 1; },
      { initialDelayMs: 100, maxDelayMs: 100, jitter: 0.5, onRetry: (_e, _a, d) => seen.push(d) },
      'constant',
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([50]);
    await vi.advanceTimersByTimeAsync(100);
    await p;
  });

  it('delay below the cap keeps its jitter (cap not applied early)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const seen: number[] = [];
    let calls = 0;
    const p = withRetry(
      async () => { if (++calls < 2) throw new Error('x'); return 1; },
      { initialDelayMs: 100, maxDelayMs: 1000, jitter: 0.5, onRetry: (_e, _a, d) => seen.push(d) },
      'constant',
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([150]);
    await vi.advanceTimersByTimeAsync(200);
    await p;
  });
});
