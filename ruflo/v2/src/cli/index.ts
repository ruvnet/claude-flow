#!/usr/bin/env -S deno run --allow-all
/**
 * Claude-Flow CLI entry point
 * This redirects to simple-cli.ts for remote execution compatibility
 */

// Import and run the simple CLI which doesn't have external dependencies
import './simple-cli.ts';
// Spinner import removed - not available in current cliffy version
import { Command } from './commander-fix.js';
import chalk from 'chalk';
import { logger } from '../core/logger.js';
import { configManager } from '../core/config.js';
import { startCommand } from './commands/start.js';
import { agentCommand } from './commands/agent.js';
import { taskCommand } from './commands/task.js';
import { memoryCommand } from './commands/memory.js';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { monitorCommand } from './commands/monitor.js';
import { sessionCommand } from './commands/session.js';
import { workflowCommand } from './commands/workflow.js';
import { helpCommand } from './commands/help.js';
import { mcpCommand } from './commands/mcp.js';
import { formatError, displayBanner, displayVersion } from './formatter.js';
import { startREPL } from './repl.js';
import { CompletionGenerator } from './completion.js';
import { VERSION, BUILD_DATE } from '../core/version.js';

// Main CLI command
const cli = new Command()
  .name('claude-flow')
  .version(VERSION)
  .description('Claude-Flow: Advanced AI agent orchestration system for multi-agent coordination')
  // .meta() commented out - not available
  // .meta() commented out - not available
  .option('-c, --config <path>', 'Path to configuration file', './claude-flow.config.json')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)', 'info')
  .option('--no-color', 'Disable colored output')
  .option('--json', 'Output in JSON format where applicable')
  .option('--profile <profile>', 'Use named configuration profile')
  .action(async (options: any) => {
    // If no subcommand, show banner and start REPL
    await setupLogging(options);

    if (!options.quiet) {
      displayBanner(VERSION);
      console.log(chalk.gray('Type "help" for available commands or "exit" to quit.\n'));
    }

    await startREPL(options);
  });

// Add subcommands
// NOTE: Temporarily disabled due to Cliffy/Commander compatibility issues
// These commands are created with Cliffy but being added to Commander
// cli
//   .addCommand(startCommand)
//   .addCommand(agentCommand)
//   .addCommand(taskCommand)
//   .addCommand(memoryCommand)
//   .addCommand(configCommand)
//   .addCommand(statusCommand)
//   .addCommand(monitorCommand)
//   .addCommand(sessionCommand)
//   .addCommand(workflowCommand)
//   .addCommand(mcpCommand)
//   .addCommand(helpCommand);

// Add repl command
const replCommand = new Command('repl')
  .description('Start interactive REPL mode with command completion')
  .option('--no-banner', 'Skip welcome banner')
  .option('--history-file <path>', 'Custom history file path')
  .action(async (options: any) => {
    await setupLogging(options);
    if (options.banner !== false) {
      displayBanner(VERSION);
    }
    await startREPL(options);
  });
cli.addCommand(replCommand);

// Add version command
const versionCommand = new Command('version')
  .description('Show detailed version information')
  .option('--short', 'Show version number only')
  .action(async (options: any) => {
    if (options.short) {
      console.log(VERSION);
    } else {
      displayVersion(VERSION, BUILD_DATE);
    }
  });
cli.addCommand(versionCommand);

// Add completion command
const completionCommand = new Command('completion')
  .description('Generate shell completion scripts')
  .argument('[shell]', 'Shell type')
  .option('--install', 'Install completion script automatically')
  .action(async (shell: any, options: any) => {
    const generator = new CompletionGenerator();
    await generator.generate(shell || 'detect', options.install === true);
  });
cli.addCommand(completionCommand);

// Global error handler
async function handleError(error: unknown, options?: any): Promise<void> {
  const formatted = formatError(error);

  if (options?.json) {
    console.error(
      JSON.stringify({
        error: true,
        message: formatted,
        timestamp: new Date().toISOString(),
      }),
    );
  } else {
    console.error(chalk.red(chalk.bold('✗ Error:')), formatted);
  }

  // Show stack trace in debug mode or verbose
  if (process.env['CLAUDE_FLOW_DEBUG'] === 'true' || options?.verbose) {
    console.error(chalk.gray('\nStack trace:'));
    console.error(error);
  }

  // Suggest helpful actions
  if (!options?.quiet) {
    console.error(chalk.gray('\nTry running with --verbose for more details'));
    console.error(chalk.gray('Or use "claude-flow help" to see available commands'));
  }

  process.exit(1);
}

// Setup logging and configuration based on CLI options
async function setupLogging(options: any): Promise<void> {
  // Determine log level
  let logLevel = options.logLevel;
  if (options.verbose) logLevel = 'debug';
  if (options.quiet) logLevel = 'warn';

  // Configure logger
  await logger.configure({
    level: logLevel as any,
    format: options.json ? 'json' : 'text',
    destination: 'console',
  });

  // Load configuration
  try {
    if (options.config) {
      await configManager.load(options.config);
    } else {
      // Try to load default config file if it exists
      try {
        await configManager.load('./claude-flow.config.json');
      } catch {
        // Use default config if no file found
        configManager.loadDefault();
      }
    }

    // Apply profile if specified
    if (options.profile) {
      await configManager.applyProfile(options.profile);
    }
  } catch (error) {
    logger.warn('Failed to load configuration:', (error as Error).message);
    configManager.loadDefault();
  }
}

// Signal handlers for graceful shutdown
function setupSignalHandlers(): void {
  const gracefulShutdown = () => {
    console.log('\n' + chalk.gray('Gracefully shutting down...'));
    process.exit(0);
  };

  Deno.addSignalListener('SIGINT', gracefulShutdown);
  Deno.addSignalListener('SIGTERM', gracefulShutdown);
}

// Main entry point
if (false) {
  // import.meta.main not available
  let globalOptions: any = {};

  try {
    // Setup signal handlers
    setupSignalHandlers();

    // Pre-parse global options for error handling
    const args = Deno.args;
    globalOptions = {
      verbose: args.includes('-v') || args.includes('--verbose'),
      quiet: args.includes('-q') || args.includes('--quiet'),
      json: args.includes('--json'),
      noColor: args.includes('--no-color'),
    };

    // Configure colors based on options
    if (globalOptions.noColor) {
      // colors.setColorEnabled(false);
    }

    await cli.parse(args);
  } catch (error) {
    await handleError(error, globalOptions);
  }
}
