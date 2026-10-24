/**
 * Plugin Registry
 *
 * Manages plugin lifecycle, dependency resolution, and extension point collection.
 */

import { EventEmitter } from 'events';
import type {
  PluginContext,
  PluginConfig,
  PluginMetadata,
  IEventBus,
  ILogger,
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
import type { IPlugin, PluginFactory } from '../core/plugin-interface.js';
import { validatePlugin, PLUGIN_EVENTS } from '../core/plugin-interface.js';

// ============================================================================
// Registry Types
// ============================================================================

export interface PluginRegistryConfig {
  coreVersion: string;
  dataDir: string;
  logger?: ILogger;
  eventBus?: IEventBus;
  defaultConfig?: Partial<PluginConfig>;
  maxPlugins?: number;
  loadTimeout?: number;
}

export interface PluginEntry {
  plugin: IPlugin;
  config: PluginConfig;
  loadTime: Date;
  initTime?: Date;
  error?: string;
}

export interface RegistryStats {
  total: number;
  initialized: number;
  failed: number;
  agentTypes: number;
  taskTypes: number;
  mcpTools: number;
  cliCommands: number;
  hooks: number;
  workers: number;
  providers: number;
}

// ============================================================================
// Default Implementations
// ============================================================================

class DefaultEventBus implements IEventBus {
  private emitter = new EventEmitter();

  emit(event: string, data?: unknown): void {
    this.emitter.emit(event, data);
  }

  on(event: string, handler: (data?: unknown) => void | Promise<void>): () => void {
    this.emitter.on(event, handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (data?: unknown) => void | Promise<void>): void {
    this.emitter.off(event, handler);
  }

  once(event: string, handler: (data?: unknown) => void | Promise<void>): () => void {
    this.emitter.once(event, handler);
    return () => this.off(event, handler);
  }
}

class DefaultLogger implements ILogger {
  private context: Record<string, unknown> = {};

  constructor(context?: Record<string, unknown>) {
    if (context) this.context = context;
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[DEBUG]`, message, ...args, this.context);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[INFO]`, message, ...args, this.context);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN]`, message, ...args, this.context);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR]`, message, ...args, this.context);
  }

  child(context: Record<string, unknown>): ILogger {
    return new DefaultLogger({ ...this.context, ...context });
  }
}

class DefaultServiceContainer implements ServiceContainer {
  private services = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  has(key: string): boolean {
    return this.services.has(key);
  }

  delete(key: string): boolean {
    return this.services.delete(key);
  }
}

// ============================================================================
// Plugin Registry
// ============================================================================

/**
 * Central registry for plugin management.
 *
 * Features:
 * - Plugin loading and unloading
 * - Dependency resolution
 * - Extension point collection
 * - Health monitoring
 * - Lifecycle management
 */
export class PluginRegistry extends EventEmitter {
  // =========================================================================
  // Properties
  // =========================================================================

  private readonly plugins = new Map<string, PluginEntry>();
  private readonly config: PluginRegistryConfig;
  private readonly logger: ILogger;
  private readonly eventBus: IEventBus;
  private readonly services: ServiceContainer;
  private initialized = false;

  // Extension point caches
  private agentTypesCache: AgentTypeDefinition[] = [];
  private taskTypesCache: TaskTypeDefinition[] = [];
  private mcpToolsCache: MCPToolDefinition[] = [];
  private cliCommandsCache: CLICommandDefinition[] = [];
  private memoryBackendsCache: MemoryBackendFactory[] = [];
  private hooksCache: HookDefinition[] = [];
  private workersCache: WorkerDefinition[] = [];
  private providersCache: LLMProviderDefinition[] = [];

  // =========================================================================
  // Constructor
  // =========================================================================

  constructor(config: PluginRegistryConfig) {
    super();
    this.config = config;
    this.logger = config.logger ?? new DefaultLogger({ component: 'PluginRegistry' });
    this.eventBus = config.eventBus ?? new DefaultEventBus();
    this.services = new DefaultServiceContainer();

    // Register self in services
    this.services.set('pluginRegistry', this);
  }

  // =========================================================================
  // Plugin Loading
  // =========================================================================

