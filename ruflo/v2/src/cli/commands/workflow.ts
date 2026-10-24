import { getErrorMessage } from '../../utils/error-handler.js';
/**
 * Workflow execution commands for Claude-Flow
 */

import { Command } from '../commander-fix.js';
import { promises as fs } from 'node:fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as Table from 'cli-table3';
import { generateId } from '../../utils/helpers.js';
import { formatDuration, formatStatusIndicator, formatProgressBar } from '../formatter.js';

export const workflowCommand = new Command()
  .name('workflow')
  .description('Execute and manage workflows')
  .action(() => {
    workflowCommand.outputHelp();
  })
  .command('run')
  .description('Execute a workflow from file')
  .argument('<workflow-file>', 'Workflow file path')
  .option('-d, --dry-run', 'Validate workflow without executing')
  .option('-v, --variables <vars>', 'Override variables (JSON format)')
  .option('-w, --watch', 'Watch workflow execution progress')
  .option('--parallel', 'Allow parallel execution where possible')
  .option('--fail-fast', 'Stop on first task failure')
  .action(async (workflowFile: string, options: any) => {
    await runWorkflow(workflowFile, options);
  })
  .command('validate')
  .description('Validate a workflow file')
  .argument('<workflow-file>', 'Workflow file path')
  .option('--strict', 'Use strict validation mode')
  .action(async (workflowFile: string, options: any) => {
    await validateWorkflow(workflowFile, options);
  })
  .command('list')
  .description('List running workflows')
  .option('--all', 'Include completed workflows')
  .option('--format <format>', 'Output format (table, json)', 'table')
  .action(async (options: any) => {
    await listWorkflows(options);
  })
  .command('status')
  .description('Show workflow execution status')
  .argument('<workflow-id>', 'Workflow ID')
  .option('-w, --watch', 'Watch workflow progress')
  .action(async (workflowId: string, options: any) => {
    await showWorkflowStatus(workflowId, options);
  })
  .command('stop')
  .description('Stop a running workflow')
  .argument('<workflow-id>', 'Workflow ID')
  .option('-f, --force', 'Force stop without cleanup')
  .action(async (workflowId: string, options: any) => {
    await stopWorkflow(workflowId, options);
  })
  .command('template')
  .description('Generate workflow templates')
  .argument('<template-type>', 'Template type')
  .option('-o, --output <file>', 'Output file path')
  .option('--format <format>', 'Template format (json, yaml)', 'json')
  .action(async (templateType: string, options: any) => {
    await generateTemplate(templateType, options);
  });

interface WorkflowDefinition {
  name: string;
  version?: string;
  description?: string;
  variables?: Record<string, any>;
  agents?: AgentDefinition[];
  tasks: TaskDefinition[];
  dependencies?: Record<string, string[]>;
  settings?: WorkflowSettings;
}

interface AgentDefinition {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, any>;
}

interface TaskDefinition {
  id: string;
  name?: string;
  type: string;
  description: string;
  assignTo?: string;
  depends?: string[];
  input?: Record<string, any>;
  timeout?: number;
  retries?: number;
  condition?: string;
}

interface WorkflowSettings {
  maxConcurrency?: number;
  timeout?: number;
  retryPolicy?: 'none' | 'immediate' | 'exponential';
  failurePolicy?: 'fail-fast' | 'continue' | 'ignore';
}

interface WorkflowExecution {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  startedAt: Date;
  completedAt?: Date;
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  tasks: TaskExecution[];
}

interface TaskExecution {
  id: string;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  assignedAgent?: string;
  error?: string;
  output?: any;
}

async function runWorkflow(workflowFile: string, options: any): Promise<void> {
  try {
    // Load and validate workflow
    const workflow = await loadWorkflow(workflowFile);

    if (options.dryRun) {
      await validateWorkflowDefinition(workflow, true);
      console.log(chalk.green('✓ Workflow validation passed'));
      return;
    }

    // Override variables if provided
    if (options.variables) {
      try {
        const vars = JSON.parse(options.variables);
        workflow.variables = { ...workflow.variables, ...vars };
      } catch (error) {
        throw new Error(`Invalid variables JSON: ${(error as Error).message}`);
      }
    }

    // Create execution plan
    const execution = await createExecution(workflow);

    console.log(chalk.cyan.bold('Starting workflow execution'));
    console.log(`${chalk.white('Workflow:')} ${workflow.name}`);
    console.log(`${chalk.white('ID:')} ${execution.id}`);
    console.log(`${chalk.white('Tasks:')} ${execution.tasks.length}`);
    console.log();

    // Execute workflow
    if (options.watch) {
      await executeWorkflowWithWatch(execution, workflow, options);
    } else {
      await executeWorkflow(execution, workflow, options);
    }
  } catch (error) {
    console.error(chalk.red('Workflow execution failed:'), (error as Error).message);
    process.exit(1);
  }
}

