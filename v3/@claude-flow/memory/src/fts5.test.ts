/**
 * Phase 5 — FTS5 keyword index (ADR-125)
 *
 * Verifies the FTS5 wiring on the two SQL backends:
 * - SqlJsBackend  (sql.js — WASM, ships FTS5 since 1.10)
 * - SQLiteBackend (better-sqlite3 — bundles FTS5 since 11.x)
 *
 * The SQLiteBackend test is conditional: better-sqlite3 is an optional
 * dependency. If it isn't installable in the current env, that test is
 * skipped.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SqlJsBackend } from './sqljs-backend.js';
import { createDefaultEntry } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Locate the local sql-wasm.wasm so vitest doesn't try to fetch it over HTTP.
 * Returns null if sql.js isn't installed in this env (treated as a skip
 * signal by the suite).
 */
function locateSqlWasm(): string | null {
  try {
    const sqljsPkg = require.resolve('sql.js/package.json');
    const wasmPath = sqljsPkg.replace(/package\.json$/, 'dist/sql-wasm.wasm');
    return existsSync(wasmPath) ? wasmPath : null;
  } catch {
    return null;
  }
}

const WASM_PATH = locateSqlWasm();

async function newSqlJs() {
  if (!WASM_PATH) throw new Error('sql.js/dist/sql-wasm.wasm not found');
  const backend = new SqlJsBackend({ databasePath: ':memory:', wasmPath: WASM_PATH });
  await backend.initialize();
  return backend;
}

describe('Phase 5 — SqlJsBackend FTS5', () => {
  it('searchKeyword returns matching entries for an FTS phrase', async () => {
    const backend = await newSqlJs();

    const phrases = [
      'authentication patterns for OAuth flow',
      'database migrations and schema changes',
      'rate limiting and throttling middleware',
      'caching strategies for distributed systems',
      'jwt token validation security',
    ];
    for (let i = 0; i < 20; i++) {
      const phrase = phrases[i % phrases.length];
      const entry = createDefaultEntry({ key: `k-${i}`, content: `${phrase} ${i}` });
      await backend.store(entry);
    }

    const results = await (backend as any).searchKeyword('authentication patterns', 10);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const c = r.entry.content.toLowerCase();
      // At least one of the two query tokens should appear
      expect(c.includes('authentication') || c.includes('patterns')).toBe(true);
    }

    await backend.shutdown();
  });

  it('searchKeyword does not return a deleted entry', async () => {
    const backend = await newSqlJs();
    const entry = createDefaultEntry({ key: 'doomed', content: 'unique-marker-phrase' });
    await backend.store(entry);
    let results = await (backend as any).searchKeyword('unique-marker-phrase', 5);
    expect(results.length).toBe(1);

    await backend.delete(entry.id);
    results = await (backend as any).searchKeyword('unique-marker-phrase', 5);
    expect(results.length).toBe(0);

    await backend.shutdown();
  });

  it('searchKeyword reflects content updates', async () => {
    const backend = await newSqlJs();
    const entry = createDefaultEntry({ key: 'updatable', content: 'original phrase about apples' });
    await backend.store(entry);

    let results = await (backend as any).searchKeyword('apples', 5);
    expect(results.length).toBe(1);

    await backend.update(entry.id, { content: 'rewritten phrase about bananas' });
    results = await (backend as any).searchKeyword('apples', 5);
    expect(results.length).toBe(0);
    results = await (backend as any).searchKeyword('bananas', 5);
    expect(results.length).toBe(1);

    await backend.shutdown();
  });

  it('searchKeyword returns [] for an empty query', async () => {
    const backend = await newSqlJs();
    const results = await (backend as any).searchKeyword('   ', 5);
    expect(results).toEqual([]);
    await backend.shutdown();
  });
});

// Conditionally run the SQLiteBackend tests — better-sqlite3 is an optional
// dependency, so probe for it first.
async function probeBetterSqlite3(): Promise<boolean> {
  try {
    await import('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

describe('Phase 5 — SQLiteBackend FTS5 (better-sqlite3)', async () => {
  const hasBetterSqlite3 = await probeBetterSqlite3();
  const maybeIt = hasBetterSqlite3 ? it : it.skip;

  maybeIt('searchKeyword returns matching entries with FTS5 ranking', async () => {
    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const backend = new SQLiteBackend({ databasePath: ':memory:' });
    await backend.initialize();

    for (let i = 0; i < 20; i++) {
      const entry = createDefaultEntry({
        key: `k-${i}`,
        content: i % 2 === 0
          ? `authentication patterns OAuth ${i}`
          : `database indexing strategies ${i}`,
      });
      await backend.store(entry);
    }

    const results = await (backend as any).searchKeyword('authentication', 10);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.entry.content.toLowerCase()).toContain('authentication');
    }

    await backend.shutdown();
  });

  maybeIt('searchKeyword stops finding entries after delete', async () => {
    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const backend = new SQLiteBackend({ databasePath: ':memory:' });
    await backend.initialize();

    const entry = createDefaultEntry({ key: 'doomed', content: 'unique-marker' });
    await backend.store(entry);
    let results = await (backend as any).searchKeyword('unique-marker', 5);
    expect(results.length).toBe(1);
    await backend.delete(entry.id);
    results = await (backend as any).searchKeyword('unique-marker', 5);
    expect(results.length).toBe(0);

    await backend.shutdown();
  });
});
