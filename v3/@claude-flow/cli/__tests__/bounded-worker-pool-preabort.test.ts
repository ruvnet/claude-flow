import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runBoundedPool } from '../src/services/bounded-worker-pool.js';

describe('bounded pool caller cancellation', () => {
  it('does not start any work when the caller signal is already aborted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruflo-pool-preabort-'));
    try {
      const controller = new AbortController();
      controller.abort(new Error('caller cancelled before dispatch'));
      const result = await runBoundedPool(['first', 'second', 'third'].map((id) => ({
        id,
        run: async () => {
          await writeFile(join(directory, id), 'started');
          return id;
        },
      })), { maxConcurrency: 2, signal: controller.signal });

      expect(await readdir(directory)).toEqual([]);
      expect(result.peakConcurrency).toBe(0);
      expect(result.results).toEqual(['first', 'second', 'third'].map((id) => ({
        id,
        status: 'cancelled',
        error: 'Error: caller cancelled before dispatch',
      })));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('still cancels cooperative running work and leaves queued work unstarted', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const started: string[] = [];
    let running!: () => void;
    const ready = new Promise<void>((resolve) => { running = resolve; });
    const pending = runBoundedPool(['running', 'queued'].map((id) => ({
      id,
      run: async (signal: AbortSignal) => {
        started.push(id);
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          running();
        });
        return id;
      },
    })), { maxConcurrency: 1, signal: controller.signal });

    await ready;
    controller.abort(new Error('caller cancelled during execution'));
    const result = await pending;
    expect(started).toEqual(['running']);
    expect(result.results.map(({ status }) => status)).toEqual(['cancelled', 'cancelled']);
    expect(result.peakConcurrency).toBe(1);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('keeps ordinary fulfillment and rejection and detaches the caller listener', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await runBoundedPool([
      { id: 'success', run: async () => 42 },
      { id: 'failure', run: async () => { throw new Error('local task failed'); } },
    ], { maxConcurrency: 1, signal: controller.signal });

    expect(result.results).toEqual([
      { id: 'success', status: 'fulfilled', value: 42 },
      { id: 'failure', status: 'rejected', error: 'local task failed' },
    ]);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(result.results[0]?.status).toBe('fulfilled');
  });
});
