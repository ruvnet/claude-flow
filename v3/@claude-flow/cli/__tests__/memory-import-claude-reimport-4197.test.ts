import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Models the real store: without upsert an existing key is rejected.
const layer = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(async (o: { key: string; value: string; namespace: string; upsert?: boolean }) => {
    const id = `${o.namespace}/${o.key}`;
    if (layer.rows.has(id) && !o.upsert) return { success: false, id: '', error: `Key already exists: ${o.key}` };
    layer.rows.set(id, o.value);
    return { success: true, id };
  }),
  searchEntries: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  generateEmbedding: vi.fn(async () => ({ backend: 'mock' })),
}));
vi.mock('../src/mcp-tools/validate-input.js', () => ({ validateIdentifier: () => ({ valid: true }) }));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find(t => t.name === 'memory_import_claude')!;

let home: string;
let originalHome: string | undefined;
const writeMemory = (contents: string) => {
  const memoryDir = join(home, '.claude', 'projects', '-test-project', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'MEMORY.md'), contents);
};

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'ruflo-claude-reimport-4197-'));
  process.env.HOME = home;
  layer.rows.clear();
});
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('memory_import_claude re-import (#4197)', () => {
  it('imports an already-imported, edited file again instead of failing', async () => {
    writeMemory(`## Workflow\n${'first version of the note '.repeat(10)}`);
    expect(await importer.handler({ projectPath: '/test/project' })).toMatchObject({ success: true, imported: 1, skipped: 0 });

    writeMemory(`## Workflow\n${'edited version of the note '.repeat(10)}`);
    const again = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; imported: number; skipped: number };
    expect(again).toMatchObject({ success: true, imported: 1, skipped: 0 });
    expect([...layer.rows.values()][0]).toContain('edited version');
  });

  it('says why a file was skipped when the store rejects it', async () => {
    writeMemory(`## Workflow\n${'a long memory section '.repeat(20)}`);
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    (storeEntry as any).mockResolvedValueOnce({ success: false, id: '', error: 'store unavailable' });
    const result = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; skipped: number; errors?: string[] };
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.errors?.[0]).toContain('store unavailable');
  });
});
