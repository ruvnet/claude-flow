/**
 * Regression for #3324: `bridgeStorePattern`'s SQL-fallback branch (taken
 * when the registry exists but `reasoningBank` itself is unusable — the
 * `controller: 'bridge-fallback'` path, the common real-world state per
 * #3288) returned `result.id` as the caller's `patternId`. `result` is
 * `bridgeStoreEntry`'s own return, and `result.id` is ITS internally
 * generated row id (`generateId('entry')`) — a different value from the
 * `key` the row was actually stored under. `getEntry`/`bridgeGetEntry` look
 * up by `key`, so the handle handed back could never be read back.
 *
 * Uses the documented `__setMemoryBridgeRegistryForTests` seam (see
 * memory-store-persist-warning-2968.test.ts for the established pattern) to
 * force the `bridge-fallback` branch deterministically — `getRegistry()`
 * never resolves a real registry in this test runner (`@claude-flow/memory`
 * is intentionally externalized), so this is the only way to reach that
 * branch at all in isolation.
 */
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'ruflo-3324-pattern-fallback-'));
const dbPath = join(root, 'memory.db');
let db: Database.Database | null = null;

function makeDb(): Database.Database {
  // Deliberately no CREATE TABLE here: bridgeStorePattern/bridgeGetEntry's
  // shared getDb() calls ensureBridgeSchema(db) internally (CREATE TABLE IF
  // NOT EXISTS with the real, full column set — access_count, owner_id,
  // last_accessed_at, etc.). Pre-creating a partial schema here made it a
  // no-op on that call, and bridgeGetEntry's SELECT (which reads
  // access_count) then failed against the missing column — a self-inflicted
  // false negative, not the #3324 bug. Let the bridge own its own schema.
  return new Database(dbPath);
}

afterAll(async () => {
  const { __setMemoryBridgeRegistryForTests } = await import('../src/memory/memory-bridge.js');
  __setMemoryBridgeRegistryForTests(null);
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#3324 bridgeStorePattern bridge-fallback round trip', () => {
  it('the returned patternId is the actual storage key, not bridgeStoreEntry\'s internal row id', async () => {
    const { __setMemoryBridgeRegistryForTests, bridgeStorePattern, bridgeGetEntry } = await import(
      '../src/memory/memory-bridge.js'
    );

    db = makeDb();
    // registry.get('reasoningBank') → null forces bridgeStorePattern past
    // the healthy branch into its SQL-fallback ('bridge-fallback') branch.
    __setMemoryBridgeRegistryForTests({
      getAgentDB: () => ({ database: db, embedder: null }),
      get: () => null,
    });

    const marker = `bridge-fallback-roundtrip-${Date.now()}`;
    const stored = await bridgeStorePattern({
      pattern: `Use ${marker} for secure session renewal`,
      type: 'auth-pattern',
      confidence: 0.9,
      dbPath,
    });

    expect(stored).not.toBeNull();
    expect(stored!.success).toBe(true);
    expect(stored!.controller).toBe('bridge-fallback');
    // generateId('pattern') vs bridgeStoreEntry's own generateId('entry') —
    // the two id namespaces are distinguishable by prefix, which is exactly
    // the class of mixup #3324 reported (returning the entry-prefixed id
    // instead of the pattern-prefixed key).
    expect(stored!.patternId).toMatch(/^pattern[_-]/);
    expect(stored!.patternId).not.toMatch(/^entry[_-]/);

    const got = await bridgeGetEntry({ key: stored!.patternId, namespace: 'pattern', dbPath });
    expect(got).not.toBeNull();
    expect(got!.found).toBe(true);
    expect(got!.entry?.content).toContain(marker);

    // Directly confirms the row is genuinely stored under this key (not just
    // that bridgeGetEntry happens to also be broken the same way).
    const row = db.prepare('SELECT key, content FROM memory_entries WHERE key = ?').get(stored!.patternId) as
      | { key: string; content: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toContain(marker);
  });
});
