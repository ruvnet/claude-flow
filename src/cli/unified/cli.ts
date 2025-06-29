/**
 * Unified CLI Entry Point
 * Main entry point for the consolidated Claude-Flow CLI
 */

import { Command } from 'commander';
import { UnifiedCommandRegistry } from './command-registry.js';
import { CLIError } from './interfaces.js';
import chalk from 'chalk';

// Import unified commands
import { statusCommand } from './commands/status.js';

const VERSION = '1.0.72';

/**
 * Load all available commands into the registry
 */
async function loadCommands(registry: UnifiedCommandRegistry): Promise<void> {
  // Core commands
  registry.register('status', statusCommand);
  
  // Additional commands will be added here as they are unified
  // registry.register('agent', agentCommand);
  // registry.register('sparc', sparcCommand);
  // registry.register('memory', memoryCommand);
  // registry.register('config', configCommand);
  // etc.
}

/**
 * Create and configure the main CLI program
 */
function createProgram(registry: UnifiedCommandRegistry): Command {
  const program = new Command();
  
  program
    .name('claude-flow')
    .description('Claude-Flow - Advanced AI Agent Orchestration System')
    .version(VERSION)
    .option('-v, --verbose', 'Enable verbose output')
    .option('--config <path>', 'Use custom config file')
    .helpOption('-h, --help', 'Display help for command');

  // Add global help command
  program
    .command('help [command]')
    .description('Display help for a command')
    .action(async (commandName?: string) => {
      if (commandName) {
        if (registry.hasCommand(commandName)) {
          console.log(registry.getHelp(commandName));
        } else {
          console.error(chalk.red(`Unknown command: ${commandName}`));
          console.log(registry.getHelp());
        }
      } else {
        console.log(registry.getHelp());
      }
    });

  // Dynamically add registered commands
  for (const commandName of registry.listCommands()) {
    const handler = registry.getCommand(commandName);
    if (!handler) continue;

    const cmd = program
      .command(commandName)
      .description(handler.description);

    // Add options
    if (handler.options) {
      for (const option of handler.options) {
        const flags = option.aliases ? [option.flag, ...option.aliases].join(', ') : option.flag;
        if (option.hasValue) {
          cmd.option(flags, option.description, option.defaultValue);
        } else {
          cmd.option(flags, option.description);
        }
      }
    }

    // Add subcommands (if any)
    if (handler.subcommands) {
      for (const [subName, subHandler] of Object.entries(handler.subcommands)) {
        const subCmd = cmd
          .command(subName)
          .description(subHandler.description)
          .action(async (...args) => {
            const [options] = args.slice(-1); // Last argument is always options
            const subArgs = args.slice(0, -1); // Everything except options
            
            try {
              await registry.execute(`${commandName}:${subName}`, subArgs, options);
            } catch (error) {
              handleCommandError(error);
            }
          });

        // Add subcommand options
        if (subHandler.options) {
          for (const option of subHandler.options) {
            const flags = option.aliases ? [option.flag, ...option.aliases].join(', ') : option.flag;
            if (option.hasValue) {
              subCmd.option(flags, option.description, option.defaultValue);
            } else {
              subCmd.option(flags, option.description);
            }
          }
        }
      }
    }

    // Set main command action
    cmd.action(async (...args) => {
      const [options] = args.slice(-1); // Last argument is always options
      const commandArgs = args.slice(0, -1); // Everything except options
      
      try {
        await registry.execute(commandName, commandArgs, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
  }

  return program;
}

/**
 * Handle command execution errors
 */
function handleCommandError(error: any): void {
  if (error instanceof CLIError) {
    console.error(chalk.red(`Error: ${error.message}`));
    
    if (error.showUsage) {
      console.log('\nUse --help for usage information.');
    }
    
    process.exit(error.exitCode);
  } else {
    console.error(chalk.red(`Unexpected error: ${error.message}`));
    if (process.env['DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Show enhanced help with examples and quick start
 */
function showEnhancedHelp(): void {
  console.log(`
${chalk.cyan.bold('🧠 Claude-Flow v' + VERSION)} - Advanced AI Agent Orchestration System

${chalk.yellow('USAGE:')}
  claude-flow <command> [options]

${chalk.yellow('INSTALLATION & SETUP:')}
  npx claude-flow@latest init --sparc  # Initialize SPARC development environment
  
  The --sparc flag creates:
  • .roomodes file with 17 pre-configured SPARC modes
  • CLAUDE.md for project instructions
  • Ready-to-use TDD and code generation environment

${chalk.yellow('KEY COMMANDS:')}
  init [--sparc]                       Initialize project with Claude integration
  start [--ui]                         Start orchestration (--ui for enhanced UI)
  spawn <type> [--name <name>]         Create AI agent (alias for agent spawn)
  agent spawn <type> [--name <name>]   Create AI agent (researcher, coder, analyst)
  sparc <subcommand>                   SPARC-based development modes
  memory <subcommand>                  Manage persistent memory
  status                               Show system status

${chalk.yellow('COMMAND CATEGORIES:')}
  Core:         init, start, status, config
  Agents:       agent, task, claude
  Development:  sparc, memory, workflow
  Infrastructure: mcp, terminal, session
  Enterprise:   project, deploy, cloud, security, analytics

${chalk.yellow('QUICK START:')}
  npx -y claude-flow@latest init --sparc # First-time setup with SPARC modes
  ./claude-flow start --ui              # Interactive process management UI
  ./claude-flow sparc modes             # List available development modes
  ./claude-flow sparc "build app"       # Run SPARC orchestrator (default)
  ./claude-flow sparc run code "feature" # Run specific mode (auto-coder)
  ./claude-flow sparc tdd "tests"       # Run test-driven development
  ./claude-flow memory store key "data"  # Store information
  ./claude-flow status                  # Check system status

${chalk.yellow('GET DETAILED HELP:')}
  claude-flow help <command>           # Show command-specific help
  claude-flow <command> --help         # Alternative help syntax
  
  Examples:
    claude-flow help sparc             # SPARC development commands
    claude-flow help agent             # Agent management commands
    claude-flow help memory            # Memory operations
    claude-flow agent --help           # Agent subcommands

${chalk.yellow('COMMON OPTIONS:')}
  --verbose, -v                        Enable detailed output
  --help                               Show command help
  --config <path>                      Use custom config file

Documentation: https://github.com/ruvnet/claude-code-flow

Created by rUv - Built with ❤️ for the Claude community
`);
}

/**
 * Main CLI entry point
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    // Create command registry and load commands
    const registry = new UnifiedCommandRegistry();
    await loadCommands(registry);

    // Check for help flag before creating program
    if (argv.includes('--help') || argv.includes('-h')) {
      showEnhancedHelp();
      return;
    }

    // Create and configure program
    const program = createProgram(registry);

    // Parse arguments
    await program.parseAsync(argv);
    
  } catch (error) {
    handleCommandError(error);
  }
}

/**
 * Direct execution when run as a script
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error.message);
    if (process.env['DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

// Export main function for programmatic use
export { UnifiedCommandRegistry, CLIError };