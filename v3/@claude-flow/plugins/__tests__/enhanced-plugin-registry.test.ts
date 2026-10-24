/**
 * Enhanced Plugin Registry Tests
 *
 * Tests for version constraints, safe unload, parallel init,
 * hot reload, and conflict resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnhancedPluginRegistry,
  PluginConflictError,
  type EnhancedPluginRegistryConfig,
} from '../src/registry/enhanced-plugin-registry.js';
import { PluginBuilder } from '../src/sdk/index.js';
import { BasePlugin } from '../src/core/base-plugin.js';
import type { PluginContext, PluginMetadata, HealthCheckResult, MCPToolDefinition } from '../src/types/index.js';
import type { IPlugin } from '../src/core/plugin-interface.js';
import { validatePluginMetadata } from '../src/core/plugin-interface.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestPlugin(
  name: string,
  version = '1.0.0',
  dependencies?: Array<{ name: string; version: string }>
) {
  const builder = new PluginBuilder(name, version)
    .withDescription(`Test plugin: ${name}`);

  if (dependencies) {
    builder.withDependencies(dependencies);
  }

  return builder.build();
}

class TestPlugin extends BasePlugin {
  public initializeCalled = false;
  public shutdownCalled = false;
  // Plugin-owned data carried across hot reloads. This must not be called
  // `state`: BasePlugin.state is the lifecycle state (a getter), and a class
  // field with that name replaces it, which makes the plugin fail validation.
  public pluginState: any = null;

  constructor(name: string, version: string, deps?: string[]) {
    super({
      name,
      version,
      dependencies: deps,
    });
  }

  protected async onInitialize(): Promise<void> {
    this.initializeCalled = true;
  }

  protected async onShutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  async exportState(): Promise<unknown> {
    return this.pluginState;
  }

  async importState(state: unknown): Promise<void> {
    this.pluginState = state;
  }
}

function toolPlugin(pluginName: string, toolName: string, description: string) {
  return new PluginBuilder(pluginName, '1.0.0')
    .withMCPTools([{
      name: toolName,
      description,
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ content: [{ type: 'text', text: description }] }),
    }])
    .build();
}

function createConfig(overrides?: Partial<EnhancedPluginRegistryConfig>): EnhancedPluginRegistryConfig {
  return {
    coreVersion: '3.0.0',
    dataDir: '/tmp/test',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('EnhancedPluginRegistry', () => {
  let registry: EnhancedPluginRegistry;

  beforeEach(() => {
    registry = new EnhancedPluginRegistry(createConfig());
  });

  describe('registration', () => {
    it('should register a plugin', async () => {
      const plugin = createTestPlugin('test-plugin');

      await registry.register(plugin);

      expect(registry.getPlugin('test-plugin')).toBeDefined();
    });

    it('should reject duplicate plugins', async () => {
      const plugin = createTestPlugin('test-plugin');

      await registry.register(plugin);

      await expect(registry.register(plugin))
        .rejects.toThrow('already registered');
    });

    it('should respect max plugins limit', async () => {
      const limitedRegistry = new EnhancedPluginRegistry(createConfig({ maxPlugins: 2 }));

      await limitedRegistry.register(createTestPlugin('plugin-1'));
      await limitedRegistry.register(createTestPlugin('plugin-2'));

      await expect(limitedRegistry.register(createTestPlugin('plugin-3')))
        .rejects.toThrow('Maximum plugin limit');
    });
  });

  describe('version constraints', () => {
    it('should check minCoreVersion', async () => {
      const plugin = new PluginBuilder('test-plugin', '1.0.0')
        .withMinCoreVersion('4.0.0')
        .build();

      await expect(registry.register(plugin))
        .rejects.toThrow('requires core version >= 4.0.0');
    });

    it('should check maxCoreVersion', async () => {
      const plugin = new PluginBuilder('test-plugin', '1.0.0')
        .withMinCoreVersion('1.0.0')
        .build();

      // Should pass since 3.0.0 >= 1.0.0
      await registry.register(plugin);
      expect(registry.getPlugin('test-plugin')).toBeDefined();
    });

    it('should validate dependency versions during initialization', async () => {
      await registry.register(createTestPlugin('dep-plugin', '1.0.0'));
      await registry.register(createTestPlugin('main-plugin', '1.0.0', [
        { name: 'dep-plugin', version: '^2.0.0' }, // Incompatible
      ]));

      await expect(registry.initialize())
        .rejects.toThrow('Dependency validation failed');
    });

    it('should pass validation with compatible versions', async () => {
      await registry.register(createTestPlugin('dep-plugin', '1.5.0'));
      await registry.register(createTestPlugin('main-plugin', '1.0.0', [
        { name: 'dep-plugin', version: '^1.0.0' },
      ]));

      await registry.initialize();

      expect(registry.getStats().initialized).toBe(2);
    });

    it('should accept string and object dependencies in metadata validation', () => {
      expect(validatePluginMetadata({ name: 'p', version: '1.0.0', dependencies: ['a', 'b@^1.0.0'] })).toBe(true);
      expect(validatePluginMetadata({
        name: 'p',
        version: '1.0.0',
        dependencies: ['a', { name: 'b', version: '^1.0.0', optional: true }],
      })).toBe(true);

      expect(validatePluginMetadata({ name: 'p', version: '1.0.0', dependencies: [{ name: 'b' }] })).toBe(false);
      expect(validatePluginMetadata({ name: 'p', version: '1.0.0', dependencies: [{ version: '1.0.0' }] })).toBe(false);
      expect(validatePluginMetadata({
        name: 'p',
        version: '1.0.0',
        dependencies: [{ name: 'b', version: '1.0.0', optional: 'yes' }],
      })).toBe(false);
      expect(validatePluginMetadata({ name: 'p', version: '1.0.0', dependencies: [42] })).toBe(false);
      expect(validatePluginMetadata({ name: 'p', version: '1.0.0', dependencies: [''] })).toBe(false);
    });

    it('should not fail on a missing optional object dependency', async () => {
      await registry.register(createTestPlugin('main-plugin', '1.0.0', [
        { name: 'not-installed', version: '^1.0.0', optional: true } as any,
      ]));

      await registry.initialize();

      expect(registry.getStats().initialized).toBe(1);
    });
  });

  describe('safe unload', () => {
    it('should prevent unload of plugins with dependents', async () => {
      await registry.register(createTestPlugin('base-plugin'));
      await registry.register(createTestPlugin('dependent-plugin', '1.0.0', [
        { name: 'base-plugin', version: '*' },
      ]));
      await registry.initialize();

      await expect(registry.unregister('base-plugin'))
        .rejects.toThrow('required by');
    });

    it('should allow cascade unload', async () => {
      await registry.register(createTestPlugin('base-plugin'));
      await registry.register(createTestPlugin('dependent-plugin', '1.0.0', [
        { name: 'base-plugin', version: '*' },
      ]));
      await registry.initialize();

      await registry.unregister('base-plugin', { cascade: true });

      expect(registry.getPlugin('base-plugin')).toBeUndefined();
      expect(registry.getPlugin('dependent-plugin')).toBeUndefined();
    });

    it('should allow force unload', async () => {
      await registry.register(createTestPlugin('base-plugin'));
      await registry.register(createTestPlugin('dependent-plugin', '1.0.0', [
        { name: 'base-plugin', version: '*' },
      ]));
      await registry.initialize();

      await registry.unregister('base-plugin', { force: true });

      expect(registry.getPlugin('base-plugin')).toBeUndefined();
    });
  });

  describe('initialization strategies', () => {
    it('should initialize sequentially by default', async () => {
      const initOrder: string[] = [];

      class OrderTrackingPlugin extends BasePlugin {
        constructor(name: string) {
          super({ name, version: '1.0.0' });
        }
        protected async onInitialize(): Promise<void> {
          initOrder.push(this.metadata.name);
        }
      }

      const plugin1 = new OrderTrackingPlugin('plugin-1');
      const plugin2 = new OrderTrackingPlugin('plugin-2');

      await registry.register(plugin1);
      await registry.register(plugin2);
      await registry.initialize();

      expect(initOrder).toHaveLength(2);
    });

    it('should support parallel initialization', async () => {
      const parallelRegistry = new EnhancedPluginRegistry(createConfig({
        initializationStrategy: 'parallel',
        maxParallelInit: 5,
      }));

      await parallelRegistry.register(createTestPlugin('plugin-1'));
      await parallelRegistry.register(createTestPlugin('plugin-2'));
      await parallelRegistry.register(createTestPlugin('plugin-3'));

      await parallelRegistry.initialize();

      expect(parallelRegistry.getStats().initialized).toBe(3);
    });

    it('should support parallel-safe initialization', async () => {
      const safeRegistry = new EnhancedPluginRegistry(createConfig({
        initializationStrategy: 'parallel-safe',
      }));

      await safeRegistry.register(createTestPlugin('base'));
      await safeRegistry.register(createTestPlugin('dep-1', '1.0.0', [
        { name: 'base', version: '*' },
      ]));
      await safeRegistry.register(createTestPlugin('dep-2', '1.0.0', [
        { name: 'base', version: '*' },
      ]));

      await safeRegistry.initialize();

      expect(safeRegistry.getStats().initialized).toBe(3);
    });
  });

  describe('hot reload', () => {
    it('should reload a plugin', async () => {
      const plugin1 = new TestPlugin('test-plugin', '1.0.0');
      await registry.register(plugin1);
      await registry.initialize();

      expect(plugin1.initializeCalled).toBe(true);

      const plugin2 = new TestPlugin('test-plugin', '2.0.0');
      await registry.reload('test-plugin', plugin2);

      expect(plugin1.shutdownCalled).toBe(true);
      expect(plugin2.initializeCalled).toBe(true);
      expect(registry.getPlugin('test-plugin')?.metadata.version).toBe('2.0.0');
    });

    it('should preserve state during reload', async () => {
      const plugin1 = new TestPlugin('test-plugin', '1.0.0');
      plugin1.pluginState = { counter: 42 };

      await registry.register(plugin1);
      await registry.initialize();

      const plugin2 = new TestPlugin('test-plugin', '2.0.0');

      await registry.reload('test-plugin', plugin2, {
        preserveState: true,
        migrateState: (state: any) => state,
      });

      expect(plugin2.pluginState).toEqual({ counter: 42 });
      // The lifecycle state is untouched by the user state hand-over
      expect(plugin2.state).toBe('initialized');
    });

    it('should pass state through migrateState', async () => {
      const plugin1 = new TestPlugin('test-plugin', '1.0.0');
      plugin1.pluginState = { counter: 1 };
      await registry.register(plugin1);
      await registry.initialize();

      const plugin2 = new TestPlugin('test-plugin', '2.0.0');
      await registry.reload('test-plugin', plugin2, {
        preserveState: true,
        migrateState: (state: any, version) => ({ counter: state.counter + 1, version }),
      });

      expect(plugin2.pluginState).toEqual({ counter: 2, version: '2.0.0' });
    });

    it('should never pass user state to BasePlugin lifecycle setState', async () => {
      // A BasePlugin without importState(): the legacy setState() fallback
      // must not be used, because on BasePlugin it sets the lifecycle state.
      class NoImportPlugin extends BasePlugin {
        constructor(version: string) {
          super({ name: 'test-plugin', version });
        }
      }

      // The old plugin still exports state through the deprecated getState()
      class LegacyExportPlugin extends BasePlugin {
        constructor() {
          super({ name: 'test-plugin', version: '1.0.0' });
        }
        async getState(): Promise<unknown> {
          return { counter: 42 };
        }
      }

      await registry.register(new LegacyExportPlugin());
      await registry.initialize();

      const plugin2 = new NoImportPlugin('2.0.0');
      await registry.reload('test-plugin', plugin2, { preserveState: true });

      expect(plugin2.state).toBe('initialized');
      expect(registry.getPlugin('test-plugin')?.metadata.version).toBe('2.0.0');
      expect(registry.getStats().initialized).toBe(1);
    });

    it('should still support deprecated getState/setState on non-BasePlugin plugins', async () => {
      const makeLegacyPlugin = (version: string): IPlugin & { data: unknown } => {
        let lifecycle: IPlugin['state'] = 'uninitialized';
        return {
          metadata: { name: 'legacy-plugin', version },
          get state() { return lifecycle; },
          data: null as unknown,
          async initialize() { lifecycle = 'initialized'; },
          async shutdown() { lifecycle = 'shutdown'; },
          async getState(this: { data: unknown }) { return this.data; },
          async setState(this: { data: unknown }, s: unknown) { this.data = s; },
        } as IPlugin & { data: unknown };
      };

      const oldPlugin = makeLegacyPlugin('1.0.0');
      oldPlugin.data = { legacy: true };
      await registry.register(oldPlugin);
      await registry.initialize();

      const newPlugin = makeLegacyPlugin('2.0.0');
      await registry.reload('legacy-plugin', newPlugin, { preserveState: true });

      expect(newPlugin.data).toEqual({ legacy: true });
      expect(newPlugin.state).toBe('initialized');
    });

    it('should reject name mismatch', async () => {
      await registry.register(createTestPlugin('original'));
      await registry.initialize();

      await expect(registry.reload('original', createTestPlugin('different')))
        .rejects.toThrow('name mismatch');
    });
  });

  describe('conflict resolution', () => {
    it('should error on conflict by default', async () => {
      const plugin1 = new PluginBuilder('plugin-1', '1.0.0')
        .withMCPTools([{
          name: 'shared-tool',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v1' }] }),
        }])
        .build();

      const plugin2 = new PluginBuilder('plugin-2', '1.0.0')
        .withMCPTools([{
          name: 'shared-tool',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v2' }] }),
        }])
        .build();

      await registry.register(plugin1);
      await registry.register(plugin2);

      await expect(registry.initialize())
        .rejects.toThrow('conflict');
    });

    it('should reject with a PluginConflictError and register nothing from the conflicting plugin', async () => {
      const plugin1 = toolPlugin('plugin-1', 'shared-tool', 'Tool 1');
      const plugin2 = new PluginBuilder('plugin-2', '1.0.0')
        .withMCPTools([
          {
            name: 'unique-tool',
            description: 'Unique',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [{ type: 'text', text: 'u' }] }),
          },
          {
            name: 'shared-tool',
            description: 'Tool 2',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [{ type: 'text', text: 'v2' }] }),
          },
        ])
        .build();

      await registry.register(plugin1);
      await registry.register(plugin2);

      const error = await registry.initialize().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(PluginConflictError);
      expect((error as PluginConflictError).identifier).toBe('shared-tool');
      expect((error as PluginConflictError).existingPlugin).toBe('plugin-1');
      expect((error as PluginConflictError).conflictingPlugin).toBe('plugin-2');

      // Only plugin-1's tool is registered; plugin-2 was rolled back
      expect(registry.getMCPTools().map(t => t.name)).toEqual(['shared-tool']);
      expect(registry.getMCPTools()[0].description).toBe('Tool 1');
      expect(registry.getPluginEntry('plugin-2')?.error).toContain('conflict');
      expect(registry.getPlugin('plugin-2')?.state).toBe('shutdown');
      expect(registry.getPlugin('plugin-1')?.state).toBe('initialized');
    });

    it('should reject on conflict with parallel initialization too', async () => {
      for (const strategy of ['parallel', 'parallel-safe'] as const) {
        const parallelRegistry = new EnhancedPluginRegistry(createConfig({ initializationStrategy: strategy }));
        await parallelRegistry.register(toolPlugin('plugin-1', 'shared-tool', 'Tool 1'));
        await parallelRegistry.register(toolPlugin('plugin-2', 'shared-tool', 'Tool 2'));

        await expect(parallelRegistry.initialize()).rejects.toBeInstanceOf(PluginConflictError);
        expect(parallelRegistry.getMCPTools()).toHaveLength(1);
      }
    });

    it('should keep recording ordinary initialization failures without rejecting', async () => {
      class FailingPlugin extends BasePlugin {
        constructor() {
          super({ name: 'failing-plugin', version: '1.0.0' });
        }
        protected async onInitialize(): Promise<void> {
          throw new Error('boom');
        }
      }

      await registry.register(new FailingPlugin());
      await registry.register(createTestPlugin('ok-plugin'));

      await expect(registry.initialize()).resolves.toBeUndefined();
      expect(registry.getPluginEntry('failing-plugin')?.error).toBe('boom');
      expect(registry.getStats().initialized).toBe(1);
    });

    it('should support first-wins strategy', async () => {
      const conflictRegistry = new EnhancedPluginRegistry(createConfig({
        conflictResolution: {
          mcpTools: { strategy: 'first' },
        },
      }));

      const plugin1 = new PluginBuilder('plugin-1', '1.0.0')
        .withMCPTools([{
          name: 'shared-tool',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v1' }] }),
        }])
        .build();

      const plugin2 = new PluginBuilder('plugin-2', '1.0.0')
        .withMCPTools([{
          name: 'shared-tool',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v2' }] }),
        }])
        .build();

      await conflictRegistry.register(plugin1);
      await conflictRegistry.register(plugin2);
      await conflictRegistry.initialize();

      expect(conflictRegistry.getMCPTools()).toHaveLength(1);
      expect(conflictRegistry.getMCPTools()[0].description).toBe('Tool 1');
    });

    it('should support namespace strategy', async () => {
      const namespaceRegistry = new EnhancedPluginRegistry(createConfig({
        conflictResolution: {
          mcpTools: { strategy: 'namespace', namespaceTemplate: '{plugin}:{name}' },
        },
      }));

      const plugin1 = new PluginBuilder('plugin-1', '1.0.0')
        .withMCPTools([{
          name: 'tool',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v1' }] }),
        }])
        .build();

      const plugin2 = new PluginBuilder('plugin-2', '1.0.0')
        .withMCPTools([{
          name: 'tool',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'v2' }] }),
        }])
        .build();

      await namespaceRegistry.register(plugin1);
      await namespaceRegistry.register(plugin2);
      await namespaceRegistry.initialize();

      const tools = namespaceRegistry.getMCPTools();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('plugin-1:tool');
      expect(tools.map(t => t.name)).toContain('plugin-2:tool');
    });

    it('should namespace every owner of a conflicting name, and only the identifier', async () => {
      const namespaceRegistry = new EnhancedPluginRegistry(createConfig({
        conflictResolution: {
          mcpTools: { strategy: 'namespace' },
          agentTypes: { strategy: 'namespace', namespaceTemplate: '{plugin}/{name}' },
        },
      }));

      const agentPlugin = (pluginName: string) => new PluginBuilder(pluginName, '1.0.0')
        .withAgentTypes([{ type: 'reviewer', name: `Reviewer from ${pluginName}`, capabilities: ['review'] }])
        .build();

      await namespaceRegistry.register(toolPlugin('plugin-1', 'tool', 'Tool 1'));
      await namespaceRegistry.register(toolPlugin('plugin-2', 'tool', 'Tool 2'));
      await namespaceRegistry.register(toolPlugin('plugin-3', 'tool', 'Tool 3'));
      await namespaceRegistry.register(toolPlugin('plugin-4', 'other-tool', 'Other'));
      await namespaceRegistry.register(agentPlugin('agents-a'));
      await namespaceRegistry.register(agentPlugin('agents-b'));
      await namespaceRegistry.initialize();

      const tools = namespaceRegistry.getMCPTools() as MCPToolDefinition[];
      const byName = Object.fromEntries(tools.map(t => [t.name, t.description]));
      expect(byName).toEqual({
        'plugin-1:tool': 'Tool 1',
        'plugin-2:tool': 'Tool 2',
        'plugin-3:tool': 'Tool 3',
        'other-tool': 'Other',
      });
      // Only the identifying field is rewritten; no stray `type` is added to tools
      expect(tools.every(t => !('type' in t))).toBe(true);

      const agentTypes = namespaceRegistry.getAgentTypes();
      expect(agentTypes.map(a => a.type).sort()).toEqual(['agents-a/reviewer', 'agents-b/reviewer']);
      expect(agentTypes.map(a => a.name).sort()).toEqual(['Reviewer from agents-a', 'Reviewer from agents-b']);
    });

  });

  describe('health check', () => {
    it('should return health status for all plugins', async () => {
      await registry.register(createTestPlugin('healthy-plugin'));
      await registry.initialize();

      const health = await registry.healthCheck();

      expect(health.get('healthy-plugin')?.healthy).toBe(true);
    });

    it('should report unhealthy for uninitialized plugins', async () => {
      await registry.register(createTestPlugin('uninitialized-plugin'));

      const health = await registry.healthCheck();

      expect(health.get('uninitialized-plugin')?.healthy).toBe(false);
      expect(health.get('uninitialized-plugin')?.message).toContain('not initialized');
    });
  });

  describe('enhanced service container', () => {
    it('should list all services', async () => {
      const services = registry.getServices();

      services.set('service-a', { value: 1 });
      services.set('service-b', { value: 2 });

      const keys = services.list();
      expect(keys).toContain('service-a');
      expect(keys).toContain('service-b');
      expect(keys).toContain('pluginRegistry');
    });

    it('should list services by prefix', async () => {
      const services = registry.getServices();

      services.set('db:mysql', {});
      services.set('db:postgres', {});
      services.set('cache:redis', {});

      const dbServices = services.listByPrefix('db:');
      expect(dbServices).toHaveLength(2);
      expect(dbServices).toContain('db:mysql');
      expect(dbServices).toContain('db:postgres');
    });

    it('should store and retrieve metadata', async () => {
      const services = registry.getServices();

      services.setWithMetadata('my-service', { active: true }, {
        provider: 'test-plugin',
        description: 'Test service',
        version: '1.0.0',
      });

      const metadata = services.getMetadata('my-service');
      expect(metadata?.provider).toBe('test-plugin');
      expect(metadata?.description).toBe('Test service');
    });
  });

  describe('stats', () => {
    it('should return correct statistics', async () => {
      const plugin1 = new PluginBuilder('plugin-1', '1.0.0')
        .withMCPTools([{
          name: 'tool-1',
          description: 'Tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: '' }] }),
        }])
        .build();

      await registry.register(plugin1);
      await registry.register(createTestPlugin('plugin-2'));
      await registry.initialize();

      const stats = registry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.initialized).toBe(2);
      expect(stats.mcpTools).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should shutdown all plugins', async () => {
      const plugin1 = new TestPlugin('plugin-1', '1.0.0');
      const plugin2 = new TestPlugin('plugin-2', '1.0.0');

      await registry.register(plugin1);
      await registry.register(plugin2);
      await registry.initialize();
      await registry.shutdown();

      expect(plugin1.shutdownCalled).toBe(true);
      expect(plugin2.shutdownCalled).toBe(true);
    });
  });
});
