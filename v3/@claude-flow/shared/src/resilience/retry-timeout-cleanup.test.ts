import { afterEach, describe, it, expect, vi } from 'vitest';
import { retry } from './retry.js';
afterEach(() => vi.useRealTimers());
describe('retry timeout lifetime', () => {
  it('does not keep a success timer alive after an attempt settles', async () => {
    vi.useFakeTimers();
    const result = await retry(async () => 42, {
      maxAttempts: 1,
      timeout: 30000,
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases timers for rejected attempts without suppressing their errors', async () => {
    vi.useFakeTimers();
    const err = new Error('no');
    const result = await retry(
      async () => {
        throw err;
      },
      { maxAttempts: 1 },
    );
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([err]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('still bounds a pending operation and reports the timeout', async () => {
    vi.useFakeTimers();
    const promise = retry(() => new Promise(() => {}), {
      maxAttempts: 1,
      timeout: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('timed out');
    expect(vi.getTimerCount()).toBe(0);
  });
});
