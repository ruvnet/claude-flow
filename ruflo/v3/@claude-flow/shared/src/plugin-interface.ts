/**
 * V3 Plugin Interface
 * Domain-Driven Design - Plugin-Based Architecture (ADR-004)
 *
 * Microkernel pattern for extensible Claude-Flow V3
 * Enables modular extension points for agents, tasks, MCP tools, CLI commands, and memory backends
 */

import type { IEventBus } from './core/interfaces/event.interface.js';
import type { IAgentConfig } from './core/interfaces/agent.interface.js';
import type { MCPTool } from './types/mcp.types.js';

/**
 * Logger interface for plugin context
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Service container for dependency injection
 */
export interface ServiceContainer {
  /**
   * Register a service in the container
   */
  register<T>(name: string, service: T): void;

  /**
   * Get a service from the container
   */
  get<T>(name: string): T | undefined;

  /**
   * Check if a service is registered
   */
  has(name: string): boolean;

  /**
   * Get all registered service names
   */
  getServiceNames(): string[];
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /**
   * Plugin-specific configuration
   */
  [key: string]: unknown;

  /**
   * Enable/disable features
   */
  features?: Record<string, boolean>;

  /**
   * Resource limits
   */
  resources?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };
}

/**
 * Plugin context provided during initialization
 * Contains services and resources available to plugins
 */
export interface PluginContext {
  /**
   * Plugin-specific configuration
   */
  config: PluginConfig;

  /**
   * Event bus for pub/sub communication
   */
  eventBus: IEventBus;

  /**
   * Logger instance
   */
  logger: ILogger;

  /**
   * Service container for dependency injection
   */
  services: ServiceContainer;
}

/**
 * Agent type definition for plugin registration
 */
export interface AgentTypeDefinition {
  /**
   * Unique type identifier
   */
  type: string;

  /**
   * Human-readable name
   */
  name: string;

  /**
   * Description of agent capabilities
   */
  description: string;

  /**
   * Default configuration for this agent type
   */
  defaultConfig: Partial<IAgentConfig>;

  /**
   * Required capabilities for this agent type
   */
  requiredCapabilities?: string[];

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Task type definition for plugin registration
 */
export interface TaskTypeDefinition {
  /**
   * Unique type identifier
   */
  type: string;

  /**
   * Human-readable name
   */
  name: string;

  /**
   * Description of task purpose
   */
  description: string;

  /**
   * Default priority (0-100)
   */
  defaultPriority: number;

  /**
   * Default timeout in milliseconds
   */
  defaultTimeout: number;

  /**
   * Required agent capabilities to execute this task
   */
  requiredCapabilities?: string[];

  /**
   * Task input schema (JSON Schema)
   */
  inputSchema?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * MCP tool definition for plugin registration
 */
export interface MCPToolDefinition extends MCPTool {
  /**
   * Plugin that registered this tool
   */
  pluginName?: string;

  /**
   * Tool version
   */
  version?: string;

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * CLI command definition for plugin registration
 */
export interface CLICommandDefinition {
  /**
   * Command name
   */
  name: string;

  /**
   * Command description
   */
  description: string;

  /**
   * Command aliases
   */
  aliases?: string[];

  /**
   * Command options
   */
  options?: CLICommandOption[];

  /**
   * Command arguments
   */
  arguments?: CLICommandArgument[];

  /**
   * Command handler function
   */
  handler: (args: CLICommandArgs) => Promise<void> | void;

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * CLI command option
 */
export interface CLICommandOption {
  /**
   * Option name (without dashes)
   */
  name: string;

  /**
   * Short flag (single character)
   */
  short?: string;

  /**
   * Option description
   */
  description: string;

  /**
   * Option type
   */
  type: 'string' | 'number' | 'boolean';

  /**
   * Default value
   */
  default?: string | number | boolean;

  /**
   * Is this option required?
   */
  required?: boolean;
}

/**
 * CLI command argument
 */
export interface CLICommandArgument {
  /**
   * Argument name
   */
  name: string;

  /**
   * Argument description
   */
  description: string;

  /**
   * Is this argument required?
   */
  required?: boolean;

  /**
   * Default value
   */
  default?: string;

  /**
   * Allowed values (for validation)
   */
  choices?: string[];
}

/**
 * CLI command parsed arguments
 */
export interface CLICommandArgs {
  /**
   * Positional arguments
   */
  _: string[];

  /**
   * Named options
   */
  [key: string]: unknown;
}

/**
 * Memory backend factory for plugin registration
 */
export interface MemoryBackendFactory {
  /**
   * Backend name
   */
  name: string;

  /**
   * Backend description
   */
  description: string;

  /**
   * Create a new backend instance
   */
  create(config: MemoryBackendConfig): Promise<IMemoryBackend>;

  /**
   * Backend capabilities
   */
  capabilities: {
    supportsVectorSearch: boolean;
    supportsFullText: boolean;
    supportsTransactions: boolean;
    supportsPersistence: boolean;
  };

  /**
   * Optional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Memory backend configuration
 */
export interface MemoryBackendConfig {
  /**
   * Storage path or connection string
   */
  path?: string;

