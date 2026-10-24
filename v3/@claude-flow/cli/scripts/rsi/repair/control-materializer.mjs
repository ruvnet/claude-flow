#!/usr/bin/env node
/** Equal-mechanics exposed-template materializer. Engineering only; no candidate execution. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadImproverPlan, PLAN_HASH, runImproverChild, stableHash } from './inherited-improver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(ROOT, 'control-materializer-plan.json');
export const CONTROL_MATERIALIZER_PLAN_HASH = 'a7a8df26ef90d815824234e064ea611fc926502f0eb904af81aade258df9287e';
export const CONTROL_MATERIALIZER_RAW_SHA256 = 'fb75a39dfadd8649bbd8d149f4dd79f085d96cdb033802a446fef684a69ba04d';
const CONTROL_PLAN_BYTES = 5724;
const IMPROVER_PLAN_BYTES = 3998;
const MAX_PLAN_BYTES = 1024 * 1024;
const FAMILIES = ['DECREMENT_ACTIVE_COUNT', 'DRAIN_QUEUE_AFTER_CLEAR',
  'FORWARD_GENERATOR_CAPABILITY', 'REJECT_CLEARED_PROMISES'];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const exact = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);

function readBoundedRegularFile(path, maximum) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    assert(before.isFile(), 'input must be a regular file');
    assert(before.size > 0 && before.size <= maximum, 'input size bound');
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert(count > 0, 'input changed during bounded read'); offset += count;
    }
    const after = fstatSync(descriptor);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(after[field], before[field],
      `input ${field} changed during read`);
    return bytes;
  } finally { closeSync(descriptor); }
}

export function loadControlMaterializerPlan(path = PLAN_PATH) {
  const bytes = readBoundedRegularFile(path, MAX_PLAN_BYTES);
  assert.equal(sha256(bytes), CONTROL_MATERIALIZER_RAW_SHA256, 'raw control materializer plan mismatch');
  return JSON.parse(bytes);
}

export function validateControlMaterializerPlan(plan) {
  exact(plan, ['schema','purpose','implementationParent','improverPlanSemanticHash','arms','task',
    'source','rules','budgets','proofBoundary'], 'control materializer plan');
  assert.equal(plan.schema, 'ruflo.repair-control-materializer-engineering-plan/v1');
  assert.equal(stableHash(plan), CONTROL_MATERIALIZER_PLAN_HASH, 'control materializer plan hash mismatch');
  assert.equal(plan.implementationParent, '220ba9f08dea55ff50ff4b8e53ff739ecf644446');
  assert.equal(plan.improverPlanSemanticHash, PLAN_HASH);
  assert.deepEqual(plan.arms, ['inherited','frozen','static','shuffled','previous']);
  assert.deepEqual(plan.task, { id: 'p-limit-limit-function-clear-queue', repository: 'sindresorhus/p-limit',
    baseCommit: 'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
    fixCommit: 'f3e7f9ba364a9357bd912d136367d06c46660917', path: 'index.js',
    partition: 'TRAINING_ONLY_CALIBRATION', exposure: 'PUBLISHED_FIX_AND_UPSTREAM_TESTS_KNOWN' });
  exact(plan.source, ['baseGitBlob','baseSha256','baseBytes','knownFixGitBlob','knownFixSha256',
    'maxSourceBytes','oldSnippet','oldSnippetSha256'], 'control source');
  assert.equal(sha256(plan.source.oldSnippet), plan.source.oldSnippetSha256);
  assert.equal(plan.rules.length, FAMILIES.length);
  assert.deepEqual(plan.rules.map(rule => rule.family).sort(), FAMILIES);
  for (const rule of plan.rules) {
    exact(rule, ['family','origin','replacement','replacementSha256','candidateSha256',
      'candidateGitBlob','candidateBytes','knownFixExact'], 'control rule');
    assert(FAMILIES.includes(rule.family), 'known family');
    assert(['RESEARCHER_AUTHORED_FROM_EXPOSED_FIX','RESEARCHER_AUTHORED_NEGATIVE_CONTROL_TEMPLATE']
      .includes(rule.origin), 'known rule origin');
    assert.equal(sha256(rule.replacement), rule.replacementSha256, 'replacement identity');
    assert(Number.isSafeInteger(rule.candidateBytes) && rule.candidateBytes > 0, 'candidate byte bound');
    assert.match(rule.candidateSha256, /^[0-9a-f]{64}$/); assert.match(rule.candidateGitBlob, /^[0-9a-f]{40}$/);
    if (rule.knownFixExact) {
      assert.equal(rule.family, 'FORWARD_GENERATOR_CAPABILITY');
      assert.equal(rule.candidateSha256, plan.source.knownFixSha256);
      assert.equal(rule.candidateGitBlob, plan.source.knownFixGitBlob);
    } else assert.notEqual(rule.candidateSha256, plan.source.knownFixSha256);
  }
  assert.deepEqual(plan.budgets, { childProcessesPerArm: 1, childProposalDescriptorsPerArm: 2,
    parentReverificationProposalDescriptorsPerArm: 2, retainedPatchArtifactsPerArm: 2,
    childArtifactConstructionsPerArm: 2, parentReverificationArtifactConstructionsPerArm: 2,
    childReplacementOperationsPerArm: 2, parentReverificationReplacementOperationsPerArm: 2,
    childDescriptorScoresPerArm: 2, parentReverificationDescriptorScoresPerArm: 2,
    childSourceBytesReadPerArm: 3315, parentReverificationSourceBytesReadPerArm: 3315,
    repairCandidateEvaluations: 0,
    isolatedProcessStarts: 0, nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0 });
  assert.deepEqual(plan.proofBoundary, { engineeringOnly: true, sharedMaterializerMechanismAcrossArms: true,
    equalArtifactCountAcrossArms: true, templatesResearcherAuthoredFromExposedTask: true,
    freshTaskOutcomesRead: false, repositoryPatchApplied: false, repairCandidateEvaluated: false,
    empiricalHypothesisAdmitted: false, improvementCapacityMeasured: false,
    resourceProposalApproved: false, candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false });
  return { planHash: CONTROL_MATERIALIZER_PLAN_HASH, candidateExecutionEnabled: false };
}

function verifyBase(base, plan) {
  assert.equal(base.length, plan.source.baseBytes, 'base byte count');
  assert.equal(sha256(base), plan.source.baseSha256, 'base SHA256');
  assert.equal(gitBlob(base), plan.source.baseGitBlob, 'base Git blob');
  const old = Buffer.from(plan.source.oldSnippet), offset = base.indexOf(old);
  assert(offset >= 0, 'replacement anchor missing');
  assert.equal(base.indexOf(old, offset + 1), -1, 'replacement anchor ambiguous');
  return { old, offset };
}

function artifactFor(plan, descriptor, base) {
  const { old, offset } = verifyBase(base, plan);
  const rule = plan.rules.find(item => item.family === descriptor.family);
  assert(rule, 'descriptor family has no reviewed rule');
  const replacement = Buffer.from(rule.replacement);
  const candidate = Buffer.concat([base.subarray(0, offset), replacement, base.subarray(offset + old.length)]);
  assert.equal(sha256(candidate), rule.candidateSha256, 'candidate SHA256');
  assert.equal(gitBlob(candidate), rule.candidateGitBlob, 'candidate Git blob');
  assert.equal(candidate.length, rule.candidateBytes, 'candidate byte count');
  const bare = { schema: 'ruflo.repair-control-patch-artifact/v1', taskId: plan.task.id,
    arm: descriptor.arm, rank: descriptor.rank, family: descriptor.family,
    descriptorHash: descriptor.descriptorHash, selectedTests: descriptor.selectedTests,
    sourceSha256: plan.source.baseSha256, sourceGitBlob: plan.source.baseGitBlob,
    offsetBytes: offset, removeBytes: old.length, removedSha256: sha256(old),
    replacementBase64: replacement.toString('base64'), replacementSha256: rule.replacementSha256,
    candidateSha256: rule.candidateSha256, candidateGitBlob: rule.candidateGitBlob,
    candidateBytes: candidate.length, ruleOrigin: rule.origin,
    improverPlanHash: descriptor.planHash, materializerPlanHash: CONTROL_MATERIALIZER_PLAN_HASH };
  return { artifact: { ...bare, artifactHash: stableHash(bare) }, candidate };
}

export function runControlMaterializerChild(plan, improverPlan, arm, executedAsChildProcess = false) {
  const check = validateControlMaterializerPlan(plan);
  assert(plan.arms.includes(arm), 'declared arm required');
  const child = runImproverChild(improverPlan, plan.improverPlanSemanticHash, arm, false);
  const base = readBoundedRegularFile(join(ROOT, 'fixtures/p-limit-index.base.js'), plan.source.maxSourceBytes);
  const artifacts = child.proposals.map(descriptor => artifactFor(plan, descriptor, base).artifact);
  assert.equal(artifacts.length, plan.budgets.retainedPatchArtifactsPerArm);
  return { schema: 'ruflo.repair-control-materializer-child-result/v1', arm,
    materializerPlanHash: check.planHash, improverPlanHash: child.planHash,
    stateHash: child.stateHash, artifacts,
    costs: { materializerChildProcesses: executedAsChildProcess ? 1 : 0,
      proposalDescriptors: child.proposals.length, patchArtifacts: artifacts.length,
      replacementOperations: artifacts.length, childDescriptorScores: child.proposals.length,
      sourceBytesRead: base.length,
      repairCandidateEvaluations: 0, isolatedProcessStarts: 0, nativeFieldCalls: 0,
      modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null },
    researcherCoachingAfterSpawn: false, repositoryPatchApplied: false,
    repairCandidateEvaluated: false, freshTaskOutcomesRead: false,
    improvementCapacityMeasured: false, candidateExecutionEnabled: false,
    boundedRsiEvidenceAccepted: false };
}

export function verifyControlMaterializerChild(plan, improverPlan, result) {
  exact(result, ['schema','arm','materializerPlanHash','improverPlanHash','stateHash','artifacts','costs',
    'researcherCoachingAfterSpawn','repositoryPatchApplied','repairCandidateEvaluated','freshTaskOutcomesRead',
    'improvementCapacityMeasured','candidateExecutionEnabled','boundedRsiEvidenceAccepted'], 'child result');
  const expected = runControlMaterializerChild(plan, improverPlan, result.arm, true);
  assert.deepEqual(result, expected, 'parent recomputation of child result');
  return { verified: true, proposalDescriptors: expected.artifacts.length,
    artifactConstructions: expected.artifacts.length, replacementOperations: expected.artifacts.length,
    descriptorScores: expected.artifacts.length, sourceBytesRead: plan.source.baseBytes };
}

export function executeControlCandidate() {
  throw Error('CANDIDATE_EXECUTION_DISABLED: compatible isolation and approved repair resources required');
}

export function runControlMaterializerBatchWithSpawner(planPath, improverPath, spawn) {
  const plan = loadControlMaterializerPlan(planPath), improver = loadImproverPlan(improverPath);
  assert.equal(typeof spawn, 'function', 'spawn function required');
  const started = performance.now(), results = [], attempts = [];
  let parentVerificationAttempts = 0, parentVerificationCompleted = 0;
  for (const arm of plan.arms) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'child', planPath,
      CONTROL_MATERIALIZER_PLAN_HASH, improverPath, PLAN_HASH, arm],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, shell: false,
      env: { LANG: 'C', TZ: 'UTC' } });
    const attempt = { arm, spawnCharged: true, observedChildCompletion: child.status !== null,
      status: child.status ?? null, signal: child.signal ?? null, errorCode: child.error?.code ?? null,
      stdoutSha256: sha256(child.stdout ?? ''), stderrSha256: sha256(child.stderr ?? ''),
      parseSucceeded: false, parentVerificationStarted: false, parentVerificationCompleted: false,
      failureStage: null, failureMessage: null };
    try {
      if (child.status !== 0) throw Object.assign(Error(child.stderr || `materializer child ${arm} failed`),
        { stage: 'SPAWN_OR_CHILD_EXIT' });
      const result = JSON.parse(child.stdout); attempt.parseSucceeded = true;
      attempt.parentVerificationStarted = true; parentVerificationAttempts++;
      verifyControlMaterializerChild(plan, improver, result);
      attempt.parentVerificationCompleted = true; parentVerificationCompleted++;
      results.push(result);
    } catch (error) {
      attempt.failureStage = error.stage ?? (attempt.parseSucceeded ? 'PARENT_VERIFICATION' : 'PARSE');
      attempt.failureMessage = String(error.message).slice(0, 512);
    }
    attempts.push(attempt);
  }
  const complete = results.length === plan.arms.length;
  const successfulChildArtifacts = results.reduce((sum, item) => sum + item.costs.patchArtifacts, 0);
  const successfulChildDescriptors = results.reduce((sum, item) => sum + item.costs.proposalDescriptors, 0);
  return { schema: 'ruflo.repair-control-materializer-batch-result/v1',
    planHash: CONTROL_MATERIALIZER_PLAN_HASH, arms: plan.arms, complete, attempts, results,
    costs: { batchParentProcesses: 1, chargedMaterializerChildSpawnAttempts: attempts.length,
      observedCompletedMaterializerChildProcesses: attempts.filter(item => item.observedChildCompletion).length,
      successfulChildResults: results.length, childProposalDescriptorsObserved: successfulChildDescriptors,
      childArtifactConstructionsObserved: successfulChildArtifacts,
      childReplacementOperationsObserved: successfulChildArtifacts,
      childDescriptorScoresObserved: successfulChildDescriptors,
      childSourceBytesReadObserved: results.reduce((sum, item) => sum + item.costs.sourceBytesRead, 0),
      retainedChildArtifacts: successfulChildArtifacts,
      chargedParentReverificationAttempts: parentVerificationAttempts,
      completedParentReverifications: parentVerificationCompleted,
      chargedParentProposalDescriptors: parentVerificationAttempts * plan.budgets.parentReverificationProposalDescriptorsPerArm,
      chargedParentArtifactConstructions: parentVerificationAttempts * plan.budgets.parentReverificationArtifactConstructionsPerArm,
      chargedParentReplacementOperations: parentVerificationAttempts * plan.budgets.parentReverificationReplacementOperationsPerArm,
      chargedParentDescriptorScores: parentVerificationAttempts * plan.budgets.parentReverificationDescriptorScoresPerArm,
      chargedParentSourceBytesRead: parentVerificationAttempts * plan.budgets.parentReverificationSourceBytesReadPerArm,
      failedOrInterruptedChildWorkUnknown: !complete,
      parentControlPlanReadsObserved: 1, parentControlPlanBytesReadObserved: CONTROL_PLAN_BYTES,
      parentImproverPlanReadsObserved: 1, parentImproverPlanBytesReadObserved: IMPROVER_PLAN_BYTES,
      chargedChildControlPlanReadUpperBound: attempts.length,
      chargedChildControlPlanBytesUpperBound: attempts.length * CONTROL_PLAN_BYTES,
      chargedChildImproverPlanReadUpperBound: attempts.length,
      chargedChildImproverPlanBytesUpperBound: attempts.length * IMPROVER_PLAN_BYTES,
      moduleLoaderBytesRead: null,
      repairCandidateEvaluations: 0, isolatedProcessStarts: 0, nativeFieldCalls: 0,
      modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null },
    elapsedMs: performance.now() - started, candidateExecutionEnabled: false,
    improvementCapacityMeasured: false, boundedRsiEvidenceAccepted: false };
}

export function runControlMaterializerBatch(planPath = PLAN_PATH,
  improverPath = join(ROOT, 'inherited-improver-plan.json')) {
  return runControlMaterializerBatchWithSpawner(planPath, improverPath, spawnSync);
}

export function runControlMaterializerBatchSummary(planPath = PLAN_PATH,
  improverPath = join(ROOT, 'inherited-improver-plan.json')) {
  const batch = runControlMaterializerBatch(planPath, improverPath);
  return { schema: 'ruflo.repair-control-materializer-batch-summary/v1',
    planHash: batch.planHash, arms: batch.arms,
    artifactSetHash: stableHash(batch.results.map(result => ({ arm: result.arm,
      artifacts: result.artifacts.map(artifact => artifact.artifactHash) }))),
    armArtifactHashes: batch.results.map(result => ({ arm: result.arm,
      artifactHashes: result.artifacts.map(artifact => artifact.artifactHash) })),
    complete: batch.complete, attempts: batch.attempts, costs: batch.costs, elapsedMs: batch.elapsedMs,
    candidateExecutionEnabled: false, improvementCapacityMeasured: false,
    boundedRsiEvidenceAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, planPath, planHash, improverPath, improverHash, arm, extra] = process.argv.slice(2);
    if (!['child','batch','batch-summary'].includes(command) || !planPath || !planHash || !improverPath ||
      !improverHash || (command === 'child' ? (!arm || extra) : arm)) throw Error(
      'usage: control-materializer.mjs child|batch|batch-summary PLAN PLAN_HASH IMPROVER IMPROVER_HASH [ARM]');
    assert.equal(planHash, CONTROL_MATERIALIZER_PLAN_HASH, 'reviewed control materializer anchor required');
    assert.equal(improverHash, PLAN_HASH, 'reviewed improver anchor required');
    const output = command === 'child'
      ? runControlMaterializerChild(loadControlMaterializerPlan(planPath), loadImproverPlan(improverPath), arm, true)
      : command === 'batch' ? runControlMaterializerBatch(planPath, improverPath)
        : runControlMaterializerBatchSummary(planPath, improverPath);
    console.log(JSON.stringify(output));
    if (command !== 'child' && !output.complete) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
