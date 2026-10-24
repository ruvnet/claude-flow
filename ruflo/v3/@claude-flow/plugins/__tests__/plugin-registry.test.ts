/**
 * Plugin Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginRegistry, getDefaultRegistry, setDefaultRegistry } from '../src/registry/plugin-registry.js';
import { BasePlugin } from '../src/core/base-plugin.js';
import type { PluginMetadata, PluginContext, MCPToolDefinition } from '../src/types/index.js';

// ============================================================================
// Test Plugin Implementation
// ============================================================================

class TestPlugin extends BasePlugin {
  private tools: MCPToolDefinition[] = [];
  initializeCalled = false;
  shutdownCalled = false;

  constructor(metadata: PluginMetadata, tools?: MCPToolDefinition[]) {
    super(metadata);
    this.tools = tools ?? [];
  }

  protected async onInitialize(): Promise<void> {
    this.initializeCalled = true;
  }

  protected async onShutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  registerMCPTools(): MCPToolDefinition[] {
    return this.tools;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry({
      coreVersion: '3.0.0',
      dataDir: '/tmp/test',
    });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  describe('register', () => {
    it('should register a plugin', async () => {
      const plugin = new TestPlugin({
        name: 'test-plugin',
        version: '1.0.0',
      });

      await registry.register(plugin);

      expect(registry.getPlugin('test-plugin')).toBe(plugin);
    });

    it('should reject duplicate plugin names', async () => {
      const plugin1 = new TestPlugin({
        name: 'test-plugin',
        version: '1.0.0',
      });
      const plugin2 = new TestPlugin({
        name: 'test-plugin',
        version: '2.0.0',
      });

      await registry.register(plugin1);

      await expect(registry.register(plugin2)).rejects.toThrow('already registered');
    });

    it('should reject invalid plugins', async () => {
      const invalidPlugin = { name: 'invalid' } as any;

      await expect(registry.register(invalidPlugin)).rejects.toThrow('Invalid plugin');
    });

    it('should respect max plugins limit', async () => {
      const limitedRegistry = new PluginRegistry({
        coreVersion: '3.0.0',
        dataDir: '/tmp/test',
        maxPlugins: 2,
      });

      await limitedRegistry.register(new TestPlugin({ name: 'p1', version: '1.0.0' }));
      await limitedRegistry.register(new TestPlugin({ name: 'p2', version: '1.0.0' }));

      await expect(
        limitedRegistry.register(new TestPlugin({ name: 'p3', version: '1.0.0' }))
      ).rejects.toThrow('Maximum plugin limit');
    });

    it('should accept plugin factory functions', async () => {
      const factory = async () => new TestPlugin({
        name: 'factory-plugin',
        version: '1.0.0',
      });

      await registry.register(factory);

      expect(registry.getPlugin('factory-plugin')).toBeDefined();
    });
  });

  describe('unregister', () => {
    it('should unregister a plugin', async () => {
      const plugin = new TestPlugin({
        name: 'test-plugin',
        version: '1.0.0',
      });

      await registry.register(plugin);
      await registry.initialize();
      await registry.unregister('test-plugin');

      expect(registry.getPlugin('test-plugin')).toBeUndefined();
      expect(plugin.shutdownCalled).toBe(true);
    });

    it('should throw for non-existent plugin', async () => {
      await expect(registry.unregister('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('initialize', () => {
    it('should initialize all plugins', async () => {
      const plugin1 = new TestPlugin({ name: 'p1', version: '1.0.0' });
      const plugin2 = new TestPlugin({ name: 'p2', version: '1.0.0' });

      await registry.register(plugin1);
      await registry.register(plugin2);
      await registry.initialize();

      expect(plugin1.initializeCalled).toBe(true);
      expect(plugin2.initializeCalled).toBe(true);
    });

    it('should throw if already initialized', async () => {
      await registry.initialize();

      await expect(registry.initialize()).rejects.toThrow('already initialized');
    });

    it('should skip disabled plugins', async () => {
      const plugin = new TestPlugin({ name: 'disabled', version: '1.0.0' });

      await registry.register(plugin, { enabled: false, priority: 50, settings: {} });
      await registry.initialize();

      expect(plugin.initializeCalled).toBe(false);
    });

    it('should respect dependency order', async () => {
      const initOrder: string[] = [];

      class OrderedPlugin extends TestPlugin {
        protected async onInitialize(): Promise<void> {
          initOrder.push(this.metadata.name);
        }
      }

      const child = new OrderedPlugin({
        name: 'child',
        version: '1.0.0',
        dependencies: ['parent'],
      });
      const parent = new OrderedPlugin({
        name: 'parent',
        version: '1.0.0',
      });

      // Register in reverse order
      await registry.register(child);
      await registry.register(parent);
      await registry.initialize();

      expect(initOrder).toEqual(['parent', 'child']);
    });

    it('should detect circular dependencies', async () => {
      const pluginA = new TestPlugin({
        name: 'a',
        version: '1.0.0',
        dependencies: ['b'],
      });
      const pluginB = new TestPlugin({
        name: 'b',
        version: '1.0.0',
        dependencies: ['a'],
      });

      await registry.register(pluginA);
      await registry.register(pluginB);

      await expect(registry.initialize()).rejects.toThrow('Circular dependency');
    });
  });

  describe('shutdown', () => {
    it('should shutdown all plugins in reverse order', async () => {
      const shutdownOrder: string[] = [];

      class OrderedPlugin extends TestPlugin {
        protected async onShutdown(): Promise<void> {
          shutdownOrder.push(this.metadata.name);
        }
      }

      const plugin1 = new OrderedPlugin({ name: 'first', version: '1.0.0' });
      const plugin2 = new OrderedPlugin({ name: 'second', version: '1.0.0' });

      await registry.register(plugin1);
      await registry.register(plugin2);
      await registry.initialize();
      await registry.shutdown();

      expect(shutdownOrder).toEqual(['second', 'first']);
    });
  });

  describe('extension points', () => {
    it('should collect MCP tools from plugins', async () => {
      const tools: MCPToolDefinition[] = [
        {
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        },
      ];

      const plugin = new TestPlugin({ name: 'tool-plugin', version: '1.0.0' }, tools);

      await registry.register(plugin);
      await registry.initialize();

      const registeredTools = registry.getMCPTools();
      expect(registeredTools).toHaveLength(1);
      expect(registeredTools[0].name).toBe('test-tool');
    });
  });

  describe('health check', () => {
    it('should return health status for all plugins', async () => {
      const plugin = new TestPlugin({ name: 'test', version: '1.0.0' });

      await registry.register(plugin);
      await registry.initialize();

      const results = await registry.healthCheck();

      expect(results.has('test')).toBe(true);
      expect(results.get('test')?.healthy).toBe(true);
    });

    it('should report unhealthy for uninitialized plugins', async () => {
      const plugin = new TestPlugin({ name: 'test', version: '1.0.0' });

      await registry.register(plugin, { enabled: false, priority: 50, settings: {} });
      await registry.initialize();

      const results = await registry.healthCheck();

      expect(results.get('test')?.healthy).toBe(false);
    });
  });

  describe('stats', () => {
    it('should return accurate statistics', async () => {
      const tools: MCPToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: '' }] }),
        },
      ];

      const plugin1 = new TestPlugin({ name: 'p1', version: '1.0.0' }, tools);
      const plugin2 = new TestPlugin({ name: 'p2', version: '1.0.0' });

      await registry.register(plugin1);
      await registry.register(plugin2);
      await registry.initialize();

      const stats = registry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.initialized).toBe(2);
      expect(stats.failed).toBe(0);
      expect(stats.mcpTools).toBe(1);
    });
  });

  describe('default registry', () => {
    it('should provide a default registry', () => {
      const defaultReg = getDefaultRegistry();
      expect(defaultReg).toBeInstanceOf(PluginRegistry);
    });

    it('should allow setting custom default registry', () => {
      const customRegistry = new PluginRegistry({
        coreVersion: '3.0.0',
        dataDir: '/custom',
      });

      setDefaultRegistry(customRegistry);

      expect(getDefaultRegistry()).toBe(customRegistry);
    });
  });
});

describe('BasePlugin', () => {
  it('should properly manage lifecycle state', async () => {
    const plugin = new TestPlugin({ name: 'lifecycle-test', version: '1.0.0' });

    expect(plugin.state).toBe('uninitialized');

    const registry = new PluginRegistry({
      coreVersion: '3.0.0',
      dataDir: '/tmp/test',
    });

    await registry.register(plugin);
    await registry.initialize();

    expect(plugin.state).toBe('initialized');

    await registry.shutdown();

    expect(plugin.state).toBe('shutdown');
  });

  it('should provide accurate health checks', async () => {
    const plugin = new TestPlugin({ name: 'health-test', version: '1.0.0' });

    const registry = new PluginRegistry({
      coreVersion: '3.0.0',
      dataDir: '/tmp/test',
    });

    await registry.register(plugin);
    await registry.initialize();

    const health = await plugin.healthCheck();

    expect(health.healthy).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.checks.state.healthy).toBe(true);
  });

  it('should freeze metadata', () => {
    const plugin = new TestPlugin({ name: 'freeze-test', version: '1.0.0' });

    expect(Object.isFrozen(plugin.metadata)).toBe(true);
  });
});
