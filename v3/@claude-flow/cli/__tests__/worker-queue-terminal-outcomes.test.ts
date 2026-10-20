import { afterEach, describe, it, expect } from 'vitest';
import { WorkerQueue } from '../src/services/worker-queue.js';
import type { HeadlessExecutionResult } from '../src/services/headless-worker-executor.js';
const queues: WorkerQueue[] = [];
afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.shutdown();
});
function create() {
  const queue = new WorkerQueue();
  queues.push(queue);
  return queue;
}
const result: HeadlessExecutionResult = {
  success: true,
  output: 'done',
  durationMs: 1,
  model: 'test',
  sandboxMode: 'strict',
  workerType: 'audit',
  timestamp: new Date(),
  executionId: 'test',
};
describe('settled worker task outcomes', () => {
  it('does not overwrite a terminal failure with a late success', async () => {
    const queue = create();
    const id = await queue.enqueue('audit');
    await queue.dequeue(['audit']);
    await queue.fail(id, 'shutdown', false);
    await queue.complete(id, result);
    expect((await queue.getTask(id))?.status).toBe('failed');
    expect(await queue.getResult(id)).toBeNull();
  });
  it('does not requeue an already completed task after a duplicate failure', async () => {
    const queue = create();
    const id = await queue.enqueue('audit');
    await queue.dequeue(['audit']);
    await queue.complete(id, result);
    await queue.fail(id, 'late failure');
    expect((await queue.getTask(id))?.status).toBe('completed');
    expect(await queue.getResult(id)).toBe(result);
    expect((await queue.getStats()).pending).toBe(0);
  });
  it('preserves a cancelled task when a delayed outcome arrives', async () => {
    const queue = create();
    const id = await queue.enqueue('audit');
    await queue.cancel(id);
    await queue.complete(id, result);
    await queue.fail(id, 'late failure', false);
    expect((await queue.getTask(id))?.status).toBe('cancelled');
    expect(await queue.getResult(id)).toBeNull();
  });
});
