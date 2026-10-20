/**
 * #3508 — read-only memory route/peek.
 *
 * `memory peek` must answer "which store files does this cwd resolve to,
 * how many rows, when was the last write, and why" without ever creating,
 * initializing, or migrating anything — unlike `memory stats` (#3448),
 * which still calls `ensureInitialized()` when no explicit path is given.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';
import { memoryPeek } from '../src/memory/memory-peek.js';
import { MAGIC } from '../src/encryption/vault.js';

let testDir: string;
let originalDbPath: string | undefined;
let originalMemoryPath: string | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'memory-peek-3508-'));
  originalDbPath = process.env.CLAUDE_FLOW_DB_PATH;
  originalMemoryPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  delete process.env.CLAUDE_FLOW_DB_PATH;
  delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  _resetMemoryRootCache();
});

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
  else process.env.CLAUDE_FLOW_DB_PATH = originalDbPath;
  if (originalMemoryPath === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  else process.env.CLAUDE_FLOW_MEMORY_PATH = originalMemoryPath;
  _resetMemoryRootCache();
  rmSync(testDir, { recursive: true, force: true });
});

/** Build a real sql.js `memory.db` file on disk — same engine the CLI
 * store uses — so the peek read path is exercised against a real file,
 * not a mock. */
async function writeSqlJsFixture(
  dbPath: string,
  rows: Array<{ id: string; key: string; namespace: string; createdAt: number; updatedAt: number; status: string }>,
): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const initSqlJs = (await import('sql.js')).default as unknown as () => Promise<any>;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT,
    created_at INTEGER, updated_at INTEGER, status TEXT
  )`);
  for (const r of rows) {
    db.run(
      'INSERT INTO memory_entries (id, key, namespace, content, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [r.id, r.key, r.namespace, 'content', r.createdAt, r.updatedAt, r.status],
    );
  }
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

/** Build a real better-sqlite3 `agentdb-memory.db` sibling, the same way
 * the native bridge writes it. */
async function writeNativeFixture(
  dbPath: string,
  rows: Array<{ id: string; key: string; namespace: string; createdAt: number; updatedAt: number; status: string }>,
): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const Database = (await import('better-sqlite3')).default as unknown as new (p: string) => any;
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT,
    created_at INTEGER, updated_at INTEGER, status TEXT
  )`);
  const insert = db.prepare(
    'INSERT INTO memory_entries (id, key, namespace, content, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const r of rows) insert.run(r.id, r.key, r.namespace, 'content', r.createdAt, r.updatedAt, r.status);
  db.close();
}

function allFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFilesUnder(full));
    else out.push(full);
  }
  return out;
}

describe('#3508 memory peek is read-only', () => {
  it('creates nothing in a fresh project — the core correctness property', async () => {
    const root = join(testDir, '.swarm');
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();

    const result = await memoryPeek();

    expect(allFilesUnder(testDir)).toEqual([]);
    expect(existsSync(root)).toBe(false);
    expect(result.stores).toEqual([
      { role: 'cli', path: join(root, 'memory.db'), exists: false, rows: null, lastWrite: null, sizeBytes: null, walBytes: null },
      { role: 'mcp', path: join(root, 'agentdb-memory.db'), exists: false, rows: null, lastWrite: null, sizeBytes: null, walBytes: null },
    ]);
    expect(result.sharedKeys).toBeNull();
  });

  it('never opens a file it does not report as existing', async () => {
    // Only the cli store exists; the mcp sibling must stay unopened/unreported as existing.
    const root = join(testDir, '.swarm');
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();
    await writeSqlJsFixture(join(root, 'memory.db'), []);

    const result = await memoryPeek();

    expect(result.stores.find(s => s.role === 'cli')!.exists).toBe(true);
    expect(result.stores.find(s => s.role === 'mcp')!.exists).toBe(false);
    expect(existsSync(join(root, 'agentdb-memory.db'))).toBe(false);
  });
});

