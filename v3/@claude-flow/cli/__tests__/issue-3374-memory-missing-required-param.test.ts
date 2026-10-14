/**
 * Regression guard for issue #3374 — `memory_search` declares
 * `required: ['query']`, but nothing enforced it. A request without `query`
 * (e.g. `{"pattern": "...", "limit": 5}`) was accepted, `validateMemoryInput`
 * let the `undefined` through (every check in it is truthiness-guarded), and
 * the value was carried down to `generateHashEmbedding`'s `text.toLowerCase()`
 * — surfacing as the unhelpful
 *   {"results":[],"total":0,"error":"Cannot read properties of undefined (reading 'toLowerCase')"}
 *
 * The fix rejects a missing/non-string/empty required parameter at the tool
 * boundary with an error that names the parameter and carries a stable code.
 * The sibling tools that share the same shape (memory_search_unified with
 * `query`, memory_store / memory_retrieve / memory_delete with `key`) get the
 * same guard.
 *
 * The discriminating assertion is that the memory layer is NEVER called for a
 * rejected request: pre-fix, each handler forwarded `undefined` to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs so ensureInitialized()'s legacy-migration check is a no-op.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const layer = vi.hoisted(() => ({
  searchEntries: vi.fn(async () => ({ success: true, results: [], searchTime: 1 })),
  storeEntry: vi.fn(async () => ({ success: true, id: 'mock-id' })),
  getEntry: vi.fn(async () => ({ found: false })),
  deleteEntry: vi.fn(async () => ({ deleted: true })),
  listEntries: vi.fn(async () => ({ success: true, entries: [], total: 0 })),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async () => ({ embedding: new Array(384).fill(0.1), dimensions: 384, model: 'mock' })),
  storeEntry: layer.storeEntry,
  searchEntries: layer.searchEntries,
  listEntries: layer.listEntries,
  getEntry: layer.getEntry,
  deleteEntry: layer.deleteEntry,
  getStats: vi.fn(async () => ({ totalEntries: 0 })),
  initializeDatabase: vi.fn(async () => ({ success: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true, version: '3.0.0' })),
  migrateFromLegacy: vi.fn(async () => ({ success: true, migrated: 0 })),
}));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';

function tool(name: string) {
  const t = memoryTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

type Res = { error?: string; code?: string; results?: unknown[]; total?: number; success?: boolean };

describe('#3374 memory tools reject a missing required parameter at the boundary', () => {
  beforeEach(() => {
    Object.values(layer).forEach((fn) => fn.mockClear());
  });

  describe('memory_search', () => {
    it('rejects the issue payload ({pattern, limit}) without reaching searchEntries', async () => {
      const r = (await tool('memory_search').handler({ pattern: 'cross-agent proof bridge', limit: 5 })) as Res;
      expect(layer.searchEntries).not.toHaveBeenCalled();
      expect(r.code).toBe('MISSING_REQUIRED_PARAM');
      expect(r.error).toContain('"query"');
      expect(r.error).not.toContain('toLowerCase');
      expect(r.results).toEqual([]);
      expect(r.total).toBe(0);
    });

    it.each([
      ['empty string', ''],
      ['non-string', 42],
      ['null', null],
    ])('rejects query=%s', async (_label, query) => {
      const r = (await tool('memory_search').handler({ query })) as Res;
      expect(layer.searchEntries).not.toHaveBeenCalled();
      expect(r.code).toBe('MISSING_REQUIRED_PARAM');
    });

    it('a well-formed query still reaches the search layer', async () => {
      const r = (await tool('memory_search').handler({ query: 'cross-agent proof bridge', limit: 5 })) as Res;
      // The real search runs first with the caller's query. Since #4129 an EMPTY default-threshold search
      // may be followed by exactly one near-miss probe (threshold 0) for the hint; nothing else.
      expect(layer.searchEntries.mock.calls[0]?.[0]).toMatchObject({ query: 'cross-agent proof bridge' });
      expect(layer.searchEntries.mock.calls[0]?.[0]).not.toHaveProperty('threshold', 0);
      expect(layer.searchEntries.mock.calls.length).toBeLessThanOrEqual(2);
      if (layer.searchEntries.mock.calls.length === 2) {
        expect(layer.searchEntries.mock.calls[1]?.[0]).toMatchObject({ query: 'cross-agent proof bridge', threshold: 0 });
      }
      expect(r.code).toBeUndefined();
      expect(r.error).toBeUndefined();
    });
  });

  it('memory_search_unified rejects a missing query without searching', async () => {
    const r = (await tool('memory_search_unified').handler({ pattern: 'x' })) as Res;
    expect(layer.searchEntries).not.toHaveBeenCalled();
    expect(layer.listEntries).not.toHaveBeenCalled();
    expect(r.code).toBe('MISSING_REQUIRED_PARAM');
    expect(r.error).toContain('"query"');
  });

  it('memory_store rejects a missing key without storing', async () => {
    const r = (await tool('memory_store').handler({ value: 'some value' })) as Res;
    expect(layer.storeEntry).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.code).toBe('MISSING_REQUIRED_PARAM');
    expect(r.error).toContain('"key"');
  });

  it('memory_retrieve rejects a missing key without reading', async () => {
    const r = (await tool('memory_retrieve').handler({ namespace: 'default' })) as Res;
    expect(layer.getEntry).not.toHaveBeenCalled();
    expect(r.code).toBe('MISSING_REQUIRED_PARAM');
    expect(r.error).toContain('"key"');
  });

  it('memory_delete rejects a missing key without deleting', async () => {
    const r = (await tool('memory_delete').handler({ namespace: 'default' })) as Res;
    expect(layer.deleteEntry).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.code).toBe('MISSING_REQUIRED_PARAM');
    expect(r.error).toContain('"key"');
  });

  it('well-formed store/retrieve/delete still reach the memory layer', async () => {
    await tool('memory_store').handler({ key: 'k', value: 'v' });
    await tool('memory_retrieve').handler({ key: 'k' });
    await tool('memory_delete').handler({ key: 'k' });
    expect(layer.storeEntry).toHaveBeenCalledTimes(1);
    expect(layer.getEntry).toHaveBeenCalledTimes(1);
    expect(layer.deleteEntry).toHaveBeenCalledTimes(1);
  });
});
