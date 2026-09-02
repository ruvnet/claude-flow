// task.js - Task management commands with improved argument parsing
import { printSuccess, printError, printWarning } from '../utils.js';
import { Command } from 'commander';

export async function taskCommand(subArgs, flags) {
  const taskCmd = subArgs[0];

  switch (taskCmd) {
    case 'create':
      await createTask(subArgs, flags);
      break;

    case 'list':
      await listTasks(subArgs, flags);
      break;

    case 'status':
      await showTaskStatus(subArgs, flags);
      break;

    case 'cancel':
      await cancelTask(subArgs, flags);
      break;

    case 'workflow':
      await executeWorkflow(subArgs, flags);
      break;

    case 'coordination':
      await manageCoordination(subArgs, flags);
      break;

    default:
      showTaskHelp();
  }
}

async function createTask(subArgs, flags) {
  // Use commander for robust argument parsing
  const program = new Command()
    .exitOverride()
    .allowUnknownOption()
    .option('--priority <value>', 'Set task priority (1-10)', '5');

  try {
    // Parse the arguments starting from the create command
    program.parse(subArgs, { from: 'user' });
  } catch (err) {
    // Continue even if commander throws
  }

  const opts = program.opts();
  const args = program.args;

  // Extract task type and description with proper quote handling
  const taskType = args[1]; // First arg after 'create'

  // Join remaining args for description, handling quoted strings properly
  let description = '';
  if (args.length > 2) {
    // If the description starts with a quote, find the matching end quote
    const descriptionArgs = args.slice(2);
    description = parseQuotedDescription(descriptionArgs);
  }

  if (!taskType || !description) {
    printError('Usage: task create <type> "<description>"');
    console.log('Types: research, code, analysis, coordination, general');
    return;
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const priority = parseInt(opts.priority || '5', 10);

  // Create the task object
  const task = {
    id: taskId,
    type: taskType,
    description: description,
    priority: priority,
    status: 'queued',
    createdAt: Date.now(),
    assignedTo: null,
    progress: 0
  };

  // Store task in tasks directory
  const { promises: fs } = await import('fs');
  const path = await import('path');
  
  // Ensure tasks directory exists
  const tasksDir = '.claude-flow/tasks';
  await fs.mkdir(tasksDir, { recursive: true });
  
  // Save task data
  const taskFile = path.join(tasksDir, `${taskId}.json`);
  await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
  
  // Update task queue file
  const queueFile = '.claude-flow/tasks/queue.json';
  let queue = [];
  try {
    const queueData = await fs.readFile(queueFile, 'utf8');
    queue = JSON.parse(queueData);
  } catch (e) {
    // Queue file doesn't exist yet
  }
  
  // Add task to queue (sorted by priority)
  queue.push(task);
  queue.sort((a, b) => b.priority - a.priority);
  await fs.writeFile(queueFile, JSON.stringify(queue, null, 2));

  printSuccess(`✅ Created ${taskType} task: ${taskId}`);
  console.log(`📋 Description: ${description}`);
  console.log(`⚡ Priority: ${priority}/10`);
  console.log(`🏷️  Type: ${taskType}`);
  console.log(`📅 Status: Queued`);
  console.log(`📁 Location: ${taskFile}`);
  console.log(`\n✅ Task successfully added to queue (${queue.length} total tasks)`);
}

function parseQuotedDescription(args) {
  const fullString = args.join(' ');

  // Check if it starts with a quote
  if (fullString.startsWith('"') || fullString.startsWith("'")) {
    const quoteChar = fullString[0];
    const endIndex = fullString.lastIndexOf(quoteChar);

    if (endIndex > 0) {
      // Extract the quoted content
      return fullString.substring(1, endIndex);
    }
  }

  // If not quoted or improperly quoted, return the full string
  return fullString;
}

async function listTasks(subArgs, flags) {
  const program = new Command()
    .exitOverride()
    .allowUnknownOption()
    .option('--filter <status>', 'Filter by task status')
    .option('--verbose', 'Show detailed output')
    .option('-v', 'Show detailed output');

  try {
    program.parse(subArgs, { from: 'user' });
  } catch (err) {
    // Continue
  }

  const opts = program.opts();
  const filter = opts.filter;
  const verbose = opts.verbose || opts.v;

  const { promises: fs } = await import('fs');
  
  let queue = [];
  try {
    const queueFile = '.claude-flow/tasks/queue.json';
    const queueData = await fs.readFile(queueFile, 'utf8');
    queue = JSON.parse(queueData);
  } catch (e) {
    // Queue file doesn't exist yet
  }

  // Apply filter if specified
  if (filter) {
    queue = queue.filter(task => task.status === filter);
    console.log(`📊 Filtered by status: ${filter}`);
  }
  
  if (queue.length > 0) {
    printSuccess(`Task queue (${queue.length} tasks):`);
    queue.forEach((task, index) => {
      const statusEmoji = task.status === 'queued' ? '⏳' : 
                          task.status === 'running' ? '🔄' : 
                          task.status === 'completed' ? '✅' : '❌';
      console.log(`${index + 1}. ${statusEmoji} [${task.type}] ${task.description}`);
      console.log(`   Priority: ${task.priority}/10 | Status: ${task.status}`);
      if (verbose) {
        console.log(`   ID: ${task.id}`);
        console.log(`   Created: ${new Date(task.createdAt).toLocaleString()}`);
      }
      console.log('');
    });
  } else {
    console.log('📋 No tasks in queue' + (filter ? ` with status: ${filter}` : ''));
    console.log('\nTo create tasks:');
    console.log('  claude-flow task create research "Market analysis"');
    console.log('  claude-flow task create code "Implement API"');
    console.log('  claude-flow task create analysis "Data processing"');
  }
}

async function showTaskStatus(subArgs, flags) {
  const taskId = subArgs[1];

  if (!taskId) {
    printError('Usage: task status <task-id>');
    return;
  }

  printSuccess(`Task status: ${taskId}`);
  console.log('📊 Task details would include:');
  console.log('   Status, progress, assigned agent, execution time, results');
}

async function cancelTask(subArgs, flags) {
  const taskId = subArgs[1];

  if (!taskId) {
    printError('Usage: task cancel <task-id>');
    return;
  }

  printSuccess(`Cancelling task: ${taskId}`);
  console.log('🛑 Task would be gracefully cancelled');
}

async function executeWorkflow(subArgs, flags) {
  const workflowFile = subArgs[1];

  if (!workflowFile) {
    printError('Usage: task workflow <workflow-file>');
    return;
  }

  printSuccess(`Executing workflow: ${workflowFile}`);
  console.log('🔄 Workflow execution would include:');
  console.log('   - Parsing workflow definition');
  console.log('   - Creating dependent tasks');
  console.log('   - Orchestrating execution');
  console.log('   - Progress tracking');
}

async function manageCoordination(subArgs, flags) {
  const coordCmd = subArgs[1];

  switch (coordCmd) {
    case 'status':
      printSuccess('Task coordination status:');
      console.log('🎯 Coordination engine: Not running');
      console.log('   Active coordinators: 0');
      console.log('   Pending tasks: 0');
      console.log('   Resource utilization: 0%');
      break;

    case 'optimize':
      printSuccess('Optimizing task coordination...');
      console.log('⚡ Optimization would include:');
      console.log('   - Task dependency analysis');
      console.log('   - Resource allocation optimization');
      console.log('   - Parallel execution planning');
      break;

    default:
      console.log('Coordination commands: status, optimize');
  }
}

function showTaskHelp() {
  console.log('Task commands:');
  console.log('  create <type> "<description>"    Create new task');
  console.log('  list [--filter <status>]        List tasks');
  console.log('  status <id>                      Show task details');
  console.log('  cancel <id>                      Cancel running task');
  console.log('  workflow <file>                  Execute workflow file');
  console.log('  coordination <status|optimize>   Manage coordination');
  console.log();
  console.log('Task Types:');
  console.log('  research      Information gathering and analysis');
  console.log('  code          Software development tasks');
  console.log('  analysis      Data processing and insights');
  console.log('  coordination  Task orchestration and management');
  console.log('  general       General purpose tasks');
  console.log();
  console.log('Options:');
  console.log('  --priority <1-10>                Set task priority');
  console.log('  --filter <status>                Filter by status');
  console.log('  --verbose, -v                    Show detailed output');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow task create research "Market analysis" --priority 8');
  console.log('  claude-flow task list --filter running');
  console.log('  claude-flow task workflow examples/development-workflow.json');
  console.log('  claude-flow task coordination status');
}
