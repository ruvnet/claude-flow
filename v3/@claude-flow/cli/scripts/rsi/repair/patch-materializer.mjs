#!/usr/bin/env node
/** Exposed-template patch materializer. Engineering-only: no repository execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadImproverPlan, PLAN_HASH, RAW_PLAN_SHA256, runImproverChild,
  stableHash } from './inherited-improver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MATERIALIZER_PLAN_PATH = join(ROOT, 'patch-materializer-plan.json');
export const MATERIALIZER_PLAN_HASH = '525b8e6f4818d76c314d68fa7c02a4b7f05c41249c7ed463063063ba19e5ea8b';
export const MATERIALIZER_RAW_SHA256 = '4aef281fdbe07346395a4a25367d9a126677e00e9044a7779f796f71ae417b33';
const MAX_PLAN_BYTES = 1024 * 1024;

const exact = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

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
      assert(count > 0, 'input changed during bounded read');
      offset += count;
    }
    const after = fstatSync(descriptor);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(after[field], before[field],
      `input ${field} changed during read`);
    return bytes;
  } finally { closeSync(descriptor); }
}

export function loadMaterializerPlan(path = MATERIALIZER_PLAN_PATH) {
  const bytes = readBoundedRegularFile(path, MAX_PLAN_BYTES);
  assert.equal(sha256(bytes), MATERIALIZER_RAW_SHA256, 'raw materializer plan bytes mismatch');
  return JSON.parse(bytes);
}

export function validateMaterializerPlan(plan) {
  exact(plan, ['schema','purpose','implementationParent','inheritedImprover','task','source',
    'admittedRule','budgets','proofBoundary'], 'materializer plan');
  assert.equal(plan.schema, 'ruflo.repair-patch-materializer-engineering-plan/v1');
  assert.equal(stableHash(plan), MATERIALIZER_PLAN_HASH, 'materializer plan hash mismatch');
  assert.equal(plan.implementationParent, '8bf532221055dc62cecd9b007eaf5d17c9f5e9d7');
  assert.deepEqual(plan.inheritedImprover, { planSemanticHash: PLAN_HASH,
    planRawSha256: RAW_PLAN_SHA256, requiredArm: 'inherited',
    requiredLibraryId: 'forward-generator-capability',
    requiredFamily: 'FORWARD_GENERATOR_CAPABILITY',
    requiredDescriptorHash: '04fc1e03a99e94f6ec9b3adae880761175828ee7618ec2ed65be657a680a28b6',
    requiredSelectedTests: ['LIMIT_FUNCTION_CLEAR_QUEUE', 'ORDINARY_THROUGHPUT'] });
  assert.deepEqual(plan.task, { id: 'p-limit-limit-function-clear-queue',
    repository: 'sindresorhus/p-limit', baseCommit: 'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
    fixCommit: 'f3e7f9ba364a9357bd912d136367d06c46660917', path: 'index.js',
    partition: 'TRAINING_ONLY_CALIBRATION', exposure: 'PUBLISHED_FIX_AND_UPSTREAM_TESTS_KNOWN' });
  exact(plan.source, ['baseGitBlob','baseSha256','baseBytes','knownFixGitBlob','knownFixSha256',
    'knownFixBytes','maxSourceBytes'], 'source');
  assert.deepEqual(plan.source, { baseGitBlob: '5ecd39257c623b6dd4df204bbd7c94fbdf0b8d12',
    baseSha256: '30fa94b6aebe7f044f7383feee7931fc7c1a4912affadac97539cda67c14057d',
    baseBytes: 3315, knownFixGitBlob: 'b74d48ab0e37788e657e5ad12d90e281ef1f39d1',
    knownFixSha256: '63239cd9ae80b1433e05014fe6ec501475c6fa59fad06418cb5972dbc7cc14e2',
    knownFixBytes: 3446, maxSourceBytes: 16384 });
  exact(plan.admittedRule, ['schema','operation','oldSnippet','oldSnippetSha256','functionName',
    'functionArgument','optionsArgument','limiterName','wrapperName','forwardedProperty'], 'admitted rule');
  assert.equal(plan.admittedRule.schema, 'ruflo.repair-single-replacement-rule/v1');
  assert.equal(plan.admittedRule.operation, 'WRAP_AND_FORWARD_SINGLE_PROPERTY_V1');
  assert.equal(sha256(plan.admittedRule.oldSnippet), plan.admittedRule.oldSnippetSha256);
  for (const key of ['functionName','functionArgument','optionsArgument','limiterName','wrapperName','forwardedProperty']) {
    assert.match(plan.admittedRule[key], /^[A-Za-z_$][A-Za-z0-9_$]*$/, `${key} identifier`);
  }
  assert.deepEqual(plan.budgets, { childProcesses: 1, patchArtifacts: 1, replacementOperations: 1,
    trainingOnlyDescriptorScores: 4,
    repairCandidateEvaluations: 0, isolatedProcessStarts: 0, nativeFieldCalls: 0,
    modelCalls: 0, externalProviderSpendUsd: 0 });
  assert.deepEqual(plan.proofBoundary, { engineeringOnly: true,
    ruleResearcherAuthoredFromExposedFix: true, exposedFixDerivedRuleReadByChild: true,
    knownFixFixturePathProvided: false, knownFixFixtureReadAuditPerformed: false,
    freshTaskOutcomesRead: false, matchedControlPatchCoverage: false,
    empiricalHypothesisAdmitted: false, repositoryPatchApplied: false,
    repairCandidateEvaluated: false, resourceProposalApproved: false,
    candidateExecutionEnabled: false, improvementCapacityMeasured: false,
    boundedRsiEvidenceAccepted: false });
  return { planHash: MATERIALIZER_PLAN_HASH, candidateExecutionEnabled: false };
}

function replacementSnippet(rule) {
  const { functionName, functionArgument, optionsArgument, limiterName, wrapperName,
    forwardedProperty } = rule;
  return `export function ${functionName}(${functionArgument}, ${optionsArgument}) {\n` +
    `\tconst ${limiterName} = pLimit(${optionsArgument});\n\n` +
    `\tconst ${wrapperName} = (...arguments_) => ${limiterName}(() => ${functionArgument}(...arguments_));\n` +
    `\tObject.defineProperty(${wrapperName}, '${forwardedProperty}', {\n` +
    `\t\tvalue: ${limiterName}.${forwardedProperty},\n\t});\n\n` +
    `\treturn ${wrapperName};\n}\n`;
}

function verifyBaseSource(bytes, plan) {
  assert.equal(bytes.length, plan.source.baseBytes, 'base source byte count');
  assert.equal(sha256(bytes), plan.source.baseSha256, 'base source SHA256');
  assert.equal(gitBlob(bytes), plan.source.baseGitBlob, 'base source Git blob');
}

export function applyPatchArtifact(baseBytes, artifact, plan) {
  validateMaterializerPlan(plan);
  exact(artifact, ['schema','taskId','arm','descriptorHash','sourceSha256','sourceGitBlob','offsetBytes',
    'removeBytes','removedSha256','insertBase64','insertSha256','candidateSha256','candidateGitBlob','selectedTests',
    'planHash','materializerPlanHash','artifactHash'], 'patch artifact');
  const identity = { ...artifact }; delete identity.artifactHash;
  assert.equal(stableHash(identity), artifact.artifactHash, 'patch artifact hash');
  verifyBaseSource(baseBytes, plan);
  assert.equal(artifact.schema, 'ruflo.repair-single-replacement-artifact/v1');
  assert.equal(artifact.taskId, plan.task.id, 'patch task lineage');
  assert.equal(artifact.arm, plan.inheritedImprover.requiredArm, 'patch arm lineage');
  assert.equal(artifact.planHash, plan.inheritedImprover.planSemanticHash, 'patch improver lineage');
  assert.equal(artifact.materializerPlanHash, MATERIALIZER_PLAN_HASH, 'patch materializer lineage');
  assert.equal(artifact.descriptorHash, plan.inheritedImprover.requiredDescriptorHash,
    'patch descriptor lineage');
  assert.deepEqual(artifact.selectedTests, plan.inheritedImprover.requiredSelectedTests,
    'patch test-selection lineage');
  assert.equal(artifact.sourceSha256, plan.source.baseSha256, 'patch source SHA256');
  assert.equal(artifact.sourceGitBlob, plan.source.baseGitBlob, 'patch source Git blob');
  assert(Number.isSafeInteger(artifact.offsetBytes) && artifact.offsetBytes >= 0);
  assert(Number.isSafeInteger(artifact.removeBytes) && artifact.removeBytes > 0);
  const oldBytes = Buffer.from(plan.admittedRule.oldSnippet);
  const expectedOffset = baseBytes.indexOf(oldBytes);
  assert(expectedOffset >= 0, 'patch anchor missing');
  assert.equal(baseBytes.indexOf(oldBytes, expectedOffset + 1), -1, 'patch anchor ambiguous');
  assert.equal(artifact.offsetBytes, expectedOffset, 'patch anchor offset');
  assert.equal(artifact.removeBytes, oldBytes.length, 'patch removal length');
  const end = artifact.offsetBytes + artifact.removeBytes;
  assert(end <= baseBytes.length, 'patch removal bounds');
  const removed = baseBytes.subarray(artifact.offsetBytes, end);
  assert.deepEqual(removed, oldBytes, 'patch removal bytes');
  assert.equal(sha256(removed), artifact.removedSha256, 'patch removal identity');
  const inserted = Buffer.from(artifact.insertBase64, 'base64');
  assert.equal(inserted.toString('base64'), artifact.insertBase64, 'canonical patch bytes');
  assert.deepEqual(inserted, Buffer.from(replacementSnippet(plan.admittedRule)),
    'patch insertion must match reviewed rule');
  assert.equal(sha256(inserted), artifact.insertSha256, 'patch insertion identity');
  const candidate = Buffer.concat([baseBytes.subarray(0, artifact.offsetBytes), inserted,
    baseBytes.subarray(end)]);
  assert.equal(sha256(candidate), artifact.candidateSha256, 'candidate source identity');
  assert.equal(artifact.candidateSha256, plan.source.knownFixSha256, 'candidate exposed-fix SHA256');
  assert.equal(gitBlob(candidate), artifact.candidateGitBlob, 'candidate Git blob identity');
  assert.equal(artifact.candidateGitBlob, plan.source.knownFixGitBlob, 'candidate exposed-fix Git blob');
  return candidate;
}

export function materializePatch(plan, improverPlan, childResult, baseBytes) {
  validateMaterializerPlan(plan); verifyBaseSource(baseBytes, plan);
  assert.equal(childResult.planHash, plan.inheritedImprover.planSemanticHash, 'child plan lineage');
  assert.equal(childResult.arm, plan.inheritedImprover.requiredArm, 'admitted arm');
  const recomputedChild = runImproverChild(improverPlan,
    plan.inheritedImprover.planSemanticHash, childResult.arm, false);
  assert.equal(stableHash(childResult), stableHash(recomputedChild), 'child result recomputation');
  assert.equal(childResult.proposals.length, 2, 'reviewed proposal count');
  const selected = childResult.proposals[0];
  assert.equal(selected.libraryId, plan.inheritedImprover.requiredLibraryId, 'admitted library proposal');
  assert.equal(selected.family, plan.inheritedImprover.requiredFamily, 'admitted proposal family');
  assert.equal(selected.patchBytes, null, 'descriptor must precede materialization');
  const oldBytes = Buffer.from(plan.admittedRule.oldSnippet);
  const offset = baseBytes.indexOf(oldBytes);
  assert(offset >= 0, 'patch anchor missing');
  assert.equal(baseBytes.indexOf(oldBytes, offset + 1), -1, 'patch anchor ambiguous');
  const insertBytes = Buffer.from(replacementSnippet(plan.admittedRule));
  const bare = { schema: 'ruflo.repair-single-replacement-artifact/v1', taskId: plan.task.id,
    arm: childResult.arm, descriptorHash: selected.descriptorHash,
    sourceSha256: plan.source.baseSha256, sourceGitBlob: plan.source.baseGitBlob,
    offsetBytes: offset, removeBytes: oldBytes.length, removedSha256: sha256(oldBytes),
    insertBase64: insertBytes.toString('base64'), insertSha256: sha256(insertBytes),
    candidateSha256: null, candidateGitBlob: null, selectedTests: selected.selectedTests,
    planHash: childResult.planHash, materializerPlanHash: MATERIALIZER_PLAN_HASH };
  const candidate = Buffer.concat([baseBytes.subarray(0, offset), insertBytes,
    baseBytes.subarray(offset + oldBytes.length)]);
  bare.candidateSha256 = sha256(candidate);
  bare.candidateGitBlob = gitBlob(candidate);
  const artifact = { ...bare, artifactHash: stableHash(bare) };
  assert.deepEqual(applyPatchArtifact(baseBytes, artifact, plan), candidate);
  return artifact;
}

export function runPatchMaterializerChild(materializerPlan, expectedMaterializerHash,
  improverPlan, expectedImproverHash, arm, sourcePath, executedAsChildProcess = false) {
  const check = validateMaterializerPlan(materializerPlan);
  assert.equal(expectedMaterializerHash, check.planHash, 'reviewed materializer anchor required');
  assert.equal(expectedImproverHash, materializerPlan.inheritedImprover.planSemanticHash,
    'reviewed improver anchor required');
  const childResult = runImproverChild(improverPlan, expectedImproverHash, arm, false);
  const baseBytes = readBoundedRegularFile(sourcePath, materializerPlan.source.maxSourceBytes);
  const patchArtifact = materializePatch(materializerPlan, improverPlan, childResult, baseBytes);
  return { schema: 'ruflo.repair-patch-materializer-child-result/v1', arm,
    materializerPlanHash: check.planHash, improverPlanHash: childResult.planHash,
    childStateHash: childResult.stateHash, patchArtifact,
    costs: { engineeringChildProcessStarts: executedAsChildProcess ? 1 : 0,
      patchArtifacts: 1, replacementOperations: 1, sourceBytesRead: baseBytes.length,
      insertedPatchBytes: Buffer.from(patchArtifact.insertBase64, 'base64').length,
      trainingOnlyDescriptorScores: 4,
      repairCandidateEvaluations: 0, isolatedProcessStarts: 0, nativeFieldCalls: 0,
      modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null },
    researcherCoachingAfterSpawn: false, exposedFixDerivedRuleReadByChild: true,
    knownFixFixturePathProvided: false, knownFixFixtureReadAuditPerformed: false,
    repositoryPatchApplied: false, repairCandidateEvaluated: false,
    freshTaskOutcomesRead: false, matchedControlPatchCoverage: false,
    candidateExecutionEnabled: false, improvementCapacityMeasured: false,
    boundedRsiEvidenceAccepted: false };
}

export function executeMaterializedCandidate() {
  throw Error('CANDIDATE_EXECUTION_DISABLED: compatible isolation and approved repair resources required');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, materializerPath, materializerHash, improverPath, improverHash, arm, sourcePath, extra] =
      process.argv.slice(2);
    if (command !== 'child' || !materializerPath || !materializerHash || !improverPath ||
      !improverHash || !arm || !sourcePath || extra) throw Error(
      'usage: patch-materializer.mjs child MATERIALIZER_PLAN MATERIALIZER_HASH IMPROVER_PLAN IMPROVER_HASH ARM SOURCE');
    console.log(JSON.stringify(runPatchMaterializerChild(loadMaterializerPlan(materializerPath),
      materializerHash, loadImproverPlan(improverPath), improverHash, arm, sourcePath, true)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
