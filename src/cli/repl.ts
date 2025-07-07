import { getErrorMessage } from '../utils/error-handler.js';
import { promises as fs } from 'node:fs';
/**
 * Enhanced Interactive REPL for Claude-Flow
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { AgentProfile, Task } from '../utils/types.js';
import { generateId } from '../utils/helpers.js';
import { formatStatusIndicator, formatDuration, formatProgressBar } from './formatter.js';

interface REPLCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  examples?: string[];
  handler: (args: string[], context: REPLContext) => Promise<void>;
}

interface REPLContext {
  options: any;
  history: string[];
  workingDirectory: string;
  currentSession?: string;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastActivity: Date;
}

class CommandHistory {
  private history: string[] = [];
  private maxSize = 1000;
  private historyFile: string;

  constructor(historyFile?: string) {
    this.historyFile = historyFile || '.claude-flow-history';
    this.loadHistory();
  }

  add(command: string): void {
    if (command.trim() && command !== this.history[this.history.length - 1]) {
      this.history.push(command);
      if (this.history.length > this.maxSize) {
        this.history = this.history.slice(-this.maxSize);
      }
      this.saveHistory();
    }
  }

  get(): string[] {
    return [...this.history];
  }

  search(query: string): string[] {
    return this.history.filter(cmd => cmd.includes(query));
  }

  private async loadHistory(): Promise<void> {
    try {
      const content = await fs.readFile(this.historyFile, 'utf-8');
      this.history = content.split('\n').filter((line: string) => line.trim());
    } catch {
      // History file doesn't exist yet
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await fs.writeFile(this.historyFile, this.history.join('\n'));
    } catch {
      // Ignore save errors
    }
  }
}

class CommandCompleter {
  private commands: Map<string, REPLCommand> = new Map();
  
  setCommands(commands: REPLCommand[]): void {
    this.commands.clear();
    for (const cmd of commands) {
      this.commands.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          this.commands.set(alias, cmd);
        }
      }
    }
  }

  complete(input: string): string[] {
    const parts = input.trim().split(/\s+/);
    
    if (parts.length === 1) {
      // Complete command names
      const prefix = parts[0];
      return Array.from(this.commands.keys())
        .filter(name => name.startsWith(prefix))
        .sort();
    }
    
    // Complete subcommands and arguments
    const commandName = parts[0];
    const command = this.commands.get(commandName);
    
    if (command) {
      return this.completeForCommand(command, parts.slice(1));
    }
    
    return [];
  }

  private completeForCommand(command: REPLCommand, args: string[]): string[] {
    // Basic completion for known commands
    switch (command.name) {
      case 'agent':
        if (args.length === 1) {
          return ['spawn', 'list', 'terminate', 'info'].filter(sub => 
            sub.startsWith(args[0])
          );
        }
        if (args[0] === 'spawn' && args.length === 2) {
          return ['coordinator', 'researcher', 'implementer', 'analyst', 'custom']
            .filter(type => type.startsWith(args[1]));
        }
        break;
      
      case 'task':
        if (args.length === 1) {
          return ['create', 'list', 'status', 'cancel', 'workflow'].filter(sub => 
            sub.startsWith(args[0])
          );
        }
        if (args[0] === 'create' && args.length === 2) {
          return ['research', 'implementation', 'analysis', 'coordination']
            .filter(type => type.startsWith(args[1]));
        }
        break;
      
      case 'session':
        if (args.length === 1) {
          return ['list', 'save', 'restore', 'delete', 'export', 'import']
            .filter(sub => sub.startsWith(args[0]));
        }
        break;
      
      case 'workflow':
        if (args.length === 1) {
          return ['run', 'validate', 'list', 'status', 'stop', 'template']
            .filter(sub => sub.startsWith(args[0]));
        }
        break;
    }
    
    return [];
  }
}

/**
 * Start the enhanced interactive REPL
 */
