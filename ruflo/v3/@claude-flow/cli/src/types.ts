/**
 * V3 CLI Type Definitions
 * Modernized type system for the Claude Flow V3 CLI
 */

// ============================================
// Core Command Types
// ============================================

export interface CommandContext {
  args: string[];
  flags: ParsedFlags;
  config?: V3Config;
  cwd: string;
  interactive: boolean;
}

export interface ParsedFlags {
  [key: string]: string | boolean | number | string[];
  _: string[];
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  subcommands?: Command[];
  options?: CommandOption[];
  examples?: CommandExample[];
  action?: CommandAction;
  hidden?: boolean;
}

export interface CommandOption {
  name: string;
  short?: string;
  description: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  default?: unknown;
  required?: boolean;
  choices?: string[];
  validate?: (value: unknown) => boolean | string;
}

export interface CommandExample {
  command: string;
  description: string;
}

export type CommandAction = (ctx: CommandContext) => Promise<CommandResult | void>;

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  exitCode?: number;
}

// ============================================
// Configuration Types
// ============================================

export interface V3Config {
  version: string;
  projectRoot: string;

  // Agent configuration
  agents: AgentConfig;

  // Swarm configuration
  swarm: SwarmConfig;

  // Memory configuration
  memory: MemoryConfig;

  // MCP configuration
  mcp: MCPConfig;

  // CLI preferences
  cli: CLIPreferences;

  // Hooks configuration
  hooks: HooksConfig;
}

export interface AgentConfig {
  defaultType: string;
  autoSpawn: boolean;
  maxConcurrent: number;
  timeout: number;
  providers: ProviderConfig[];
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  priority: number;
  enabled: boolean;
}

export interface SwarmConfig {
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh';
  maxAgents: number;
  autoScale: boolean;
  coordinationStrategy: 'consensus' | 'leader' | 'distributed';
  healthCheckInterval: number;
}

export interface MemoryConfig {
  backend: 'agentdb' | 'sqlite' | 'memory' | 'hybrid';
  persistPath: string;
  cacheSize: number;
  enableHNSW: boolean;
  vectorDimension: number;
}

export interface MCPConfig {
  serverHost: string;
  serverPort: number;
  autoStart: boolean;
  transportType: 'stdio' | 'http' | 'websocket';
  tools: string[];
}

export interface CLIPreferences {
  colorOutput: boolean;
  interactive: boolean;
  verbosity: 'quiet' | 'normal' | 'verbose' | 'debug';
  outputFormat: 'text' | 'json' | 'table';
  progressStyle: 'bar' | 'spinner' | 'dots' | 'none';
}

export interface HooksConfig {
  enabled: boolean;
  autoExecute: boolean;
  hooks: HookDefinition[];
}

export interface HookDefinition {
  name: string;
  event: string;
  handler: string;
  priority: number;
  enabled: boolean;
}

// ============================================
// Output Types
// ============================================

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: (value: unknown) => string;
}

export interface TableOptions {
  columns: TableColumn[];
  data: Record<string, unknown>[];
  border?: boolean;
  header?: boolean;
  padding?: number;
  maxWidth?: number;
}

export interface ProgressOptions {
  total: number;
  current?: number;
  width?: number;
  format?: string;
  showPercentage?: boolean;
  showETA?: boolean;
  showSpeed?: boolean;
}

export interface SpinnerOptions {
  text: string;
  spinner?: 'dots' | 'line' | 'arc' | 'circle' | 'arrows';
  color?: string;
}

// ============================================
// Prompt Types
// ============================================

export interface SelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** For multiselect: whether this option is selected by default */
  selected?: boolean;
}

export interface SelectPromptOptions<T = string> {
  message: string;
  options: SelectOption<T>[];
  default?: T;
  searchable?: boolean;
  pageSize?: number;
}

export interface ConfirmPromptOptions {
  message: string;
  default?: boolean;
  active?: string;
  inactive?: string;
}

export interface InputPromptOptions {
  message: string;
  default?: string;
  placeholder?: string;
  validate?: (value: string) => boolean | string;
  mask?: boolean;
}

export interface MultiSelectPromptOptions<T = string> {
  message: string;
  options: SelectOption<T>[];
  default?: T[];
  required?: boolean;
  min?: number;
  max?: number;
}

// ============================================
// Event Types
// ============================================

export type CLIEventType =
  | 'command:start'
  | 'command:end'
  | 'command:error'
  | 'prompt:start'
  | 'prompt:complete'
  | 'output:write'
  | 'progress:update'
  | 'spinner:start'
  | 'spinner:stop';

export interface CLIEvent {
  type: CLIEventType;
  timestamp: number;
  data?: unknown;
}

// ============================================
// Error Types
// ============================================

export class CLIError extends Error {
  constructor(
    message: string,
    public code: string,
    public exitCode: number = 1,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 1, details);
    this.name = 'ValidationError';
  }
}

export class ConfigError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', 1, details);
    this.name = 'ConfigError';
  }
}

export class CommandNotFoundError extends CLIError {
  constructor(commandName: string) {
    super(`Unknown command: ${commandName}`, 'COMMAND_NOT_FOUND', 127);
    this.name = 'CommandNotFoundError';
  }
}
