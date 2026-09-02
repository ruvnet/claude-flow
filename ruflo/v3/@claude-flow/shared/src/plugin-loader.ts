/**
 * V3 Plugin Loader
 * Domain-Driven Design - Plugin-Based Architecture (ADR-004)
 *
 * Handles plugin loading, dependency resolution, and lifecycle management
 */

import type {
  ClaudeFlowPlugin,
  PluginContext,
  PluginInfo,
  PluginLifecycleState,
  PluginError as PluginErrorType,
  PluginErrorCode,
} from './plugin-interface.js';
import { PluginError } from './plugin-interface.js';
import type { PluginRegistry } from './plugin-registry.js';

/**
 * Plugin loader configuration
 */
export interface PluginLoaderConfig {
  /**
   * Maximum time to wait for plugin initialization (ms)
   */
  initializationTimeout?: number;

  /**
   * Maximum time to wait for plugin shutdown (ms)
   */
  shutdownTimeout?: number;

  /**
   * Enable parallel plugin initialization
   */
  parallelInitialization?: boolean;

  /**
   * Enable strict dependency checking
   */
  strictDependencies?: boolean;

  /**
   * Enable health checks
   */
  enableHealthChecks?: boolean;

  /**
   * Health check interval (ms)
   */
  healthCheckInterval?: number;
}

/**
 * Default plugin loader configuration
 */
const DEFAULT_CONFIG: Required<PluginLoaderConfig> = {
  initializationTimeout: 30000, // 30 seconds
  shutdownTimeout: 10000, // 10 seconds
  parallelInitialization: false, // Sequential by default for safety
  strictDependencies: true,
  enableHealthChecks: false,
  healthCheckInterval: 60000, // 1 minute
};

/**
 * Plugin dependency graph node
 */
interface DependencyNode {
  plugin: ClaudeFlowPlugin;
  dependencies: Set<string>;
  dependents: Set<string>;
  depth: number;
}

/**
 * Plugin loader for managing plugin lifecycle
 */
export class PluginLoader {
  private config: Required<PluginLoaderConfig>;
  private registry: PluginRegistry;
  private initializationOrder: string[] = [];
  private healthCheckIntervalId?: NodeJS.Timeout;

  constructor(registry: PluginRegistry, config?: PluginLoaderConfig) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load a single plugin
   */
  async loadPlugin(plugin: ClaudeFlowPlugin, context: PluginContext): Promise<void> {
    // Validate plugin
    this.validatePlugin(plugin);

    // Check for duplicates
    if (this.registry.hasPlugin(plugin.name)) {
      throw new PluginError(
        `Plugin '${plugin.name}' is already loaded`,
        plugin.name,
        'DUPLICATE_PLUGIN'
      );
    }

    // Register plugin in uninitialized state
    this.registry.registerPlugin(plugin, 'uninitialized', context);

    // Resolve dependencies
    if (this.config.strictDependencies) {
      this.validateDependencies(plugin);
    }

    // Initialize plugin
    await this.initializePlugin(plugin, context);

    // Update initialization order
    this.initializationOrder.push(plugin.name);
  }

