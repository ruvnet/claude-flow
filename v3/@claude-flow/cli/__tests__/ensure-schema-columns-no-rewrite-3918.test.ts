import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileMaybeEncrypted, writeFileRestricted } from '../src/fs-secure.js';
import { isEncryptedBlob } from '../src/encryption/vault.js';
import { ensureSchemaColumns } from '../src/memory/memory-initializer.js';

// #3918: ensureSchemaColumns set `modified = true` even when the status
// backfill touched 0 rows, so every open of an up-to-date store re-exported and
// rewrote the whole image. With encryption at rest each write uses a fresh
// nonce, so the bytes changed on every read-only command.

const COLUMNS = `id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT DEFAULT '',
  type TEXT DEFAULT 'semantic', embedding TEXT, embedding_model TEXT DEFAULT 'local',
  embedding_dimensions INTEGER, tags TEXT, metadata TEXT, owner_id TEXT, expires_at INTEGER,
  last_accessed_at INTEGER, access_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
  provenance_type TEXT DEFAULT 'unknown'`;

async function buildStore(path: string, ddl: string, rows: string[] = []): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE memory_entries (${ddl})`);
  for (const r of rows) db.run(r);
  writeFileRestricted(path, Buffer.from(db.export()), { encrypt: true });
  db.close();
}

describe('ensureSchemaColumns does not rewrite an up-to-date store (#3918)', () => {
  const saved = { gate: process.env.CLAUDE_FLOW_ENCRYPT_AT_REST, key: process.env.CLAUDE_FLOW_ENCRYPTION_KEY };
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = '1';
    process.env.CLAUDE_FLOW_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    dir = mkdtempSync(join(tmpdir(), 'ensure-schema-3918-'));
    dbPath = join(dir, 'memory.db');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [['CLAUDE_FLOW_ENCRYPT_AT_REST', saved.gate], ['CLAUDE_FLOW_ENCRYPTION_KEY', saved.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('leaves an encrypted, current-schema store byte-identical (and mtime untouched)', async () => {
    await buildStore(dbPath, COLUMNS, [`INSERT INTO memory_entries (id,key,namespace,content) VALUES ('1','k','ns','v')`]);
    expect(isEncryptedBlob(readFileSync(dbPath))).toBe(true);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;
    for (let i = 0; i < 2; i++) {
      expect(await ensureSchemaColumns(dbPath)).toEqual({ success: true, columnsAdded: [] });
    }
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
  });

  it('still backfills NULL status rows (rewrites only when rows changed)', async () => {
    await buildStore(dbPath, COLUMNS, [`INSERT INTO memory_entries (id,key,namespace,status) VALUES ('1','k','ns',NULL)`]);
    const before = readFileSync(dbPath);
    await ensureSchemaColumns(dbPath);
    const after = readFileSync(dbPath);
    expect(after.equals(before)).toBe(false);
    expect(isEncryptedBlob(after)).toBe(true);
    const SQL = await (await import('sql.js')).default();
    const db = new SQL.Database(readFileMaybeEncrypted(dbPath, null) as Buffer);
    expect(db.exec(`SELECT status FROM memory_entries`)[0].values[0][0]).toBe('active');
  });

  it('still adds missing columns on an old schema', async () => {
    await buildStore(dbPath, `id TEXT PRIMARY KEY, key TEXT, namespace TEXT`);
    const res = await ensureSchemaColumns(dbPath);
    expect(res.success).toBe(true);
    expect(res.columnsAdded).toContain('status');
    expect(res.columnsAdded).toContain('content');
    expect(isEncryptedBlob(readFileSync(dbPath))).toBe(true);
  });
});
