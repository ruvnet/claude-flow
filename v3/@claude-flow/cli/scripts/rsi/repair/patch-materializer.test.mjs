import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatchArtifact, executeMaterializedCandidate, loadMaterializerPlan,
  MATERIALIZER_PLAN_HASH, MATERIALIZER_RAW_SHA256, materializePatch,
  runPatchMaterializerChild, validateMaterializerPlan } from './patch-materializer.mjs';
import { loadImproverPlan, PLAN_HASH, runImproverChild, stableHash } from './inherited-improver.mjs';

const here = name => new URL(name, import.meta.url);
const materializerPlan = () => loadMaterializerPlan();
const improverPlan = () => loadImproverPlan();
const baseBytes = () => readFileSync(here('./fixtures/p-limit-index.base.js'));
const fixBytes = () => readFileSync(here('./fixtures/p-limit-index.fix.js'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

test('materializer plan binds the inherited descriptor source and closes all execution gates', () => {
  const plan = materializerPlan(), result = validateMaterializerPlan(plan);
  assert.equal(result.planHash, MATERIALIZER_PLAN_HASH);
  assert.equal(plan.inheritedImprover.planSemanticHash, PLAN_HASH);
  assert.equal(plan.task.partition, 'TRAINING_ONLY_CALIBRATION');
  assert.equal(plan.proofBoundary.exposedFixDerivedRuleReadByChild, true);
  assert.equal(plan.proofBoundary.knownFixFixturePathProvided, false);
  assert.equal(plan.proofBoundary.knownFixFixtureReadAuditPerformed, false);
  assert.equal(plan.proofBoundary.candidateExecutionEnabled, false);
});

test('raw and semantic plan identities are independently frozen', () => {
  const bytes = readFileSync(here('./patch-materializer-plan.json'));
  assert.equal(sha256(bytes), MATERIALIZER_RAW_SHA256);
  assert.equal(stableHash(JSON.parse(bytes)), MATERIALIZER_PLAN_HASH);
});

test('base and oracle fixtures reproduce exact upstream Git blobs and raw hashes', () => {
  const plan = materializerPlan(), base = baseBytes(), fix = fixBytes();
  assert.deepEqual({ bytes: base.length, sha256: sha256(base), gitBlob: gitBlob(base) },
    { bytes: plan.source.baseBytes, sha256: plan.source.baseSha256, gitBlob: plan.source.baseGitBlob });
  assert.deepEqual({ bytes: fix.length, sha256: sha256(fix), gitBlob: gitBlob(fix) },
    { bytes: plan.source.knownFixBytes, sha256: plan.source.knownFixSha256,
      gitBlob: plan.source.knownFixGitBlob });
});

test('inherited descriptor deterministically materializes the exact exposed fix in memory', () => {
  const plan = materializerPlan(), improver = improverPlan(), base = baseBytes();
  const child = runImproverChild(improver, PLAN_HASH, 'inherited');
  const artifact = materializePatch(plan, improver, child, base);
  assert.equal(artifact.candidateSha256, plan.source.knownFixSha256);
  assert.deepEqual(applyPatchArtifact(base, artifact, plan), fixBytes());
  assert.deepEqual(artifact.selectedTests, ['LIMIT_FUNCTION_CLEAR_QUEUE', 'ORDINARY_THROUGHPUT']);
});

test('materialized artifact is deterministic and binds descriptor, plan and source identities', () => {
  const plan = materializerPlan(), improver = improverPlan(), base = baseBytes();
  const child = runImproverChild(improver, PLAN_HASH, 'inherited');
  const first = materializePatch(plan, improver, child, base);
  const second = materializePatch(plan, improver, child, base);
  assert.equal(stableHash(first), stableHash(second));
  assert.equal(first.descriptorHash, child.proposals[0].descriptorHash);
  assert.equal(first.materializerPlanHash, MATERIALIZER_PLAN_HASH);
  assert.equal(first.sourceGitBlob, plan.source.baseGitBlob);
});

test('plan mutation cannot authorize a different source, rule, arm, budget or proof boundary', () => {
  for (const mutate of [
    plan => { plan.source.baseSha256 = '0'.repeat(64); },
    plan => { plan.admittedRule.forwardedProperty = 'activeCount'; },
    plan => { plan.inheritedImprover.requiredArm = 'static'; },
    plan => { plan.budgets.repairCandidateEvaluations = 1; },
    plan => { plan.proofBoundary.knownFixFixturePathProvided = true; },
  ]) { const plan = materializerPlan(); mutate(plan); assert.throws(() => validateMaterializerPlan(plan), /hash/); }
});

test('source corruption and a substituted base are rejected before materialization', () => {
  const plan = materializerPlan(), improver = improverPlan();
  const child = runImproverChild(improver, PLAN_HASH, 'inherited');
  const corrupted = baseBytes(); corrupted[0] ^= 1;
  assert.throws(() => materializePatch(plan, improver, child, corrupted), /SHA256/);
  assert.throws(() => materializePatch(plan, improver, child, fixBytes()), /byte count/);
});

test('rehashed descriptor substitution fails deterministic child-result recomputation', () => {
  const plan = materializerPlan(), improver = improverPlan();
  const child = runImproverChild(improver, PLAN_HASH, 'inherited');
  child.proposals[0].libraryId = 'drain-queue-after-clear';
  child.proposals[0].descriptorHash = stableHash(child.proposals[0]);
  assert.throws(() => materializePatch(plan, improver, child, baseBytes()), /recomputation/);
});

test('non-inherited controls cannot borrow the sole admitted exposed template', () => {
  const plan = materializerPlan(), improver = improverPlan();
  for (const arm of ['frozen', 'static', 'shuffled', 'previous']) {
    const child = runImproverChild(improver, PLAN_HASH, arm);
    assert.throws(() => materializePatch(plan, improver, child, baseBytes()), /admitted arm/);
  }
  assert.equal(plan.proofBoundary.matchedControlPatchCoverage, false);
});

test('artifact byte, offset, removal and lineage tampering fail closed', () => {
  const plan = materializerPlan(), improver = improverPlan(), base = baseBytes();
  const child = runImproverChild(improver, PLAN_HASH, 'inherited');
  const original = materializePatch(plan, improver, child, base);
  for (const mutate of [
    artifact => { artifact.insertBase64 = Buffer.from('different').toString('base64'); },
    artifact => { artifact.offsetBytes += 1; },
    artifact => { artifact.removeBytes -= 1; },
    artifact => { artifact.materializerPlanHash = '0'.repeat(64); },
  ]) {
    const artifact = structuredClone(original); mutate(artifact);
    assert.throws(() => applyPatchArtifact(base, artifact, plan), /artifact hash/);
  }
  for (const [mutate, expected] of [
    [artifact => { artifact.taskId = 'different-task'; }, /task lineage/],
    [artifact => { artifact.arm = 'static'; }, /arm lineage/],
    [artifact => { artifact.planHash = '0'.repeat(64); }, /improver lineage/],
    [artifact => { artifact.descriptorHash = '0'.repeat(64); }, /descriptor lineage/],
    [artifact => { artifact.selectedTests.reverse(); }, /test-selection lineage/],
    [artifact => { artifact.sourceSha256 = '0'.repeat(64); }, /source SHA256/],
    [artifact => { artifact.sourceGitBlob = '0'.repeat(40); }, /source Git blob/],
    [artifact => { artifact.removeBytes -= 1; }, /removal length/],
    [artifact => { artifact.insertBase64 = Buffer.from('different').toString('base64'); },
      /insertion must match/],
    [artifact => { artifact.candidateSha256 = '0'.repeat(64); }, /candidate source identity/],
    [artifact => { artifact.candidateGitBlob = '0'.repeat(40); }, /candidate Git blob identity/],
  ]) {
    const artifact = structuredClone(original); mutate(artifact);
    const identity = { ...artifact }; delete identity.artifactHash;
    artifact.artifactHash = stableHash(identity);
    assert.throws(() => applyPatchArtifact(base, artifact, plan), expected);
  }
});

test('no public API can apply or evaluate the candidate in a repository', () => {
  assert.throws(() => executeMaterializedCandidate(), /CANDIDATE_EXECUTION_DISABLED/);
});

test('non-regular FIFO plan input is rejected without waiting for a writer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ruflo-materializer-fifo-'));
  const fifo = join(directory, 'plan.fifo');
  try {
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 1000, shell: false });
    assert.equal(made.status, 0, made.stderr);
    const started = performance.now();
    assert.throws(() => loadMaterializerPlan(fifo), /regular file/);
    assert(performance.now() - started < 500, 'FIFO rejection must not block');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('one child process materializes the patch without receiving the known-fix fixture path', () => {
  const args = [new URL('./patch-materializer.mjs', import.meta.url).pathname, 'child',
    new URL('./patch-materializer-plan.json', import.meta.url).pathname, MATERIALIZER_PLAN_HASH,
    new URL('./inherited-improver-plan.json', import.meta.url).pathname, PLAN_HASH, 'inherited',
    new URL('./fixtures/p-limit-index.base.js', import.meta.url).pathname];
  assert(!args.some(value => value.includes('p-limit-index.fix.js')));
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000,
    maxBuffer: 65536, shell: false, env: { LANG: 'C', TZ: 'UTC' } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout), plan = materializerPlan();
  assert.equal(result.patchArtifact.candidateSha256, plan.source.knownFixSha256);
  assert.deepEqual(applyPatchArtifact(baseBytes(), result.patchArtifact, plan), fixBytes(),
    'parent must independently verify child artifact');
  assert.deepEqual(result.costs, { engineeringChildProcessStarts: 1, patchArtifacts: 1,
    replacementOperations: 1, sourceBytesRead: 3315, insertedPatchBytes: 284,
    trainingOnlyDescriptorScores: 4, repairCandidateEvaluations: 0, isolatedProcessStarts: 0,
    nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null });
  assert.equal(result.exposedFixDerivedRuleReadByChild, true);
  assert.equal(result.knownFixFixturePathProvided, false);
  assert.equal(result.knownFixFixtureReadAuditPerformed, false);
  assert.equal(result.repositoryPatchApplied, false);
  assert.equal(result.candidateExecutionEnabled, false);
});
