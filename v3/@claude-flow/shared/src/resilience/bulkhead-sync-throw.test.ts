import { describe, it, expect } from 'vitest';
import { Bulkhead } from './bulkhead.js';

describe('queued bulkhead failures', () => {
  it('rejects the throwing task and preserves the previous result and remaining capacity', async () => {
    const bulkhead = new Bulkhead({
      name: 'test',
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeout: 100,
    });
    let release!: (value: string) => void;
    const first = bulkhead.execute(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const failure = new Error('synchronous callback failure');
    const second = bulkhead.execute(() => {
      throw failure;
    });
    const secondResult = second.catch((error) => error);
    const third = bulkhead.execute(async () => 'third');
    release('first');
    await expect(first).resolves.toBe('first');
    expect(await secondResult).toBe(failure);
    await expect(third).resolves.toBe('third');
    await Promise.resolve();
    expect(bulkhead.getStats()).toMatchObject({
      active: 0,
      queued: 0,
      completed: 2,
    });
  });
});
