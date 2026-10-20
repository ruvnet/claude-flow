/**
 * Discriminating regression test for the Dream Cycle 2026-10-14 (swarm) fix:
 * TaskOrchestrator.getQueuePosition()'s private `priorityOrder` map used keys
 * `critical/high/normal/low/background`, but `TaskPriority` (shared/types.ts)
 * is `critical/high/medium/low` — there is no `'normal'` key. `createTask()`
 * defaults `priority` to `'medium'` when unspecified, so a default-priority
 * task's lookup (`priorityOrder['medium']`) was always `undefined`, falling
 * back to `0` in the sort comparator — ranking it BELOW even `'low'` (value
 * 2) instead of between `'high'` and `'low'` where it belongs. This only
 * affected the `position` number emitted on the `task:queued` event
 * (`taskQueuedEvent`); real dispatch order via `getNextTask()`/
 * `getPriorityQueue()` uses a separate, already-correct map and was never
 * affected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/shared/events.js';
import { createAgentRegistry } from '../src/coordination/agent-registry.js';
import { createTaskOrchestrator, type ITaskOrchestrator } from '../src/coordination/task-orchestrator.js';
import type { IEventBus } from '../src/shared/events.js';
import type { SwarmEvent } from '../src/shared/types.js';

describe('TaskOrchestrator.getQueuePosition() — priority ranking', () => {
  let eventBus: IEventBus;
  let orchestrator: ITaskOrchestrator;
  let queuedPositions: Map<string, number>;

  beforeEach(() => {
    eventBus = new EventBus();
    const agentRegistry = createAgentRegistry(eventBus);
    orchestrator = createTaskOrchestrator(eventBus, agentRegistry);

    queuedPositions = new Map();
    eventBus.subscribe<{ taskId: string; position: number }>('task:queued', (event: SwarmEvent) => {
      const payload = event.payload as { taskId: string; position: number };
      queuedPositions.set(payload.taskId, payload.position);
    });
  });

  it('ranks a default-priority (medium) task ahead of an already-queued low-priority task', () => {
    const lowTask = orchestrator.createTask({
      type: 'implementation',
      title: 'low priority task',
      description: 'control',
      domain: 'core',
      phase: 'phase-1-foundation',
      priority: 'low',
    });
    orchestrator.queueTask(lowTask.id);
    expect(queuedPositions.get(lowTask.id)).toBe(1);

    // No `priority` given — createTask() defaults to 'medium'.
    const mediumTask = orchestrator.createTask({
      type: 'implementation',
      title: 'default priority task',
      description: 'discriminating case',
      domain: 'core',
      phase: 'phase-1-foundation',
    });
    expect(mediumTask.priority).toBe('medium');
    orchestrator.queueTask(mediumTask.id);

    // Baseline (buggy map): medium falls through to `|| 0`, sorts behind
    // low (value 2) → position 2. Fixed: medium (2) ranks above low (1)
    // → position 1.
    expect(queuedPositions.get(mediumTask.id)).toBe(1);
  });

  it('ranks medium correctly relative to low/critical/high as each is queued in turn', () => {
    // Positions are a snapshot computed at the moment each task is queued
    // (queueTask() -> getQueuePosition() -> emitSync), not retroactively
    // recalculated for already-queued tasks — that enqueue-time-snapshot
    // behavior is pre-existing and unchanged by this fix. Queuing in
    // low -> critical -> high -> medium order isolates medium's own
    // ranking: baseline (buggy map) has medium fall through to `|| 0`,
    // landing it last (position 4) behind every other priority including
    // the already-queued low; fixed, it correctly lands between high and
    // low (position 3). low/critical/high's positions are identical
    // between baseline and fixed — only medium's is expected to differ.
    const specs: Array<{ title: string; priority: 'low' | 'critical' | 'high' | 'medium' }> = [
      { title: 'low', priority: 'low' },
      { title: 'critical', priority: 'critical' },
      { title: 'high', priority: 'high' },
      { title: 'medium', priority: 'medium' },
    ];

    const ids: Record<string, string> = {};
    for (const spec of specs) {
      const task = orchestrator.createTask({
        type: 'implementation',
        title: spec.title,
        description: 'ranking case',
        domain: 'core',
        phase: 'phase-1-foundation',
        priority: spec.priority,
      });
      ids[spec.priority] = task.id;
      orchestrator.queueTask(task.id);
    }

    expect(queuedPositions.get(ids.low)).toBe(1);
    expect(queuedPositions.get(ids.critical)).toBe(1);
    expect(queuedPositions.get(ids.high)).toBe(2);
    expect(queuedPositions.get(ids.medium)).toBe(3);
  });

  it('leaves real dispatch order (getNextTask) unaffected — already correct, untouched by this fix', () => {
    const low = orchestrator.createTask({
      type: 'implementation', title: 'low', description: 'd', domain: 'core',
      phase: 'phase-1-foundation', priority: 'low',
    });
    const medium = orchestrator.createTask({
      type: 'implementation', title: 'medium', description: 'd', domain: 'core',
      phase: 'phase-1-foundation', priority: 'medium',
    });
    orchestrator.queueTask(low.id);
    orchestrator.queueTask(medium.id);

    const next = orchestrator.getNextTask();
    expect(next?.id).toBe(medium.id);
  });
});
