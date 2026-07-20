/**
 * Regression guard for issue #2646 — the MCP `memory_search` tool returned
 * 0 results when the optional `namespace` parameter was omitted, even though
 * `memory_stats` confirmed entries existed across multiple namespaces with
 * 100% embedding coverage. Passing any concrete `namespace` returned the
 * expected hits immediately.
 *
 * This is the THIRD occurrence of this exact bug shape (#1123, #1131 — both
 * closed Feb/Mar). Root cause each time: the `memory_search` tool handler in
 * `mcp-tools/memory-tools.ts` coerces an omitted `namespace` to the literal
 * string `'default'`:
 *
 *   const namespace = (input.namespace as string) || 'default';
 *
 * But BOTH underlying search implementations — `searchEntries()` in
 * `memory/memory-initializer.ts` and `bridgeSearchEntries()` in
 * `memory/memory-bridge.ts` — already resolve an omitted/undefined namespace
 * to the `'all'` sentinel (fan out across every namespace):
 *
 *   const effectiveNamespace = namespace || 'all';
 *
 * `'default'` is truthy, so passing it explicitly defeats that fallback and
 * silently scopes the search to a namespace that is usually empty (the CLI
 * `memory search` command already gets this right — see
 * `commands/memory.ts`, which defaults to `'all'`, not `'default'`).
 *
 * Why prior fixes didn't catch the regression: #1123/#1131 fixed the
 * *search-layer* default (`searchEntries`/`bridgeSearchEntries`) but nothing
 * asserted what the `memory_search` MCP *tool handler* actually forwards to
 * that layer, so a later refactor of `memory-tools.ts` could silently
 * reintroduce `|| 'default'` at the tool boundary without breaking anything.
 * This guard asserts the forwarded argument directly, at the tool boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs so `ensureInitialized()`'s legacy-migration check (`hasLegacyStore`)
// is a deterministic no-op regardless of the real cwd.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Spy on the search layer so we can assert exactly what `memory_search`
// forwards to it, and simulate the real-world repro: a populated
// "projetos" namespace alongside an empty "default" one.
// `vi.hoisted()` is required here: `vi.mock()` factories are hoisted above
// all other module-level code (including `const` declarations), so a plain
// `const searchEntries = vi.fn(...)` referenced inside the factory below
// would throw a temporal-dead-zone error at mock-evaluation time.
const { searchEntries } = vi.hoisted(() => {
  const fn = vi.fn(async (opts: { namespace?: string }) => {
    // Faithful to the real implementations' `namespace || 'all'` semantics —
    // an omitted/undefined namespace (or the explicit 'all' sentinel) must
    // search across every namespace; anything else scopes to that namespace.
    const effectiveNamespace = opts.namespace || 'all';

    const allEntries = [
      { id: 'a1', key: 'note/alpha', content: 'ruflo memory probe', score: 0.9, namespace: 'projetos' },
      { id: 'a2', key: 'note/beta', content: 'ruflo memory probe', score: 0.8, namespace: 'patterns' },
    ];

    if (effectiveNamespace === 'all') {
      return { success: true, results: allEntries, searchTime: 1 };
    }
    // The 'default' namespace (and any other namespace with no data) is empty
    // — exactly the failure mode from the issue's memory_stats repro.
    const scoped = allEntries.filter((e) => e.namespace === effectiveNamespace);
    return { success: true, results: scoped, searchTime: 1 };
  });
  return { searchEntries: fn };
});

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async () => ({ embedding: new Array(384).fill(0.1), dimensions: 384, model: 'mock' })),
  storeEntry: vi.fn(async () => ({ success: true, id: 'mock-id' })),
  searchEntries,
  listEntries: vi.fn(async () => ({ success: true, entries: [], total: 0 })),
  getEntry: vi.fn(async () => null),
  deleteEntry: vi.fn(async () => ({ success: true })),
  getStats: vi.fn(async () => ({ totalEntries: 0 })),
  initializeDatabase: vi.fn(async () => ({ success: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true, version: '3.0.0' })),
  migrateFromLegacy: vi.fn(async () => ({ success: true, migrated: 0 })),
}));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const tool = memoryTools.find((t) => t.name === 'memory_search');

describe('memory_search namespace default (#2646, 3rd occurrence of #1123/#1131)', () => {
  beforeEach(() => {
    searchEntries.mockClear();
  });

  it('exists', () => {
    expect(tool).toBeDefined();
  });

  it('schema no longer documents a literal "default" namespace default (the misleading doc from the issue)', () => {
    const props = (tool!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    const desc = props.namespace?.description ?? '';
    expect(desc).not.toContain('default: "default"');
  });

  it('omitting namespace forwards namespace=undefined to the search layer, not the literal string "default"', async () => {
    await tool!.handler({ query: 'test query' });
    expect(searchEntries).toHaveBeenCalled();
    const callArgs = searchEntries.mock.calls[0][0] as { namespace?: string };
    // This is the exact assertion that would have failed against the
    // regressed code (`namespace = input.namespace || 'default'`).
    expect(callArgs.namespace).not.toBe('default');
    expect(callArgs.namespace).toBeUndefined();
  });

  it('reproduces the issue #2646 repro end-to-end: omitting namespace returns hits from ALL namespaces', async () => {
    const r = await tool!.handler({ query: 'ruflo memory probe' }) as { results: unknown[]; total: number };
    // Pre-fix this was `{ results: [], total: 0 }` even though entries existed
    // in "projetos"/"patterns" — exactly the memory_stats-vs-memory_search
    // mismatch reported in the issue.
    expect(r.total).toBe(2);
    expect(r.results.map((e) => (e as { key: string }).key)).toEqual(
      expect.arrayContaining(['note/alpha', 'note/beta']),
    );
  });

  it('an explicit namespace is still forwarded unchanged (back-compat with the issue\'s working case)', async () => {
    await tool!.handler({ query: 'test', namespace: 'projetos' });
    const callArgs = searchEntries.mock.calls[0][0] as { namespace?: string };
    expect(callArgs.namespace).toBe('projetos');

    const r = await tool!.handler({ query: 'test', namespace: 'projetos' }) as { results: unknown[]; total: number };
    expect(r.total).toBe(1);
    expect((r.results[0] as { key: string }).key).toBe('note/alpha');
  });
});
