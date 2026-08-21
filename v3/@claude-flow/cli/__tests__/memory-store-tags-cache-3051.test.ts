/**
 * Regression guard for #3051 — `memory_store` accepted `tags` and returned
 * `success: true`, but a subsequent `memory_retrieve` (or `memory_list`)
 * saw `tags: []`.
 *
 * Root cause was in `bridgeStoreEntry`: after the DB insert (which DOES
 * serialize tags correctly into the `tags` column), the write-through
 * cache set at the end of the write path stored only a partial entry
 * shape — `{ id, key, namespace, content, embedding }` — with no `tags`.
 * The very next `bridgeGetEntry` hit that cache and returned
 * `tags: cached.tags || []` = `[]`, i.e. the tags looked lost even though
 * they were on disk.
 *
 * The fix replaces the partial write-through with cache invalidation, so
 * the next read re-fetches the row via the DB reader (which correctly
 * parses the `tags` JSON column) and repopulates the cache with the
 * full shape.
 */

import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-3051-tags-cache-'));
const dbPath = join(root, 'memory.db');

function makeDb(): Database.Database {
  const d = new Database(dbPath);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_dimensions INTEGER,
      embedding_model TEXT,
      tags TEXT,
      metadata TEXT,
      provenance_type TEXT DEFAULT 'unknown',
      created_at INTEGER,
      updated_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      expires_at INTEGER,
      status TEXT DEFAULT 'active',
      UNIQUE(namespace, key)
    );
    CREATE TABLE IF NOT EXISTS vector_indexes (
      id TEXT PRIMARY KEY,
      name TEXT,
      dimensions INTEGER
    );
  `);
  return d;
}

/** Minimal cache wrapper matching what cacheGet/cacheSet/cacheInvalidate expect. */
function makeTieredCache() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
    size: () => store.size,
  };
}

let db: Database.Database | null = null;

afterAll(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#3051 — memory_store tags survive the write-through cache path', () => {
  it('immediate bridgeGetEntry after bridgeStoreEntry returns the real tags, not []', async () => {
    const {
      __setMemoryBridgeRegistryForTests,
      bridgeStoreEntry,
      bridgeGetEntry,
    } = await import('../src/memory/memory-bridge.js');

    db = makeDb();
    const cache = makeTieredCache();

    // Registry that yields the DB context plus the tieredCache the bridge
    // reads/writes/invalidates. No embedder — we disable embeddings on the
    // write below so the test doesn't need ONNX.
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });

    const tags = ['alpha', 'beta', 'gamma'];

    const storeResult = await bridgeStoreEntry({
      key: 'tag-round-trip',
      value: 'value with tags',
      namespace: 'probe-3051',
      tags,
      generateEmbeddingFlag: false,
      dbPath,
    });

    expect(storeResult).not.toBeNull();
    expect(storeResult!.success).toBe(true);

    // Sanity: the DB row DOES have the tags (the write side was never the
    // bug; the bug was on the write-through cache shape). This anchors the
    // test to the real defect — even without our fix this row read is fine,
    // but the immediate cached read below would return []-tags.
    const rawRow = db.prepare(
      'SELECT tags FROM memory_entries WHERE namespace = ? AND key = ? LIMIT 1'
    ).get('probe-3051', 'tag-round-trip') as { tags: string | null } | undefined;
    expect(rawRow).toBeDefined();
    expect(rawRow!.tags).toBe(JSON.stringify(tags));

    const getResult = await bridgeGetEntry({
      key: 'tag-round-trip',
      namespace: 'probe-3051',
      dbPath,
    });

    expect(getResult).not.toBeNull();
    expect(getResult!.success).toBe(true);
    expect(getResult!.found).toBe(true);
    expect(getResult!.entry).toBeDefined();
    // The load-bearing assertion: tags survive round-trip through the cache path.
    // Pre-fix this returned [] because the partial write-through payload had no `tags`.
    expect(getResult!.entry!.tags).toEqual(tags);
  });
});
