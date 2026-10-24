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
  PluginDependencySpec,
} from '../types/index.js';
import type { IPlugin, PluginFactory } from '../core/plugin-interface.js';
import { validatePlugin, PLUGIN_EVENTS } from '../core/plugin-interface.js';
import { BasePlugin } from '../core/base-plugin.js';
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

/**
 * Raised when two plugins register the same agent type, task type, MCP tool
 * or CLI command and the conflict strategy is 'error' (the default).
 *
 * Unlike an ordinary plugin initialization failure (recorded on the plugin's
 * entry and logged), a conflict makes EnhancedPluginRegistry.initialize()
 * reject: silently dropping one of two same-named tools is not safe.
 */
export class PluginConflictError extends Error {
  constructor(
    public readonly category: string,
    public readonly identifier: string,
    public readonly existingPlugin: string,
    public readonly conflictingPlugin: string
  ) {
    super(`${category}: ${identifier} conflict between ${existingPlugin} and ${conflictingPlugin}`);
    this.name = 'PluginConflictError';
  }
}

type ConflictCategory = 'agentTypes' | 'taskTypes' | 'mcpTools' | 'cliCommands';

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

      const conflict = await this.initializeAndRecord(entry);
      if (conflict) throw conflict;
    }
  }

  private async initializeParallel(): Promise<void> {
    const entries = Array.from(this.plugins.values()).filter(e => e.config.enabled);
    const maxParallel = this.config.maxParallelInit ?? 5;

    // Initialize in batches
    for (let i = 0; i < entries.length; i += maxParallel) {
      const batch = entries.slice(i, i + maxParallel);
      const conflicts = await Promise.all(batch.map(entry => this.initializeAndRecord(entry)));
      const conflict = conflicts.find(c => c !== undefined);
      if (conflict) throw conflict;
    }
  }

  private async initializeParallelSafe(): Promise<void> {
    const levels = this.dependencyGraph.getDepthLevels();
    const maxParallel = this.config.maxParallelInit ?? 5;

    for (const level of levels) {
      // Initialize each level in parallel, but levels are sequential
      for (let i = 0; i < level.length; i += maxParallel) {
        const batch = level.slice(i, i + maxParallel);
        const conflicts = await Promise.all(batch.map(async name => {
          const entry = this.plugins.get(name);
          if (!entry || !entry.config.enabled) return undefined;
          return this.initializeAndRecord(entry);
        }));
        const conflict = conflicts.find(c => c !== undefined);
        if (conflict) throw conflict;
      }
    }
  }

  /**
   * Initialize one plugin. Ordinary failures are recorded on the entry and
   * logged, as before. An extension-point conflict is also recorded, the
   * plugin is shut down again (none of its extensions were registered), and
   * the error is returned so initialize() can reject with it.
   */
  private async initializeAndRecord(entry: PluginEntry): Promise<PluginConflictError | undefined> {
    const name = entry.plugin.metadata.name;
    try {
      await this.initializePlugin(entry);
      this.logger.info(`Plugin initialized: ${name}`);
      return undefined;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize plugin ${name}: ${entry.error}`);
      if (error instanceof PluginConflictError) {
        this.eventBus.emit(PLUGIN_EVENTS.ERROR, { plugin: name, error: entry.error });
        await this.shutdownPlugin(name);
        return error;
      }
      return undefined;
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
    this.collectExtensionPoints(entry.plugin);
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
    let hasState = false;
    if (options?.preserveState) {
      const captured = await this.exportPluginState(entry.plugin);
      hasState = captured.found;
      state = captured.state;
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
    if (hasState && options?.migrateState) {
      state = options.migrateState(state, resolved.metadata.version);
    }
    if (hasState) {
      await this.importPluginState(resolved, state);
    }

    // Update entry
    entry.plugin = resolved;
    entry.initTime = new Date();
    entry.error = undefined;

    // Recollect extension points
    this.invalidateCaches();

    this.logger.info(`Plugin hot reloaded: ${name} -> v${resolved.metadata.version}`);
    this.eventBus.emit(PLUGIN_EVENTS.INITIALIZED, { plugin: name, reloaded: true });
  }

  /**
   * Read a plugin's reload state via exportState(). Falls back to the
   * deprecated duck-typed getState() for plugins written against the old
   * reload contract.
   */
  private async exportPluginState(plugin: IPlugin): Promise<{ found: boolean; state: unknown }> {
    if (typeof plugin.exportState === 'function') {
      return { found: true, state: await plugin.exportState() };
    }
    const legacy = plugin as IPlugin & { getState?: () => unknown };
    if (typeof legacy.getState === 'function') {
      this.logger.warn(
        `Plugin ${plugin.metadata.name}: getState() for hot reload is deprecated, implement exportState()`
      );
      return { found: true, state: await legacy.getState() };
    }
    return { found: false, state: undefined };
  }

  /**
   * Hand reload state to the replacement plugin via importState(). The
   * deprecated setState() fallback is used only for plugins that are not a
   * BasePlugin: on BasePlugin, setState() is the protected lifecycle-state
   * setter and must never receive user state.
   */
  private async importPluginState(plugin: IPlugin, state: unknown): Promise<void> {
    if (typeof plugin.importState === 'function') {
      await plugin.importState(state);
      return;
    }
    const legacy = plugin as IPlugin & { setState?: (state: unknown) => unknown };
    if (!(plugin instanceof BasePlugin) && typeof legacy.setState === 'function') {
      this.logger.warn(
        `Plugin ${plugin.metadata.name}: setState() for hot reload is deprecated, implement importState()`
      );
      await legacy.setState(state);
      return;
    }
    this.logger.warn(`Plugin ${plugin.metadata.name} has no importState(); preserved state was dropped`);
  }

  // =========================================================================
  // Extension Points
  // =========================================================================

  private collectExtensionPoints(plugin: IPlugin): void {
    const name = plugin.metadata.name;
    const resolution = this.config.conflictResolution;

    const agentTypes = plugin.registerAgentTypes?.() ?? [];
    const taskTypes = plugin.registerTaskTypes?.() ?? [];
    const tools = plugin.registerMCPTools?.() ?? [];
    const commands = plugin.registerCLICommands?.() ?? [];

    // Check 'error'-strategy conflicts before registering anything, so a
    // rejected plugin never leaves half of its extension points behind.
    this.assertNoErrorConflicts('agentTypes', agentTypes.map(t => t.type), name, this.agentTypeOwners, resolution?.agentTypes);
    this.assertNoErrorConflicts('taskTypes', taskTypes.map(t => t.type), name, this.taskTypeOwners, resolution?.taskTypes);
    this.assertNoErrorConflicts('mcpTools', tools.map(t => t.name), name, this.toolOwners, resolution?.mcpTools);
    this.assertNoErrorConflicts('cliCommands', commands.map(c => c.name), name, this.commandOwners, resolution?.cliCommands);

    // Collect agent types
    for (const type of agentTypes) {
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
    for (const type of taskTypes) {
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
    for (const tool of tools) {
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
    for (const command of commands) {
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

  private assertNoErrorConflicts(
    category: ConflictCategory,
    identifiers: string[],
    pluginName: string,
    owners: Map<string, string>,
    resolution?: ConflictResolution
  ): void {
    if ((resolution?.strategy ?? 'error') !== 'error') return;

    const seen = new Set<string>();
    for (const identifier of identifiers) {
      const existing = owners.get(identifier) ?? (seen.has(identifier) ? pluginName : undefined);
      if (existing) {
        throw new PluginConflictError(category, identifier, existing, pluginName);
      }
      seen.add(identifier);
    }
  }

  private resolveConflict<T extends { name?: string; type?: string }>(
    category: ConflictCategory,
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
        // On the first conflict the existing owner still holds the bare
        // identifier; namespace it too, so no plugin silently "wins" the
        // unqualified name. The bare identifier stays in owners so later
        // conflicts are still detected.
        const existingName = this.applyNamespace(template, existing, identifier);
        if (this.renameInCache(category, identifier, existingName)) {
          owners.set(existingName, existing);
        }
        const newName = this.applyNamespace(template, pluginName, identifier);
        owners.set(newName, pluginName);
        return this.withIdentifier(category, item, newName);
      }

      case 'error':
      default:
        throw new PluginConflictError(category, identifier, existing, pluginName);
    }
  }

  private applyNamespace(template: string, pluginName: string, identifier: string): string {
    return template.replace('{plugin}', pluginName).replace('{name}', identifier);
  }

  /** Agent and task types are keyed by `type`; tools and commands by `name`. */
  private withIdentifier<T extends { name?: string; type?: string }>(
    category: ConflictCategory,
    item: T,
    identifier: string
  ): T {
    return category === 'agentTypes' || category === 'taskTypes'
      ? { ...item, type: identifier }
      : { ...item, name: identifier };
  }

  private renameInCache(category: ConflictCategory, identifier: string, newIdentifier: string): boolean {
    let renamed = false;
    const rename = <T extends { name?: string; type?: string }>(items: T[], key: 'name' | 'type'): T[] =>
      items.map(item => {
        if (item[key] !== identifier) return item;
        renamed = true;
        return this.withIdentifier(category, item, newIdentifier);
      });

    switch (category) {
      case 'agentTypes':
        this.agentTypesCache = rename(this.agentTypesCache, 'type');
        break;
      case 'taskTypes':
        this.taskTypesCache = rename(this.taskTypesCache, 'type');
        break;
      case 'mcpTools':
        this.mcpToolsCache = rename(this.mcpToolsCache, 'name');
        break;
      case 'cliCommands':
        this.cliCommandsCache = rename(this.cliCommandsCache, 'name');
        break;
    }
    return renamed;
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

  private parseDependencies(deps?: ReadonlyArray<string | PluginDependencySpec>): PluginDependency[] {
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
      return { ...dep };
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
