import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeRepairCandidate, loadImproverPlan, PLAN_HASH, runImproverChild,
  RAW_PLAN_SHA256, stableHash, validateImproverPlan } from './inherited-improver.mjs';

const plan = () => loadImproverPlan();

test('frozen engineering plan binds exposed p-limit training lineage and closes every gate', () => {
  const value = plan(), result = validateImproverPlan(value);
  assert.equal(result.planHash, PLAN_HASH);
  assert.equal(value.task.partition, 'TRAINING_ONLY_CALIBRATION');
  assert.equal(value.failureTrace.freshTaskOutcome, false);
  assert.equal(value.proofBoundary.improvementCapacityMeasured, false);
  assert.equal(value.proofBoundary.candidateExecutionEnabled, false);
});

test('rehashing cannot substitute task lineage, controls, budgets or proof boundary', () => {
  for (const mutate of [
    value => { value.task.baseCommit = '0'.repeat(40); },
    value => { value.controls.pop(); },
    value => { value.budgets.repairCandidateEvaluations = 1; },
    value => { value.proofBoundary.freshTaskOutcomesRead = true; },
    value => { value.frozenMechanism.model = 'researcher'; },
  ]) { const value = plan(); mutate(value); assert.throws(() => validateImproverPlan(value), /hash/); }
});

test('inherited child derives versioned state and proposals without post-spawn coaching', () => {
  const result = runImproverChild(plan(), PLAN_HASH, 'inherited');
  assert.equal(result.state.generation, 1);
  assert.match(result.state.parentStateHash, /^[a-f0-9]{64}$/);
  assert.equal(result.state.trainingTraceHashes.length, 1);
  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0].family, 'FORWARD_GENERATOR_CAPABILITY');
  assert.equal(result.researcherCoachingAfterSpawn, false);
  assert.equal(result.costs.repairCandidateEvaluations, 0);
});

test('all arms share proposer, descriptor budget and closed execution accounting', () => {
  for (const arm of plan().controls) {
    const result = runImproverChild(plan(), PLAN_HASH, arm);
    assert.equal(result.proposals.length, 2);
    assert(result.proposals.every(item => item.proposer === 'DETERMINISTIC_RULE_PROPOSER_V1'));
    assert.deepEqual(result.costs, { engineeringChildProcessStarts: 0, proposalDescriptors: 2,
      trainingOnlyDescriptorScores: 2, repairCandidateEvaluations: 0, isolatedProcessStarts: 0,
      nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0,
      totalAcquisitionUsd: null, totalEngineeringUsd: null });
  }
});

test('frozen control advances lineage without learning training credits', () => {
  const result = runImproverChild(plan(), PLAN_HASH, 'frozen');
  assert(Object.values(result.state.patchFamilyCredits).every(score => score === 0));
  assert.deepEqual(result.state.trainingTraceHashes, []);
  assert.equal(result.stateSource, 'PARENT_STATE_FROZEN');
});

test('static control is fixed independently of training trace credits', () => {
  const result = runImproverChild(plan(), PLAN_HASH, 'static');
  assert.equal(result.stateSource, 'FIXED_STATIC_PRIOR');
  assert.equal(result.proposals[0].family, 'DRAIN_QUEUE_AFTER_CLEAR');
  assert.deepEqual(result.state.trainingTraceHashes, []);
});

test('shuffled control preserves the learned credit multiset but breaks attribution', () => {
  const inherited = runImproverChild(plan(), PLAN_HASH, 'inherited');
  const shuffled = runImproverChild(plan(), PLAN_HASH, 'shuffled');
  assert.deepEqual(Object.values(shuffled.state.patchFamilyCredits).sort((a, b) => a - b),
    Object.values(inherited.state.patchFamilyCredits).sort((a, b) => a - b));
  assert.notDeepEqual(shuffled.state.patchFamilyCredits, inherited.state.patchFamilyCredits);
  assert.deepEqual(Object.values(shuffled.state.diagnosisRuleCredits).sort((a, b) => a - b),
    Object.values(inherited.state.diagnosisRuleCredits).sort((a, b) => a - b));
  assert.notDeepEqual(shuffled.state.diagnosisRuleCredits, inherited.state.diagnosisRuleCredits);
  assert.deepEqual(Object.values(shuffled.state.testCredits).sort((a, b) => a - b),
    Object.values(inherited.state.testCredits).sort((a, b) => a - b));
  assert.notDeepEqual(shuffled.state.testCredits, inherited.state.testCredits);
  assert.equal(shuffled.stateSource, 'DETERMINISTICALLY_SHUFFLED_TRAINING_CREDIT');
});

