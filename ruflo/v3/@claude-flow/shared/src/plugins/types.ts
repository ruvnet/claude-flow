/**
 * Plugin Types - ADR-004 Implementation
 *
 * Type definitions for the plugin system.
 *
 * @module v3/shared/plugins/types
 */

import type { HookRegistry } from '../hooks/index.js';

/**
 * Plugin configuration base
 */
export interface PluginConfig {
  enabled: boolean;
  [key: string]: unknown;
}

/**
 * Plugin context provided during initialization
 */
export interface PluginContext {
  hooks?: HookRegistry;
  services?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

/**
 * Plugin lifecycle events
 */
export type PluginEvent = 'initialized' | 'shutdown' | 'error';

/**
 * Plugin event handler
 */
export type PluginEventHandler = (event: PluginEvent, data?: unknown) => void;

/**
 * Claude Flow Plugin Interface
 *
 * All plugins must implement this interface.
 */
export interface ClaudeFlowPlugin {
  /** Unique plugin identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Plugin version */
  readonly version: string;

  /** Plugin description */
  readonly description: string;

  /** Dependencies on other plugins */
  readonly dependencies?: string[];

  /**
   * Initialize the plugin
   * @param context Plugin context with hooks and services
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Shutdown the plugin
   */
  shutdown(): Promise<void>;

  /**
   * Optional event handler
   */
  onEvent?: PluginEventHandler;
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  dependencies?: string[];
}

/**
 * Plugin registry
 */
export interface IPluginRegistry {
  register(plugin: ClaudeFlowPlugin): void;
  unregister(pluginId: string): void;
  get(pluginId: string): ClaudeFlowPlugin | undefined;
  getAll(): ClaudeFlowPlugin[];
  isRegistered(pluginId: string): boolean;
}

/**
 * Plugin loader interface
 */
export interface IPluginLoader {
  loadFromPath(path: string): Promise<ClaudeFlowPlugin>;
  loadFromPackage(packageName: string): Promise<ClaudeFlowPlugin>;
  loadBuiltin(pluginId: string): Promise<ClaudeFlowPlugin>;
}
