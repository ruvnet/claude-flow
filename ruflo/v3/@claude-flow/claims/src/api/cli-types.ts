/**
 * CLI Type Stubs for Claims Module
 *
 * Local type definitions to avoid cross-package imports.
 * These mirror the types from @claude-flow/cli for use in claims commands.
 */

// =============================================================================
// Command Types (mirrors @claude-flow/cli/src/types.ts)
// =============================================================================

export interface CommandContext {
  args: string[];
  flags: Record<string, string | boolean | number | undefined>;
  cwd: string;
  verbose: boolean;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: Error;
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  examples?: string[];
  options?: CommandOption[];
  subcommands?: Command[];
  execute: (context: CommandContext) => Promise<CommandResult>;
}

export interface CommandOption {
  name: string;
  alias?: string;
  description: string;
  type: 'string' | 'boolean' | 'number';
  required?: boolean;
  default?: string | boolean | number;
}

// =============================================================================
// Output Utilities (mirrors @claude-flow/cli/src/output.ts)
// =============================================================================

export const output = {
  log: (message: string): void => {
    console.log(message);
  },
  error: (message: string): void => {
    console.error(`Error: ${message}`);
  },
  warn: (message: string): void => {
    console.warn(`Warning: ${message}`);
  },
  warning: (message: string): string => {
    return `⚠ ${message}`;
  },
  success: (message: string): void => {
    console.log(`✓ ${message}`);
  },
  info: (message: string): void => {
    console.log(`ℹ ${message}`);
  },
  table: (data: Record<string, unknown>[]): void => {
    console.table(data);
  },
  json: (data: unknown): void => {
    console.log(JSON.stringify(data, null, 2));
  },
  // Formatting helpers that return strings for composition
  dim: (message: string): string => message,
  bold: (message: string): string => message,
  italic: (message: string): string => message,
  highlight: (message: string): string => message,
  code: (message: string): string => `\`${message}\``,
  link: (url: string, text?: string): string => text ? `${text} (${url})` : url,
  list: (items: string[]): string => items.map(i => `  • ${i}`).join('\n'),
  header: (message: string): string => `\n${message}\n${'─'.repeat(message.length)}`,
  // Colors
  red: (message: string): string => message,
  green: (message: string): string => message,
  yellow: (message: string): string => message,
  blue: (message: string): string => message,
  cyan: (message: string): string => message,
  magenta: (message: string): string => message,
  gray: (message: string): string => message,
  white: (message: string): string => message,
};

// =============================================================================
// Prompt Utilities (mirrors @claude-flow/cli/src/prompt.ts)
// =============================================================================

export interface SelectOption<T = string> {
  label: string;
  value: T;
  description?: string;
}

export async function select<T = string>(
  message: string,
  options: SelectOption<T>[]
): Promise<T> {
  // In a real implementation, this would use a terminal prompt library
  // For now, return the first option as a stub
  console.log(`[Prompt] ${message}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
  return options[0]?.value as T;
}

export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  console.log(`[Confirm] ${message} (default: ${defaultValue ? 'yes' : 'no'})`);
  return defaultValue;
}

export async function input(message: string, defaultValue = ''): Promise<string> {
  console.log(`[Input] ${message} (default: ${defaultValue})`);
  return defaultValue;
}

// =============================================================================
// MCP Client Utilities (mirrors @claude-flow/cli/src/mcp-client.ts)
// =============================================================================

export class MCPClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MCPClientError';
  }
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function callMCPTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<MCPToolResult> {
  // MCP tool call - delegates to active MCP server
  console.log(`[MCP] Calling tool: ${toolName}`, params);
  return { success: true, data: {} };
}
