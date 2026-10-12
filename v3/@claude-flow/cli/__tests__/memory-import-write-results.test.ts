import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const layer = vi.hoisted(() => ({ storeEntry: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: layer.storeEntry,
  searchEntries: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));
const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find(t => t.name === 'memory_import')!;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-import-result-'));
  layer.storeEntry.mockReset().mockResolvedValue({ success: true, id: 'saved' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function file() {
  const inputPath = join(dir, 'export.json');
  writeFileSync(inputPath, JSON.stringify({ schema: 'ruflo-memory-export/v1', entries: [
    { key: 'first', namespace: 'notes', value: 'first value' },
    { key: 'second', namespace: 'notes', value: 'second value' },
  ] }));
  return inputPath;
}
describe('JSON memory import write acknowledgments', () => {
  it.each(['resolved failure', 'thrown failure'])('reports %s without counting a rejected write as imported', async mode => {
    if (mode === 'resolved failure') layer.storeEntry.mockResolvedValueOnce({ success: false, id: '', error: 'database write refused' });
    else layer.storeEntry.mockRejectedValueOnce(new Error('database write refused'));
    const result = await importer.handler({ inputPath: file() });
    expect(result).toMatchObject({ success: false, imported: { entries: 1 }, failed: 1 });
    expect(JSON.stringify(result)).toContain('database write refused');
    expect(layer.storeEntry).toHaveBeenCalledTimes(2);
  });
  it('reports all rejected writes as failures, not a completed import', async () => {
    layer.storeEntry.mockResolvedValue({ success: false, error: 'conflict' });
    expect(await importer.handler({ inputPath: file(), merge: false }))
      .toMatchObject({ success: false, imported: { entries: 0 }, failed: 2 });
    expect(layer.storeEntry.mock.calls.every(([options]) => options.upsert === false)).toBe(true);
  });
  it('counts acknowledged writes normally', async () => {
    expect(await importer.handler({ inputPath: file() }))
      .toMatchObject({ success: true, imported: { entries: 2 }, failed: 0 });
  });
});