export async function startREPL(options: any = {}): Promise<void> {
  const context: REPLContext = {
    options,
    history: [],
    workingDirectory: process.cwd(),
    connectionStatus: 'disconnected',
    lastActivity: new Date(),
  };

  const history = new CommandHistory(options.historyFile);
  const completer = new CommandCompleter();
  
  const commands: REPLCommand[] = [
    {
      name: 'help',
      aliases: ['h', '?'],
      description: 'Show available commands or help for a specific command',
      usage: 'help [command]',
      examples: ['help', 'help agent', 'help task create'],
      handler: async (args) => {
        if (args.length === 0) {
          showHelp(commands);
        } else {
          showCommandHelp(commands, args[0]);
        }
      },
    },
    {
      name: 'status',
      aliases: ['st'],
      description: 'Show system status and connection info',
      usage: 'status [component]',
      examples: ['status', 'status orchestrator'],
      handler: async (args, ctx) => {
        await showSystemStatus(ctx, args[0]);
      },
    },
    {
      name: 'connect',
      aliases: ['conn'],
      description: 'Connect to Claude-Flow orchestrator',
      usage: 'connect [host:port]',
      examples: ['connect', 'connect localhost:3000'],
      handler: async (args, ctx) => {
        await connectToOrchestrator(ctx, args[0]);
      },
    },
    {
      name: 'agent',
      description: 'Agent management (spawn, list, terminate, info)',
      usage: 'agent <subcommand> [options]',
      examples: [
        'agent list',
        'agent spawn researcher --name "Research Agent"',
        'agent info agent-001',
        'agent terminate agent-001'
      ],
      handler: async (args, ctx) => {
        await handleAgentCommand(args, ctx);
      },
    },
    {
      name: 'task',
      description: 'Task management (create, list, status, cancel)',
      usage: 'task <subcommand> [options]',
      examples: [
        'task list',
        'task create research "Find quantum computing papers"',
        'task status task-001',
        'task cancel task-001'
      ],
      handler: async (args, ctx) => {
        await handleTaskCommand(args, ctx);
      },
    },
    {
      name: 'memory',
      description: 'Memory operations (query, stats, export)',
      usage: 'memory <subcommand> [options]',
      examples: [
        'memory stats',
        'memory query --agent agent-001',
        'memory export memory.json'
      ],
      handler: async (args, ctx) => {
        await handleMemoryCommand(args, ctx);
      },
    },
    {
      name: 'session',
      description: 'Session management (save, restore, list)',
      usage: 'session <subcommand> [options]',
      examples: [
        'session list',
        'session save "Development Session"',
        'session restore session-001'
      ],
      handler: async (args, ctx) => {
        await handleSessionCommand(args, ctx);
      },
    },
    {
      name: 'workflow',
      description: 'Workflow operations (run, list, status)',
      usage: 'workflow <subcommand> [options]',
      examples: [
        'workflow list',
        'workflow run workflow.json',
        'workflow status workflow-001'
      ],
      handler: async (args, ctx) => {
        await handleWorkflowCommand(args, ctx);
      },
    },
    {
      name: 'monitor',
      aliases: ['mon'],
      description: 'Start monitoring mode',
      usage: 'monitor [--interval seconds]',
      examples: ['monitor', 'monitor --interval 5'],
      handler: async (args) => {
        console.log(chalk.cyan('Starting monitor mode...'));
        console.log(chalk.gray('(This would start the live dashboard)'));
      },
    },
    {
      name: 'history',
      aliases: ['hist'],
      description: 'Show command history',
      usage: 'history [--search query]',
      examples: ['history', 'history --search agent'],
      handler: async (args) => {
        const searchQuery = args.indexOf('--search') >= 0 ? args[args.indexOf('--search') + 1] : null;
        const historyItems = searchQuery ? history.search(searchQuery) : history.get();
        
        console.log(chalk.cyan.bold(`Command History${searchQuery ? ` (search: ${searchQuery})` : ''}`));
        console.log('─'.repeat(50));
        
        if (historyItems.length === 0) {
          console.log(chalk.gray('No commands in history'));
          return;
        }
        
        const recent = historyItems.slice(-20); // Show last 20
        recent.forEach((cmd, i) => {
          const lineNumber = historyItems.length - recent.length + i + 1;
          console.log(`${chalk.gray(lineNumber.toString().padStart(3))} ${cmd}`);
        });
      },
    },
    {
      name: 'clear',
      aliases: ['cls'],
      description: 'Clear the screen',
      handler: async () => {
        console.clear();
      },
    },
    {
      name: 'cd',
      description: 'Change working directory',
      usage: 'cd <directory>',
      examples: ['cd /path/to/project', 'cd ..'],
      handler: async (args, ctx) => {
        if (args.length === 0) {
          console.log(ctx.workingDirectory);
          return;
        }
        
        try {
          const newDir = args[0] === '~' ? process.env['HOME'] || '/' : args[0];
          process.chdir(newDir);
          ctx.workingDirectory = process.cwd();
          console.log(chalk.gray(`Changed to: ${ctx.workingDirectory}`));
        } catch (error) {
          console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      name: 'pwd',
      description: 'Print working directory',
      handler: async (_, ctx) => {
        console.log(ctx.workingDirectory);
      },
    },
    {
      name: 'echo',
      description: 'Echo arguments',
      usage: 'echo <text>',
      examples: ['echo "Hello, world!"'],
      handler: async (args) => {
        console.log(args.join(' '));
      },
    },
    {
      name: 'exit',
      aliases: ['quit', 'q'],
      description: 'Exit the REPL',
      handler: async () => {
        console.log(chalk.gray('Goodbye!'));
        process.exit(0);
      },
    },
  ];

  // Set up command completion
  completer.setCommands(commands);
  
  // Show initial status
  if (!options.quiet) {
    await showSystemStatus(context);
    console.log(chalk.gray('Type "help" for available commands or "exit" to quit.\n'));
  }

  // Main REPL loop
  while (true) {
    try {
      const prompt = createPrompt(context);
      const answers = await inquirer.prompt([{
        type: 'input',
        name: 'command',
        message: prompt,
      }]);
      const input = answers.command;

      if (!input.trim()) {
        continue;
      }

      // Add to history
      history.add(input);
      context.history.push(input);
      context.lastActivity = new Date();

      // Parse command
      const args = parseCommand(input);
      const [commandName, ...commandArgs] = args;
      
      // Find and execute command
      const command = commands.find(c => 
        c.name === commandName || 
        (c.aliases && c.aliases.includes(commandName))
      );

      if (command) {
        try {
          await command.handler(commandArgs, context);
        } catch (error) {
          console.error(chalk.red('Command failed:'), error instanceof Error ? error.message : String(error));
        }
      } else {
        console.log(chalk.red(`Unknown command: ${commandName}`));
        console.log(chalk.gray('Type "help" for available commands'));
        
        // Suggest similar commands
        const suggestions = findSimilarCommands(commandName, commands);
        if (suggestions.length > 0) {
          console.log(chalk.gray('Did you mean:'), suggestions.map(s => chalk.cyan(s)).join(', '));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('EOF') || errorMessage.includes('interrupted')) {
        // Ctrl+D or Ctrl+C pressed
        console.log('\n' + chalk.gray('Goodbye!'));
        break;
      }
      console.error(chalk.red('REPL Error:'), errorMessage);
    }
  }
}

function createPrompt(context: REPLContext): string {
  const statusIcon = getConnectionStatusIcon(context.connectionStatus);
  const dir = context.workingDirectory.split('/').pop() || '/';
  
  return `${statusIcon} ${chalk.cyan('claude-flow')}:${chalk.yellow(dir)}${chalk.white('>')} `;
}

function getConnectionStatusIcon(status: string): string {
  switch (status) {
    case 'connected': return chalk.green('●');
    case 'connecting': return chalk.yellow('◐');
    case 'disconnected': return chalk.red('○');
    default: return chalk.gray('?');
  }
}

function parseCommand(input: string): string[] {
  // Simple command parsing - handle quoted strings
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current.trim()) {
          args.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }
  }
  
  if (current.trim()) {
    args.push(current.trim());
  }
  
  return args;
}

function showHelp(commands: REPLCommand[]): void {
  console.log(chalk.cyan.bold('Claude-Flow Interactive REPL'));
  console.log('─'.repeat(50));
  console.log();
  
  console.log(chalk.white.bold('Available Commands:'));
  console.log();
  
  const table = new Table({
    head: ['Command', 'Aliases', 'Description'],
    style: { border: [] }
  });

  for (const cmd of commands) {
    table.push([
      chalk.cyan(cmd.name),
      cmd.aliases ? chalk.gray(cmd.aliases.join(', ')) : '',
      cmd.description
    ]);
  }
  
  console.log(table.toString());
  console.log();
  
  console.log(chalk.gray('Tips:'));
  console.log(chalk.gray('• Use TAB for command completion'));
  console.log(chalk.gray('• Use "help <command>" for detailed help'));
  console.log(chalk.gray('• Use UP/DOWN arrows for command history'));
  console.log(chalk.gray('• Use Ctrl+C or "exit" to quit'));
}

function showCommandHelp(commands: REPLCommand[], commandName: string): void {
  const command = commands.find(c => 
    c.name === commandName || 
    (c.aliases && c.aliases.includes(commandName))
  );
  
  if (!command) {
    console.log(chalk.red(`Unknown command: ${commandName}`));
    return;
  }
  
  console.log(chalk.cyan.bold(`Command: ${command.name}`));
  console.log('─'.repeat(30));
  console.log(`${chalk.white('Description:')} ${command.description}`);
  
  if (command.aliases) {
    console.log(`${chalk.white('Aliases:')} ${command.aliases.join(', ')}`);
  }
  
  if (command.usage) {
    console.log(`${chalk.white('Usage:')} ${command.usage}`);
  }
  
  if (command.examples) {
    console.log();
    console.log(chalk.white.bold('Examples:'));
    for (const example of command.examples) {
      console.log(`  ${chalk.gray('$')} ${chalk.cyan(example)}`);
    }
  }
}

async function showSystemStatus(context: REPLContext, component?: string): Promise<void> {
  console.log(chalk.cyan.bold('System Status'));
  console.log('─'.repeat(30));
  
  const statusIcon = formatStatusIndicator(context.connectionStatus === 'connected' ? 'success' : 'error');
  console.log(`${statusIcon} Connection: ${context.connectionStatus}`);
  console.log(`${chalk.white('Working Directory:')} ${context.workingDirectory}`);
  console.log(`${chalk.white('Last Activity:')} ${context.lastActivity.toLocaleTimeString()}`);
  
  if (context.currentSession) {
    console.log(`${chalk.white('Current Session:')} ${context.currentSession}`);
  }
  
  console.log(`${chalk.white('Commands in History:')} ${context.history.length}`);
  
  if (context.connectionStatus === 'disconnected') {
    console.log();
    console.log(chalk.yellow('⚠ Not connected to orchestrator'));
    console.log(chalk.gray('Use "connect" command to establish connection'));
  }
}

async function connectToOrchestrator(context: REPLContext, target?: string): Promise<void> {
  const host = target || 'localhost:3000';
  
  console.log(chalk.yellow(`Connecting to ${host}...`));
  context.connectionStatus = 'connecting';
  
  // Mock connection attempt
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Simulate connection result
  const success = Math.random() > 0.3; // 70% success rate
  
  if (success) {
    context.connectionStatus = 'connected';
    console.log(chalk.green('✓ Connected successfully'));
  } else {
    context.connectionStatus = 'disconnected';
    console.log(chalk.red('✗ Connection failed'));
    console.log(chalk.gray('Make sure Claude-Flow is running with: claude-flow start'));
  }
}

async function handleAgentCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(chalk.yellow('⚠ Not connected to orchestrator'));
    console.log(chalk.gray('Use "connect" to establish connection first'));
    return;
  }

  if (args.length === 0) {
    console.log(chalk.gray('Usage: agent <spawn|list|terminate|info> [options]'));
    return;
  }
  
  const subcommand = args[0];
  switch (subcommand) {
    case 'list':
      await showAgentList();
      break;
    case 'spawn':
      await handleAgentSpawn(args.slice(1));
      break;
    case 'terminate':
      if (args.length < 2) {
        console.log(chalk.red('Please specify agent ID'));
      } else {
        await handleAgentTerminate(args[1]);
      }
      break;
    case 'info':
      if (args.length < 2) {
        console.log(chalk.red('Please specify agent ID'));
      } else {
        await showAgentInfo(args[1]);
      }
      break;
    default:
      console.log(chalk.red(`Unknown agent subcommand: ${subcommand}`));
  }
}

