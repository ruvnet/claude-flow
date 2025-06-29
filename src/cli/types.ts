/**
 * CLI Type Definitions
 * Shared types for the CLI module to prevent circular dependencies
 */

export interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config?: Record<string, unknown> | undefined;
  logger?: any; // ILogger interface
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  subcommands?: Command[];
  action?: (ctx: CommandContext) => Promise<void> | void;
  options?: Option[];
}

export interface Option {
  name: string;
  short?: string;
  description: string;
  type?: "string" | "boolean" | "number";
  default?: any;
  required?: boolean;
}

export interface CLIConfig {
  name: string;
  version: string;
  description: string;
}