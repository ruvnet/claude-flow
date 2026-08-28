/**
 * Regression for #2982 / #2976 (duplicate reports, same root cause):
 * `bridgeSearchEntries()`'s pre-rank SELECT truncated the corpus to
 * `LIMIT 1000` with no `ORDER BY`, so SQLite returned rows in arbitrary
 * storage order — for a freshly-inserted rowid table with no deletes,
 * that's insertion order. On any corpus over 1000 rows, the newest entries
 * never reached BM25/embedding scoring at all, no matter how well they
 * matched the query. `bridgeListEntries()` already ordered by
 * `updated_at DESC` for the same reason; this pins the search path to the
 * same guarantee.
 *
 * All SQL executes against a real better-sqlite3 fixture (mocked
 * ControllerRegistry only), matching the #2652 test's harness pattern, so
 * this exercises the production bridge query, not a stand-in.
 */
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-2982-truncation-'));
const dbPath = join(root, 'memory.db');
const ROW_COUNT = 1005;
const NEEDLE = 'zzzneedle2982';

let db: Database.Database | null = null;

function seedRows(): void {
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_model TEXT DEFAULT 'local',
      embedding_dimensions INTEGER,
      tags TEXT,
      metadata TEXT,
      owner_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      expires_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      status TEXT,
      provenance_type TEXT DEFAULT 'unknown',
      UNIQUE(namespace, key)
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memory_entries (id, key, namespace, content, created_at, updated_at, status)
    VALUES (?, ?, 'fixture', ?, ?, ?, 'active')
  `);
  const insertMany = db.transaction((n: number) => {
    for (let i = 1; i <= n; i++) {
      // updated_at increases monotonically with insertion order — row n is
      // both the last-inserted (storage-order-last) AND the newest by
      // timestamp, so ORDER BY updated_at DESC is what recovers it.
      const isNeedle = i === n;
      insert.run(
        `row-${i}`,
        `key/${i}`,
        isNeedle ? `entry number ${i} contains ${NEEDLE} as a unique marker` : `filler entry number ${i}`,
        i,
        i,
      );
    }
  });
  insertMany(ROW_COUNT);
  db.close();
}

seedRows();

afterAll(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#2982/#2976 search truncation', () => {
  it('recalls the newest entry even when the corpus exceeds the 1000-row pre-rank LIMIT', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeSearchEntries } = await import(
      '../src/memory/memory-bridge.js'
    );

    db = new Database(dbPath);
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: () => null,
    });

    const result = await bridgeSearchEntries({
      query: NEEDLE,
      namespace: 'fixture',
      limit: 10,
      threshold: 0.1,
      dbPath,
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const keys = result!.results.map((r) => r.key);
    // Pre-fix: an unordered `LIMIT 1000` returns rows in insertion order on
    // this fixture, i.e. rows 1..1000 — row 1005 (the needle) is excluded
    // from the pre-rank set entirely and can never be scored or returned,
    // regardless of threshold. Post-fix: ORDER BY updated_at DESC recovers
    // the newest 1000 rows (6..1005), which includes it.
    expect(keys).toContain(`key/${ROW_COUNT}`);
  });
});
