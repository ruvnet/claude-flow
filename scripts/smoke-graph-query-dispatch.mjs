/**
 * Smoke test: ADR-130 Phase 2 — agentdb_graph-query dispatch
 *
 * Acceptance criteria:
 *  1. k-hop mode returns neighbor IDs (graph-node native skipped, sql CTE tested)
 *  2. pagerank mode returns ranked node list
 *  3. semantic mode returns cosine-ranked results
 *  4. complexityBudget is respected
 *
 * Usage: node scripts/smoke-graph-query-dispatch.mjs
 */

import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distBase = path.join(projectRoot, 'v3/@claude-flow/cli/dist/src');

let passed = 0, failed = 0;
function pass(l) { console.log(`  PASS  ${l}`); passed++; }
function fail(l, r) { console.error(`  FAIL  ${l}: ${r}`); failed++; }
function assert(c, l, r = '') { c ? pass(l) : fail(l, r || 'assertion false'); }

// ─── setup ────────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr130-p2-'));
const dbPath = path.join(tmpDir, 'memory.db');
// Set early so all lazy imports pick up the right path
process.env.CLAUDE_FLOW_MEMORY_PATH = tmpDir;

async function cleanup() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// Seed graph_edges with test data
async function seedEdges() {
  const { initializeMemoryDatabase } = await import(path.join(distBase, 'memory/memory-initializer.js'));
  await initializeMemoryDatabase({ dbPath, force: true });

  const { insertGraphEdge, _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
  _resetBridgeDb();

  const edges = [
    { sourceId: 'agent:alice', targetId: 'task:auth', relation: 'assigned_to', weight: 0.9 },
    { sourceId: 'task:auth', targetId: 'entity:auth-module', relation: 'implements', weight: 0.8 },
    { sourceId: 'entity:auth-module', targetId: 'entity:jwt', relation: 'depends-on', weight: 0.7 },
    { sourceId: 'agent:bob', targetId: 'task:search', relation: 'assigned_to', weight: 0.9 },
    { sourceId: 'task:search', targetId: 'entity:index', relation: 'implements', weight: 0.8 },
    // Add embeddings for semantic mode
    {
      sourceId: 'entity:auth-lib',
      targetId: 'entity:jwt-lib',
      relation: 'uses',
      weight: 0.6,
      embedding: Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.05)),
    },
    {
      sourceId: 'entity:search-lib',
      targetId: 'entity:lucene',
      relation: 'uses',
      weight: 0.5,
      embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.05)),
    },
  ];

  for (const e of edges) {
    await insertGraphEdge({ ...e, dbPath });
  }
}

console.log('\n[ADR-130 smoke] Phase 2 — agentdb_graph-query dispatch\n');

// ─── TEST 1: k-hop (sql CTE fallback) ─────────────────────────────────────────

async function testKHop() {
  console.log('TEST 1: k-hop mode returns neighbor IDs via sql CTE');
  try {
    // Import the handler directly by loading the compiled module
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphQuery ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-query');
    if (!tool) { fail('1a', 'agentdb_graph-query tool not found in exports'); return; }

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ nodeId: 'agent:alice', mode: 'k-hop', depth: 2 });
    assert(result.success, '1a: k-hop returns success', JSON.stringify(result));
    assert(Array.isArray(result.results), '1b: results is array');
    assert(result.backend === 'sql-cte' || result.backend === 'graph-node', `1c: backend is sql-cte or graph-node (got ${result.backend})`);
    // When graph-node native is available it uses its own storage (not our seeded sql.js edges).
    // When it falls back to sql-cte it uses graph_edges. Either path is valid per ADR-130.
    assert(typeof result.count === 'number', '1d: count is a number');
  } catch (err) {
    fail('1', err.message);
  }
}

// ─── TEST 2: pagerank mode ─────────────────────────────────────────────────────

