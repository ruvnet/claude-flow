import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), init: vi.fn(), labels: vi.fn(), sibling: vi.fn(), json: vi.fn(), warning: vi.fn(), error: vi.fn(),
}));
vi.mock('../src/memory/memory-initializer.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/memory/memory-initializer.js')>(),
  listEntries: mocks.list,
  initializeMemoryDatabase: mocks.init,
  checkMemoryInitialization: mocks.labels,
  getHNSWStatus: () => ({ algorithm: 'brute-force', available: false }),
  loadEmbeddingModel: async () => ({ success: false, dimensions: 0 }),
}));
vi.mock('../src/memory/sibling-store.js', () => ({ countSiblingStoreRows: mocks.sibling }));
vi.mock('../src/output.js', () => ({ output: {
  printJson: mocks.json, printWarning: mocks.warning, printError: mocks.error,
  writeln: vi.fn(), printTable: vi.fn(), printInfo: vi.fn(), bold: (s: string) => s,
  warning: (s: string) => s, dim: (s: string) => s,
} }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), input: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ MCPClientError: class extends Error {}, callMCPTool: async (name: string, args: object) => {
  const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
  return memoryTools.find(tool => tool.name === name)!.handler(args);
} }));
const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const { memoryCommand } = await import('../src/commands/memory.js');
const stats = memoryTools.find(tool => tool.name === 'memory_stats')!;
const command = memoryCommand.subcommands!.find(command => command.name === 'stats')!;
let dir: string;
let selected: string;
const entries = [
  { namespace: 'selected', hasEmbedding: false, createdAt: '2026-03-01T00:00:00Z' },
  { namespace: 'selected', hasEmbedding: true, createdAt: '2026-01-01T00:00:00Z' },
];
beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'stats-selected-'));
  selected = join(dir, 'selected.db');
  writeFileSync(selected, 'store');
  writeFileSync(selected + '-wal', 'wal');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  mocks.labels.mockResolvedValue({ initialized: true, version: 'selected-version' });
  mocks.init.mockResolvedValue({ success: true });
  mocks.sibling.mockResolvedValue(null);
  mocks.list.mockImplementation(async ({ dbPath }) => ({ success: true, total: dbPath === selected ? 2 : 1, entries: dbPath === selected ? entries : entries.slice(0, 1) }));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
const run = (flags: Record<string, unknown> = {}) => command.action!({ cwd: dir, args: [], flags: { _: [], format: 'json', ...flags }, interactive: false });

describe('stats describes the selected store', () => {
  it('threads the optional MCP path through every page and metadata probe', async () => {
    const result = await stats.handler({ dbPath: selected }) as any;
    expect(result.totalEntries).toBe(2);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ dbPath: selected }));
    expect(mocks.labels).toHaveBeenCalledWith(selected);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(result.location).toBe(selected);
    expect(result.totalSize).toBe('8 B');
    expect(result.oldestEntry).toBe('2026-01-01T00:00:00.000Z');
    expect(result.newestEntry).toBe('2026-03-01T00:00:00.000Z');
  });

  it('honors --path over the environment and includes sibling disclosure in JSON', async () => {
    vi.stubEnv('CLAUDE_FLOW_DB_PATH', join(dir, 'other.db'));
    mocks.sibling.mockResolvedValue({ path: join(dir, 'agentdb-memory.db'), rows: 9 });
    const result = await run({ path: selected }) as any;
    expect(result.success).toBe(true);
    expect(result.data.entries.total).toBe(2);
    expect(result.data.storage).toEqual({ total: '8 B', location: selected });
    expect(result.data.unreadStore.rows).toBe(9);
    expect(mocks.sibling).toHaveBeenCalledWith(selected);
  });

  it('honors CLAUDE_FLOW_DB_PATH when --path is absent', async () => {
    vi.stubEnv('CLAUDE_FLOW_DB_PATH', selected);
    const result = await run() as any;
    expect(result.data.entries.total).toBe(2);
    expect(result.data.storage.location).toBe(selected);
  });

  it('reports unavailable stores as a failed command, including JSON mode', async () => {
    mocks.list.mockResolvedValue({ success: false, entries: [], total: 0, error: 'read refused' });
    const result = await run({ path: selected });
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('read refused'));
  });

  it('keeps an empty store distinct from an unavailable one', async () => {
    mocks.list.mockResolvedValue({ success: true, entries: [], total: 0 });
    const result = await stats.handler({ dbPath: selected }) as any;
    expect(result.totalEntries).toBe(0);
    expect(result.oldestEntry).toBeNull();
    expect(result.newestEntry).toBeNull();
  });
  it('keeps the selected path on later pages', async () => {
    mocks.list.mockImplementation(async ({ dbPath, offset }) => ({
      success: true, total: 10001,
      entries: dbPath === selected ? Array.from({ length: offset === 0 ? 10000 : 1 }, () => entries[0]) : [],
    }));
    const result = await stats.handler({ dbPath: selected }) as any;
    expect(result.entriesCounted).toBe(10001);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.calls.every(([options]) => options.dbPath === selected)).toBe(true);
  });

  it('discloses sibling rows in text output too', async () => {
    mocks.sibling.mockResolvedValue({ path: join(dir, 'agentdb-memory.db'), rows: 9 });
    expect((await run({ path: selected, format: 'text' }))?.success).toBe(true);
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('9 entries'));
  });

  it.each([42, '   '])('rejects invalid dbPath %j instead of inspecting another store', async dbPath => {
    const result = await stats.handler({ dbPath }) as any;
    expect(result.available).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each([
    [1767225600000, 1772323200000],
    ['1767225600000', '1772323200000'],
    ['2026-01-01T00:00:00Z', 1772323200000],
  ])('normalizes mixed stored timestamp formats %j / %j', async (first, last) => {
    mocks.list.mockResolvedValue({ success: true, total: 2, entries: [
      { ...entries[0], createdAt: last }, { ...entries[1], createdAt: first },
    ] });
    const result = await stats.handler({ dbPath: selected }) as any;
    expect(result.oldestEntry).toBe('2026-01-01T00:00:00.000Z');
    expect(result.newestEntry).toBe('2026-03-01T00:00:00.000Z');
  });

  it('accepts epoch zero and ignores invalid or out-of-range timestamps', async () => {
    mocks.list.mockResolvedValue({ success: true, total: 5, entries: [0, '0', 'bad date', 1e20, undefined].map(createdAt => ({ ...entries[0], createdAt })) });
    const result = await stats.handler({ dbPath: selected }) as any;
    expect(result.oldestEntry).toBe('1970-01-01T00:00:00.000Z');
    expect(result.newestEntry).toBe('1970-01-01T00:00:00.000Z');
  });

});
