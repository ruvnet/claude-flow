import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  bridgeAdd: vi.fn(),
  bridgeDelete: vi.fn(),
  bridgeStore: vi.fn(),
  vectorIds: new Set<string>(),
  vectorDelete: vi.fn(),
  vectorInsert: vi.fn(),
}));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeAddToHNSW: mocks.bridgeAdd,
  bridgeDeleteEntry: mocks.bridgeDelete,
  bridgeStoreEntry: mocks.bridgeStore,
}));

vi.mock('ruvector', () => {
  const VectorDb = class {
    async len(): Promise<number> { return mocks.vectorIds.size; }
    async insert(value: { id?: string }): Promise<void> {
      mocks.vectorInsert(value);
      if (value.id) mocks.vectorIds.add(value.id);
    }
    async delete(id: string): Promise<boolean> {
      mocks.vectorDelete(id);
      return mocks.vectorIds.delete(id);
    }
    async search(): Promise<unknown[]> { return []; }
  };
  return { VectorDb, default: { VectorDb } };
});

describe('persistent HNSW write-through', () => {
  let tmp = '';
  let previousRoot: string | undefined;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-hnsw-durability-'));
    previousRoot = process.env.CLAUDE_FLOW_MEMORY_PATH;
    process.env.CLAUDE_FLOW_MEMORY_PATH = tmp;
    const Database = (await import('better-sqlite3')).default;
    const sqlite = new Database(path.join(tmp, 'memory.db'));
    sqlite.exec(`
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        namespace TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        status TEXT NOT NULL
      );
      INSERT INTO memory_entries
        (id, key, namespace, content, embedding, status)
      VALUES
        ('stored-id', 'durable-key', 'durable', 'durable-value', '[1,0]', 'active');
    `);
    sqlite.close();
    mocks.bridgeAdd.mockReset().mockResolvedValue(true);
    mocks.bridgeDelete.mockReset().mockResolvedValue({
      success: true,
      deleted: true,
      key: 'durable-key',
      namespace: 'durable',
      remainingEntries: 0,
      entryId: 'stored-id',
    });
    mocks.vectorIds.clear();
    mocks.vectorDelete.mockReset();
    mocks.vectorInsert.mockReset();
    mocks.bridgeStore.mockReset().mockResolvedValue({
      success: true,
      id: 'stored-id',
      embedding: { dimensions: 2, model: 'test' },
      rawEmbedding: [1, 0],
    });
    const memory = await import('../src/memory/memory-initializer.js');
    memory._resetMemoryRootCache();
    memory.clearHNSWIndex();
  });

  afterEach(async () => {
    const memory = await import('../src/memory/memory-initializer.js');
    memory.clearHNSWIndex();
    memory._resetMemoryRootCache();
    if (previousRoot === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    else process.env.CLAUDE_FLOW_MEMORY_PATH = previousRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stores once and inserts the returned embedding into the real vector index', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({
      key: 'durable-key',
      value: 'durable-value',
      namespace: 'durable',
    });

    expect(result.success).toBe(true);
    expect(result.indexUpdated).toBe(true);
    expect(mocks.bridgeStore).toHaveBeenCalledTimes(1);
    expect(mocks.bridgeAdd).not.toHaveBeenCalled();
    expect(mocks.vectorInsert).toHaveBeenCalledTimes(1);
    expect(mocks.vectorInsert).toHaveBeenCalledWith({
      id: 'stored-id',
      vector: new Float32Array([1, 0]),
    });
    expect(fs.existsSync(path.join(tmp, 'hnsw.metadata.json'))).toBe(true);
  });

  it('reports index degradation and invalidates partial metadata after an insert failure', async () => {
    mocks.vectorInsert.mockImplementationOnce(() => { throw new Error('index write failed'); });
    const { storeEntry } = await import('../src/memory/memory-initializer.js');

    const result = await storeEntry({
      key: 'degraded-key',
      value: 'degraded-value',
      namespace: 'durable',
    });

    expect(result.success).toBe(true);
    expect(result.indexUpdated).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'hnsw.metadata.json'))).toBe(false);
  });

  it('removes a deleted canonical row from the persisted graph and metadata', async () => {
    const { deleteEntry, storeEntry } = await import('../src/memory/memory-initializer.js');
    const stored = await storeEntry({
      key: 'durable-key',
      value: 'durable-value',
      namespace: 'durable',
    });
    expect(stored.indexUpdated).toBe(true);

    const deleted = await deleteEntry({ key: 'durable-key', namespace: 'durable' });
    expect(deleted.deleted).toBe(true);
    expect(mocks.vectorDelete).toHaveBeenCalledWith('stored-id');
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'hnsw.metadata.json'), 'utf8'))).toEqual([]);
  });

  it('reconciles persisted metadata against authoritative SQLite before search', async () => {
    const memory = await import('../src/memory/memory-initializer.js');
    const stored = await memory.storeEntry({
      key: 'durable-key',
      value: 'durable-value',
      namespace: 'durable',
    });
    expect(stored.indexUpdated).toBe(true);

    const Database = (await import('better-sqlite3')).default;
    const sqlite = new Database(path.join(tmp, 'memory.db'));
    sqlite.prepare(`UPDATE memory_entries SET content = ? WHERE id = 'stored-id'`).run('authoritative-update');
    sqlite.close();
    memory.clearHNSWIndex();
    mocks.vectorInsert.mockClear();

    await memory.searchHNSWIndex([1, 0], { dbPath: path.join(tmp, 'memory.db') });

    expect(mocks.vectorDelete).toHaveBeenCalledWith('stored-id');
    expect(mocks.vectorInsert).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(fs.readFileSync(path.join(tmp, 'hnsw.metadata.json'), 'utf8'));
    expect(metadata[0][1].content).toBe('authoritative-update');
  });

  it('force-rebuilds every embedded row without a hidden 10,000-row ceiling', async () => {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.join(tmp, 'large-memory.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        namespace TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        status TEXT NOT NULL
      )
    `);
    const insert = db.prepare(
      `INSERT INTO memory_entries (id, key, namespace, content, embedding, status)
       VALUES (?, ?, 'large', ?, '[1,0]', 'active')`,
    );
    db.transaction(() => {
      for (let i = 0; i < 10_001; i++) insert.run(`id-${i}`, `key-${i}`, `content-${i}`);
    })();
    db.close();

    mocks.vectorInsert.mockClear();
    const { clearHNSWIndex, getHNSWIndex } = await import('../src/memory/memory-initializer.js');
    clearHNSWIndex();
    const index = await getHNSWIndex({ dbPath, dimensions: 2, forceRebuild: true });

    expect(index).not.toBeNull();
    expect(mocks.vectorInsert).toHaveBeenCalledTimes(10_001);
    expect(index!.entries.has('id-10000')).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'large-memory.db.hnsw.metadata.json'))).toBe(true);
  });
});
