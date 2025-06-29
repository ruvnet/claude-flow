/**
 * Comprehensive Task Management Commands
 * Integrates with TodoWrite/TodoRead for coordination and Memory for persistence
 */

import { Command } from '../utils/cliffy-compat/command.js';
import chalk from 'chalk';
import { TaskEngine, WorkflowTask, TaskFilter, TaskSort, Workflow, ResourceRequirement, TaskSchedule } from './engine';
import { TaskStatus } from '../utils/types';
import { generateId } from '../utils/helpers';

import type { IMemoryManager } from '../memory/manager';
import type { ILogger } from '../core/logger';

// Command option types
export interface TaskCreateOptions {
  depends?: string[];
  dependencies?: string;
  depType?: string;
  depLag?: string;
  priority?: number;
  assignTo?: string;
  resources?: string[];
  memory?: number;
  cpu?: number;
  disk?: string;
  network?: string;
  exclusiveResources?: boolean;
  timeout?: number;
  retries?: number;
  schedule?: string;
  recurrence?: string;
  startTime?: string;
  deadline?: string;
  recurring?: string;
  recurringCount?: string;
  timezone?: string;
  estimatedDuration?: string;
  retryBackoff?: string;
  retryMultiplier?: string;
  rollback?: string;
  input?: string;
  dryRun?: boolean;
  tags?: string;
}

export interface TaskListOptions {
  status?: string;
  assignedTo?: string;
  agent?: string;
  priority?: string;
  createdAfter?: string;
  createdBefore?: string;
  dueBefore?: string;
  search?: string;
  tags?: string;
  sort?: string;
  sortDir?: string;
  offset?: number;
  limit?: number;
  verbose?: boolean;
  json?: boolean;
  graph?: boolean;
  format?: string;
  showDependencies?: boolean;
  showProgress?: boolean;
  showMetrics?: boolean;
}

export interface TaskOptions {
  watch?: boolean;
  json?: boolean;
  format?: string;
  showDependencies?: boolean;
  showResources?: boolean;
  showCheckpoints?: boolean;
  showMetrics?: boolean;
  showLogs?: boolean;
  force?: boolean;
  cascade?: boolean;
  noRollback?: boolean;
  reason?: string;
  dryRun?: boolean;
}

export interface WorkflowOptions {
  dryRun?: boolean;
  parallel?: boolean;
  continueOnError?: boolean;
  verbose?: boolean;
  description?: string;
  maxConcurrent?: string;
  strategy?: string;
  errorHandling?: string;
  maxRetries?: string;
  file?: string;
  monitor?: boolean;
  format?: string;
  output?: string;
}

export interface TaskCommandContext {
  taskEngine: TaskEngine;
  memoryManager?: IMemoryManager;
  logger?: ILogger;
}

/**
 * Task Create Command - Create tasks with dependencies, priority, scheduling, resource requirements
 */
