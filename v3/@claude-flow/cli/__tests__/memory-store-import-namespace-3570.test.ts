/**
 * Regression for #3570 — `memory export` and `memory purge` reject a namespace
 * containing `../`, but `memory store` and `memory import` accepted and wrote
 * it, leaving a namespace the read-out and cleanup commands refuse to touch.
 * The write paths must reject it with the same message the export path uses.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
  checkMemoryInitialization: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  storeEntry: vi.fn(),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  resolveDbPath: (path?: string) => path || '/project/.swarm/memory.db',
  checkMemoryInitialization: mocks.checkMemoryInitialization,
  initializeMemoryDatabase: mocks.initializeMemoryDatabase,
  storeEntry: mocks.storeEntry,
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
}));

import { memoryCommand } from '../src/commands/memory.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const storeCommand = memoryCommand.subcommands!.find(c => c.name === 'store')!;
const importTool = memoryTools.find(t => t.name === 'memory_import')!;
const exportTool = memoryTools.find(t => t.name === 'memory_export')!;

const tempDir = mkdtempSync(join(tmpdir(), 'ruflo-ns-3570-'));
const writeImport = (name: string, entries: unknown[]) => {
  const p = join(tempDir, name);
  writeFileSync(p, JSON.stringify({ entries }));
  return p;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkMemoryInitialization.mockResolvedValue({ initialized: true });
  mocks.initializeMemoryDatabase.mockResolvedValue({ success: true });
  mocks.storeEntry.mockResolvedValue({ success: true, id: 'row-1' });
});

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe('namespace path-traversal validation on write paths (#3570)', () => {
  it('passes explicit structured native append controls and preserves default embeddings', async () => {
    await storeCommand.action!({ args: [], flags: { key: 'structured', value: 'state', embedding: false,
      requireNative: true, appendOnly: true, appendConditions: JSON.stringify([{ namespace: 'project', absent: true, latestPrefix: 'published-' }]) } } as any);
    expect(mocks.storeEntry).toHaveBeenLastCalledWith(expect.objectContaining({ generateEmbeddingFlag: false,
      requireNative: true, appendOnly: true, appendConditions: [{ namespace: 'project', absent: true, latestPrefix: 'published-' }] }));
    await storeCommand.action!({ args: [], flags: { key: 'ordinary', value: 'text' } } as any);
    expect(mocks.storeEntry).toHaveBeenLastCalledWith(expect.objectContaining({ generateEmbeddingFlag: true,
      requireNative: false, appendOnly: false }));
  });
  it('memory export already rejects the traversal namespace (the reference behaviour)', async () => {
    await expect(
      exportTool.handler({ outputPath: join(tempDir, 'x.json'), namespace: '../../..' }),
    ).rejects.toThrow(/namespace contains path traversal/);
  });

  it('memory store rejects a namespace containing ../ and writes nothing', async () => {
    const result = await storeCommand.action!({
      args: [],
      flags: { key: 'probe/x', value: 'v', namespace: '../../..' },
    } as any);
    expect(result?.success).toBe(false);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('memory store still accepts an ordinary namespace', async () => {
    const result = await storeCommand.action!({
      args: [],
      flags: { key: 'probe/x', value: 'v', namespace: 'project-a' },
    } as any);
    expect(result?.success).toBe(true);
    expect(mocks.storeEntry).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'project-a' }));
  });

  it('memory import rejects an entry carrying a ../ namespace with the export message and writes nothing', async () => {
    const inputPath = writeImport('bad.json', [
      { key: 'ok', namespace: 'project', value: 'fine' },
      { key: 'K', namespace: '../../..', value: 'v' },
    ]);
    await expect(importTool.handler({ inputPath })).rejects.toThrow(/namespace contains path traversal/);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('memory import still imports entries with ordinary namespaces', async () => {
    const inputPath = writeImport('good.json', [
      { key: 'a', namespace: 'project', value: 'one' },
      { key: 'b', value: 'two' },
    ]);
    const result: any = await importTool.handler({ inputPath });
    expect(result.imported.entries).toBe(2);
    expect(mocks.storeEntry).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Follow-up: close the remaining #3570 gaps. One validator (`validateIdentifier`)
// now governs namespaces on store (CLI + MCP), import, export and purge, and the
// MCP key rule (`DANGEROUS_KEY_PATTERN`) is shared with the CLI and import paths.
// ---------------------------------------------------------------------------
import * as initializer from '../src/memory/memory-initializer.js';

const mcpStoreTool = memoryTools.find(t => t.name === 'memory_store')!;
type Real = typeof import('../src/memory/memory-initializer.js');
const realPurge = async (namespace: string) => {
  const { purgeNamespace } = await vi.importActual<Real>('../src/memory/memory-initializer.js');
  // A namespace that passes validation may still fail later on the scratch
  // database; only a namespace error counts as a rejection.
  try { return await purgeNamespace({ namespace, dbPath: join(tempDir, 'purge.db') }); }
  catch (e) { return { success: false, error: String(e) }; }
};
const isNamespaceRejection = (msg?: string) => /namespace/i.test(msg ?? '');
const cliStore = async (flags: Record<string, unknown>) =>
  (await storeCommand.action!({ args: [], flags: { value: 'v', ...flags } } as any))?.success === true;
const mcpStore = async (args: Record<string, unknown>) => {
  try { const r: any = await mcpStoreTool.handler({ value: 'v', ...args }); return r?.success !== false; }
  catch { return false; }
};
const exportAccepts = async (namespace: string) => {
  vi.mocked(initializer.listEntries).mockResolvedValue({ success: true, entries: [], total: 0 } as any);
  try { await exportTool.handler({ outputPath: join(tempDir, 'rt.json'), namespace }); return true; }
  catch (e) { if (/namespace/.test(String(e))) return false; throw e; }
};
const purgeAccepts = async (namespace: string) => !isNamespaceRejection((await realPurge(namespace)).error);

describe('#3570 follow-up (a): keys use the shared MCP key rule on every write path', () => {
  it('CLI memory store rejects a key containing ../ and writes nothing', async () => {
    expect(await cliStore({ key: '../../escape', namespace: 'ok' })).toBe(false);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('memory import rejects an entry whose key contains ../ and writes nothing', async () => {
    const inputPath = writeImport('bad-key.json', [
      { key: 'fine', namespace: 'project', value: 'one' },
      { key: '../../escape', namespace: 'project', value: 'two' },
    ]);
    await expect(importTool.handler({ inputPath })).rejects.toThrow(/Key contains disallowed characters/);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('keys containing a plain / stay legal on CLI store, MCP store and import', async () => {
    expect(await cliStore({ key: 'probe/x', namespace: 'ok' })).toBe(true);
    expect(await mcpStore({ key: 'probe/x', namespace: 'ok' })).toBe(true);
    const inputPath = writeImport('slash-key.json', [{ key: 'probe/x', namespace: 'ok', value: 'v' }]);
    expect(((await importTool.handler({ inputPath })) as any).imported.entries).toBe(1);
  });
});

describe('#3570 follow-up (b): purge uses the same namespace validator', () => {
  it('purge accepts team:alice, which store and export already accept', async () => {
    expect(await purgeAccepts('team:alice')).toBe(true);
  });

  it('purge still rejects traversal and slash namespaces', async () => {
    expect(isNamespaceRejection((await realPurge('../../..')).error)).toBe(true);
    expect(isNamespaceRejection((await realPurge('proj/sub')).error)).toBe(true);
  });
});

describe('#3570 follow-up (c): MCP memory_store namespaces use the same validator', () => {
  it('MCP memory_store rejects proj/sub and writes nothing', async () => {
    expect(await mcpStore({ key: 'k', namespace: 'proj/sub' })).toBe(false);
    expect(mocks.storeEntry).not.toHaveBeenCalled();
  });

  it('MCP memory_store still accepts team:alice', async () => {
    expect(await mcpStore({ key: 'k', namespace: 'team:alice' })).toBe(true);
  });
});

describe('#3570 round trip: a namespace store accepts can always be exported and purged', () => {
  const candidates = [
    'default', 'project-a', 'team:alice', 'a.b', 'ns_1:2.3', 'proj/sub', '../../..',
    'x y', '-lead', '.hidden', 'with$dollar', 'a'.repeat(129),
  ];
  it.each(candidates)('%s: every write path agrees with export and purge', async ns => {
    const cli = await cliStore({ key: 'k', namespace: ns });
    const mcp = await mcpStore({ key: 'k', namespace: ns });
    const exp = await exportAccepts(ns);
    const purge = await purgeAccepts(ns);
    expect({ ns, cli, mcp, purge }).toEqual({ ns, cli: exp, mcp: exp, purge: exp });
  });
});
