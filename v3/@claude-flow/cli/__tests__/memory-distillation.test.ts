/**
 * ADR-174 memory distillation service.
 *
 * Proves the DISTILL/CONSOLIDATE pipeline turns raw `memory_entries` into the
 * structured intelligence tables (episodes / reasoning_patterns /
 * pattern_embeddings / causal_edges) that were empty because the daemon's
 * consolidate worker was a stub — while never mutating the source rows, staying
 * idempotent, and enforcing ADR-171 provenance discipline (proxy never promotes).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDistillation } from '../src/services/memory-distillation.js';

let Database: any;
let haveNative = false;
try { Database = (await import('better-sqlite3')).default; haveNative = true; } catch { haveNative = false; }

/** Build a DB with the source + agentdb target schemas and some seeded memory. */
function seedDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
    content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
  )`);
  db.exec(`CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, session_id TEXT NOT NULL,
    task TEXT NOT NULL, input TEXT, output TEXT, critique TEXT, reward REAL DEFAULT 0,
    success BOOLEAN DEFAULT 0, latency_ms INTEGER, tokens_used INTEGER, tags TEXT,
    metadata JSON, created_at INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE reasoning_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, task_type TEXT NOT NULL,
    approach TEXT NOT NULL, success_rate REAL NOT NULL DEFAULT 0, uses INTEGER DEFAULT 0,
    avg_reward REAL DEFAULT 0, tags TEXT, metadata TEXT
  )`);
  db.exec(`CREATE TABLE pattern_embeddings (
    pattern_id INTEGER PRIMARY KEY, embedding BLOB NOT NULL
  )`);
  db.exec(`CREATE TABLE causal_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_memory_id INTEGER NOT NULL, from_memory_type TEXT NOT NULL,
    to_memory_id INTEGER NOT NULL, to_memory_type TEXT NOT NULL, similarity REAL DEFAULT 0,
    confidence REAL DEFAULT 0.5, mechanism TEXT, metadata JSON, created_at INTEGER DEFAULT 0
  )`);

  const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)');
  // Distinct vectors so clustering keeps them separate.
  const vec = (seed: number) => JSON.stringify(Array.from({ length: 8 }, (_, i) => Math.sin(seed + i)));
  // 3 'commands' (proxy tier), 2 'feedback' (execution tier, one success one fail).
  ins.run('c1', 'k1', 'commands', 'refactor the auth module in src/auth.ts', vec(1));
  ins.run('c2', 'k2', 'commands', 'add validation to src/api/handler.ts', vec(2));
  ins.run('c3', 'k3', 'commands', 'optimize the query in src/db/store.ts', vec(3));
  ins.run('f1', 'k4', 'feedback', JSON.stringify({ taskId: 'edit-a', success: true }), vec(4));
  ins.run('f2', 'k5', 'feedback', JSON.stringify({ taskId: 'edit-b', success: false }), vec(5));
  db.close();
}

function counts(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { readonly: true });
  const q = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  const r = {
    memory_entries: q('memory_entries'), episodes: q('episodes'),
    reasoning_patterns: q('reasoning_patterns'), pattern_embeddings: q('pattern_embeddings'),
    causal_edges: q('causal_edges'),
  };
  db.close();
  return r;
}

describe.skipIf(!haveNative)('runDistillation — memory → structured intelligence', () => {
  let workdir: string;
  beforeAll(() => { workdir = mkdtempSync(join(tmpdir(), 'distill-')); });

  it('populates the empty target tables without mutating memory_entries', async () => {
    const dbPath = join(workdir, 'main.db');
    seedDb(dbPath);
    const before = counts(dbPath);
    expect(before.reasoning_patterns).toBe(0);

    const r = await runDistillation({ dbPath });
    expect(r.skipped).toBeUndefined();
    expect(r.processed).toBe(5);
    expect(r.patterns).toBeGreaterThan(0);
    expect(r.episodes).toBeGreaterThan(0);

    const after = counts(dbPath);
    expect(after.memory_entries).toBe(before.memory_entries); // source untouched
    expect(after.reasoning_patterns).toBeGreaterThan(0);
    expect(after.episodes).toBeGreaterThan(0);
    // Every pattern with a source embedding gets a pattern_embedding.
    expect(after.pattern_embeddings).toBe(after.reasoning_patterns);
  });

  it('enforces ADR-171 provenance: feedback promotes, proxy never does', async () => {
    const dbPath = join(workdir, 'prov.db');
    seedDb(dbPath);
    const r = await runDistillation({ dbPath });
    expect(r.byProvenance['proxy:structural']).toBeGreaterThan(0);
    expect(r.byProvenance['oracle:test-exec']).toBeGreaterThan(0);

    const db = new Database(dbPath, { readonly: true });
    const proxyPromoted = (db.prepare(
      "SELECT COUNT(*) AS c FROM reasoning_patterns WHERE json_extract(metadata,'$.provenance')='proxy:structural' AND json_extract(metadata,'$.promoted')=1",
    ).get() as { c: number }).c;
    expect(proxyPromoted).toBe(0); // proxy tier NEVER clears the promote gate
    db.close();
  });

  it('dry-run reports counts but writes nothing', async () => {
    const dbPath = join(workdir, 'dry.db');
    seedDb(dbPath);
    const r = await runDistillation({ dbPath, dryRun: true });
    expect(r.patterns).toBeGreaterThan(0);
    expect(counts(dbPath).reasoning_patterns).toBe(0); // no writes
  });

  it('is incremental/idempotent — a second run processes nothing new', async () => {
    const dbPath = join(workdir, 'idem.db');
    seedDb(dbPath);
    await runDistillation({ dbPath });
    const mid = counts(dbPath);
    const second = await runDistillation({ dbPath });
    expect(second.processed).toBe(0);
    expect(counts(dbPath).reasoning_patterns).toBe(mid.reasoning_patterns); // no duplicates
  });

  it('scopes to a namespace when asked', async () => {
    const dbPath = join(workdir, 'ns.db');
    seedDb(dbPath);
    const r = await runDistillation({ dbPath, namespaces: ['feedback'] });
    expect(r.processed).toBe(2); // only the 2 feedback rows
    expect(r.byProvenance['proxy:structural']).toBeUndefined();
  });

  it('skips (does not throw) when target tables are absent', async () => {
    const dbPath = join(workdir, 'bare.db');
    const db = new Database(dbPath);
    db.exec("CREATE TABLE memory_entries (id TEXT PRIMARY KEY, namespace TEXT, content TEXT, embedding TEXT)");
    db.close();
    const r = await runDistillation({ dbPath });
    expect(r.skipped).toBeTruthy();
    expect(r.patterns).toBe(0);
  });

  // ── ADR-174 operational invariant: embedding coverage is EXACTLY 1:1 ──
  it('every pattern has exactly one embedding, even when a source vector is malformed', async () => {
    const dbPath = join(workdir, 'embcov.db');
    seedDb(dbPath);
    // Add a row whose embedding column is non-null but unparseable — the old
    // code would create a pattern with no embedding (coverage gap).
    const db = new Database(dbPath);
    db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)')
      .run('bad1', 'kb', 'commands', 'refactor thing in src/x.ts', 'NOT VALID JSON');
    db.close();

    const r = await runDistillation({ dbPath });
    expect(r.patterns).toBeGreaterThan(0);
    expect(r.patternEmbeddings).toBe(r.patterns); // report-level 1:1

    // SQL invariant: zero patterns without an embedding.
    const check = new Database(dbPath, { readonly: true });
    const gap = (check.prepare(
      'SELECT COUNT(*) AS c FROM reasoning_patterns rp LEFT JOIN pattern_embeddings pe ON pe.pattern_id = rp.id WHERE pe.pattern_id IS NULL',
    ).get() as { c: number }).c;
    expect(gap).toBe(0);
    check.close();
  });

  // ── ADR-174 edge contract: edges are WEAK co-occurrence, never causal proof ──
  it('relational edges are typed cooccurrence / proxy-tier / non-promoted', async () => {
    const dbPath = join(workdir, 'edges.db');
    seedDb(dbPath);
    await runDistillation({ dbPath });

    const db = new Database(dbPath, { readonly: true });
    const edges = db.prepare('SELECT mechanism, confidence, metadata FROM causal_edges').all() as Array<{ mechanism: string; confidence: number; metadata: string }>;
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.mechanism).toBe('co-occurrence');
      expect(e.confidence).toBeLessThan(0.5); // weak, never asserted as proof
      const m = JSON.parse(e.metadata);
      expect(m.edge_type).toBe('cooccurrence');
      expect(m.provenance_tier).toBe('proxy:structural');
      expect(m.promoted).toBe(false); // may rank retrieval, must NOT justify autonomous action
    }
    // No proxy edge is ever promoted.
    const promotedProxyEdges = edges.filter(e => JSON.parse(e.metadata).promoted === true).length;
    expect(promotedProxyEdges).toBe(0);
    db.close();
  });
});
