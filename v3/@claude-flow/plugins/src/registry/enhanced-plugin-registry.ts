/**
 * Enhanced Plugin Registry
 *
 * Extended plugin registry with:
 * - Version constraint enforcement
 * - Safe unload with dependency checking
 * - Parallel initialization
 * - Enhanced service container
 * - Hot reload support
 * - Conflict resolution
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
import {
  DependencyGraph,
  type PluginDependency,
  type DependencyError,
  satisfiesVersion,
} from './dependency-graph.js';

// ============================================================================
// Types
// ============================================================================

export type InitializationStrategy = 'sequential' | 'parallel' | 'parallel-safe';

export type ConflictStrategy = 'first' | 'last' | 'error' | 'namespace';

export interface ConflictResolution {
  strategy: ConflictStrategy;
  namespaceTemplate?: string;  // e.g., "{plugin}:{name}"
}

export interface EnhancedPluginRegistryConfig {
  coreVersion: string;
  dataDir: string;
  logger?: ILogger;
  eventBus?: IEventBus;
  defaultConfig?: Partial<PluginConfig>;
  maxPlugins?: number;
  loadTimeout?: number;
  initializationStrategy?: InitializationStrategy;
  maxParallelInit?: number;
  conflictResolution?: {
    mcpTools?: ConflictResolution;
    cliCommands?: ConflictResolution;
    agentTypes?: ConflictResolution;
    taskTypes?: ConflictResolution;
  };
}

export interface PluginEntry {
  plugin: IPlugin;
  config: PluginConfig;
  loadTime: Date;
  initTime?: Date;
  error?: string;
  /**
   * Raw extension points returned by the plugin at initialization time.
   *
   * Cache invalidation replays these values through conflict resolution
   * instead of calling the plugin's register* methods again: those methods
   * may have side effects, and plugins may return a new array (or allocate
   * resources) per call.
   */
  extensionPoints?: ExtensionPointCollection;
}

interface ExtensionPointCollection {
  agentTypes: AgentTypeDefinition[];
  taskTypes: TaskTypeDefinition[];
  mcpTools: MCPToolDefinition[];
  cliCommands: CLICommandDefinition[];
  memoryBackends: MemoryBackendFactory[];
  hooks: HookDefinition[];
  workers: WorkerDefinition[];
  providers: LLMProviderDefinition[];
}

function emptyExtensionPointCollection(): ExtensionPointCollection {
  return {
    agentTypes: [],
    taskTypes: [],
    mcpTools: [],
    cliCommands: [],
    memoryBackends: [],
    hooks: [],
    workers: [],
    providers: [],
  };
}

export interface UnregisterOptions {
  cascade?: boolean;  // Unload dependents first
  force?: boolean;    // Ignore dependency errors
}

export interface HotReloadOptions {
  preserveState?: boolean;
  migrateState?: (oldState: unknown, newVersion: string) => unknown;
  timeout?: number;
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

export interface ServiceMetadata {
  description?: string;
  provider: string;
  version?: string;
  deprecated?: boolean;
  replacement?: string;
}

// ============================================================================
// Enhanced Service Container
// ============================================================================

class EnhancedServiceContainer implements ServiceContainer {
  private services = new Map<string, unknown>();
  private metadata = new Map<string, ServiceMetadata>();

  get<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  setWithMetadata<T>(key: string, value: T, metadata: ServiceMetadata): void {
    this.services.set(key, value);
    this.metadata.set(key, metadata);
  }

  has(key: string): boolean {
    return this.services.has(key);
  }

  delete(key: string): boolean {
    this.metadata.delete(key);
    return this.services.delete(key);
  }

  list(): string[] {
    return Array.from(this.services.keys());
  }

  listByPrefix(prefix: string): string[] {
    return this.list().filter(key => key.startsWith(prefix));
  }

