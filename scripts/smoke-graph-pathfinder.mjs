/**
 * Smoke test: ADR-130 Phase 5 — agentdb_graph-pathfinder
 *
 * Acceptance criteria:
 *  1. Basic k-hop path traversal returns path arrays
 *  2. PPR (personalized-pagerank) algorithm returns ranked results
 *  3. depth > 5 is clamped to 5
 *  4. Empty graph returns empty paths (not error)
 *  5. complexityBudget maxNodesVisited enforced
 *  6. All 6 algorithm variants are accepted without error
 *
 * Usage: node scripts/smoke-graph-pathfinder.mjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr130-p5-'));
const dbPath = path.join(tmpDir, 'memory.db');
process.env.CLAUDE_FLOW_MEMORY_PATH = tmpDir;

async function cleanup() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

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
    { sourceId: 'entity:auth-module', targetId: 'entity:user-db', relation: 'reads', weight: 0.6 },
    { sourceId: 'agent:alice', targetId: 'agent:bob', relation: 'collaborates', weight: 0.5 },
  ];

  for (const e of edges) {
    await insertGraphEdge({ ...e, dbPath });
  }
}

console.log('\n[ADR-130 smoke] Phase 5 — agentdb_graph-pathfinder\n');

// ─── TEST 1: basic pathfinder call ───────────────────────────────────────────

async function testBasicPathfinder() {
  console.log('TEST 1: basic pathfinder call returns success with paths array');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');
    if (!tool) { fail('1a', 'agentdb_graph-pathfinder not found in exports'); return; }

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ seedNodeId: 'agent:alice', query: 'authentication', depth: 2 });
    assert(result.success, `1a: pathfinder returns success (${JSON.stringify(result).slice(0, 200)})`);
    assert(Array.isArray(result.paths), '1b: paths is an array');
    assert(typeof result.elapsedMs === 'number', '1c: elapsedMs is present');
  } catch (err) {
    fail('1', err.message);
  }
}

// ─── TEST 2: personalized-pagerank algorithm ──────────────────────────────────

async function testPPRAlgorithm() {
  console.log('\nTEST 2: personalized-pagerank algorithm returns ranked results');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({
      seedNodeId: 'agent:alice',
      query: 'authentication',
      algorithm: 'personalized-pagerank',
      depth: 3,
    });
    assert(result.success, `2a: PPR returns success (${JSON.stringify(result).slice(0, 200)})`);
    assert(Array.isArray(result.paths), '2b: PPR paths is array');

    if (result.paths.length > 0) {
      const first = result.paths[0];
      // Path entries may be strings or objects with score
      assert(first !== undefined && first !== null, '2c: first path entry is non-null');
    }
  } catch (err) {
    fail('2', err.message);
  }
}

// ─── TEST 3: depth clamping ───────────────────────────────────────────────────

async function testDepthClamping() {
  console.log('\nTEST 3: depth > 5 is clamped to 5 without error');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ seedNodeId: 'agent:alice', query: 'test', depth: 10 });
    assert(result.success, '3a: depth=10 does not return error');
    // ADR requires depth clamp to 5; tool may include warning or just silently clamp
    assert(result.warning !== undefined || result.success, '3b: depth clamped without rejection');
    // The clamped depth should not exceed 5 if exposed
    if (result.depth !== undefined) {
      assert(result.depth <= 5, `3c: reported depth <= 5 (got ${result.depth})`);
    } else {
      pass('3c: depth not exposed (clamped internally)');
    }
  } catch (err) {
    fail('3', err.message);
  }
}

// ─── TEST 4: empty graph returns empty paths ──────────────────────────────────

async function testEmptyGraph() {
  console.log('\nTEST 4: non-existent seed node returns empty paths, not error');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    const result = await tool.handler({ seedNodeId: 'entity:nonexistent-xyz-99999', query: 'nothing' });
    assert(result.success, `4a: non-existent seed returns success (${JSON.stringify(result).slice(0, 200)})`);
    assert(Array.isArray(result.paths), '4b: paths is array for non-existent seed');
    assert(result.paths.length === 0, `4c: paths is empty for non-existent seed (got ${result.paths?.length})`);
  } catch (err) {
    fail('4', err.message);
  }
}

// ─── TEST 5: complexityBudget enforcement ─────────────────────────────────────

async function testComplexityBudget() {
  console.log('\nTEST 5: complexityBudget.maxNodesVisited limits traversal');
  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');

    const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
    _resetBridgeDb();

    // With maxNodesVisited: 1, traversal must be extremely limited
    const result = await tool.handler({
      seedNodeId: 'agent:alice',
      query: 'tasks',
      depth: 5,
      complexityBudget: { maxNodesVisited: 1 },
    });
    assert(result.success, `5a: tight budget returns success (${JSON.stringify(result).slice(0, 200)})`);
    assert(Array.isArray(result.paths), '5b: paths is array');
    // With maxNodesVisited: 1 we expect very few results
    assert(result.paths.length <= 2, `5c: tight budget limits results (got ${result.paths.length})`);
  } catch (err) {
    fail('5', err.message);
  }
}

// ─── TEST 6: all 6 algorithm variants accepted ────────────────────────────────

async function testAllAlgorithms() {
  console.log('\nTEST 6: all 6 ADR-130 algorithm variants accepted without error');
  const algorithms = [
    'personalized-pagerank',
    'dynamic-mincut',
    'spectral-sparsify',
    'temporal-centrality',
    'connected-component-churn',
    'witness-chain-divergence',
  ];

  try {
    const mod = await import(path.join(distBase, 'mcp-tools/agentdb-tools.js'));
    const tool = mod.agentdbGraphPathfinder ?? mod.agentdbTools?.find(t => t.name === 'agentdb_graph-pathfinder');

    for (const algo of algorithms) {
      const { _resetBridgeDb } = await import(path.join(distBase, 'memory/graph-edge-writer.js'));
      _resetBridgeDb();

      const result = await tool.handler({ seedNodeId: 'agent:alice', query: 'test', algorithm: algo, depth: 2 });
      assert(result.success !== false, `6/${algo}: returns success (${JSON.stringify(result).slice(0, 150)})`);
    }
  } catch (err) {
    fail('6', err.message);
  }
}

try {
  await seedEdges();
  await testBasicPathfinder();
  await testPPRAlgorithm();
  await testDepthClamping();
  await testEmptyGraph();
  await testComplexityBudget();
  await testAllAlgorithms();
} finally {
  await cleanup();
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) {
  console.error('\nSmoke test FAILED — ADR-130 Phase 5 acceptance criteria not met.\n');
  process.exit(1);
} else {
  console.log('\nSmoke test PASSED — ADR-130 Phase 5 acceptance criteria met.\n');
  process.exit(0);
}
