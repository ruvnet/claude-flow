/**
 * V3 MCP Task Tools
 *
 * MCP tools for task management operations:
 * - tasks/create - Create a new task
 * - tasks/list - List tasks with filters
 * - tasks/status - Get task status
 * - tasks/cancel - Cancel running task
 * - tasks/assign - Assign task to agent
 * - tasks/update - Update task properties
 * - tasks/dependencies - Manage task dependencies
 * - tasks/results - Get task results
 *
 * Implements ADR-005: MCP-First API Design
 */

import { z } from 'zod';
import { randomBytes } from 'crypto';
import { MCPTool, ToolContext } from '../types.js';

// Secure ID generation helper
function generateSecureTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(12).toString('hex');
  return `task-${timestamp}-${random}`;
}

// ============================================================================
// Input Schemas
// ============================================================================

const createTaskSchema = z.object({
  type: z.string().min(1).describe('Task type (e.g., code, review, test, analyze)'),
  description: z.string().min(1).describe('Task description'),
  priority: z.number().int().min(1).max(10).default(5)
    .describe('Task priority (1=highest, 10=lowest)'),
  dependencies: z.array(z.string()).optional()
    .describe('Task IDs this task depends on'),
  assignToAgent: z.string().optional()
    .describe('Specific agent ID to assign the task to'),
  assignToAgentType: z.string().optional()
    .describe('Agent type to assign the task to (will pick available agent)'),
  input: z.record(z.unknown()).optional()
    .describe('Task input data'),
  timeout: z.number().int().positive().optional()
    .describe('Task timeout in milliseconds'),
  metadata: z.record(z.unknown()).optional()
    .describe('Additional metadata'),
});

const listTasksSchema = z.object({
  status: z.enum(['pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled', 'all'])
    .default('all')
    .describe('Filter by task status'),
  agentId: z.string().optional()
    .describe('Filter by assigned agent ID'),
  type: z.string().optional()
    .describe('Filter by task type'),
  priority: z.number().int().min(1).max(10).optional()
    .describe('Filter by priority'),
  limit: z.number().int().positive().max(1000).default(50)
    .describe('Maximum number of tasks to return'),
  offset: z.number().int().nonnegative().default(0)
    .describe('Offset for pagination'),
  sortBy: z.enum(['created', 'priority', 'status', 'updated']).default('created')
    .describe('Sort order'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
    .describe('Sort direction'),
});

const taskStatusSchema = z.object({
  taskId: z.string().describe('ID of the task to get status for'),
  includeMetrics: z.boolean().default(false)
    .describe('Include execution metrics'),
  includeHistory: z.boolean().default(false)
    .describe('Include status history'),
});

const cancelTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to cancel'),
  reason: z.string().optional()
    .describe('Reason for cancellation'),
  force: z.boolean().default(false)
    .describe('Force cancellation even if task is running'),
});

const assignTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to assign'),
  agentId: z.string().describe('ID of the agent to assign to'),
  reassign: z.boolean().default(false)
    .describe('Allow reassignment if task is already assigned'),
});

const updateTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to update'),
  priority: z.number().int().min(1).max(10).optional()
    .describe('New priority'),
  description: z.string().optional()
    .describe('New description'),
  timeout: z.number().int().positive().optional()
    .describe('New timeout'),
  metadata: z.record(z.unknown()).optional()
    .describe('Metadata to merge'),
});

const taskDependenciesSchema = z.object({
  taskId: z.string().describe('ID of the task'),
  action: z.enum(['add', 'remove', 'list', 'clear'])
    .describe('Action to perform on dependencies'),
  dependencies: z.array(z.string()).optional()
    .describe('Dependencies to add or remove'),
});

const taskResultsSchema = z.object({
  taskId: z.string().describe('ID of the task to get results for'),
  format: z.enum(['summary', 'detailed', 'raw']).default('summary')
    .describe('Result format'),
  includeArtifacts: z.boolean().default(true)
    .describe('Include generated artifacts'),
});

// ============================================================================
// Type Definitions
// ============================================================================

type TaskStatus = 'pending' | 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