export function createTaskCreateCommand(context: TaskCommandContext): Command {
  return new Command('create')
    .description('Create a new task with comprehensive options')
    .argument('<type>', 'Task type (e.g., research, development, analysis)')
    .argument('<description>', 'Task description')
    .option('-p, --priority <number>', 'Task priority (0-100)', '50')
    .option('-d, --dependencies <deps>', 'Comma-separated dependency task IDs')
    .option('--dep-type <type>', 'Dependency type: finish-to-start, start-to-start, finish-to-finish, start-to-finish', 'finish-to-start')
    .option('--dep-lag <ms>', 'Dependency lag in milliseconds', '0')
    .option('-a, --assign <agent>', 'Assign to specific agent')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('--timeout <ms>', 'Task timeout in milliseconds', '300000')
    .option('--estimated-duration <ms>', 'Estimated duration in milliseconds')
    .option('--max-retries <count>', 'Maximum retry attempts', '3')
    .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '1000')
    .option('--retry-multiplier <factor>', 'Retry backoff multiplier', '2')
    .option('--rollback <strategy>', 'Rollback strategy: previous-checkpoint, initial-state, custom', 'previous-checkpoint')
    .option('--start-time <datetime>', 'Scheduled start time (ISO format)')
    .option('--deadline <datetime>', 'Task deadline (ISO format)')
    .option('--recurring <interval>', 'Recurring interval: daily, weekly, monthly')
    .option('--recurring-count <count>', 'Number of recurrences')
    .option('--timezone <tz>', 'Timezone for scheduling')
    .option('--cpu <amount>', 'CPU resource requirement')
    .option('--memory <amount>', 'Memory resource requirement (MB)')
    .option('--disk <amount>', 'Disk resource requirement (MB)')
    .option('--network <amount>', 'Network resource requirement (Mbps)')
    .option('--exclusive-resources', 'Require exclusive access to resources')
    .option('--input <json>', 'Task input as JSON string')
    .option('--dry-run', 'Show what would be created without creating')
    .action(async (type: string, description: string, options: TaskCreateOptions) => {
      try {
        console.log(chalk.blue('🔧 Creating new task...'));
        
        // Parse dependencies
        const dependencies = options.dependencies 
          ? options.dependencies.split(',').map((depId: string) => ({
              taskId: depId.trim(),
              type: (options.depType || 'finish-to-start') as 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish',
              lag: options.depLag ? parseInt(options.depLag) : 0
            }))
          : [];

        // Parse resource requirements
        const resourceRequirements: ResourceRequirement[] = [];
        if (options.cpu) {
          resourceRequirements.push({
            resourceId: 'cpu',
            type: 'cpu',
            amount: parseFloat(String(options.cpu)),
            unit: 'cores',
            exclusive: options.exclusiveResources,
            priority: options.priority ? parseInt(String(options.priority)) : 0
          });
        }
        if (options.memory) {
          resourceRequirements.push({
            resourceId: 'memory',
            type: 'memory',
            amount: parseFloat(String(options.memory)),
            unit: 'MB',
            exclusive: options.exclusiveResources,
            priority: options.priority ? parseInt(String(options.priority)) : 0
          });
        }
        if (options.disk) {
          resourceRequirements.push({
            resourceId: 'disk',
            type: 'disk',
            amount: parseFloat(String(options.disk)),
            unit: 'MB',
            exclusive: options.exclusiveResources,
            priority: options.priority ? parseInt(String(options.priority)) : 0
          });
        }
        if (options.network) {
          resourceRequirements.push({
            resourceId: 'network',
            type: 'network',
            amount: parseFloat(String(options.network)),
            unit: 'Mbps',
            exclusive: options.exclusiveResources,
            priority: options.priority ? parseInt(String(options.priority)) : 0
          });
        }

        // Parse schedule
        let schedule: TaskSchedule | undefined;
        if (options.startTime || options.deadline || options.recurring) {
          schedule = {
            startTime: options.startTime ? new Date(options.startTime) : undefined,
            deadline: options.deadline ? new Date(options.deadline) : undefined,
            timezone: options.timezone,
            recurring: options.recurring ? {
              interval: options.recurring as "daily" | "weekly" | "monthly",
              count: options.recurringCount ? parseInt(options.recurringCount) : undefined
            } : undefined
          };
        }

        const taskData: Partial<WorkflowTask> = {
          type,
          description,
          priority: options.priority ? parseInt(String(options.priority)) : 0,
          dependencies,
          resourceRequirements,
          schedule,
          assignedAgent: options.assign,
          tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
          timeout: options.timeout ? parseInt(String(options.timeout)) : 0,
          estimatedDurationMs: options.estimatedDuration ? parseInt(options.estimatedDuration) : undefined,
          retryPolicy: {
            maxAttempts: options.maxRetries ? parseInt(options.maxRetries) : 0,
            backoffMs: options.retryBackoff ? parseInt(options.retryBackoff) : 0,
            backoffMultiplier: options.retryMultiplier ? parseFloat(options.retryMultiplier) : 1.5
          },
          rollbackStrategy: options.rollback as "custom" | "previous-checkpoint" | "initial-state" | undefined,
          input: options.input ? JSON.parse(options.input) : {}
        };

        if (options.dryRun) {
          console.log(chalk.yellow('🔍 Dry run - Task configuration:'));
          console.log(JSON.stringify(taskData, null, 2));
          return;
        }

        // Create task using TodoWrite for coordination
        if (context.memoryManager) {
          // Store task creation in memory for coordination
          await context.memoryManager.store('task:creation', {
            action: 'create_task',
            taskData,
            timestamp: new Date(),
            requestedBy: 'cli'
          });
        }

        const task = await context.taskEngine.createTask(taskData);

        console.log(chalk.green('✅ Task created successfully:'));
        console.log(chalk.cyan(`📝 ID: ${task.id}`));
        console.log(chalk.cyan(`🎯 Type: ${task.type}`));
        console.log(chalk.cyan(`📄 Description: ${task.description}`));
        console.log(chalk.cyan(`⚡ Priority: ${task.priority}`));
        console.log(chalk.cyan(`🏷️  Tags: ${task.tags.join(', ')}`));
        
        if (task.assignedAgent) {
          console.log(chalk.cyan(`👤 Assigned to: ${task.assignedAgent}`));
        }
        
        if (task.dependencies.length > 0) {
          console.log(chalk.cyan(`🔗 Dependencies: ${task.dependencies.map(d => d.taskId).join(', ')}`));
        }
        
        if (task.schedule) {
          console.log(chalk.cyan(`📅 Schedule:`));
          if (task.schedule.startTime) console.log(chalk.cyan(`  ⏰ Start: ${task.schedule.startTime.toISOString()}`));
          if (task.schedule.deadline) console.log(chalk.cyan(`  ⏳ Deadline: ${task.schedule.deadline.toISOString()}`));
        }
        
        if (resourceRequirements.length > 0) {
          console.log(chalk.cyan(`💻 Resources: ${resourceRequirements.map(r => `${r.type}:${r.amount}${r.unit}`).join(', ')}`));
        }

        console.log(chalk.blue(`\n💡 Use 'task status ${task.id}' to monitor progress`));

      } catch (error) {
        console.error(chalk.red('❌ Error creating task:'), error instanceof Error ? error.message : error);
      }
    });
}

