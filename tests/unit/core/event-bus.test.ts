/// <reference types="jest" />

/**
 * Unit tests for EventBus
 */

import { 
  describe, 
  it, 
  beforeEach, 
  afterEach,
  assertEquals, 
  assertExists,
  assertRejects,
  spy, 
  assertSpyCalls,
} from '../../test.utils.js';
import { EventBus } from '../../../src/core/event-bus.js';
import { SystemEvents } from '../../../src/utils/types.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    setupTestEnv();
    // Reset singleton for each test
    (EventBus as any).instance = undefined;
    eventBus = EventBus.getInstance();
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it('should be a singleton', () => {
    const instance1 = EventBus.getInstance();
    const instance2 = EventBus.getInstance();
    expect(instance1).toBe( instance2);
  });

  it('should emit and receive events', () => {
    const handler = jest.spyOn();

    eventBus.on(SystemEvents.AGENT_SPAWNED, handler);
    
    const eventData = {
      agentId: 'test-agent',
      profile: {
        id: 'test-agent',
        name: 'Test Agent',
        type: 'custom' as const,
        capabilities: [],
        systemPrompt: 'Test prompt',
        maxConcurrentTasks: 5,
        priority: 0,
      },
      sessionId: 'test-session',
    };

    eventBus.emit(SystemEvents.AGENT_SPAWNED as any, eventData);

    expect(handler).toBe( 1);
    expect(handler.calls[0].args[0]).toBe( eventData);
  });

  it('should handle multiple listeners', () => {
    const handler1 = jest.spyOn();
    const handler2 = jest.spyOn();

    eventBus.on(SystemEvents.TASK_CREATED, handler1);
    eventBus.on(SystemEvents.TASK_CREATED, handler2);

    const task = {
      id: 'test-task',
      type: 'test',
      description: 'Test task',
      priority: 0,
      dependencies: [],
      status: 'pending' as const,
      input: {},
      createdAt: new Date(),
    };

    eventBus.emit(SystemEvents.TASK_CREATED as any, { task });

    expect(handler1).toBe( 1);
    expect(handler2).toBe( 1);
  });

  it('should support once listeners', () => {
    const handler = jest.spyOn();

    eventBus.once(SystemEvents.SYSTEM_READY, handler);

    eventBus.emit(SystemEvents.SYSTEM_READY as any, { timestamp: new Date() });
    eventBus.emit(SystemEvents.SYSTEM_READY as any, { timestamp: new Date() });

    expect(handler).toBe( 1);
  });

  it('should wait for event', async () => {
    const promise = eventBus.waitFor(SystemEvents.SYSTEM_READY, 1000);

    setTimeout(() => {
      eventBus.emit(SystemEvents.SYSTEM_READY as any, { timestamp: new Date() });
    }, 100);

    const result = await promise as any;
    expect(result.timestamp instanceof Date).toBe( true);
  });

  it('should timeout when waiting for event', async () => {
    await expect(
      () => eventBus.waitFor('non-existent-event', 100),
      Error,
      'Timeout waiting for event: non-existent-event'
    );
  });

  it('should filter events', () => {
    const handler = jest.spyOn();
    
    eventBus.onFiltered(
      SystemEvents.TASK_COMPLETED,
      (data: any) => data.taskId === 'task-1',
      handler
    );

    eventBus.emit(SystemEvents.TASK_COMPLETED as any, { taskId: 'task-1', result: 'success' });
    eventBus.emit(SystemEvents.TASK_COMPLETED as any, { taskId: 'task-2', result: 'success' });

    expect(handler).toBe( 1);
    expect(handler.calls[0].args[0].taskId).toBe( 'task-1');
  });

  it('should remove event listeners', () => {
    const handler = jest.spyOn();
    
    eventBus.on(SystemEvents.AGENT_ERROR, handler);
    eventBus.emit(SystemEvents.AGENT_ERROR as any, { agentId: 'test', error: new Error('test') });
    
    expect(handler).toBe( 1);
    
    eventBus.off(SystemEvents.AGENT_ERROR, handler);
    eventBus.emit(SystemEvents.AGENT_ERROR as any, { agentId: 'test', error: new Error('test') });
    
    expect(handler).toBe( 1); // Still 1, not called again
  });

  it('should remove all listeners for an event', () => {
    const handler1 = jest.spyOn();
    const handler2 = jest.spyOn();
    
    eventBus.on(SystemEvents.MEMORY_CREATED, handler1);
    eventBus.on(SystemEvents.MEMORY_CREATED, handler2);
    
    eventBus.removeAllListeners(SystemEvents.MEMORY_CREATED);
    eventBus.emit(SystemEvents.MEMORY_CREATED as any, { entry: {} });
    
    expect(handler1).toBe( 0);
    expect(handler2).toBe( 0);
  });

  it('should track event statistics', () => {
    const debugBus = EventBus.getInstance(true);
    
    debugBus.emit(SystemEvents.TASK_CREATED as any, { task: {} });
    debugBus.emit(SystemEvents.TASK_CREATED as any, { task: {} });
    debugBus.emit(SystemEvents.TASK_COMPLETED as any, { taskId: 'test' });
    
    const stats = debugBus.getEventStats();
    const taskCreatedStat = stats.find(s => s.event === SystemEvents.TASK_CREATED);
    const taskCompletedStat = stats.find(s => s.event === SystemEvents.TASK_COMPLETED);
    
    expect(taskCreatedStat);
    expect(taskCompletedStat);
    expect(taskCreatedStat!.count).toBe( 2);
    expect(taskCompletedStat!.count).toBe( 1);
  });

  it('should reset event statistics', () => {
    const debugBus = EventBus.getInstance(true);
    
    debugBus.emit(SystemEvents.SYSTEM_ERROR as any, { error: new Error('test'), component: 'test' });
    let stats = debugBus.getEventStats();
    expect(stats.length > 0).toBe( true);
    
    debugBus.resetStats();
    stats = debugBus.getEventStats();
    expect(stats.length).toBe( 0);
  });
});
