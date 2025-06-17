/**
 * Task management commands
 */

import { Command } from '@cliffy/command';
import { colors } from '@cliffy/ansi/colors';
import { Task } from '../../utils/types.js';
import { generateId } from '../../utils/helpers.js';

export const taskCommand = new Command()
  .description('Manage tasks')
  .action(() => {
    taskCommand.showHelp();
  })
  .command('create', new Command()
    .description('Create a new task')
    .arguments('<type:string> <description:string>')
    .option('-p, --priority <priority:number>', 'Task priority', { default: 0 })
    .option('-d, --dependencies <deps:string>', 'Comma-separated list of dependency task IDs')
    .option('-i, --input <input:string>', 'Task input as JSON')
    .option('-a, --assign <agent:string>', 'Assign to specific agent')
    .action(async (options: any, type: string, description: string) => {
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
    }),
  )
  .command('list', new Command()
    .description('List all tasks')
    .option('-s, --status <status:string>', 'Filter by status')
    .option('-a, --agent <agent:string>', 'Filter by assigned agent')
    .action(async (options: any) => {
      console.log(colors.yellow('Task listing requires a running Claude-Flow instance'));
    }),
  )
  .command('status', new Command()
    .description('Get task status')
    .arguments('<task-id:string>')
    .action(async (options: any, taskId: string) => {
      console.log(colors.yellow(`Task status requires a running Claude-Flow instance`));
    }),
  )
  .command('cancel', new Command()
    .description('Cancel a task')
    .arguments('<task-id:string>')
    .option('-r, --reason <reason:string>', 'Cancellation reason')
    .action(async (options: any, taskId: string) => {
      console.log(colors.yellow(`Cancelling task ${taskId} requires a running Claude-Flow instance`));
    }),
  )
  .command('workflow', new Command()
    .description('Execute a workflow from file')
    .arguments('<workflow-file:string>')
    .action(async (options: any, workflowFile: string) => {
      try {
        const content = await Deno.readTextFile(workflowFile);
        const workflow = JSON.parse(content);
        
        console.log(colors.green('Workflow loaded:'));
        console.log(`- Name: ${workflow.name || 'Unnamed'}`);
        console.log(`- Tasks: ${workflow.tasks?.length || 0}`);
        console.log(colors.yellow('\nTo execute this workflow, ensure Claude-Flow is running'));
      } catch (error) {
        console.error(colors.red('Failed to load workflow:'), (error as Error).message);
      }
    }),
  );