/**
 * Task List Command - Display tasks with filtering, sorting, dependency visualization
 */
export function createTaskListCommand(context: TaskCommandContext): Command {
  return new Command('list')
    .description('List tasks with filtering, sorting, and visualization options')
    .option('-s, --status <status>', 'Filter by status (pending,queued,running,completed,failed,cancelled)')
    .option('-a, --agent <agent>', 'Filter by assigned agent')
    .option('-p, --priority <range>', 'Filter by priority range (e.g., 50-100)')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('--created-after <date>', 'Filter tasks created after date (ISO format)')
    .option('--created-before <date>', 'Filter tasks created before date (ISO format)')
    .option('--due-before <date>', 'Filter tasks due before date (ISO format)')
    .option('--search <term>', 'Search in description, type, and tags')
    .option('--sort <field>', 'Sort by field: createdAt, priority, deadline, status, estimatedDuration', 'createdAt')
    .option('--sort-dir <direction>', 'Sort direction: asc, desc', 'desc')
    .option('--limit <number>', 'Limit number of results', '50')
    .option('--offset <number>', 'Offset for pagination', '0')
    .option('--format <format>', 'Output format: table, json, tree', 'table')
    .option('--show-dependencies', 'Show dependency relationships')
    .option('--show-progress', 'Show progress bars')
    .option('--show-metrics', 'Show performance metrics')
    .action(async (options: TaskListOptions) => {
      try {
        console.log(chalk.blue('📋 Listing tasks...'));

        // Build filter
        const filter: TaskFilter = {};
        
        if (options.status) {
          filter.status = options.status.split(',') as TaskStatus[];
        }
        
        if (options.agent) {
          filter.assignedAgent = [options.agent];
        }
        
        if (options.priority) {
          const [min, max] = options.priority.split('-').map((p: string) => parseInt(p));
          filter.priority = { min, max: max || min };
        }
        
        if (options.tags) {
          filter.tags = options.tags.split(',').map((t: string) => t.trim());
        }
        
        if (options.createdAfter) {
          filter.createdAfter = new Date(options.createdAfter);
        }
        
        if (options.createdBefore) {
          filter.createdBefore = new Date(options.createdBefore);
        }
        
        if (options.dueBefore) {
          filter.dueBefore = new Date(options.dueBefore);
        }
        
        if (options.search) {
          filter.search = options.search;
        }

        // Build sort
        const sort: TaskSort = {
          field: (options.sort || 'createdAt') as TaskSort['field'],
          direction: (options.sortDir || 'desc') as 'asc' | 'desc'
        };

        // Get tasks
        const result = await context.taskEngine.listTasks(
          filter,
          sort,
          options.limit ? parseInt(String(options.limit)) : 10,
          options.offset ? parseInt(String(options.offset)) : 0
        );

        if (result.tasks.length === 0) {
          console.log(chalk.yellow('📭 No tasks found matching criteria'));
          return;
        }

        // Store query in memory for coordination
        if (context.memoryManager) {
          await context.memoryManager.store('task:query:latest', {
            filter,
            sort,
            results: result.total,
            timestamp: new Date()
          });
        }

        console.log(chalk.green(`✅ Found ${result.total} tasks (showing ${result.tasks.length})`));

        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.format === 'tree' && options.showDependencies) {
          displayTaskTree(result.tasks);
        } else {
          displayTaskTable(result.tasks, {
            showProgress: options.showProgress,
            showMetrics: options.showMetrics,
            showDependencies: options.showDependencies
          });
        }

        if (result.hasMore) {
          console.log(chalk.blue(`\n💡 Use --offset ${(options.offset ? parseInt(String(options.offset)) : 0) + (options.limit ? parseInt(String(options.limit)) : 10)} to see more results`));
        }

      } catch (error) {
        console.error(chalk.red('❌ Error listing tasks:'), error instanceof Error ? error.message : error);
      }
    });
}

