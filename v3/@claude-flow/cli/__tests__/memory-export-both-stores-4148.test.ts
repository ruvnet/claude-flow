import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cliStore: '', stores: {} as Record<string, unknown[] | 'error'> }));
const entry = (key: string, namespace: string, updatedAt: string, content = key) => ({
  id: `${namespace}/${key}`, key, namespace, size: content.length, accessCount: 0,
  createdAt: updatedAt, updatedAt, hasEmbedding: false, content,
});
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(), searchEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(), initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  resolveDbPath: () => state.cliStore,
  listEntries: async (o: { dbPath?: string; namespace?: string; offset?: number }) => {
    const rows = state.stores[o.dbPath ?? 'default'];
    if (rows === 'error') return { success: false, entries: [], total: 0, error: 'RFE1 key missing' };
    const filtered = (rows ?? []).filter((r) => !o.namespace || (r as { namespace: string }).namespace === o.namespace);
    return { success: true, entries: (o.offset ?? 0) > 0 ? [] : filtered, total: filtered.length };
  },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-export-4148-'));
  state.cliStore = join(dir, 'memory.db');
  writeFileSync(state.cliStore, 'x'); // the CLI store exists on disk
  state.stores = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function exportTo(input: Record<string, unknown>) {
  const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
  const outputPath = join(dir, 'out.json');
  const result = await memoryTools.find(t => t.name === 'memory_export')!.handler({ outputPath, ...input }) as Record<string, any>;
  return { result, rows: result.error ? [] : JSON.parse(readFileSync(outputPath, 'utf8')).entries as Array<{ key: string; namespace: string; value: string }> };
}

describe('memory_export covers every store the CLI reads (#4148)', () => {
  it('exports the 591 claude-memories rows that only the CLI store holds (the default reader had 0)', async () => {
    state.stores.default = [entry('agentdb-only', 'patterns', '2026-10-01')];
    state.stores[state.cliStore] = Array.from({ length: 591 }, (_, i) => entry(`m${i}`, 'claude-memories', '2026-10-02'));
    const { result, rows } = await exportTo({ namespace: 'claude-memories' });
    expect(result.exported.entries).toBe(591);
    expect(rows).toHaveLength(591);
    expect(result.stores).toEqual([{ store: 'default', entries: 0 }, { store: state.cliStore, entries: 591 }]);
  });

  it('merges both stores and keeps the newest copy of a duplicated (namespace, key)', async () => {
    state.stores.default = [entry('shared', 'notes', '2026-10-01', 'old'), entry('only-a', 'notes', '2026-10-01')];
    state.stores[state.cliStore] = [entry('shared', 'notes', '2026-10-05', 'new'), entry('only-b', 'notes', '2026-10-01')];
    const { rows, result } = await exportTo({});
    expect(rows.map(r => r.key).sort()).toEqual(['only-a', 'only-b', 'shared']);
    expect(rows.find(r => r.key === 'shared')!.value).toBe('new');
    expect(result.exported.entries).toBe(3);
  });

  it('an unreadable CLI store is a warning, not a silent partial success', async () => {
    state.stores.default = [entry('a', 'notes', '2026-10-01')];
    state.stores[state.cliStore] = 'error';
    const { result } = await exportTo({});
    expect(result.exported.entries).toBe(1);
    expect(result.warnings?.[0]).toMatch(/Could not read the CLI store .*RFE1 key missing/);
  });

  it('works unchanged when there is no separate CLI store file', async () => {
    rmSync(state.cliStore);
    state.stores.default = [entry('a', 'notes', '2026-10-01')];
    const { result } = await exportTo({});
    expect(result.exported.entries).toBe(1);
    expect(result.stores).toEqual([{ store: 'default', entries: 1 }]);
    expect(result.warnings).toBeUndefined();
  });
});
