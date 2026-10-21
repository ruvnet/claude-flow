import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const layer = vi.hoisted(() => ({
  storeEntry: vi.fn(async (_options: { value: string }): Promise<{ success: boolean; id: string; error?: string }> => ({ success: true, id: 'stored' })),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: layer.storeEntry,
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  generateEmbedding: vi.fn(async () => ({ backend: 'mock' })),
}));

vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
}));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find((tool) => tool.name === 'memory_import_claude')!;

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'ruflo-claude-import-3217-'));
  process.env.HOME = home;
  layer.storeEntry.mockClear();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function writeMemory(contents: string): void {
  const memoryDir = join(home, '.claude', 'projects', '-test-project', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'MEMORY.md'), contents);
}

describe('#3217 Claude memory import preserves complete sections', () => {
  it.each([
    ['a file without level-two headings', `# Project memory\n${'retained memory tail '.repeat(320)}`],
    ['a long level-two section', `## Workflow\n${'retained memory tail '.repeat(320)}`],
  ])('stores the full content of %s', async (_name, source) => {
    writeMemory(source);

    const result = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; imported: number };

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(layer.storeEntry).toHaveBeenCalledTimes(1);
    const value = layer.storeEntry.mock.calls[0][0].value;
    expect(value).toBe(source.replace(/^## Workflow\n/, '').trim());
    expect(value.length).toBeGreaterThan(4096);
    expect(value).toContain('retained memory tail ');
    expect(value.endsWith('tail')).toBe(true);
  });

  it('does not report success when the store rejects a section', async () => {
    writeMemory(`## Workflow\n${'a long memory section '.repeat(320)}`);
    layer.storeEntry.mockResolvedValueOnce({ success: false, id: '', error: 'store unavailable' });

    const result = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; imported: number; skipped: number };

    expect(result.success).toBe(false);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