/**
 * Task Status Command - Detailed task status with progress tracking, performance metrics
 */
export function createTaskStatusCommand(context: TaskCommandContext): Command {
  return new Command('status')
    .description('Get detailed task status with progress and metrics')
    .argument('<task-id>', 'Task ID to check status')
    .option('--show-logs', 'Show execution logs')
    .option('--show-checkpoints', 'Show task checkpoints')
    .option('--show-metrics', 'Show performance metrics')
    .option('--show-dependencies', 'Show dependency status')
    .option('--show-resources', 'Show resource allocation')
    .option('--watch', 'Watch for status changes (refresh every 5s)')
    .option('--format <format>', 'Output format: detailed, json, compact', 'detailed')
    .action(async (taskId: string, options: TaskOptions) => {
      try {
        const displayStatus = async () => {
          const status = await context.taskEngine.getTaskStatus(taskId);
          
          if (!status) {
            console.log(chalk.red(`❌ Task ${taskId} not found`));
            return false;
          }

          // Store status check in memory
          if (context.memoryManager) {
            await context.memoryManager.store(`task:status:${taskId}`, {
              ...status,
              checkedAt: new Date(),
              checkedBy: 'cli'
            });
          }

          if (options.format === 'json') {
            console.log(JSON.stringify(status, null, 2));
            return true;
          }

          console.clear();
          console.log(chalk.blue(`📊 Task Status: ${taskId}`));
          console.log(''.padEnd(60, '='));

          const task = status.task;
          
          // Basic info
          console.log(chalk.cyan(`📝 Type: ${task.type}`));
          console.log(chalk.cyan(`📄 Description: ${task.description}`));
          console.log(chalk.cyan(`📊 Status: ${getStatusIcon(task.status)} ${task.status.toUpperCase()}`));
          console.log(chalk.cyan(`⚡ Priority: ${task.priority}`));
          console.log(chalk.cyan(`🏷️  Tags: ${task.tags.join(', ') || 'None'}`));
          
          if (task.assignedAgent) {
            console.log(chalk.cyan(`👤 Assigned to: ${task.assignedAgent}`));
          }

          // Progress
          if (task.progressPercentage > 0) {
            const progressBar = createProgressBar(task.progressPercentage);
            console.log(chalk.cyan(`📈 Progress: ${progressBar} ${task.progressPercentage.toFixed(1)}%`));
          }

          // Timing
          console.log(chalk.cyan(`⏰ Created: ${task.createdAt.toLocaleString()}`));
          if (task.startedAt) {
            console.log(chalk.cyan(`🚀 Started: ${task.startedAt.toLocaleString()}`));
          }
          if (task.completedAt) {
            console.log(chalk.cyan(`✅ Completed: ${task.completedAt.toLocaleString()}`));
          }
          if (task.schedule?.deadline) {
            const isOverdue = task.schedule.deadline < new Date() && task.status !== 'completed';
            console.log(chalk.cyan(`⏳ Deadline: ${task.schedule.deadline.toLocaleString()} ${isOverdue ? chalk.red('(OVERDUE)') : ''}`));
          }

          // Duration
          if (task.estimatedDurationMs) {
            console.log(chalk.cyan(`⏱️  Estimated: ${formatDuration(task.estimatedDurationMs)}`));
          }
          if (task.actualDurationMs) {
            console.log(chalk.cyan(`⏱️  Actual: ${formatDuration(task.actualDurationMs)}`));
          }

          // Dependencies
          if (options.showDependencies && status.dependencies.length > 0) {
            console.log(chalk.yellow('\n🔗 Dependencies:'));
            for (const dep of status.dependencies) {
              const icon = dep.satisfied ? '✅' : '⏳';
              console.log(`  ${icon} ${dep.task.id}: ${dep.task.description} (${dep.task.status})`);
            }
          }

          // Dependents
          if (options.showDependencies && status.dependents.length > 0) {
            console.log(chalk.yellow('\n⬆️  Dependents:'));
            for (const dep of status.dependents) {
              console.log(`  📋 ${dep.id}: ${dep.description} (${dep.status})`);
            }
          }

          // Resources
          if (options.showResources && status.resourceStatus.length > 0) {
            console.log(chalk.yellow('\n💻 Resources:'));
            for (const resource of status.resourceStatus) {
              const icon = resource.allocated ? '🔒' : resource.available ? '✅' : '❌';
              console.log(`  ${icon} ${resource.required.type}: ${resource.required.amount}${resource.required.unit}`);
            }
          }

          // Checkpoints
          if (options.showCheckpoints && task.checkpoints.length > 0) {
            console.log(chalk.yellow('\n📍 Checkpoints:'));
            for (const checkpoint of task.checkpoints) {
              console.log(`  📌 ${checkpoint.timestamp.toLocaleString()}: ${checkpoint.description}`);
            }
          }

          // Metrics
          if (options.showMetrics && status.execution) {
            console.log(chalk.yellow('\n📊 Performance Metrics:'));
            const metrics = status.execution.metrics;
            console.log(`  💻 CPU: ${metrics.cpuUsage.toFixed(2)}%`);
            console.log(`  🧠 Memory: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  💾 Disk I/O: ${(metrics.diskIO / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  🌐 Network I/O: ${(metrics.networkIO / 1024 / 1024).toFixed(2)} MB`);
          }

          // Logs
          if (options.showLogs && status.execution?.logs.length) {
            console.log(chalk.yellow('\n📝 Recent Logs:'));
            const recentLogs = status.execution.logs.slice(-5);
            for (const log of recentLogs) {
              const levelColor = getLogLevelColor(log.level);
              console.log(`  ${log.timestamp.toLocaleTimeString()} ${levelColor(log.level.toUpperCase())}: ${log.message}`);
            }
          }

          // Error info
          if (task.error) {
            console.log(chalk.red('\n❌ Error:'));
            console.log(chalk.red(`  ${task.error.message}`));
          }

          console.log(''.padEnd(60, '='));
          console.log(chalk.blue(`🔄 Last updated: ${new Date().toLocaleTimeString()}`));

          return true;
        };

        if (options.watch) {
          console.log(chalk.blue('👀 Watching task status (press Ctrl+C to stop)...'));
          
          const interval = setInterval(async () => {
            const success = await displayStatus();
            if (!success) {
              clearInterval(interval);
            }
          }, 5000);

          // Initial display
          await displayStatus();

          // Handle Ctrl+C
          process.on('SIGINT', () => {
            clearInterval(interval);
            console.log(chalk.yellow('\n👋 Stopped watching'));
            process.exit(0);
          });
        } else {
          await displayStatus();
        }

      } catch (error) {
        console.error(chalk.red('❌ Error getting task status:'), error instanceof Error ? error.message : error);
      }
    });
}

