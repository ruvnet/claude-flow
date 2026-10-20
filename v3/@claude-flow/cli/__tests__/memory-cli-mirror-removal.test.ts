import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/output.js', () => ({ output: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock('../src/prompt.js', () => ({ confirm: vi.fn(async () => true), select: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
import { writeFileRestricted } from '../src/fs-secure.js';
import { memoryCommand } from '../src/commands/memory.js';
import { _resetMemoryRootCache, initializeMemoryDatabase, storeEntry, listEntries, purgeNamespace } from '../src/memory/memory-initializer.js';

let dir: string;
let primary: string;
let mirror: string;
async function invoke(name: string, flags: Record<string, unknown> = {}) {
  return memoryCommand.subcommands!.find(c => c.name === name)!.action!({
    flags: { namespace: 'scratch', key: 'remove', force: true, ...flags }, args: [], interactive: false,
  } as never);
}
async function count(dbPath: string, namespace = 'scratch') {
  return (await listEntries({ dbPath, namespace })).total;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'memory-cli-mirror-'));
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', dir);
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  _resetMemoryRootCache();
  primary = join(dir, 'memory.db');
  mirror = join(dir, 'agentdb-memory.db');
  for (const dbPath of [primary, mirror]) {
    expect((await initializeMemoryDatabase({ dbPath, force: true, migrate: false })).success).toBe(true);
    for (const namespace of ['scratch', 'keep']) {
      expect((await storeEntry({ dbPath, namespace, key: 'remove', value: namespace, generateEmbeddingFlag: false })).success).toBe(true);
    }
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI removal of default memory and its AgentDB mirror', () => {
  it.each(['delete', 'purge'])('%s removes matching entries from both stores', async (command) => {
    expect((await invoke(command)).success).toBe(true);
    expect(await count(primary)).toBe(0);
    expect(await count(mirror)).toBe(0);
    expect(await count(primary, 'keep')).toBe(1);
    expect(await count(mirror, 'keep')).toBe(1);
  });

  it.each(['delete', 'purge', 'preview'])('%s preserves a plaintext mirror when the primary is encrypted', async command => {
    vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '1');
    vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', '11'.repeat(32));
    writeFileRestricted(primary, readFileSync(primary), { encrypt: true });
    expect(readFileSync(primary).subarray(0, 4).toString()).toBe('RFE1');
    expect(readFileSync(mirror).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    expect((await invoke(command === 'preview' ? 'purge' : command, { dryRun: command === 'preview' })).success).toBe(true);
    // Inspect raw bytes before any list helper can rewrite schema metadata.
    expect(readFileSync(primary).subarray(0, 4).toString()).toBe('RFE1');
    expect(readFileSync(mirror).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    // Open the native file directly with SQLite, bypassing the decrypting reader.
    const SQL = await (await import('sql.js')).default();
    const db = new SQL.Database(readFileSync(mirror));
    try {
      expect(db.exec("SELECT COUNT(*) FROM memory_entries WHERE namespace = 'scratch' AND status = 'active'")[0].values[0][0]).toBe(command === 'preview' ? 1 : 0);
      expect(db.exec("SELECT COUNT(*) FROM memory_entries WHERE namespace = 'keep'")[0].values[0][0]).toBe(1);
    } finally { db.close(); }
  });

  // The guard is liveness-based (#3161), not presence-based: a hand-touched
  // `-wal` file next to a non-WAL-mode db is inert under the probe and no
  // longer proves anything, so these simulate a genuinely live native
  // holder instead — a real WAL-mode connection with an open, uncommitted
  // transaction on the mirror. `setup` first stabilizes the mirror in real
  // WAL mode with a committed baseline (closed cleanly, so no sidecars
  // remain) so enabling WAL mode itself doesn't show up as an unrelated
  // byte diff in the `before`/`after` comparison below.
  it.each(['delete', 'purge', 'preview'])('%s refuses to rewrite a mirror while a native WAL writer holds an open transaction', async command => {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const setup = new Database(mirror);
    setup.pragma('journal_mode = WAL');
    setup.exec('CREATE TABLE IF NOT EXISTS _wal_probe_marker(x)');
    setup.close();

    const before = readFileSync(mirror);
    const live = new Database(mirror);
    live.pragma('journal_mode = WAL');
    live.exec('BEGIN');
    live.exec('INSERT INTO _wal_probe_marker VALUES (1)');
    try {
      expect(await invoke(command === 'preview' ? 'purge' : command, { dryRun: command === 'preview' }))
        .toMatchObject({ success: false, exitCode: 1 });
      expect(readFileSync(mirror)).toEqual(before);
    } finally {
      live.exec('ROLLBACK');
      live.close();
    }
  });

  it('refuses a native WAL writer with an open transaction in the purge fallback after preview', async () => {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const setup = new Database(mirror);
    setup.pragma('journal_mode = WAL');
    setup.exec('CREATE TABLE IF NOT EXISTS _wal_probe_marker(x)');
    setup.close();

    const before = readFileSync(mirror);
    const live = new Database(mirror);
    live.pragma('journal_mode = WAL');
    live.exec('BEGIN');
    live.exec('INSERT INTO _wal_probe_marker VALUES (1)');
    try {
      expect(await purgeNamespace({ namespace: 'scratch', dbPath: mirror, encryptWrites: false }))
        .toMatchObject({ success: false });
      expect(readFileSync(mirror)).toEqual(before);
    } finally {
      live.exec('ROLLBACK');
      live.close();
    }
  });

  it('refuses an unconfirmed purge without changing either store', async () => {
    expect(await invoke('purge', { force: false })).toMatchObject({ success: false, exitCode: 1 });
    expect(await count(primary)).toBe(1);
    expect(await count(mirror)).toBe(1);
  });

  it('previews both stores without modifying either', async () => {
    const result = await invoke('purge', { dryRun: true });
    expect(result.data).toMatchObject({ wouldDelete: 2 });
    expect(await count(primary)).toBe(1);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s honors an explicit single-store path', async (command) => {
    expect((await invoke(command, { path: primary })).success).toBe(true);
    expect(await count(primary)).toBe(0);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s honors the environment single-store override', async (command) => {
    vi.stubEnv('CLAUDE_FLOW_DB_PATH', primary);
    expect((await invoke(command)).success).toBe(true);
    expect(await count(mirror)).toBe(1);
  });

  it.each(['delete', 'purge'])('%s reports a failure if the mirror cannot be modified', async (command) => {
    writeFileSync(mirror, 'not a database');
    expect(await invoke(command)).toMatchObject({ success: false, exitCode: 1 });
  });

  it('can remove mirror-only rows when the primary store is absent', async () => {
    rmSync(primary);
    expect((await invoke('purge')).success).toBe(true);
    expect(await count(mirror)).toBe(0);
  });
});