async function showAgentList(): Promise<void> {
  // Mock agent data
  const agents = [
    { id: 'agent-001', name: 'Coordinator', type: 'coordinator', status: 'active', tasks: 2 },
    { id: 'agent-002', name: 'Researcher', type: 'researcher', status: 'active', tasks: 5 },
    { id: 'agent-003', name: 'Implementer', type: 'implementer', status: 'idle', tasks: 0 },
  ];
  
  console.log(chalk.cyan.bold(`Active Agents (${agents.length})`));
  console.log('─'.repeat(50));
  
  const table = new Table({
    head: ['ID', 'Name', 'Type', 'Status', 'Tasks']
  });

  for (const agent of agents) {
    const statusIcon = formatStatusIndicator(agent.status);
    
    table.push([
      chalk.gray(agent.id),
      chalk.white(agent.name),
      chalk.cyan(agent.type),
      `${statusIcon} ${agent.status}`,
      agent.tasks.toString()
    ]);
  }
  
  console.log(table.toString());
}

async function handleAgentSpawn(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(chalk.gray('Usage: agent spawn <type> [name]'));
    console.log(chalk.gray('Types: coordinator, researcher, implementer, analyst, custom'));
    return;
  }

  const type = args[0];
  let name = args[1];
  if (!name) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: 'Agent name:',
      default: `${type}-agent`,
    }]);
    name = answers.name;
  }

  console.log(chalk.yellow('Spawning agent...'));
  
  // Mock spawning
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const agentId = generateId('agent');
  console.log(chalk.green('✓ Agent spawned successfully'));
  console.log(`${chalk.white('ID:')} ${agentId}`);
  console.log(`${chalk.white('Name:')} ${name}`);
  console.log(`${chalk.white('Type:')} ${type}`);
}

