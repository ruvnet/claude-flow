import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '../src/tool-registry.js';
import type { ILogger, MCPTool } from '../src/types.js';

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const tool = (name: string, category?: string, tags?: string[]): MCPTool => ({
  name, category, tags, description: `Tool ${name}`, inputSchema: { type: 'object', properties: {} },
  handler: async () => category ?? 'unclassified',
});

describe('tool replacement updates discovery indexes', () => {
  it('removes former category and tags while preserving shared and unrelated members', async () => {
    const registry = createToolRegistry(logger);
    registry.register(tool('changed', 'old', ['former', 'shared']));
    registry.register(tool('peer', 'old', ['former', 'shared']));
    registry.register(tool('other', 'unrelated', ['separate']));
    expect(registry.register(tool('changed', 'new', ['current', 'shared']), { override: true })).toBe(true);
    expect(registry.getByCategory('old').map(t => t.name)).toEqual(['peer']);
    expect(registry.getByTag('former').map(t => t.name)).toEqual(['peer']);
    expect(registry.getByTag('shared').map(t => t.name).sort()).toEqual(['changed', 'peer']);
    expect(registry.search({ category: 'old', tags: ['current'] })).toEqual([]);
    expect(registry.search({ category: 'new', tags: ['current'] }).map(t => t.name)).toEqual(['changed']);
    expect(registry.getByCategory('unrelated').map(t => t.name)).toEqual(['other']);
    expect((await registry.execute('changed', {})).content).toEqual([{ type: 'text', text: 'new' }]);
  });

  it('removes empty category/tag buckets on repeated and unclassified replacements', () => {
    const registry = createToolRegistry(logger);
    registry.register(tool('changed', 'one', ['a']));
    registry.register(tool('changed', 'two', ['b']), { override: true });
    expect(registry.getCategories()).toEqual(['two']);
    expect(registry.getTags()).toEqual(['b']);
    registry.register(tool('changed'), { override: true });
    expect(registry.getCategories()).toEqual([]);
    expect(registry.getTags()).toEqual([]);
    expect(registry.getToolCount()).toBe(1);
    expect(registry.unregister('changed')).toBe(true);
    expect(registry.search({})).toEqual([]);
    expect(registry.getStats().totalCategories).toBe(0);
    expect(registry.getStats().totalTags).toBe(0);
  });

  it('leaves existing discovery intact when replacement is invalid or override is absent', () => {
    const registry = createToolRegistry(logger);
    registry.register(tool('changed', 'old', ['original']));
    expect(registry.register(tool('changed', 'new', ['next']))).toBe(false);
    expect(registry.register({ ...tool('changed', 'new', ['next']), description: '' }, { override: true })).toBe(false);
    expect(registry.getByCategory('old').map(t => t.name)).toEqual(['changed']);
    expect(registry.getByTag('original').map(t => t.name)).toEqual(['changed']);
    expect(registry.getCategories()).toEqual(['old']);
    expect(registry.getTags()).toEqual(['original']);
  });
});
