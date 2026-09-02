/**
 * Plugin SDK - Unified API for Claude Flow Plugin Development
 *
 * Provides a comprehensive SDK for building plugins with full access to:
 * - Plugin lifecycle management
 * - Worker capabilities
 * - Hook system
 * - Memory backends (AgentDB integration)
 * - LLM providers
 * - MCP tools
 */

import {
  HookEvent,
  HookPriority,
  type PluginMetadata,
  type PluginContext,
  type PluginConfig,
  type ILogger,
  type IEventBus,
  type ServiceContainer,
  type AgentTypeDefinition,
  type TaskTypeDefinition,
  type MCPToolDefinition,
  type CLICommandDefinition,
  type MemoryBackendFactory,
  type HookDefinition,
  type HookHandler,
  type WorkerDefinition,
  type WorkerType,
  type LLMProviderDefinition,
  type HealthCheckResult,
  type JSONSchema,
} from '../types/index.js';
import { BasePlugin, createSimplePlugin } from '../core/base-plugin.js';
import type { IPlugin, PluginFactory } from '../core/plugin-interface.js';
import { validatePlugin, validatePluginMetadata, PLUGIN_EVENTS } from '../core/plugin-interface.js';
import { PluginRegistry, getDefaultRegistry, setDefaultRegistry } from '../registry/plugin-registry.js';

// ============================================================================
// SDK Builder Pattern
// ============================================================================

/**
 * Plugin builder for fluent plugin creation.
 *
 * @example
 * ```typescript
 * const myPlugin = new PluginBuilder('my-plugin', '1.0.0')
 *   .withDescription('My awesome plugin')
 *   .withMCPTools([{
 *     name: 'my-tool',
 *     description: 'Does something useful',
 *     inputSchema: { type: 'object', properties: {} },
 *     handler: async (input) => ({ content: [{ type: 'text', text: 'Done!' }] })
 *   }])
 *   .withHooks([{
 *     event: HookEvent.PostTaskComplete,
 *     handler: async (ctx) => ({ success: true })
 *   }])
 *   .onInitialize(async (ctx) => {
 *     console.log('Plugin initialized!');
 *   })
 *   .build();
 * ```
 */
export class PluginBuilder {
  private metadata: PluginMetadata;
  private agentTypes: AgentTypeDefinition[] = [];
  private taskTypes: TaskTypeDefinition[] = [];
  private mcpTools: MCPToolDefinition[] = [];
  private cliCommands: CLICommandDefinition[] = [];
  private hooks: HookDefinition[] = [];
  private workers: WorkerDefinition[] = [];
  private providers: LLMProviderDefinition[] = [];
  private initHandler?: (context: PluginContext) => Promise<void>;
  private shutdownHandler?: () => Promise<void>;

  constructor(name: string, version: string) {
    this.metadata = { name, version };
  }

  // =========================================================================
  // Metadata Configuration
  // =========================================================================

  withDescription(description: string): this {
    this.metadata = { ...this.metadata, description };
    return this;
  }

  withAuthor(author: string): this {
    this.metadata = { ...this.metadata, author };
    return this;
  }

  withLicense(license: string): this {
    this.metadata = { ...this.metadata, license };
    return this;
  }

  withRepository(repository: string): this {
    this.metadata = { ...this.metadata, repository };
    return this;
  }

  withDependencies(dependencies: string[]): this {
    this.metadata = { ...this.metadata, dependencies };
    return this;
  }

  withTags(tags: string[]): this {
    this.metadata = { ...this.metadata, tags };
    return this;
  }

  withMinCoreVersion(minCoreVersion: string): this {
    this.metadata = { ...this.metadata, minCoreVersion };
    return this;
  }

  // =========================================================================
  // Extension Points
  // =========================================================================

  withAgentTypes(types: AgentTypeDefinition[]): this {
    this.agentTypes.push(...types);
    return this;
  }

  withTaskTypes(types: TaskTypeDefinition[]): this {
    this.taskTypes.push(...types);
    return this;
  }

  withMCPTools(tools: MCPToolDefinition[]): this {
    this.mcpTools.push(...tools);
    return this;
  }

  withCLICommands(commands: CLICommandDefinition[]): this {
    this.cliCommands.push(...commands);
    return this;
  }