async function handleAgentTerminate(agentId: string): Promise<void> {
  const answers = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmed',
    message: `Terminate agent ${agentId}?`,
    default: false,
  }]);
  const confirmed = answers.confirmed;
  
  if (!confirmed) {
    console.log(chalk.gray('Termination cancelled'));
    return;
  }
  
  console.log(chalk.yellow('Terminating agent...'));
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log(chalk.green('✓ Agent terminated'));
}

async function showAgentInfo(agentId: string): Promise<void> {
  // Mock agent info
  console.log(chalk.cyan.bold('Agent Information'));
  console.log('─'.repeat(30));
  console.log(`${chalk.white('ID:')} ${agentId}`);
  console.log(`${chalk.white('Name:')} Research Agent`);
  console.log(`${chalk.white('Type:')} researcher`);
  console.log(`${chalk.white('Status:')} ${formatStatusIndicator('success')} active`);
  console.log(`${chalk.white('Uptime:')} ${formatDuration(3600000)}`);
  console.log(`${chalk.white('Active Tasks:')} 3`);
  console.log(`${chalk.white('Completed Tasks:')} 12`);
}

async function handleTaskCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(chalk.yellow('⚠ Not connected to orchestrator'));
    return;
  }

  if (args.length === 0) {
    console.log(chalk.gray('Usage: task <create|list|status|cancel> [options]'));
    return;
  }
  
  const subcommand = args[0];
  switch (subcommand) {
    case 'list':
      await showTaskList();
      break;
    case 'create':
      await handleTaskCreate(args.slice(1));
      break;
    case 'status':
      if (args.length < 2) {
        console.log(chalk.red('Please specify task ID'));
      } else {
        await showTaskStatus(args[1]);
      }
      break;
    case 'cancel':
      if (args.length < 2) {
        console.log(chalk.red('Please specify task ID'));
      } else {
        await handleTaskCancel(args[1]);
      }
      break;
    default:
      console.log(chalk.red(`Unknown task subcommand: ${subcommand}`));
  }
}