describe('#3508 memory peek reports rows, last write, and route source', () => {
  it('counts only active rows and reports the latest write for the cli store', async () => {
    const root = join(testDir, '.swarm');
    await writeSqlJsFixture(join(root, 'memory.db'), [
      { id: '1', key: 'a', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
      { id: '2', key: 'b', namespace: 'default', createdAt: 2000, updatedAt: 5000, status: 'active' },
      { id: '3', key: 'c', namespace: 'default', createdAt: 9999999, updatedAt: 9999999, status: 'deleted' },
      { id: '4', key: 'd', namespace: 'default', createdAt: 3000, updatedAt: 3000, status: 'active' as unknown as string },
    ]);

    const result = await memoryPeek({ path: join(root, 'memory.db') });
    const cli = result.stores.find(s => s.role === 'cli')!;

    expect(cli.exists).toBe(true);
    expect(cli.rows).toBe(3); // the soft-deleted row (#3) is excluded
    expect(cli.lastWrite).toBe(new Date(5000).toISOString()); // max(updated_at) among active rows
    expect(cli.sizeBytes).toBeGreaterThan(0);
    expect(cli.walBytes).toBe(0); // no -wal sidecar on disk
    expect(result.root.source).toBe('path');
  });

  it('reports rows and last write for the native mcp sibling independently', async () => {
    const root = join(testDir, '.swarm');
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();
    await writeNativeFixture(join(root, 'agentdb-memory.db'), [
      { id: 'n1', key: 'x', namespace: 'ns', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, status: 'active' },
      { id: 'n2', key: 'y', namespace: 'ns', createdAt: 1_700_000_001_000, updatedAt: 1_700_000_002_000, status: 'active' },
    ]);

    const result = await memoryPeek();
    const mcp = result.stores.find(s => s.role === 'mcp')!;
    const cli = result.stores.find(s => s.role === 'cli')!;

    expect(cli.exists).toBe(false);
    expect(mcp.exists).toBe(true);
    expect(mcp.rows).toBe(2);
    expect(mcp.lastWrite).toBe(new Date(1_700_000_002_000).toISOString());
  });

  it('counts sharedKeys as the intersection, never the sum of both stores', async () => {
    const root = join(testDir, '.swarm');
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();
    await writeSqlJsFixture(join(root, 'memory.db'), [
      { id: '1', key: 'shared-1', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
      { id: '2', key: 'shared-2', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
      { id: '3', key: 'cli-only', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
    ]);
    await writeNativeFixture(join(root, 'agentdb-memory.db'), [
      { id: 'n1', key: 'shared-1', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
      { id: 'n2', key: 'shared-2', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
      { id: 'n3', key: 'mcp-only', namespace: 'default', createdAt: 1000, updatedAt: 1000, status: 'active' },
    ]);

    const result = await memoryPeek();

    // 3 + 3 = 6 is the bug #3508 calls out; the right answer is the 2-key overlap.
    expect(result.sharedKeys).toBe(2);
  });

  it.each([
    ['CLAUDE_FLOW_DB_PATH', 'CLAUDE_FLOW_DB_PATH' as const],
    ['CLAUDE_FLOW_MEMORY_PATH', 'CLAUDE_FLOW_MEMORY_PATH' as const],
  ])('labels the route source as %s when that decided it', async (envVar, expectedSource) => {
    const root = join(testDir, '.swarm');
    if (envVar === 'CLAUDE_FLOW_DB_PATH') process.env.CLAUDE_FLOW_DB_PATH = join(root, 'memory.db');
    else process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();

    const result = await memoryPeek();

    expect(result.root.source).toBe(expectedSource);
  });

  it('defaults the route source to "default" with no override', async () => {
    const result = await memoryPeek();
    expect(result.root.source).toBe('default');
    expect(result.cwd).toBe(process.cwd());
  });

  it('reports an encrypted-at-rest memory.db as rows: null, encrypted: true, with size still reported', async () => {
    const root = join(testDir, '.swarm');
    process.env.CLAUDE_FLOW_MEMORY_PATH = root;
    _resetMemoryRootCache();
    mkdirSync(root, { recursive: true });
    const fakeEncrypted = Buffer.concat([MAGIC, Buffer.alloc(60, 7)]);
    writeFileSync(join(root, 'memory.db'), fakeEncrypted);

    const result = await memoryPeek();
    const cli = result.stores.find(s => s.role === 'cli')!;

    expect(cli.encrypted).toBe(true);
    expect(cli.rows).toBeNull();
    expect(cli.sizeBytes).toBe(fakeEncrypted.length);
  });
});