  withHooks(hooks: HookDefinition[]): this {
    this.hooks.push(...hooks);
    return this;
  }

  withWorkers(workers: WorkerDefinition[]): this {
    this.workers.push(...workers);
    return this;
  }

  withProviders(providers: LLMProviderDefinition[]): this {
    this.providers.push(...providers);
    return this;
  }

  // =========================================================================
  // Lifecycle Handlers
  // =========================================================================

  onInitialize(handler: (context: PluginContext) => Promise<void>): this {
    this.initHandler = handler;
    return this;
  }

  onShutdown(handler: () => Promise<void>): this {
    this.shutdownHandler = handler;
    return this;
  }

  // =========================================================================
  // Build
  // =========================================================================

  build(): IPlugin {
    return createSimplePlugin({
      metadata: this.metadata,
      onInitialize: this.initHandler,
      onShutdown: this.shutdownHandler,
      agentTypes: this.agentTypes.length > 0 ? this.agentTypes : undefined,
      taskTypes: this.taskTypes.length > 0 ? this.taskTypes : undefined,
      mcpTools: this.mcpTools.length > 0 ? this.mcpTools : undefined,
      cliCommands: this.cliCommands.length > 0 ? this.cliCommands : undefined,
      hooks: this.hooks.length > 0 ? this.hooks : undefined,
      workers: this.workers.length > 0 ? this.workers : undefined,
      providers: this.providers.length > 0 ? this.providers : undefined,
    });
  }

  /**
   * Build and automatically register with the default registry.
   */
  async buildAndRegister(config?: Partial<PluginConfig>): Promise<IPlugin> {
    const plugin = this.build();
    await getDefaultRegistry().register(plugin, config);
    return plugin;
  }
}

// ============================================================================
// Quick Plugin Creation Helpers
// ============================================================================

/**
 * Create a tool-only plugin quickly.
 */
export function createToolPlugin(
  name: string,
  version: string,
  tools: MCPToolDefinition[]
): IPlugin {
  return new PluginBuilder(name, version)
    .withMCPTools(tools)
    .build();
}

/**
 * Create a hooks-only plugin quickly.
 */
export function createHooksPlugin(
  name: string,
  version: string,
  hooks: HookDefinition[]
): IPlugin {
  return new PluginBuilder(name, version)
    .withHooks(hooks)
    .build();
}

/**
 * Create a worker plugin quickly.
 */
export function createWorkerPlugin(
  name: string,
  version: string,
  workers: WorkerDefinition[]
): IPlugin {
  return new PluginBuilder(name, version)
    .withWorkers(workers)
    .build();
}

/**
 * Create a provider plugin quickly.
 */
export function createProviderPlugin(
  name: string,
  version: string,
  providers: LLMProviderDefinition[]
): IPlugin {
  return new PluginBuilder(name, version)
    .withProviders(providers)
    .build();
}

// ============================================================================
// Tool Builder
// ============================================================================

/**
 * Builder for creating MCP tools with validation.
 */
export class MCPToolBuilder {
  private name: string;
  private description: string = '';
  private properties: Record<string, JSONSchema> = {};
  private required: string[] = [];
  private handler?: MCPToolDefinition['handler'];

  constructor(name: string) {
    this.name = name;
  }

  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  addStringParam(
    name: string,
    description: string,
    options?: { required?: boolean; default?: string; enum?: string[] }
  ): this {
    this.properties[name] = {
      type: 'string',
      description,
      default: options?.default,
      enum: options?.enum,
    };
    if (options?.required) {
      this.required.push(name);
    }
    return this;
  }

  addNumberParam(
    name: string,
    description: string,
    options?: { required?: boolean; default?: number; minimum?: number; maximum?: number }
  ): this {
    this.properties[name] = {
      type: 'number',
      description,
      default: options?.default,
      minimum: options?.minimum,
      maximum: options?.maximum,
    };
    if (options?.required) {
      this.required.push(name);
    }
    return this;
  }

  addBooleanParam(
    name: string,
    description: string,
    options?: { required?: boolean; default?: boolean }
  ): this {
    this.properties[name] = {
      type: 'boolean',
      description,
      default: options?.default,
    };
    if (options?.required) {
      this.required.push(name);
    }
    return this;
  }

