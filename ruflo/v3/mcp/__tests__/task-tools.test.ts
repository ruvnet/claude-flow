/**
 * V3 MCP Task Tools Tests
 *
 * Tests for task management MCP tools:
 * - tasks/create
 * - tasks/list
 * - tasks/status
 * - tasks/cancel
 * - tasks/assign
 * - tasks/update
 * - tasks/dependencies
 * - tasks/results
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTaskTool,
  listTasksTool,
  taskStatusTool,
  cancelTaskTool,
  assignTaskTool,
  updateTaskTool,
  taskDependenciesTool,
  taskResultsTool,
  taskTools,
} from '../tools/task-tools.js';
import { ToolContext } from '../types.js';

describe('Task Tools', () => {
  let mockContext: ToolContext;
  let mockOrchestrator: any;

  beforeEach(() => {
    mockOrchestrator = {
      submitTask: vi.fn(),
      listTasks: vi.fn(),
      getTaskStatus: vi.fn(),
      cancelTask: vi.fn(),
      assignTask: vi.fn(),
      updateTask: vi.fn(),
      addTaskDependencies: vi.fn(),
      removeTaskDependencies: vi.fn(),
      getTaskDependencies: vi.fn(),
      clearTaskDependencies: vi.fn(),
      getTaskResults: vi.fn(),
    };

    mockContext = {
      sessionId: 'test-session',
      orchestrator: mockOrchestrator,
    };
  });

  describe('tasks/create', () => {
    it('should have correct tool definition', () => {
      expect(createTaskTool.name).toBe('tasks/create');
      expect(createTaskTool.category).toBe('task');
      expect(createTaskTool.inputSchema.required).toContain('type');
      expect(createTaskTool.inputSchema.required).toContain('description');
    });

    it('should create a task with required fields', async () => {
      const result = await createTaskTool.handler({
        type: 'code',
        description: 'Implement feature X',
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.taskId).toBeDefined();
      expect(result.taskId).toMatch(/^task-/);
      expect(result.status).toBeDefined();
      expect(result.createdAt).toBeDefined();
    });

    it('should create a task with all optional fields', async () => {
      const result = await createTaskTool.handler({
        type: 'review',
        description: 'Review PR #123',
        priority: 2,
        dependencies: ['task-1', 'task-2'],
        assignToAgent: 'agent-1',
        input: { prNumber: 123 },
        timeout: 60000,
        metadata: { source: 'github' },
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.taskId).toBeDefined();
    });

    it('should validate priority range', async () => {
      await expect(createTaskTool.handler({
        type: 'code',
        description: 'Test task',
        priority: 15, // Invalid: > 10
      }, mockContext)).rejects.toThrow();
    });

    it('should use orchestrator when available', async () => {
      mockOrchestrator.submitTask.mockResolvedValue({
        id: 'orch-task-1',
        status: 'queued',
        queuePosition: 5,
      });

      const result = await createTaskTool.handler({
        type: 'code',
        description: 'Test orchestrator',
      }, mockContext);

      expect(mockOrchestrator.submitTask).toHaveBeenCalled();
      expect(result.status).toBe('queued');
    });
  });

  describe('tasks/list', () => {
    it('should have correct tool definition', () => {
      expect(listTasksTool.name).toBe('tasks/list');
      expect(listTasksTool.category).toBe('task');
      expect(listTasksTool.cacheable).toBe(true);
    });

    it('should list all tasks with no filters', async () => {
      const result = await listTasksTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.tasks).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);
      expect(result.total).toBeDefined();
      expect(result.limit).toBeDefined();
      expect(result.offset).toBeDefined();
    });

    it('should filter tasks by status', async () => {
      // Create some tasks first
      await createTaskTool.handler({
        type: 'code',
        description: 'Task 1',
      }, mockContext);

      const result = await listTasksTool.handler({
        status: 'pending',
      }, mockContext);

      expect(result).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);
    });

    it('should apply pagination', async () => {
      const result = await listTasksTool.handler({
        limit: 10,
        offset: 0,
      }, mockContext);

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('should apply sorting', async () => {
      const result = await listTasksTool.handler({
        sortBy: 'priority',
        sortOrder: 'asc',
      }, mockContext);

      expect(result).toBeDefined();
    });
  });

  describe('tasks/status', () => {
    it('should have correct tool definition', () => {
      expect(taskStatusTool.name).toBe('tasks/status');
      expect(taskStatusTool.category).toBe('task');
      expect(taskStatusTool.inputSchema.required).toContain('taskId');
    });

    it('should get task status', async () => {
      // Create a task first
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Test task',
      }, mockContext);

      const result = await taskStatusTool.handler({
        taskId: createResult.taskId,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.id).toBe(createResult.taskId);
      expect(result.status).toBeDefined();
    });

    it('should include metrics when requested', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Test task',
      }, mockContext);

      const result = await taskStatusTool.handler({
        taskId: createResult.taskId,
        includeMetrics: true,
      }, mockContext);

      expect(result.metrics).toBeDefined();
    });

    it('should include history when requested', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Test task',
      }, mockContext);

      const result = await taskStatusTool.handler({
        taskId: createResult.taskId,
        includeHistory: true,
      }, mockContext);

      expect(result.history).toBeDefined();
      expect(Array.isArray(result.history)).toBe(true);
    });

    it('should throw error for non-existent task', async () => {
      await expect(taskStatusTool.handler({
        taskId: 'non-existent-task',
      }, mockContext)).rejects.toThrow();
    });
  });

  describe('tasks/cancel', () => {
    it('should have correct tool definition', () => {
      expect(cancelTaskTool.name).toBe('tasks/cancel');
      expect(cancelTaskTool.category).toBe('task');
      expect(cancelTaskTool.inputSchema.required).toContain('taskId');
    });

    it('should cancel a pending task', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to cancel',
      }, mockContext);

      const result = await cancelTaskTool.handler({
        taskId: createResult.taskId,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.taskId).toBe(createResult.taskId);
      expect(result.cancelled).toBe(true);
      expect(result.cancelledAt).toBeDefined();
    });

    it('should include cancellation reason', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to cancel',
      }, mockContext);

      const result = await cancelTaskTool.handler({
        taskId: createResult.taskId,
        reason: 'No longer needed',
      }, mockContext);

      expect(result.reason).toBe('No longer needed');
    });

    it('should throw error for non-existent task', async () => {
      await expect(cancelTaskTool.handler({
        taskId: 'non-existent-task',
      }, mockContext)).rejects.toThrow();
    });
  });

  describe('tasks/assign', () => {
    it('should have correct tool definition', () => {
      expect(assignTaskTool.name).toBe('tasks/assign');
      expect(assignTaskTool.category).toBe('task');
      expect(assignTaskTool.inputSchema.required).toContain('taskId');
      expect(assignTaskTool.inputSchema.required).toContain('agentId');
    });

    it('should assign a task to an agent', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to assign',
      }, mockContext);

      const result = await assignTaskTool.handler({
        taskId: createResult.taskId,
        agentId: 'agent-1',
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.taskId).toBe(createResult.taskId);
      expect(result.agentId).toBe('agent-1');
      expect(result.assigned).toBe(true);
    });

    it('should fail reassignment without flag', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to assign',
        assignToAgent: 'agent-1',
      }, mockContext);

      const result = await assignTaskTool.handler({
        taskId: createResult.taskId,
        agentId: 'agent-2',
        reassign: false,
      }, mockContext);

      expect(result.assigned).toBe(false);
    });

    it('should allow reassignment with flag', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to assign',
        assignToAgent: 'agent-1',
      }, mockContext);

      const result = await assignTaskTool.handler({
        taskId: createResult.taskId,
        agentId: 'agent-2',
        reassign: true,
      }, mockContext);

      expect(result.assigned).toBe(true);
      expect(result.agentId).toBe('agent-2');
      expect(result.previousAgent).toBe('agent-1');
    });
  });

  describe('tasks/update', () => {
    it('should have correct tool definition', () => {
      expect(updateTaskTool.name).toBe('tasks/update');
      expect(updateTaskTool.category).toBe('task');
      expect(updateTaskTool.inputSchema.required).toContain('taskId');
    });

    it('should update task priority', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task to update',
        priority: 5,
      }, mockContext);

      const result = await updateTaskTool.handler({
        taskId: createResult.taskId,
        priority: 1,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.updated).toBe(true);
      expect(result.changes.priority).toBeDefined();
      expect(result.changes.priority.from).toBe(5);
      expect(result.changes.priority.to).toBe(1);
    });

    it('should update task description', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Original description',
      }, mockContext);

      const result = await updateTaskTool.handler({
        taskId: createResult.taskId,
        description: 'Updated description',
      }, mockContext);

      expect(result.updated).toBe(true);
      expect(result.changes.description).toBeDefined();
    });

    it('should merge metadata', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task with metadata',
        metadata: { key1: 'value1' },
      }, mockContext);

      const result = await updateTaskTool.handler({
        taskId: createResult.taskId,
        metadata: { key2: 'value2' },
      }, mockContext);

      expect(result.updated).toBe(true);
      expect(result.changes.metadata).toBeDefined();
    });
  });

  describe('tasks/dependencies', () => {
    it('should have correct tool definition', () => {
      expect(taskDependenciesTool.name).toBe('tasks/dependencies');
      expect(taskDependenciesTool.category).toBe('task');
      expect(taskDependenciesTool.inputSchema.required).toContain('taskId');
      expect(taskDependenciesTool.inputSchema.required).toContain('action');
    });

    it('should add dependencies', async () => {
      // Use a context without orchestrator to test simple implementation
      const simpleContext: ToolContext = { sessionId: 'test-session' };

      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task with dependencies',
      }, simpleContext);

      const result = await taskDependenciesTool.handler({
        taskId: createResult.taskId,
        action: 'add',
        dependencies: ['task-1', 'task-2'],
      }, simpleContext);

      expect(result).toBeDefined();
      expect(result.action).toBe('add');
      expect(result.dependencies).toContain('task-1');
      expect(result.dependencies).toContain('task-2');
    });

    it('should remove dependencies', async () => {
      // Use a context without orchestrator to test simple implementation
      const simpleContext: ToolContext = { sessionId: 'test-session' };

      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task with dependencies',
        dependencies: ['task-1', 'task-2', 'task-3'],
      }, simpleContext);

      const result = await taskDependenciesTool.handler({
        taskId: createResult.taskId,
        action: 'remove',
        dependencies: ['task-2'],
      }, simpleContext);

      expect(result.action).toBe('remove');
      expect(result.dependencies).not.toContain('task-2');
      expect(result.dependencies).toContain('task-1');
    });

    it('should list dependencies', async () => {
      // Use a context without orchestrator to test simple implementation
      const simpleContext: ToolContext = { sessionId: 'test-session' };

      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task with dependencies',
        dependencies: ['task-1', 'task-2'],
      }, simpleContext);

      const result = await taskDependenciesTool.handler({
        taskId: createResult.taskId,
        action: 'list',
      }, simpleContext);

      expect(result.action).toBe('list');
      expect(result.dependencies).toHaveLength(2);
    });

    it('should clear all dependencies', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task with dependencies',
        dependencies: ['task-1', 'task-2'],
      }, mockContext);

      const result = await taskDependenciesTool.handler({
        taskId: createResult.taskId,
        action: 'clear',
      }, mockContext);

      expect(result.action).toBe('clear');
      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe('tasks/results', () => {
    it('should have correct tool definition', () => {
      expect(taskResultsTool.name).toBe('tasks/results');
      expect(taskResultsTool.category).toBe('task');
      expect(taskResultsTool.inputSchema.required).toContain('taskId');
      expect(taskResultsTool.cacheable).toBe(true);
    });

    it('should get task results', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task for results',
      }, mockContext);

      const result = await taskResultsTool.handler({
        taskId: createResult.taskId,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.taskId).toBe(createResult.taskId);
      expect(result.status).toBeDefined();
    });

    it('should support different result formats', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task for results',
      }, mockContext);

      const summaryResult = await taskResultsTool.handler({
        taskId: createResult.taskId,
        format: 'summary',
      }, mockContext);

      expect(summaryResult).toBeDefined();

      const detailedResult = await taskResultsTool.handler({
        taskId: createResult.taskId,
        format: 'detailed',
      }, mockContext);

      expect(detailedResult).toBeDefined();
    });

    it('should optionally include artifacts', async () => {
      const createResult = await createTaskTool.handler({
        type: 'code',
        description: 'Task for results',
      }, mockContext);

      const result = await taskResultsTool.handler({
        taskId: createResult.taskId,
        includeArtifacts: false,
      }, mockContext);

      expect(result.artifacts).toBeUndefined();
    });
  });

  describe('Tool Collection', () => {
    it('should export all 8 task tools', () => {
      expect(taskTools).toHaveLength(8);
    });

    it('should have unique tool names', () => {
      const names = taskTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should all have handlers', () => {
      taskTools.forEach(tool => {
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      });
    });

    it('should all have inputSchema', () => {
      taskTools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });

    it('should all be in task category', () => {
      taskTools.forEach(tool => {
        expect(tool.category).toBe('task');
      });
    });
  });
});
