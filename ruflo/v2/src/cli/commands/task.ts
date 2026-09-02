import { getErrorMessage } from '../../utils/error-handler.js';
/**
 * Task management commands
 */

import { Command } from '../commander-fix.js';
import { promises as fs } from 'node:fs';
import chalk from 'chalk';
import { generateId } from '../../utils/helpers.js';
import type { Task } from '../../utils/types.js';
export const taskCommand = new Command()
  .name('task')
  .description('Manage tasks')
  .action(() => {
    taskCommand.outputHelp();
  })
  .command('create')
  .description('Create a new task')
  .argument('<type>', 'Task type')
  .argument('<description>', 'Task description')
  .option('-p, --priority <priority>', 'Task priority', '0')
  .option('-d, --dependencies <deps>', 'Comma-separated list of dependency task IDs')
  .option('-i, --input <input>', 'Task input as JSON')
  .option('-a, --assign <agent>', 'Assign to specific agent')
  .action(async (type: string, description: string, options: any) => {
    const task: Task = {
      id: generateId('task'),
      type,
      description,
      priority: parseInt(options.priority, 10),
      dependencies: options.dependencies ? options.dependencies.split(',') : [],
      assignedAgent: options.assign,
      status: 'pending',
      input: options.input ? JSON.parse(options.input) : {},
      createdAt: new Date(),
    };

    console.log(chalk.green('Task created:'));
    console.log(JSON.stringify(task, null, 2));
    console.log(chalk.yellow('\nTo submit this task, ensure Claude-Flow is running'));
  })
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status:string>', 'Filter by status')
  .option('-a, --agent <agent:string>', 'Filter by assigned agent')
  .action(async (options: any) => {
    console.log(chalk.yellow('Task listing requires a running Claude-Flow instance'));
  })
  .command('status')
  .description('Get task status')
  .argument('<task-id>', 'Task ID')
  .action(async (taskId: string, options: any) => {
    console.log(chalk.yellow(`Task status requires a running Claude-Flow instance`));
  })
  .command('cancel')
  .description('Cancel a task')
  .argument('<task-id>', 'Task ID')
  .option('-r, --reason <reason>', 'Cancellation reason')
  .action(async (taskId: string, options: any) => {
    console.log(chalk.yellow(`Cancelling task ${taskId} requires a running Claude-Flow instance`));
  })
  .command('workflow')
  .description('Execute a workflow from file')
  .argument('<workflow-file>', 'Workflow file path')
  .action(async (workflowFile: string, options: any) => {
    try {
      const content = await fs.readFile(workflowFile, 'utf-8');
      const workflow = JSON.parse(content);

      console.log(chalk.green('Workflow loaded:'));
      console.log(`- Name: ${workflow.name || 'Unnamed'}`);
      console.log(`- Tasks: ${workflow.tasks?.length || 0}`);
      console.log(chalk.yellow('\nTo execute this workflow, ensure Claude-Flow is running'));
    } catch (error) {
      console.error(chalk.red('Failed to load workflow:'), getErrorMessage(error));
    }
  });
