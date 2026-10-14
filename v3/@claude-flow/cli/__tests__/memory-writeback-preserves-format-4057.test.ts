/**
 * #4057 — `memory purge` fell back to the whole-file sql.js path and, with
 * encryption at rest on, rewrote a PLAINTEXT native SQLite store as an
 * RFE1-encrypted blob while reporting `[OK]`. The native bridge and every
 * SQLite reader could no longer open the store.
 *
 * Contract: a whole-file sql.js read-modify-write must write the image back
 * in the format it read (plaintext in -> plaintext out, RFE1 in -> RFE1 out),
 * whatever the environment says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  initializeMemoryDatabase,
  storeEntry,
  listEntries,
  purgeNamespace,
  deleteEntry,
  ensureSchemaColumns,
  applyTemporalDecay,
} from '../src/memory/memory-initializer.js';
import { isEncryptedBlob } from '../src/encryption/vault.js';

const SAVED: Record<string, string | undefined> = {};
const ENV = ['CLAUDE_FLOW_ENCRYPT_AT_REST', 'CLAUDE_FLOW_ENCRYPTION_KEY', 'CLAUDE_FLOW_DISABLE_BRIDGE'];

let tmp: string;
let dbPath: string;

const isPlainSqlite = (p: string) =>
  fs.readFileSync(p).subarray(0, 15).toString('latin1') === 'SQLite format 3';

async function seed(): Promise<void> {
  const init = await initializeMemoryDatabase({ dbPath, force: true, migrate: false });
  expect(init.success).toBe(true);
  for (const [ns, key] of [['feedback', 'a'], ['feedback', 'b'], ['keep', 'c']]) {
    await storeEntry({ key, value: `v-${key}`, namespace: ns, dbPath, generateEmbeddingFlag: false });
  }
}

beforeEach(() => {
  for (const n of ENV) SAVED[n] = process.env[n];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'writeback-format-4057-'));
  dbPath = path.join(tmp, 'agentdb-memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  delete process.env.CLAUDE_FLOW_ENCRYPT_AT_REST;
  delete process.env.CLAUDE_FLOW_ENCRYPTION_KEY;
});

afterEach(() => {
  for (const n of ENV) {
    if (SAVED[n] === undefined) delete process.env[n];
    else process.env[n] = SAVED[n];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function turnEncryptionOn(): void {
  process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = '1';
  process.env.CLAUDE_FLOW_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}

describe('whole-file sql.js write-back keeps the on-disk format (#4057)', () => {
  it('purgeNamespace on a plaintext store stays plaintext when encryption is switched on', async () => {
    await seed();
    expect(isPlainSqlite(dbPath)).toBe(true);
    turnEncryptionOn();

    const res = await purgeNamespace({ namespace: 'feedback', dbPath });

    expect(res.success).toBe(true);
    expect(res.deletedCount).toBe(2);
    expect(isPlainSqlite(dbPath)).toBe(true);
    expect(isEncryptedBlob(fs.readFileSync(dbPath))).toBe(false);
  });

  it('deleteEntry on a plaintext store stays plaintext when encryption is switched on', async () => {
    await seed();
    turnEncryptionOn();

    const res = await deleteEntry({ key: 'c', namespace: 'keep', dbPath });

    expect(res.success).toBe(true);
    expect(isPlainSqlite(dbPath)).toBe(true);
  });

  it('ensureSchemaColumns on a plaintext store stays plaintext when encryption is switched on', async () => {
    await seed();
    turnEncryptionOn();

    const res = await ensureSchemaColumns(dbPath);

    expect(res.success).toBe(true);
    expect(isPlainSqlite(dbPath)).toBe(true);
  });

  it('an already-encrypted store stays encrypted after a purge (no silent downgrade)', async () => {
    turnEncryptionOn();
    await seed();
    expect(isEncryptedBlob(fs.readFileSync(dbPath))).toBe(true);

    const res = await purgeNamespace({ namespace: 'feedback', dbPath });

    expect(res.success).toBe(true);
    expect(isEncryptedBlob(fs.readFileSync(dbPath))).toBe(true);
    const left = await listEntries({ namespace: 'keep', dbPath });
    expect(left.total).toBe(1);
  });

  it('the store is still readable by a plain SQLite reader after the purge', async () => {
    await seed();
    turnEncryptionOn();
    await purgeNamespace({ namespace: 'feedback', dbPath });

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const rows = db.exec("SELECT namespace, COUNT(*) FROM memory_entries GROUP BY namespace");
    db.close();
    expect(rows[0].values).toEqual([['keep', 1]]);
  });
  it('applyTemporalDecay keeps an encrypted store encrypted (it used to write the decrypted image back)', async () => {
    turnEncryptionOn();
    await seed();
    expect(isEncryptedBlob(fs.readFileSync(dbPath))).toBe(true);

    const res = await applyTemporalDecay(dbPath);

    expect(res.success).toBe(true);
    expect(isEncryptedBlob(fs.readFileSync(dbPath))).toBe(true);
  });

  it('applyTemporalDecay keeps a plaintext store plaintext when encryption is switched on', async () => {
    await seed();
    turnEncryptionOn();

    const res = await applyTemporalDecay(dbPath);

    expect(res.success).toBe(true);
    expect(isPlainSqlite(dbPath)).toBe(true);
  });
});