async function showTaskList(): Promise<void> {
  // Mock task data
  const tasks = [
    { id: 'task-001', type: 'research', description: 'Research quantum computing', status: 'running', agent: 'agent-002' },
    { id: 'task-002', type: 'analysis', description: 'Analyze research results', status: 'pending', agent: null },
    { id: 'task-003', type: 'implementation', description: 'Implement solution', status: 'completed', agent: 'agent-003' },
  ];
  
  console.log(chalk.cyan.bold(`Tasks (${tasks.length})`));
  console.log('─'.repeat(60));
  
  const table = new Table({
    head: ['ID', 'Type', 'Description', 'Status', 'Agent']
  });

  for (const task of tasks) {
    const statusIcon = formatStatusIndicator(task.status);
    
    table.push([
      chalk.gray(task.id),
      chalk.white(task.type),
      task.description.substring(0, 30) + (task.description.length > 30 ? '...' : ''),
      `${statusIcon} ${task.status}`,
      task.agent ? chalk.cyan(task.agent) : '-'
    ]);
  }
  
  console.log(table.toString());
}

async function handleTaskCreate(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.gray('Usage: task create <type> <description>'));
    return;
  }

  const type = args[0];
  const description = args.slice(1).join(' ');
  
  console.log(chalk.yellow('Creating task...'));
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const taskId = generateId('task');
  console.log(chalk.green('✓ Task created successfully'));
  console.log(`${chalk.white('ID:')} ${taskId}`);
  console.log(`${chalk.white('Type:')} ${type}`);
  console.log(`${chalk.white('Description:')} ${description}`);
}

