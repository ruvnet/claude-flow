import { afterEach, describe, expect, it } from 'vitest';
import { WorkerQueue } from '../src/services/worker-queue.js';

const fixtures: { queue: WorkerQueue; ids: string[] }[] = [];
function fixture() {
  const entry = { queue: new WorkerQueue(), ids: [] as string[] };
  fixtures.push(entry);
  return entry;
}

afterEach(async () => {
  for (const { queue, ids } of fixtures.splice(0)) {
    for (const id of ids) {
      if ((await queue.getTask(id))?.status === 'processing') {
        await queue.fail(id, 'fixture cleanup', false);
      }
    }
    await queue.shutdown();
  }
});

describe('WorkerQueue cancelled entries', () => {
  it('returns pending work behind multiple cancelled heads in one dequeue', async () => {
    const { queue, ids } = fixture();
    ids.push(await queue.enqueue('audit'), await queue.enqueue('audit'), await queue.enqueue('audit'));
    await queue.cancel(ids[0]!);
    await queue.cancel(ids[1]!);

    const task = await queue.dequeue(['audit']);
    expect(task?.id).toBe(ids[2]);
    expect(task?.status).toBe('processing');
    expect((await queue.getTask(ids[0]!))?.status).toBe('cancelled');
    expect((await queue.getTask(ids[1]!))?.status).toBe('cancelled');
  });

  it('preserves requested worker-type order after skipping a cancelled head', async () => {
    const { queue, ids } = fixture();
    ids.push(await queue.enqueue('audit', {}, { priority: 'critical' }));
    ids.push(await queue.enqueue('audit', {}, { priority: 'critical' }));
    ids.push(await queue.enqueue('optimize', {}, { priority: 'low' }));
    await queue.cancel(ids[0]!);

    expect((await queue.dequeue(['audit', 'optimize']))?.id).toBe(ids[1]);
    expect((await queue.dequeue(['audit', 'optimize']))?.id).toBe(ids[2]);
    expect(await queue.dequeue(['audit', 'optimize'])).toBeNull();
  });

  it('returns null for an exhausted cancelled queue without consuming another type', async () => {
    const { queue, ids } = fixture();
    ids.push(await queue.enqueue('audit'), await queue.enqueue('audit'), await queue.enqueue('optimize'));
    await queue.cancel(ids[0]!);
    await queue.cancel(ids[1]!);

    expect(await queue.dequeue(['audit'])).toBeNull();
    expect((await queue.getTask(ids[2]!))?.status).toBe('pending');
    expect((await queue.dequeue(['optimize']))?.id).toBe(ids[2]);
    expect(await queue.dequeue(['audit'])).toBeNull();
  });

  it('keeps pending priority and FIFO order, assignment, events and completion accounting', async () => {
    const { queue, ids } = fixture();
    const workerId = await queue.registerWorker(['audit']);
    ids.push(await queue.enqueue('audit', {}, { priority: 'low' }));
    ids.push(await queue.enqueue('audit', {}, { priority: 'critical' }));
    ids.push(await queue.enqueue('audit', {}, { priority: 'critical' }));
    const events: string[] = [];
    queue.on('taskDequeued', ({ taskId }) => events.push(taskId));

    for (const id of [ids[1]!, ids[2]!, ids[0]!]) {
      const task = await queue.dequeue(['audit']);
      expect(task?.id).toBe(id);
      expect(task?.workerId).toBe(workerId);
      expect(task?.startedAt).toBeInstanceOf(Date);
      expect(await queue.cancel(id)).toBe(false);
      expect((await queue.getStats()).processing).toBe(1);
      await queue.complete(id, {
        success: true, output: 'local fixture result', durationMs: 0,
        model: 'local-fixture', sandboxMode: 'strict', workerType: 'audit',
        timestamp: new Date(), executionId: id,
      });
      expect((await queue.getResult(id))?.success).toBe(true);
      expect((await queue.getStats()).processing).toBe(0);
    }
    expect(events).toEqual([ids[1], ids[2], ids[0]]);
    expect(await queue.dequeue(['audit'])).toBeNull();
  });
});