  addObjectParam(
    name: string,
    description: string,
    schema: JSONSchema,
    options?: { required?: boolean }
  ): this {
    this.properties[name] = {
      ...schema,
      description,
    };
    if (options?.required) {
      this.required.push(name);
    }
    return this;
  }

  addArrayParam(
    name: string,
    description: string,
    itemsSchema: JSONSchema,
    options?: { required?: boolean }
  ): this {
    this.properties[name] = {
      type: 'array',
      description,
      items: itemsSchema,
    };
    if (options?.required) {
      this.required.push(name);
    }
    return this;
  }

  withHandler(handler: MCPToolDefinition['handler']): this {
    this.handler = handler;
    return this;
  }

  build(): MCPToolDefinition {
    if (!this.handler) {
      throw new Error(`Tool ${this.name} requires a handler`);
    }

    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: this.properties,
        required: this.required.length > 0 ? this.required : undefined,
      },
      handler: this.handler,
    };
  }
}

// ============================================================================
// Hook Builder
// ============================================================================

/**
 * Builder for creating hooks with validation.
 */
export class HookBuilder {
  private event: HookEvent;
  private name?: string;
  private description?: string;
  private priority: HookPriority = HookPriority.Normal;
  private async: boolean = true;
  private handler?: HookHandler;

  constructor(event: HookEvent) {
    this.event = event;
  }

  withName(name: string): this {
    this.name = name;
    return this;
  }

  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  withPriority(priority: HookPriority): this {
    this.priority = priority;
    return this;
  }

  synchronous(): this {
    this.async = false;
    return this;
  }

  withHandler(handler: HookHandler): this {
    this.handler = handler;
    return this;
  }

  build(): HookDefinition {
    if (!this.handler) {
      throw new Error(`Hook for event ${this.event} requires a handler`);
    }

    return {
      event: this.event,
      handler: this.handler,
      priority: this.priority,
      name: this.name,
      description: this.description,
      async: this.async,
    };
  }
}

// ============================================================================
// Worker Builder
// ============================================================================

/**
 * Builder for creating workers with validation.
 */
export class WorkerBuilder {
  private type: WorkerType;
  private name: string;
  private description?: string;
  private capabilities: string[] = [];
  private specialization?: Float32Array;
  private maxConcurrentTasks: number = 5;
  private timeout: number = 30000;
  private priority: number = 50;
  private metadata: Record<string, unknown> = {};

  constructor(type: WorkerType, name: string) {
    this.type = type;
    this.name = name;
  }

  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  withCapabilities(capabilities: string[]): this {
    this.capabilities.push(...capabilities);
    return this;
  }

  withSpecialization(vector: Float32Array): this {
    this.specialization = vector;
    return this;
  }

  withMaxConcurrentTasks(max: number): this {
    this.maxConcurrentTasks = max;
    return this;
  }

  withTimeout(timeout: number): this {
    this.timeout = timeout;
    return this;
  }

  withPriority(priority: number): this {
    this.priority = priority;
    return this;
  }

  withMetadata(metadata: Record<string, unknown>): this {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  build(): WorkerDefinition {
    return {
      type: this.type,
      name: this.name,
      description: this.description,
      capabilities: this.capabilities,
      specialization: this.specialization,
      maxConcurrentTasks: this.maxConcurrentTasks,
      timeout: this.timeout,
      priority: this.priority,
      metadata: Object.keys(this.metadata).length > 0 ? this.metadata : undefined,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

// Re-export core types and interfaces
export {
  // Types
  type PluginMetadata,
  type PluginContext,
  type PluginConfig,
  type ILogger,
  type IEventBus,
  type ServiceContainer,
  type AgentTypeDefinition,
  type TaskTypeDefinition,
  type MCPToolDefinition,
  type CLICommandDefinition,
  type MemoryBackendFactory,
  type HookDefinition,
  type HookHandler,
  type WorkerDefinition,
  type LLMProviderDefinition,
  type HealthCheckResult,
  type JSONSchema,
  HookEvent,
  HookPriority,
  type WorkerType,
  // Plugin interface
  type IPlugin,
  type PluginFactory,
  validatePlugin,
  validatePluginMetadata,
  PLUGIN_EVENTS,
  // Base plugin
  BasePlugin,
  createSimplePlugin,
  // Registry
  PluginRegistry,
  getDefaultRegistry,
  setDefaultRegistry,
};
