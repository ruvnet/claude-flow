import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const layer = vi.hoisted(() => ({ listEntries: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  listEntries: layer.listEntries, storeEntry: vi.fn(), searchEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(), checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
}));
const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const exporter = memoryTools.find(t => t.name === 'memory_export')!;
let dir: string;
let outputPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-export-pages-'));
  outputPath = join(dir, 'backup.json');
  writeFileSync(outputPath, 'existing complete backup');
  layer.listEntries.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const entry = (key: string) => ({ id: key, key, namespace: 'notes', content: `body ${key}`, hasEmbedding: false });
describe('memory export completeness', () => {
  it.each([false, true])('preserves the prior export when a read fails (after a page: %s)', async afterPage => {
    if (afterPage) layer.listEntries.mockResolvedValueOnce({ success: true, entries: [entry('first')], total: 2 });
    layer.listEntries.mockResolvedValue({ success: false, entries: [], total: 0, error: 'database read refused' });
    const result = await exporter.handler({ outputPath, namespace: 'notes' });
    expect(result).toMatchObject({ error: expect.stringContaining('database read refused') });
    expect(readFileSync(outputPath, 'utf8')).toBe('existing complete backup');
  });
  it('reads every backend page and keeps namespace/content options', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => entry(String(i)));
    layer.listEntries.mockImplementation(async ({ offset = 0 }) => ({ success: true, entries: rows.slice(offset, offset + 2), total: 5 }));
    const result = await exporter.handler({ outputPath, namespace: 'notes' });
    expect(result).toMatchObject({ exported: { entries: 5 } });
    const data = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(data.count).toBe(5);
    expect(data.entries.map((e: {value: string}) => e.value)).toEqual(rows.map(e => e.content));
    expect(layer.listEntries.mock.calls.map(([options]) => options.offset)).toEqual([0, 2, 4]);
    expect(layer.listEntries.mock.calls.every(([options]) => options.namespace === 'notes' && options.includeContent)).toBe(true);
  });
  it('refuses an incomplete read instead of overwriting with a partial snapshot', async () => {
    layer.listEntries.mockResolvedValueOnce({ success: true, entries: [entry('first')], total: 2 });
    layer.listEntries.mockResolvedValue({ success: true, entries: [], total: 2 });
    expect(await exporter.handler({ outputPath })).toMatchObject({ error: expect.stringMatching(/incomplete/i) });
    expect(readFileSync(outputPath, 'utf8')).toBe('existing complete backup');
  });
  it('allows a successfully read empty store', async () => {
    layer.listEntries.mockResolvedValue({ success: true, entries: [], total: 0 });
    expect(await exporter.handler({ outputPath })).toMatchObject({ exported: { entries: 0 } });
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).entries).toEqual([]);
  });
});
