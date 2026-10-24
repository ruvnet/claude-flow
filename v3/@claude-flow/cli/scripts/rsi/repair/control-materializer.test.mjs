import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { executeControlCandidate, loadControlMaterializerPlan,
  CONTROL_MATERIALIZER_PLAN_HASH, CONTROL_MATERIALIZER_RAW_SHA256,
  runControlMaterializerBatch, runControlMaterializerBatchSummary,
  runControlMaterializerBatchWithSpawner, runControlMaterializerChild,
  validateControlMaterializerPlan, verifyControlMaterializerChild } from './control-materializer.mjs';
import { loadImproverPlan, PLAN_HASH, stableHash } from './inherited-improver.mjs';

const here = name => new URL(name, import.meta.url);
const plan = () => loadControlMaterializerPlan();
const improver = () => loadImproverPlan();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const expectedSuccessCosts = { batchParentProcesses: 1, chargedMaterializerChildSpawnAttempts: 5,
  observedCompletedMaterializerChildProcesses: 5, successfulChildResults: 5,
  childProposalDescriptorsObserved: 10, childArtifactConstructionsObserved: 10,
  childReplacementOperationsObserved: 10, childDescriptorScoresObserved: 10,
  childSourceBytesReadObserved: 16575, retainedChildArtifacts: 10,
  chargedParentReverificationAttempts: 5, completedParentReverifications: 5,
  chargedParentProposalDescriptors: 10, chargedParentArtifactConstructions: 10,
  chargedParentReplacementOperations: 10, chargedParentDescriptorScores: 10,
  chargedParentSourceBytesRead: 16575, failedOrInterruptedChildWorkUnknown: false,
  parentControlPlanReadsObserved: 1, parentControlPlanBytesReadObserved: 5724,
  parentImproverPlanReadsObserved: 1, parentImproverPlanBytesReadObserved: 3998,
  chargedChildControlPlanReadUpperBound: 5, chargedChildControlPlanBytesUpperBound: 28620,
  chargedChildImproverPlanReadUpperBound: 5, chargedChildImproverPlanBytesUpperBound: 19990,
  moduleLoaderBytesRead: null, repairCandidateEvaluations: 0, isolatedProcessStarts: 0,
  nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null };

test('frozen plan exposes equal materialization mechanics and no execution authority', () => {
  const value = plan(), check = validateControlMaterializerPlan(value);
  assert.equal(check.planHash, CONTROL_MATERIALIZER_PLAN_HASH);
  assert.equal(value.improverPlanSemanticHash, PLAN_HASH);
  assert.equal(value.proofBoundary.sharedMaterializerMechanismAcrossArms, true);
  assert.equal(value.proofBoundary.equalArtifactCountAcrossArms, true);
  assert.equal(value.proofBoundary.candidateExecutionEnabled, false);
});

test('raw and semantic plan identities are independently frozen', () => {
  const bytes = readFileSync(here('./control-materializer-plan.json'));
  assert.equal(sha256(bytes), CONTROL_MATERIALIZER_RAW_SHA256);
  assert.equal(stableHash(JSON.parse(bytes)), CONTROL_MATERIALIZER_PLAN_HASH);
});

test('every proposal family has exactly one reviewed exposed-task rule', () => {
  const value = plan(), families = new Set(improver().proposalLibrary.map(item => item.family));
  assert.deepEqual(new Set(value.rules.map(rule => rule.family)), families);
  assert.equal(value.rules.filter(rule => rule.knownFixExact).length, 1);
  assert(value.rules.every(rule => rule.origin.startsWith('RESEARCHER_AUTHORED_')));
});

test('all rule candidates reconstruct their frozen identities from the exact base', () => {
  const value = plan(), base = readFileSync(here('./fixtures/p-limit-index.base.js'));
  assert.equal(sha256(base), value.source.baseSha256);
  const old = Buffer.from(value.source.oldSnippet), offset = base.indexOf(old);
  assert(offset >= 0); assert.equal(base.indexOf(old, offset + 1), -1);
  for (const rule of value.rules) {
    const replacement = Buffer.from(rule.replacement);
    const candidate = Buffer.concat([base.subarray(0, offset), replacement, base.subarray(offset + old.length)]);
    assert.deepEqual({ replacementSha256: sha256(replacement), candidateSha256: sha256(candidate),
      candidateGitBlob: gitBlob(candidate), candidateBytes: candidate.length },
    { replacementSha256: rule.replacementSha256, candidateSha256: rule.candidateSha256,
      candidateGitBlob: rule.candidateGitBlob, candidateBytes: rule.candidateBytes });
  }
});

test('every arm emits two artifacts through the same bounded mechanism', () => {
  const value = plan(), source = improver();
  for (const arm of value.arms) {
    const result = runControlMaterializerChild(value, source, arm, false);
    assert.equal(result.artifacts.length, 2);
    assert.equal(result.costs.patchArtifacts, 2);
    assert.equal(result.costs.replacementOperations, 2);
    assert.equal(result.costs.materializerChildProcesses, 0);
    assert(result.artifacts.every(artifact => artifact.arm === arm));
  }
});

