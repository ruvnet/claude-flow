/**
 * #3785 residual: `memory delete` is a soft delete, but the tombstone used to
 * keep the deleted payload on disk. Both the native bridge and the sql.js
 * fallback hid the row via `status='deleted'` while leaving `content` (and the
 * native path left `embedding`) intact, so a deleted value remained readable
 * by anyone opening the SQLite file directly.
 *
 * The tombstone keeps its identity/status for upsert resurrection and audit,
 * but must scrub the payload columns.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deleteEntry, MEMORY_SCHEMA_V3, purgeNamespace } from '../src/memory/memory-initializer.js';

const SECRET = 'deleted-value-must-not-survive';
const EMBEDDING = JSON.stringify([0.1, 0.2, 0.3]);
const TAGS = JSON.stringify(['secret-tag']);
const METADATA = JSON.stringify({ secret: true });

let Database: any = null;
try {
  Database = (await import('better-sqlite3')).default;
  const probe = new Database(':memory:');
  probe.close();
} catch {
  Database = null; // native binding unavailable locally; CI runs this case
}

const nativeIt = Database ? it : it.skip;

const scrubExpected = {
  status: 'deleted',
  content: '',
  embedding: null,
  embedding_model: null,
  embedding_dimensions: null,
  tags: null,
  metadata: null,
};

async function seedSqlJs(dbPath: string): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(MEMORY_SCHEMA_V3);
    db.run(
      `INSERT INTO memory_entries
         (id, key, namespace, content, embedding, embedding_model,
          embedding_dimensions, tags, metadata, created_at, updated_at, status)
       VALUES ('secret-id', 'secret-key', 'scrub', ?, ?, 'test-model',
               3, ?, ?, 1, 1, 'active')`,
      [SECRET, EMBEDDING, TAGS, METADATA],
    );
    writeFileSync(dbPath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

function expectNoRawPayload(dbPath: string): void {
  const raw = readFileSync(dbPath);
  for (const marker of [SECRET, EMBEDDING, TAGS, METADATA]) {
    expect(raw.includes(Buffer.from(marker))).toBe(false);
  }
}

async function readSqlJsRow(dbPath: string): Promise<Record<string, unknown>> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec(
      `SELECT status, content, embedding, embedding_model,
              embedding_dimensions, tags, metadata
         FROM memory_entries WHERE key = 'secret-key'`,
    );
    const columns = result[0]?.columns ?? [];
    const values = result[0]?.values?.[0] ?? [];
    return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
  } finally {
    db.close();
  }
}

describe('memory delete scrubs the tombstoned payload (#3785)', () => {
  let dir = '';
  let prevDisableBridge: string | undefined;

  beforeEach(() => {
    prevDisableBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  });

  afterEach(() => {
    if (prevDisableBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prevDisableBridge;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('scrubs content and vectors on the sql.js fallback', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-delete-scrub-sqljs-'));
    const dbPath = join(dir, 'memory.db');
    await seedSqlJs(dbPath);

    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';

    const result = await deleteEntry({ key: 'secret-key', namespace: 'scrub', dbPath });
    expect(result).toMatchObject({ success: true, deleted: true });

    expect(await readSqlJsRow(dbPath)).toEqual(scrubExpected);
    expectNoRawPayload(dbPath);
  });

  it('zeroes the payload when purging a namespace', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-purge-scrub-sqljs-'));
    const dbPath = join(dir, 'memory.db');
    await seedSqlJs(dbPath);
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';

    const result = await purgeNamespace({ namespace: 'scrub', dbPath });
    expect(result).toMatchObject({ success: true, deletedCount: 1, remainingEntries: 0 });

    expectNoRawPayload(dbPath);
  });

  nativeIt('scrubs content and vectors on the native bridge', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-delete-scrub-native-'));
    const dbPath = join(dir, 'memory.db');
    const db = new Database(dbPath);
    let closed = false;
    try {
      db.exec(MEMORY_SCHEMA_V3);
      db.prepare(
        `INSERT INTO memory_entries
           (id, key, namespace, content, embedding, embedding_model,
            embedding_dimensions, tags, metadata, created_at, updated_at, status)
         VALUES ('secret-id', 'secret-key', 'scrub', ?, ?, 'test-model',
                 3, ?, ?, 1, 1, 'active')`,
      ).run(SECRET, EMBEDDING, TAGS, METADATA);

      const { __setMemoryBridgeRegistryForTests, bridgeDeleteEntry } = await import(
        '../src/memory/memory-bridge.js'
      );
      __setMemoryBridgeRegistryForTests({
        getAgentDB: () => ({ database: db, embedder: null }),
        get: () => null,
      });

      const result = await bridgeDeleteEntry({ key: 'secret-key', namespace: 'scrub', dbPath });
      expect(result).toMatchObject({ success: true, deleted: true });

      const row = db.prepare(
        `SELECT status, content, embedding, embedding_model,
                embedding_dimensions, tags, metadata
           FROM memory_entries WHERE key = 'secret-key'`,
      ).get();
      expect(row).toEqual(scrubExpected);

      // Flush and truncate WAL so the check reads the durable main image, not
      // an older frame that still contains the pre-delete payload.
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      closed = true;
      expectNoRawPayload(dbPath);
    } finally {
      const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
      __setMemoryBridgeRegistryForTests(null);
      if (!closed) db.close();
    }
  });
});
