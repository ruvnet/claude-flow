/**
 * V3 Task Hooks Tests
 *
 * Tests for pre-task and post-task hook functionality.
 *
 * @module v3/shared/hooks/__tests__/task-hooks.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createHookRegistry,
  createTaskHooksManager,
  TaskHooksManager,
  HookRegistry,
  HookEvent,
} from '../../src/hooks/index.js';

describe('TaskHooksManager', () => {
  let registry: HookRegistry;
  let taskManager: TaskHooksManager;

  beforeEach(() => {
    registry = createHookRegistry();
    taskManager = createTaskHooksManager(registry);
  });

  describe('pre-task hook', () => {
    it('should register pre-task hook on creation', () => {
      const hooks = registry.getHandlers(HookEvent.PreTaskExecute);
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.some(h => h.name === 'task-hooks:pre-task')).toBe(true);
    });

    it('should analyze task and suggest agents for coding task', async () => {
      const result = await taskManager.executePreTask(
        'task-123',
        'Implement user authentication feature'
      );

      expect(result.success).toBe(true);
      expect(result.suggestedAgents).toBeDefined();
      expect(result.suggestedAgents!.length).toBeGreaterThan(0);
      expect(result.suggestedAgents![0].type).toBe('coder');
      expect(result.suggestedAgents![0].confidence).toBeGreaterThan(0);
    });

    it('should suggest security-architect for security tasks', async () => {
      const result = await taskManager.executePreTask(
        'task-456',
        'Fix security vulnerability in authentication'
      );

      expect(result.success).toBe(true);
      expect(result.suggestedAgents).toBeDefined();
      const securityAgent = result.suggestedAgents!.find(a => a.type === 'security-architect');
      expect(securityAgent).toBeDefined();
    });

    it('should suggest tester for test-related tasks', async () => {
      const result = await taskManager.executePreTask(
        'task-789',
        'Write unit tests for user service'
      );

      expect(result.success).toBe(true);
      expect(result.suggestedAgents).toBeDefined();
      const testerAgent = result.suggestedAgents!.find(a => a.type === 'tester');
      expect(testerAgent).toBeDefined();
    });

    it('should estimate complexity based on task description', async () => {
      // Simple task
      const simpleResult = await taskManager.executePreTask(
        'task-simple',
        'Fix typo in readme'
      );
      expect(simpleResult.complexity).toBe('low');

      // Complex task
      const complexResult = await taskManager.executePreTask(
        'task-complex',
        'Refactor and redesign the entire authentication system with multiple OAuth providers'
      );
      expect(complexResult.complexity).toBe('high');
    });

    it('should detect risks in task description', async () => {
      const result = await taskManager.executePreTask(
        'task-risky',
        'Delete old data from production database'
      );

      expect(result.risks).toBeDefined();
      expect(result.risks!.length).toBeGreaterThan(0);
      expect(result.risks!.some(r => r.includes('production'))).toBe(true);
    });

    it('should track active tasks', async () => {
      await taskManager.executePreTask('task-1', 'Task 1');
      await taskManager.executePreTask('task-2', 'Task 2');

      const activeTasks = taskManager.getActiveTasks();
      expect(activeTasks.size).toBe(2);
      expect(activeTasks.has('task-1')).toBe(true);
      expect(activeTasks.has('task-2')).toBe(true);
    });

    it('should provide recommendations for high complexity tasks', async () => {
      const result = await taskManager.executePreTask(
        'task-high-complexity',
        'Implement complex distributed system with multiple services'
      );

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations!.length).toBeGreaterThan(0);
    });
  });

  describe('post-task hook', () => {
    it('should register post-task hook on creation', () => {
      const hooks = registry.getHandlers(HookEvent.PostTaskExecute);
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.some(h => h.name === 'task-hooks:post-task')).toBe(true);
    });

    it('should record successful task outcome', async () => {
      // First start the task
      await taskManager.executePreTask('task-success', 'Test task');

      // Then complete it
      const result = await taskManager.executePostTask('task-success', true);

      expect(result.success).toBe(true);
      expect(result.outcome).toBeDefined();
      expect(result.outcome!.success).toBe(true);
      expect(result.outcome!.duration).toBeGreaterThanOrEqual(0);
    });

    it('should record failed task outcome', async () => {
      await taskManager.executePreTask('task-failed', 'Test task');

      const result = await taskManager.executePostTask('task-failed', false, {
        error: 'Test failed due to timeout',
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toBeDefined();
      expect(result.outcome!.success).toBe(false);
    });

    it('should create learning trajectory', async () => {
      await taskManager.executePreTask('task-learn', 'Test task');
      const result = await taskManager.executePostTask('task-learn', true);

      expect(result.trajectoryId).toBeDefined();
      expect(result.trajectoryId).toContain('trajectory-');
    });

    it('should track learning updates', async () => {
      await taskManager.executePreTask('task-updates', 'Test task');
      const result = await taskManager.executePostTask('task-updates', true);

      expect(result.learningUpdates).toBeDefined();
      expect(result.learningUpdates!.trajectoriesRecorded).toBe(1);
    });

    it('should remove task from active tasks after completion', async () => {
      await taskManager.executePreTask('task-cleanup', 'Test task');
      expect(taskManager.getActiveTasks().has('task-cleanup')).toBe(true);

      await taskManager.executePostTask('task-cleanup', true);
      expect(taskManager.getActiveTasks().has('task-cleanup')).toBe(false);
    });

    it('should handle post-task without pre-task gracefully', async () => {
      const result = await taskManager.executePostTask('task-no-pre', true);

      expect(result.success).toBe(true);
      expect(result.outcome).toBeDefined();
    });
  });

  describe('clearActiveTasks', () => {
    it('should clear all active tasks', async () => {
      await taskManager.executePreTask('task-1', 'Task 1');
      await taskManager.executePreTask('task-2', 'Task 2');
      expect(taskManager.getActiveTasks().size).toBe(2);

      taskManager.clearActiveTasks();
      expect(taskManager.getActiveTasks().size).toBe(0);
    });
  });
});
