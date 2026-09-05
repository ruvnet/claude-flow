/**
 * Smoke test: ADR-130 Phase 3 — SONA trajectory-to-graph hook
 *
 * Acceptance criteria:
 *  1. After hooks_intelligence_trajectory-step with result, graph_edges has "trajectory-caused" row
 *  2. After hooks_post-task { success: true }, graph_edges has "reinforced-by" row
 *  3. Neither write blocks tool response (< 200ms)
 *
 * Usage: node scripts/smoke-trajectory-graph-edges.mjs
 */

import { fileURLToPath, pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distBase = path.join(projectRoot, 'v3/@claude-flow/cli/dist/src');
// Windows: absolute paths must be file:// URLs for dynamic import() — a bare
// C:\... path fails with ERR_UNSUPPORTED_ESM_URL_SCHEME (hit while debugging
// #2312 locally). No-op on POSIX.
const distImport = (rel) => import(pathToFileURL(path.join(distBase, rel)).href);

// sql.js is available in root node_modules (installed by the CI setup step via
// `npm install --legacy-peer-deps --ignore-scripts` at the repo root).
// This matches the pattern used by smoke-memory-stats-legacy-db.mjs which passes CI.
async function loadSqlJs() {
  const mod = await import('sql.js');
  const initSqlJs = mod.default ?? mod;
  return await initSqlJs();
}

let passed = 0, failed = 0;
function pass(l) { console.log(`  PASS  ${l}`); passed++; }
function fail(l, r) { console.error(`  FAIL  ${l}: ${r}`); failed++; }
function assert(c, l, r = '') { c ? pass(l) : fail(l, r || 'assertion false'); }

// ─── setup ────────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr130-p3-'));
const dbPath = path.join(tmpDir, 'memory.db');
// Set early so all lazy imports in hooks modules pick up the right path
process.env.CLAUDE_FLOW_MEMORY_PATH = tmpDir;

async function cleanup() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function countEdgesByRelation(relation) {
  // Close the better-sqlite3 writer connection so its WAL is checkpointed
  // back into the main DB file before we re-read via sql.js. #2431 put
  // the writer in WAL mode and without this checkpoint sql.js sees only
  // the pre-insert main file (the trajectory edges live in the .db-wal
  // sidecar until the writer closes).
  try {
    const { _resetBridgeDb } = await distImport('memory/graph-edge-writer.js');
    _resetBridgeDb();
  } catch { /* writer never opened — no WAL to checkpoint */ }
  try {
    const SQL = await loadSqlJs();
    if (!fs.existsSync(dbPath)) return 0;
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);
    const result = db.exec(`SELECT COUNT(*) FROM graph_edges WHERE relation = ?`, [relation]);
    db.close();
    return (result?.[0]?.values?.[0]?.[0]) ?? 0;
  } catch {
    return 0;
  }
}

console.log('\n[ADR-130 smoke] Phase 3 — SONA trajectory-to-graph hooks\n');

// ─── TEST 1: trajectory-step writes "trajectory-caused" edge ─────────────────

async function testTrajectoryStep() {
  console.log('TEST 1: trajectory-step writes trajectory-caused edge');
  try {
    const { initializeMemoryDatabase } = await distImport('memory/memory-initializer.js');
    await initializeMemoryDatabase({ dbPath, force: true });

    const mod = await distImport('mcp-tools/hooks-tools.js');
    const traj = mod.hooksTrajectoryStep ?? mod.allHooksTools?.find(t => t.name === 'hooks_intelligence_trajectory-step');
    if (!traj) { fail('1a', 'hooks_intelligence_trajectory-step not found'); return; }

    const t0 = Date.now();
    const result = await traj.handler({
      trajectoryId: 'traj-001',
      action: 'search-memory',
      result: 'found-pattern',
      quality: 0.9,
    });
    const elapsed = Date.now() - t0;

    assert(result.trajectoryId === 'traj-001', '1a: returns trajectoryId');
    assert(typeof result.stepId === 'string', '1b: returns stepId');
    assert(elapsed < 200, `1c: tool returns in <200ms (took ${elapsed}ms)`);

    // Wait for async edge write to complete (fire-and-forget, so need a brief delay)
    await sleep(500);

    const count = await countEdgesByRelation('trajectory-caused');
    assert(count >= 1, `1d: graph_edges has trajectory-caused row (count=${count})`);
  } catch (err) {
    fail('1', err.message);
  }
}