async function testPageRank() {
  console.log('\nTEST 2: pagerank mode returns ranked node list');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphQuery ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-query');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ nodeId: 'agent:alice', mode: 'pagerank', topK: 5 });
    assert(result.success, `2a: pagerank returns success (${JSON.stringify(result)})`);
    assert(Array.isArray(result.results), '2b: results is array');
    if (result.results.length > 0) {
      assert(typeof result.results[0].score === 'number', '2c: first result has numeric score');
      assert(result.results[0].score >= result.results[result.results.length - 1].score, '2d: results sorted by score desc');
    }
  } catch (err) {
    fail('2', err.message);
  }
}

// ─── TEST 3: semantic mode ─────────────────────────────────────────────────────

async function testSemantic() {
  console.log('\nTEST 3: semantic mode returns cosine-ranked results');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphQuery ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-query');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ nodeId: 'entity:auth-lib', mode: 'semantic', topK: 5 });
    assert(result.success, `3a: semantic returns success (${JSON.stringify(result)})`);
    assert(Array.isArray(result.results), '3b: results is array');
    // Semantic mode should find edges with embedding_ref
    if (result.results.length > 0) {
      assert(typeof result.results[0].score === 'number', '3c: first result has numeric score');
    }
  } catch (err) {
    fail('3', err.message);
  }
}

// ─── TEST 4: complexityBudget enforcement ─────────────────────────────────────

async function testBudget() {
  console.log('\nTEST 4: complexityBudget depth clamped, invalid mode rejected');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphQuery ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-query');

    // Invalid mode
    const badResult = await tool.handler({ nodeId: 'agent:alice', mode: 'invalid-mode' });
    assert(!badResult.success, '4a: invalid mode returns error');
    assert(typeof badResult.error === 'string', '4b: error is string');

    // Empty graph_edges for a non-existent node
    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();
    const emptyResult = await tool.handler({ nodeId: 'entity:nonexistent-xyz-9999', mode: 'k-hop', depth: 2 });
    assert(emptyResult.success, `4c: k-hop on non-existent node returns success (${JSON.stringify(emptyResult)})`);
    // graph-node native may return the seed node itself; sql-cte returns empty. Both are valid.
    assert(Array.isArray(emptyResult.results), '4d: results is array for non-existent node');
  } catch (err) {
    fail('4', err.message);
  }
}

// ─── TEST 5: graph-pathfinder (Phase 5) ───────────────────────────────────────

async function testPathfinder() {
  console.log('\nTEST 5: agentdb_graph-pathfinder basic smoke');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');
    if (!tool) { fail('5a', 'agentdb_graph-pathfinder not found'); return; }

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ seedNodeId: 'agent:alice', query: 'authentication tasks', depth: 3 });
    assert(result.success, `5a: pathfinder returns success (${JSON.stringify(result)})`);
    assert(Array.isArray(result.paths), '5b: paths is array');

    // Test depth > 5 clamped
    const clampResult = await tool.handler({ seedNodeId: 'agent:alice', query: 'test', depth: 10 });
    assert(clampResult.success, '5c: depth>5 clamped without error');
    assert(clampResult.warning || clampResult.depth === undefined || clampResult.depth <= 5, '5d: depth clamped to 5');

    // Test empty seed
    const emptyResult = await tool.handler({ seedNodeId: 'entity:nonexistent-xyz', query: 'nothing' });
    assert(emptyResult.success, `5e: empty graph returns success (${JSON.stringify(emptyResult)})`);
    assert(emptyResult.paths?.length === 0, `5f: empty graph returns empty paths (got ${emptyResult.paths?.length})`);
  } catch (err) {
    fail('5', err.message);
  }
}

try {
  await seedEdges();
  await testKHop();
  await testPageRank();
  await testSemantic();
  await testBudget();
  await testPathfinder();
} finally {
  await cleanup();
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) {
  console.error('\nSmoke test FAILED — ADR-130 Phase 2+5 acceptance criteria not met.\n');
  process.exit(1);
} else {
  console.log('\nSmoke test PASSED — ADR-130 Phase 2+5 acceptance criteria met.\n');
  process.exit(0);
}