/**
 * Task Cancel Command - Safe task cancellation with rollback and cleanup
 */
export function createTaskCancelCommand(context: TaskCommandContext): Command {
  return new Command('cancel')
    .description('Cancel a task with optional rollback and cleanup')
    .argument('<task-id>', 'Task ID to cancel')
    .option('-r, --reason <reason>', 'Cancellation reason', 'User requested')
    .option('--no-rollback', 'Skip rollback to previous checkpoint')
    .option('--force', 'Force cancellation even if task is completed')
    .option('--cascade', 'Cancel dependent tasks as well')
    .option('--dry-run', 'Show what would be cancelled without cancelling')
    .action(async (taskId: string, options: TaskOptions) => {
      try {
        console.log(chalk.blue(`⏹️  Preparing to cancel task: ${taskId}`));

        const status = await context.taskEngine.getTaskStatus(taskId);
        if (!status) {
          console.log(chalk.red(`❌ Task ${taskId} not found`));
          return;
        }

        const task = status.task;

        if (task.status === 'completed' && !options.force) {
          console.log(chalk.yellow(`⚠️  Task ${taskId} is already completed. Use --force to cancel anyway.`));
          return;
        }

        if (task.status === 'cancelled') {
          console.log(chalk.yellow(`⚠️  Task ${taskId} is already cancelled`));
          return;
        }

        console.log(chalk.cyan(`📋 Task: ${task.description}`));
        console.log(chalk.cyan(`📊 Current status: ${task.status}`));
        console.log(chalk.cyan(`📈 Progress: ${task.progressPercentage.toFixed(1)}%`));

        if (options.cascade && status.dependents.length > 0) {
          console.log(chalk.cyan(`🔗 Will also cancel ${status.dependents.length} dependent tasks:`));
          for (const dep of status.dependents) {
            console.log(`  📋 ${dep.id}: ${dep.description}`);
          }
        }

        if (!options.noRollback && task.checkpoints.length > 0) {
          console.log(chalk.cyan(`🔄 Will rollback to previous checkpoint (${task.checkpoints.length} available)`));
        }

        if (options.dryRun) {
          console.log(chalk.yellow('🔍 Dry run - no actual cancellation performed'));
          return;
        }

        // Store cancellation request in memory for coordination
        if (context.memoryManager) {
          await context.memoryManager.store(`task:cancellation:${taskId}`, {
            taskId,
            reason: options.reason,
            rollback: !options.noRollback,
            cascade: options.cascade,
            requestedAt: new Date(),
            requestedBy: 'cli'
          });
        }

        console.log(chalk.yellow('⏳ Cancelling task...'));

        await context.taskEngine.cancelTask(
          taskId,
          options.reason,
          !options.noRollback
        );

        console.log(chalk.green(`✅ Task ${taskId} cancelled successfully`));
        console.log(chalk.cyan(`📝 Reason: ${options.reason}`));

        if (!options.noRollback && task.checkpoints.length > 0) {
          console.log(chalk.green('🔄 Rollback completed'));
        }

        if (options.cascade && status.dependents.length > 0) {
          console.log(chalk.blue('🔗 Cancelling dependent tasks...'));
          for (const dep of status.dependents) {
            try {
              await context.taskEngine.cancelTask(dep.id, `Parent task ${taskId} was cancelled`);
              console.log(chalk.green(`  ✅ Cancelled: ${dep.id}`));
            } catch (error) {
              console.log(chalk.red(`  ❌ Failed to cancel: ${dep.id} - ${error}`));
            }
          }
        }

      } catch (error) {
        console.error(chalk.red('❌ Error cancelling task:'), error instanceof Error ? error.message : error);
      }
    });
}