interface Task {
  id: string;
  type: string;
  description: string;
  status: TaskStatus;
  priority: number;
  dependencies: string[];
  assignedTo?: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  timeout?: number;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface TaskWithMetrics extends Task {
  metrics?: {
    executionTime?: number;
    retryCount?: number;
    waitTime?: number;
    cpuUsage?: number;
    memoryUsage?: number;
  };
  history?: Array<{
    timestamp: string;
    status: TaskStatus;
    message?: string;
  }>;
}

interface TaskResult {
  taskId: string;
  status: TaskStatus;
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  artifacts?: Array<{
    name: string;
    type: string;
    path?: string;
    content?: string;
  }>;
  executionTime?: number;
  completedAt?: string;
}

interface CreateTaskResult {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  queuePosition?: number;
}

interface ListTasksResult {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

interface CancelTaskResult {
  taskId: string;
  cancelled: boolean;
  cancelledAt: string;
  previousStatus: TaskStatus;
  reason?: string;
}

interface AssignTaskResult {
  taskId: string;
  agentId: string;
  assigned: boolean;
  assignedAt: string;
  previousAgent?: string;
}

interface UpdateTaskResult {
  taskId: string;
  updated: boolean;
  updatedAt: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface TaskDependenciesResult {
  taskId: string;
  action: string;
  dependencies: string[];
  updatedAt?: string;
}

// ============================================================================
// In-memory task store (for simple implementation)
// ============================================================================

const taskStore = new Map<string, Task>();
const taskResults = new Map<string, TaskResult>();

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Create a new task
 */
async function handleCreateTask(
  input: z.infer<typeof createTaskSchema>,
  context?: ToolContext
): Promise<CreateTaskResult> {
  const taskId = generateSecureTaskId();
  const createdAt = new Date().toISOString();

  const task: Task = {
    id: taskId,
    type: input.type,
    description: input.description,
    status: 'pending',
    priority: input.priority,
    dependencies: input.dependencies || [],
    assignedTo: input.assignToAgent,
    createdAt,
    timeout: input.timeout,
    input: input.input,
    metadata: input.metadata,
  };

  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      // Submit task to orchestrator
      const result = await orchestrator.submitTask({
        id: taskId,
        type: input.type,
        description: input.description,
        priority: input.priority,
        dependencies: input.dependencies,
        assignedAgent: input.assignToAgent,
        input: input.input,
        timeout: input.timeout,
        metadata: input.metadata,
      });

      return {
        taskId: result.id || taskId,
        status: result.status || 'queued',
        createdAt,
        queuePosition: result.queuePosition,
      };
    } catch (error) {
      console.error('Failed to create task via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  if (task.assignedTo) {
    task.status = 'assigned';
  }

  taskStore.set(taskId, task);

  return {
    taskId,
    status: task.status,
    createdAt,
    queuePosition: taskStore.size,
  };
}

/**
 * List tasks with filters
 */
async function handleListTasks(
  input: z.infer<typeof listTasksSchema>,
  context?: ToolContext
): Promise<ListTasksResult> {
  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.listTasks({
        status: input.status === 'all' ? undefined : input.status,
        agentId: input.agentId,
        type: input.type,
        priority: input.priority,
        limit: input.limit,
        offset: input.offset,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      });

      return {
        tasks: result.tasks.map((t: any) => ({
          id: t.id,
          type: t.type,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dependencies: t.dependencies || [],
          assignedTo: t.assignedAgent,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          timeout: t.timeout,
          input: t.input,
          metadata: t.metadata,
        })),
        total: result.total,
        limit: input.limit,
        offset: input.offset,
      };
    } catch (error) {
      console.error('Failed to list tasks via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  let tasks = Array.from(taskStore.values());

  // Apply filters
  if (input.status !== 'all') {
    tasks = tasks.filter(t => t.status === input.status);
  }
  if (input.agentId) {
    tasks = tasks.filter(t => t.assignedTo === input.agentId);
  }
  if (input.type) {
    tasks = tasks.filter(t => t.type === input.type);
  }
  if (input.priority !== undefined) {
    tasks = tasks.filter(t => t.priority === input.priority);
  }

  // Apply sorting
  tasks.sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (input.sortBy) {
      case 'created':
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
        break;
      case 'priority':
        aVal = a.priority;
        bVal = b.priority;
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'updated':
        aVal = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt).getTime();
        bVal = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt).getTime();
        break;
      default:
        aVal = 0;
        bVal = 0;
    }

