/**
 * Event Store Tests
 *
 * Comprehensive tests for the event sourcing implementation.
 * Tests event storage, retrieval, filtering, snapshots, and projections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore } from './event-store.js';
import { AgentStateProjection, TaskHistoryProjection, MemoryIndexProjection } from './projections.js';
import {
  createAgentSpawnedEvent,
  createAgentStartedEvent,
  createAgentTaskAssignedEvent,
  createAgentTaskCompletedEvent,
  createTaskCreatedEvent,
  createTaskStartedEvent,
  createTaskCompletedEvent,
  createMemoryStoredEvent,
  createMemoryRetrievedEvent,
  createMemoryDeletedEvent,
  createSwarmInitializedEvent,
} from './domain-events.js';

describe('EventStore', () => {
  let eventStore: EventStore;

  beforeEach(async () => {
    eventStore = new EventStore({ databasePath: ':memory:', verbose: false });
    await eventStore.initialize();
  });

  afterEach(async () => {
    await eventStore.shutdown();
  });

  describe('Event Appending', () => {
    it('should append events to the store', async () => {
      const event = createAgentSpawnedEvent('agent-1', 'coder', 'core', ['coding', 'testing']);

      await eventStore.append(event);

      const events = await eventStore.getEvents('agent-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent:spawned');
      expect(events[0].version).toBe(1);
    });

    it('should increment version for each event', async () => {
      const event1 = createAgentSpawnedEvent('agent-1', 'coder', 'core', []);
      const event2 = createAgentStartedEvent('agent-1');

      await eventStore.append(event1);
      await eventStore.append(event2);

      const events = await eventStore.getEvents('agent-1');
      expect(events[0].version).toBe(1);
      expect(events[1].version).toBe(2);
    });

    it('should maintain version per aggregate', async () => {
      const agent1Event = createAgentSpawnedEvent('agent-1', 'coder', 'core', []);
      const agent2Event = createAgentSpawnedEvent('agent-2', 'tester', 'quality', []);

      await eventStore.append(agent1Event);
      await eventStore.append(agent2Event);

      const agent1Events = await eventStore.getEvents('agent-1');
      const agent2Events = await eventStore.getEvents('agent-2');

      expect(agent1Events[0].version).toBe(1);
      expect(agent2Events[0].version).toBe(1);
    });
  });

  describe('Event Retrieval', () => {
    beforeEach(async () => {
      // Setup: Create multiple events
      await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
      await eventStore.append(createAgentStartedEvent('agent-1'));
      await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Build feature', 'Description', 'high', []));
      await eventStore.append(createTaskStartedEvent('task-1', 'agent-1'));
    });

    it('should retrieve events by aggregate ID', async () => {
      const events = await eventStore.getEvents('agent-1');
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('agent:spawned');
      expect(events[1].type).toBe('agent:started');
    });

    it('should retrieve events from specific version', async () => {
      const events = await eventStore.getEvents('agent-1', 2);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent:started');
    });

    it('should retrieve events by type', async () => {
      const events = await eventStore.getEventsByType('task:created');
      expect(events).toHaveLength(1);
      expect(events[0].aggregateId).toBe('task-1');
    });
  });

  describe('Event Filtering', () => {
    beforeEach(async () => {
      await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
      await eventStore.append(createAgentSpawnedEvent('agent-2', 'tester', 'quality', []));
      await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Task 1', 'Desc', 'high', []));
      await eventStore.append(createMemoryStoredEvent('mem-1', 'default', 'key1', 'semantic', 1024));
    });

    it('should filter by aggregate types', async () => {
      const events = await eventStore.query({ aggregateTypes: ['agent'] });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.aggregateType === 'agent')).toBe(true);
    });

    it('should filter by event types', async () => {
      const events = await eventStore.query({ eventTypes: ['agent:spawned'] });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === 'agent:spawned')).toBe(true);
    });

    it('should filter by aggregate IDs', async () => {
      const events = await eventStore.query({ aggregateIds: ['agent-1', 'task-1'] });
      expect(events).toHaveLength(2);
    });

    it('should support pagination', async () => {
      const page1 = await eventStore.query({ limit: 2, offset: 0 });
      const page2 = await eventStore.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('Event Replay', () => {
    it('should replay all events', async () => {
      await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
      await eventStore.append(createAgentStartedEvent('agent-1'));
      await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Task', 'Desc', 'high', []));

      const events: any[] = [];
      for await (const event of eventStore.replay()) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
    });

    it('should replay from specific version', async () => {
      await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
      await eventStore.append(createAgentStartedEvent('agent-1'));
      await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Task', 'Desc', 'high', []));

      const events: any[] = [];
      for await (const event of eventStore.replay(2)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Snapshots', () => {
    it('should save snapshots', async () => {
      const snapshot = {
        aggregateId: 'agent-1',
        aggregateType: 'agent' as const,
        version: 5,
        state: { status: 'active', tasks: ['task-1'] },
        timestamp: Date.now(),
      };

      await eventStore.saveSnapshot(snapshot);

      const retrieved = await eventStore.getSnapshot('agent-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.version).toBe(5);
      expect(retrieved?.state).toEqual({ status: 'active', tasks: ['task-1'] });
    });

    it('should return latest snapshot', async () => {
      const snapshot1 = {
        aggregateId: 'agent-1',
        aggregateType: 'agent' as const,
        version: 5,
        state: { status: 'active' },
        timestamp: Date.now(),
      };

      const snapshot2 = {
        aggregateId: 'agent-1',
        aggregateType: 'agent' as const,
        version: 10,
        state: { status: 'completed' },
        timestamp: Date.now(),
      };

      await eventStore.saveSnapshot(snapshot1);
      await eventStore.saveSnapshot(snapshot2);

      const retrieved = await eventStore.getSnapshot('agent-1');
      expect(retrieved?.version).toBe(10);
    });
  });

  describe('Statistics', () => {
    it('should provide event store statistics', async () => {
      await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
      await eventStore.append(createAgentSpawnedEvent('agent-2', 'tester', 'quality', []));
      await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Task', 'Desc', 'high', []));

      const stats = await eventStore.getStats();

      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType['agent:spawned']).toBe(2);
      expect(stats.eventsByType['task:created']).toBe(1);
      expect(stats.eventsByAggregate['agent-1']).toBe(1);
      expect(stats.eventsByAggregate['agent-2']).toBe(1);
    });
  });
});

describe('AgentStateProjection', () => {
  let eventStore: EventStore;
  let projection: AgentStateProjection;

  beforeEach(async () => {
    eventStore = new EventStore({ databasePath: ':memory:' });
    await eventStore.initialize();

    projection = new AgentStateProjection(eventStore);
  });

  afterEach(async () => {
    await eventStore.shutdown();
  });

  it('should build agent state from events', async () => {
    await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', ['coding']));
    await eventStore.append(createAgentStartedEvent('agent-1'));

    await projection.initialize();

    const agent = projection.getAgent('agent-1');
    expect(agent).not.toBeNull();
    expect(agent?.role).toBe('coder');
    expect(agent?.status).toBe('active');
  });

  it('should track task assignments', async () => {
    await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
    await eventStore.append(createAgentTaskAssignedEvent('agent-1', 'task-1', Date.now()));

    await projection.initialize();

    const agent = projection.getAgent('agent-1');
    expect(agent?.currentTask).toBe('task-1');
  });

  it('should track completed tasks', async () => {
    await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
    await eventStore.append(createAgentTaskCompletedEvent('agent-1', 'task-1', { success: true }, Date.now(), 5000));

    await projection.initialize();

    const agent = projection.getAgent('agent-1');
    expect(agent?.completedTasks).toContain('task-1');
    expect(agent?.taskCount).toBe(1);
  });

  it('should filter agents by status', async () => {
    await eventStore.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
    await eventStore.append(createAgentSpawnedEvent('agent-2', 'tester', 'quality', []));
    await eventStore.append(createAgentStartedEvent('agent-1'));

    await projection.initialize();

    const activeAgents = projection.getAgentsByStatus('active');
    const idleAgents = projection.getAgentsByStatus('idle');

    expect(activeAgents).toHaveLength(1);
    expect(idleAgents).toHaveLength(1);
  });
});

describe('TaskHistoryProjection', () => {
  let eventStore: EventStore;
  let projection: TaskHistoryProjection;

  beforeEach(async () => {
    eventStore = new EventStore({ databasePath: ':memory:' });
    await eventStore.initialize();

    projection = new TaskHistoryProjection(eventStore);
  });

  afterEach(async () => {
    await eventStore.shutdown();
  });

  it('should build task history from events', async () => {
    await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Build Feature', 'Description', 'high', []));
    await eventStore.append(createTaskStartedEvent('task-1', 'agent-1'));
    await eventStore.append(createTaskCompletedEvent('task-1', { success: true }, 5000));

    await projection.initialize();

    const task = projection.getTask('task-1');
    expect(task).not.toBeNull();
    expect(task?.title).toBe('Build Feature');
    expect(task?.status).toBe('completed');
    expect(task?.assignedAgent).toBe('agent-1');
  });

  it('should calculate average task duration', async () => {
    await eventStore.append(createTaskCreatedEvent('task-1', 'implementation', 'Task 1', 'Desc', 'high', []));
    await eventStore.append(createTaskCompletedEvent('task-1', { success: true }, 5000));

    await eventStore.append(createTaskCreatedEvent('task-2', 'implementation', 'Task 2', 'Desc', 'high', []));
    await eventStore.append(createTaskCompletedEvent('task-2', { success: true }, 3000));

    await projection.initialize();

    const avgDuration = projection.getAverageTaskDuration();
    expect(avgDuration).toBe(4000);
  });
});

describe('MemoryIndexProjection', () => {
  let eventStore: EventStore;
  let projection: MemoryIndexProjection;

  beforeEach(async () => {
    eventStore = new EventStore({ databasePath: ':memory:' });
    await eventStore.initialize();

    projection = new MemoryIndexProjection(eventStore);
  });

  afterEach(async () => {
    await eventStore.shutdown();
  });

  it('should build memory index from events', async () => {
    await eventStore.append(createMemoryStoredEvent('mem-1', 'default', 'key1', 'semantic', 1024));
    await eventStore.append(createMemoryRetrievedEvent('mem-1', 'default', 'key1', 1));

    await projection.initialize();

    const memory = projection.getMemory('mem-1');
    expect(memory).not.toBeNull();
    expect(memory?.namespace).toBe('default');
    expect(memory?.accessCount).toBe(1);
  });

  it('should track memory deletions', async () => {
    await eventStore.append(createMemoryStoredEvent('mem-1', 'default', 'key1', 'semantic', 1024));
    await eventStore.append(createMemoryDeletedEvent('mem-1', 'default', 'key1'));

    await projection.initialize();

    const memory = projection.getMemory('mem-1');
    expect(memory?.isDeleted).toBe(true);

    const activeMemories = projection.getActiveMemories();
    expect(activeMemories).toHaveLength(0);
  });

  it('should calculate total size by namespace', async () => {
    await eventStore.append(createMemoryStoredEvent('mem-1', 'ns1', 'key1', 'semantic', 1024));
    await eventStore.append(createMemoryStoredEvent('mem-2', 'ns1', 'key2', 'semantic', 2048));
    await eventStore.append(createMemoryStoredEvent('mem-3', 'ns2', 'key3', 'semantic', 512));

    await projection.initialize();

    const ns1Size = projection.getTotalSizeByNamespace('ns1');
    const ns2Size = projection.getTotalSizeByNamespace('ns2');

    expect(ns1Size).toBe(3072);
    expect(ns2Size).toBe(512);
  });
});