test('inherited top proposal reconstructs the exposed fix but controls are not forced to it', () => {
  const value = plan(), source = improver();
  const inherited = runControlMaterializerChild(value, source, 'inherited');
  assert.equal(inherited.artifacts[0].candidateSha256, value.source.knownFixSha256);
  const frozen = runControlMaterializerChild(value, source, 'frozen');
  assert.notEqual(frozen.artifacts[0].candidateSha256, value.source.knownFixSha256);
});

test('frozen and generation-zero previous retain equal candidates but distinct lineage', () => {
  const value = plan(), source = improver();
  const frozen = runControlMaterializerChild(value, source, 'frozen');
  const previous = runControlMaterializerChild(value, source, 'previous');
  assert.deepEqual(frozen.artifacts.map(item => item.candidateSha256),
    previous.artifacts.map(item => item.candidateSha256));
  assert.notDeepEqual(frozen.artifacts.map(item => item.descriptorHash),
    previous.artifacts.map(item => item.descriptorHash));
});

test('rehashed plan mutation cannot change rules, arms, budgets or proof boundary', () => {
  for (const mutate of [
    value => { value.arms.reverse(); },
    value => { value.rules[0].candidateSha256 = '0'.repeat(64); },
    value => { value.budgets.patchArtifactsPerArm = 1; },
    value => { value.proofBoundary.candidateExecutionEnabled = true; },
  ]) { const value = plan(); mutate(value); assert.throws(() => validateControlMaterializerPlan(value), /hash/); }
});

test('parent recomputation rejects rehashed or self-consistent child substitution', () => {
  const value = plan(), source = improver();
  const result = runControlMaterializerChild(value, source, 'inherited', true);
  assert.equal(verifyControlMaterializerChild(value, source, result).verified, true);
  result.artifacts[0].candidateSha256 = value.rules[1].candidateSha256;
  const bare = { ...result.artifacts[0] }; delete bare.artifactHash;
  result.artifacts[0].artifactHash = stableHash(bare);
  assert.throws(() => verifyControlMaterializerChild(value, source, result), /parent recomputation/);
});

test('undeclared arm and candidate execution fail closed', () => {
  assert.throws(() => runControlMaterializerChild(plan(), improver(), 'adaptive'), /declared arm/);
  assert.throws(() => executeControlCandidate(), /CANDIDATE_EXECUTION_DISABLED/);
});

test('batch runs five child processes and parent-verifies ten artifacts at equal cost', () => {
  const result = runControlMaterializerBatch();
  assert.deepEqual(result.costs, expectedSuccessCosts);
  assert.equal(result.complete, true);
  assert.equal(result.results.length, 5);
  assert.equal(result.candidateExecutionEnabled, false);
});

test('batch summary binds checked artifact identities to automatic cost totals', () => {
  const result = runControlMaterializerBatchSummary();
  assert.match(result.artifactSetHash, /^[0-9a-f]{64}$/);
  assert.equal(result.armArtifactHashes.length, 5);
  assert(result.armArtifactHashes.every(item => item.artifactHashes.length === 2));
  assert.deepEqual(result.costs, expectedSuccessCosts);
});

test('failed child attempts are retained and charged without inventing completed work', () => {
  const failedSpawn = () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '',
    error: { code: 'ETIMEDOUT' } });
  const result = runControlMaterializerBatchWithSpawner(
    new URL('./control-materializer-plan.json', import.meta.url).pathname,
    new URL('./inherited-improver-plan.json', import.meta.url).pathname, failedSpawn);
  assert.equal(result.complete, false);
  assert.equal(result.attempts.length, 5);
  assert(result.attempts.every(item => item.spawnCharged && item.failureStage === 'SPAWN_OR_CHILD_EXIT'));
  assert.equal(result.costs.chargedMaterializerChildSpawnAttempts, 5);
  assert.equal(result.costs.observedCompletedMaterializerChildProcesses, 0);
  assert.equal(result.costs.successfulChildResults, 0);
  assert.equal(result.costs.failedOrInterruptedChildWorkUnknown, true);
  assert.equal(result.costs.repairCandidateEvaluations, 0);
});

test('CLI refuses substituted plan and improver anchors before child work', () => {
  const args = [new URL('./control-materializer.mjs', import.meta.url).pathname, 'child',
    new URL('./control-materializer-plan.json', import.meta.url).pathname, '0'.repeat(64),
    new URL('./inherited-improver-plan.json', import.meta.url).pathname, PLAN_HASH, 'inherited'];
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000,
    maxBuffer: 65536, shell: false, env: { LANG: 'C', TZ: 'UTC' } });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /reviewed control materializer anchor/);
});
