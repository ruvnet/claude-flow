/**
 * Plugin Interface and Base Implementation
 *
 * Defines the plugin contract for V3 extensibility per ADR-004.
 */

import type {
  Plugin as IPlugin,
  ExtensionPoint,
  PluginMetadata
} from '../../shared/types';

export interface Plugin extends IPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  priority?: number;
  dependencies?: string[];
  configSchema?: Record<string, unknown>;
  minCoreVersion?: string;
  maxCoreVersion?: string;
  initialize(config?: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
  getExtensionPoints(): ExtensionPoint[];
}

export { ExtensionPoint };

/**
 * Abstract base class for plugins
 */
export abstract class BasePlugin implements Plugin {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public description?: string;
  public author?: string;
  public homepage?: string;
  public priority?: number;
  public dependencies?: string[];
  public configSchema?: Record<string, unknown>;
  public minCoreVersion?: string;
  public maxCoreVersion?: string;

  protected config?: Record<string, unknown>;
  protected extensionPoints: ExtensionPoint[] = [];

  constructor(metadata: PluginMetadata) {
    this.id = metadata.id;
    this.name = metadata.name;
    this.version = metadata.version;
    this.description = metadata.description;
    this.author = metadata.author;
    this.homepage = metadata.homepage;
  }

  /**
   * Initialize the plugin with optional configuration
   */
  async initialize(config?: Record<string, unknown>): Promise<void> {
    this.config = config;
    await this.onInitialize();
  }

  /**
   * Shutdown the plugin and release resources
   */
  async shutdown(): Promise<void> {
    await this.onShutdown();
  }

  /**
   * Get all extension points registered by this plugin
   */
  getExtensionPoints(): ExtensionPoint[] {
    return this.extensionPoints;
  }

  /**
   * Register an extension point
   */
  protected registerExtensionPoint(
    name: string,
    handler: (context: unknown) => Promise<unknown>,
    priority?: number
  ): void {
    this.extensionPoints.push({ name, handler, priority });
  }

  /**
   * Get plugin metadata
   */
  getMetadata(): PluginMetadata {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      homepage: this.homepage
    };
  }

  /**
   * Override in subclass for custom initialization
   */
  protected async onInitialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Override in subclass for custom shutdown
   */
  protected async onShutdown(): Promise<void> {
    // Default: no-op
  }
}

export { BasePlugin as default };
