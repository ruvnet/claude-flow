/**
 * Regression for #2652's native/fallback visibility disagreement.
 *
 * Databases created before the status column existed contain NULL after an
 * additive migration. list() has long treated those rows as legacy-active,
 * but native retrieve/delete required the literal string "active". Mock the
 * ControllerRegistry only — all SQL executes against a real better-sqlite3
 * fixture, so this pins the production bridge path deterministically.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

vi.mock('@claude-flow/memory', () => ({
  ControllerRegistry: class {
    async initialize(options: { dbPath: string }): Promise<void> {
      state.db = new Database(options.dbPath);
    }

    getAgentDB(): { database: Database.Database; embedder: null } {
      if (!state.db) throw new Error('registry not initialized');
      return { database: state.db, embedder: null };
    }

    get(): null {
      return null;
    }

    set(): void {
      // Optional controllers are irrelevant to CRUD visibility.
    }
  },
}));

const root = mkdtempSync(join(tmpdir(), 'ruflo-2652-native-'));
const dbPath = join(root, 'memory.db');

function seedLegacyActiveRow(): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_model TEXT DEFAULT 'local',
      embedding_dimensions INTEGER,
      tags TEXT,
      metadata TEXT,
      owner_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      expires_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      status TEXT,
      provenance_type TEXT DEFAULT 'unknown',
      UNIQUE(namespace, key)
    );
    INSERT INTO memory_entries (
      id, key, namespace, content, created_at, updated_at, status
    ) VALUES (
      'legacy-live-id', 'project-state-current', 'fixture', 'visible value',
      1, 1, NULL
    );
  `);
  db.close();
}

seedLegacyActiveRow();

afterAll(() => {
  state.db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('#2652 active-row visibility', () => {
  it('retrieves and deletes the same legacy-active row through the native bridge', async () => {
    const { bridgeGetEntry, bridgeDeleteEntry } = await import('../src/memory/memory-bridge.js');

    const retrieved = await bridgeGetEntry({
      key: 'project-state-current',
      namespace: 'fixture',
      dbPath,
    });
    expect(retrieved).toMatchObject({
      success: true,
      found: true,
      entry: {
        id: 'legacy-live-id',
        key: 'project-state-current',
        namespace: 'fixture',
        content: 'visible value',
      },
    });

    const deleted = await bridgeDeleteEntry({
      key: 'project-state-current',
      namespace: 'fixture',
      dbPath,
    });
    expect(deleted).toMatchObject({
      success: true,
      deleted: true,
      remainingEntries: 0,
    });

    const row = state.db!
      .prepare('SELECT status FROM memory_entries WHERE id = ?')
      .get('legacy-live-id') as { status: string };
    expect(row.status).toBe('deleted');
  });
});
