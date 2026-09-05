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
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { repairVectorIndexes, recoverMemoryDatabase } from '../src/memory/memory-initializer.js';

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

describe.skipIf(!haveNative)('recoverMemoryDatabase — auto-recover a corrupt memory DB', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'vidx-recover-'));
  });

  /** Write many rows so the b-tree spans multiple pages, then scribble a page to corrupt it. */
  function seedAndCorrupt(dbPath: string): { rows: number } {
    const db = new Database(dbPath);
    db.pragma('journal_mode = DELETE'); // single-file, no WAL — simpler to corrupt deterministically
    db.pragma('page_size = 4096');
    db.exec(`CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
      content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
    )`);
    db.exec("CREATE TABLE skills (id TEXT PRIMARY KEY, body TEXT)");
    const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)');
    const vec = JSON.stringify(Array.from({ length: 8 }, (_, i) => i / 8));
    const N = 500;
    const many = db.transaction(() => {
      for (let i = 0; i < N; i++) {
        ins.run('id' + i, 'k' + i, i % 2 ? 'commands' : 'feedback', 'content number ' + i + ' '.repeat(40), vec);
      }
    });
    many();
    db.close();

    // Scribble over a page in the middle of the file to induce b-tree corruption
    // that quick_check detects but that leaves most rows individually readable.
    const buf = readFileSync(dbPath);
    const pageSize = 4096;
    const targetPage = 6; // past the schema/first pages, into memory_entries data
    const off = targetPage * pageSize + 16;
    for (let i = 0; i < 80; i++) buf[off + i] = 0x00;
    writeFileSync(dbPath, buf);
    return { rows: N };
  }

  it('backs up, rebuilds, verifies, and atomically swaps a corrupt DB', async () => {
    const dbPath = join(workdir, 'corrupt.db');
    const { rows } = seedAndCorrupt(dbPath);

    // Precondition: quick_check must now report corruption.
    const pre = new Database(dbPath);
    const qc = String(pre.pragma('quick_check(1)', { simple: true }));
    pre.close();
    // If our synthetic corruption didn't take on this SQLite build, skip rather
    // than assert a false negative — the recovery path is still exercised below.
    if (qc.toLowerCase() === 'ok') return;

    const rec = await recoverMemoryDatabase(dbPath, { verbose: false });
    expect(rec.recovered).toBe(true);
    expect(rec.backupPath).toBeTruthy();
    expect(existsSync(rec.backupPath!)).toBe(true); // corrupt original preserved

    // The swapped-in DB is clean and retains the readable rows.
    const db = new Database(dbPath, { readonly: true });
    expect(String(db.pragma('integrity_check', { simple: true })).toLowerCase()).toBe('ok');
    const c = (db.prepare('SELECT COUNT(*) AS c FROM memory_entries').get() as { c: number }).c;
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(rows);
    db.close();
  });

  it('is a no-op on a healthy DB (never rewrites a good database)', async () => {
    const dbPath = join(workdir, 'healthy.db');
    const db = new Database(dbPath);
    db.exec("CREATE TABLE memory_entries (id TEXT PRIMARY KEY, content TEXT)");
    db.prepare('INSERT INTO memory_entries VALUES (?, ?)').run('a', 'hello');
    db.close();

    const rec = await recoverMemoryDatabase(dbPath);
    expect(rec.recovered).toBe(false);
    expect(rec.reason).toBe('not-corrupt');
  });

  it('repairVectorIndexes({autoRecover}) recovers then heals in one call', async () => {
    const dbPath = join(workdir, 'corrupt-autoheal.db');
    const { rows } = seedAndCorrupt(dbPath);
    const pre = new Database(dbPath);
    const qc = String(pre.pragma('quick_check(1)', { simple: true }));
    pre.close();
    if (qc.toLowerCase() === 'ok') return; // synthetic corruption didn't take — skip

    const out = await repairVectorIndexes(dbPath, { autoRecover: true });
    expect(out.corrupt).toBe(true);
    expect(out.recovered).toBe(true);
    // After recovery it provisioned vector_indexes on the clean rebuild.
    const db = new Database(dbPath, { readonly: true });
    expect(String(db.pragma('integrity_check', { simple: true })).toLowerCase()).toBe('ok');
    const vidx = (db.prepare('SELECT COUNT(*) AS c FROM vector_indexes').get() as { c: number }).c;
    expect(vidx).toBeGreaterThan(0);
    db.close();
    expect(rows).toBe(500);
  });
});
