/**
 * #3196 (export half): `memory export` had no `--path` and
 * `memory_export` had no `dbPath` input. An explicit snapshot could not be
 * exported, and the handler always opened the default store(s), so exporting
 * a sibling/backup DB was impossible from the CLI.
 *
 * The handler test uses a sql.js fixture (no native module) and an explicit
 * dbPath; it must not initialize or touch the default store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memoryTools } from '../src/mcp-tools/memory-tools.js';
import { MEMORY_SCHEMA_V3 } from '../src/memory/memory-initializer.js';
import { memoryCommand } from '../src/commands/memory.js';

const exportTool = memoryTools.find(t => t.name === 'memory_export')!;
const exportCommand = memoryCommand.subcommands!.find(c => c.name === 'export')!;

let Database: any;

async function seed(dbPath: string, keys: string[]): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(MEMORY_SCHEMA_V3);
    const now = Date.now();
    for (const [i, key] of keys.entries()) {
      db.run(
        `INSERT INTO memory_entries
           (id, key, namespace, content, access_count, created_at, updated_at, status)
         VALUES (?, ?, 'snapshot', ?, 0, ?, ?, 'active')`,
        [`id-${i}`, key, `value for ${key}`, now, now],
      );
    }
    db.run('PRAGMA wal_checkpoint');
    const bytes = db.export();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dbPath, Buffer.from(bytes));
  } finally {
    db.close();
  }
}

describe('memory export explicit dbPath (#3196)', () => {
  let dir: string;
  let prevMemoryPath: string | undefined;
  let prevBridge: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-export-path-'));
    prevMemoryPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
    prevBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    process.env.CLAUDE_FLOW_MEMORY_PATH = join(dir, 'default-memory-root');
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (prevMemoryPath === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    else process.env.CLAUDE_FLOW_MEMORY_PATH = prevMemoryPath;
    if (prevBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prevBridge;
    rmSync(dir, { recursive: true, force: true });
  });

  it('advertises --path on the CLI and dbPath on the MCP tool', () => {
    expect(exportCommand.options?.some(o => o.name === 'path')).toBe(true);
    expect(exportTool.inputSchema.properties).toHaveProperty('dbPath');
  });

  it('exports exactly the explicit file and does not initialize the default store', async () => {
    const dbPath = join(dir, 'snapshot.db');
    const outputPath = join(dir, 'export.json');
    await seed(dbPath, ['alpha', 'beta']);

    const result = await exportTool.handler({ outputPath, dbPath, format: 'json' }) as Record<string, any>;

    expect(result.error).toBeUndefined();
    expect(result.exported.entries).toBe(2);
    expect(result.stores).toEqual([{ store: dbPath, entries: 2 }]);
    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(payload.schema).toBe('ruflo-memory-export/v1.1');
    expect(payload.entries.map((e: { key: string }) => e.key).sort()).toEqual(['alpha', 'beta']);
    expect(existsSync(join(dir, 'default-memory-root', 'memory.db'))).toBe(false);
  });

  it('returns a clear error when the explicit file is missing', async () => {
    const result = await exportTool.handler({
      outputPath: join(dir, 'missing.json'),
      dbPath: join(dir, 'does-not-exist.db'),
    }) as Record<string, any>;
    expect(result.error).toMatch(/Database not found|not found/i);
  });
});
