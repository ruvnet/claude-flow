// Task command creators
import type { TaskCommandContext } from './types.js';

export function createTaskCreateCommand(context: TaskCommandContext) {
  return {
    name: 'create',
    description: 'Create a new task',
    execute: async (args: any) => {
      try {
        const task = await context.taskEngine.createTask(args);
        context.logger?.info('Task created successfully', { taskId: task.id });
        return task;
      } catch (error) {
        context.logger?.error('Failed to create task', error);
        throw error;
      }
    },
  };
}

export function createTaskListCommand(context: TaskCommandContext) {
  return {
    name: 'list',
    description: 'List all tasks',
    execute: async (filter?: any, sort?: any, limit?: number, offset?: number) => {
      try {
        const result = await context.taskEngine.listTasks(filter, sort, limit, offset);
        context.logger?.info('Tasks listed successfully', { count: result.tasks.length });
        return result;
      } catch (error) {
        context.logger?.error('Failed to list tasks', error);
        throw error;
      }
    },
  };
}

export function createTaskStatusCommand(context: TaskCommandContext) {
  return {
    name: 'status',
    description: 'Get task status',
    execute: async (taskId: string) => {
      try {
        const status = await context.taskEngine.getTaskStatus(taskId);
        if (!status) {
          throw new Error(`Task ${taskId} not found`);
        }
        context.logger?.info('Task status retrieved', { taskId });
        return status;
      } catch (error) {
        context.logger?.error('Failed to get task status', error);
        throw error;
      }
    },
  };
}

export function createTaskCancelCommand(context: TaskCommandContext) {
  return {
    name: 'cancel',
    description: 'Cancel a task',
    execute: async (
      taskId: string,
      reason: string = 'User requested',
      rollback: boolean = true,
    ) => {
      try {
        await context.taskEngine.cancelTask(taskId, reason, rollback);
        context.logger?.info('Task cancelled successfully', { taskId, reason });
        return { success: true, taskId, reason };
      } catch (error) {
        context.logger?.error('Failed to cancel task', error);
        throw error;
      }
    },
  };
}

export function createTaskWorkflowCommand(context: TaskCommandContext) {
  return {
    name: 'workflow',
    description: 'Manage task workflows',
    execute: async (action: 'create' | 'execute' | 'list' | 'get', ...args: any[]) => {
      try {
        switch (action) {
          case 'create':
            const [workflowData] = args;
            const createdWorkflow = await context.taskEngine.createWorkflow(workflowData);
            context.logger?.info('Workflow created successfully', {
              workflowId: createdWorkflow.id,
            });
            return createdWorkflow;
          case 'execute':
            const [workflowToExecute] = args;
            await context.taskEngine.executeWorkflow(workflowToExecute);
            context.logger?.info('Workflow execution started', {
              workflowId: workflowToExecute.id,
            });
            return { success: true, workflowId: workflowToExecute.id };
          case 'list':
            context.logger?.info('Workflow list requested');
            return { workflows: [] }; // Would need additional implementation
          case 'get':
            const [workflowId] = args;
            context.logger?.info('Workflow details requested', { workflowId });
            return { workflowId }; // Would need additional implementation
          default:
            throw new Error(`Unknown workflow action: ${action}`);
        }
      } catch (error) {
        context.logger?.error('Workflow operation failed', error);
        throw error;
      }
    },
  };
}
