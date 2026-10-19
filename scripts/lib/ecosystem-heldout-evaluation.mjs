import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryWorkflow } from './ecosystem-memory-workflow.mjs';

// Public, fixed integration holdout, not a hidden benchmark or SWE-bench gold
// set. No fitting/training occurs. Literal expected values are independent of
// the worker's arithmetic and its self-reported quality/confidence.
const cases = [
  { id: 'local-holdout-zero-v1', values: [0, 0, 0], total: 0, discount: 0, remaining: 0 },
  { id: 'local-holdout-mixed-v1', values: [17, 206, 3001], total: 3224, discount: 27, remaining: 3197 },
  { id: 'local-holdout-boundary-v1', values: [9999, 9999, 9999], total: 29997, discount: 9999, remaining: 19998 },
];
const versions = { memory: '3.0.5', ruvector: '0.2.41', core: '0.1.33', sqljs: '1.15.0' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const heldoutDatasetHash = digest(cases);
export const heldoutInstanceIds = Object.freeze(cases.map(item => item.id));

async function loadWeightEft(weightResolveFrom) {
  if (!weightResolveFrom) throw new Error('RUFLO_WEIGHT_EFT_RESOLVE_FROM required');
  const entry = execFileSync(process.execPath, ['--input-type=module', '-e',
    "process.stdout.write(import.meta.resolve('@metaharness/weight-eft'))"], {
    cwd: dirname(resolve(weightResolveFrom)), encoding: 'utf8', timeout: 5000,
    maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const pkg = JSON.parse(await readFile(join(dirname(fileURLToPath(entry)), '..', 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@metaharness/weight-eft');
  assert.equal(pkg.version, '0.1.2', 'This consumer is qualified only for weight-eft 0.1.2');
  return import(entry);
}

function validateTrainingIds(trainingInstanceIds, weight) {
  if (!Array.isArray(trainingInstanceIds) || trainingInstanceIds.length > 1000 ||
      trainingInstanceIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
      new Set(trainingInstanceIds).size !== trainingInstanceIds.length) {
    throw new Error('Training instance IDs must be bounded, valid and unique');
  }
  // This actual package API consumes only instance_id for this check. We do
  // not fabricate Darwin trajectories, claim official gold eval, or export
  // these local arithmetic runs as model-training data.
  weight.assertTrainEvalDisjoint(trainingInstanceIds.map(instance_id => ({ instance_id })), heldoutInstanceIds);
}

/** Evaluate fixed local task evidence. Hashes are unsigned identity, not trust. */
export async function evaluateHeldoutEvidence({ evidence, trainingInstanceIds = [], weightResolveFrom }) {
  const weight = await loadWeightEft(weightResolveFrom);
  validateTrainingIds(trainingInstanceIds, weight);
  if (!Array.isArray(evidence) || evidence.length !== cases.length ||
      new Set(evidence.map(item => item?.instanceId)).size !== cases.length ||
      evidence.some(item => !heldoutInstanceIds.includes(item?.instanceId))) {
    throw new Error('Evidence must contain exactly one result for each fixed held-out instance');
  }
  const outcomes = cases.map(fixed => {
    const { first, second, persisted } = evidence.find(item => item.instanceId === fixed.id);
    const expectedDigest = digest(fixed.values);
    // A run's success or quality claim alone is insufficient. Check exact
    // fixed answers, independent persisted bytes and the cross-process link.
    const resolved = Boolean(first?.taskSuccess === true && second?.taskSuccess === true &&
      first.receiptsValid === true && second.receiptsValid === true &&
      first.harnessVersion === '0.2.0' && second.harnessVersion === '0.2.0' &&
      JSON.stringify(first.versions) === JSON.stringify(versions) &&
      JSON.stringify(second.versions) === JSON.stringify(versions) &&
      Number.isSafeInteger(first.pid) && first.pid > 0 && Number.isSafeInteger(second.pid) &&
      second.pid > 0 && first.pid !== second.pid &&
      first.result?.type === 'bounded-local-sum-v1' && first.result.total === fixed.total &&
      first.result.inputDigest === expectedDigest &&
      first.consumerInputDigest === digest({ mode: 'first', namespace: fixed.id,
        input: { values: fixed.values, expectedValue: fixed.total }, allowExecution: true }) &&
      second.consumerInputDigest === digest({ mode: 'second', namespace: fixed.id,
        input: { discount: fixed.discount, expectedValue: fixed.remaining, expectedDigest }, allowExecution: true }) &&
      second.result?.type === 'bounded-local-remaining-v1' && second.result.value === fixed.remaining &&
      second.result.inputDigest === expectedDigest && second.retrievedRecord?.key === 'first-result' &&
      typeof second.retrievedRecord.id === 'string' && second.retrievedRecord.id.length > 0 &&
      second.retrievedRecord.version === 1 && second.result.sourceRecord?.id === second.retrievedRecord.id &&
      second.result.sourceRecord?.version === 1 && persisted?.key === 'second-result' &&
      persisted.version === 1 && persisted.content === JSON.stringify(second.result) &&
      first.totalCostUsd === 0 && second.totalCostUsd === 0 && first.llmUsed === false && second.llmUsed === false &&
      JSON.stringify(first.invocations) === '["sum-inputs"]' && JSON.stringify(second.invocations) === '["use-saved-total"]');
    // The package labels this field cheapResolved; here it means the local
    // zero-provider-cost worker, NOT a cheap language model or a cascade.
    return { instance_id: fixed.id, cheapResolved: resolved, escalated: false, resolved, costUsd: 0 };
  });
  const summary = weight.summarizeCascade(outcomes);
  return { starter: 'heldout-agent-memory-v1', datasetHash: heldoutDatasetHash,
    evidenceDigest: digest(evidence), weightEftVersion: '0.1.2', outcomes, summary,
    accepted: outcomes.every(item => item.resolved), promotionAllowed: false, evidenceAuthenticated: false,
    measuredDomain: 'fixed-local-arithmetic-integration', trainingPerformed: false,
    modelImprovementClaimed: false, costImprovementClaimed: false,
    providerCostUsd: 0, infrastructureCostMeasured: false, hiddenBenchmark: false,
    idsDisjoint: true, trainingInstanceCount: trainingInstanceIds.length };
}

/** Six fresh task processes in disposable private databases; no learned state. */
export async function runHeldoutEvaluation({ resolveFrom, harnessResolveFrom, weightResolveFrom,
  trainingInstanceIds = [] }) {
  const began = performance.now();
  if (!resolveFrom || !harnessResolveFrom) throw new Error('Memory and harness consumer resolvers required');
  // Reject missing/unqualified evaluator and overlap before any agent work.
  validateTrainingIds(trainingInstanceIds, await loadWeightEft(weightResolveFrom));
  const directory = await mkdtemp(join(tmpdir(), 'ruflo-heldout-v1-'));
  const script = fileURLToPath(new URL('../examples/persistent-agent-memory-v1.mjs', import.meta.url));
  const env = { ...process.env, RUFLO_MEMORY_RESOLVE_FROM: resolveFrom, RUFLO_HARNESS_RESOLVE_FROM: harnessResolveFrom };
  delete env.NODE_TEST_CONTEXT;
  const evidence = [];
  try {
    for (const fixed of cases) {
      const databasePath = join(directory, `${fixed.id}.sqlite`), namespace = fixed.id;
      const call = (mode, input) => {
        const child = spawnSync(process.execPath, [script, '--worker'], {
          input: JSON.stringify({ mode, databasePath, namespace, input }), encoding: 'utf8',
          timeout: 10000, maxBuffer: 1024 * 1024, env,
        });
        assert.equal(child.status, 0, child.stdout + child.stderr);
        return JSON.parse(child.stdout.trim().split('\n').at(-1));
      };
      const first = call('first', { values: fixed.values, expectedValue: fixed.total });
      const second = call('second', { discount: fixed.discount, expectedValue: fixed.remaining, expectedDigest: digest(fixed.values) });
      const saved = await memoryWorkflow({ mode: 'retrieve', databasePath, namespace, resolveFrom,
        input: { vector: [0, 0, 1], k: 1 } });
      evidence.push({ instanceId: fixed.id, first, second, persisted: saved.results[0] });
    }
    const evaluation = await evaluateHeldoutEvidence({ evidence, trainingInstanceIds, weightResolveFrom });
    return { ...evaluation, evidence, elapsedMs: performance.now() - began };
  } finally {
    // Only the mkdtemp-created disposable directory, never caller databases.
    await rm(directory, { recursive: true, force: true });
  }
}
