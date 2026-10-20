/**
 * #4291: `agentdb_graph-query` (k-hop mode) and `agentdb_graph-pathfinder` read
 * the graph_edges table through `getBridgeDb()` / `isBridgeDbEncryptedAtRest()`
 * in src/memory/graph-edge-writer.ts. Both functions previously resolved the
 * database file as `customDbPath ?? path.join(getMemoryRoot(), 'memory.db')`
 * — bypassing `resolveDbPath()` (src/memory/memory-initializer.ts), the
 * function that actually implements the project's documented path-priority
 * rule: an explicit `CLAUDE_FLOW_DB_PATH` binding must win over the plain
 * `memory.db` default.
 *
 * Consequence: a caller that starts a fresh MCP with
 * `CLAUDE_FLOW_MEMORY_PATH=<fixture>/.swarm` AND
 * `CLAUDE_FLOW_DB_PATH=<fixture>/.swarm/agentdb-memory.db` (an explicit,
 * deliberate store selection) silently got answers from `.swarm/memory.db`
 * instead — a source-bound graph read leaking data from a store the caller
 * did NOT select.
 *
 * This suite reproduces the exact synthetic fixture from the issue and also
 * covers: (a) unchanged default behavior with no env binding, (b) refusal
 * (never fallback) when the explicitly-bound path is missing, and (c)
 * refusal when the explicitly-bound source is encrypted at rest.
 *
 * Modeled on the mock-free, real-sqlite style of
 * __tests__/graph-edge-writer-rfe1-guard-2889.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';
import { _resetBridgeDb, isBridgeDbEncryptedAtRest } from '../src/memory/graph-edge-writer.js';
import { agentdbGraphQuery } from '../src/mcp-tools/agentdb-tools.js';

const req = createRequire(import.meta.url);
let Database: any;
let native = true;

beforeAll(() => {
  try {
    Database = req('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
  } catch {
    native = false;
  }
});

/**
 * Seed a graph_edges table with the given (source, target, relation) rows.
 * Must match the full production schema (graph-edge-writer.ts's own
 * `CREATE TABLE IF NOT EXISTS` + its index set) — `getBridgeDb()` always runs
 * `CREATE INDEX IF NOT EXISTS idx_graph_edges_reinforced ON graph_edges
 * (last_reinforced)` against whatever table is already there, and a
 * fixture missing that column makes the whole open throw.
 */
function seedGraphDb(dbPath: string, edges: Array<[string, string, string]>): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id              TEXT PRIMARY KEY,
      source_id       TEXT NOT NULL,
      target_id       TEXT NOT NULL,
      relation        TEXT NOT NULL,
      weight          REAL DEFAULT 1.0,
      confidence      REAL DEFAULT 1.0,
      decay_rate      REAL DEFAULT 0.0,
      last_reinforced TEXT,
      witness_id      TEXT,
      embedding_ref   TEXT,
      metadata        TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges (source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges (target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges (relation);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_reinforced ON graph_edges (last_reinforced);
  `);
  const insert = db.prepare(
    `INSERT INTO graph_edges (id, source_id, target_id, relation, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  edges.forEach(([source, target, relation], i) => {
    insert.run(`edge-${i}`, source, target, relation, new Date().toISOString());
  });
  db.close();
}

const ENV_KEYS = ['CLAUDE_FLOW_MEMORY_PATH', 'CLAUDE_FLOW_DB_PATH'] as const;
let savedEnv: Record<string, string | undefined>;
let root: string;
let swarmDir: string;

function resetCaches(): void {
  _resetMemoryRootCache();
  _resetBridgeDb();
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  root = mkdtempSync(join(tmpdir(), 'ruflo-4291-'));
  swarmDir = join(root, '.swarm');
  mkdirSync(swarmDir, { recursive: true });
  resetCaches();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetCaches();
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const khop = (nodeId: string) =>
  agentdbGraphQuery.handler({ nodeId, mode: 'k-hop' }) as Promise<any>;

describe.skipIf(!native)(
  '#4291 agentdb_graph-query resolves graph reads through explicit CLAUDE_FLOW_DB_PATH binding',
  () => {
    it('does not leak the unselected store: CLAUDE_FLOW_DB_PATH must win over the memory.db default (exact issue repro)', async () => {
      const memoryDbPath = join(swarmDir, 'memory.db');
      const agentDbPath = join(swarmDir, 'agentdb-memory.db');
      seedGraphDb(memoryDbPath, [['entity:probe', 'entity:excluded-operation', 'related']]);
      seedGraphDb(agentDbPath, [['entity:probe', 'entity:permitted-research', 'related']]);

      process.env.CLAUDE_FLOW_MEMORY_PATH = swarmDir;
      process.env.CLAUDE_FLOW_DB_PATH = agentDbPath;
      resetCaches();

      const result = await khop('entity:probe');

      expect(result.success).toBe(true);
      const ids = (result.results as Array<{ nodeId: string }>).map((r) => r.nodeId);
      expect(ids).toContain('entity:permitted-research');
      expect(ids).not.toContain('entity:excluded-operation');
    });

    it('(a) unchanged default: resolves to memory.db when no CLAUDE_FLOW_DB_PATH binding is set', async () => {
      const memoryDbPath = join(swarmDir, 'memory.db');
      seedGraphDb(memoryDbPath, [['entity:probe', 'entity:excluded-operation', 'related']]);

      process.env.CLAUDE_FLOW_MEMORY_PATH = swarmDir;
      delete process.env.CLAUDE_FLOW_DB_PATH;
      resetCaches();

      const result = await khop('entity:probe');

      expect(result.success).toBe(true);
      const ids = (result.results as Array<{ nodeId: string }>).map((r) => r.nodeId);
      expect(ids).toContain('entity:excluded-operation');
    });

    it('(b) refuses outright — never falls back to another store — when the explicitly-bound path is missing', async () => {
      const memoryDbPath = join(swarmDir, 'memory.db');
      seedGraphDb(memoryDbPath, [['entity:probe', 'entity:excluded-operation', 'related']]);

      process.env.CLAUDE_FLOW_MEMORY_PATH = swarmDir;
      process.env.CLAUDE_FLOW_DB_PATH = join(swarmDir, 'does-not-exist.db');
      resetCaches();

      const result = await khop('entity:probe');

      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('entity:excluded-operation');
    });

    it('(c) refuses outright — never falls back to another store — when the explicitly-bound source is encrypted at rest', async () => {
      const memoryDbPath = join(swarmDir, 'memory.db');
      seedGraphDb(memoryDbPath, [['entity:probe', 'entity:excluded-operation', 'related']]);

      const encPath = join(swarmDir, 'agentdb-memory.db');
      const { encryptBuffer } = await import('../src/encryption/vault.js');
      const key = randomBytes(32);
      writeFileSync(encPath, encryptBuffer(Buffer.from('irrelevant plaintext payload'), key));

      process.env.CLAUDE_FLOW_MEMORY_PATH = swarmDir;
      process.env.CLAUDE_FLOW_DB_PATH = encPath;
      resetCaches();

      // Sanity-check the encryption sniff itself agrees with the resolved path.
      expect(isBridgeDbEncryptedAtRest()).toBe(true);

      const result = await khop('entity:probe');

      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('entity:excluded-operation');
      expect(result.error).toMatch(/encrypt/i);
    });
  },
);
