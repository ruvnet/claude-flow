/**
 * V3 Hooks System - Tests
 *
 * Comprehensive tests for hook registry and executor.
 *
 * @module v3/shared/hooks/hooks.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookRegistry, createHookRegistry } from './registry.js';
import { HookExecutor, createHookExecutor } from './executor.js';
import { HookEvent, HookPriority, HookContext, HookResult } from './types.js';
import { createEventBus } from '../core/event-bus.js';

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = createHookRegistry();
  });

  it('should register a hook', () => {
    const handler = vi.fn();
    const id = registry.register(HookEvent.PreToolUse, handler);

    expect(id).toBeDefined();
    expect(registry.has(id)).toBe(true);
    expect(registry.count()).toBe(1);
  });

  it('should unregister a hook', () => {
    const handler = vi.fn();
    const id = registry.register(HookEvent.PreToolUse, handler);

    const result = registry.unregister(id);

    expect(result).toBe(true);
    expect(registry.has(id)).toBe(false);
    expect(registry.count()).toBe(0);
  });

  it('should return false when unregistering non-existent hook', () => {
    const result = registry.unregister('non-existent');
    expect(result).toBe(false);
  });

  it('should get handlers sorted by priority', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.Normal);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler3, HookPriority.Low);

    const handlers = registry.getHandlers(HookEvent.PreToolUse);

    expect(handlers).toHaveLength(3);
    expect(handlers[0].handler).toBe(handler2); // High priority first
    expect(handlers[1].handler).toBe(handler1); // Normal priority second
    expect(handlers[2].handler).toBe(handler3); // Low priority last
  });

  it('should filter disabled hooks', () => {
    const handler = vi.fn();
    const id = registry.register(HookEvent.PreToolUse, handler, HookPriority.Normal, {
      enabled: false,
    });

    const handlers = registry.getHandlers(HookEvent.PreToolUse);
    const allHandlers = registry.getHandlers(HookEvent.PreToolUse, true);

    expect(handlers).toHaveLength(0);
    expect(allHandlers).toHaveLength(1);
  });

  it('should enable and disable hooks', () => {
    const handler = vi.fn();
    const id = registry.register(HookEvent.PreToolUse, handler);

    registry.disable(id);
    expect(registry.getHandlers(HookEvent.PreToolUse)).toHaveLength(0);

    registry.enable(id);
    expect(registry.getHandlers(HookEvent.PreToolUse)).toHaveLength(1);
  });

  it('should list hooks with filters', () => {
    registry.register(HookEvent.PreToolUse, vi.fn(), HookPriority.High);
    registry.register(HookEvent.PostToolUse, vi.fn(), HookPriority.Normal);
    registry.register(HookEvent.PreEdit, vi.fn(), HookPriority.Low);

    const allHooks = registry.listHooks();
    expect(allHooks).toHaveLength(3);

    const preToolHooks = registry.listHooks({ event: HookEvent.PreToolUse });
    expect(preToolHooks).toHaveLength(1);

    const highPriorityHooks = registry.listHooks({ minPriority: HookPriority.Normal });
    expect(highPriorityHooks).toHaveLength(2);
  });

  it('should get event types', () => {
    registry.register(HookEvent.PreToolUse, vi.fn());
    registry.register(HookEvent.PostToolUse, vi.fn());
    registry.register(HookEvent.PreEdit, vi.fn());

    const eventTypes = registry.getEventTypes();
    expect(eventTypes).toContain(HookEvent.PreToolUse);
    expect(eventTypes).toContain(HookEvent.PostToolUse);
    expect(eventTypes).toContain(HookEvent.PreEdit);
  });

  it('should track statistics', () => {
    registry.register(HookEvent.PreToolUse, vi.fn());
    registry.register(HookEvent.PostToolUse, vi.fn());

    registry.recordExecution(true, 10);
    registry.recordExecution(true, 20);
    registry.recordExecution(false, 5);

    const stats = registry.getStats();
    expect(stats.totalHooks).toBe(2);
    expect(stats.totalExecutions).toBe(3);
    expect(stats.totalFailures).toBe(1);
    expect(stats.avgExecutionTime).toBe((10 + 20 + 5) / 3);
  });

  it('should reset statistics', () => {
    registry.recordExecution(true, 10);
    registry.resetStats();

    const stats = registry.getStats();
    expect(stats.totalExecutions).toBe(0);
    expect(stats.totalFailures).toBe(0);
  });

  it('should clear all hooks', () => {
    registry.register(HookEvent.PreToolUse, vi.fn());
    registry.register(HookEvent.PostToolUse, vi.fn());

    registry.clear();

    expect(registry.count()).toBe(0);
    expect(registry.getEventTypes()).toHaveLength(0);
  });
});

describe('HookExecutor', () => {
  let registry: HookRegistry;
  let executor: HookExecutor;
  let eventBus: any;

  beforeEach(() => {
    registry = createHookRegistry();
    eventBus = createEventBus();
    executor = createHookExecutor(registry, eventBus);
  });

  it('should execute single hook successfully', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    registry.register(HookEvent.PreToolUse, handler);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
      tool: { name: 'Read', parameters: { path: 'file.ts' } },
    };

    const result = await executor.execute(HookEvent.PreToolUse, context);

    expect(result.success).toBe(true);
    expect(result.hooksExecuted).toBe(1);
    expect(result.hooksFailed).toBe(0);
    expect(handler).toHaveBeenCalledWith(context);
  });

  it('should execute multiple hooks in priority order', async () => {
    const executionOrder: number[] = [];

    const handler1 = vi.fn(async () => {
      executionOrder.push(1);
      return { success: true };
    });
    const handler2 = vi.fn(async () => {
      executionOrder.push(2);
      return { success: true };
    });
    const handler3 = vi.fn(async () => {
      executionOrder.push(3);
      return { success: true };
    });

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.Normal);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler3, HookPriority.Low);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    await executor.execute(HookEvent.PreToolUse, context);

    expect(executionOrder).toEqual([2, 1, 3]); // High, Normal, Low
  });

  it('should handle hook errors gracefully', async () => {
    const handler1 = vi.fn(async () => ({ success: true }));
    const handler2 = vi.fn(async () => {
      throw new Error('Hook failed');
    });
    const handler3 = vi.fn(async () => ({ success: true }));

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.Normal);
    registry.register(HookEvent.PreToolUse, handler3, HookPriority.Low);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.execute(HookEvent.PreToolUse, context, {
      continueOnError: true,
    });

    expect(result.hooksExecuted).toBe(3);
    expect(result.hooksFailed).toBe(1);
    expect(handler3).toHaveBeenCalled(); // Should continue despite error
  });

  it('should abort on error when continueOnError is false', async () => {
    const handler1 = vi.fn(async () => ({ success: true }));
    const handler2 = vi.fn(async () => {
      throw new Error('Hook failed');
    });
    const handler3 = vi.fn(async () => ({ success: true }));

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.Normal);
    registry.register(HookEvent.PreToolUse, handler3, HookPriority.Low);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.execute(HookEvent.PreToolUse, context);

    expect(result.aborted).toBe(true);
    expect(result.hooksExecuted).toBe(2);
    expect(handler3).not.toHaveBeenCalled(); // Should not execute after error
  });

  it('should abort when hook returns abort flag', async () => {
    const handler1 = vi.fn(async () => ({ success: true }));
    const handler2 = vi.fn(async () => ({ success: true, abort: true }));
    const handler3 = vi.fn(async () => ({ success: true }));

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.Normal);
    registry.register(HookEvent.PreToolUse, handler3, HookPriority.Low);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.execute(HookEvent.PreToolUse, context);

    expect(result.aborted).toBe(true);
    expect(result.hooksExecuted).toBe(2);
    expect(handler3).not.toHaveBeenCalled();
  });

  it('should merge context modifications', async () => {
    const handler1 = vi.fn(async () => ({
      success: true,
      data: { metadata: { modified: true } },
    }));
    const handler2 = vi.fn(async (context: HookContext) => {
      expect(context.metadata?.modified).toBe(true);
      return { success: true };
    });

    registry.register(HookEvent.PreToolUse, handler1, HookPriority.High);
    registry.register(HookEvent.PreToolUse, handler2, HookPriority.Normal);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.execute(HookEvent.PreToolUse, context);

    expect(result.finalContext?.metadata).toEqual({ modified: true });
  });

  it('should handle timeout', async () => {
    const handler = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { success: true };
    });

    registry.register(HookEvent.PreToolUse, handler);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.executeWithTimeout(HookEvent.PreToolUse, context, 100);

    expect(result.success).toBe(false);
    expect(result.hooksFailed).toBe(1);
  });

  it('should execute hooks in parallel', async () => {
    const handler1 = vi.fn(async () => ({ success: true }));
    const handler2 = vi.fn(async () => ({ success: true }));

    registry.register(HookEvent.PreToolUse, handler1);
    registry.register(HookEvent.PostToolUse, handler2);

    const contexts: HookContext[] = [
      { event: HookEvent.PreToolUse, timestamp: new Date() },
      { event: HookEvent.PostToolUse, timestamp: new Date() },
    ];

    const results = await executor.executeParallel(
      [HookEvent.PreToolUse, HookEvent.PostToolUse],
      contexts
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('should execute hooks sequentially with context chaining', async () => {
    const handler1 = vi.fn(async () => ({
      success: true,
      data: { metadata: { step: 1 } },
    }));
    const handler2 = vi.fn(async () => ({
      success: true,
      data: { metadata: { step: 2 } },
    }));

    registry.register(HookEvent.PreToolUse, handler1);
    registry.register(HookEvent.PostToolUse, handler2);

    const initialContext: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.executeSequential(
      [HookEvent.PreToolUse, HookEvent.PostToolUse],
      initialContext
    );

    expect(result.success).toBe(true);
    expect(result.hooksExecuted).toBe(2);
  });

  it('should emit events to event bus', async () => {
    const preExecuteHandler = vi.fn();
    const postExecuteHandler = vi.fn();

    eventBus.on('hooks:pre-execute', preExecuteHandler);
    eventBus.on('hooks:post-execute', postExecuteHandler);

    const handler = vi.fn(async () => ({ success: true }));
    registry.register(HookEvent.PreToolUse, handler);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    await executor.execute(HookEvent.PreToolUse, context);

    expect(preExecuteHandler).toHaveBeenCalled();
    expect(postExecuteHandler).toHaveBeenCalled();
  });

  it('should skip disabled hooks', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    const id = registry.register(HookEvent.PreToolUse, handler, HookPriority.Normal, {
      enabled: false,
    });

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    const result = await executor.execute(HookEvent.PreToolUse, context);

    expect(result.hooksExecuted).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should record execution statistics', async () => {
    const handler = vi.fn(async () => ({ success: true }));
    registry.register(HookEvent.PreToolUse, handler);

    const context: HookContext = {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
    };

    await executor.execute(HookEvent.PreToolUse, context);

    const stats = registry.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.totalFailures).toBe(0);
  });
});