  /**
   * Load multiple plugins with dependency resolution
   */
  async loadPlugins(
    plugins: ClaudeFlowPlugin[],
    context: PluginContext
  ): Promise<LoadPluginsResult> {
    const results: LoadPluginsResult = {
      successful: [],
      failed: [],
      totalDuration: 0,
    };

    const startTime = Date.now();

    try {
      // Validate all plugins first
      for (const plugin of plugins) {
        this.validatePlugin(plugin);
      }

      // Build dependency graph
      const dependencyGraph = this.buildDependencyGraph(plugins);

      // Detect circular dependencies
      this.detectCircularDependencies(dependencyGraph);

      // Sort plugins by dependency order (topological sort)
      const sortedPlugins = this.topologicalSort(dependencyGraph);

      // Initialize plugins in order
      if (this.config.parallelInitialization) {
        await this.initializePluginsParallel(sortedPlugins, context, results);
      } else {
        await this.initializePluginsSequential(sortedPlugins, context, results);
      }
    } catch (error) {
      // If error during setup, mark all as failed
      for (const plugin of plugins) {
        if (!results.successful.includes(plugin.name) && !results.failed.some((f) => f.name === plugin.name)) {
          results.failed.push({
            name: plugin.name,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } finally {
      results.totalDuration = Date.now() - startTime;
    }

    // Start health checks if enabled
    if (this.config.enableHealthChecks) {
      this.startHealthChecks();
    }

    return results;
  }

  /**
   * Unload a single plugin
   */
  async unloadPlugin(pluginName: string): Promise<void> {
    const pluginInfo = this.registry.getPlugin(pluginName);
    if (!pluginInfo) {
      throw new PluginError(
        `Plugin '${pluginName}' not found`,
        pluginName,
        'INVALID_PLUGIN'
      );
    }

    // Check for dependents
    const dependents = this.findDependents(pluginName);
    if (dependents.length > 0) {
      throw new PluginError(
        `Cannot unload plugin '${pluginName}': depended on by ${dependents.join(', ')}`,
        pluginName,
        'DEPENDENCY_NOT_FOUND'
      );
    }

    // Shutdown plugin
    await this.shutdownPlugin(pluginInfo.plugin);

    // Unregister plugin
    this.registry.unregisterPlugin(pluginName);

    // Remove from initialization order
    const index = this.initializationOrder.indexOf(pluginName);
    if (index !== -1) {
      this.initializationOrder.splice(index, 1);
    }
  }

  /**
   * Unload all plugins in reverse initialization order
   */
  async unloadAll(): Promise<void> {
    // Stop health checks
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = undefined;
    }

    // Shutdown in reverse order
    const pluginsToShutdown = [...this.initializationOrder].reverse();

    for (const pluginName of pluginsToShutdown) {
      try {
        await this.unloadPlugin(pluginName);
      } catch (error) {
        // Log error but continue shutting down other plugins
        console.error(`Error unloading plugin '${pluginName}':`, error);
      }
    }

    this.initializationOrder = [];
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginName: string, newPlugin: ClaudeFlowPlugin, context: PluginContext): Promise<void> {
    await this.unloadPlugin(pluginName);
    await this.loadPlugin(newPlugin, context);
  }

  /**
   * Get plugin initialization order
   */
  getInitializationOrder(): string[] {
    return [...this.initializationOrder];
  }

  /**
   * Validate plugin interface
   */
  private validatePlugin(plugin: ClaudeFlowPlugin): void {
    if (!plugin.name) {
      throw new PluginError(
        'Plugin must have a name',
        '<unknown>',
        'INVALID_PLUGIN'
      );
    }

    if (!plugin.version) {
      throw new PluginError(
        `Plugin '${plugin.name}' must have a version`,
        plugin.name,
        'INVALID_PLUGIN'
      );
    }

    if (typeof plugin.initialize !== 'function') {
      throw new PluginError(
        `Plugin '${plugin.name}' must implement initialize()`,
        plugin.name,
        'INVALID_PLUGIN'
      );
    }

    if (typeof plugin.shutdown !== 'function') {
      throw new PluginError(
        `Plugin '${plugin.name}' must implement shutdown()`,
        plugin.name,
        'INVALID_PLUGIN'
      );
    }
  }

  /**
   * Validate plugin dependencies
   */
  private validateDependencies(plugin: ClaudeFlowPlugin): void {
    if (!plugin.dependencies || plugin.dependencies.length === 0) {
      return;
    }

    for (const dep of plugin.dependencies) {
      if (!this.registry.hasPlugin(dep)) {
        throw new PluginError(
          `Plugin '${plugin.name}' depends on '${dep}' which is not loaded`,
          plugin.name,
          'DEPENDENCY_NOT_FOUND'
        );
      }

      // Check dependency is initialized
      const depInfo = this.registry.getPlugin(dep);
      if (depInfo && depInfo.state !== 'initialized') {
        throw new PluginError(
          `Plugin '${plugin.name}' depends on '${dep}' which is not initialized (state: ${depInfo.state})`,
          plugin.name,
          'DEPENDENCY_NOT_FOUND'
        );
      }
    }
  }

  /**
   * Initialize a single plugin
   */
  private async initializePlugin(plugin: ClaudeFlowPlugin, context: PluginContext): Promise<void> {
    this.registry.updatePluginState(plugin.name, 'initializing');

    try {
      // Run initialization with timeout
      await this.withTimeout(
        plugin.initialize(context),
        this.config.initializationTimeout,
        `Plugin '${plugin.name}' initialization timed out`
      );

      this.registry.updatePluginState(plugin.name, 'initialized');
      this.registry.collectPluginMetrics(plugin.name);
    } catch (error) {
      this.registry.updatePluginState(plugin.name, 'error', error instanceof Error ? error : new Error(String(error)));
      throw new PluginError(
        `Failed to initialize plugin '${plugin.name}': ${error}`,
        plugin.name,
        'INITIALIZATION_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Shutdown a single plugin
   */
  private async shutdownPlugin(plugin: ClaudeFlowPlugin): Promise<void> {
    this.registry.updatePluginState(plugin.name, 'shutting-down');

    try {
      await this.withTimeout(
        plugin.shutdown(),
        this.config.shutdownTimeout,
        `Plugin '${plugin.name}' shutdown timed out`
      );

      this.registry.updatePluginState(plugin.name, 'shutdown');
    } catch (error) {
      this.registry.updatePluginState(plugin.name, 'error', error instanceof Error ? error : new Error(String(error)));
      throw new PluginError(
        `Failed to shutdown plugin '${plugin.name}': ${error}`,
        plugin.name,
        'SHUTDOWN_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Initialize plugins sequentially
   */
  private async initializePluginsSequential(
    plugins: ClaudeFlowPlugin[],
    context: PluginContext,
    results: LoadPluginsResult
  ): Promise<void> {
    for (const plugin of plugins) {
      try {
        // Register and initialize
        this.registry.registerPlugin(plugin, 'uninitialized', context);
        await this.initializePlugin(plugin, context);

        results.successful.push(plugin.name);
        this.initializationOrder.push(plugin.name);
      } catch (error) {
        results.failed.push({
          name: plugin.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });

        // Stop on first failure in sequential mode if strict
        if (this.config.strictDependencies) {
          break;
        }
      }
    }
  }

  /**
   * Initialize plugins in parallel (by dependency level)
   */
  private async initializePluginsParallel(
    plugins: ClaudeFlowPlugin[],
    context: PluginContext,
    results: LoadPluginsResult
  ): Promise<void> {
    // Group plugins by dependency depth
    const dependencyGraph = this.buildDependencyGraph(plugins);
    const levels = this.groupByDepth(dependencyGraph);

    // Initialize each level in parallel
    for (const level of levels) {
      const promises = level.map(async (plugin) => {
        try {
          this.registry.registerPlugin(plugin, 'uninitialized', context);
          await this.initializePlugin(plugin, context);

          results.successful.push(plugin.name);
          this.initializationOrder.push(plugin.name);
        } catch (error) {
          results.failed.push({
            name: plugin.name,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

      await Promise.all(promises);

      // Stop on failures in level if strict
      if (this.config.strictDependencies && results.failed.length > 0) {
        break;
      }
    }
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(plugins: ClaudeFlowPlugin[]): Map<string, DependencyNode> {
    const graph = new Map<string, DependencyNode>();

    // Create nodes
    for (const plugin of plugins) {
      graph.set(plugin.name, {
        plugin,
        dependencies: new Set(plugin.dependencies || []),
        dependents: new Set(),
        depth: 0,
      });
    }

    // Build dependency links
    for (const [name, node] of Array.from(graph.entries())) {
      for (const dep of Array.from(node.dependencies)) {
        const depNode = graph.get(dep);
        if (depNode) {
          depNode.dependents.add(name);
        }
      }
    }

    // Calculate depths
    this.calculateDepths(graph);

    return graph;
  }

  /**
   * Calculate depth of each node (for topological sorting)
   */
  private calculateDepths(graph: Map<string, DependencyNode>): void {
    const visited = new Set<string>();

    const visit = (name: string): number => {
      if (visited.has(name)) {
        const node = graph.get(name);
        return node ? node.depth : 0;
      }

      visited.add(name);
      const node = graph.get(name);
      if (!node) return 0;

      let maxDepth = 0;
      for (const dep of Array.from(node.dependencies)) {
        maxDepth = Math.max(maxDepth, visit(dep) + 1);
      }

      node.depth = maxDepth;
      return maxDepth;
    };

    for (const name of Array.from(graph.keys())) {
      visit(name);
    }
  }

  /**
   * Topological sort (dependency order)
   */
  private topologicalSort(graph: Map<string, DependencyNode>): ClaudeFlowPlugin[] {
    const sorted: ClaudeFlowPlugin[] = [];
    const nodes = Array.from(graph.values());

    // Sort by depth (dependencies first)
    nodes.sort((a, b) => a.depth - b.depth);

    for (const node of nodes) {
      sorted.push(node.plugin);
    }

    return sorted;
  }

  /**
   * Group plugins by dependency depth (for parallel initialization)
   */
  private groupByDepth(graph: Map<string, DependencyNode>): ClaudeFlowPlugin[][] {
    const levels: ClaudeFlowPlugin[][] = [];
    const maxDepth = Math.max(...Array.from(graph.values()).map((n) => n.depth));

    for (let depth = 0; depth <= maxDepth; depth++) {
      const level: ClaudeFlowPlugin[] = [];
      for (const node of Array.from(graph.values())) {
        if (node.depth === depth) {
          level.push(node.plugin);
        }
      }
      if (level.length > 0) {
        levels.push(level);
      }
    }

    return levels;
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(graph: Map<string, DependencyNode>): void {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (name: string, path: string[]): void => {
      if (stack.has(name)) {
        const cycle = [...path, name];
        throw new PluginError(
          `Circular dependency detected: ${cycle.join(' -> ')}`,
          name,
          'CIRCULAR_DEPENDENCY'
        );
      }

      if (visited.has(name)) {
        return;
      }

      visited.add(name);
      stack.add(name);

      const node = graph.get(name);
      if (node) {
        for (const dep of Array.from(node.dependencies)) {
          visit(dep, [...path, name]);
        }
      }

      stack.delete(name);
    };

    for (const name of Array.from(graph.keys())) {
      visit(name, []);
    }
  }

  /**
   * Find plugins that depend on a given plugin
   */
  private findDependents(pluginName: string): string[] {
    const dependents: string[] = [];

    for (const [name, info] of Array.from(this.registry.getAllPlugins().entries())) {
      if (info.plugin.dependencies?.includes(pluginName)) {
        dependents.push(name);
      }
    }

    return dependents;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckIntervalId = setInterval(async () => {
      for (const [name, info] of Array.from(this.registry.getAllPlugins().entries())) {
        if (info.state === 'initialized' && info.plugin.healthCheck) {
          try {
            const healthy = await info.plugin.healthCheck();
            if (!healthy) {
              console.warn(`Plugin '${name}' health check failed`);
              this.registry.updatePluginState(name, 'error', new Error('Health check failed'));
            }
          } catch (error) {
            console.error(`Plugin '${name}' health check error:`, error);
            this.registry.updatePluginState(name, 'error', error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Utility: Run promise with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }
}

/**
 * Load plugins result
 */
export interface LoadPluginsResult {
  successful: string[];
  failed: Array<{ name: string; error: Error }>;
  totalDuration: number;
}
