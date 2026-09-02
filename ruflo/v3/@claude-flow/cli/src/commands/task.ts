/**
 * V3 CLI Task Command
 * Task management for Claude Flow
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input, multiSelect } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Task types
const TASK_TYPES = [
  { value: 'implementation', label: 'Implementation', hint: 'Feature implementation' },
  { value: 'bug-fix', label: 'Bug Fix', hint: 'Fix a bug or issue' },
  { value: 'refactoring', label: 'Refactoring', hint: 'Code refactoring' },
  { value: 'testing', label: 'Testing', hint: 'Write or update tests' },
  { value: 'documentation', label: 'Documentation', hint: 'Documentation updates' },
  { value: 'research', label: 'Research', hint: 'Research and analysis' },
  { value: 'review', label: 'Review', hint: 'Code review' },
  { value: 'optimization', label: 'Optimization', hint: 'Performance optimization' },
  { value: 'security', label: 'Security', hint: 'Security audit or fix' },
  { value: 'custom', label: 'Custom', hint: 'Custom task type' }
];

// Task priorities
const TASK_PRIORITIES = [
  { value: 'critical', label: 'Critical', hint: 'Highest priority' },
  { value: 'high', label: 'High', hint: 'Important task' },
  { value: 'normal', label: 'Normal', hint: 'Standard priority' },
  { value: 'low', label: 'Low', hint: 'Lower priority' }
];

// Format task status with color
function formatStatus(status: string): string {
  switch (status) {
    case 'completed':
      return output.success(status);
    case 'running':
    case 'in_progress':
      return output.info(status);
    case 'pending':
    case 'queued':
      return output.warning(status);
    case 'failed':
    case 'cancelled':
      return output.error(status);
    default:
      return status;
  }
}

// Format priority with color
function formatPriority(priority: string): string {
  switch (priority) {
    case 'critical':
      return output.error(priority);
    case 'high':
      return output.warning(priority);
    case 'normal':
      return priority;
    case 'low':
      return output.dim(priority);
    default:
      return priority;
  }
}

// Create subcommand
const createCommand: Command = {
  name: 'create',
  aliases: ['new', 'add'],
  description: 'Create a new task',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Task type',
      type: 'string',
      choices: TASK_TYPES.map(t => t.value)
    },
    {
      name: 'description',
      short: 'd',
      description: 'Task description',
      type: 'string'
    },
    {
      name: 'priority',
      short: 'p',
      description: 'Task priority',
      type: 'string',
      choices: TASK_PRIORITIES.map(p => p.value),
      default: 'normal'
    },
    {
      name: 'assign',
      short: 'a',
      description: 'Assign to agent(s)',
      type: 'string'
    },
    {
      name: 'tags',
      description: 'Comma-separated tags',
      type: 'string'
    },
    {
      name: 'parent',
      description: 'Parent task ID',
      type: 'string'
    },
    {
      name: 'dependencies',
      description: 'Comma-separated task IDs that must complete first',
      type: 'string'
    },
    {
      name: 'timeout',
      description: 'Task timeout in seconds',
      type: 'number',
      default: 300
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let taskType = ctx.flags.type as string;
    let description = ctx.flags.description as string;
    let priority = ctx.flags.priority as string;

    // Interactive mode
    if (!taskType && ctx.interactive) {
      taskType = await select({
        message: 'Select task type:',
        options: TASK_TYPES
      });
    }

    if (!description && ctx.interactive) {
      description = await input({
        message: 'Task description:',
        validate: (v) => v.length > 0 || 'Description is required'
      });
    }

    if (!taskType || !description) {
      output.printError('Task type and description are required');
      output.printInfo('Use --type and --description flags, or run in interactive mode');
      return { success: false, exitCode: 1 };
    }

    if (!priority && ctx.interactive) {
      priority = await select({
        message: 'Select priority:',
        options: TASK_PRIORITIES,
        default: 'normal'
      });
    }

    // Parse tags and dependencies
    const tags = ctx.flags.tags ? (ctx.flags.tags as string).split(',').map(t => t.trim()) : [];
    const dependencies = ctx.flags.dependencies
      ? (ctx.flags.dependencies as string).split(',').map(d => d.trim())
      : [];

    output.writeln();
    output.printInfo(`Creating ${taskType} task...`);

    try {
      const result = await callMCPTool<{
        taskId: string;
        type: string;
        description: string;
        priority: string;
        status: string;
        createdAt: string;
        assignedTo?: string[];
        tags: string[];
      }>('task/create', {
        type: taskType,
        description,
        priority: priority || 'normal',
        assignedTo: ctx.flags.assign ? [ctx.flags.assign] : undefined,
        parentId: ctx.flags.parent,
        dependencies,
        tags,
        timeout: ctx.flags.timeout,
        metadata: {
          source: 'cli',
          createdBy: 'user'
        }
      });

      output.writeln();
      output.printSuccess(`Task created: ${result.taskId}`);
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'ID', value: result.taskId },
          { property: 'Type', value: result.type },
          { property: 'Description', value: result.description },
          { property: 'Priority', value: formatPriority(result.priority) },
          { property: 'Status', value: formatStatus(result.status) },
          { property: 'Assigned To', value: result.assignedTo?.join(', ') || 'Unassigned' },
          { property: 'Tags', value: result.tags.join(', ') || 'None' },
          { property: 'Created', value: new Date(result.createdAt).toLocaleString() }
        ]
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to create task: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// List subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List tasks',
  options: [
    {
      name: 'status',
      short: 's',
      description: 'Filter by status',
      type: 'string',
      choices: ['pending', 'running', 'completed', 'failed', 'cancelled', 'all']
    },
    {
      name: 'type',
      short: 't',
      description: 'Filter by task type',
      type: 'string'
    },
    {
      name: 'priority',
      short: 'p',
      description: 'Filter by priority',
      type: 'string'
    },
    {
      name: 'agent',
      short: 'a',
      description: 'Filter by assigned agent',
      type: 'string'
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum number of tasks to show',
      type: 'number',
      default: 20
    },
    {
      name: 'all',
      description: 'Show all tasks including completed',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const status = ctx.flags.all ? 'all' : (ctx.flags.status as string) || 'pending,running';
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        tasks: Array<{
          id: string;
          type: string;
          description: string;
          priority: string;
          status: string;
          assignedTo?: string[];
          progress: number;
          createdAt: string;
        }>;
        total: number;
      }>('task/list', {
        status,
        type: ctx.flags.type,
        priority: ctx.flags.priority,
        agentId: ctx.flags.agent,
        limit,
        offset: 0
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Tasks'));
      output.writeln();

      if (result.tasks.length === 0) {
        output.printInfo('No tasks found matching criteria');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 15 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'description', header: 'Description', width: 30 },
          { key: 'priority', header: 'Priority', width: 10 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'progress', header: 'Progress', width: 10 }
        ],
        data: result.tasks.map(t => ({
          id: t.id,
          type: t.type,
          description: t.description.length > 27
            ? t.description.slice(0, 27) + '...'
            : t.description,
          priority: formatPriority(t.priority),
          status: formatStatus(t.status),
          progress: `${t.progress}%`
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.tasks.length} of ${result.total} tasks`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list tasks: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Status subcommand (get task details)
const statusCommand: Command = {
  name: 'status',
  aliases: ['info', 'get'],
  description: 'Get task status and details',
  options: [
    {
      name: 'id',
      description: 'Task ID',
      type: 'string'
    },
    {
      name: 'logs',
      description: 'Include execution logs',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let taskId = ctx.args[0] || ctx.flags.id as string;

    if (!taskId && ctx.interactive) {
      taskId = await input({
        message: 'Enter task ID:',
        validate: (v) => v.length > 0 || 'Task ID is required'
      });
    }

    if (!taskId) {
      output.printError('Task ID is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        id: string;
        type: string;
        description: string;
        priority: string;
        status: string;
        progress: number;
        assignedTo?: string[];
        parentId?: string;
        dependencies: string[];
        dependents: string[];
        tags: string[];
        createdAt: string;
        startedAt?: string;
        completedAt?: string;
        result?: unknown;
        error?: string;
        logs?: Array<{ timestamp: string; level: string; message: string }>;
        metrics?: {
          executionTime: number;
          retries: number;
          tokensUsed: number;
        };
      }>('task/status', {
        taskId,
        includeLogs: ctx.flags.logs,
        includeMetrics: true
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Type:        ${result.type}`,
          `Status:      ${formatStatus(result.status)}`,
          `Priority:    ${formatPriority(result.priority)}`,
          `Progress:    ${result.progress}%`,
          '',
          `Description: ${result.description}`
        ].join('\n'),
        `Task: ${result.id}`
      );

      // Assignment info
      output.writeln();
      output.writeln(output.bold('Assignment'));
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'Assigned To', value: result.assignedTo?.join(', ') || 'Unassigned' },
          { property: 'Parent Task', value: result.parentId || 'None' },
          { property: 'Dependencies', value: result.dependencies.join(', ') || 'None' },
          { property: 'Dependents', value: result.dependents.join(', ') || 'None' },
          { property: 'Tags', value: result.tags.join(', ') || 'None' }
        ]
      });

      // Timeline
      output.writeln();
      output.writeln(output.bold('Timeline'));
      output.printTable({
        columns: [
          { key: 'event', header: 'Event', width: 15 },
          { key: 'time', header: 'Time', width: 30 }
        ],
        data: [
          { event: 'Created', time: new Date(result.createdAt).toLocaleString() },
          { event: 'Started', time: result.startedAt ? new Date(result.startedAt).toLocaleString() : '-' },
          { event: 'Completed', time: result.completedAt ? new Date(result.completedAt).toLocaleString() : '-' }
        ]
      });

      // Metrics
      if (result.metrics) {
        output.writeln();
        output.writeln(output.bold('Metrics'));
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 20 },
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Execution Time', value: `${(result.metrics.executionTime / 1000).toFixed(2)}s` },
            { metric: 'Retries', value: result.metrics.retries },
            { metric: 'Tokens Used', value: result.metrics.tokensUsed.toLocaleString() }
          ]
        });
      }

      // Error if failed
      if (result.status === 'failed' && result.error) {
        output.writeln();
        output.printError(`Error: ${result.error}`);
      }

      // Logs if requested
      if (ctx.flags.logs && result.logs && result.logs.length > 0) {
        output.writeln();
        output.writeln(output.bold('Execution Logs'));
        for (const log of result.logs.slice(-20)) {
          const time = new Date(log.timestamp).toLocaleTimeString();
          const level = log.level === 'error' ? output.error(`[${log.level}]`) :
                        log.level === 'warn' ? output.warning(`[${log.level}]`) :
                        output.dim(`[${log.level}]`);
          output.writeln(`  ${output.dim(time)} ${level} ${log.message}`);
        }
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get task status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Cancel subcommand
const cancelCommand: Command = {
  name: 'cancel',
  aliases: ['abort', 'stop'],
  description: 'Cancel a running task',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force cancel without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'reason',
      short: 'r',
      description: 'Cancellation reason',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];
    const force = ctx.flags.force as boolean;
    const reason = ctx.flags.reason as string;

    if (!taskId) {
      output.printError('Task ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Are you sure you want to cancel task ${taskId}?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    try {
      const result = await callMCPTool<{
        taskId: string;
        cancelled: boolean;
        previousStatus: string;
        cancelledAt: string;
      }>('task/cancel', {
        taskId,
        reason: reason || 'Cancelled by user via CLI'
      });

      output.writeln();
      output.printSuccess(`Task ${taskId} cancelled`);
      output.printInfo(`Previous status: ${result.previousStatus}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to cancel task: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Assign subcommand
const assignCommand: Command = {
  name: 'assign',
  description: 'Assign a task to agent(s)',
  options: [
    {
      name: 'agent',
      short: 'a',
      description: 'Agent ID(s) to assign (comma-separated)',
      type: 'string'
    },
    {
      name: 'unassign',
      description: 'Remove current assignment',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];
    const agentIds = ctx.flags.agent as string;
    const unassign = ctx.flags.unassign as boolean;

    if (!taskId) {
      output.printError('Task ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!agentIds && !unassign) {
      // Interactive agent selection
      if (ctx.interactive) {
        try {
          const agents = await callMCPTool<{
            agents: Array<{ id: string; type: string; status: string }>;
          }>('agent/list', { status: 'active,idle' });

          if (agents.agents.length === 0) {
            output.printWarning('No available agents');
            return { success: false, exitCode: 1 };
          }

          const selectedAgents = await multiSelect({
            message: 'Select agent(s) to assign:',
            options: agents.agents.map(a => ({
              value: a.id,
              label: a.id,
              hint: `${a.type} - ${a.status}`
            })),
            required: true
          });

          if (selectedAgents.length === 0) {
            output.printInfo('No agents selected');
            return { success: true };
          }

          // Continue with assignment
          const result = await callMCPTool<{
            taskId: string;
            assignedTo: string[];
            previouslyAssigned: string[];
          }>('task/assign', {
            taskId,
            agentIds: selectedAgents
          });

          output.writeln();
          output.printSuccess(`Task ${taskId} assigned to ${result.assignedTo.join(', ')}`);

          return { success: true, data: result };
        } catch (error) {
          if (error instanceof Error && error.message === 'User cancelled') {
            output.printInfo('Operation cancelled');
            return { success: true };
          }
          throw error;
        }
      }

      output.printError('Agent ID is required. Use --agent flag or run in interactive mode');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        taskId: string;
        assignedTo: string[];
        previouslyAssigned: string[];
      }>('task/assign', {
        taskId,
        agentIds: unassign ? [] : agentIds.split(',').map(id => id.trim()),
        unassign
      });

      output.writeln();
      if (unassign) {
        output.printSuccess(`Task ${taskId} unassigned`);
      } else {
        output.printSuccess(`Task ${taskId} assigned to ${result.assignedTo.join(', ')}`);
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to assign task: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Retry subcommand
const retryCommand: Command = {
  name: 'retry',
  aliases: ['rerun'],
  description: 'Retry a failed task',
  options: [
    {
      name: 'reset-state',
      description: 'Reset task state completely',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args[0];
    const resetState = ctx.flags['reset-state'] as boolean;

    if (!taskId) {
      output.printError('Task ID is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        taskId: string;
        newTaskId: string;
        previousStatus: string;
        status: string;
      }>('task/retry', {
        taskId,
        resetState
      });

      output.writeln();
      output.printSuccess(`Task ${taskId} retried`);
      output.printInfo(`New task ID: ${result.newTaskId}`);
      output.printInfo(`Status: ${formatStatus(result.status)}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to retry task: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Main task command
export const taskCommand: Command = {
  name: 'task',
  description: 'Task management commands',
  subcommands: [createCommand, listCommand, statusCommand, cancelCommand, assignCommand, retryCommand],
  options: [],
  examples: [
    { command: 'claude-flow task create -t implementation -d "Add user auth"', description: 'Create a task' },
    { command: 'claude-flow task list', description: 'List pending/running tasks' },
    { command: 'claude-flow task list --all', description: 'List all tasks' },
    { command: 'claude-flow task status task-123', description: 'Get task details' },
    { command: 'claude-flow task cancel task-123', description: 'Cancel a task' },
    { command: 'claude-flow task assign task-123 --agent coder-1', description: 'Assign task to agent' },
    { command: 'claude-flow task retry task-123', description: 'Retry a failed task' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Task Management Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow task <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('create')}  - Create a new task`,
      `${output.highlight('list')}    - List tasks`,
      `${output.highlight('status')}  - Get task details`,
      `${output.highlight('cancel')}  - Cancel a running task`,
      `${output.highlight('assign')}  - Assign task to agent(s)`,
      `${output.highlight('retry')}   - Retry a failed task`
    ]);
    output.writeln();
    output.writeln('Run "claude-flow task <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

export default taskCommand;
