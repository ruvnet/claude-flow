/**
 * Node.js Interactive REPL for Claude-Flow
 * Compatible implementation using Node.js readline and inquirer
 */

import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from '../tracing/index.js';
import colors from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';

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
  rl: readline.Interface;
}

class CommandHistory {
  private history: string[] = [];
  private maxSize = 1000;
  private historyFile: string;

  constructor(historyFile?: string) {
    this.historyFile = historyFile || path.join(process.cwd(), '.claude-flow-history');
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
      this.history = content.split('\n').filter(line => line.trim());
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

  complete(line: string): [string[], string] {
    const parts = line.trim().split(/\s+/);
    
    if (parts.length === 1) {
      // Complete command names
      const prefix = parts[0];
      const completions = Array.from(this.commands.keys())
        .filter(name => name.startsWith(prefix))
        .sort();
      return [completions, prefix];
    }
    
    // Complete subcommands and arguments
    const commandName = parts[0];
    const command = this.commands.get(commandName);
    
    if (command) {
      const subCompletions = this.completeForCommand(command, parts.slice(1));
      return [subCompletions, parts[parts.length - 1]];
    }
    
    return [[], line];
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
 * Start the Node.js interactive REPL
 */
export async function startNodeREPL(options: any = {}): Promise<void> {
  
  // Create history and completer instances
  const history = new CommandHistory(options.historyFile);
  const completer = new CommandCompleter();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    completer: (line: string) => completer.complete(line),
  });

  const context: REPLContext = {
    options,
    history: [],
    workingDirectory: process.cwd(),
    connectionStatus: 'disconnected',
    lastActivity: new Date(),
    rl,
  };
  
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
        console.log(colors.cyan('Starting monitor mode...'));
        console.log(colors.gray('(This would start the live dashboard)'));
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
        
        console.log(colors.cyan.bold(`Command History${searchQuery ? ` (search: ${searchQuery})` : ''}`));
        console.log('─'.repeat(50));
        
        if (historyItems.length === 0) {
          console.log(colors.gray('No commands in history'));
          return;
        }
        
        const recent = historyItems.slice(-20); // Show last 20
        recent.forEach((cmd, i) => {
          const lineNumber = historyItems.length - recent.length + i + 1;
          console.log(`${colors.gray(lineNumber.toString().padStart(3))} ${cmd}`);
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
          const newDir = args[0] === '~' ? process.env.HOME || '/' : args[0];
          process.chdir(newDir);
          ctx.workingDirectory = process.cwd();
          console.log(colors.gray(`Changed to: ${ctx.workingDirectory}`));
        } catch (error) {
          console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
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
      handler: async (_, ctx) => {
        console.log(colors.gray('Goodbye!'));
        ctx.rl.close();
        process.exit(0);
      },
    },
  ];

  // Set up command completion
  completer.setCommands(commands);
  
  // Show initial status
  if (options.banner !== false) {
    displayBanner();
  }
  
  await showSystemStatus(context);
  console.log(colors.gray('Type "help" for available commands or "exit" to quit.\n'));

  // Main REPL loop
  const processCommand = async (input: string) => {
    if (!input.trim()) {
      return;
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
        console.error(colors.red('Command failed:'), error instanceof Error ? error.message : String(error));
      }
    } else {
      console.log(colors.red(`Unknown command: ${commandName}`));
      console.log(colors.gray('Type "help" for available commands'));
      
      // Suggest similar commands
      const suggestions = findSimilarCommands(commandName, commands);
      if (suggestions.length > 0) {
        console.log(colors.gray('Did you mean:'), suggestions.map(s => colors.cyan(s)).join(', '));
      }
    }
  };

  // Set up readline prompt
  const showPrompt = () => {
    const prompt = createPrompt(context);
    rl.setPrompt(prompt);
    rl.prompt();
  };

  rl.on('line', async (input) => {
    try {
      await processCommand(input);
    } catch (error) {
      console.error(colors.red('REPL Error:'), error instanceof Error ? error.message : String(error));
    }
    showPrompt();
  });

  rl.on('close', () => {
    console.log('\n' + colors.gray('Goodbye!'));
    process.exit(0);
  });

  rl.on('SIGINT', () => {
    console.log('\n' + colors.gray('Use "exit" to quit or Ctrl+D'));
    showPrompt();
  });

  // Start the REPL
  showPrompt();
}

function displayBanner(): void {
  const banner = `
${colors.cyan.bold('╔══════════════════════════════════════════════════════════════╗')}
${colors.cyan.bold('║')}             ${colors.white.bold('🧠 Claude-Flow REPL')}                        ${colors.cyan.bold('║')}
${colors.cyan.bold('║')}          ${colors.gray('Interactive AI Agent Orchestration')}             ${colors.cyan.bold('║')}
${colors.cyan.bold('╚══════════════════════════════════════════════════════════════╝')}
`;
  console.log(banner);
}

function createPrompt(context: REPLContext): string {
  const statusIcon = getConnectionStatusIcon(context.connectionStatus);
  const dir = path.basename(context.workingDirectory) || '/';
  
  return `${statusIcon} ${colors.cyan('claude-flow')}:${colors.yellow(dir)}${colors.white('> ')}`;
}