// ─── TEST 2: post-task writes "reinforced-by" edge ────────────────────────────

async function testPostTask() {
  console.log('\nTEST 2: post-task writes reinforced-by edge');
  try {
    const mod = await distImport('mcp-tools/hooks-tools.js');
    const postTask = mod.hooksPostTask ?? mod.allHooksTools?.find(t => t.name === 'hooks_post-task');
    if (!postTask) { fail('2a', 'hooks_post-task not found'); return; }

    const t0 = Date.now();
    const result = await postTask.handler({
      taskId: 'task-smoke-001',
      success: true,
      quality: 0.95,
      agent: 'coder',
      task: 'implement authentication',
    });
    const elapsed = Date.now() - t0;

    assert(result.success !== false || typeof result.taskId === 'string', '2a: post-task returns response');
    assert(elapsed < 200, `2b: post-task returns in <200ms (took ${elapsed}ms)`);

    // Wait for async edge write (fire-and-forget)
    await sleep(500);

    const countBefore = await countEdgesByRelation('reinforced-by');
    assert(countBefore >= 1, `2c: graph_edges has reinforced-by row (count=${countBefore})`);
  } catch (err) {
    fail('2', err.message);
  }
}

// ─── TEST 3: post-task with success=false writes no reinforced-by edge ────────

async function testPostTaskFailure() {
  console.log('\nTEST 3: post-task with success=false does not write reinforced-by edge');
  try {
    const mod = await distImport('mcp-tools/hooks-tools.js');
    const postTask = mod.hooksPostTask ?? mod.allHooksTools?.find(t => t.name === 'hooks_post-task');

    const beforeCount = await countEdgesByRelation('reinforced-by');

    await postTask.handler({
      taskId: 'task-fail-001',
      success: false,
      quality: 0.2,
      agent: 'coder',
    });

    await sleep(200);

    const afterCount = await countEdgesByRelation('reinforced-by');
    assert(afterCount === beforeCount, `3a: no new reinforced-by edge for failed task (before=${beforeCount}, after=${afterCount})`);
  } catch (err) {
    fail('3', err.message);
  }
}

// ─── TEST 4: timing — neither write blocks tool response ──────────────────────

async function testNonBlocking() {
  console.log('\nTEST 4: async writes are non-blocking (<200ms tool response)');
  try {
    const mod = await distImport('mcp-tools/hooks-tools.js');
    const traj = mod.hooksTrajectoryStep ?? mod.allHooksTools?.find(t => t.name === 'hooks_intelligence_trajectory-step');

    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await traj.handler({
        trajectoryId: `traj-timing-${i}`,
        action: `action-${i}`,
        result: 'done',
        quality: 0.8,
      });
      times.push(Date.now() - t0);
    }

    const maxTime = Math.max(...times);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`       Response times (ms): ${times.join(', ')} | max=${maxTime} avg=${avgTime.toFixed(1)}`);
    assert(maxTime < 200, `4a: max response time <200ms (got ${maxTime}ms)`);
    assert(avgTime < 100, `4b: avg response time <100ms (got ${avgTime.toFixed(1)}ms)`);
  } catch (err) {
    fail('4', err.message);
  }
}

try {
  await testTrajectoryStep();
  await testPostTask();
  await testPostTaskFailure();
  await testNonBlocking();
} finally {
  await cleanup();
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) {
  console.error('\nSmoke test FAILED — ADR-130 Phase 3 acceptance criteria not met.\n');
  process.exit(1);
} else {
  console.log('\nSmoke test PASSED — ADR-130 Phase 3 acceptance criteria met.\n');
  process.exit(0);
}
