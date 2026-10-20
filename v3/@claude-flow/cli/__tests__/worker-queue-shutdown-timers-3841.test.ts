/**
 * #3841 - WorkerQueue.shutdown() must release scheduled retry timers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorkerQueue } from '../src/services/worker-queue.js';

describe('WorkerQueue shutdown releases retry timers (#3841)', () => {
  afterEach(() => vi.useRealTimers());

  async function failedOnce() {
    const q = new WorkerQueue();
    await q.initialize();
    await q.enqueue('audit', {});
    const task = await q.dequeue(['audit']);
    expect(task).not.toBeNull();
    const before = vi.getTimerCount();
    await q.fail(task!.id, 'transient', true); // schedules exactly one retry timer
    expect(vi.getTimerCount()).toBe(before + 1);
    return q;
  }

  it('leaves no pending timers after shutdown', async () => {
    vi.useFakeTimers();
    const q = await failedOnce();
    await q.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not push work into the stopped queue after shutdown', async () => {
    vi.useFakeTimers();
    const q = await failedOnce();
    await q.shutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    // nothing was pushed into the stopped queue's store by a surviving retry callback
    const store = (q as unknown as { store: { popFromQueue(name: string): string | null } }).store;
    expect(store.popFromQueue('claude-flow:queue:audit')).toBeNull();
  });

  it('a retry still fires normally when no shutdown happens', async () => {
    vi.useFakeTimers();
    const q = await failedOnce();
    await vi.advanceTimersByTimeAsync(2_001);
    const t = await q.dequeue(['audit']);
    expect(t?.retryCount).toBe(1);
    await q.fail(t!.id, 'done', false);
    await q.shutdown();
  });
});
