import { Command } from 'commander';
import chalk from 'chalk';
import { generateId } from '../../utils/helpers.js';
import type { Task } from '../../utils/types.js';

export const taskCommand = new Command('task')
  .description('Manage tasks')
  .action(() => {
    console.log('Task management commands available');
  });

taskCommand
  .command('create <type> <description>')
  .description('Create a new task')
  .option('-p, --priority <priority>', 'Task priority', '0')
  .option('-d, --dependencies <deps>', 'Comma-separated list of dependency task IDs')
  .option('-i, --input <input>', 'Task input as JSON')
  .option('-a, --assign <agent>', 'Assign to specific agent')
  .action(async (type: string, description: string, options: any) => {
      const task: Task = {
        id: generateId('task'),
        type,
        description,
        status: 'pending',
        priority: parseInt(options.priority) || 0,
        dependencies: options.dependencies ? options.dependencies.split(',') : [],
        input: options.input ? JSON.parse(options.input) : {},
        createdAt: new Date(),
      };

      console.log(chalk.green('Task created:'));
      console.log(JSON.stringify(task, null, 2));
      console.log(chalk.yellow('\nTo submit this task, ensure Claude-Flow is running'));
    });