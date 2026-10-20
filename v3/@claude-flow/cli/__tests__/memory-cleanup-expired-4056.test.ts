/**
 * #4056 — `memory cleanup --expired-only` reported `Patterns removed: 0` and
 * left every expired row in place. Cause: `memory_cleanup` finds its
 * candidates through `listEntries`, and `listEntries` hides expired rows
 * (TTL is a read-time visibility rule, `liveMemoryRowSql`), so the cleanup
 * could never see what it was meant to remove.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  _resetMemoryRootCache,
  initializeMemoryDatabase,
  storeEntry,
  listEntries,
} from '../src/memory/memory-initializer.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const ENV = ['CLAUDE_FLOW_MEMORY_PATH', 'CLAUDE_FLOW_DISABLE_BRIDGE', 'CLAUDE_FLOW_DB_PATH'];
const SAVED: Record<string, string | undefined> = {};
let tmp: string;
let dbPath: string;

async function expireRows(namespace: string, expiresAt: number): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run('UPDATE memory_entries SET expires_at = ? WHERE namespace = ?', [expiresAt, namespace]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

beforeEach(async () => {
  for (const n of ENV) SAVED[n] = process.env[n];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-expired-4056-'));
  dbPath = path.join(tmp, 'memory.db');
  process.env.CLAUDE_FLOW_MEMORY_PATH = tmp;
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  delete process.env.CLAUDE_FLOW_DB_PATH;
  _resetMemoryRootCache();
  expect((await initializeMemoryDatabase({ dbPath, force: true, migrate: false })).success).toBe(true);
  for (let i = 0; i < 5; i++) {
    await storeEntry({ key: `cmd-${i}`, value: `ls ${i}`, namespace: 'commands', dbPath, generateEmbeddingFlag: false });
  }
  await storeEntry({ key: 'keep', value: 'x', namespace: 'other', dbPath, generateEmbeddingFlag: false });
  await expireRows('commands', 1000);
});

afterEach(() => {
  for (const n of ENV) {
    if (SAVED[n] === undefined) delete process.env[n];
    else process.env[n] = SAVED[n];
  }
  _resetMemoryRootCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('expired rows are visible to cleanup, hidden from normal reads (#4056)', () => {
  it('a normal listing still hides expired rows', async () => {
    const res = await listEntries({ namespace: 'commands', dbPath });
    expect(res.total).toBe(0);
  });

  it('includeExpired lists them and reports expiresAt', async () => {
    const res = await listEntries({ namespace: 'commands', dbPath, includeExpired: true });
    expect(res.total).toBe(5);
    for (const e of res.entries) expect(e.expiresAt).toBe(1000);
  });

  const cleanup = memoryTools.find(t => t.name === 'memory_cleanup')!;

  it('memory_cleanup dry run counts the expired rows', async () => {
    const res = await cleanup.handler({ dryRun: true }) as { candidates: { expired: number } };
    expect(res.candidates.expired).toBe(5);
  });

  it('memory_cleanup removes the expired rows and leaves the rest', async () => {
    const res = await cleanup.handler({ dryRun: false }) as { deleted: { entries: number } };
    expect(res.deleted.entries).toBe(5);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const live = db.exec("SELECT namespace, COUNT(*) FROM memory_entries WHERE status = 'active' GROUP BY namespace");
    db.close();
    expect(live[0].values).toEqual([['other', 1]]);
  });
});
