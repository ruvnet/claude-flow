/**
 * Unmocked end-to-end: AgentDBBackend (forceWasm) -> real AgentDB -> real
 * agentdb sql.js save with a stale dead-PID `<db>.agentdb.lock`.
 * Persistence is verified with better-sqlite3 (not sql.js).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { AgentDBBackend } from './agentdb-backend.js';
import { AgentdbLockError } from './agentdb-lock-guard.js';

const DEAD_PID = 2_147_483_000;
let dir: string;
let dbFile: string;
let lockFile: string;

function plant(pid: number): void {
  fs.writeFileSync(lockFile, `${pid}\n`);
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(lockFile, old, old);
}
const mk = () => new AgentDBBackend({ dbPath: dbFile, namespace: 'lock', vectorDimension: 384, forceWasm: true });

// AgentDB's forceWasm still picks better-sqlite3 inside db-fallback unless this is set.
beforeAll(() => { process.env.AGENTDB_FORCE_SQLJS = '1'; });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-lock-'));
  dbFile = path.join(dir, 'agentdb-memory.db');
  lockFile = `${dbFile}.agentdb.lock`;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('AgentDBBackend with real sql.js agentdb and a lock file', () => {
  it('dead-PID lock: initialize + store + shutdown persists the row and clears the lock', async () => {
    plant(DEAD_PID);
    const b = mk();
    await b.initialize();
    const raw = (b as any).getAgentDB().database;
    expect(raw.constructor.name).toBe('SqlJsDatabase'); // proves the locked sql.js path is exercised
    raw.exec('CREATE TABLE memory_entries(content TEXT)');
    raw.exec("INSERT INTO memory_entries VALUES('survives stale lock')");
    await b.shutdown();
    expect(fs.existsSync(lockFile)).toBe(false);
    const db = new Database(dbFile, { readonly: true });
    try {
      const rows = db.prepare('SELECT content FROM memory_entries').all() as Array<{ content: string }>;
      expect(rows.map((r) => r.content)).toContain('survives stale lock');
    } finally { db.close(); }
  });

  it('live-holder lock: shutdown rejects with AgentdbLockError and leaves the lock', async () => {
    const b = mk();
    await b.initialize();
    (b as any).getAgentDB().database.exec('CREATE TABLE t(x)');
    plant(process.ppid);
    await expect(b.shutdown()).rejects.toBeInstanceOf(AgentdbLockError);
    expect(fs.existsSync(lockFile)).toBe(true);
  });
});
