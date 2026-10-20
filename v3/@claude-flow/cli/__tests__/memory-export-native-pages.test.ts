import { afterAll, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ dbPath: '' }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(), searchEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(), initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  listEntries: async (options: Record<string, unknown>) => {
    const { bridgeListEntries } = await import('../src/memory/memory-bridge.js');
    // Force small pages, but execute the production native SQL and OFFSET.
    return bridgeListEntries({ ...options, dbPath: state.dbPath, limit: 2 });
  },
}));
const dir = mkdtempSync(join(tmpdir(), 'ruflo-export-native-'));
state.dbPath = join(dir, 'memory.db');
const db = new Database(state.dbPath);
afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
it('exports every native SQLite page with actual values and namespace filtering', async () => {
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT, type TEXT DEFAULT 'semantic',
    embedding TEXT, embedding_model TEXT DEFAULT 'local', embedding_dimensions INTEGER,
    tags TEXT, metadata TEXT, owner_id TEXT, created_at INTEGER, updated_at INTEGER,
    expires_at INTEGER, last_accessed_at INTEGER, access_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', provenance_type TEXT DEFAULT 'unknown', UNIQUE(namespace,key)
  )`);
  for (let i = 0; i < 6; i++) db.prepare('INSERT INTO memory_entries(id,key,namespace,content,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(String(i), `key-${i}`, i === 5 ? 'other' : 'notes', `full body ${i}`, i + 1, i + 1);
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: db, embedder: null }), get: () => null });
  const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
  const outputPath = join(dir, 'export.json');
  const result = await memoryTools.find(t => t.name === 'memory_export')!.handler({ outputPath, namespace: 'notes' });
  expect(result).toMatchObject({ exported: { entries: 5 } });
  const rows = JSON.parse(readFileSync(outputPath, 'utf8')).entries;
  expect(rows.map((row: {key:string}) => row.key)).toEqual(['key-4', 'key-3', 'key-2', 'key-1', 'key-0']);
  expect(rows.map((row: {value:string}) => row.value)).toEqual(['full body 4', 'full body 3', 'full body 2', 'full body 1', 'full body 0']);
});
