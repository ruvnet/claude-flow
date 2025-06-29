/**
 * Shared CLI Types
 * These types are used across multiple CLI modules to avoid circular dependencies
 */

export interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config?: Record<string, unknown> | undefined;
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
  default?: unknown;
  required?: boolean;
}

export const VERSION = "1.0.43";