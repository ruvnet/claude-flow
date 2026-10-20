/** Regression for #3196: CLI import must write to the same resolved store as CLI store. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
  callMCPTool: vi.fn(),
  checkMemoryInitialization: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  storeEntry: vi.fn(),
}));

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: mocks.callMCPTool,
  MCPClientError: class MCPClientError extends Error {},
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

const importCommand = memoryCommand.subcommands!.find(command => command.name === 'import')!;
const importTool = memoryTools.find(tool => tool.name === 'memory_import')!;
const tempDir = mkdtempSync(join(tmpdir(), 'ruflo-import-3196-'));
const importPath = join(tempDir, 'export.json');
writeFileSync(importPath, JSON.stringify({
  entries: [{ key: 'remember-me', namespace: 'project', value: 'persisted' }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callMCPTool.mockResolvedValue({
    inputPath: importPath,
    imported: { entries: 1, vectors: 0, patterns: 0 },
    skipped: 0,
    duration: 1,
  });
  mocks.checkMemoryInitialization.mockResolvedValue({ initialized: false });
  mocks.initializeMemoryDatabase.mockResolvedValue({ success: true });
  mocks.storeEntry.mockResolvedValue({ success: true, id: 'row-1' });
});

describe('memory import database selection', () => {
  afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

  it('exposes --path and sends the resolved path to the MCP import tool', async () => {
    expect(importCommand.options?.some(option => option.name === 'path')).toBe(true);
    await importCommand.action!({
      args: [],
      flags: { input: importPath, path: '/project/custom.db' },
    } as any);
    expect(mocks.callMCPTool).toHaveBeenCalledWith('memory_import', expect.objectContaining({
      dbPath: '/project/custom.db',
    }));
  });

  it('uses the same default database as CLI store when --path is omitted', async () => {
    await importCommand.action!({
      args: [],
      flags: { input: importPath },
    } as any);
    expect(mocks.callMCPTool).toHaveBeenCalledWith('memory_import', expect.objectContaining({
      dbPath: '/project/.swarm/memory.db',
    }));
  });

  it('initializes and writes the selected file rather than the bridge fallback', async () => {
    const result = await importTool.handler({
      inputPath: importPath,
      dbPath: '/project/custom.db',
    }) as { imported: { entries: number }; skipped: number };
    expect(mocks.checkMemoryInitialization).toHaveBeenCalledWith('/project/custom.db');
    expect(mocks.initializeMemoryDatabase).toHaveBeenCalledWith(expect.objectContaining({ dbPath: '/project/custom.db' }));
    expect(mocks.storeEntry).toHaveBeenCalledWith(expect.objectContaining({
      key: 'remember-me', dbPath: '/project/custom.db',
    }));
    expect(result.imported.entries).toBe(1);
  });

  it('does not claim failed bridge writes were imported', async () => {
    mocks.storeEntry.mockResolvedValue({ success: false, error: 'database unavailable' });
    const result = await importTool.handler({
      inputPath: importPath,
      dbPath: '/project/custom.db',
    }) as { success: boolean; imported: { entries: number }; skipped: number; failed: number; error?: string };
    expect(result.imported.entries).toBe(0);
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.error).toContain('database unavailable');
  });
});