    if (input.sortOrder === 'asc') {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else {
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    }
  });

  const total = tasks.length;
  const paginated = tasks.slice(input.offset, input.offset + input.limit);

  return {
    tasks: paginated,
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

/**
 * Get task status
 */
async function handleTaskStatus(
  input: z.infer<typeof taskStatusSchema>,
  context?: ToolContext
): Promise<TaskWithMetrics> {
  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.getTaskStatus(input.taskId, {
        includeMetrics: input.includeMetrics,
        includeHistory: input.includeHistory,
      });

      const task: TaskWithMetrics = {
        id: result.id,
        type: result.type,
        description: result.description,
        status: result.status,
        priority: result.priority,
        dependencies: result.dependencies || [],
        assignedTo: result.assignedAgent,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        timeout: result.timeout,
        input: result.input,
        metadata: result.metadata,
      };

      if (input.includeMetrics && result.metrics) {
        task.metrics = result.metrics;
      }

      if (input.includeHistory && result.history) {
        task.history = result.history;
      }

      return task;
    } catch (error) {
      console.error('Failed to get task status via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const result: TaskWithMetrics = { ...task };

  if (input.includeMetrics) {
    result.metrics = {
      executionTime: 0,
      retryCount: 0,
      waitTime: 0,
    };
  }

  if (input.includeHistory) {
    result.history = [
      {
        timestamp: task.createdAt,
        status: 'pending',
        message: 'Task created',
      },
    ];
    if (task.status !== 'pending') {
      result.history.push({
        timestamp: task.updatedAt || task.createdAt,
        status: task.status,
        message: `Status changed to ${task.status}`,
      });
    }
  }

  return result;
}

/**
 * Cancel a task
 */
async function handleCancelTask(
  input: z.infer<typeof cancelTaskSchema>,
  context?: ToolContext
): Promise<CancelTaskResult> {
  const cancelledAt = new Date().toISOString();

  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.cancelTask(input.taskId, {
        reason: input.reason,
        force: input.force,
      });

      return {
        taskId: input.taskId,
        cancelled: result.cancelled,
        cancelledAt,
        previousStatus: result.previousStatus,
        reason: input.reason,
      };
    } catch (error) {
      console.error('Failed to cancel task via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const previousStatus = task.status;

  // Check if task can be cancelled
  if (task.status === 'completed' || task.status === 'cancelled') {
    return {
      taskId: input.taskId,
      cancelled: false,
      cancelledAt,
      previousStatus,
      reason: `Task is already ${task.status}`,
    };
  }

  if (task.status === 'running' && !input.force) {
    return {
      taskId: input.taskId,
      cancelled: false,
      cancelledAt,
      previousStatus,
      reason: 'Task is running. Use force=true to cancel.',
    };
  }

  // Cancel the task
  task.status = 'cancelled';
  task.updatedAt = cancelledAt;
  task.completedAt = cancelledAt;
  if (input.reason) {
    task.metadata = { ...task.metadata, cancelReason: input.reason };
  }

  return {
    taskId: input.taskId,
    cancelled: true,
    cancelledAt,
    previousStatus,
    reason: input.reason,
  };
}

/**
 * Assign a task to an agent
 */
async function handleAssignTask(
  input: z.infer<typeof assignTaskSchema>,
  context?: ToolContext
): Promise<AssignTaskResult> {
  const assignedAt = new Date().toISOString();

  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.assignTask(input.taskId, input.agentId, {
        reassign: input.reassign,
      });

      return {
        taskId: input.taskId,
        agentId: input.agentId,
        assigned: result.assigned,
        assignedAt,
        previousAgent: result.previousAgent,
      };
    } catch (error) {
      console.error('Failed to assign task via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const previousAgent = task.assignedTo;

  // Check if task can be assigned
  if (task.assignedTo && !input.reassign) {
    return {
      taskId: input.taskId,
      agentId: input.agentId,
      assigned: false,
      assignedAt,
      previousAgent,
    };
  }

  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
    throw new Error(`Cannot assign task with status: ${task.status}`);
  }

  // Assign the task
  task.assignedTo = input.agentId;
  task.status = 'assigned';
  task.updatedAt = assignedAt;

  return {
    taskId: input.taskId,
    agentId: input.agentId,
    assigned: true,
    assignedAt,
    previousAgent,
  };
}

/**
 * Update task properties
 */
async function handleUpdateTask(
  input: z.infer<typeof updateTaskSchema>,
  context?: ToolContext
): Promise<UpdateTaskResult> {
  const updatedAt = new Date().toISOString();
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.updateTask(input.taskId, {
        priority: input.priority,
        description: input.description,
        timeout: input.timeout,
        metadata: input.metadata,
      });

      return {
        taskId: input.taskId,
        updated: result.updated,
        updatedAt,
        changes: result.changes || {},
      };
    } catch (error) {
      console.error('Failed to update task via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  // Check if task can be updated
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error(`Cannot update task with status: ${task.status}`);
  }

  // Apply updates
  if (input.priority !== undefined && input.priority !== task.priority) {
    changes.priority = { from: task.priority, to: input.priority };
    task.priority = input.priority;
  }

  if (input.description !== undefined && input.description !== task.description) {
    changes.description = { from: task.description, to: input.description };
    task.description = input.description;
  }

  if (input.timeout !== undefined && input.timeout !== task.timeout) {
    changes.timeout = { from: task.timeout, to: input.timeout };
    task.timeout = input.timeout;
  }

  if (input.metadata) {
    changes.metadata = { from: task.metadata, to: { ...task.metadata, ...input.metadata } };
    task.metadata = { ...task.metadata, ...input.metadata };
  }

  task.updatedAt = updatedAt;

  return {
    taskId: input.taskId,
    updated: Object.keys(changes).length > 0,
    updatedAt,
    changes,
  };
}

/**
 * Manage task dependencies
 */
async function handleTaskDependencies(
  input: z.infer<typeof taskDependenciesSchema>,
  context?: ToolContext
): Promise<TaskDependenciesResult> {
  const updatedAt = new Date().toISOString();

  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      let result;
      switch (input.action) {
        case 'add':
          result = await orchestrator.addTaskDependencies(input.taskId, input.dependencies || []);
          break;
        case 'remove':
          result = await orchestrator.removeTaskDependencies(input.taskId, input.dependencies || []);
          break;
        case 'list':
          result = await orchestrator.getTaskDependencies(input.taskId);
          break;
        case 'clear':
          result = await orchestrator.clearTaskDependencies(input.taskId);
          break;
      }

      return {
        taskId: input.taskId,
        action: input.action,
        dependencies: result?.dependencies || [],
        updatedAt: input.action !== 'list' ? updatedAt : undefined,
      };
    } catch (error) {
      console.error('Failed to manage task dependencies via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  switch (input.action) {
    case 'add':
      if (input.dependencies) {
        task.dependencies = Array.from(new Set([...task.dependencies, ...input.dependencies]));
        task.updatedAt = updatedAt;
      }
      break;
    case 'remove':
      if (input.dependencies) {
        task.dependencies = task.dependencies.filter(d => !input.dependencies!.includes(d));
        task.updatedAt = updatedAt;
      }
      break;
    case 'list':
      // No changes needed
      break;
    case 'clear':
      task.dependencies = [];
      task.updatedAt = updatedAt;
      break;
  }

  return {
    taskId: input.taskId,
    action: input.action,
    dependencies: task.dependencies,
    updatedAt: input.action !== 'list' ? updatedAt : undefined,
  };
}

/**
 * Get task results
 */
async function handleTaskResults(
  input: z.infer<typeof taskResultsSchema>,
  context?: ToolContext
): Promise<TaskResult> {
  // Try to use orchestrator if available
  if (context?.orchestrator) {
    try {
      const orchestrator = context.orchestrator as any;

      const result = await orchestrator.getTaskResults(input.taskId, {
        format: input.format,
        includeArtifacts: input.includeArtifacts,
      });

      return {
        taskId: input.taskId,
        status: result.status,
        success: result.success,
        output: result.output,
        error: result.error,
        artifacts: input.includeArtifacts ? result.artifacts : undefined,
        executionTime: result.executionTime,
        completedAt: result.completedAt,
      };
    } catch (error) {
      console.error('Failed to get task results via orchestrator:', error);
      // Fall through to simple implementation
    }
  }

  // Simple implementation
  const task = taskStore.get(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  // Check if task has results
  const result = taskResults.get(input.taskId);
  if (result) {
    return {
      ...result,
      artifacts: input.includeArtifacts ? result.artifacts : undefined,
    };
  }

  // Task exists but no results yet
  return {
    taskId: input.taskId,
    status: task.status,
    success: task.status === 'completed',
    output: undefined,
    error: task.status === 'failed' ? {
      code: 'TASK_FAILED',
      message: 'Task failed to complete',
    } : undefined,
    completedAt: task.completedAt,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * tasks/create tool
 */
export const createTaskTool: MCPTool = {
  name: 'tasks/create',
  description: 'Create a new task for execution with specified type, priority, and configuration',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Task type (e.g., code, review, test, analyze)',
      },
      description: {
        type: 'string',
        description: 'Task description',
      },
      priority: {
        type: 'number',
        description: 'Task priority (1=highest, 10=lowest)',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs this task depends on',
      },
      assignToAgent: {
        type: 'string',
        description: 'Specific agent ID to assign the task to',
      },
      assignToAgentType: {
        type: 'string',
        description: 'Agent type to assign the task to',
      },
      input: {
        type: 'object',
        description: 'Task input data',
        additionalProperties: true,
      },
      timeout: {
        type: 'number',
        description: 'Task timeout in milliseconds',
        minimum: 1,
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        additionalProperties: true,
      },
    },
    required: ['type', 'description'],
  },
  handler: async (input, context) => {
    const validated = createTaskSchema.parse(input);
    return handleCreateTask(validated, context);
  },
  category: 'task',
  tags: ['task', 'create', 'orchestration'],
  version: '1.0.0',
};

/**
 * tasks/list tool
 */
export const listTasksTool: MCPTool = {
  name: 'tasks/list',
  description: 'List tasks with optional filtering, sorting, and pagination',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled', 'all'],
        description: 'Filter by task status',
        default: 'all',
      },
      agentId: {
        type: 'string',
        description: 'Filter by assigned agent ID',
      },
      type: {
        type: 'string',
        description: 'Filter by task type',
      },
      priority: {
        type: 'number',
        description: 'Filter by priority',
        minimum: 1,
        maximum: 10,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of tasks to return',
        minimum: 1,
        maximum: 1000,
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination',
        minimum: 0,
        default: 0,
      },
      sortBy: {
        type: 'string',
        enum: ['created', 'priority', 'status', 'updated'],
        description: 'Sort order',
        default: 'created',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction',
        default: 'desc',
      },
    },
  },
  handler: async (input, context) => {
    const validated = listTasksSchema.parse(input);
    return handleListTasks(validated, context);
  },
  category: 'task',
  tags: ['task', 'list', 'query'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 2000,
};

/**
 * tasks/status tool
 */
export const taskStatusTool: MCPTool = {
  name: 'tasks/status',
  description: 'Get detailed status of a specific task including optional metrics and history',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to get status for',
      },
      includeMetrics: {
        type: 'boolean',
        description: 'Include execution metrics',
        default: false,
      },
      includeHistory: {
        type: 'boolean',
        description: 'Include status history',
        default: false,
      },
    },
    required: ['taskId'],
  },
  handler: async (input, context) => {
    const validated = taskStatusSchema.parse(input);
    return handleTaskStatus(validated, context);
  },
  category: 'task',
  tags: ['task', 'status', 'monitoring'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 1000,
};

/**
 * tasks/cancel tool
 */
export const cancelTaskTool: MCPTool = {
  name: 'tasks/cancel',
  description: 'Cancel a pending or running task',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to cancel',
      },
      reason: {
        type: 'string',
        description: 'Reason for cancellation',
      },
      force: {
        type: 'boolean',
        description: 'Force cancellation even if task is running',
        default: false,
      },
    },
    required: ['taskId'],
  },
  handler: async (input, context) => {
    const validated = cancelTaskSchema.parse(input);
    return handleCancelTask(validated, context);
  },
  category: 'task',
  tags: ['task', 'cancel', 'lifecycle'],
  version: '1.0.0',
};

