import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentPool, type AgentPool } from '../src/agent-pool.js';
import { createUnifiedSwarmCoordinator, type UnifiedSwarmCoordinator } from '../src/unified-coordinator.js';
import type { MessageBus } from '../src/message-bus.js';
import type { AgentPoolConfig } from '../src/types.js';

let pools: AgentPool[];
let coordinator: UnifiedSwarmCoordinator | undefined;
beforeEach(() => { pools = []; coordinator = undefined; });
afterEach(async () => {
  await coordinator?.shutdown();
  for (const pool of pools) await pool.shutdown();
});
async function pool(config: Partial<AgentPoolConfig> = {}) {
  const result = createAgentPool({ minSize: 1, maxSize: 1, ...config });
  pools.push(result);
  await result.initialize();
  return result;
}
const ownedTask = { id: 'active-task', swarmId: 'fixture', sequence: 1, priority: 'normal' as const };
const task = () => ({
  type: 'coding' as const, name: 'Shared reservation', description: '',
  priority: 'normal' as const, dependencies: [], input: {}, timeoutMs: 5000,
  retries: 0, maxRetries: 0, metadata: {},
});

describe('AgentPool shared reservation state', () => {
  it('does not lease a worker marked busy by another coordinator path', async () => {
    const target = await pool();
    const [agent] = target.getAllAgents();
    agent.status = 'busy';
    expect(target.getAvailableCount()).toBe(0);
    expect(target.getBusyCount()).toBe(1);
    expect(target.getUtilization()).toBe(1);
    expect(target.getAvailableAgents()).toEqual([]);
    expect(target.getBusyAgents()).toEqual([agent]);
    expect(target.getState()).toMatchObject({ availableAgents: [], busyAgents: [agent.id.id] });
    expect(await target.acquire()).toBeUndefined();
  });

  it('treats an idle worker with an outstanding task as reserved', async () => {
    const target = await pool();
    const [agent] = target.getAllAgents();
    agent.currentTask = ownedTask;
    expect(await target.acquire()).toBeUndefined();
    expect(agent.currentTask).toBe(ownedTask);
    expect(target.getPoolStats()).toMatchObject({ available: 0, busy: 1 });
  });

  it('respects an existing reservation when adding a shared worker', async () => {
    const donor = await pool();
    const agent = (await donor.acquire())!;
    agent.currentTask = ownedTask;
    const target = await pool({ minSize: 0 });
    await target.add(agent);
    expect(target.getPoolStats()).toMatchObject({ available: 0, busy: 1 });
    expect(await target.acquire()).toBeUndefined();
  });

  it('does not scale down a shared worker that acquired a task elsewhere', async () => {
    const donor = await pool();
    const [agent] = donor.getAllAgents();
    const target = await pool({ minSize: 0 });
    await target.add(agent);
    agent.currentTask = ownedTask;
    await target.scale(-1);
    expect(target.getTotalCount()).toBe(1);
    expect(agent.currentTask).toBe(ownedTask);
  });

  it.each(['error', 'terminated', 'initializing'] as const)('does not lease a worker whose status became %s', async status => {
    const target = await pool();
    const [agent] = target.getAllAgents();
    agent.status = status;
    expect(target.getAvailableCount()).toBe(0);
    expect(target.getBusyCount()).toBe(0);
    expect(await target.acquire()).toBeUndefined();
  });

  it('retains existing available-worker order and makes a released worker reusable', async () => {
    const target = await pool({ minSize: 2, maxSize: 2 });
    const [first, second] = target.getAllAgents();
    expect((await target.acquire())!.id.id).toBe(first.id.id);
    first.currentTask = ownedTask;
    await target.release(first.id.id);
    expect(first.currentTask).toBeUndefined();
    expect((await target.acquire())!.id.id).toBe(second.id.id);
    expect(target.getAvailableAgents()).toEqual([first]);
  });

  it('routes domain work to the actual idle canonical worker and observes global completion release', async () => {
    coordinator = createUnifiedSwarmCoordinator();
    await coordinator.initialize();
    const pending = await coordinator.submitTask(task());
    const first = await coordinator.spawnAgent({ type: 'coder' });
    const second = await coordinator.spawnAgent({ type: 'coder' });
    const running = await coordinator.submitTask(task());
    const chosen = await coordinator.assignTaskToDomain(pending, first.domain);
    expect(chosen).toBe(second.agentId);
    expect(coordinator.getTask(running)!.assignedTo!.id).toBe(first.agentId);
    expect(coordinator.getAgent(second.agentId)!.currentTask!.id).toBe(pending);
    const transport = (coordinator as unknown as { messageBus: MessageBus }).messageBus;
    await transport.send({
      type: 'task_complete', from: first.agentId, to: first.agentId,
      priority: 'normal', requiresAck: false, ttlMs: 5000,
      payload: { taskId: running, result: 'done' },
    });
    for (let i = 0; i < 4; i++) await new Promise<void>(setImmediate);
    expect(coordinator.getTask(running)!.status).toBe('completed');
    expect(coordinator.getDomainPool(first.domain)!.getAvailableAgents().map(agent => agent.id.id))
      .toContain(first.agentId);
  });

  it('does not treat a foreign-domain owner as a reservation in the requested domain', async () => {
    coordinator = createUnifiedSwarmCoordinator();
    await coordinator.initialize();
    const first = await coordinator.spawnAgent({ type: 'coder' });
    const second = await coordinator.spawnAgent({ type: 'coder', domain: 'security' });
    const id = await coordinator.submitTask(task());
    expect(coordinator.getTask(id)!.assignedTo!.id).toBe(first.agentId);
    expect(await coordinator.assignTaskToDomain(id, 'security')).toBe(second.agentId);
    // Retargeting does not prove that the previous worker stopped execution.
    expect(coordinator.getAgent(first.agentId)).toMatchObject({ status: 'busy', currentTask: { id } });
    expect(coordinator.getAgent(second.agentId)).toMatchObject({ status: 'busy', currentTask: { id } });
    expect(coordinator.getDomainPool(first.domain)!.getAvailableAgents().map(agent => agent.id.id))
      .not.toContain(first.agentId);
    expect(coordinator.getMetrics().completedTasks).toBe(0);
    expect(coordinator.getAgent(first.agentId)!.metrics.tasksCompleted).toBe(0);
  });

  it('does not globally reassign a worker whose status report says idle while it still owns a task', async () => {
    coordinator = createUnifiedSwarmCoordinator();
    await coordinator.initialize();
    const { agentId } = await coordinator.spawnAgent({ type: 'coder' });
    const first = await coordinator.submitTask(task());
    const transport = (coordinator as unknown as { messageBus: MessageBus }).messageBus;
    await transport.send({
      type: 'status_update', from: agentId, to: agentId, priority: 'normal',
      requiresAck: false, ttlMs: 5000, payload: { status: 'idle' },
    });
    for (let i = 0; i < 4; i++) await new Promise<void>(setImmediate);
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'idle', currentTask: { id: first } });
    expect(coordinator.getAvailableAgents()).toEqual([]);
    const second = await coordinator.submitTask(task());
    expect(coordinator.getTask(second)!.status).toBe('queued');
    expect(coordinator.getAgent(agentId)!.currentTask!.id).toBe(first);
  });
});
