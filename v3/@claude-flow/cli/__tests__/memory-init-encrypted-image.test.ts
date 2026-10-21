import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { encryptBuffer } from '../src/encryption/vault.js';
import { checkMemoryInitialization } from '../src/memory/memory-initializer.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('initialization status of a real SQLite image', () => {
  it.each([false, true])('recognizes an existing store (encrypted=%s) without modifying it', async (encrypted) => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-init-image-'));
    dirs.push(dir);
    const dbPath = join(dir, 'memory.db');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE metadata (key TEXT, value TEXT); INSERT INTO metadata VALUES ('schema_version', '3'), ('backend', 'sql.js'); CREATE TABLE memory_entries (id TEXT); CREATE TABLE patterns (id TEXT)");
    const plain = Buffer.from(db.export());
    db.close();
    const key = Buffer.alloc(32, 7);
    vi.stubEnv('CLAUDE_FLOW_ENCRYPTION_KEY', key.toString('hex'));
    const image = encrypted ? encryptBuffer(plain, key) : plain;
    writeFileSync(dbPath, image);

    expect(await checkMemoryInitialization(dbPath)).toMatchObject({
      initialized: true, version: '3', backend: 'sql.js',
      features: { patternLearning: true },
    });
    expect(readFileSync(dbPath)).toEqual(image);
  });
});
