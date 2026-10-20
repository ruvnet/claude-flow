/**
 * Regression guard for PR #3526 review findings on the non-bridge
 * (sql.js fallback) `listEntries()` path in memory-initializer.ts:
 *
 * BLOCKING — the tags-filter `WHERE` clause added alongside ADR-323's
 * provenance filter REPLACED the existing `provenance_type IN (...)`
 * clause instead of being ANDed with it. The non-bridge path is the
 * default on Windows, is used whenever CLAUDE_FLOW_DISABLE_BRIDGE=1 is
 * set, and is used whenever the bridge fails to load for any reason — and
 * it is what serves `memory search --provenance-filter` in keyword/hybrid
 * mode. Dropping the clause let unverified `user_claim` rows leak into
 * results that are supposed to be `tool_result`-only (ADR-323
 * fact-checking relies on this filter).
 *
 * The existing ADR-323 provenance coverage (adr-323-memory-provenance.test.ts)
 * only drives the real CLI, which uses the native bridge in this
 * environment and therefore never exercised the sql.js fallback branch —
 * this suite explicitly force-disables the bridge (CLAUDE_FLOW_DISABLE_BRIDGE=1,
 * the package's own documented switch) so the bug is actually reachable,
 * and also runs the same assertions with the bridge left enabled for
 * comparison.
 *
 * MINOR — the tags filter used SQL `LIKE` against the raw JSON-array TEXT,
 * which is (a) ASCII case-insensitive (a filter of "prod" matched an entry
 * tagged "PROD") and (b) matched raw JSON bytes rather than parsed array
 * elements (a tag literally containing `"prod` could false-match). Fixed
 * via `EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)` — exact,
 * case-sensitive match against real JSON array elements.
 *
 * MINOR — `limit: 0` returned the default limit (100) instead of zero
 * rows, because `parseInt(String(limit), 10) || 100` treats an explicit 0
 * as falsy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_DISABLE_BRIDGE = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-3526-listentries-'));
  dbPath = path.join(dir, 'memory.db');
});

afterEach(() => {
  if (ORIGINAL_DISABLE_BRIDGE === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_DISABLE_BRIDGE;
  rmSync(dir, { recursive: true, force: true });
});

async function seedProvenanceRows(storeEntry: typeof import('../src/memory/memory-initializer.js').storeEntry) {
  // 9 rows total (matches the reviewer's repro shape): 1 tool_result, 8
  // of other provenance types, so a correct filter must return exactly 1.
  await storeEntry({ key: 'tool/1', value: 'a tool result', dbPath, provenanceType: 'tool_result', generateEmbeddingFlag: false });
  for (let i = 0; i < 8; i++) {
    await storeEntry({
      key: `claim/${i}`,
      value: `unverified claim ${i}`,
      dbPath,
      provenanceType: 'user_claim',
      generateEmbeddingFlag: false,
    });
  }
}

describe('listEntries provenance filter — non-bridge (sql.js) path must AND with the tags clause, not replace it (#3526)', () => {
  it('with the native bridge explicitly disabled, provenanceFilter still excludes non-matching rows', async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);
    await seedProvenanceRows(storeEntry);

    const all = await listEntries({ dbPath, provenanceFilter: undefined });
    expect(all.total).toBe(9);

    const filtered = await listEntries({ dbPath, provenanceFilter: ['tool_result'] });
    expect(filtered.success).toBe(true);
    expect(filtered.total).toBe(1);
    expect(filtered.entries.map(e => e.key)).toEqual(['tool/1']);
  });

  it('with the native bridge available (default), provenanceFilter excludes non-matching rows the same way', async () => {
    delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);
    await seedProvenanceRows(storeEntry);

    const filtered = await listEntries({ dbPath, provenanceFilter: ['tool_result'] });
    expect(filtered.success).toBe(true);
    expect(filtered.total).toBe(1);
    expect(filtered.entries.map(e => e.key)).toEqual(['tool/1']);
  });

  it('provenanceFilter and tags are ANDed together, not one replacing the other', async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);

    await storeEntry({ key: 'a', value: 'v', dbPath, provenanceType: 'tool_result', tags: ['prod'], generateEmbeddingFlag: false });
    await storeEntry({ key: 'b', value: 'v', dbPath, provenanceType: 'user_claim', tags: ['prod'], generateEmbeddingFlag: false });
    await storeEntry({ key: 'c', value: 'v', dbPath, provenanceType: 'tool_result', tags: ['staging'], generateEmbeddingFlag: false });

    const result = await listEntries({ dbPath, provenanceFilter: ['tool_result'], tags: ['prod'] });
    expect(result.success).toBe(true);
    expect(result.entries.map(e => e.key)).toEqual(['a']);
  });
});

describe('listEntries tags filter — exact match, not case-insensitive substring (#3526 minor)', () => {
  it('a tag filter of "prod" does not match an entry tagged "PROD" (LIKE is ASCII case-insensitive)', async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);

    await storeEntry({ key: 'upper', value: 'v', dbPath, tags: ['PROD'], generateEmbeddingFlag: false });
    await storeEntry({ key: 'lower', value: 'v', dbPath, tags: ['prod'], generateEmbeddingFlag: false });

    const result = await listEntries({ dbPath, tags: ['prod'] });
    expect(result.entries.map(e => e.key)).toEqual(['lower']);
  });

  it('a tag filter does not false-match a JSON-injection-shaped tag value', async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);

    // Tag array containing a literal string that would sit inside the raw
    // JSON text next to a real "prod" element if matched via LIKE-on-JSON.
    await storeEntry({ key: 'injected', value: 'v', dbPath, tags: ['x","prod'], generateEmbeddingFlag: false });
    await storeEntry({ key: 'real', value: 'v', dbPath, tags: ['prod'], generateEmbeddingFlag: false });

    const result = await listEntries({ dbPath, tags: ['prod'] });
    expect(result.entries.map(e => e.key)).toEqual(['real']);
  });
});

describe('listEntries limit — explicit 0 means zero results, not the default (#3526 minor, non-bridge path)', () => {
  it('limit: 0 returns zero entries', async () => {
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    const { initializeMemoryDatabase, storeEntry, listEntries } = await import('../src/memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ dbPath, verbose: false });
    expect(init.success).toBe(true);
    for (let i = 0; i < 5; i++) {
      await storeEntry({ key: `k${i}`, value: 'v', dbPath, generateEmbeddingFlag: false });
    }

    const result = await listEntries({ dbPath, limit: 0 });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(0);
    // total still reports the true row count — only the page is empty.
    expect(result.total).toBe(5);
  });
});
