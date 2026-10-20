/**
 * ControllerRegistry x agentdb alpha.20 sql.js lock handling.
 *
 * AgentDB only reaches the sql.js (locked-save) path when better-sqlite3 is
 * unavailable, which cannot be forced through the registry, so `agentdb` is
 * replaced with a stand-in that opens a REAL agentdb sql.js database
 * (agentdb/db-fallback) and closes it the way AgentDB.close() does.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('agentdb', async () => {
  const { createDatabase } = (await import('agentdb/db-fallback')) as any;
  class SqlJsAgentDB {
    db: any;
    constructor(private cfg: { dbPath: string }) {}
    async initialize() {
      this.db = await createDatabase(this.cfg.dbPath);
      this.db.exec('CREATE TABLE IF NOT EXISTS t(x)');
    }
    async close() { this.db.close(); }
    get database() { return this.db; }
    getController() { return null; }
  }
  return { AgentDB: SqlJsAgentDB, default: SqlJsAgentDB };
});

import { ControllerRegistry } from './controller-registry.js';
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

beforeAll(() => { process.env.AGENTDB_FORCE_SQLJS = '1'; });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-lock-'));
  dbFile = path.join(dir, 'agentdb-memory.db');
  lockFile = `${dbFile}.agentdb.lock`;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const cfg = () => ({ dbPath: dbFile, controllers: {} as any });

describe('ControllerRegistry + stale/live agentdb lock', () => {
  it('stale lock from a dead writer: shutdown clears it and persists the db', async () => {
    plant(DEAD_PID);
    const reg = new ControllerRegistry();
    const unavailable: unknown[] = [];
    reg.on('agentdb:unavailable', (e) => unavailable.push(e));
    await reg.initialize(cfg());
    expect(unavailable).toEqual([]);
    await reg.shutdown();
    expect(fs.existsSync(dbFile)).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('live lock: shutdown surfaces AgentdbLockError and emits agentdb:persist-failed; lock untouched', async () => {
    const reg = new ControllerRegistry();
    await reg.initialize(cfg());
    plant(process.ppid);
    const events: unknown[] = [];
    reg.on('agentdb:persist-failed', (e) => events.push(e));
    await expect(reg.shutdown()).rejects.toBeInstanceOf(AgentdbLockError);
    expect(events.length).toBe(1);
    expect(fs.existsSync(lockFile)).toBe(true);
  });
});