/**
 * Task Workflow Command - Workflow execution engine with parallel processing
 */
export function createTaskWorkflowCommand(context: TaskCommandContext): Command {
  return new Command('workflow')
    .description('Execute and manage workflows with parallel processing')
    .addCommand(
      new Command('create')
        .description('Create a new workflow')
        .argument('<name>', 'Workflow name')
        .option('-d, --description <desc>', 'Workflow description')
        .option('-f, --file <file>', 'Load workflow from JSON file')
        .option('--max-concurrent <number>', 'Maximum concurrent tasks', '10')
        .option('--strategy <strategy>', 'Parallelism strategy: breadth-first, depth-first, priority-based', 'priority-based')
        .option('--error-handling <strategy>', 'Error handling: fail-fast, continue-on-error, retry-failed', 'fail-fast')
        .option('--max-retries <number>', 'Maximum workflow retries', '3')
        .action(async (name: string, options: WorkflowOptions) => {
          try {
            console.log(chalk.blue(`🔧 Creating workflow: ${name}`));

            let workflowData: Partial<Workflow> = {
              name,
              description: options.description,
              parallelism: {
                maxConcurrent: options.maxConcurrent ? parseInt(options.maxConcurrent) : 5,
                strategy: (options.strategy || 'priority-based') as "priority-based" | "breadth-first" | "depth-first"
              },
              errorHandling: {
                strategy: (options.errorHandling || 'fail-fast') as "fail-fast" | "continue-on-error" | "retry-failed",
                maxRetries: options.maxRetries ? parseInt(options.maxRetries) : 3
              }
            };

            if (options.file) {
              const fs = await import('fs/promises');
              const fileContent = await fs.readFile(options.file, 'utf8');
              const fileData = JSON.parse(fileContent);
              workflowData = { ...workflowData, ...fileData };
            }

            const workflow = await context.taskEngine.createWorkflow(workflowData);

            console.log(chalk.green('✅ Workflow created successfully:'));
            console.log(chalk.cyan(`📝 ID: ${workflow.id}`));
            console.log(chalk.cyan(`📄 Name: ${workflow.name}`));
            console.log(chalk.cyan(`📋 Tasks: ${workflow.tasks.length}`));
            console.log(chalk.cyan(`⚡ Max concurrent: ${workflow.parallelism.maxConcurrent}`));
            console.log(chalk.cyan(`🎯 Strategy: ${workflow.parallelism.strategy}`));

          } catch (error) {
            console.error(chalk.red('❌ Error creating workflow:'), error instanceof Error ? error.message : error);
          }
        })
    )
    .addCommand(
      new Command('execute')
        .description('Execute a workflow')
        .argument('<workflow-id>', 'Workflow ID to execute')
        .option('--variables <json>', 'Workflow variables as JSON')
        .option('--dry-run', 'Show execution plan without executing')
        .option('--monitor', 'Monitor execution progress')
        .action(async (workflowId: string, options: WorkflowOptions | TaskOptions) => {
          try {
            console.log(chalk.blue(`🚀 Executing workflow: ${workflowId}`));

            // This would need access to workflow storage
            // For now, showing the structure

            if (options.dryRun) {
              console.log(chalk.yellow('🔍 Dry run - execution plan would be shown here'));
              return;
            }

            if ('monitor' in options && options.monitor) {
              console.log(chalk.blue('👀 Monitoring workflow execution...'));
              // Would implement real-time monitoring
            }

            console.log(chalk.green('✅ Workflow execution started'));

          } catch (error) {
            console.error(chalk.red('❌ Error executing workflow:'), error instanceof Error ? error.message : error);
          }
        })
    )
    .addCommand(
      new Command('visualize')
        .description('Visualize workflow dependency graph')
        .argument('<workflow-id>', 'Workflow ID to visualize')
        .option('--format <format>', 'Output format: ascii, dot, json', 'ascii')
        .option('--output <file>', 'Output file (for dot/json formats)')
        .action(async (workflowId: string, options: WorkflowOptions | TaskOptions) => {
          try {
            console.log(chalk.blue(`📊 Visualizing workflow: ${workflowId}`));

            const graph = context.taskEngine.getDependencyGraph();

            if (options.format === 'json') {
              const output = JSON.stringify(graph, null, 2);
              if ('output' in options && options.output) {
                const fs = await import('fs/promises');
                await fs.writeFile(options.output, output);
                console.log(chalk.green(`💾 Graph saved to: ${options.output}`));
              } else {
                console.log(output);
              }
            } else if (options.format === 'ascii') {
              displayDependencyGraph(graph);
            }

          } catch (error) {
            console.error(chalk.red('❌ Error visualizing workflow:'), error instanceof Error ? error.message : error);
          }
        })
    );
}