  /**
   * Backend-specific options
   */
  options?: Record<string, unknown>;

  /**
   * Resource limits
   */
  limits?: {
    maxMemoryMb?: number;
    maxStorageMb?: number;
  };
}

/**
 * Memory backend interface
 */
export interface IMemoryBackend {
  /**
   * Initialize the backend
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the backend
   */
  shutdown(): Promise<void>;

  /**
   * Store a memory entry
   */
  store(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Retrieve a memory entry
   */
  retrieve(key: string): Promise<unknown | null>;

  /**
   * Delete a memory entry
   */
  delete(key: string): Promise<boolean>;

  /**
   * Search memory entries
   */
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;

  /**
   * Clear all memory entries
   */
  clear(): Promise<void>;

  /**
   * Get backend statistics
   */
  getStats(): Promise<MemoryBackendStats>;
}

/**
 * Memory search options
 */
export interface MemorySearchOptions {
  /**
   * Maximum number of results
   */
  limit?: number;

  /**
   * Result offset for pagination
   */
  offset?: number;

  /**
   * Minimum similarity score (0-1)
   */
  minScore?: number;

  /**
   * Filter by metadata
   */
  filter?: Record<string, unknown>;
}

/**
 * Memory search result
 */
export interface MemorySearchResult {
  /**
   * Memory key
   */
  key: string;

  /**
   * Memory value
   */
  value: unknown;

  /**
   * Similarity score (0-1)
   */
  score: number;

  /**
   * Associated metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Memory backend statistics
 */
export interface MemoryBackendStats {
  /**
   * Total number of entries
   */
  entryCount: number;

  /**
   * Total storage size in bytes
   */
  sizeBytes: number;

  /**
   * Memory usage in bytes
   */
  memoryUsageBytes: number;

  /**
   * Backend-specific metrics
   */
  metrics?: Record<string, number>;
}

/**
 * Core ClaudeFlowPlugin interface
 * All plugins must implement this interface
 */
export interface ClaudeFlowPlugin {
  /**
   * Unique plugin name
   */
  readonly name: string;

  /**
   * Plugin version (semver)
   */
  readonly version: string;

  /**
   * Optional plugin dependencies
   * List of plugin names that must be loaded before this plugin
   */
  readonly dependencies?: string[];

  /**
   * Plugin description
   */
  readonly description?: string;

  /**
   * Plugin author
   */
  readonly author?: string;

  /**
   * Initialize the plugin
   * Called after all dependencies are loaded
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Shutdown the plugin
   * Called during system shutdown
   */
  shutdown(): Promise<void>;

  /**
   * Register custom agent types (optional)
   * @returns Array of agent type definitions
   */
  registerAgentTypes?(): AgentTypeDefinition[];

  /**
   * Register custom task types (optional)
   * @returns Array of task type definitions
   */
  registerTaskTypes?(): TaskTypeDefinition[];

  /**
   * Register MCP tools (optional)
   * @returns Array of MCP tool definitions
   */
  registerMCPTools?(): MCPToolDefinition[];

  /**
   * Register CLI commands (optional)
   * @returns Array of CLI command definitions
   */
  registerCLICommands?(): CLICommandDefinition[];

  /**
   * Register memory backends (optional)
   * @returns Array of memory backend factories
   */
  registerMemoryBackends?(): MemoryBackendFactory[];

  /**
   * Optional health check
   * @returns true if plugin is healthy, false otherwise
   */
  healthCheck?(): Promise<boolean>;

  /**
   * Optional plugin metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Plugin lifecycle state
 */
export type PluginLifecycleState =
  | 'uninitialized'
  | 'initializing'
  | 'initialized'
  | 'shutting-down'
  | 'shutdown'
  | 'error';

/**
 * Plugin info for registry tracking
 */
export interface PluginInfo {
  /**
   * Plugin instance
   */
  plugin: ClaudeFlowPlugin;

  /**
   * Current lifecycle state
   */
  state: PluginLifecycleState;

  /**
   * Initialization timestamp
   */
  initializedAt?: Date;

  /**
   * Shutdown timestamp
   */
  shutdownAt?: Date;

  /**
   * Plugin context
   */
  context?: PluginContext;

  /**
   * Error if state is 'error'
   */
  error?: Error;

  /**
   * Plugin metrics
   */
  metrics?: {
    agentTypesRegistered: number;
    taskTypesRegistered: number;
    mcpToolsRegistered: number;
    cliCommandsRegistered: number;
    memoryBackendsRegistered: number;
  };
}

/**
 * Plugin error types
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public readonly pluginName: string,
    public readonly code: PluginErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

export type PluginErrorCode =
  | 'INITIALIZATION_FAILED'
  | 'SHUTDOWN_FAILED'
  | 'DEPENDENCY_NOT_FOUND'
  | 'CIRCULAR_DEPENDENCY'
  | 'INVALID_PLUGIN'
  | 'DUPLICATE_PLUGIN'
  | 'HEALTH_CHECK_FAILED';
