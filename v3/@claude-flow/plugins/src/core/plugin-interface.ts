/**
 * Core Plugin Interface
 *
 * Defines the contract that all plugins must implement.
 */

import type {
  PluginMetadata,
  PluginContext,
  PluginLifecycleState,
  AgentTypeDefinition,
  TaskTypeDefinition,
  MCPToolDefinition,
  CLICommandDefinition,
  MemoryBackendFactory,
  HookDefinition,
  WorkerDefinition,
  LLMProviderDefinition,
  HealthCheckResult,
} from '../types/index.js';

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * Core plugin interface that all plugins must implement.
 *
 * Plugins provide extensibility across multiple domains:
 * - Agent types and task definitions
 * - MCP tools for Claude interaction
 * - CLI commands for terminal interface
 * - Memory backends for storage
 * - Hooks for lifecycle events
 * - Workers for parallel execution
 * - LLM providers for model access
 */
export interface IPlugin {
  /** Plugin metadata (name, version, etc.) */
  readonly metadata: PluginMetadata;

  /** Current lifecycle state */
  readonly state: PluginLifecycleState;

  // =========================================================================
  // Lifecycle Methods
  // =========================================================================

  /**
   * Initialize the plugin with context.
   * Called once when the plugin is loaded.
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Shutdown the plugin gracefully.
   * Called when the plugin is being unloaded.
   */
  shutdown(): Promise<void>;

  /**
   * Check plugin health.
   * Called periodically for monitoring.
   */
  healthCheck?(): Promise<HealthCheckResult>;

  // =========================================================================
  // Extension Point Registration
  // =========================================================================

  /**
   * Register agent type definitions.
   * Called during initialization to collect agent types.
   */
  registerAgentTypes?(): AgentTypeDefinition[];

  /**
   * Register task type definitions.
   * Called during initialization to collect task types.
   */
  registerTaskTypes?(): TaskTypeDefinition[];

  /**
   * Register MCP tool definitions.
   * Called during initialization to expose tools to Claude.
   */
  registerMCPTools?(): MCPToolDefinition[];

  /**
   * Register CLI command definitions.
   * Called during initialization to extend the CLI.
   */
  registerCLICommands?(): CLICommandDefinition[];

  /**
   * Register memory backend factories.
   * Called during initialization to add storage options.
   */
  registerMemoryBackends?(): MemoryBackendFactory[];

  /**
   * Register hook definitions.
   * Called during initialization to add lifecycle hooks.
   */
  registerHooks?(): HookDefinition[];

  /**
   * Register worker definitions.
   * Called during initialization to add worker types.
   */
  registerWorkers?(): WorkerDefinition[];

  /**
   * Register LLM provider definitions.
   * Called during initialization to add model providers.
   */
  registerProviders?(): LLMProviderDefinition[];

  // =========================================================================
  // Hot Reload State
  // =========================================================================

  /**
   * Export plugin-owned state so it can be carried over a hot reload
   * (EnhancedPluginRegistry.reload with preserveState).
   *
   * This is deliberately not called getState/setState: BasePlugin already
   * uses setState as its protected lifecycle-state setter.
   */
  exportState?(): unknown | Promise<unknown>;

  /**
   * Import state previously produced by exportState() (after optional
   * migration). Called on the replacement plugin after it is initialized.
   */
  importState?(state: unknown): void | Promise<void>;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Factory function type for creating plugin instances.
 */
export type PluginFactory = () => IPlugin | Promise<IPlugin>;

/**
 * Plugin module export interface.
 * Plugins should export a default factory or plugin instance.
 */
export interface PluginModule {
  default: IPlugin | PluginFactory;
  metadata?: PluginMetadata;
}

// ============================================================================
// Plugin Events
// ============================================================================

export const PLUGIN_EVENTS = {
  LOADING: 'plugin:loading',
  LOADED: 'plugin:loaded',
  INITIALIZING: 'plugin:initializing',
  INITIALIZED: 'plugin:initialized',
  SHUTTING_DOWN: 'plugin:shutting-down',
  SHUTDOWN: 'plugin:shutdown',
  ERROR: 'plugin:error',
  HEALTH_CHECK: 'plugin:health-check',
} as const;

export type PluginEvent = typeof PLUGIN_EVENTS[keyof typeof PLUGIN_EVENTS];

// ============================================================================
// Plugin Validation
// ============================================================================

/**
 * Validate plugin metadata.
 */
export function validatePluginMetadata(metadata: unknown): metadata is PluginMetadata {
  if (!metadata || typeof metadata !== 'object') return false;

  const m = metadata as Record<string, unknown>;

  if (typeof m.name !== 'string' || m.name.length === 0) return false;
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) return false;

  if (m.description !== undefined && typeof m.description !== 'string') return false;
  if (m.author !== undefined && typeof m.author !== 'string') return false;

  if (m.dependencies !== undefined) {
    if (!Array.isArray(m.dependencies)) return false;
    if (!m.dependencies.every(isValidDependency)) return false;
  }

  return true;
}

/**
 * A dependency is either a non-empty name ("name" or "name@range") or a
 * { name, version, optional?, peerDependency? } object, matching what the
 * registries' dependency parsing accepts.
 */
function isValidDependency(dep: unknown): boolean {
  if (typeof dep === 'string') return dep.length > 0;
  if (!dep || typeof dep !== 'object' || Array.isArray(dep)) return false;

  const d = dep as Record<string, unknown>;
  if (typeof d.name !== 'string' || d.name.length === 0) return false;
  if (typeof d.version !== 'string' || d.version.length === 0) return false;
  if (d.optional !== undefined && typeof d.optional !== 'boolean') return false;
  if (d.peerDependency !== undefined && typeof d.peerDependency !== 'boolean') return false;
  return true;
}

/**
 * Validate plugin interface.
 */
export function validatePlugin(plugin: unknown): plugin is IPlugin {
  if (!plugin || typeof plugin !== 'object') return false;

  const p = plugin as Record<string, unknown>;

  // Check required properties
  if (!validatePluginMetadata(p.metadata)) return false;
  if (typeof p.state !== 'string') return false;
  if (typeof p.initialize !== 'function') return false;
  if (typeof p.shutdown !== 'function') return false;

  // Check optional methods are functions if present
  const optionalMethods = [
    'healthCheck',
    'registerAgentTypes',
    'registerTaskTypes',
    'registerMCPTools',
    'registerCLICommands',
    'registerMemoryBackends',
    'registerHooks',
    'registerWorkers',
    'registerProviders',
    'exportState',
    'importState',
  ];

  for (const method of optionalMethods) {
    if (p[method] !== undefined && typeof p[method] !== 'function') {
      return false;
    }
  }

  return true;
}
