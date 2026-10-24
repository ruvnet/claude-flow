#!/usr/bin/env node
/**
 * Hive Mind Task Command
 *
 * Submit tasks to the Hive Mind for collective processing
 * with automatic agent assignment and consensus coordination.
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { HiveMind } from '../../../hive-mind/core/HiveMind.js';
import { TaskPriority, TaskStrategy } from '../../../hive-mind/types.js';
import { formatSuccess, formatError, formatInfo, formatWarning } from '../../formatter.js';
import { DatabaseManager } from '../../../hive-mind/core/DatabaseManager.js';

export const taskCommand = new Command('task')
  .description('Submit and manage tasks in the Hive Mind')
  .argument('[description]', 'Task description')
  .option('-s, --swarm-id <id>', 'Target swarm ID')
  .option('-p, --priority <level>', 'Task priority (low, medium, high, critical)', 'medium')
  .option(
    '-t, --strategy <type>',
    'Execution strategy (parallel, sequential, adaptive, consensus)',
    'adaptive',
  )
  .option('-d, --dependencies <ids>', 'Comma-separated list of dependent task IDs')
  .option('-a, --assign-to <agent>', 'Assign to specific agent')
  .option('-r, --require-consensus', 'Require consensus for this task', false)
  .option('-m, --max-agents <number>', 'Maximum agents to assign', '3')
  .option('-i, --interactive', 'Interactive task creation', false)
  .option('-w, --watch', 'Watch task progress', false)
  .option('-l, --list', 'List all tasks', false)
  .option('--cancel <id>', 'Cancel a specific task')
  .option('--retry <id>', 'Retry a failed task')
  .action(async (description, options) => {
    try {
      // Get swarm ID
      const swarmId = options.swarmId || (await getActiveSwarmId());
      if (!swarmId) {
        throw new Error('No active swarm found. Initialize a Hive Mind first.');
      }

      // Load Hive Mind
      const hiveMind = await HiveMind.load(swarmId);

      // Handle special operations
      if (options.list) {
        await listTasks(hiveMind);
        return;
      }

      if (options.cancel) {
        await cancelTask(hiveMind, options.cancel);
        return;
      }

      if (options.retry) {
        await retryTask(hiveMind, options.retry);
        return;
      }

      // Interactive mode
      if (options.interactive || !description) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'description',
            message: 'Enter task description:',
            when: !description,
            validate: (input) => input.length > 0 || 'Task description is required',
          },
          {
            type: 'list',
            name: 'priority',
            message: 'Select task priority:',
            choices: ['low', 'medium', 'high', 'critical'],
            default: options.priority,
          },
          {
            type: 'list',
            name: 'strategy',
            message: 'Select execution strategy:',
            choices: [
              { name: 'Adaptive (AI-optimized)', value: 'adaptive' },
              { name: 'Parallel (Fast, multiple agents)', value: 'parallel' },
              { name: 'Sequential (Step-by-step)', value: 'sequential' },
              { name: 'Consensus (Requires agreement)', value: 'consensus' },
            ],
            default: options.strategy,
          },
          {
            type: 'confirm',
            name: 'requireConsensus',
            message: 'Require consensus for critical decisions?',
            default: options.requireConsensus,
            when: (answers) => answers.strategy !== 'consensus',
          },
          {
            type: 'number',
            name: 'maxAgents',
            message: 'Maximum agents to assign:',
            default: parseInt(options.maxAgents, 10),
            validate: (input) => (input > 0 && input <= 10) || 'Must be between 1 and 10',
          },
          {
            type: 'checkbox',
            name: 'capabilities',
            message: 'Required agent capabilities:',
            choices: [
              'code_generation',
              'research',
              'analysis',
              'testing',
              'optimization',
              'documentation',
              'architecture',
              'review',
            ],
          },
        ]);

        description = description || answers.description;
        options.priority = answers.priority || options.priority;
        options.strategy = answers.strategy || options.strategy;
        options.requireConsensus = answers.requireConsensus || options.requireConsensus;
        options.maxAgents = answers.maxAgents || options.maxAgents;
        options.requiredCapabilities = answers.capabilities;
      }

      const spinner = ora('Submitting task to Hive Mind...').start();

      // Parse dependencies
      const dependencies = options.dependencies
        ? options.dependencies.split(',').map((id: string) => id.trim())
        : [];

      // Submit task
      const task = await hiveMind.submitTask({
        description,
        priority: options.priority as TaskPriority,
        strategy: options.strategy as TaskStrategy,
        dependencies,
        assignTo: options.assignTo,
        requireConsensus: options.requireConsensus,
        maxAgents: parseInt(options.maxAgents, 10),
        requiredCapabilities: options.requiredCapabilities || [],
        metadata: {
          submittedBy: 'cli',
          submittedAt: new Date(),
        },
      });

      spinner.succeed(formatSuccess('Task submitted successfully!'));

      // Display task details
      console.log('\n' + chalk.bold('📋 Task Details:'));
      console.log(formatInfo(`Task ID: ${task.id}`));
      console.log(formatInfo(`Description: ${task.description}`));
      console.log(formatInfo(`Priority: ${getPriorityBadge(task.priority)} ${task.priority}`));
      console.log(formatInfo(`Strategy: ${task.strategy}`));
      console.log(formatInfo(`Status: ${task.status}`));

      if (task.assignedAgents.length > 0) {
        console.log(formatInfo(`Assigned to: ${task.assignedAgents.join(', ')}`));
      }

      // Watch mode
      if (options.watch) {
        console.log('\n' + chalk.bold('👀 Watching task progress...'));
        await watchTaskProgress(hiveMind, task.id);
      } else {
        console.log(
          '\n' + chalk.gray(`Track progress: ruv-swarm hive-mind task --watch ${task.id}`),
        );
      }
    } catch (error) {
      console.error(formatError('Failed to submit task'));
      console.error(formatError((error as Error).message));
      process.exit(1);
    }
  });

async function getActiveSwarmId(): Promise<string | null> {
  const db = await DatabaseManager.getInstance();
  return db.getActiveSwarmId();
}

async function listTasks(hiveMind: HiveMind) {
  const tasks = await hiveMind.getTasks();

  if (tasks.length === 0) {
    console.log(formatInfo('No tasks found.'));
    return;
  }

  console.log('\n' + chalk.bold('📋 Task List:'));
  const Table = require('cli-table3');
  const table = new Table({
    head: ['ID', 'Description', 'Priority', 'Status', 'Progress', 'Agents'],
    style: { head: ['cyan'] },
  });

  tasks.forEach((task) => {
    table.push([
      task.id.substring(0, 8),
      task.description.substring(0, 40) + (task.description.length > 40 ? '...' : ''),
      getPriorityBadge(task.priority),
      getTaskStatusBadge(task.status),
      `${task.progress}%`,
      task.assignedAgents.length,
    ]);
  });

  console.log(table.toString());
}

async function cancelTask(hiveMind: HiveMind, taskId: string) {
  const spinner = ora('Cancelling task...').start();

  try {
    await hiveMind.cancelTask(taskId);
    spinner.succeed(formatSuccess('Task cancelled successfully!'));
  } catch (error) {
    spinner.fail(formatError('Failed to cancel task'));
    throw error;
  }
}

async function retryTask(hiveMind: HiveMind, taskId: string) {
  const spinner = ora('Retrying task...').start();

  try {
    const newTask = await hiveMind.retryTask(taskId);
    spinner.succeed(formatSuccess('Task retry submitted!'));
    console.log(formatInfo(`New Task ID: ${newTask.id}`));
  } catch (error) {
    spinner.fail(formatError('Failed to retry task'));
    throw error;
  }
}

async function watchTaskProgress(hiveMind: HiveMind, taskId: string) {
  let lastProgress = -1;
  let completed = false;

  const progressBar = require('cli-progress');
  const bar = new progressBar.SingleBar({
    format: 'Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {status}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  bar.start(100, 0, { status: 'Initializing...' });

  const interval = setInterval(async () => {
    try {
      const task = await hiveMind.getTask(taskId);

      if (task.progress !== lastProgress) {
        lastProgress = task.progress;
        bar.update(task.progress, { status: task.status });
      }

      if (task.status === 'completed' || task.status === 'failed') {
        completed = true;
        bar.stop();
        clearInterval(interval);

        console.log('\n' + chalk.bold('📊 Task Result:'));
        console.log(formatInfo(`Status: ${task.status}`));
        console.log(formatInfo(`Duration: ${formatDuration(task.completedAt - task.createdAt)}`));

        if (task.result) {
          console.log(formatInfo('Result:'));
          console.log(chalk.gray(JSON.stringify(task.result, null, 2)));
        }

        if (task.error) {
          console.log(formatError(`Error: ${task.error}`));
        }
      }
    } catch (error) {
      clearInterval(interval);
      bar.stop();
      console.error(formatError('Error watching task: ' + (error as Error).message));
    }
  }, 1000);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    if (!completed) {
      clearInterval(interval);
      bar.stop();
      console.log('\n' + formatWarning('Task watch cancelled. Task continues in background.'));
      process.exit(0);
    }
  });
}

function getPriorityBadge(priority: string): string {
  const badges: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };
  return badges[priority] || '⚪';
}

function getTaskStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    pending: chalk.gray('⏳'),
    assigned: chalk.yellow('🔄'),
    in_progress: chalk.blue('▶️'),
    completed: chalk.green('✅'),
    failed: chalk.red('❌'),
  };
  return badges[status] || chalk.gray('❓');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
