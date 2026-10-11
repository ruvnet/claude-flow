import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskManager } from '../src/task-manager.js';
import type { ILogger } from '../src/types.js';
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let manager: TaskManager;
beforeEach(() => { manager = new TaskManager(logger, { maxConcurrentTasks: 1, taskTimeout: 1000 }); });
afterEach(() => { manager.destroy(); vi.useRealTimers(); });

it('reports cancellation rather than a result when an aborted executor resolves normally', async () => {
  let finish!: (value: string) => void;
  let signal!: AbortSignal;
  const id = manager.createTask(async (_progress, received) => {
    signal = received;
    return new Promise<string>(resolve => { finish = resolve; });
  });
  const completed = vi.fn();
  const cancelled = vi.fn();
  manager.on('task:completed', completed);
  manager.on('task:cancelled', cancelled);
  const waiting = manager.waitForTask(id);
  expect(manager.cancelTask(id, 'operator cancelled')).toBe(true);
  expect(signal.aborted).toBe(true);
  finish('late success');
  expect(await waiting).toMatchObject({ state: 'cancelled' });
  expect(manager.getTask(id)?.result).toBeUndefined();
  expect(completed).not.toHaveBeenCalled();
  expect(cancelled).toHaveBeenCalledTimes(1);
});
it('holds the concurrency slot until the aborted executor settles', async () => {
  let finish!: () => void;
  const id = manager.createTask(() => new Promise(resolve => { finish = () => resolve('late'); }));
  manager.cancelTask(id);
  const next = vi.fn(async () => 'next');
  const nextId = manager.createTask(next);
  expect(next).not.toHaveBeenCalled();
  finish();
  expect(await manager.waitForTask(id)).toMatchObject({ state: 'cancelled' });
  expect(await manager.waitForTask(nextId)).toMatchObject({ state: 'completed', result: 'next' });
  expect(next).toHaveBeenCalledTimes(1);
});
it('a task timeout cannot be replaced by a subsequently resolved success', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const id = manager.createTask(() => new Promise(resolve => { finish = () => resolve('late'); }));
  const waiting = manager.waitForTask(id, 2000);
  await vi.advanceTimersByTimeAsync(1000);
  finish();
  expect(await waiting).toMatchObject({ state: 'cancelled' });
  expect(manager.getTask(id)?.result).toBeUndefined();
});
it('still returns successful results when no cancellation was requested', async () => {
  const id = manager.createTask(async () => 'result');
  expect(await manager.waitForTask(id)).toMatchObject({ state: 'completed', result: 'result' });
  expect(manager.cancelTask(id)).toBe(false);
});
it('retains the abort-aware executor rejection path', async () => {
  const id = manager.createTask((_progress, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('executor cancelled')), { once: true });
  }));
  const waiting = manager.waitForTask(id);
  manager.cancelTask(id);
  expect(await waiting).toMatchObject({ state: 'cancelled' });
});
