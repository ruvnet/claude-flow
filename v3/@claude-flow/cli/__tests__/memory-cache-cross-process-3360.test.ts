/**
 * Regression guard — `memory_retrieve` served stale values after ANOTHER
 * process wrote to the same store.
 *
 * Several MCP servers routinely share one database file: Claude Code, Codex
 * and Grok each start their own `mcp start` against the same `.swarm/`
 * store. `bridgeGetEntry` consults a per-process TieredCache first, and each
 * process only invalidated that cache on its own writes. Once server B had
 * read a key, an update or delete made by server A never reached B: B kept
 * returning the old value (`found: true`) until its cache entry expired
 * (5-minute TieredCache TTL by default).
 *
 * A second better-sqlite3 connection to the same file stands in for the
 * other server process — that is exactly the distinction SQLite's
 * `PRAGMA data_version` draws (commits by a different connection), which the
 * fix relies on.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-cache-cross-process-'));
const dbPath = join(root, 'memory.db');

function makeDb(): Database.Database {
  const d = new Database(dbPath);
  d.pragma('journal_mode = WAL');
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

/** Map-backed stand-in for TieredCacheManager (get/set/delete/clear). */
function makeTieredCache() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => { store.set(k, v); },
    delete: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

// `db` is this process's connection (what agentdb hands the bridge);
// `otherProcess` is a second connection to the same file.
const db = makeDb();
const otherProcess = new Database(dbPath);