test('previous control uses the exact predecessor optimizer checkpoint', () => {
  const value = plan(), result = runImproverChild(value, PLAN_HASH, 'previous');
  assert.equal(value.previousOptimizerState.availability, 'NO_PRIOR_REPAIR_OPTIMIZER');
  assert.equal(value.previousOptimizerState.stateHash, stableHash(value.parentState));
  assert.deepEqual(result.state.patchFamilyCredits, value.parentState.patchFamilyCredits);
  assert.equal(result.stateSource, 'NO_PRIOR_REPAIR_OPTIMIZER_USES_PARENT');
});

test('descriptor evaluation is deterministic and confined to the exposed training trace', () => {
  const first = runImproverChild(plan(), PLAN_HASH, 'inherited');
  const second = runImproverChild(plan(), PLAN_HASH, 'inherited');
  assert.equal(stableHash(first), stableHash(second));
  assert(first.proposals.every(item => item.patchBytes === null));
  assert.equal(first.freshTaskOutcomesRead, false);
  assert.equal(first.improvementCapacityMeasured, false);
});

test('descriptors bind arm, plan and generating state even when control states degenerate', () => {
  const value = plan();
  const frozen = runImproverChild(value, PLAN_HASH, 'frozen');
  const previous = runImproverChild(value, PLAN_HASH, 'previous');
  assert.equal(frozen.stateHash, previous.stateHash);
  assert.notEqual(frozen.proposals[0].descriptorHash, previous.proposals[0].descriptorHash);
  assert.equal(frozen.proposals[0].stateHash, frozen.stateHash);
  assert.equal(previous.proposals[0].arm, 'previous');
});

test('wrong plan anchor or undeclared arm fails before producing descriptors', () => {
  assert.throws(() => runImproverChild(plan(), '0'.repeat(64), 'inherited'), /anchor/);
  assert.throws(() => runImproverChild(plan(), PLAN_HASH, 'adaptive'), /declared arm/);
});

test('no API can convert engineering descriptors into repair candidates', () => {
  assert.throws(() => executeRepairCandidate(), /CANDIDATE_EXECUTION_DISABLED/);
});

test('plan acquisition rejects symlinks, FIFOs and oversized files before parsing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ruflo-improver-plan-read-'));
  const target = join(directory, 'target.json'), link = join(directory, 'link.json');
  const oversized = join(directory, 'oversized.json'), fifo = join(directory, 'plan.fifo');
  try {
    writeFileSync(target, '{}'); symlinkSync(target, link);
    writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1));
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 1000, shell: false });
    assert.equal(made.status, 0, made.stderr);
    assert.throws(() => loadImproverPlan(link), /ELOOP|symbolic link/i);
    assert.throws(() => loadImproverPlan(oversized), /size bound/);
    const started = performance.now();
    assert.throws(() => loadImproverPlan(fifo), /regular file/);
    assert(performance.now() - started < 500, 'FIFO rejection must not block');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('five child processes independently produce and score successors from the frozen plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ruflo-inherited-improver-'));
  const path = join(directory, 'plan.json');
  copyFileSync(new URL('./inherited-improver-plan.json', import.meta.url), path);
  try {
    for (const arm of plan().controls) {
      const child = spawnSync(process.execPath, [new URL('./inherited-improver.mjs', import.meta.url).pathname,
        'child', path, PLAN_HASH, arm], { env: { LANG: 'C', TZ: 'UTC' }, encoding: 'utf8',
        timeout: 5000, maxBuffer: 65536, shell: false });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.arm, arm); assert.equal(result.proposals.length, 2);
      assert.equal(result.costs.engineeringChildProcessStarts, 1);
      assert.equal(result.costs.repairCandidateEvaluations, 0);
      assert.equal(result.candidateExecutionEnabled, false);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('raw plan file identity is the reviewed canonical JSON identity', () => {
  const bytes = readFileSync(new URL('./inherited-improver-plan.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), RAW_PLAN_SHA256);
  assert.equal(stableHash(JSON.parse(bytes)), PLAN_HASH);
});
