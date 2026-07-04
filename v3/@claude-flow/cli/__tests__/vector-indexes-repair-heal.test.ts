/**
 * Regression: statusline "Vectors ●0" despite thousands of real vectors.
 *
 * Root cause (two layers):
 *   1. DISPLAY — the statusline fetched the vector count and the HNSW row count
 *      in ONE combined SQL statement. On a DB with no `vector_indexes` table
 *      (older CLI / agentdb-written DBs), the statement failed at PREPARE time
 *      and the valid `memory_entries` count was discarded too → shown as 0.
 *   2. DATA — such a DB genuinely lacks the `vector_indexes` table + per-
 *      namespace rows, so the HNSW flag and #1941 namespace routing break.
 *
 * Fix: statusline splits the two counts (covered by statusline-generator), and
 * `repairVectorIndexes()` self-heals the DB on init / MCP start. This test
 * pins the DATA-layer self-heal: a `vector_indexes`-less DB with embedded rows
 * is provisioned + backfilled idempotently, and the read-only queries the
 * statusline runs then return the real count (never zero) with the HNSW flag up.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { repairVectorIndexes } from '../src/memory/memory-initializer.js';

// better-sqlite3 is the same engine the repair uses; skip the suite if the
// native module can't load on this host (WASM-only) — the repair no-ops there.
let Database: any;
let haveNative = false;
try { Database = (await import('better-sqlite3')).default; haveNative = true; } catch { haveNative = false; }

/** Build a DB that mimics an old install: memory_entries with embeddings, NO vector_indexes. */
function seedLegacyDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
    content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
  )`);
  const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)');
  const vec = JSON.stringify(Array.from({ length: 8 }, (_, i) => i / 8));
  // 3 in 'commands', 2 in 'feedback', 1 with NO embedding (must not be counted)
  ins.run('a', 'k1', 'commands', 'alpha', vec);
  ins.run('b', 'k2', 'commands', 'beta', vec);
  ins.run('c', 'k3', 'commands', 'gamma', vec);
  ins.run('d', 'k4', 'feedback', 'delta', vec);
  ins.run('e', 'k5', 'feedback', 'epsilon', vec);
  ins.run('f', 'k6', 'commands', 'no-embedding', null);
  db.close();
}

describe.skipIf(!haveNative)('repairVectorIndexes — self-heal missing vector_indexes', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'vidx-heal-'));
  });

  it('provisions vector_indexes and backfills accurate per-namespace counts', async () => {
    const dbPath = join(workdir, 'legacy.db');
    seedLegacyDb(dbPath);

    // Precondition: table genuinely absent.
    const pre = new Database(dbPath);
    const preCount = pre.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='vector_indexes'").get() as { c: number };
    expect(preCount.c).toBe(0);
    pre.close();

    const res = await repairVectorIndexes(dbPath);
    expect(res.tableCreated).toBe(true);
    expect(res.repaired).toBe(true);
    expect(res.namespaces.sort()).toEqual(['commands', 'feedback']);

    // total_vectors reflects ONLY embedded rows (the null-embedding row excluded).
    const db = new Database(dbPath);
    const counts = Object.fromEntries(
      (db.prepare('SELECT name, total_vectors FROM vector_indexes').all() as Array<{ name: string; total_vectors: number }>)
        .map(r => [r.name, r.total_vectors]),
    );
    expect(counts.commands).toBe(3);
    expect(counts.feedback).toBe(2);
    // Fresh-install parity seed rows exist too.
    expect(counts.default).toBeDefined();
    expect(counts.patterns).toBeDefined();
    db.close();
  });

  it('the read-only queries the statusline runs now return the real count + HNSW flag', async () => {
    const dbPath = join(workdir, 'statusline.db');
    seedLegacyDb(dbPath);
    await repairVectorIndexes(dbPath);

    const db = new Database(dbPath, { readonly: true });
    // Statusline query 1 (count) — always worked, must be non-zero.
    const c = db.prepare("SELECT COUNT(*) AS c FROM memory_entries WHERE embedding IS NOT NULL").get() as { c: number };
    expect(c.c).toBe(5);
    // Statusline query 2 (HNSW flag) — now succeeds (table present) and is > 0.
    const h = db.prepare('SELECT COUNT(*) AS c FROM vector_indexes').get() as { c: number };
    expect(h.c).toBeGreaterThan(0);
    db.close();
  });

  it('is idempotent — a second run is a clean no-op (no writes) once healed', async () => {
    const dbPath = join(workdir, 'idem.db');
    seedLegacyDb(dbPath);
    const first = await repairVectorIndexes(dbPath);
    expect(first.repaired).toBe(true);
    // Already healed: table exists and every embedded namespace has a row, so
    // the second run must NOT write (avoids touching the live DB every start).
    const second = await repairVectorIndexes(dbPath);
    expect(second.tableCreated).toBe(false);
    expect(second.repaired).toBe(false);
    expect(second.namespaces).toEqual([]);

    // Counts from the first heal remain correct.
    const db = new Database(dbPath);
    const commands = db.prepare("SELECT total_vectors AS t FROM vector_indexes WHERE name='commands'").get() as { t: number };
    expect(commands.t).toBe(3);
    db.close();
  });

  it('is a safe no-op when the DB file does not exist', async () => {
    const res = await repairVectorIndexes(join(workdir, 'nope-does-not-exist.db'));
    expect(res.repaired).toBe(false);
    expect(res.tableCreated).toBe(false);
    expect(res.namespaces).toEqual([]);
  });

  it('is a safe no-op when memory_entries is absent (nothing to key off)', async () => {
    const dbPath = join(workdir, 'empty.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE unrelated (x INTEGER)');
    db.close();
    const res = await repairVectorIndexes(dbPath);
    expect(res.repaired).toBe(false);
    expect(res.tableCreated).toBe(false);
  });
});
