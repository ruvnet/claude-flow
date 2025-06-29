/**
 * Unified Command Registry
 * Central registry for all CLI commands with unified handling
 */

import type { CommandHandler, CommandContext, Logger } from './interfaces.js';
import { CLIError } from './interfaces.js';
import { NodeRuntimeAdapter } from './node-runtime.js';
import chalk from 'chalk';

export class UnifiedCommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();
  private logger: Logger;
  private runtime: NodeRuntimeAdapter;

  constructor(logger?: Logger) {
    this.runtime = new NodeRuntimeAdapter();
    this.logger = logger || new DefaultLogger();
  }

  /**
   * Register a command handler
   */
  register(name: string, handler: CommandHandler): void {
    if (this.commands.has(name)) {
      this.logger.warn(`Command '${name}' is being overridden`);
    }
    
    this.commands.set(name, handler);
    this.logger.debug(`Registered command: ${name}`);
  }

  /**
   * Register multiple commands from an object
   */
  registerMultiple(commands: Record<string, CommandHandler>): void {
    for (const [name, handler] of Object.entries(commands)) {
      this.register(name, handler);
    }
  }

  /**
   * Execute a command with the given context
   */
  async execute(commandName: string, args: string[], flags: Record<string, any>): Promise<void> {
    const handler = this.commands.get(commandName);
    
    if (!handler) {
      throw new CLIError(
        `Unknown command: ${commandName}`,
        'UNKNOWN_COMMAND',
        1,
        true
      );
    }

    // Check prerequisites
    if (handler.prerequisites) {
      await this.checkPrerequisites(handler.prerequisites);
    }

    // Create command context
    const context: CommandContext = {
      args,
      flags,
      workingDir: this.runtime.getCurrentDir(),
      config: null, // Will be set when config system is unified
      runtime: this.runtime
    };

    try {
      await handler.action(context);
    } catch (error) {
      if (error instanceof CLIError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new CLIError(
        `Command '${commandName}' failed: ${errorMessage}`,
        'COMMAND_EXECUTION_ERROR',
        1
      );
    }
  }

  /**
   * Get help text for a command
   */
  getHelp(commandName?: string): string {
    if (commandName) {
      return this.getCommandHelp(commandName);
    }
    
    return this.getGlobalHelp();
  }

  /**
   * Get help for a specific command
   */
  private getCommandHelp(commandName: string): string {
    const handler = this.commands.get(commandName);
    
    if (!handler) {
      return `Unknown command: ${commandName}`;
    }

    let help = `${chalk.cyan(commandName)} - ${handler.description}\n\n`;

    // Add usage
    help += `${chalk.yellow('USAGE:')}\n`;
    help += `  claude-flow ${commandName}`;
    
    if (handler.options && handler.options.length > 0) {
      help += ' [options]';
    }
    
    if (handler.subcommands && Object.keys(handler.subcommands).length > 0) {
      help += ' <subcommand>';
    }
    
    help += '\n\n';

    // Add options
    if (handler.options && handler.options.length > 0) {
      help += `${chalk.yellow('OPTIONS:')}\n`;
      for (const option of handler.options) {
        const aliases = option.aliases ? option.aliases.join(', ') : '';
        const flags = aliases ? `${option.flag}, ${aliases}` : option.flag;
        help += `  ${chalk.green(flags.padEnd(20))} ${option.description}\n`;
      }
      help += '\n';
    }

    // Add subcommands
    if (handler.subcommands && Object.keys(handler.subcommands).length > 0) {
      help += `${chalk.yellow('SUBCOMMANDS:')}\n`;
      for (const [name, subHandler] of Object.entries(handler.subcommands)) {
        help += `  ${chalk.green(name.padEnd(20))} ${subHandler.description}\n`;
      }
      help += '\n';
    }

    // Add examples
    if (handler.examples && handler.examples.length > 0) {
      help += `${chalk.yellow('EXAMPLES:')}\n`;
      for (const example of handler.examples) {
        help += `  ${chalk.gray(example)}\n`;
      }
      help += '\n';
    }

    return help;
  }

  /**
   * Get global help showing all commands
   */
  private getGlobalHelp(): string {
    let help = `${chalk.cyan('Claude-Flow')} - Advanced AI Agent Orchestration System\n\n`;
    
    help += `${chalk.yellow('AVAILABLE COMMANDS:')}\n`;
    
    // Group commands by category (we can enhance this later)
    const sortedCommands = Array.from(this.commands.entries()).sort(([a], [b]) => a.localeCompare(b));
    
    for (const [name, handler] of sortedCommands) {
      help += `  ${chalk.green(name.padEnd(20))} ${handler.description}\n`;
    }
    
    help += '\n';
    help += `${chalk.yellow('USAGE:')}\n`;
    help += `  claude-flow <command> [options]\n`;
    help += `  claude-flow help <command>  # Get help for a specific command\n\n`;
    
    return help;
  }

  /**
   * List all registered commands
   */
  listCommands(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  /**
   * Check if a command exists
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get a command handler (for advanced usage)
   */
  getCommand(name: string): CommandHandler | undefined {
    return this.commands.get(name);
  }

  /**
   * Check prerequisites for a command
   */
  private async checkPrerequisites(prerequisites: string[]): Promise<void> {
    for (const prereq of prerequisites) {
      if (prereq.startsWith('file:')) {
        const filePath = prereq.substring(5);
        if (!(await this.runtime.exists(filePath))) {
          throw new CLIError(
            `Required file not found: ${filePath}`,
            'PREREQUISITE_NOT_MET',
            1
          );
        }
      } else if (prereq.startsWith('env:')) {
        const envVar = prereq.substring(4);
        if (!this.runtime.getEnvVar(envVar)) {
          throw new CLIError(
            `Required environment variable not set: ${envVar}`,
            'PREREQUISITE_NOT_MET',
            1
          );
        }
      } else if (prereq.startsWith('command:')) {
        const command = prereq.substring(8);
        try {
          await this.runtime.spawn('which', [command], { stdio: 'ignore' });
        } catch {
          throw new CLIError(
            `Required command not found: ${command}`,
            'PREREQUISITE_NOT_MET',
            1
          );
        }
      }
    }
  }
}

/**
 * Default logger implementation
 */
class DefaultLogger implements Logger {
  error(message: string, ...args: any[]): void {
    console.error(chalk.red(`❌ ${message}`), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(chalk.yellow(`⚠️  ${message}`), ...args);
  }

  info(message: string, ...args: any[]): void {
    console.log(chalk.blue(`ℹ️  ${message}`), ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (process.env['DEBUG'] || process.env['VERBOSE']) {
      console.log(chalk.gray(`🐛 ${message}`), ...args);
    }
  }

  verbose(message: string, ...args: any[]): void {
    if (process.env['VERBOSE']) {
      console.log(chalk.gray(`📝 ${message}`), ...args);
    }
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green(`✅ ${message}`), ...args);
  }
}