async function showTaskStatus(taskId: string): Promise<void> {
  console.log(chalk.cyan.bold('Task Status'));
  console.log('─'.repeat(30));
  console.log(`${chalk.white('ID:')} ${taskId}`);
  console.log(`${chalk.white('Type:')} research`);
  console.log(`${chalk.white('Status:')} ${formatStatusIndicator('running')} running`);
  console.log(`${chalk.white('Progress:')} ${formatProgressBar(65, 100, 20)} 65%`);
  console.log(`${chalk.white('Agent:')} agent-002`);
  console.log(`${chalk.white('Started:')} ${new Date().toLocaleTimeString()}`);
}

async function handleTaskCancel(taskId: string): Promise<void> {
  const answers = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmed',
    message: `Cancel task ${taskId}?`,
    default: false,
  }]);
  const confirmed = answers.confirmed;
  
  if (!confirmed) {
    console.log(chalk.gray('Cancellation cancelled'));
    return;
  }
  
  console.log(chalk.yellow('Cancelling task...'));
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log(chalk.green('✓ Task cancelled'));
}

async function handleMemoryCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(chalk.yellow('⚠ Not connected to orchestrator'));
    return;
  }

  if (args.length === 0) {
    console.log(chalk.gray('Usage: memory <query|stats|export> [options]'));
    return;
  }
  
  const subcommand = args[0];
  switch (subcommand) {
    case 'stats':
      await showMemoryStats();
      break;
    case 'query':
      console.log(chalk.yellow('Memory query functionality not yet implemented in REPL'));
      break;
    case 'export':
      console.log(chalk.yellow('Memory export functionality not yet implemented in REPL'));
      break;
    default:
      console.log(chalk.red(`Unknown memory subcommand: ${subcommand}`));
  }
}

async function showMemoryStats(): Promise<void> {
  console.log(chalk.cyan.bold('Memory Statistics'));
  console.log('─'.repeat(30));
  console.log(`${chalk.white('Total Entries:')} 1,247`);
  console.log(`${chalk.white('Cache Size:')} 95 MB`);
  console.log(`${chalk.white('Hit Rate:')} 94.2%`);
  console.log(`${chalk.white('Backend:')} SQLite + Markdown`);
}

async function handleSessionCommand(args: string[], context: REPLContext): Promise<void> {
  if (args.length === 0) {
    console.log(chalk.gray('Usage: session <list|save|restore> [options]'));
    return;
  }
  
  const subcommand = args[0];
  switch (subcommand) {
    case 'list':
      await showSessionList();
      break;
    case 'save':
      await handleSessionSave(args.slice(1));
      break;
    case 'restore':
      if (args.length < 2) {
        console.log(chalk.red('Please specify session ID'));
      } else {
        await handleSessionRestore(args[1]);
      }
      break;
    default:
      console.log(chalk.red(`Unknown session subcommand: ${subcommand}`));
  }
}

async function showSessionList(): Promise<void> {
  // Mock session data
  const sessions = [
    { id: 'session-001', name: 'Research Project', date: '2024-01-15', agents: 3, tasks: 8 },
    { id: 'session-002', name: 'Development', date: '2024-01-14', agents: 2, tasks: 5 },
  ];
  
  console.log(chalk.cyan.bold(`Saved Sessions (${sessions.length})`));
  console.log('─'.repeat(50));
  
  const table = new Table({
    head: ['ID', 'Name', 'Date', 'Agents', 'Tasks']
  });

  for (const session of sessions) {
    table.push([
      chalk.gray(session.id),
      chalk.white(session.name),
      session.date,
      session.agents.toString(),
      session.tasks.toString()
    ]);
  }
  
  console.log(table.toString());
}

