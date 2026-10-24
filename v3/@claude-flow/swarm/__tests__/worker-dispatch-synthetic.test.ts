/**
 * #4410 automation scan: all 12 WorkerDispatchService triggers return static
 * placeholder data. They must identify themselves as synthetic so direct
 * consumers of the published @claude-flow/swarm package and prompt-injection
 * helpers cannot present invented counts as real analysis.
 */

import { describe, expect, it } from 'vitest';
// Import the TS source explicitly: src/workers/worker-dispatch.js is a stale
// tracked build artifact that would otherwise shadow the implementation.
import {
  WorkerDispatchService,
  type WorkerInstance,
  type WorkerTrigger,
} from '../src/workers/worker-dispatch.ts';

const TRIGGERS: WorkerTrigger[] = [
  'ultralearn',
  'optimize',
  'consolidate',
  'predict',
  'audit',
  'map',
  'preload',
  'deepdive',
  'document',
  'refactor',
  'benchmark',
  'testgaps',
];

async function waitForCompletion(
  service: WorkerDispatchService,
  workerId: string,
): Promise<WorkerInstance> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const worker = service.getWorker(workerId);
    if (!worker) throw new Error(`worker ${workerId} disappeared`);
    if (worker.status === 'completed' && worker.result) return worker;
    if (worker.status === 'failed') throw worker.error ?? new Error(`worker ${workerId} failed`);
    if (worker.status === 'cancelled') throw new Error(`worker ${workerId} was cancelled`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  throw new Error(`worker ${workerId} did not complete in time`);
}

describe('WorkerDispatchService synthetic-result disclosure (#4410)', () => {
  it('marks every trigger result as synthetic and labels injected context', async () => {
    const service = new WorkerDispatchService({ maxConcurrent: TRIGGERS.length });
    const sessionId = 'synthetic-disclosure-session';

    const workerIds = await Promise.all(
      TRIGGERS.map(trigger => service.dispatch(trigger, `context for ${trigger}`, sessionId)),
    );
    const workers = await Promise.all(
      workerIds.map(workerId => waitForCompletion(service, workerId)),
    );

    for (const worker of workers) {
      expect(worker.result?.success).toBe(true);
      expect(worker.result?.synthetic).toBe(true);
      expect(worker.result?.syntheticReason).toContain('No live worker executor');
    }

    const context = service.getContextForInjection(sessionId);
    expect(context).toContain('Background Analysis Results');
    expect(context).toContain('(synthetic placeholders, not real analysis)');
    expect(context).toContain('(synthetic, not real analysis)');
  });
});
