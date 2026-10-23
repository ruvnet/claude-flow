/**
 * #4410 automation scan: the auto-restart backoff timer was a local closure
 * variable, so stop() could not cancel it and the daemon restarted ~1s later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonManager } from '../daemons/index.js';

let manager: DaemonManager;

beforeEach(() => {
  vi.useFakeTimers();
  manager = new DaemonManager({ autoRestart: true, maxRestartAttempts: 3 });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('DaemonManager restart backoff cancellation (#4410)', () => {
  it('does not restart after stop() cancels the pending backoff', async () => {
    let attempts = 0;
    manager.register(
      { name: 'flaky', interval: 60_000, enabled: true },
      async () => {
        attempts++;
        throw new Error('boom');
      },
    );

    await manager.start('flaky');
    expect(attempts).toBe(1);
    expect(manager.getState('flaky')?.failureCount).toBe(1);

    await manager.stop('flaky');
    expect(manager.isRunning('flaky')).toBe(false);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(attempts).toBe(1);
    expect(manager.getState('flaky')?.failureCount).toBe(1);
    expect(manager.isRunning('flaky')).toBe(false);
  });
});