// Helper functions for display

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return '⏳';
    case 'queued': return '📋';
    case 'running': return '🏃';
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'cancelled': return '⏹️';
    default: return '❓';
  }
}

function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getLogLevelColor(level: string): typeof chalk {
  switch (level) {
    case 'debug': return chalk.gray;
    case 'info': return chalk.blue;
    case 'warn': return chalk.yellow;
    case 'error': return chalk.red;
    default: return chalk.white;
  }
}

function displayTaskTable(tasks: WorkflowTask[], options: TaskListOptions): void {
  console.log(chalk.yellow('\n📋 Tasks:'));
  console.log('─'.repeat(80));
  
  for (const task of tasks) {
    const statusIcon = getStatusIcon(task.status);
    const progress = options.showProgress && task.progressPercentage > 0 
      ? ` ${createProgressBar(task.progressPercentage, 10)} ${task.progressPercentage.toFixed(0)}%`
      : '';
    
    console.log(`${statusIcon} ${task.id.substring(0, 8)} | ${task.type.padEnd(12)} | ${task.description.substring(0, 30).padEnd(30)} | P:${task.priority}${progress}`);
  }
}

function displayTaskTree(tasks: WorkflowTask[]): void {
  console.log(chalk.yellow('\n🌳 Task Dependency Tree:'));
  // Implementation would show hierarchical view of dependencies
  console.log('Tree visualization would be implemented here');
}

function displayDependencyGraph(graph: { nodes: Array<{ id: string; label: string; status: string }>; edges: Array<{ from: string; to: string }> }): void {
  console.log(chalk.yellow('\n🕸️  Dependency Graph:'));
  console.log(`📊 Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`);
  
  // Simple ASCII representation
  for (const node of graph.nodes) {
    const incoming = graph.edges.filter(e => e.to === node.id);
    const outgoing = graph.edges.filter(e => e.from === node.id);
    
    const prefix = incoming.length > 0 ? '← ' : '  ';
    const suffix = outgoing.length > 0 ? ' →' : '  ';
    
    console.log(`${prefix}${getStatusIcon(node.status)} ${node.id} (${node.label})${suffix}`);
  }
}