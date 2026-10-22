/**
 * #3397 — graph-edge-writer cached its better-sqlite3 WAL handle in a module
 * singleton for the whole life of the MCP server. The `-wal`/`-shm` sidecars
 * therefore stayed on disk forever, and the #2735 guard (correctly) refused
 * every later sql.js whole-image write: after one `hooks_post-task`, every
 * `memory_store` in that server failed with "active native WAL connection".
 *
 * The reported symptom is Windows-only because that is where the native
 * AgentDB bridge is disabled by default (#3024), so `memory_store` takes the
 * sql.js path. The handle lifecycle and the guard decision are
 * platform-independent, so they are exercised here on the sql.js path by
 * forcing CLAUDE_FLOW_DISABLE_BRIDGE=1. Windows' mandatory file locking is
 * NOT reproduced by this test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_BRIDGE = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
const ORIGINAL_IDLE = process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS;

const sidecars = () => existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-3397-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');
  expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);
  expect(sidecars()).toBe(false);
});

afterEach(async () => {
  const { _resetBridgeDb } = await import('../src/memory/graph-edge-writer.js');
  _resetBridgeDb();
  if (ORIGINAL_BRIDGE === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_BRIDGE;
  if (ORIGINAL_IDLE === undefined) delete process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS;
  else process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS = ORIGINAL_IDLE;
  rmSync(dir, { recursive: true, force: true });
});

describe('#3397 graph-edge-writer releases its native WAL handle', () => {
  it('a sql.js memory store right after a graph-edge write succeeds and keeps the edge', async () => {
    const { insertGraphEdge, countGraphEdges } = await import('../src/memory/graph-edge-writer.js');
    const { storeEntry } = await import('../src/memory/memory-initializer.js');

    expect(await insertGraphEdge({ sourceId: 'task-1', targetId: 'agent-1', relation: 'assigned_to', dbPath })).toBe(true);
    // The writer's own handle is what put the sidecars there.
    expect(sidecars()).toBe(true);

    const stored = await storeEntry({ key: 'after-edge', value: 'v', dbPath, generateEmbeddingFlag: false });
    expect(stored.error).toBeUndefined();
    expect(stored.success).toBe(true);

    // The edge was checkpointed into the main file before sql.js rewrote the
    // image, so the whole-image write did not drop it.
    expect(await countGraphEdges(dbPath)).toBe(1);
  });

  it('closes the handle after an idle window, so the sidecars disappear on their own', async () => {
    process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS = '50';
    const { insertGraphEdge } = await import('../src/memory/graph-edge-writer.js');

    expect(await insertGraphEdge({ sourceId: 'a', targetId: 'b', relation: 'rel', dbPath })).toBe(true);
    expect(sidecars()).toBe(true);

    await sleep(400);
    expect(sidecars()).toBe(false);
  });

  it('still refuses the sql.js write while a foreign native WAL connection is attached', async () => {
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const foreign = new Database(dbPath);
    try {
      foreign.pragma('journal_mode = WAL');
      foreign.prepare('SELECT 1').get();
      expect(sidecars()).toBe(true);

      const result = await storeEntry({ key: 'blocked', value: 'v', dbPath, generateEmbeddingFlag: false });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/native WAL connection/i);
    } finally {
      foreign.close();
    }
  });
});
