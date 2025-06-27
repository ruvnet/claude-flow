/**
 * Task management commands
 */

import { Command } from '@cliffy/command';
import { colors } from '@cliffy/ansi/colors';
import { Task } from '../../utils/types.js';
import { generateId } from '../../utils/helpers.js';
import { DenoCompat } from '../../utils/deno-compat.js';

export const taskCommand = new Command()
  .description('Manage tasks')
  .action(() => {
    taskCommand.showHelp();
  });

taskCommand
  .command('create')
  .description('Create a new task')
  .arguments('<type:string> <description:string>')
  .option('-p, --priority <priority:number>', 'Task priority', { default: 0 })
  .option('-d, --dependencies <deps:string>', 'Comma-separated list of dependency task IDs')
  .option('-i, --input <input:string>', 'Task input as JSON')
  .option('-a, --assign <agent:string>', 'Assign to specific agent')
  .action(async (type: string, description: string, options: any) => {
    const task: Task = {
      id: generateId('task'),
      type,
      description,
      priority: options.priority,
      dependencies: options.dependencies ? options.dependencies.split(',') : [],
      assignedAgent: options.assign,
      status: 'pending',
      input: options.input ? JSON.parse(options.input) : {},
      createdAt: new Date(),
    };

    console.log(colors.green('Task created:'));
    console.log(JSON.stringify(task, null, 2));
    console.log(colors.yellow('\nTo submit this task, ensure Claude-Flow is running'));
  });

taskCommand
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status:string>', 'Filter by status')
  .option('-a, --agent <agent:string>', 'Filter by assigned agent')
  .action(async (options: any) => {
    console.log(colors.yellow('Task listing requires a running Claude-Flow instance'));
  });

taskCommand
  .command('status')
  .description('Get task status')
  .arguments('<task-id:string>')
  .action(async (taskId: string, options: any) => {
    console.log(colors.yellow(`Task status requires a running Claude-Flow instance`));
  });

taskCommand
  .command('cancel')
  .description('Cancel a task')
  .arguments('<task-id:string>')
  .option('-r, --reason <reason:string>', 'Cancellation reason')
  .action(async (taskId: string, options: any) => {
    console.log(colors.yellow(`Cancelling task ${taskId} requires a running Claude-Flow instance`));
  });

taskCommand
  .command('workflow')
  .description('Execute a workflow from file')
  .arguments('<workflow-file:string>')
  .action(async (workflowFile: string, options: any) => {
    try {
      const content = await DenoCompat.readTextFile(workflowFile);
      const workflow = JSON.parse(content);
      
      console.log(colors.green('Workflow loaded:'));
      console.log(`- Name: ${workflow.name || 'Unnamed'}`);
      console.log(`- Tasks: ${workflow.tasks?.length || 0}`);
      console.log(colors.yellow('\nTo execute this workflow, ensure Claude-Flow is running'));
    } catch (error) {
      console.error(colors.red('Failed to load workflow:'), (error as Error).message);
    }
  });