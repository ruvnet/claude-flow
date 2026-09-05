/**
 * Regression coverage for issue #2735: memory CRUD's sql.js fallback did a
 * whole-image read-modify-persist (export() + rename over the live
 * database path) with no regard for whether a native better-sqlite3 WAL
 * connection was already attached — corrupting the shared database or
 * silently losing an acknowledged write when the fallback fired while a
 * native writer (daemon, MCP server, another CLI invocation) held the file
 * open.
 *
 * This suite covers the scoped fix actually shipped: refuse the sql.js
 * fallback (`success: false`, typed error, never a whole-image write) when
 * `-wal`/`-shm` sidecar files are present next to the database — strong
 * evidence of a live native WAL connection, since a native connection keeps
 * its sidecars on disk for its entire lifetime. It does NOT cover the
 * fuller "scan live process holders" design also discussed in the issue —
 * that remains a documented follow-up, not part of this fix.
 *
 * The bridge is force-disabled via CLAUDE_FLOW_DISABLE_BRIDGE=1 (the
 * package's own documented switch, dist/src/memory/memory-initializer.js)
 * so every case below exercises the sql.js fallback path directly,
 * deterministically, without needing a real second native connection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_ENV = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-2735-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  // Reset the module registry so each test gets a fresh dynamic import —
  // the module under test is pure-functional (no top-level state this
  // suite depends on), but sql.js's own WASM init is safest re-run clean.
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');
  const initResult = await initializeMemoryDatabase({ dbPath, verbose: false });
  expect(initResult.success).toBe(true);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_ENV;
  rmSync(dir, { recursive: true, force: true });
});

describe('memory sql.js fallback WAL-sidecar guard — issue #2735', () => {
  it('storeEntry refuses the whole-image write when -wal sidecar is present', async () => {
    writeFileSync(`${dbPath}-wal`, '');
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k1', value: 'v1', dbPath });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native WAL connection/i);
  });

  it('storeEntry refuses the whole-image write when -shm sidecar is present', async () => {
    writeFileSync(`${dbPath}-shm`, '');
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k1', value: 'v1', dbPath });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native WAL connection/i);
  });

  it('storeEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k1', value: 'v1', dbPath, generateEmbeddingFlag: false });
    expect(result.success).toBe(true);
    expect(result.id).not.toBe('');
  });

  it('getEntry refuses the whole-image access_count-bump write when sidecars are present', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const stored = await storeEntry({ key: 'k2', value: 'v2', dbPath, generateEmbeddingFlag: false });
    expect(stored.success).toBe(true);

    writeFileSync(`${dbPath}-wal`, '');
    const { getEntry } = await import('../src/memory/memory-initializer.js');
    const result = await getEntry({ key: 'k2', dbPath });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native WAL connection/i);
  });

  it('getEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry, getEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k3', value: 'v3', dbPath, generateEmbeddingFlag: false });
    const result = await getEntry({ key: 'k3', dbPath });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });

  it('deleteEntry refuses the whole-image write when sidecars are present', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k4', value: 'v4', dbPath, generateEmbeddingFlag: false });

    writeFileSync(`${dbPath}-shm`, '');
    const { deleteEntry } = await import('../src/memory/memory-initializer.js');
    const result = await deleteEntry({ key: 'k4', dbPath });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native WAL connection/i);
  });

  it('deleteEntry proceeds normally with no sidecars present', async () => {
    const { storeEntry, deleteEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k5', value: 'v5', dbPath, generateEmbeddingFlag: false });
    const result = await deleteEntry({ key: 'k5', dbPath });
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
  });

  it('a refused store never touches the database file (no whole-image write occurred)', async () => {
    const before = existsSync(dbPath) ? require('node:fs').statSync(dbPath).mtimeMs : 0;
    writeFileSync(`${dbPath}-wal`, '');
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const result = await storeEntry({ key: 'k6', value: 'v6', dbPath });
    expect(result.success).toBe(false);
    const after = require('node:fs').statSync(dbPath).mtimeMs;
    expect(after).toBe(before);
  });
});
