/**
 * #4410 automation scan: invalidating extension-point caches used to call
 * every initialized plugin's register* methods again. Unregistering one
 * plugin therefore re-ran the remaining plugins' registration code and could
 * duplicate side effects or allocations.
 */
import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../src/registry/plugin-registry.js';
import { EnhancedPluginRegistry } from '../src/registry/enhanced-plugin-registry.js';
import { BasePlugin } from '../src/core/base-plugin.js';
import type { HookDefinition, MCPToolDefinition, PluginMetadata } from '../src/types/index.js';

class CountingPlugin extends BasePlugin {
  registerCalls = 0;
  hookCalls = 0;

  constructor(metadata: PluginMetadata, private readonly tools: MCPToolDefinition[]) {
    super(metadata);
  }

  protected async onInitialize(): Promise<void> {}

  protected async onShutdown(): Promise<void> {}

  registerMCPTools(): MCPToolDefinition[] {
    this.registerCalls++;
    return this.tools;
  }

  registerHooks(): HookDefinition[] {
    this.hookCalls++;
    return [];
  }
}

function tool(name: string, text: string): MCPToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ content: [{ type: 'text', text }] }),
  };
}

function plugin(name: string, tools: MCPToolDefinition[]): CountingPlugin {
  return new CountingPlugin({ name, version: '1.0.0' }, tools);
}

describe('extension cache rebuilds do not re-run plugin registration (#4410)', () => {
  it('PluginRegistry keeps surviving plugins at one registration call', async () => {
    const registry = new PluginRegistry({ coreVersion: '3.0.0', dataDir: '/tmp/test' });
    const a = plugin('plugin-a', [tool('tool-a', 'a')]);
    const b = plugin('plugin-b', [tool('tool-b', 'b')]);

    await registry.register(a);
    await registry.register(b);
    await registry.initialize();

    expect(a.registerCalls).toBe(1);
    expect(b.registerCalls).toBe(1);

    await registry.unregister('plugin-a');

    expect(a.registerCalls).toBe(1);
    expect(b.registerCalls).toBe(1);
    expect(a.hookCalls).toBe(1);
    expect(b.hookCalls).toBe(1);
    expect(registry.getMCPTools().map(t => t.name)).toEqual(['tool-b']);

    await registry.shutdown();
  });

  it('EnhancedPluginRegistry keeps surviving plugins at one registration call', async () => {
    const registry = new EnhancedPluginRegistry({ coreVersion: '3.0.0', dataDir: '/tmp/test' });
    const a = plugin('plugin-a', [tool('tool-a', 'a')]);
    const b = plugin('plugin-b', [tool('tool-b', 'b')]);

    await registry.register(a);
    await registry.register(b);
    await registry.initialize();

    expect(a.registerCalls).toBe(1);
    expect(b.registerCalls).toBe(1);

    await registry.unregister('plugin-a');

    expect(a.registerCalls).toBe(1);
    expect(b.registerCalls).toBe(1);
    expect(a.hookCalls).toBe(1);
    expect(b.hookCalls).toBe(1);
    expect(registry.getMCPTools().map(t => t.name)).toEqual(['tool-b']);

    await registry.shutdown();
  });

  it('EnhancedPluginRegistry replays conflict resolution from captured values', async () => {
    const registry = new EnhancedPluginRegistry({
      coreVersion: '3.0.0',
      dataDir: '/tmp/test',
      conflictResolution: { mcpTools: { strategy: 'first' } },
    });
    const a = plugin('plugin-a', [tool('shared-tool', 'from-a')]);
    const b = plugin('plugin-b', [tool('shared-tool', 'from-b')]);

    await registry.register(a);
    await registry.register(b);
    await registry.initialize();

    expect(registry.getMCPTools()).toHaveLength(1);
    expect(registry.getMCPTools()[0].name).toBe('shared-tool');

    await registry.unregister('plugin-a');

    expect(a.registerCalls).toBe(1);
    expect(b.registerCalls).toBe(1);
    expect(a.hookCalls).toBe(1);
    expect(b.hookCalls).toBe(1);
    expect(registry.getMCPTools()).toHaveLength(1);
    expect(registry.getMCPTools()[0].name).toBe('shared-tool');

    await registry.shutdown();
  });

  it('EnhancedPluginRegistry replaces captured values on hot reload', async () => {
    const registry = new EnhancedPluginRegistry({ coreVersion: '3.0.0', dataDir: '/tmp/test' });
    const original = plugin('plugin-a', [tool('old-tool', 'old')]);

    await registry.register(original);
    await registry.initialize();

    const replacement = plugin('plugin-a', [tool('new-tool', 'new')]);
    await registry.reload('plugin-a', replacement);

    expect(original.registerCalls).toBe(1);
    expect(replacement.registerCalls).toBe(1);
    expect(registry.getMCPTools().map(t => t.name)).toEqual(['new-tool']);

    await registry.shutdown();
  });
});
