import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginManager } from '../../src/infrastructure/plugins/PluginManager';
import { Plugin } from '../../src/infrastructure/plugins/Plugin';
import { ExtensionPoint } from '../../src/infrastructure/plugins/ExtensionPoint';
import { EventEmitter } from 'events';
import * as path from 'path';

describe('Plugin Integration Tests', () => {
  let pluginManager: PluginManager;
  let eventBus: EventEmitter;

  beforeEach(async () => {
    eventBus = new EventEmitter();
    pluginManager = new PluginManager({ eventBus });
    await pluginManager.initialize();
  });

  afterEach(async () => {
    await pluginManager.shutdown();
  });

  it('should load and initialize plugin', async () => {
    const mockPlugin: Plugin = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(mockPlugin);

    expect(mockPlugin.initialize).toHaveBeenCalled();

    const loadedPlugins = pluginManager.listPlugins();
    expect(loadedPlugins).toHaveLength(1);
    expect(loadedPlugins[0].id).toBe('test-plugin');
  });

  it('should register and invoke extension points', async () => {
    const extensionHandler = vi.fn().mockResolvedValue({ result: 'processed' });

    const mockPlugin: Plugin = {
      id: 'extension-plugin',
      name: 'Extension Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'task.beforeExecute',
          handler: extensionHandler
        }
      ])
    };

    await pluginManager.loadPlugin(mockPlugin);

    const result = await pluginManager.invokeExtensionPoint('task.beforeExecute', {
      taskId: 'task-1',
      agentId: 'agent-1'
    });

    expect(extensionHandler).toHaveBeenCalledWith({
      taskId: 'task-1',
      agentId: 'agent-1'
    });
    expect(result[0].result).toBe('processed');
  });

  it('should handle plugin lifecycle correctly', async () => {
    const initializeSpy = vi.fn().mockResolvedValue(undefined);
    const shutdownSpy = vi.fn().mockResolvedValue(undefined);

    const mockPlugin: Plugin = {
      id: 'lifecycle-plugin',
      name: 'Lifecycle Plugin',
      version: '1.0.0',
      initialize: initializeSpy,
      shutdown: shutdownSpy,
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(mockPlugin);
    expect(initializeSpy).toHaveBeenCalledTimes(1);

    await pluginManager.unloadPlugin('lifecycle-plugin');
    expect(shutdownSpy).toHaveBeenCalledTimes(1);

    const plugins = pluginManager.listPlugins();
    expect(plugins.find(p => p.id === 'lifecycle-plugin')).toBeUndefined();
  });

  it('should support multiple plugins with same extension point', async () => {
    const handler1 = vi.fn().mockResolvedValue({ plugin: 'plugin1' });
    const handler2 = vi.fn().mockResolvedValue({ plugin: 'plugin2' });

    const plugin1: Plugin = {
      id: 'plugin-1',
      name: 'Plugin 1',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'task.validate', handler: handler1 }
      ])
    };

    const plugin2: Plugin = {
      id: 'plugin-2',
      name: 'Plugin 2',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'task.validate', handler: handler2 }
      ])
    };

    await pluginManager.loadPlugin(plugin1);
    await pluginManager.loadPlugin(plugin2);

    const results = await pluginManager.invokeExtensionPoint('task.validate', {
      task: 'test'
    });

    expect(results).toHaveLength(2);
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should handle plugin dependencies', async () => {
    const basePlugin: Plugin = {
      id: 'base-plugin',
      name: 'Base Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    const dependentPlugin: Plugin = {
      id: 'dependent-plugin',
      name: 'Dependent Plugin',
      version: '1.0.0',
      dependencies: ['base-plugin'],
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(basePlugin);
    await pluginManager.loadPlugin(dependentPlugin);

    const plugins = pluginManager.listPlugins();
    expect(plugins).toHaveLength(2);

    // Should not allow unloading base plugin while dependent is loaded
    await expect(pluginManager.unloadPlugin('base-plugin')).rejects.toThrow();
  });

  it('should emit plugin lifecycle events', async () => {
    const loadedEvents: string[] = [];
    const unloadedEvents: string[] = [];

    eventBus.on('plugin:loaded', (plugin) => loadedEvents.push(plugin.id));
    eventBus.on('plugin:unloaded', (plugin) => unloadedEvents.push(plugin.id));

    const mockPlugin: Plugin = {
      id: 'event-plugin',
      name: 'Event Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(mockPlugin);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(loadedEvents).toContain('event-plugin');

    await pluginManager.unloadPlugin('event-plugin');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(unloadedEvents).toContain('event-plugin');
  });

  it('should validate plugin configuration', async () => {
    const mockPlugin: Plugin = {
      id: 'config-plugin',
      name: 'Config Plugin',
      version: '1.0.0',
      configSchema: {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string' },
          timeout: { type: 'number' }
        }
      },
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    // Valid config
    await pluginManager.loadPlugin(mockPlugin, {
      apiKey: 'test-key',
      timeout: 5000
    });

    expect(mockPlugin.initialize).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 5000
    });

    // Invalid config should fail
    await expect(
      pluginManager.loadPlugin(mockPlugin, { timeout: 5000 })
    ).rejects.toThrow();
  });

  it('should support plugin hot reloading', async () => {
    const version1Handler = vi.fn().mockResolvedValue({ version: 1 });
    const version2Handler = vi.fn().mockResolvedValue({ version: 2 });

    const pluginV1: Plugin = {
      id: 'hotreload-plugin',
      name: 'Hot Reload Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'test.handler', handler: version1Handler }
      ])
    };

    await pluginManager.loadPlugin(pluginV1);

    let result = await pluginManager.invokeExtensionPoint('test.handler', {});
    expect(result[0].version).toBe(1);

    // Hot reload with new version
    const pluginV2: Plugin = {
      ...pluginV1,
      version: '2.0.0',
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'test.handler', handler: version2Handler }
      ])
    };

    await pluginManager.reloadPlugin('hotreload-plugin', pluginV2);

    result = await pluginManager.invokeExtensionPoint('test.handler', {});
    expect(result[0].version).toBe(2);
  });

  it('should isolate plugin errors', async () => {
    const goodHandler = vi.fn().mockResolvedValue({ status: 'ok' });
    const badHandler = vi.fn().mockRejectedValue(new Error('Plugin error'));

    const goodPlugin: Plugin = {
      id: 'good-plugin',
      name: 'Good Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'test.process', handler: goodHandler }
      ])
    };

    const badPlugin: Plugin = {
      id: 'bad-plugin',
      name: 'Bad Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        { name: 'test.process', handler: badHandler }
      ])
    };

    await pluginManager.loadPlugin(goodPlugin);
    await pluginManager.loadPlugin(badPlugin);

    const results = await pluginManager.invokeExtensionPoint('test.process', {});

    // Good plugin should succeed, bad plugin should fail gracefully
    expect(results).toHaveLength(2);
    expect(results.find(r => r.status === 'ok')).toBeDefined();
    expect(results.find(r => r.error)).toBeDefined();
  });

  it('should support plugin priority ordering', async () => {
    const executionOrder: number[] = [];

    const createPlugin = (id: string, priority: number): Plugin => ({
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      priority,
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'ordered.handler',
          handler: async () => {
            executionOrder.push(priority);
            return { priority };
          }
        }
      ])
    });

    await pluginManager.loadPlugin(createPlugin('plugin-low', 10));
    await pluginManager.loadPlugin(createPlugin('plugin-high', 100));
    await pluginManager.loadPlugin(createPlugin('plugin-medium', 50));

    await pluginManager.invokeExtensionPoint('ordered.handler', {});

    // Should execute in priority order (high to low)
    expect(executionOrder).toEqual([100, 50, 10]);
  });

  it('should provide plugin metadata access', async () => {
    const mockPlugin: Plugin = {
      id: 'metadata-plugin',
      name: 'Metadata Plugin',
      version: '1.0.0',
      author: 'Test Author',
      description: 'Test plugin for metadata',
      homepage: 'https://example.com',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(mockPlugin);

    const metadata = pluginManager.getPluginMetadata('metadata-plugin');

    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('Metadata Plugin');
    expect(metadata?.author).toBe('Test Author');
    expect(metadata?.version).toBe('1.0.0');
  });

  it('should support plugin communication via shared context', async () => {
    const sharedContext = { counter: 0 };

    const plugin1: Plugin = {
      id: 'writer-plugin',
      name: 'Writer Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'context.write',
          handler: async (ctx) => {
            sharedContext.counter += 1;
            return { counter: sharedContext.counter };
          }
        }
      ])
    };

    const plugin2: Plugin = {
      id: 'reader-plugin',
      name: 'Reader Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'context.read',
          handler: async (ctx) => {
            return { counter: sharedContext.counter };
          }
        }
      ])
    };

    await pluginManager.loadPlugin(plugin1);
    await pluginManager.loadPlugin(plugin2);

    await pluginManager.invokeExtensionPoint('context.write', {});
    await pluginManager.invokeExtensionPoint('context.write', {});

    const readResult = await pluginManager.invokeExtensionPoint('context.read', {});

    expect(readResult[0].counter).toBe(2);
  });

  it('should handle plugin resource cleanup', async () => {
    const resources: string[] = [];

    const mockPlugin: Plugin = {
      id: 'resource-plugin',
      name: 'Resource Plugin',
      version: '1.0.0',
      initialize: async () => {
        resources.push('connection');
        resources.push('file-handle');
      },
      shutdown: async () => {
        resources.length = 0; // Clean up resources
      },
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    await pluginManager.loadPlugin(mockPlugin);
    expect(resources).toHaveLength(2);

    await pluginManager.unloadPlugin('resource-plugin');
    expect(resources).toHaveLength(0);
  });

  it('should support plugin versioning and compatibility checks', async () => {
    const plugin: Plugin = {
      id: 'versioned-plugin',
      name: 'Versioned Plugin',
      version: '2.1.0',
      minCoreVersion: '3.0.0',
      maxCoreVersion: '3.9.9',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([])
    };

    // Mock core version check
    vi.spyOn(pluginManager, 'getCoreVersion').mockReturnValue('3.5.0');

    await pluginManager.loadPlugin(plugin);

    const loadedPlugin = pluginManager.getPluginMetadata('versioned-plugin');
    expect(loadedPlugin?.version).toBe('2.1.0');

    // Test incompatible version
    vi.spyOn(pluginManager, 'getCoreVersion').mockReturnValue('2.0.0');

    const incompatiblePlugin: Plugin = { ...plugin, id: 'incompatible-plugin' };

    await expect(pluginManager.loadPlugin(incompatiblePlugin)).rejects.toThrow(
      /version/i
    );
  });

  it('should integrate plugins with core workflow', async () => {
    const workflowSteps: string[] = [];

    const validatorPlugin: Plugin = {
      id: 'validator',
      name: 'Validator Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'task.beforeExecute',
          handler: async (task) => {
            workflowSteps.push('validate');
            return { validated: true, task };
          }
        }
      ])
    };

    const loggerPlugin: Plugin = {
      id: 'logger',
      name: 'Logger Plugin',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'task.afterExecute',
          handler: async (result) => {
            workflowSteps.push('log');
            return { logged: true, result };
          }
        }
      ])
    };

    await pluginManager.loadPlugin(validatorPlugin);
    await pluginManager.loadPlugin(loggerPlugin);

    // Simulate workflow
    await pluginManager.invokeExtensionPoint('task.beforeExecute', { id: 'task-1' });
    workflowSteps.push('execute');
    await pluginManager.invokeExtensionPoint('task.afterExecute', { result: 'success' });

    expect(workflowSteps).toEqual(['validate', 'execute', 'log']);
  });
});
