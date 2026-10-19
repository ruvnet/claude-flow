import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runHeldoutEvaluation, evaluateHeldoutEvidence, heldoutInstanceIds, heldoutDatasetHash } from '../lib/ecosystem-heldout-evaluation.mjs';

const resolveFrom = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const harnessResolveFrom = process.env.RUFLO_HARNESS_RESOLVE_FROM;
const weightResolveFrom = process.env.RUFLO_WEIGHT_EFT_RESOLVE_FROM;
const skip = (!resolveFrom || !harnessResolveFrom || !weightResolveFrom) && process.env.RUFLO_WEIGHT_EFT_REQUIRED !== '1';
let retained;
async function result() {
  retained ??= runHeldoutEvaluation({ resolveFrom, harnessResolveFrom, weightResolveFrom, trainingInstanceIds: ['calibration-only-v1'] });
  return retained;
}

test('actual fixed held-out harness tasks restart and retrieve before real Weight EFT aggregation', { skip }, async t => {
  const run = await result();
  assert.equal(run.accepted, true); assert.equal(run.weightEftVersion, '0.1.2');
  // V1 fixed reference: changing cases/oracles requires a new versioned set,
  // not silently moving this evaluator's acceptance target.
  assert.equal(heldoutDatasetHash, '820f73a8ebe7718b708bd1020ef0697f930b067a6f50558670588ff2c31129e6');
  assert.equal(run.datasetHash, heldoutDatasetHash); assert.equal(run.outcomes.length, 3);
  assert.deepEqual(run.summary, { n: 3, cheapResolveRate: 1, escalationRate: 0, resolveRate: 1, costPerResolved: 0, totalCostUsd: 0 });
  assert.equal(run.trainingPerformed, false); assert.equal(run.modelImprovementClaimed, false);
  assert.equal(run.costImprovementClaimed, false); assert.equal(run.promotionAllowed, false);
  assert.equal(run.hiddenBenchmark, false); assert.equal(run.infrastructureCostMeasured, false);
  assert.equal(new Set(run.evidence.flatMap(item => [item.first.pid, item.second.pid])).size, 6);
  t.diagnostic(JSON.stringify({ elapsedMs: run.elapsedMs, datasetHash: run.datasetHash, weightEftVersion: run.weightEftVersion, summary: run.summary }));
});

test('real Weight EFT contamination guard rejects held-out training IDs before execution', { skip }, async () => {
  await assert.rejects(runHeldoutEvaluation({ resolveFrom, harnessResolveFrom, weightResolveFrom,
    trainingInstanceIds: [heldoutInstanceIds[0]] }), /contamination guard/);
  await assert.rejects(runHeldoutEvaluation({ resolveFrom, harnessResolveFrom, weightResolveFrom,
    trainingInstanceIds: ['duplicate', 'duplicate'] }), /unique/);
});

test('fixed oracle rejects wrong output despite success, perfect quality and matching persisted self-report', { skip }, async () => {
  const evidence = structuredClone((await result()).evidence);
  evidence[0].first.quality = 1; evidence[0].second.quality = 1;
  evidence[0].second.result.value = 999;
  evidence[0].persisted.content = JSON.stringify(evidence[0].second.result);
  const evaluation = await evaluateHeldoutEvidence({ evidence, weightResolveFrom });
  assert.equal(evaluation.accepted, false); assert.equal(evaluation.outcomes[0].resolved, false);
  assert.equal(evaluation.summary.resolveRate, 2 / 3); assert.equal(evaluation.promotionAllowed, false);
});

test('actual kernel verification failure is not rescued by successful persisted evidence from another run', { skip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heldout-negative-control-'));
  const databasePath = join(directory, 'memory.sqlite');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  try {
    // The worker returns the actual zero sum, which does NOT satisfy this
    // deliberately wrong verifier oracle. It must not persist a successful run.
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../examples/persistent-agent-memory-v1.mjs', import.meta.url)), '--worker'], {
      input: JSON.stringify({ mode: 'first', databasePath, namespace: heldoutInstanceIds[0],
        input: { values: [0, 0, 0], expectedValue: 1 } }), encoding: 'utf8', env,
      timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const failed = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.equal(failed.taskSuccess, false); assert.deepEqual(failed.invocations, ['sum-inputs']);
    assert.deepEqual(failed.operations, []); await assert.rejects(readFile(databasePath), { code: 'ENOENT' });
    const evidence = structuredClone((await result()).evidence); evidence[0].first = failed;
    const evaluation = await evaluateHeldoutEvidence({ evidence, weightResolveFrom });
    assert.equal(evaluation.accepted, false); assert.equal(evaluation.outcomes[0].resolved, false);
    assert.equal(evaluation.evidenceAuthenticated, false); assert.equal(evaluation.promotionAllowed, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing, duplicated or substituted held-out evidence cannot improve denominator', { skip }, async () => {
  const original = (await result()).evidence;
  for (const evidence of [original.slice(1), [original[0], original[0], original[2]],
    [{ ...original[0], instanceId: 'easier-substitute' }, ...original.slice(1)], null, [null, null, null]]) {
    await assert.rejects(evaluateHeldoutEvidence({ evidence, weightResolveFrom }), /exactly one result/);
  }
});

test('restart, persisted content, receipt and version evidence failures remain unresolved', { skip }, async () => {
  const original = (await result()).evidence;
  for (const alter of [
    item => { item.first = null; },
    item => { item.second = null; },
    item => { item.persisted = null; },
    item => { item.second.pid = item.first.pid; },
    item => { item.persisted.content = '{}'; },
    item => { item.second.receiptsValid = false; },
    item => { item.second.versions.ruvector = '0.0.0'; },
    item => { item.second.invocations = []; },
    item => { item.second.retrievedRecord.id = 'unrelated'; },
    item => { item.first.consumerInputDigest = 'unrelated'; },
  ]) {
    const evidence = structuredClone(original); alter(evidence[0]);
    const evaluation = await evaluateHeldoutEvidence({ evidence, weightResolveFrom });
    assert.equal(evaluation.accepted, false); assert.equal(evaluation.summary.resolveRate, 2 / 3);
  }
});

test('missing Weight EFT resolver fails closed rather than using fixture metrics', { skip }, async () => {
  await assert.rejects(evaluateHeldoutEvidence({ evidence: (await result()).evidence }), /RUFLO_WEIGHT_EFT_RESOLVE_FROM required/);
});