/**
 * tasks/assign tool
 */
export const assignTaskTool: MCPTool = {
  name: 'tasks/assign',
  description: 'Assign a task to a specific agent',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to assign',
      },
      agentId: {
        type: 'string',
        description: 'ID of the agent to assign to',
      },
      reassign: {
        type: 'boolean',
        description: 'Allow reassignment if task is already assigned',
        default: false,
      },
    },
    required: ['taskId', 'agentId'],
  },
  handler: async (input, context) => {
    const validated = assignTaskSchema.parse(input);
    return handleAssignTask(validated, context);
  },
  category: 'task',
  tags: ['task', 'assign', 'agent'],
  version: '1.0.0',
};

/**
 * tasks/update tool
 */
export const updateTaskTool: MCPTool = {
  name: 'tasks/update',
  description: 'Update task properties like priority, description, timeout, or metadata',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to update',
      },
      priority: {
        type: 'number',
        description: 'New priority',
        minimum: 1,
        maximum: 10,
      },
      description: {
        type: 'string',
        description: 'New description',
      },
      timeout: {
        type: 'number',
        description: 'New timeout in milliseconds',
        minimum: 1,
      },
      metadata: {
        type: 'object',
        description: 'Metadata to merge',
        additionalProperties: true,
      },
    },
    required: ['taskId'],
  },
  handler: async (input, context) => {
    const validated = updateTaskSchema.parse(input);
    return handleUpdateTask(validated, context);
  },
  category: 'task',
  tags: ['task', 'update', 'modify'],
  version: '1.0.0',
};