async function validateWorkflow(workflowFile: string, options: any): Promise<void> {
  try {
    const workflow = await loadWorkflow(workflowFile);
    await validateWorkflowDefinition(workflow, options.strict);

    console.log(chalk.green('✓ Workflow validation passed'));
    console.log(`${chalk.white('Name:')} ${workflow.name}`);
    console.log(`${chalk.white('Tasks:')} ${workflow.tasks.length}`);
    console.log(`${chalk.white('Agents:')} ${workflow.agents?.length || 0}`);

    if (workflow.dependencies) {
      const depCount = Object.values(workflow.dependencies).flat().length;
      console.log(`${chalk.white('Dependencies:')} ${depCount}`);
    }
  } catch (error) {
    console.error(chalk.red('✗ Workflow validation failed:'), (error as Error).message);
    process.exit(1);
  }
}

async function listWorkflows(options: any): Promise<void> {
  try {
    // Mock workflow list - in production, this would query the orchestrator
    const workflows = await getRunningWorkflows(options.all);

    if (options.format === 'json') {
      console.log(JSON.stringify(workflows, null, 2));
      return;
    }

    if (workflows.length === 0) {
      console.log(chalk.gray('No workflows found'));
      return;
    }

    console.log(chalk.cyan.bold(`Workflows (${workflows.length})`));
    console.log('─'.repeat(60));

    const table = new Table.default({
      head: ['ID', 'Name', 'Status', 'Progress', 'Started', 'Duration'],
    });

    for (const workflow of workflows) {
      const statusIcon = formatStatusIndicator(workflow.status);
      const progress = `${workflow.progress.completed}/${workflow.progress.total}`;
      const progressBar = formatProgressBar(
        workflow.progress.completed,
        workflow.progress.total,
        10,
      );
      const duration = workflow.completedAt
        ? formatDuration(workflow.completedAt.getTime() - workflow.startedAt.getTime())
        : formatDuration(Date.now() - workflow.startedAt.getTime());

      table.push([
        chalk.gray(workflow.id.substring(0, 8) + '...'),
        chalk.white(workflow.workflowName),
        `${statusIcon} ${workflow.status}`,
        `${progressBar} ${progress}`,
        workflow.startedAt.toLocaleTimeString(),
        duration,
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    console.error(chalk.red('Failed to list workflows:'), (error as Error).message);
  }
}

async function showWorkflowStatus(workflowId: string, options: any): Promise<void> {
  try {
    if (options.watch) {
      await watchWorkflowStatus(workflowId);
    } else {
      const execution = await getWorkflowExecution(workflowId);
      displayWorkflowStatus(execution);
    }
  } catch (error) {
    console.error(chalk.red('Failed to get workflow status:'), (error as Error).message);
  }
}

async function stopWorkflow(workflowId: string, options: any): Promise<void> {
  try {
    const execution = await getWorkflowExecution(workflowId);

    if (execution.status !== 'running') {
      console.log(chalk.yellow(`Workflow is not running (status: ${execution.status})`));
      return;
    }

    if (!options.force) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Stop workflow "${execution.workflowName}"?`,
          default: false,
        },
      ]);

      if (!confirmed) {
        console.log(chalk.gray('Stop cancelled'));
        return;
      }
    }

    console.log(chalk.yellow('Stopping workflow...'));

    // Mock stopping - in production, this would call the orchestrator
    if (options.force) {
      console.log(chalk.red('• Force stopping all tasks'));
    } else {
      console.log(chalk.blue('• Gracefully stopping tasks'));
      console.log(chalk.blue('• Cleaning up resources'));
    }

    console.log(chalk.green('✓ Workflow stopped'));
  } catch (error) {
    console.error(chalk.red('Failed to stop workflow:'), (error as Error).message);
  }
}

async function generateTemplate(templateType: string, options: any): Promise<void> {
  const templates: Record<string, WorkflowDefinition> = {
    research: {
      name: 'Research Workflow',
      description: 'Multi-stage research and analysis workflow',
      variables: {
        topic: 'quantum computing',
        depth: 'comprehensive',
      },
      agents: [
        { id: 'researcher', type: 'researcher', name: 'Research Agent' },
        { id: 'analyst', type: 'analyst', name: 'Analysis Agent' },
      ],
      tasks: [
        {
          id: 'research-task',
          type: 'research',
          description: 'Research the given topic',
          assignTo: 'researcher',
          input: { topic: '${topic}', depth: '${depth}' },
        },
        {
          id: 'analyze-task',
          type: 'analysis',
          description: 'Analyze research findings',
          assignTo: 'analyst',
          depends: ['research-task'],
          input: { data: '${research-task.output}' },
        },
      ],
      settings: {
        maxConcurrency: 2,
        timeout: 300000,
        failurePolicy: 'fail-fast',
      },
    },
    implementation: {
      name: 'Implementation Workflow',
      description: 'Code implementation and testing workflow',
      agents: [
        { id: 'implementer', type: 'implementer', name: 'Implementation Agent' },
        { id: 'tester', type: 'implementer', name: 'Testing Agent' },
      ],
      tasks: [
        {
          id: 'implement',
          type: 'implementation',
          description: 'Implement the solution',
          assignTo: 'implementer',
        },
        {
          id: 'test',
          type: 'testing',
          description: 'Test the implementation',
          assignTo: 'tester',
          depends: ['implement'],
        },
      ],
    },
    coordination: {
      name: 'Multi-Agent Coordination',
      description: 'Complex multi-agent coordination workflow',
      agents: [
        { id: 'coordinator', type: 'coordinator', name: 'Coordinator Agent' },
        { id: 'worker1', type: 'implementer', name: 'Worker Agent 1' },
        { id: 'worker2', type: 'implementer', name: 'Worker Agent 2' },
      ],
      tasks: [
        {
          id: 'plan',
          type: 'planning',
          description: 'Create execution plan',
          assignTo: 'coordinator',
        },
        {
          id: 'work1',
          type: 'implementation',
          description: 'Execute part 1',
          assignTo: 'worker1',
          depends: ['plan'],
        },
        {
          id: 'work2',
          type: 'implementation',
          description: 'Execute part 2',
          assignTo: 'worker2',
          depends: ['plan'],
        },
        {
          id: 'integrate',
          type: 'integration',
          description: 'Integrate results',
          assignTo: 'coordinator',
          depends: ['work1', 'work2'],
        },
      ],
      settings: {
        maxConcurrency: 3,
        failurePolicy: 'continue',
      },
    },
  };

  const template = templates[templateType];
  if (!template) {
    console.error(chalk.red(`Unknown template type: ${templateType}`));
    console.log(chalk.gray('Available templates:'), Object.keys(templates).join(', '));
    return;
  }

  const outputFile = options.output || `${templateType}-workflow.${options.format}`;

  let content: string;
  if (options.format === 'yaml') {
    // In production, use a proper YAML library
    console.log(chalk.yellow('YAML format not implemented, using JSON'));
    content = JSON.stringify(template, null, 2);
  } else {
    content = JSON.stringify(template, null, 2);
  }

  await fs.writeFile(outputFile, content);

  console.log(chalk.green('✓ Workflow template generated'));
  console.log(`${chalk.white('Template:')} ${templateType}`);
  console.log(`${chalk.white('File:')} ${outputFile}`);
  console.log(`${chalk.white('Tasks:')} ${template.tasks.length}`);
  console.log(`${chalk.white('Agents:')} ${template.agents?.length || 0}`);
}

async function loadWorkflow(workflowFile: string): Promise<WorkflowDefinition> {
  try {
    const content = await fs.readFile(workflowFile, 'utf-8');

    if (workflowFile.endsWith('.yaml') || workflowFile.endsWith('.yml')) {
      // In production, use a proper YAML parser
      throw new Error('YAML workflows not yet supported');
    }

    return JSON.parse(content) as WorkflowDefinition;
  } catch (error) {
    throw new Error(`Failed to load workflow file: ${getErrorMessage(error)}`);
  }
}

async function validateWorkflowDefinition(
  workflow: WorkflowDefinition,
  strict = false,
): Promise<void> {
  const errors: string[] = [];

  // Basic validation
  if (!workflow.name) errors.push('Workflow name is required');
  if (!workflow.tasks || workflow.tasks.length === 0) errors.push('At least one task is required');

  // Task validation
  const taskIds = new Set<string>();
  for (const task of workflow.tasks || []) {
    if (!task.id) errors.push('Task ID is required');
    if (taskIds.has(task.id)) errors.push(`Duplicate task ID: ${task.id}`);
    taskIds.add(task.id);

    if (!task.type) errors.push(`Task ${task.id}: type is required`);
    if (!task.description) errors.push(`Task ${task.id}: description is required`);

    // Validate dependencies
    if (task.depends) {
      for (const dep of task.depends) {
        if (!taskIds.has(dep)) {
          // Check if dependency exists in previous tasks
          const taskIndex = workflow.tasks.indexOf(task);
          const depExists = workflow.tasks.slice(0, taskIndex).some((t) => t.id === dep);
          if (!depExists) {
            errors.push(`Task ${task.id}: unknown dependency ${dep}`);
          }
        }
      }
    }
  }

  // Agent validation
  if (workflow.agents) {
    const agentIds = new Set<string>();
    for (const agent of workflow.agents) {
      if (!agent.id) errors.push('Agent ID is required');
      if (agentIds.has(agent.id)) errors.push(`Duplicate agent ID: ${agent.id}`);
      agentIds.add(agent.id);

      if (!agent.type) errors.push(`Agent ${agent.id}: type is required`);
    }

    // Validate task assignments
    for (const task of workflow.tasks) {
      if (task.assignTo && !agentIds.has(task.assignTo)) {
        errors.push(`Task ${task.id}: assigned to unknown agent ${task.assignTo}`);
      }
    }
  }

  // Strict validation
  if (strict) {
    // Check for circular dependencies
    const graph = new Map<string, string[]>();
    for (const task of workflow.tasks) {
      graph.set(task.id, task.depends || []);
    }

    if (hasCircularDependencies(graph)) {
      errors.push('Circular dependencies detected');
    }
  }

  if (errors.length > 0) {
    throw new Error('Workflow validation failed:\n• ' + errors.join('\n• '));
  }
}

async function createExecution(workflow: WorkflowDefinition): Promise<WorkflowExecution> {
  const tasks: TaskExecution[] = workflow.tasks.map((task) => ({
    id: generateId('task-exec'),
    taskId: task.id,
    status: 'pending',
  }));

  return {
    id: generateId('workflow-exec'),
    workflowName: workflow.name,
    status: 'pending',
    startedAt: new Date(),
    progress: {
      total: tasks.length,
      completed: 0,
      failed: 0,
    },
    tasks,
  };
}

async function executeWorkflow(
  execution: WorkflowExecution,
  workflow: WorkflowDefinition,
  options: any,
): Promise<void> {
  execution.status = 'running';

  console.log(chalk.blue('Executing workflow...'));
  console.log();

  // Mock execution - in production, this would use the orchestrator
  for (let i = 0; i < execution.tasks.length; i++) {
    const taskExec = execution.tasks[i];
    const taskDef = workflow.tasks.find((t) => t.id === taskExec.taskId)!;

    console.log(`${chalk.cyan('→')} Starting task: ${taskDef.description}`);

    taskExec.status = 'running';
    taskExec.startedAt = new Date();

    // Simulate task execution
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Random success/failure for demo
    const success = Math.random() > 0.1; // 90% success rate

    if (success) {
      taskExec.status = 'completed';
      taskExec.completedAt = new Date();
      execution.progress.completed++;
      console.log(`${chalk.green('✓')} Completed: ${taskDef.description}`);
    } else {
      taskExec.status = 'failed';
      taskExec.completedAt = new Date();
      taskExec.error = 'Simulated task failure';
      execution.progress.failed++;
      console.log(`${chalk.red('✗')} Failed: ${taskDef.description}`);

      if (options.failFast || workflow.settings?.failurePolicy === 'fail-fast') {
        execution.status = 'failed';
        console.log(chalk.red('\nWorkflow failed (fail-fast mode)'));
        return;
      }
    }

    console.log();
  }

  execution.status = execution.progress.failed > 0 ? 'failed' : 'completed';
  execution.completedAt = new Date();

  const duration = formatDuration(execution.completedAt.getTime() - execution.startedAt.getTime());

  if (execution.status === 'completed') {
    console.log(chalk.green.bold('✓ Workflow completed successfully'));
  } else {
    console.log(chalk.red.bold('✗ Workflow completed with failures'));
  }

  console.log(`${chalk.white('Duration:')} ${duration}`);
  console.log(
    `${chalk.white('Tasks:')} ${execution.progress.completed}/${execution.progress.total} completed`,
  );

  if (execution.progress.failed > 0) {
    console.log(`${chalk.white('Failed:')} ${execution.progress.failed}`);
  }
}

async function executeWorkflowWithWatch(
  execution: WorkflowExecution,
  workflow: WorkflowDefinition,
  options: any,
): Promise<void> {
  console.log(chalk.yellow('Starting workflow execution in watch mode...'));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));

  // Start execution in background and watch progress
  const executionPromise = executeWorkflow(execution, workflow, options);

  // Watch loop
  const watchInterval = setInterval(() => {
    displayWorkflowProgress(execution);
  }, 1000);

  try {
    await executionPromise;
  } finally {
    clearInterval(watchInterval);
    displayWorkflowProgress(execution);
  }
}

async function watchWorkflowStatus(workflowId: string): Promise<void> {
  console.log(chalk.cyan('Watching workflow status...'));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      console.clear();
      const execution = await getWorkflowExecution(workflowId);
      displayWorkflowStatus(execution);

      if (
        execution.status === 'completed' ||
        execution.status === 'failed' ||
        execution.status === 'stopped'
      ) {
        console.log('\n' + chalk.gray('Workflow finished. Exiting watch mode.'));
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(chalk.red('Error watching workflow:'), (error as Error).message);
      break;
    }
  }
}

function displayWorkflowStatus(execution: WorkflowExecution): void {
  console.log(chalk.cyan.bold('Workflow Status'));
  console.log('─'.repeat(50));

  const statusIcon = formatStatusIndicator(execution.status);
  const duration = execution.completedAt
    ? formatDuration(execution.completedAt.getTime() - execution.startedAt.getTime())
    : formatDuration(Date.now() - execution.startedAt.getTime());

  console.log(`${chalk.white('Name:')} ${execution.workflowName}`);
  console.log(`${chalk.white('ID:')} ${execution.id}`);
  console.log(`${chalk.white('Status:')} ${statusIcon} ${execution.status}`);
  console.log(`${chalk.white('Started:')} ${execution.startedAt.toLocaleString()}`);
  console.log(`${chalk.white('Duration:')} ${duration}`);

  const progressBar = formatProgressBar(
    execution.progress.completed,
    execution.progress.total,
    40,
    'Progress',
  );
  console.log(`${progressBar} ${execution.progress.completed}/${execution.progress.total}`);

  if (execution.progress.failed > 0) {
    console.log(
      `${chalk.white('Failed Tasks:')} ${chalk.red(execution.progress.failed.toString())}`,
    );
  }
  console.log();

  // Task details
  console.log(chalk.cyan.bold('Tasks'));
  console.log('─'.repeat(50));

  const table = new Table.default({
    head: ['Task', 'Status', 'Duration', 'Agent'],
  });

  for (const taskExec of execution.tasks) {
    const statusIcon = formatStatusIndicator(taskExec.status);
    const duration =
      taskExec.completedAt && taskExec.startedAt
        ? formatDuration(taskExec.completedAt.getTime() - taskExec.startedAt.getTime())
        : taskExec.startedAt
          ? formatDuration(Date.now() - taskExec.startedAt.getTime())
          : '-';

    table.push([
      chalk.white(taskExec.taskId),
      `${statusIcon} ${taskExec.status}`,
      duration,
      taskExec.assignedAgent || '-',
    ]);
  }

  console.log(table.toString());
}

function displayWorkflowProgress(execution: WorkflowExecution): void {
  const progress = `${execution.progress.completed}/${execution.progress.total}`;
  const progressBar = formatProgressBar(execution.progress.completed, execution.progress.total, 30);

  console.log(`\r${progressBar} ${progress} tasks completed`);
}

async function getRunningWorkflows(includeAll = false): Promise<WorkflowExecution[]> {
  // Mock workflow list - in production, this would query the orchestrator
  return [
    {
      id: 'workflow-001',
      workflowName: 'Research Workflow',
      status: 'running' as const,
      startedAt: new Date(Date.now() - 120000), // 2 minutes ago
      progress: { total: 5, completed: 3, failed: 0 },
      tasks: [],
    },
    {
      id: 'workflow-002',
      workflowName: 'Implementation Workflow',
      status: 'completed' as const,
      startedAt: new Date(Date.now() - 300000), // 5 minutes ago
      completedAt: new Date(Date.now() - 60000), // 1 minute ago
      progress: { total: 3, completed: 3, failed: 0 },
      tasks: [],
    },
  ].filter((w) => includeAll || w.status === 'running');
}

async function getWorkflowExecution(workflowId: string): Promise<WorkflowExecution> {
  const workflows = await getRunningWorkflows(true);
  const workflow = workflows.find((w) => w.id === workflowId || w.id.startsWith(workflowId));

  if (!workflow) {
    throw new Error(`Workflow '${workflowId}' not found`);
  }

  return workflow;
}

function hasCircularDependencies(graph: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(node: string): boolean {
    if (recursionStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    recursionStack.add(node);

    const dependencies = graph.get(node) || [];
    for (const dep of dependencies) {
      if (hasCycle(dep)) return true;
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (hasCycle(node)) return true;
  }

  return false;
}
