/**
 * Regression for #2968: `memory store` printed "Data stored successfully"
 * even when the underlying connection couldn't durably persist the write —
 * specifically the sql.js fallback driver (engaged when better-sqlite3's
 * native binding never got built, e.g. a skipped optionalDependency
 * postinstall), whose `.pragma()` shim rejects `wal_checkpoint(passive)`
 * with "Invalid PRAGMA command". `bridgeStoreEntry()` swallowed that error
 * unconditionally and reported unqualified success either way.
 *
 * This pins the fix: bridgeStoreEntry() now distinguishes that specific
 * failure signature from an ordinary "non-WAL / busy" pragma failure and
 * surfaces it via `persistWarning`, so callers stop claiming success blind.
 */
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-2968-persist-warning-'));
const dbPath = join(root, 'memory.db');

let db: Database.Database | null = null;

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
      expires_at INTEGER,
      status TEXT DEFAULT 'active',
      UNIQUE(namespace, key)
    );
  `);
  return d;
}

afterAll(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#2968 store persistence warning', () => {
  it('surfaces persistWarning when the checkpoint throws "Invalid PRAGMA" (sql.js fallback signature)', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeStoreEntry } = await import(
      '../src/memory/memory-bridge.js'
    );

    db = makeDb();
    // Simulate the sql.js shim's pragma() rejecting an unrecognized command —
    // the exact signature `agentdb`'s sql.js fallback throws in the field
    // report, without needing to stand up a real sql.js-backed registry.
    (db as unknown as { pragma: (cmd: string) => unknown }).pragma = (cmd: string) => {
      throw new Error(
        `Invalid PRAGMA command: ${cmd}. Allowed: journal_mode, synchronous, cache_size, page_size, page_count, user_version, foreign_keys, temp_store, mmap_size, wal_autocheckpoint`,
      );
    };
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: () => null,
    });

    const result = await bridgeStoreEntry({
      key: 'k1',
      value: 'persistence probe',
      namespace: 'fixture',
      generateEmbeddingFlag: false,
      dbPath,
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.persistWarning).toBeDefined();
    expect(result!.persistWarning).toMatch(/sql\.js fallback driver/i);
    expect(result!.persistWarning).toMatch(/#2968/);
  });

  it('does NOT set persistWarning on an ordinary pragma failure unrelated to the sql.js signature', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeStoreEntry } = await import(
      '../src/memory/memory-bridge.js'
    );

    const d2 = makeDb();
    (d2 as unknown as { pragma: (cmd: string) => unknown }).pragma = () => {
      throw new Error('database is busy');
    };
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: d2, embedder: null }),
      get: () => null,
    });

    const result = await bridgeStoreEntry({
      key: 'k2',
      value: 'unrelated pragma failure',
      namespace: 'fixture',
      generateEmbeddingFlag: false,
      dbPath,
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.persistWarning).toBeUndefined();
    d2.close();
  });
});