function getConnectionStatusIcon(status: string): string {
  switch (status) {
    case 'connected': return colors.green('●');
    case 'connecting': return colors.yellow('◐');
    case 'disconnected': return colors.red('○');
    default: return colors.gray('?');
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
  console.log(colors.cyan.bold('Claude-Flow Interactive REPL'));
  console.log('─'.repeat(50));
  console.log();
  
  console.log(colors.white.bold('Available Commands:'));
  console.log();
  
  const table = new Table({
    head: ['Command', 'Aliases', 'Description'],
    style: { head: ['cyan'] }
  });

  for (const cmd of commands) {
    table.push([
      colors.cyan(cmd.name),
      cmd.aliases ? colors.gray(cmd.aliases.join(', ')) : '',
      cmd.description
    ]);
  }
  
  console.log(table.toString());
  console.log();
  
  console.log(colors.gray('Tips:'));
  console.log(colors.gray('• Use TAB for command completion'));
  console.log(colors.gray('• Use "help <command>" for detailed help'));
  console.log(colors.gray('• Use UP/DOWN arrows for command history'));
  console.log(colors.gray('• Use Ctrl+C or "exit" to quit'));
}

function showCommandHelp(commands: REPLCommand[], commandName: string): void {
  const command = commands.find(c => 
    c.name === commandName || 
    (c.aliases && c.aliases.includes(commandName))
  );
  
  if (!command) {
    console.log(colors.red(`Unknown command: ${commandName}`));
    return;
  }
  
  console.log(colors.cyan.bold(`Command: ${command.name}`));
  console.log('─'.repeat(30));
  console.log(`${colors.white('Description:')} ${command.description}`);
  
  if (command.aliases) {
    console.log(`${colors.white('Aliases:')} ${command.aliases.join(', ')}`);
  }
  
  if (command.usage) {
    console.log(`${colors.white('Usage:')} ${command.usage}`);
  }
  
  if (command.examples) {
    console.log();
    console.log(colors.white.bold('Examples:'));
    for (const example of command.examples) {
      console.log(`  ${colors.gray('$')} ${colors.cyan(example)}`);
    }
  }
}

async function showSystemStatus(context: REPLContext, component?: string): Promise<void> {
  console.log(colors.cyan.bold('System Status'));
  console.log('─'.repeat(30));
  
  const statusIcon = context.connectionStatus === 'connected' ? colors.green('✓') : colors.red('✗');
  console.log(`${statusIcon} Connection: ${context.connectionStatus}`);
  console.log(`${colors.white('Working Directory:')} ${context.workingDirectory}`);
  console.log(`${colors.white('Last Activity:')} ${context.lastActivity.toLocaleTimeString()}`);
  
  if (context.currentSession) {
    console.log(`${colors.white('Current Session:')} ${context.currentSession}`);
  }
  
  console.log(`${colors.white('Commands in History:')} ${context.history.length}`);
  
  if (context.connectionStatus === 'disconnected') {
    console.log();
    console.log(colors.yellow('⚠ Not connected to orchestrator'));
    console.log(colors.gray('Use "connect" command to establish connection'));
  }
}

async function connectToOrchestrator(context: REPLContext, target?: string): Promise<void> {
  const host = target || 'localhost:3000';
  
  console.log(colors.yellow(`Connecting to ${host}...`));
  context.connectionStatus = 'connecting';
  
  // Mock connection attempt
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check if orchestrator is actually running by trying to execute status command
  try {
    const result = await executeCliCommand(['status']);
    if (result.success) {
      context.connectionStatus = 'connected';
      console.log(colors.green('✓ Connected successfully'));
    } else {
      context.connectionStatus = 'disconnected';
      console.log(colors.red('✗ Connection failed'));
      console.log(colors.gray('Make sure Claude-Flow is running with: npx claude-flow start'));
    }
  } catch (error) {
    context.connectionStatus = 'disconnected';
    console.log(colors.red('✗ Connection failed'));
    console.log(colors.gray('Make sure Claude-Flow is running with: npx claude-flow start'));
  }
}

async function executeCliCommand(args: string[]): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'src/cli/simple-cli.ts', ...args], {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    let output = '';
    let error = '';

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      error += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output || error,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
      });
    });
  });
}

async function handleAgentCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(colors.yellow('⚠ Not connected to orchestrator'));
    console.log(colors.gray('Use "connect" to establish connection first'));
    return;
  }

  if (args.length === 0) {
    console.log(colors.gray('Usage: agent <spawn|list|terminate|info> [options]'));
    return;
  }
  
  const subcommand = args[0];
  const cliArgs = ['agent', ...args];
  
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(colors.red('Error executing agent command:'), error instanceof Error ? error.message : String(error));
  }
}

async function handleTaskCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(colors.yellow('⚠ Not connected to orchestrator'));
    return;
  }

  if (args.length === 0) {
    console.log(colors.gray('Usage: task <create|list|status|cancel> [options]'));
    return;
  }
  
  const cliArgs = ['task', ...args];
  
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(colors.red('Error executing task command:'), error instanceof Error ? error.message : String(error));
  }
}

async function handleMemoryCommand(args: string[], context: REPLContext): Promise<void> {
  if (args.length === 0) {
    console.log(colors.gray('Usage: memory <query|stats|export> [options]'));
    return;
  }
  
  const cliArgs = ['memory', ...args];
  
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(colors.red('Error executing memory command:'), error instanceof Error ? error.message : String(error));
  }
}

async function handleSessionCommand(args: string[], context: REPLContext): Promise<void> {
  if (args.length === 0) {
    console.log(colors.gray('Usage: session <list|save|restore> [options]'));
    return;
  }
  
  const cliArgs = ['session', ...args];
  
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(colors.red('Error executing session command:'), error instanceof Error ? error.message : String(error));
  }
}

async function handleWorkflowCommand(args: string[], context: REPLContext): Promise<void> {
  if (context.connectionStatus !== 'connected') {
    console.log(colors.yellow('⚠ Not connected to orchestrator'));
    return;
  }

  if (args.length === 0) {
    console.log(colors.gray('Usage: workflow <list|run|status> [options]'));
    return;
  }
  
  const cliArgs = ['workflow', ...args];
  
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(colors.red('Error executing workflow command:'), error instanceof Error ? error.message : String(error));
  }
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