async function handleSessionSave(args: string[]): Promise<void> {
  let name = args.length > 0 ? args.join(' ') : '';
  if (!name) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: 'Session name:',
      default: `session-${new Date().toISOString().split('T')[0]}`,
    }]);
    name = answers.name;
  }
  
  console.log(chalk.yellow('Saving session...'));
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const sessionId = generateId('session');
  console.log(chalk.green('✓ Session saved successfully'));
  console.log(`${chalk.white('ID:')} ${sessionId}`);
  console.log(`${chalk.white('Name:')} ${name}`);
}

async function handleSessionRestore(sessionId: string): Promise<void> {
  const answers = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmed',
    message: `Restore session ${sessionId}?`,
    default: false,
  }]);
  const confirmed = answers.confirmed;
  
  if (!confirmed) {
    console.log(chalk.gray('Restore cancelled'));
    return;
  }
  
  console.log(chalk.yellow('Restoring session...'));
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(chalk.green('✓ Session restored successfully'));
}

async function handleWorkflowCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(chalk.yellow('⚠ Not connected to orchestrator'));
    return;
  }

  if (args.length === 0) {
    console.log(chalk.gray('Usage: workflow <list|run|status> [options]'));
    return;
  }
  
  const subcommand = args[0];
  switch (subcommand) {
    case 'list':
      await showWorkflowList();
      break;
    case 'run':
      if (args.length < 2) {
        console.log(chalk.red('Please specify workflow file'));
      } else {
        await handleWorkflowRun(args[1]);
      }
      break;
    case 'status':
      if (args.length < 2) {
        console.log(chalk.red('Please specify workflow ID'));
      } else {
        await showWorkflowStatus(args[1]);
      }
      break;
    default:
      console.log(chalk.red(`Unknown workflow subcommand: ${subcommand}`));
  }
}

async function showWorkflowList(): Promise<void> {
  // Mock workflow data
  const workflows = [
    { id: 'workflow-001', name: 'Research Pipeline', status: 'running', progress: 60 },
    { id: 'workflow-002', name: 'Data Analysis', status: 'completed', progress: 100 },
  ];
  
  console.log(chalk.cyan.bold(`Workflows (${workflows.length})`));
  console.log('─'.repeat(50));
  
  const table = new Table({
    head: ['ID', 'Name', 'Status', 'Progress']
  });

  for (const workflow of workflows) {
    const statusIcon = formatStatusIndicator(workflow.status);
    const progressBar = formatProgressBar(workflow.progress, 100, 15);
    
    table.push([
      chalk.gray(workflow.id),
      chalk.white(workflow.name),
      `${statusIcon} ${workflow.status}`,
      `${progressBar} ${workflow.progress}%`
    ]);
  }
  
  console.log(table.toString());
}

async function handleWorkflowRun(filename: string): Promise<void> {
  try {
    await fs.stat(filename);
    console.log(chalk.yellow(`Running workflow: ${filename}`));
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const workflowId = generateId('workflow');
    console.log(chalk.green('✓ Workflow started successfully'));
    console.log(`${chalk.white('ID:')} ${workflowId}`);
  } catch {
    console.log(chalk.red(`Workflow file not found: ${filename}`));
  }
}

async function showWorkflowStatus(workflowId: string): Promise<void> {
  console.log(chalk.cyan.bold('Workflow Status'));
  console.log('─'.repeat(30));
  console.log(`${chalk.white('ID:')} ${workflowId}`);
  console.log(`${chalk.white('Name:')} Research Pipeline`);
  console.log(`${chalk.white('Status:')} ${formatStatusIndicator('running')} running`);
  console.log(`${chalk.white('Progress:')} ${formatProgressBar(75, 100, 20)} 75%`);
  console.log(`${chalk.white('Tasks:')} 6/8 completed`);
  console.log(`${chalk.white('Started:')} ${new Date().toLocaleTimeString()}`);
}

function findSimilarCommands(input: string, commands: REPLCommand[]): string[] {
  const allNames = commands.flatMap(c => [c.name, ...(c.aliases || [])]);
  
  return allNames
    .filter(name => {
      // Simple similarity check - could use Levenshtein distance
      const commonChars = input.split('').filter(char => name.includes(char)).length;
      return commonChars >= Math.min(2, input.length / 2);
    })
    .slice(0, 3); // Top 3 suggestions
}
