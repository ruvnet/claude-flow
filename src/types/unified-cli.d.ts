/**
 * Unified CLI Type Definitions
 * Central type definitions for CLI command interfaces and configurations
 */

import { Command as CommanderCommand } from 'commander';

// ===== LOGGING TYPES =====

/**
 * Unified logging configuration with sensible defaults
 * All fields are optional to support partial initialization
 */
export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  format?: 'json' | 'text';
  destination?: 'console' | 'file' | 'both';
  filePath?: string;
  maxFileSize?: number;
  maxFiles?: number;
}

/**
 * Default logging configuration factory
 */
export function createDefaultLoggingConfig(overrides?: Partial<LoggingConfig>): Required<LoggingConfig> {
  return {
    level: 'info',
    format: 'json',
    destination: 'console',
    filePath: './logs/claude-flow.log',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    ...overrides
  };
}

// ===== CLI COMMAND TYPES =====

/**
 * Wrapper interface for commander.js commands
 * Provides type-safe command definition
 */
export interface CLICommand {
  name: string;
  description: string;
  version?: string;
  options: CommandOption[];
  subcommands?: CLICommand[];
  action: CommandAction;
  setup?: (command: CommanderCommand) => void;
}

/**
 * Command option definition
 */
export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: any;
  required?: boolean;
  parser?: (value: string, previous?: any) => any;
  choices?: string[];
}

/**
 * Command action handler type
 */
export type CommandAction = (options: Record<string, any>, command: CommanderCommand) => void | Promise<void>;

/**
 * Command builder utility
 */
export class CommandBuilder {
  private command: CommanderCommand;

  constructor(name: string) {
    this.command = new CommanderCommand(name);
  }

  description(desc: string): this {
    this.command.description(desc);
    return this;
  }

  version(ver: string): this {
    this.command.version(ver);
    return this;
  }

  option(option: CommandOption): this {
    const { flags, description, defaultValue, parser } = option;
    if (parser) {
      this.command.option(flags, description, parser, defaultValue);
    } else {
      this.command.option(flags, description, defaultValue);
    }
    return this;
  }

  action(handler: CommandAction): this {
    this.command.action(handler);
    return this;
  }

  subcommand(subCmd: CLICommand): this {
    const sub = this.buildCommand(subCmd);
    this.command.addCommand(sub);
    return this;
  }

  build(): CommanderCommand {
    return this.command;
  }

  private buildCommand(cmd: CLICommand): CommanderCommand {
    const builder = new CommandBuilder(cmd.name)
      .description(cmd.description);

    if (cmd.version) {
      builder.version(cmd.version);
    }

    cmd.options.forEach(opt => builder.option(opt));
    
    if (cmd.subcommands) {
      cmd.subcommands.forEach(sub => builder.subcommand(sub));
    }

    if (cmd.setup) {
      cmd.setup(builder.command);
    }

    return builder.action(cmd.action).build();
  }
}

// ===== EVENT BUS TYPES =====

/**
 * Event bus singleton interface
 * Ensures proper usage of getInstance() pattern
 */
export interface IEventBusSingleton {
  getInstance(debug?: boolean): IEventBus;
}

/**
 * Event bus instance interface
 */
export interface IEventBus {
  emit(event: string, data?: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
  once(event: string, handler: (data: unknown) => void): void;
}

/**
 * Type-safe event emitter
 */
export interface TypedEventEmitter<T extends Record<string, any>> {
  emit<K extends keyof T>(event: K, data: T[K]): void;
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): void;
  off<K extends keyof T>(event: K, handler: (data: T[K]) => void): void;
  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): void;
}

// ===== CONFIGURATION TYPES =====

/**
 * CLI configuration with all optional fields for flexible initialization
 */
export interface CLIConfig {
  // Core settings
  name?: string;
  version?: string;
  description?: string;

  // Feature flags
  debug?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;

  // Paths
  configPath?: string;
  dataDir?: string;
  logsDir?: string;

  // Timeouts
  commandTimeout?: number;
  connectionTimeout?: number;

  // Output
  outputFormat?: 'json' | 'yaml' | 'table' | 'plain';
  
  // Logging
  logging?: LoggingConfig;
}

/**
 * CLI context passed to commands
 */
export interface CLIContext {
  config: CLIConfig;
  logger: ILogger;
  eventBus: IEventBus;
  cwd: string;
  env: Record<string, string>;
}

// ===== UTILITY TYPES =====

/**
 * Logger interface compatible with partial configs
 */
export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, error?: unknown): void;
  configure(config: LoggingConfig): Promise<void>;
}

/**
 * Result type for command execution
 */
export type CommandResult<T = any> = 
  | { success: true; data: T }
  | { success: false; error: Error };

/**
 * Async command handler type
 */
export type AsyncCommandHandler = (
  args: string[],
  options: Record<string, any>,
  context: CLIContext
) => Promise<CommandResult>;

// ===== FACTORY FUNCTIONS =====

/**
 * Create a CLI command with proper error handling
 */
export function createCommand(config: CLICommand): CommanderCommand {
  return new CommandBuilder(config.name).build();
}

/**
 * Create a safe event bus instance
 */
export function createEventBus(EventBusClass: any, debug = false): IEventBus {
  if (typeof EventBusClass.getInstance === 'function') {
    return EventBusClass.getInstance(debug);
  }
  throw new Error('EventBus must implement getInstance() method');
}

/**
 * Create a logger with default config
 */
export function createLogger(LoggerClass: any, config?: LoggingConfig): ILogger {
  const fullConfig = createDefaultLoggingConfig(config);
  return new LoggerClass(fullConfig);
}

// ===== TYPE GUARDS =====

export function isCommandResult<T>(obj: any): obj is CommandResult<T> {
  return obj && typeof obj.success === 'boolean' && 
    (obj.success ? 'data' in obj : 'error' in obj);
}

export function isLoggingConfig(obj: any): obj is LoggingConfig {
  if (!obj || typeof obj !== 'object') return false;
  
  const validLevels = ['debug', 'info', 'warn', 'error'];
  const validFormats = ['json', 'text'];
  const validDestinations = ['console', 'file', 'both'];
  
  if (obj.level && !validLevels.includes(obj.level)) return false;
  if (obj.format && !validFormats.includes(obj.format)) return false;
  if (obj.destination && !validDestinations.includes(obj.destination)) return false;
  
  return true;
}

// ===== CONSTANTS =====

export const CLI_DEFAULTS = {
  COMMAND_TIMEOUT: 30000, // 30 seconds
  CONNECTION_TIMEOUT: 10000, // 10 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  LOG_LEVEL: 'info' as const,
  OUTPUT_FORMAT: 'table' as const,
} as const;

// ===== MIGRATION HELPERS =====

/**
 * Helper to migrate from old EventBus usage to new pattern
 */
export function migrateEventBusUsage(code: string): string {
  return code.replace(/new EventBus\(\)/g, 'EventBus.getInstance()');
}

/**
 * Helper to migrate from old Logger usage to new pattern
 */
export function migrateLoggerUsage(code: string): string {
  return code.replace(
    /new Logger\(\s*{\s*level:\s*['"](\w+)['"]\s*}\s*\)/g,
    'createLogger(Logger, { level: \'$1\' })'
  );
}