  /**
   * Register a plugin.
   */
  async register(
    plugin: IPlugin | PluginFactory,
    config?: Partial<PluginConfig>
  ): Promise<void> {
    // Resolve factory if needed
    const resolvedPlugin = typeof plugin === 'function' ? await plugin() : plugin;

    // Validate plugin
    if (!validatePlugin(resolvedPlugin)) {
      throw new Error('Invalid plugin: does not implement IPlugin interface');
    }

    const name = resolvedPlugin.metadata.name;

    // Check for duplicates
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    // Check max plugins
    if (this.config.maxPlugins && this.plugins.size >= this.config.maxPlugins) {
      throw new Error(`Maximum plugin limit (${this.config.maxPlugins}) reached`);
    }

    // Create config
    const pluginConfig: PluginConfig = {
      enabled: true,
      priority: 50,
      settings: {},
      ...this.config.defaultConfig,
      ...config,
    };

    // Store entry
    const entry: PluginEntry = {
      plugin: resolvedPlugin,
      config: pluginConfig,
      loadTime: new Date(),
    };

    this.plugins.set(name, entry);
    this.eventBus.emit(PLUGIN_EVENTS.LOADED, { plugin: name });
    this.logger.info(`Plugin registered: ${name} v${resolvedPlugin.metadata.version}`);
  }