/**
 * tasks/dependencies tool
 */
export const taskDependenciesTool: MCPTool = {
  name: 'tasks/dependencies',
  description: 'Manage task dependencies - add, remove, list, or clear',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task',
      },
      action: {
        type: 'string',
        enum: ['add', 'remove', 'list', 'clear'],
        description: 'Action to perform on dependencies',
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dependencies to add or remove',
      },
    },
    required: ['taskId', 'action'],
  },
  handler: async (input, context) => {
    const validated = taskDependenciesSchema.parse(input);
    return handleTaskDependencies(validated, context);
  },
  category: 'task',
  tags: ['task', 'dependencies', 'dag'],
  version: '1.0.0',
};

/**
 * tasks/results tool
 */
export const taskResultsTool: MCPTool = {
  name: 'tasks/results',
  description: 'Get results from a completed task including output, errors, and artifacts',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to get results for',
      },
      format: {
        type: 'string',
        enum: ['summary', 'detailed', 'raw'],
        description: 'Result format',
        default: 'summary',
      },
      includeArtifacts: {
        type: 'boolean',
        description: 'Include generated artifacts',
        default: true,
      },
    },
    required: ['taskId'],
  },
  handler: async (input, context) => {
    const validated = taskResultsSchema.parse(input);
    return handleTaskResults(validated, context);
  },
  category: 'task',
  tags: ['task', 'results', 'output'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 5000,
};

// ============================================================================
// Exports
// ============================================================================

export const taskTools: MCPTool[] = [
  createTaskTool,
  listTasksTool,
  taskStatusTool,
  cancelTaskTool,
  assignTaskTool,
  updateTaskTool,
  taskDependenciesTool,
  taskResultsTool,
];

export default taskTools;
