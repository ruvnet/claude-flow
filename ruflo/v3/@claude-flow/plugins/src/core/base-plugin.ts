/**
 * Base Plugin Implementation
 *
 * Abstract base class that provides common plugin functionality.
 * Plugins should extend this class for easier implementation.
 */

import { EventEmitter } from 'events';
import type {
  PluginMetadata,
  PluginContext,
  PluginLifecycleState,
  PluginConfig,
  ILogger,
  IEventBus,
  ServiceContainer,
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
import type { IPlugin } from './plugin-interface.js';
import { PLUGIN_EVENTS } from './plugin-interface.js';

// ============================================================================
// Base Plugin
// ============================================================================

/**
 * Abstract base class for plugins.
 *
 * Provides:
 * - Lifecycle management
 * - Logging and event emission
 * - Configuration access
 * - Service container access
 * - Default implementations for optional methods
 *
 * @example
 * ```typescript
 * class MyPlugin extends BasePlugin {
 *   constructor() {
 *     super({
 *       name: 'my-plugin',
 *       version: '1.0.0',
 *       description: 'My custom plugin'
 *     });
 *   }
 *
 *   protected async onInitialize(): Promise<void> {
 *     this.logger.info('Plugin initialized');
 *   }
 *
 *   registerMCPTools(): MCPToolDefinition[] {
 *     return [{
 *       name: 'my-tool',
 *       description: 'My custom tool',
 *       inputSchema: { type: 'object', properties: {} },
 *       handler: async (input) => ({
 *         content: [{ type: 'text', text: 'Hello!' }]
 *       })
 *     }];
 *   }
 * }
 * ```
 */
export abstract class BasePlugin extends EventEmitter implements IPlugin {
  // =========================================================================
  // Properties
  // =========================================================================

  public readonly metadata: PluginMetadata;
  private _state: PluginLifecycleState = 'uninitialized';
  private _context: PluginContext | null = null;
  private _initTime: Date | null = null;

  // =========================================================================
  // Constructor
  // =========================================================================

  constructor(metadata: PluginMetadata) {
    super();
    this.metadata = Object.freeze(metadata);
  }

  // =========================================================================
  // State Management
  // =========================================================================

  get state(): PluginLifecycleState {
    return this._state;
  }

  protected setState(state: PluginLifecycleState): void {
    const previousState = this._state;
    this._state = state;
    this.emit('stateChange', { previousState, currentState: state });
  }

  // =========================================================================
  // Context Accessors
  // =========================================================================

  protected get context(): PluginContext {
    if (!this._context) {
      throw new Error(`Plugin ${this.metadata.name} not initialized`);
    }
    return this._context;
  }

  protected get config(): PluginConfig {
    return this.context.config;
  }

  protected get logger(): ILogger {
    return this.context.logger;
  }

  protected get eventBus(): IEventBus {
    return this.context.eventBus;
  }

  protected get services(): ServiceContainer {
    return this.context.services;
  }

  protected get settings(): Record<string, unknown> {
    return this.config.settings;
  }

  // =========================================================================
  // Lifecycle Implementation
  // =========================================================================

  /**
   * Initialize the plugin.
   * Subclasses should override onInitialize() instead of this method.
   */
  async initialize(context: PluginContext): Promise<void> {
    if (this._state !== 'uninitialized') {
      throw new Error(`Plugin ${this.metadata.name} already initialized`);
    }

    this.setState('initializing');
    this._context = context;
    this._initTime = new Date();

    try {
      // Validate dependencies
      await this.validateDependencies();

      // Validate configuration
      await this.validateConfig();

      // Call subclass initialization
      await this.onInitialize();

      this.setState('initialized');
      this.eventBus.emit(PLUGIN_EVENTS.INITIALIZED, { plugin: this.metadata.name });
    } catch (error) {
      this.setState('error');
      this.eventBus.emit(PLUGIN_EVENTS.ERROR, {
        plugin: this.metadata.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Shutdown the plugin.
   * Subclasses should override onShutdown() instead of this method.
   */
  async shutdown(): Promise<void> {
    if (this._state !== 'initialized' && this._state !== 'error') {
      return; // Already shutdown or never initialized
    }

    this.setState('shutting-down');

    try {
      await this.onShutdown();
      this.setState('shutdown');
      this.eventBus.emit(PLUGIN_EVENTS.SHUTDOWN, { plugin: this.metadata.name });
    } catch (error) {
      this.setState('error');
      throw error;
    } finally {
      this._context = null;
    }
  }

  /**
   * Health check implementation.
   * Subclasses can override onHealthCheck() for custom checks.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const checks: Record<string, { healthy: boolean; message?: string; latencyMs?: number }> = {};

    // Check state
    const stateHealthy = this._state === 'initialized';
    checks['state'] = {
      healthy: stateHealthy,
      message: stateHealthy ? 'Plugin initialized' : `State: ${this._state}`,
    };

    // Run custom health checks
    const startTime = Date.now();
    try {
      const customChecks = await this.onHealthCheck();
      Object.assign(checks, customChecks);
    } catch (error) {
      checks['custom'] = {
        healthy: false,
        message: error instanceof Error ? error.message : 'Health check failed',
        latencyMs: Date.now() - startTime,
      };
    }

    const allHealthy = Object.values(checks).every(c => c.healthy);

    return {
      healthy: allHealthy,
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date(),
    };
  }

  // =========================================================================
  // Lifecycle Hooks (Override in subclasses)
  // =========================================================================

  /**
   * Called during initialization.
   * Override this in subclasses to add initialization logic.
   */
  protected async onInitialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Called during shutdown.
   * Override this in subclasses to add cleanup logic.
   */
  protected async onShutdown(): Promise<void> {
    // Default: no-op
  }

  /**
   * Called during health check.
   * Override this in subclasses to add custom health checks.
   */
  protected async onHealthCheck(): Promise<Record<string, { healthy: boolean; message?: string }>> {
    return {};
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validate plugin dependencies are available.
   */
  protected async validateDependencies(): Promise<void> {
    const deps = this.metadata.dependencies ?? [];
    for (const dep of deps) {
      // Dependencies are validated by the PluginManager
      // This hook allows plugins to do additional checks
      this.logger.debug(`Dependency validated: ${dep}`);
    }
  }

  /**
   * Validate plugin configuration.
   * Override this in subclasses to add config validation.
   */
  protected async validateConfig(): Promise<void> {
    // Default: no-op
  }

  // =========================================================================
  // Extension Points (Override in subclasses as needed)
  // =========================================================================

  registerAgentTypes?(): AgentTypeDefinition[];
  registerTaskTypes?(): TaskTypeDefinition[];
  registerMCPTools?(): MCPToolDefinition[];
  registerCLICommands?(): CLICommandDefinition[];
  registerMemoryBackends?(): MemoryBackendFactory[];
  registerHooks?(): HookDefinition[];
  registerWorkers?(): WorkerDefinition[];
  registerProviders?(): LLMProviderDefinition[];

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Get setting value with type safety.
   */
  protected getSetting<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.settings[key];
    if (value === undefined) return defaultValue;
    return value as T;
  }

  /**
   * Get uptime in milliseconds.
   */
  protected getUptime(): number {
    if (!this._initTime) return 0;
    return Date.now() - this._initTime.getTime();
  }

  /**
   * Create a child logger with context.
   */
  protected createChildLogger(context: Record<string, unknown>): ILogger {
    return this.logger.child({ plugin: this.metadata.name, ...context });
  }
}

// ============================================================================
// Simple Plugin (for quick one-off plugins)
// ============================================================================

/**
 * Configuration for creating a simple plugin.
 */
export interface SimplePluginConfig {
  metadata: PluginMetadata;
  onInitialize?: (context: PluginContext) => Promise<void>;
  onShutdown?: () => Promise<void>;
  agentTypes?: AgentTypeDefinition[];
  taskTypes?: TaskTypeDefinition[];
  mcpTools?: MCPToolDefinition[];
  cliCommands?: CLICommandDefinition[];
  hooks?: HookDefinition[];
  workers?: WorkerDefinition[];
  providers?: LLMProviderDefinition[];
}

/**
 * Create a simple plugin from configuration.
 *
 * @example
 * ```typescript
 * const myPlugin = createSimplePlugin({
 *   metadata: { name: 'my-plugin', version: '1.0.0' },
 *   mcpTools: [{
 *     name: 'hello',
 *     description: 'Say hello',
 *     inputSchema: { type: 'object', properties: {} },
 *     handler: async () => ({ content: [{ type: 'text', text: 'Hello!' }] })
 *   }]
 * });
 * ```
 */
export function createSimplePlugin(config: SimplePluginConfig): IPlugin {
  return new SimplePlugin(config) as IPlugin;
}

class SimplePlugin extends BasePlugin {
  private readonly _config: SimplePluginConfig;

  constructor(config: SimplePluginConfig) {
    super(config.metadata);
    this._config = config;
  }

  protected async onInitialize(): Promise<void> {
    if (this._config.onInitialize) {
      await this._config.onInitialize(this.context);
    }
  }

  protected async onShutdown(): Promise<void> {
    if (this._config.onShutdown) {
      await this._config.onShutdown();
    }
  }

  override registerAgentTypes(): AgentTypeDefinition[] {
    return this._config.agentTypes ?? [];
  }

  override registerTaskTypes(): TaskTypeDefinition[] {
    return this._config.taskTypes ?? [];
  }

  override registerMCPTools(): MCPToolDefinition[] {
    return this._config.mcpTools ?? [];
  }

  override registerCLICommands(): CLICommandDefinition[] {
    return this._config.cliCommands ?? [];
  }

  override registerHooks(): HookDefinition[] {
    return this._config.hooks ?? [];
  }

  override registerWorkers(): WorkerDefinition[] {
    return this._config.workers ?? [];
  }

  override registerProviders(): LLMProviderDefinition[] {
    return this._config.providers ?? [];
  }
}
