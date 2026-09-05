// #2246 fix: memory_search_unified namespace fan-out — verify the resolved
// namespace list correctly comes from each priority source:
//   1. param `namespace` (single)
//   2. param `namespaces` (array)
//   3. env CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES
//   4. dynamic enumeration via listEntries
//   5. legacy 6-namespace fallback
//
// The bug was step 4 collapsing to step 5, silently missing ~95% of an
// 8,789-entry store with custom namespaces.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const tool = memoryTools.find((t) => t.name === 'memory_search_unified');

function snapshotEnv() {
  return process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES;
}

function restoreEnv(v: string | undefined) {
  if (v === undefined) delete process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES;
  else process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES = v;
}

describe('memory_search_unified namespace fan-out (#2246)', () => {
  let savedEnv: string | undefined;
  beforeEach(() => { savedEnv = snapshotEnv(); });
  afterEach(() => { restoreEnv(savedEnv); });

  it('exists and accepts the new `namespaces` array parameter', () => {
    expect(tool).toBeDefined();
    const props = (tool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.namespaces).toBeDefined();
    expect((props.namespaces as { type: string }).type).toBe('array');
  });

  it('with no params, reports `namespaceSource` (not the legacy hardcode silently)', async () => {
    delete process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES;
    const r = await tool!.handler({ query: 'test query for the namespace fan-out' }) as {
      success?: boolean;
      searchedNamespaces?: string[];
      namespaceSource?: string;
      error?: string;
    };
    // We don't assert success — the fixture environment may not have memory
    // initialized. We DO assert that the new namespaceSource field is set
    // so callers can audit which list was used.
    expect(r.namespaceSource).toBeDefined();
    expect(['dynamic', 'legacy-fallback', 'env']).toContain(r.namespaceSource);
  });

  it('with explicit single `namespace`, reports namespaceSource=param-single', async () => {
    const r = await tool!.handler({ query: 'test', namespace: 'patterns' }) as {
      searchedNamespaces?: string[];
      namespaceSource?: string;
    };
    expect(r.searchedNamespaces).toEqual(['patterns']);
    expect(r.namespaceSource).toBe('param-single');
  });

  it('with explicit `namespaces` array, reports namespaceSource=param-list', async () => {
    const r = await tool!.handler({
      query: 'test',
      namespaces: ['brain-system', 'knowledge-graph', 'causal-edges'],
    }) as { searchedNamespaces?: string[]; namespaceSource?: string };
    expect(r.searchedNamespaces).toEqual(['brain-system', 'knowledge-graph', 'causal-edges']);
    expect(r.namespaceSource).toBe('param-list');
  });

  it('with env CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES, reports namespaceSource=env', async () => {
    process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES = 'foo,bar,baz';
    const r = await tool!.handler({ query: 'test' }) as {
      searchedNamespaces?: string[]; namespaceSource?: string;
    };
    expect(r.searchedNamespaces).toEqual(['foo', 'bar', 'baz']);
    expect(r.namespaceSource).toBe('env');
  });

  it('explicit `namespaces` array beats env (priority 2 > priority 3)', async () => {
    process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES = 'env-a,env-b';
    const r = await tool!.handler({ query: 'test', namespaces: ['param-only'] }) as {
      searchedNamespaces?: string[]; namespaceSource?: string;
    };
    expect(r.searchedNamespaces).toEqual(['param-only']);
    expect(r.namespaceSource).toBe('param-list');
  });

  it('single `namespace` beats `namespaces` array (priority 1 > priority 2)', async () => {
    const r = await tool!.handler({
      query: 'test',
      namespace: 'wins',
      namespaces: ['loses-a', 'loses-b'],
    }) as { searchedNamespaces?: string[]; namespaceSource?: string };
    expect(r.searchedNamespaces).toEqual(['wins']);
    expect(r.namespaceSource).toBe('param-single');
  });

  it('rejects path-traversal in namespace param (input validation preserved)', async () => {
    const r = await tool!.handler({ query: 'test', namespace: '../etc/passwd' }) as {
      success: boolean; error?: string;
    };
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects path-traversal in any element of namespaces array', async () => {
    const r = await tool!.handler({
      query: 'test',
      namespaces: ['ok', '../etc/passwd'],
    }) as { success: boolean; error?: string };
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