  getMetadata(key: string): ServiceMetadata | undefined {
    return this.metadata.get(key);
  }
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

// ============================================================================
// Enhanced Plugin Registry
// ============================================================================

/**
 * Enhanced plugin registry with advanced features.
 *
 * Features:
 * - Version constraint enforcement
 * - Dependency graph with safe unload
 * - Parallel initialization
 * - Enhanced service container
 * - Hot reload support
 * - Conflict resolution
 */
export class EnhancedPluginRegistry extends EventEmitter {
  private readonly plugins = new Map<string, PluginEntry>();
  private readonly config: EnhancedPluginRegistryConfig;
  private readonly logger: ILogger;
  private readonly eventBus: IEventBus;
  private readonly services: EnhancedServiceContainer;
  private readonly dependencyGraph: DependencyGraph;
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

  // Track extension ownership for conflict resolution
  private toolOwners = new Map<string, string>();
  private commandOwners = new Map<string, string>();
  private agentTypeOwners = new Map<string, string>();
  private taskTypeOwners = new Map<string, string>();

  constructor(config: EnhancedPluginRegistryConfig) {
    super();
    this.config = {
      initializationStrategy: 'sequential',
      maxParallelInit: 5,
      ...config,
    };
    this.logger = config.logger ?? new DefaultLogger({ component: 'EnhancedPluginRegistry' });
    this.eventBus = config.eventBus ?? new DefaultEventBus();
    this.services = new EnhancedServiceContainer();
    this.dependencyGraph = new DependencyGraph();

    // Register self in services
    this.services.setWithMetadata('pluginRegistry', this, {
      provider: 'core',
      description: 'Plugin registry instance',
      version: config.coreVersion,
    });
  }

  // =========================================================================
  // Plugin Loading
  // =========================================================================

