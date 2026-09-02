/**
 * PluginManager
 *
 * Manages plugin lifecycle, dependencies, and extension point invocation.
 * Per ADR-004: Plugin-based architecture (microkernel pattern).
 */

import { EventEmitter } from 'events';
import type {
  Plugin,
  ExtensionPoint,
  PluginMetadata,
  PluginManagerInterface
} from '../../shared/types';
import { PluginError } from '../../shared/types';

export interface PluginManagerOptions {
  eventBus?: EventEmitter;
  coreVersion?: string;
}

export class PluginManager implements PluginManagerInterface {
  private plugins: Map<string, Plugin>;
  private extensionPoints: Map<string, Array<{ pluginId: string; handler: ExtensionPoint['handler']; priority: number }>>;
  private eventBus: EventEmitter;
  private coreVersion: string;
  private initialized: boolean = false;

  constructor(options: PluginManagerOptions = {}) {
    this.plugins = new Map();
    this.extensionPoints = new Map();
    this.eventBus = options.eventBus || new EventEmitter();
    this.coreVersion = options.coreVersion || '3.0.0';
  }

  /**
   * Initialize the plugin manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Shutdown the plugin manager and all plugins
   */
  async shutdown(): Promise<void> {
    // Shutdown plugins in reverse order of loading
    const pluginIds = Array.from(this.plugins.keys()).reverse();
    for (const pluginId of pluginIds) {
      await this.unloadPlugin(pluginId);
    }
    this.extensionPoints.clear();
    this.initialized = false;
  }

  /**
   * Load and initialize a plugin
   */
  async loadPlugin(plugin: Plugin, config?: Record<string, unknown>): Promise<void> {
    // Check if already loaded
    if (this.plugins.has(plugin.id)) {
      await this.unloadPlugin(plugin.id);
    }

    // Validate configuration if schema provided
    if (plugin.configSchema && config) {
      this.validateConfig(plugin.configSchema, config);
    }

    // Check version compatibility
    if (plugin.minCoreVersion || plugin.maxCoreVersion) {
      this.checkVersionCompatibility(plugin);
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const depId of plugin.dependencies) {
        if (!this.plugins.has(depId)) {
          throw new PluginError(
            `Plugin ${plugin.id} depends on ${depId} which is not loaded`,
            { pluginId: plugin.id, dependency: depId }
          );
        }
      }
    }

    // Initialize plugin
    await plugin.initialize(config);

    // Register plugin
    this.plugins.set(plugin.id, plugin);

    // Register extension points
    const extensionPoints = plugin.getExtensionPoints();
    for (const ep of extensionPoints) {
      this.registerExtensionPoint(plugin.id, ep);
    }

    // Emit event
    this.eventBus.emit('plugin:loaded', { id: plugin.id, name: plugin.name });
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    // Check if other plugins depend on this one
    for (const [otherId, other] of this.plugins.entries()) {
      if (other.dependencies?.includes(pluginId)) {
        throw new PluginError(
          `Cannot unload ${pluginId}: plugin ${otherId} depends on it`,
          { pluginId, dependentPluginId: otherId }
        );
      }
    }

    // Shutdown plugin
    await plugin.shutdown();

    // Remove extension points
    for (const [name, handlers] of this.extensionPoints.entries()) {
      this.extensionPoints.set(
        name,
        handlers.filter(h => h.pluginId !== pluginId)
      );
    }

    // Remove plugin
    this.plugins.delete(pluginId);

    // Emit event
    this.eventBus.emit('plugin:unloaded', { id: pluginId });
  }

  /**
   * Reload a plugin with new version
   */
  async reloadPlugin(pluginId: string, plugin: Plugin): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this.loadPlugin(plugin);
  }

  /**
   * List all loaded plugins
   */
  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin metadata
   */
  getPluginMetadata(pluginId: string): PluginMetadata | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;

    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      homepage: plugin.homepage
    };
  }

  /**
   * Invoke all handlers for an extension point
   */
  async invokeExtensionPoint(name: string, context: unknown): Promise<unknown[]> {
    const handlers = this.extensionPoints.get(name) || [];

    // Sort by priority (higher first)
    const sorted = [...handlers].sort((a, b) => b.priority - a.priority);

    const results: unknown[] = [];
    for (const { handler, pluginId } of sorted) {
      try {
        const result = await handler(context);
        results.push(result);
      } catch (error) {
        // Include error in results but continue with other handlers
        results.push({
          error: error instanceof Error ? error.message : String(error),
          pluginId
        });
      }
    }

    return results;
  }

  /**
   * Get the core version
   */
  getCoreVersion(): string {
    return this.coreVersion;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private registerExtensionPoint(pluginId: string, ep: ExtensionPoint): void {
    const handlers = this.extensionPoints.get(ep.name) || [];
    handlers.push({
      pluginId,
      handler: ep.handler,
      priority: ep.priority || 0
    });
    this.extensionPoints.set(ep.name, handlers);
  }

  private validateConfig(schema: Record<string, unknown>, config: Record<string, unknown>): void {
    // Simple validation - check required fields
    const required = (schema as any).required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in config)) {
          throw new PluginError(
            `Missing required configuration field: ${field}`,
            { field, validation: 'required' }
          );
        }
      }
    }
  }

  private checkVersionCompatibility(plugin: Plugin): void {
    const coreVersion = this.parseVersion(this.coreVersion);

    if (plugin.minCoreVersion) {
      const minVersion = this.parseVersion(plugin.minCoreVersion);
      if (this.compareVersions(coreVersion, minVersion) < 0) {
        throw new PluginError(
          `Plugin ${plugin.id} requires core version >= ${plugin.minCoreVersion}, but core version is ${this.coreVersion}`,
          { pluginId: plugin.id, minVersion: plugin.minCoreVersion, coreVersion: this.coreVersion }
        );
      }
    }

    if (plugin.maxCoreVersion) {
      const maxVersion = this.parseVersion(plugin.maxCoreVersion);
      if (this.compareVersions(coreVersion, maxVersion) > 0) {
        throw new PluginError(
          `Plugin ${plugin.id} requires core version <= ${plugin.maxCoreVersion}, but core version is ${this.coreVersion}`,
          { pluginId: plugin.id, maxVersion: plugin.maxCoreVersion, coreVersion: this.coreVersion }
        );
      }
    }
  }

  private parseVersion(version: string): number[] {
    return version.split('.').map(n => parseInt(n, 10) || 0);
  }

  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
}

export { PluginManager as default };
