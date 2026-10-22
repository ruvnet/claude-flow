/**
 * #3566 — `memory search` and `memory retrieve` disclosed the sibling AgentDB
 * store only when they found nothing. A partial hit ("Found 1 results") read as
 * complete while the rows the MCP path wrote sat unread next door.
 *
 * Also covers the import counter: `memory import` reported "Vectors: 0" while
 * every imported value was re-embedded.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  search: vi.fn(), list: vi.fn(), get: vi.fn(), store: vi.fn(), sibling: vi.fn(),
  warning: vi.fn(), json: vi.fn(), error: vi.fn(),
}));
vi.mock('../src/memory/memory-initializer.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/memory/memory-initializer.js')>(),
  resolveDbPath: (p?: string) => p || '/project/.swarm/memory.db',
  searchEntries: mocks.search,
  listEntries: mocks.list,
  getEntry: mocks.get,
  storeEntry: mocks.store,
  checkMemoryInitialization: async () => ({ initialized: true }),
  initializeMemoryDatabase: async () => ({ success: true }),
}));
vi.mock('../src/memory/sibling-store.js', () => ({ countSiblingStoreRows: mocks.sibling }));
vi.mock('../src/output.js', () => ({ output: {
  printJson: mocks.json, printWarning: mocks.warning, printError: mocks.error,
  writeln: vi.fn(), printTable: vi.fn(), printInfo: vi.fn(), printSuccess: vi.fn(), printBox: vi.fn(), printList: vi.fn(),
  bold: (s: string) => s, dim: (s: string) => s, warning: (s: string) => s,
} }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), input: vi.fn(), confirm: vi.fn() }));

const { memoryCommand } = await import('../src/commands/memory.js');
const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const search = memoryCommand.subcommands!.find(c => c.name === 'search')!;
const retrieve = memoryCommand.subcommands!.find(c => c.name === 'retrieve')!;
const importTool = memoryTools.find(t => t.name === 'memory_import')!;

const SIBLING = { path: '/project/.swarm/agentdb-memory.db', rows: 2 };
const hit = { id: 'e1', key: 'edge-gateway', content: 'edge gateway tokens', score: 0.81, namespace: 'default' };
const run = (cmd: typeof search, flags: Record<string, unknown>) =>
  cmd.action!({ cwd: '/project', args: [], flags: { _: [], ...flags }, interactive: false } as never);
const siblingWarnings = () => mocks.warning.mock.calls.map(c => String(c[0])).filter(m => m.includes(SIBLING.path));

const dir = mkdtempSync(join(tmpdir(), 'mem-3566-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sibling.mockResolvedValue(SIBLING);
  mocks.search.mockResolvedValue({ success: true, results: [hit], searchTime: 1 });
  mocks.list.mockResolvedValue({ success: true, entries: [], total: 0 });
  mocks.get.mockResolvedValue({ success: true, found: true, entry: { ...hit, accessCount: 0, createdAt: '', updatedAt: '', hasEmbedding: true, tags: [] } });
});

describe('#3566 search and retrieve disclose the sibling store on partial hits', () => {
  it('search with one hit discloses the 2 unread sibling entries as a partial result', async () => {
    const result = await run(search, { query: 'edge gateway tokens' }) as { success: boolean; data: unknown[] };
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const w = siblingWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Partial result: 1 match/);
    expect(w[0]).toContain('2 entries');
  });

  it('search --format json keeps stdout JSON-only and still warns on stderr', async () => {
    await run(search, { query: 'edge gateway tokens', format: 'json' });
    expect(mocks.json).toHaveBeenCalledTimes(1);
    expect(siblingWarnings()).toHaveLength(1);
  });

  it('keyword search with a hit discloses the sibling too', async () => {
    mocks.list.mockResolvedValue({ success: true, total: 1, entries: [{ key: 'edge-gateway', namespace: 'default', content: 'edge gateway tokens' }] });
    await run(search, { query: 'edge', type: 'keyword' });
    expect(siblingWarnings()).toHaveLength(1);
  });

  it('retrieve of a found key discloses the sibling store', async () => {
    const result = await run(retrieve, { key: 'edge-gateway' }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(siblingWarnings()).toHaveLength(1);
  });

  it('the empty branch is unchanged: no results still discloses the sibling', async () => {
    mocks.search.mockResolvedValue({ success: true, results: [], searchTime: 1 });
    await run(search, { query: 'purple aardvark telemetry protocol' });
    const w = siblingWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^This read covered one store\./);
  });

  it('no sibling rows means no disclosure on a hit', async () => {
    mocks.sibling.mockResolvedValue(null);
    await run(search, { query: 'edge gateway tokens' });
    await run(retrieve, { key: 'edge-gateway' });
    expect(mocks.warning.mock.calls.some(c => /entries are in/.test(String(c[0])))).toBe(false);
  });
});

describe('memory import reports the vectors it actually wrote', () => {
  it('counts re-embedded entries instead of a constant 0', async () => {
    const inputPath = join(dir, 'export.json');
    writeFileSync(inputPath, JSON.stringify({ entries: [
      { key: 'a', namespace: 'p', value: 'one' },
      { key: 'b', namespace: 'p', value: 'two' },
      { key: 'c', namespace: 'p', value: 'three' },
    ] }));
    mocks.store
      .mockResolvedValueOnce({ success: true, id: '1', embedding: { dimensions: 384, model: 'm' } })
      .mockResolvedValueOnce({ success: true, id: '2', embedding: { dimensions: 384, model: 'm' } })
      .mockResolvedValueOnce({ success: true, id: '3' });
    const result = await importTool.handler({ inputPath }) as { imported: { entries: number; vectors: number } };
    expect(result.imported.entries).toBe(3);
    expect(result.imported.vectors).toBe(2);
  });
});