  /**
   * Register a plugin with version constraint validation.
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
    const version = resolvedPlugin.metadata.version;

    // Check for duplicates
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    // Check max plugins
    if (this.config.maxPlugins && this.plugins.size >= this.config.maxPlugins) {
      throw new Error(`Maximum plugin limit (${this.config.maxPlugins}) reached`);
    }

    // Check core version compatibility
    if (resolvedPlugin.metadata.minCoreVersion) {
      if (!satisfiesVersion(`>=${resolvedPlugin.metadata.minCoreVersion}`, this.config.coreVersion)) {
        throw new Error(
          `Plugin ${name} requires core version >= ${resolvedPlugin.metadata.minCoreVersion}, ` +
          `but current version is ${this.config.coreVersion}`
        );
      }
    }
    if (resolvedPlugin.metadata.maxCoreVersion) {
      if (!satisfiesVersion(`<=${resolvedPlugin.metadata.maxCoreVersion}`, this.config.coreVersion)) {
        throw new Error(
          `Plugin ${name} requires core version <= ${resolvedPlugin.metadata.maxCoreVersion}, ` +
          `but current version is ${this.config.coreVersion}`
        );
      }
    }

    // Parse dependencies
    const dependencies = this.parseDependencies(resolvedPlugin.metadata.dependencies);

    // Add to dependency graph
    this.dependencyGraph.addPlugin(name, version, dependencies);

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
    this.logger.info(`Plugin registered: ${name} v${version}`);
  }

  /**
   * Unregister a plugin with dependency checking.
   */
  async unregister(name: string, options?: UnregisterOptions): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin ${name} not found`);
    }

    // Check dependents
    const dependents = this.dependencyGraph.getDependents(name);

    if (dependents.length > 0) {
      if (options?.cascade) {
        // Unload dependents first (in reverse order)
        const order = this.dependencyGraph.getRemovalOrder(name);
        for (const dep of order) {
          if (dep !== name) {
            await this.shutdownPlugin(dep);
            this.removePluginFromGraph(dep);
          }
        }
      } else if (options?.force) {
        this.logger.warn(`Force removing ${name}, breaking: ${dependents.join(', ')}`);
      } else {
        throw new Error(`Cannot remove ${name}: required by ${dependents.join(', ')}`);
      }
    }

    // Shutdown and remove
    await this.shutdownPlugin(name);
    this.removePluginFromGraph(name);

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

    // Validate dependencies
    const errors = this.dependencyGraph.validate();
    const criticalErrors = errors.filter(e => e.type !== 'missing' || !this.isOptionalDependency(e));

    if (criticalErrors.length > 0) {
      const errorMessages = criticalErrors.map(e => e.message).join('\n');
      throw new Error(`Dependency validation failed:\n${errorMessages}`);
    }

    // Initialize based on strategy
    const strategy = this.config.initializationStrategy ?? 'sequential';

    switch (strategy) {
      case 'sequential':
        await this.initializeSequential();
        break;
      case 'parallel':
        await this.initializeParallel();
        break;
      case 'parallel-safe':
        await this.initializeParallelSafe();
        break;
    }

    // Check for initialization errors (including conflicts)
    const initErrors = Array.from(this.plugins.values())
      .filter(e => e.error)
      .map(e => `${e.plugin.metadata.name}: ${e.error}`);

    if (initErrors.length > 0) {
      throw new Error(`Plugin initialization failed:\n${initErrors.join('\n')}`);
    }

    this.initialized = true;
    this.logger.info(`Registry initialized with ${this.plugins.size} plugins (${strategy})`);
  }

  private async initializeSequential(): Promise<void> {
    const loadOrder = this.dependencyGraph.getLoadOrder();

    for (const name of loadOrder) {
      const entry = this.plugins.get(name);
      if (!entry) continue;

      if (!entry.config.enabled) {
        this.logger.info(`Plugin ${name} is disabled, skipping initialization`);
        continue;
      }

      try {
        await this.initializePlugin(entry);
        this.logger.info(`Plugin initialized: ${name}`);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to initialize plugin ${name}: ${entry.error}`);
      }
    }
  }

  private async initializeParallel(): Promise<void> {
    const entries = Array.from(this.plugins.values()).filter(e => e.config.enabled);
    const maxParallel = this.config.maxParallelInit ?? 5;

    // Initialize in batches
    for (let i = 0; i < entries.length; i += maxParallel) {
      const batch = entries.slice(i, i + maxParallel);
      const promises = batch.map(entry => this.initializePlugin(entry).catch(err => {
        entry.error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to initialize plugin ${entry.plugin.metadata.name}: ${entry.error}`);
      }));

      await Promise.all(promises);
    }
  }

  private async initializeParallelSafe(): Promise<void> {
    const levels = this.dependencyGraph.getDepthLevels();
    const maxParallel = this.config.maxParallelInit ?? 5;

    for (const level of levels) {
      // Initialize each level in parallel, but levels are sequential
      for (let i = 0; i < level.length; i += maxParallel) {
        const batch = level.slice(i, i + maxParallel);
        const promises = batch.map(async name => {
          const entry = this.plugins.get(name);
          if (!entry || !entry.config.enabled) return;

          try {
            await this.initializePlugin(entry);
            this.logger.info(`Plugin initialized: ${name}`);
          } catch (error) {
            entry.error = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to initialize plugin ${name}: ${entry.error}`);
          }
        });

        await Promise.all(promises);
      }
    }
  }

  private async initializePlugin(entry: PluginEntry): Promise<void> {
    const context = this.createPluginContext(entry);
    const timeout = this.config.loadTimeout ?? 30000;

    await Promise.race([
      entry.plugin.initialize(context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Initialization timeout')), timeout)
      ),
    ]);

    entry.initTime = new Date();
    entry.extensionPoints = this.readExtensionPoints(entry.plugin);
    this.applyExtensionPoints(entry.extensionPoints, entry.plugin.metadata.name);
  }

  /**
   * Shutdown all plugins.
   */
  async shutdown(): Promise<void> {
    // Shutdown in reverse order
    const names = Array.from(this.plugins.keys()).reverse();

    for (const name of names) {
      await this.shutdownPlugin(name);
    }

    this.invalidateCaches();
    this.initialized = false;
  }

  // =========================================================================
  // Hot Reload
  // =========================================================================

  /**
   * Hot reload a plugin without full restart.
   */
  async reload(
    name: string,
    newPlugin: IPlugin | PluginFactory,
    options?: HotReloadOptions
  ): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin ${name} not found`);
    }

    // Capture state if preserving
    let state: unknown;
    if (options?.preserveState && (entry.plugin as any).getState) {
      state = await (entry.plugin as any).getState();
    }

    // Shutdown old plugin
    if (entry.plugin.state === 'initialized') {
      await entry.plugin.shutdown();
    }

    // Resolve and validate new plugin
    const resolved = typeof newPlugin === 'function' ? await newPlugin() : newPlugin;
    if (!validatePlugin(resolved)) {
      throw new Error('Invalid plugin replacement');
    }

    // Verify same name
    if (resolved.metadata.name !== name) {
      throw new Error(`Plugin name mismatch: expected ${name}, got ${resolved.metadata.name}`);
    }

    // Update dependency graph
    const dependencies = this.parseDependencies(resolved.metadata.dependencies);
    this.dependencyGraph.removePlugin(name);
    this.dependencyGraph.addPlugin(name, resolved.metadata.version, dependencies);

    // Initialize new plugin
    const context = this.createPluginContext(entry);
    const timeout = options?.timeout ?? this.config.loadTimeout ?? 30000;

    await Promise.race([
      resolved.initialize(context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Hot reload timeout')), timeout)
      ),
    ]);

    // Restore state if applicable
    if (state && options?.migrateState) {
      state = options.migrateState(state, resolved.metadata.version);
    }
    if (state && (resolved as any).restoreState) {
      await (resolved as any).restoreState(state);
    }

    // Update entry
    entry.plugin = resolved;
    entry.initTime = new Date();
    entry.error = undefined;

    // Replace the captured extension points, then rebuild all caches from
    // captured values rather than re-running any plugin's register methods.
    entry.extensionPoints = this.readExtensionPoints(resolved);
    this.invalidateCaches();

    this.logger.info(`Plugin hot reloaded: ${name} -> v${resolved.metadata.version}`);
    this.eventBus.emit(PLUGIN_EVENTS.INITIALIZED, { plugin: name, reloaded: true });
  }

  // =========================================================================
  // Extension Points
  // =========================================================================

  /**
   * Read a plugin's extension points without resolving conflicts or mutating
   * caches. The raw values are stored on the entry for later rebuilds.
   */
  private readExtensionPoints(plugin: IPlugin): ExtensionPointCollection {
    const points = emptyExtensionPointCollection();

    if (plugin.registerAgentTypes) {
      const types = plugin.registerAgentTypes();
      if (types) points.agentTypes.push(...types);
    }

    if (plugin.registerTaskTypes) {
      const types = plugin.registerTaskTypes();
      if (types) points.taskTypes.push(...types);
    }

    if (plugin.registerMCPTools) {
      const tools = plugin.registerMCPTools();
      if (tools) points.mcpTools.push(...tools);
    }

    if (plugin.registerCLICommands) {
      const commands = plugin.registerCLICommands();
      if (commands) points.cliCommands.push(...commands);
    }

    if (plugin.registerMemoryBackends) {
      const backends = plugin.registerMemoryBackends();
      if (backends) points.memoryBackends.push(...backends);
    }

    if (plugin.registerHooks) {
      const hooks = plugin.registerHooks();
      if (hooks) points.hooks.push(...hooks);
    }

    if (plugin.registerWorkers) {
      const workers = plugin.registerWorkers();
      if (workers) points.workers.push(...workers);
    }

    if (plugin.registerProviders) {
      const providers = plugin.registerProviders();
      if (providers) points.providers.push(...providers);
    }

    return points;
  }

  /**
   * Apply raw extension points through conflict resolution and append the
   * accepted values to the caches.
   */
  private applyExtensionPoints(points: ExtensionPointCollection, name: string): void {
    const resolution = this.config.conflictResolution;

    // Collect agent types
    for (const type of points.agentTypes) {
      const resolvedType = this.resolveConflict(
        'agentTypes',
        type.type,
        type,
        name,
        this.agentTypeOwners,
        resolution?.agentTypes
      );
      if (resolvedType) {
        this.agentTypesCache.push(resolvedType);
      }
    }

    // Collect task types
    for (const type of points.taskTypes) {
      const resolvedType = this.resolveConflict(
        'taskTypes',
        type.type,
        type,
        name,
        this.taskTypeOwners,
        resolution?.taskTypes
      );
      if (resolvedType) {
        this.taskTypesCache.push(resolvedType);
      }
    }

    // Collect MCP tools
    for (const tool of points.mcpTools) {
      const resolvedTool = this.resolveConflict(
        'mcpTools',
        tool.name,
        tool,
        name,
        this.toolOwners,
        resolution?.mcpTools
      );
      if (resolvedTool) {
        this.mcpToolsCache.push(resolvedTool);
      }
    }

    // Collect CLI commands
    for (const command of points.cliCommands) {
      const resolvedCommand = this.resolveConflict(
        'cliCommands',
        command.name,
        command,
        name,
        this.commandOwners,
        resolution?.cliCommands
      );
      if (resolvedCommand) {
        this.cliCommandsCache.push(resolvedCommand);
      }
    }

    // Collect other extension points (no conflict resolution needed)
    this.memoryBackendsCache.push(...points.memoryBackends);
    this.hooksCache.push(...points.hooks);
    this.workersCache.push(...points.workers);
    this.providersCache.push(...points.providers);
  }

  private resolveConflict<T extends { name?: string; type?: string }>(
    category: string,
    identifier: string,
    item: T,
    pluginName: string,
    owners: Map<string, string>,
    resolution?: ConflictResolution
  ): T | null {
    const existing = owners.get(identifier);

    if (!existing) {
      owners.set(identifier, pluginName);
      return item;
    }

    const strategy = resolution?.strategy ?? 'error';

    switch (strategy) {
      case 'first':
        this.logger.warn(`${category}: ${identifier} already registered by ${existing}, ignoring from ${pluginName}`);
        return null;

      case 'last':
        this.logger.warn(`${category}: ${identifier} replacing ${existing}'s version with ${pluginName}'s`);
        owners.set(identifier, pluginName);
        // Remove existing from cache
        this.removeFromCache(category, identifier);
        return item;

      case 'namespace': {
        const template = resolution?.namespaceTemplate ?? '{plugin}:{name}';

        // Namespace the existing entry too (on first conflict)
        const existingNs = template
          .replace('{plugin}', existing)
          .replace('{name}', identifier);
        if (!owners.has(existingNs)) {
          this.renameInCache(category, identifier, existingNs);
          owners.delete(identifier);
          owners.set(existingNs, existing);
        }

        const newName = template
          .replace('{plugin}', pluginName)
          .replace('{name}', identifier);
        owners.set(newName, pluginName);
        return { ...item, name: newName, type: newName } as T;
      }

      case 'error':
      default:
        throw new Error(`${category}: ${identifier} conflict between ${existing} and ${pluginName}`);
    }
  }

  private renameInCache(category: string, oldName: string, newName: string): void {
    switch (category) {
      case 'agentTypes':
        this.agentTypesCache = this.agentTypesCache.map(t =>
          t.type === oldName ? { ...t, type: newName } : t
        );
        break;
      case 'taskTypes':
        this.taskTypesCache = this.taskTypesCache.map(t =>
          t.type === oldName ? { ...t, type: newName } : t
        );
        break;
      case 'mcpTools':
        this.mcpToolsCache = this.mcpToolsCache.map(t =>
          t.name === oldName ? { ...t, name: newName } : t
        );
        break;
      case 'cliCommands':
        this.cliCommandsCache = this.cliCommandsCache.map(c =>
          c.name === oldName ? { ...c, name: newName } : c
        );
        break;
    }
  }

  private removeFromCache(category: string, identifier: string): void {
    switch (category) {
      case 'agentTypes':
        this.agentTypesCache = this.agentTypesCache.filter(t => t.type !== identifier);
        break;
      case 'taskTypes':
        this.taskTypesCache = this.taskTypesCache.filter(t => t.type !== identifier);
        break;
      case 'mcpTools':
        this.mcpToolsCache = this.mcpToolsCache.filter(t => t.name !== identifier);
        break;
      case 'cliCommands':
        this.cliCommandsCache = this.cliCommandsCache.filter(c => c.name !== identifier);
        break;
    }
  }

  /**
   * Invalidate extension point caches by replaying each initialized plugin's
   * captured values through conflict resolution. Never calls plugin
   * register* methods here: invalidation happens on unregister/reload and
   * must not re-run plugin code (#4410).
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

    this.toolOwners.clear();
    this.commandOwners.clear();
    this.agentTypeOwners.clear();
    this.taskTypeOwners.clear();

    // Rebuild from initialized plugins using their captured raw values.
    for (const entry of this.plugins.values()) {
      if (entry.plugin.state === 'initialized' && entry.extensionPoints) {
        this.applyExtensionPoints(entry.extensionPoints, entry.plugin.metadata.name);
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

  getDependencyGraph(): DependencyGraph {
    return this.dependencyGraph;
  }

  getServices(): EnhancedServiceContainer {
    return this.services;
  }

  // =========================================================================
  // Health Check
  // =========================================================================

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
  // Private Helpers
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

  private async shutdownPlugin(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) return;

    if (entry.plugin.state === 'initialized') {
      try {
        this.eventBus.emit(PLUGIN_EVENTS.SHUTTING_DOWN, { plugin: name });
        await entry.plugin.shutdown();
        this.eventBus.emit(PLUGIN_EVENTS.SHUTDOWN, { plugin: name });
        this.logger.info(`Plugin shutdown: ${name}`);
      } catch (error) {
        this.logger.error(`Error shutting down plugin ${name}: ${error}`);
      }
    }
  }

  private removePluginFromGraph(name: string): void {
    this.dependencyGraph.removePlugin(name);
    this.plugins.delete(name);
    this.invalidateCaches();
  }

  private parseDependencies(deps?: string[] | PluginDependency[]): PluginDependency[] {
    if (!deps) return [];

    return deps.map(dep => {
      if (typeof dep === 'string') {
        // Parse "name@version" format or just "name"
        const match = dep.match(/^([^@]+)(?:@(.+))?$/);
        if (match) {
          return {
            name: match[1],
            version: match[2] ?? '*',
          };
        }
        return { name: dep, version: '*' };
      }
      return dep;
    });
  }

  private isOptionalDependency(error: DependencyError): boolean {
    const plugin = this.plugins.get(error.plugin);
    if (!plugin) return false;

    const deps = this.parseDependencies(plugin.plugin.metadata.dependencies);
    const dep = deps.find(d => d.name === error.dependency);
    return dep?.optional ?? false;
  }
}

// ============================================================================
// Default Registry Instance
// ============================================================================

let defaultRegistry: EnhancedPluginRegistry | null = null;

export function getDefaultEnhancedRegistry(): EnhancedPluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new EnhancedPluginRegistry({
      coreVersion: '3.0.0',
      dataDir: process.cwd(),
    });
  }
  return defaultRegistry;
}

export function setDefaultEnhancedRegistry(registry: EnhancedPluginRegistry): void {
  defaultRegistry = registry;
}
