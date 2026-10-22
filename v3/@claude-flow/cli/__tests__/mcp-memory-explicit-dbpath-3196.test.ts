/**
 * #3196: the CLI accepts an explicit `--path`, but the five primary MCP memory
 * handlers called the store with no `dbPath`. An MCP caller that knew the
 * project store therefore could not select it: reads came from the MCP default
 * (the AgentDB sibling) and writes went there too.
 *
 * These handlers now accept the same explicit `dbPath` as `memory_stats`,
 * `memory_import` and `memory_export`. No path keeps the previous MCP default;
 * this is not an implicit env override, because the native/encrypted CLI file
 * and the AgentDB sibling are intentionally separate backends.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memoryTools } from '../src/mcp-tools/memory-tools.js';
import { MEMORY_SCHEMA_V3 } from '../src/memory/memory-initializer.js';

const tool = (name: string) => memoryTools.find(t => t.name === name)!;

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
         VALUES (?, ?, 'pinned', ?, 0, ?, ?, 'active')`,
        [`id-${i}`, key, `value for ${key}`, now, now],
      );
    }
    writeFileSync(dbPath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

describe('MCP memory tools accept an explicit dbPath (#3196)', () => {
  let dir: string;
  let dbPath: string;
  let defaultDir: string;
  let defaultDbPath: string;
  let prevMemory: string | undefined;
  let prevBridge: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-memory-path-'));
    dbPath = join(dir, 'pinned.db');
    await seed(dbPath, ['alpha', 'beta']);

    // A populated default store makes "read the wrong store" observable rather
    // than indistinguishable from an empty one.
    defaultDir = join(dir, 'unused-default');
    mkdirSync(defaultDir, { recursive: true });
    defaultDbPath = join(defaultDir, 'memory.db');
    await seed(defaultDbPath, ['default-only']);

    prevMemory = process.env.CLAUDE_FLOW_MEMORY_PATH;
    prevBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    process.env.CLAUDE_FLOW_MEMORY_PATH = defaultDir;
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  });

  afterEach(() => {
    if (prevMemory === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    else process.env.CLAUDE_FLOW_MEMORY_PATH = prevMemory;
    if (prevBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prevBridge;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists and retrieves from the selected store', async () => {
    const list = await tool('memory_list').handler({ dbPath }) as Record<string, any>;
    expect(list.total).toBe(2);
    expect(list.entries.map((e: { key: string }) => e.key).sort()).toEqual(['alpha', 'beta']);

    const get = await tool('memory_retrieve').handler({
      key: 'alpha',
      namespace: 'pinned',
      dbPath,
    }) as Record<string, any>;
    expect(get.found).toBe(true);
    expect(get.value).toBe('value for alpha');
  });

  it('uses the explicit path instead of the default', async () => {
    const otherPath = join(dir, 'other.db');
    await seed(otherPath, ['gamma']);

    const list = await tool('memory_list').handler({ dbPath: otherPath }) as Record<string, any>;
    expect(list.total).toBe(1);
    expect(list.entries.map((e: { key: string }) => e.key)).toEqual(['gamma']);
  });

  it('deletes and reports stats from the selected store', async () => {
    const del = await tool('memory_delete').handler({
      key: 'alpha',
      namespace: 'pinned',
      dbPath,
    }) as Record<string, any>;
    expect(del.deleted).toBe(true);

    const stats = await tool('memory_stats').handler({ dbPath }) as Record<string, any>;
    expect(stats.totalEntries).toBe(1);
  });

  it('leaves the default store untouched', async () => {
    await tool('memory_delete').handler({ key: 'alpha', namespace: 'pinned', dbPath });

    const list = await tool('memory_list').handler({ dbPath: defaultDbPath }) as Record<string, any>;
    expect(list.total).toBe(1);
    expect(list.entries.map((e: { key: string }) => e.key)).toEqual(['default-only']);
  });
});
