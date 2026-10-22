/**
 * Coverage for `bridgeListEntries({ tags })` (split out of #3512).
 *
 * The tag filter is pushed into the SQL query as
 * `EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)` per required tag
 * (AND semantics) instead of pulling every row into the process to filter
 * in JS — a prior version fetched up to 100k rows per call whenever a tag
 * filter was set. An earlier revision of this filter used SQL `LIKE`
 * against the raw JSON-array TEXT, which was both ASCII case-insensitive
 * and matched raw JSON bytes rather than parsed array elements (#3526
 * review); `json_each` compares real, decoded array values instead. This
 * suite checks the filtering semantics (AND, exact-tag matching,
 * pagination/total), that a tag must not match a longer tag that merely
 * contains it as a substring, case-sensitivity, and JSON-injection-shaped
 * tag values.
 */

import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const roots: string[] = [];

/** Fresh temp dir + db file per test so seeded ids/rows never collide. */
function freshDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-tag-filter-'));
  roots.push(root);
  return join(root, 'memory.db');
}

function makeDb(dbPath: string): Database.Database {
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
  `);
  return d;
}

function seed(
  d: Database.Database,
  rows: Array<{ id: string; key: string; tags: string[] | null }>,
): void {
  const stmt = d.prepare(`
    INSERT INTO memory_entries (id, key, namespace, content, tags, created_at, updated_at)
    VALUES (?, ?, 'probe-tags', 'v', ?, ?, ?)
  `);
  let t = 1_700_000_000_000;
  for (const row of rows) {
    stmt.run(row.id, row.key, row.tags ? JSON.stringify(row.tags) : null, t, t);
    t += 1_000; // strictly increasing updated_at so ORDER BY DESC is deterministic
  }
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
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('bridgeListEntries({ tags }) — SQL-pushed tag filter', () => {
  it('AND-matches required tags, excludes entries missing any of them or with no tags', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'both', tags: ['alpha', 'beta'] },
      { id: '2', key: 'alpha-only', tags: ['alpha'] },
      { id: '3', key: 'beta-only', tags: ['beta'] },
      { id: '4', key: 'untagged', tags: null },
      { id: '5', key: 'other', tags: ['gamma'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const result = await bridgeListEntries({ namespace: 'probe-tags', tags: ['alpha', 'beta'], dbPath });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.total).toBe(1);
    expect(result!.entries.map(e => e.key)).toEqual(['both']);
    expect(result!.entries[0].tags).toEqual(['alpha', 'beta']);
  });

  it('does not false-match a tag that is only a substring of a longer tag', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'short-tag', tags: ['a'] },
      { id: '2', key: 'long-tag', tags: ['ab'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const result = await bridgeListEntries({ namespace: 'probe-tags', tags: ['a'], dbPath });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.entries.map(e => e.key)).toEqual(['short-tag']);
  });

  it('handles tag values containing LIKE metacharacters and quotes literally', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'percent-tag', tags: ['50%_done'] },
      { id: '2', key: 'quote-tag', tags: ['say "hi"'] },
      { id: '3', key: 'plain-tag', tags: ['plain'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const percentResult = await bridgeListEntries({ namespace: 'probe-tags', tags: ['50%_done'], dbPath });
    expect(percentResult!.entries.map(e => e.key)).toEqual(['percent-tag']);

    const quoteResult = await bridgeListEntries({ namespace: 'probe-tags', tags: ['say "hi"'], dbPath });
    expect(quoteResult!.entries.map(e => e.key)).toEqual(['quote-tag']);
  });

  it('respects limit/offset and reports the filtered total, not the pre-filter count', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'tagged-1', tags: ['keep'] },
      { id: '2', key: 'tagged-2', tags: ['keep'] },
      { id: '3', key: 'tagged-3', tags: ['keep'] },
      { id: '4', key: 'untagged-1', tags: null },
      { id: '5', key: 'untagged-2', tags: ['drop'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const page1 = await bridgeListEntries({ namespace: 'probe-tags', tags: ['keep'], limit: 2, offset: 0, dbPath });
    expect(page1!.total).toBe(3);
    expect(page1!.entries).toHaveLength(2);

    const page2 = await bridgeListEntries({ namespace: 'probe-tags', tags: ['keep'], limit: 2, offset: 2, dbPath });
    expect(page2!.total).toBe(3);
    expect(page2!.entries).toHaveLength(1);
  });

  // #3526 review — exact match via json_each, not a case-insensitive LIKE
  // substring match against raw JSON text.
  it('a tag filter of "prod" does not match an entry tagged "PROD" (case-sensitive exact match)', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'upper', tags: ['PROD'] },
      { id: '2', key: 'lower', tags: ['prod'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const result = await bridgeListEntries({ namespace: 'probe-tags', tags: ['prod'], dbPath });
    expect(result!.entries.map(e => e.key)).toEqual(['lower']);
  });

  it('a tag filter does not false-match a JSON-injection-shaped tag value', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'injected', tags: ['x","prod'] },
      { id: '2', key: 'real', tags: ['prod'] },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const result = await bridgeListEntries({ namespace: 'probe-tags', tags: ['prod'], dbPath });
    expect(result!.entries.map(e => e.key)).toEqual(['real']);
  });

  // #3526 review — an explicit limit: 0 must return zero rows, not fall
  // back to the default limit (`parseInt(...) || 20` treated 0 as falsy).
  it('limit: 0 returns zero entries, not the default', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeListEntries } = await import('../src/memory/memory-bridge.js');

    const dbPath = freshDbPath();
    db = makeDb(dbPath);
    seed(db, [
      { id: '1', key: 'a', tags: null },
      { id: '2', key: 'b', tags: null },
      { id: '3', key: 'c', tags: null },
    ]);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? makeTieredCache() : null),
    });

    const result = await bridgeListEntries({ namespace: 'probe-tags', limit: 0, dbPath });
    expect(result!.success).toBe(true);
    expect(result!.entries).toHaveLength(0);
    expect(result!.total).toBe(3);
  });
});