  /**
   * Unregister a plugin.
   */
  async unregister(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin ${name} not found`);
    }

    // Shutdown if initialized
    if (entry.plugin.state === 'initialized') {
      await entry.plugin.shutdown();
    }

    this.plugins.delete(name);
    this.invalidateCaches();
    this.logger.info(`Plugin unregistered: ${name}`);
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Initialize all registered plugins.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Registry already initialized');
    }

    // Resolve dependencies and get load order
    const loadOrder = this.resolveDependencies();

    // Initialize plugins in order
    for (const name of loadOrder) {
      const entry = this.plugins.get(name)!;
      if (!entry.config.enabled) {
        this.logger.info(`Plugin ${name} is disabled, skipping initialization`);
        continue;
      }

      try {
        const context = this.createPluginContext(entry);
        await this.initializeWithTimeout(entry.plugin, context);
        entry.initTime = new Date();
        this.collectExtensionPoints(entry.plugin);
        this.logger.info(`Plugin initialized: ${name}`);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to initialize plugin ${name}: ${entry.error}`);
        // Continue with other plugins
      }
    }

    this.initialized = true;
    this.logger.info(`Registry initialized with ${this.plugins.size} plugins`);
  }

  /**
   * Shutdown all plugins.
   */
  async shutdown(): Promise<void> {
    // Shutdown in reverse order
    const names = Array.from(this.plugins.keys()).reverse();

    for (const name of names) {
      const entry = this.plugins.get(name)!;
      if (entry.plugin.state === 'initialized') {
        try {
          await entry.plugin.shutdown();
          this.logger.info(`Plugin shutdown: ${name}`);
        } catch (error) {
          this.logger.error(`Error shutting down plugin ${name}: ${error}`);
        }
      }
    }

    this.invalidateCaches();
    this.initialized = false;
  }

  // =========================================================================
  // Dependency Resolution
  // =========================================================================

  /**
   * Resolve dependencies and return load order.
   */
  private resolveDependencies(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      const entry = this.plugins.get(name);
      if (!entry) {
        throw new Error(`Missing dependency: ${name}`);
      }

      visiting.add(name);

      const deps = entry.plugin.metadata.dependencies ?? [];
      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of this.plugins.keys()) {
      visit(name);
    }

    return order;
  }

  // =========================================================================
  // Extension Points
  // =========================================================================

  /**
   * Collect extension points from a plugin.
   */
  private collectExtensionPoints(plugin: IPlugin): void {
    if (plugin.registerAgentTypes) {
      const types = plugin.registerAgentTypes();
      if (types) this.agentTypesCache.push(...types);
    }

    if (plugin.registerTaskTypes) {
      const types = plugin.registerTaskTypes();
      if (types) this.taskTypesCache.push(...types);
    }

    if (plugin.registerMCPTools) {
      const tools = plugin.registerMCPTools();
      if (tools) this.mcpToolsCache.push(...tools);
    }

    if (plugin.registerCLICommands) {
      const commands = plugin.registerCLICommands();
      if (commands) this.cliCommandsCache.push(...commands);
    }

    if (plugin.registerMemoryBackends) {
      const backends = plugin.registerMemoryBackends();
      if (backends) this.memoryBackendsCache.push(...backends);
    }

    if (plugin.registerHooks) {
      const hooks = plugin.registerHooks();
      if (hooks) this.hooksCache.push(...hooks);
    }

    if (plugin.registerWorkers) {
      const workers = plugin.registerWorkers();
      if (workers) this.workersCache.push(...workers);
    }

    if (plugin.registerProviders) {
      const providers = plugin.registerProviders();
      if (providers) this.providersCache.push(...providers);
    }
  }

  /**
   * Invalidate extension point caches.
   */
  private invalidateCaches(): void {
    this.agentTypesCache = [];
    this.taskTypesCache = [];
    this.mcpToolsCache = [];
    this.cliCommandsCache = [];
    this.memoryBackendsCache = [];
    this.hooksCache = [];
    this.workersCache = [];
    this.providersCache = [];

    // Recollect from initialized plugins
    for (const entry of this.plugins.values()) {
      if (entry.plugin.state === 'initialized') {
        this.collectExtensionPoints(entry.plugin);
      }
    }
  }

  // =========================================================================
  // Getters
  // =========================================================================

  getAgentTypes(): AgentTypeDefinition[] {
    return [...this.agentTypesCache];
  }

  getTaskTypes(): TaskTypeDefinition[] {
    return [...this.taskTypesCache];
  }

  getMCPTools(): MCPToolDefinition[] {
    return [...this.mcpToolsCache];
  }

  getCLICommands(): CLICommandDefinition[] {
    return [...this.cliCommandsCache];
  }

  getMemoryBackends(): MemoryBackendFactory[] {
    return [...this.memoryBackendsCache];
  }

  getHooks(): HookDefinition[] {
    return [...this.hooksCache];
  }

  getWorkers(): WorkerDefinition[] {
    return [...this.workersCache];
  }

  getProviders(): LLMProviderDefinition[] {
    return [...this.providersCache];
  }

  getPlugin(name: string): IPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  getPluginEntry(name: string): PluginEntry | undefined {
    return this.plugins.get(name);
  }

  listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(e => e.plugin.metadata);
  }

  // =========================================================================
  // Health Check
  // =========================================================================

  /**
   * Run health checks on all plugins.
   */
  async healthCheck(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    for (const [name, entry] of this.plugins) {
      if (entry.plugin.state !== 'initialized') {
        results.set(name, {
          healthy: false,
          status: 'unhealthy',
          message: `Plugin not initialized: ${entry.plugin.state}`,
          checks: {},
          timestamp: new Date(),
        });
        continue;
      }

      try {
        if (entry.plugin.healthCheck) {
          results.set(name, await entry.plugin.healthCheck());
        } else {
          results.set(name, {
            healthy: true,
            status: 'healthy',
            checks: {},
            timestamp: new Date(),
          });
        }
      } catch (error) {
        results.set(name, {
          healthy: false,
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
          checks: {},
          timestamp: new Date(),
        });
      }
    }

    return results;
  }

  // =========================================================================
  // Stats
  // =========================================================================

  getStats(): RegistryStats {
    let initialized = 0;
    let failed = 0;

    for (const entry of this.plugins.values()) {
      if (entry.plugin.state === 'initialized') initialized++;
      if (entry.plugin.state === 'error' || entry.error) failed++;
    }

    return {
      total: this.plugins.size,
      initialized,
      failed,
      agentTypes: this.agentTypesCache.length,
      taskTypes: this.taskTypesCache.length,
      mcpTools: this.mcpToolsCache.length,
      cliCommands: this.cliCommandsCache.length,
      hooks: this.hooksCache.length,
      workers: this.workersCache.length,
      providers: this.providersCache.length,
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private createPluginContext(entry: PluginEntry): PluginContext {
    return {
      config: entry.config,
      eventBus: this.eventBus,
      logger: this.logger.child({ plugin: entry.plugin.metadata.name }),
      services: this.services,
      coreVersion: this.config.coreVersion,
      dataDir: this.config.dataDir,
    };
  }

  private async initializeWithTimeout(
    plugin: IPlugin,
    context: PluginContext
  ): Promise<void> {
    const timeout = this.config.loadTimeout ?? 30000;

    await Promise.race([
      plugin.initialize(context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Initialization timeout')), timeout)
      ),
    ]);
  }
}

// ============================================================================
// Default Registry Instance
// ============================================================================

let defaultRegistry: PluginRegistry | null = null;

export function getDefaultRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry({
      coreVersion: '3.0.0',
      dataDir: process.cwd(),
    });
  }
  return defaultRegistry;
}

export function setDefaultRegistry(registry: PluginRegistry): void {
  defaultRegistry = registry;
}