afterAll(() => {
  otherProcess.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function bridge() {
  const mod = await import('../src/memory/memory-bridge.js');
  mod.__setMemoryBridgeRegistryForTests({
    getAgentDB: () => ({ database: db, embedder: null }),
    get: (kind: string) => (kind === 'tieredCache' ? cache : null),
  });
  return mod;
}

let cache = makeTieredCache();

beforeEach(() => {
  cache = makeTieredCache();
});

describe('bridgeGetEntry — writes by another process sharing the store', () => {
  it('returns the value another process updated, not the cached one', async () => {
    const { bridgeStoreEntry, bridgeGetEntry } = await bridge();
    const ns = 'cross-process-update';
    await bridgeStoreEntry({ key: 'k', value: 'v1', namespace: ns, generateEmbeddingFlag: false, dbPath });

    const first = await bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(first!.entry!.content).toBe('v1');

    // The cache still does its job when nobody else has written.
    const second = await bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(second!.cacheHit).toBe(true);
    expect(second!.entry!.content).toBe('v1');

    otherProcess
      .prepare('UPDATE memory_entries SET content = ?, updated_at = ? WHERE namespace = ? AND key = ?')
      .run('v2', Date.now(), ns, 'k');

    const third = await bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(third!.entry!.content).toBe('v2');
    expect(third!.cacheHit).toBe(false);
  });

  it('reports not-found for a key another process deleted', async () => {
    const { bridgeStoreEntry, bridgeGetEntry } = await bridge();
    const ns = 'cross-process-delete';
    await bridgeStoreEntry({ key: 'k', value: 'doomed', namespace: ns, generateEmbeddingFlag: false, dbPath });
    expect((await bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('doomed');

    // Same soft delete bridgeDeleteEntry performs.
    otherProcess
      .prepare(`UPDATE memory_entries SET status = 'deleted', updated_at = ? WHERE namespace = ? AND key = ?`)
      .run(Date.now(), ns, 'k');

    const after = await bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(after!.success).toBe(true);
    expect(after!.found).toBe(false);
  });

  it("never queries data_version on agentdb's sql.js fallback (isWasm)", async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    const probes: string[] = [];
    // agentdb's SqlJsDatabase has pragma()/prepare() but rejects data_version
    // (with a console error); the bridge must not ask it.
    const wasmDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'pragma') return (sql: string, ...a: unknown[]) => { probes.push(`pragma ${sql}`); return (target as any).pragma(sql, ...a); };
        if (prop === 'prepare') return (sql: string) => { if (/data_version/i.test(sql)) probes.push(sql); return target.prepare(sql); };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: wasmDb, embedder: null, isWasm: true }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'wasm-fallback';
    await mod.bridgeStoreEntry({ key: 'k', value: 'w', namespace: ns, generateEmbeddingFlag: false, dbPath });
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('w');
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.cacheHit).toBe(true);
    expect(probes.filter((p) => /data_version/i.test(p))).toEqual([]);
  });

  it('stops probing a handle whose data_version check throws', async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    let attempts = 0;
    const brokenDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/data_version/i.test(sql)) { attempts++; throw new Error('unsupported pragma'); }
            return target.prepare(sql);
          };
        }
        if (prop === 'pragma') {
          return (sql: string, ...a: unknown[]) => {
            if (/data_version/i.test(sql)) { attempts++; throw new Error('unsupported pragma'); }
            return (target as any).pragma(sql, ...a);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: brokenDb, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'broken-probe';
    await mod.bridgeStoreEntry({ key: 'k', value: 'b', namespace: ns, generateEmbeddingFlag: false, dbPath });
    for (let i = 0; i < 3; i++) {
      expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('b');
    }
    expect(attempts).toBe(1);
  });

  it('never probes a non-native handle even when isWasm is not reported', async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    const probes: string[] = [];
    // Shape of agentdb's SqlJsDatabase: has pragma()/prepare(), but no
    // better-sqlite3 `inTransaction`. (A forwarding object, not a Proxy of the
    // real handle: a Proxy can't hide the native class's own properties.)
    const sqlJsLike = new Proxy({} as Record<string | symbol, unknown>, {
      has: (_t, p) => p !== 'inTransaction' && Reflect.has(db, p),
      get(_t, prop) {
        if (prop === 'pragma') return (sql: string, ...a: unknown[]) => { probes.push(`pragma ${sql}`); return (db as any).pragma(sql, ...a); };
        if (prop === 'prepare') return (sql: string) => { if (/data_version/i.test(sql)) probes.push(sql); return db.prepare(sql); };
        if (prop === 'inTransaction') return undefined;
        const v = Reflect.get(db, prop, db);
        return typeof v === 'function' ? v.bind(db) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: sqlJsLike, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'no-intransaction';
    await mod.bridgeStoreEntry({ key: 'k', value: 's', namespace: ns, generateEmbeddingFlag: false, dbPath });
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('s');
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.cacheHit).toBe(true);
    expect(probes.filter((p) => /data_version/i.test(p))).toEqual([]);
  });

  it('keeps checking after a transient failure of the check', async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    let failNext = true;
    // A handle whose data_version read fails once (e.g. SQLITE_BUSY), then works.
    const flakyDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            const stmt = target.prepare(sql);
            if (!/data_version/i.test(sql)) return stmt;
            return { get: () => { if (failNext) { failNext = false; throw new Error('SQLITE_BUSY'); } return stmt.get(); } };
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: flakyDb, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'transient-failure';
    await mod.bridgeStoreEntry({ key: 'k', value: 'v1', namespace: ns, generateEmbeddingFlag: false, dbPath });
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('v1'); // check throws here
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('v1');

    otherProcess
      .prepare('UPDATE memory_entries SET content = ?, updated_at = ? WHERE namespace = ? AND key = ?')
      .run('v2', Date.now(), ns, 'k');

    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('v2');
  });

  it('drops an already-warm cache when the check itself fails', async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    let failNext = false;
    // Same flaky handle, but the failure is armed AFTER the cache is warm and
    // after another process has written: the read must not trust the cache it
    // could not validate.
    const flakyDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            const stmt = target.prepare(sql);
            if (!/data_version/i.test(sql)) return stmt;
            return { get: () => { if (failNext) { failNext = false; throw new Error('SQLITE_BUSY'); } return stmt.get(); } };
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: flakyDb, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'transient-failure-warm-cache';
    await mod.bridgeStoreEntry({ key: 'k', value: 'v1', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }); // warms the cache
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.cacheHit).toBe(true);

    otherProcess
      .prepare('UPDATE memory_entries SET content = ?, updated_at = ? WHERE namespace = ? AND key = ?')
      .run('v2', Date.now(), ns, 'k');

    failNext = true; // the check can't see the foreign commit — it must fail safe
    const after = await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(after!.cacheHit).toBe(false);
    expect(after!.entry!.content).toBe('v2');
  });

  it('drops an already-warm cache when the check returns an unusable answer', async () => {
    const mod = await import('../src/memory/memory-bridge.js');
    let breakNext = false;
    // The check neither throws nor answers: `PRAGMA data_version` yields a row
    // without a usable number. That is no more evidence the store is unchanged
    // than a throw is, so it must take the same path as the throwing case.
    const oddDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            const stmt = target.prepare(sql);
            if (!/data_version/i.test(sql)) return stmt;
            return { get: () => (breakNext ? { data_version: undefined } : stmt.get()) };
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: oddDb, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const ns = 'unusable-answer-warm-cache';
    await mod.bridgeStoreEntry({ key: 'k', value: 'v1', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }); // warms the cache
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.cacheHit).toBe(true);

    otherProcess
      .prepare('UPDATE memory_entries SET content = ?, updated_at = ? WHERE namespace = ? AND key = ?')
      .run('v2', Date.now(), ns, 'k');

    breakNext = true; // the check cannot validate — it must not trust the cache
    const after = await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(after!.cacheHit).toBe(false);
    expect(after!.entry!.content).toBe('v2');

    // And the baseline was not advanced on an unusable answer: once the check
    // works again it still sees the foreign commit rather than skipping it.
    breakNext = false;
    expect((await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.entry!.content).toBe('v2');
  });

  it('clears the cache it inherits when the handle is replaced', async () => {
    const { bridgeStoreEntry, bridgeGetEntry } = await bridge();
    const ns = 'replaced-handle';
    await bridgeStoreEntry({ key: 'k', value: 'v', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await bridgeGetEntry({ key: 'k', namespace: ns, dbPath }); // warms the cache
    expect((await bridgeGetEntry({ key: 'k', namespace: ns, dbPath }))!.cacheHit).toBe(true);

    // A new handle (e.g. the registry reopened the database) has no baseline
    // of its own, so its first check must not trust the cache it inherits.
    const mod = await import('../src/memory/memory-bridge.js');
    const reopened = new Proxy(db, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: reopened, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const first = await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(first!.cacheHit).toBe(false);
    expect(first!.entry!.content).toBe('v');
  });

  it('still answers the read when the handle itself throws on the `in` check', async () => {
    const { bridgeStoreEntry, bridgeGetEntry } = await bridge();
    const ns = 'hostile-handle';
    await bridgeStoreEntry({ key: 'k', value: 'hostile', namespace: ns, generateEmbeddingFlag: false, dbPath });

    const mod = await import('../src/memory/memory-bridge.js');
    // An exotic handle whose `has` trap explodes, so `'inTransaction' in db`
    // throws. The check must swallow it and leave the read intact.
    const hostileDb = new Proxy(db, {
      has() { throw new Error('exotic handle: `in` explodes'); },
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    mod.__setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: hostileDb, embedder: null }),
      get: (kind: string) => (kind === 'tieredCache' ? cache : null),
    });
    const r = await mod.bridgeGetEntry({ key: 'k', namespace: ns, dbPath });
    expect(r).not.toBeNull();
    expect(r!.found).toBe(true);
    expect(r!.entry!.content).toBe('hostile');
  });

  it("this process's own writes do not flush the cache", async () => {
    const { bridgeStoreEntry, bridgeGetEntry } = await bridge();
    const ns = 'own-writes';
    await bridgeStoreEntry({ key: 'a', value: 'A', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await bridgeStoreEntry({ key: 'b', value: 'B', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await bridgeGetEntry({ key: 'a', namespace: ns, dbPath }); // populates 'a'

    // An unrelated write on this connection (plus the access_count bumps the
    // reads themselves perform) must not look like a foreign commit.
    await bridgeStoreEntry({ key: 'c', value: 'C', namespace: ns, generateEmbeddingFlag: false, dbPath });
    await bridgeGetEntry({ key: 'b', namespace: ns, dbPath });

    const again = await bridgeGetEntry({ key: 'a', namespace: ns, dbPath });
    expect(again!.cacheHit).toBe(true);
    expect(again!.entry!.content).toBe('A');
  });
});
