/**
 * Regression: the bridge must migrate `provenance_type` onto a pre-ADR-323
 * `memory_entries` table.
 *
 * ADR-323 added `provenance_type` to bridgeStoreEntry()'s INSERT.
 * `ensureSchemaColumns()` backfills the column on the sql.js path, but the
 * bridge path only ran `CREATE TABLE IF NOT EXISTS` — a no-op on a table that
 * already exists. So on any database created before ADR-323, every bridge
 * write threw:
 *
 *   SqliteError: table memory_entries has no column named provenance_type
 *
 * which the catch at the end of bridgeStoreEntry() swallowed, returning null.
 * The caller then demoted to the sql.js whole-image path, whose WAL-sidecar
 * guard reported "memory database has an active native WAL connection …
 * restore the native better-sqlite3 bridge" — a cause with nothing to do with
 * the real failure. Observed live: an MCP server dropped every memory_store
 * for hours while better-sqlite3 was healthy the whole time.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { ensureBridgeSchema } from '../src/memory/memory-bridge.js';

const LEGACY_TABLE = `CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  type TEXT DEFAULT 'semantic',
  status TEXT DEFAULT 'active',
  UNIQUE(namespace, key)
)`;

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

const columnsOf = (db: { exec: (sql: string) => Array<{ values: unknown[][] }> }): string[] => {
  const res = db.exec('PRAGMA table_info(memory_entries)');
  return res.length ? res[0].values.map((row) => String(row[1])) : [];
};

beforeAll(async () => {
  SQL = await initSqlJs();
});

describe('bridge schema migration (ADR-323 provenance_type)', () => {
  it('should add provenance_type to a pre-ADR-323 table', () => {
    const db = new SQL.Database();
    db.run(LEGACY_TABLE);
    expect(columnsOf(db)).not.toContain('provenance_type');

    ensureBridgeSchema(db);

    expect(columnsOf(db)).toContain('provenance_type');
  });

  it('should let the ADR-323 insert succeed after migration', () => {
    const db = new SQL.Database();
    db.run(LEGACY_TABLE);
    ensureBridgeSchema(db);

    const insert = () => db.run(
      'INSERT INTO memory_entries (id, key, namespace, content, provenance_type) VALUES (?, ?, ?, ?, ?)',
      ['id-1', 'k', 'ns', 'v', 'agent_output'],
    );

    expect(insert).not.toThrow();
  });

  it('should include provenance_type when creating the table fresh', () => {
    const db = new SQL.Database();

    ensureBridgeSchema(db);

    expect(columnsOf(db)).toContain('provenance_type');
  });

  it('should be idempotent across repeated calls', () => {
    const db = new SQL.Database();
    db.run(LEGACY_TABLE);

    ensureBridgeSchema(db);
    const second = () => ensureBridgeSchema(db);

    expect(second).not.toThrow();
    expect(columnsOf(db).filter((c) => c === 'provenance_type')).toHaveLength(1);
  });

  it('should report success when the schema is usable', () => {
    const db = new SQL.Database();
    db.run(LEGACY_TABLE);

    expect(ensureBridgeSchema(db)).toBe(true);
  });

  it('should fail closed when ALTER fails for a reason other than an existing column', () => {
    const exec = vi.fn((sql: string) => {
      if (sql.startsWith('ALTER TABLE')) {
        throw new Error('SQLITE_READONLY: attempt to write a readonly database');
      }
    });

    expect(ensureBridgeSchema({ exec })).toBe(false);
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
