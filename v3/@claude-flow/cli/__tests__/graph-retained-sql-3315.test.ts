import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), available: vi.fn(), neighbors: vi.fn() }));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ getBridgeDb: mocks.getDb }));
vi.mock('../src/ruvector/graph-backend.js', () => ({ isGraphBackendAvailable: mocks.available, getNeighbors: mocks.neighbors }));
import { agentdbGraphQuery } from '../src/mcp-tools/agentdb-tools.js';
// The default suite uses required sql.js. Set RUFLO_TEST_SQLITE_DRIVER=native
// to run the same contract against optional better-sqlite3, without silent skips.
let createDb: () => any;
let db: any;
beforeAll(async () => {
  if (process.env.RUFLO_TEST_SQLITE_DRIVER === 'native') {
    const { default: Database } = await import('better-sqlite3');
    createDb = () => {
      const native = new Database(':memory:');
      return { run: (sql: string) => native.exec(sql), exec: (sql: string) => [{ values: native.prepare(sql).raw().all() }], close: () => native.close() };
    };
  } else {
    const SQL = await initSqlJs();
    createDb = () => new SQL.Database();
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  db = createDb();
  db.run('CREATE TABLE graph_edges(source_id TEXT, target_id TEXT, relation TEXT)');
  db.run("INSERT INTO graph_edges VALUES ('a','b','depends-on'),('a','c','related'),('b','d','depends-on'),('d','a','depends-on'),('c','e','related')");
  mocks.getDb.mockResolvedValue({ prepare: (sql: string) => ({ raw: () => ({ all: () => db.exec(sql)[0]?.values ?? [] }) }) });
  mocks.available.mockResolvedValue(true);
  mocks.neighbors.mockResolvedValue(['a']);
});
afterEach(() => db.close());
const query = (params = {}) => agentdbGraphQuery.handler({ nodeId: 'a', mode: 'k-hop', ...params }) as Promise<any>;

describe('retained SQL k-hop graph (#3315)', () => {
  it.each([{ native: [] }, { native: ['a'] }, { native: ['unrelated-native-node'] }])('does not let native contents $native hide retained relationships', async ({ native }) => {
    mocks.neighbors.mockResolvedValue(native);
    const before = db.exec('SELECT * FROM graph_edges');
    const result = await query();
    expect(result).toMatchObject({ success: true, backend: 'sql-cte', results: [
      { nodeId: 'b', depth: 1 }, { nodeId: 'c', depth: 1 }, { nodeId: 'd', depth: 2 }, { nodeId: 'e', depth: 2 },
    ] });
    expect(mocks.available).not.toHaveBeenCalled();
    expect(mocks.neighbors).not.toHaveBeenCalled();
    expect(db.exec('SELECT * FROM graph_edges')).toEqual(before);
  });
  it('applies the relation on every hop and excludes the seed in a cycle', async () => {
    const result = await query({ relation: 'depends-on', depth: 3 });
    expect(result.results).toEqual([{ nodeId: 'b', depth: 1 }, { nodeId: 'd', depth: 2 }]);
  });
  it('discloses depth and returned-row bounds', async () => {
    const result = await query({ depth: 5, complexityBudget: { maxNodesVisited: 1 } });
    expect(result).toMatchObject({ success: true, requestedDepth: 5, appliedDepth: 3, depthLimited: true, resultLimitReached: true, truncated: true, count: 1 });
  });
  it('escapes exact relation values and bounds invalid budgets', async () => {
    db.run("INSERT INTO graph_edges VALUES ('a','quoted','isn''t-related')");
    const result = await query({ relation: "isn't-related", complexityBudget: { maxNodesVisited: -1, maxDepth: -1 } });
    expect(result).toMatchObject({ success: true, resultLimit: 10000, appliedDepth: 2, truncated: false, results: [{ nodeId: 'quoted', depth: 1 }] });
  });
  it('returns empty for an empty SQL graph rather than fabricating the seed', async () => {
    db.run('DELETE FROM graph_edges');
    expect(await query()).toMatchObject({ success: true, results: [], count: 0 });
  });
  it.each(['missing', 'unreadable'])('fails explicitly when retained SQL is %s', async (failure) => {
    if (failure === 'missing') mocks.getDb.mockResolvedValue(null);
    else mocks.getDb.mockRejectedValue(new Error('database unreadable'));
    const result = await query();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SQL|retained/i);
    expect(mocks.neighbors).not.toHaveBeenCalled();
  });
});
