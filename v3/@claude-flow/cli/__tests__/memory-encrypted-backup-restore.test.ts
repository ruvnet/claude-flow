import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { backupMemoryDb, restoreMemoryDbFromBackup } from '../src/services/memory-backup.js';
import { encryptBuffer } from '../src/encryption/vault.js';

let dir: string;
let dbPath: string;
let plain: Buffer;
const key = Buffer.alloc(32, 7);
const start = 1_700_000_000_000;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-encrypted-restore-'));
  dbPath = join(dir, 'memory.db');
  const db = new Database(dbPath);
  db.exec("CREATE TABLE memory_entries (content TEXT); INSERT INTO memory_entries VALUES ('retained memory')");
  db.close();
  plain = readFileSync(dbPath);
  vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', key.toString('hex'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('encrypted backup recovery with native SQLite present', () => {
  it('restores a validated encrypted snapshot without stripping encryption', async () => {
    const encrypted = encryptBuffer(plain, key);
    writeFileSync(dbPath, encrypted);
    const snapshot = await backupMemoryDb({ dbPath, timestamp: start });
    expect(snapshot.backedUp).toBe(true);
    writeFileSync(dbPath, 'damaged live store');
    const restored = await restoreMemoryDbFromBackup(dbPath);
    expect(restored).toMatchObject({ restored: true, rows: 1, from: snapshot.path });
    expect(readFileSync(dbPath)).toEqual(encrypted);
    expect(readFileSync(restored.corruptBackupPath!, 'utf8')).toBe('damaged live store');
  });

  it('skips a newer encrypted snapshot with a bad authentication tag', async () => {
    const encrypted = encryptBuffer(plain, key);
    writeFileSync(dbPath, encrypted);
    const clean = await backupMemoryDb({ dbPath, timestamp: start });
    const damaged = Buffer.from(encrypted);
    damaged[damaged.length - 1] ^= 1;
    writeFileSync(dbPath, damaged);
    await backupMemoryDb({ dbPath, timestamp: start + 1000 });
    writeFileSync(dbPath, 'damaged live store');
    expect(await restoreMemoryDbFromBackup(dbPath)).toMatchObject({ restored: true, from: clean.path });
    expect(readFileSync(dbPath)).toEqual(encrypted);
  });

  it('leaves the live store untouched when no snapshot can be authenticated', async () => {
    writeFileSync(dbPath, encryptBuffer(plain, key));
    await backupMemoryDb({ dbPath, timestamp: start });
    writeFileSync(dbPath, 'damaged live store');
    vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('hex'));
    expect(await restoreMemoryDbFromBackup(dbPath)).toMatchObject({ restored: false });
    expect(readFileSync(dbPath, 'utf8')).toBe('damaged live store');
  });
});
