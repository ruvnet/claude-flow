import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
vi.mock('better-sqlite3', () => { throw new Error('native backend unavailable'); });
import { restoreMemoryDbFromBackup } from '../src/services/memory-backup.js';

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-wasm-restore-'));
  dbPath = join(dir, 'memory.db');
  mkdirSync(join(dir, 'backups'));
  writeFileSync(dbPath, 'live store');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('backup recovery without native SQLite', () => {
  it('validates and selects the older readable snapshot instead of trusting the newest bytes', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE memory_entries (content TEXT); INSERT INTO memory_entries VALUES ('retained')");
    const valid = Buffer.from(db.export());
    db.close();
    const clean = join(dir, 'backups', 'memory-2023-11-14T22-13-20-000Z.db');
    writeFileSync(clean, valid);
    writeFileSync(join(dir, 'backups', 'memory-2023-11-14T22-13-21-000Z.db'), 'invalid SQLite');
    expect(await restoreMemoryDbFromBackup(dbPath)).toMatchObject({ restored: true, rows: 1, from: clean });
    expect(readFileSync(dbPath)).toEqual(valid);
  });

  it('refuses to replace the live store with an unverified nonempty file', async () => {
    writeFileSync(join(dir, 'backups', 'memory-2023-11-14T22-13-20-000Z.db'), 'invalid SQLite');
    expect(await restoreMemoryDbFromBackup(dbPath)).toMatchObject({ restored: false });
    expect(readFileSync(dbPath, 'utf8')).toBe('live store');
  });
});
