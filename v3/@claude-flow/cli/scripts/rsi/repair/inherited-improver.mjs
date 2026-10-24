#!/usr/bin/env node
/** Smallest inherited repair-state proposer. Engineering-only: no patch execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(ROOT, 'inherited-improver-plan.json');
export const PLAN_HASH = 'd9ff24763a9398763e79bde5741b8e5ec092b5da642f28c827bdd78008b002a0';
export const RAW_PLAN_SHA256 = '55292e89055f5f5e81478e442c38ac7b451a1540f9d1125eb4a12ddd9b4683b9';
const MAX_PLAN_BYTES = 1024 * 1024;
const FAMILY_ORDER = ['DECREMENT_ACTIVE_COUNT', 'DRAIN_QUEUE_AFTER_CLEAR',
  'FORWARD_GENERATOR_CAPABILITY', 'REJECT_CLEARED_PROMISES'];
const TEST_ORDER = ['CONCURRENCY_BOUND', 'LIMIT_FUNCTION_CLEAR_QUEUE',
  'ORDINARY_THROUGHPUT', 'REJECTION_PROPAGATION'];

export const stableHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const exact = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);

function exactScoreMap(value, keys, label) {
  exact(value, keys, label);
  for (const score of Object.values(value)) assert(Number.isSafeInteger(score) && score >= 0 && score <= 100,
    `${label} bounded integer credits`);
}

function readBoundedRegularFile(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    assert(stat.isFile(), 'improver plan must be a regular file');
    assert(stat.size > 0 && stat.size <= MAX_PLAN_BYTES, 'improver plan size bound');
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert(count > 0, 'improver plan changed during bounded read');
      offset += count;
    }
    const after = fstatSync(descriptor);
    assert.equal(after.dev, stat.dev, 'improver plan device changed');
    assert.equal(after.ino, stat.ino, 'improver plan inode changed');
    assert.equal(after.size, stat.size, 'improver plan size changed');
    assert.equal(after.mtimeMs, stat.mtimeMs, 'improver plan changed during read');
    return bytes;
  } finally { closeSync(descriptor); }
}

export function loadImproverPlan(path = PLAN_PATH) {
  const bytes = readBoundedRegularFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), RAW_PLAN_SHA256,
    'raw improver plan bytes mismatch');
  return JSON.parse(bytes);
}

export function validateImproverPlan(plan) {
  exact(plan, ['schema','purpose','implementationParent','task','failureTrace','proposalLibrary','parentState',
    'previousOptimizerState','controls','budgets','frozenMechanism','proofBoundary'], 'plan');
  assert.equal(plan.schema, 'ruflo.repair-inherited-improver-engineering-plan/v1');
  assert.equal(stableHash(plan), PLAN_HASH, 'improver plan hash mismatch');
  assert.equal(plan.implementationParent, 'b9d30d3c4ef2befb83db18425e4b7d932069389a');
  assert.deepEqual(plan.task, {
    id: 'p-limit-limit-function-clear-queue', repository: 'sindresorhus/p-limit',
    baseCommit: 'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
    fixCommit: 'f3e7f9ba364a9357bd912d136367d06c46660917',
    baseTree: '21d1b1115ab955f499ca0de32b8819b936775dd9',
    fixTree: '15da3cf8d9426b331317aa3719e8a157721d3cbe',
    diffSha256: '265905aeb1727496ea8c41a8cf60e9826c8724d778a409b5d8233e23a562f818',
    exposure: 'PUBLISHED_FIX_AND_UPSTREAM_TESTS_KNOWN', partition: 'TRAINING_ONLY_CALIBRATION' });
  exact(plan.failureTrace, ['schema','taskId','signals','successfulFamily','requiredTests','source','freshTaskOutcome'], 'failure trace');
  assert.equal(plan.failureTrace.taskId, plan.task.id);
  assert.equal(plan.failureTrace.source, 'EXPOSED_HISTORICAL_FIX');
  assert.equal(plan.failureTrace.freshTaskOutcome, false);
  assert.equal(plan.proposalLibrary.length, 4);
  assert.deepEqual(plan.proposalLibrary.map(item => item.family).sort(), [...FAMILY_ORDER].sort());
  assert.equal(new Set(plan.proposalLibrary.map(item => item.id)).size, 4);
  for (const item of plan.proposalLibrary) {
    exact(item, ['id','family','signals','tests'], 'proposal library item');
    assert(item.signals.length > 0 && item.signals.every(signal => plan.failureTrace.signals.includes(signal)));
    assert(item.tests.length === 2 && item.tests.every(test => TEST_ORDER.includes(test)));
  }
  exact(plan.parentState, ['schema','generation','parentStateHash','diagnosisRuleCredits','patchFamilyCredits',
    'testCredits','trainingTraceHashes'], 'parent state');
  assert.equal(plan.parentState.schema, 'ruflo.repair-inherited-state/v1');
  assert.equal(plan.parentState.generation, 0); assert.equal(plan.parentState.parentStateHash, null);
  exactScoreMap(plan.parentState.patchFamilyCredits, FAMILY_ORDER, 'parent patch credits');
  exactScoreMap(plan.parentState.testCredits, TEST_ORDER, 'parent test credits');
  exactScoreMap(plan.parentState.diagnosisRuleCredits, [...plan.failureTrace.signals].sort(),
    'parent diagnosis credits');
  assert.deepEqual(plan.controls, ['inherited','frozen','static','shuffled','previous']);
  assert.deepEqual(plan.budgets, { childProcessesPerArm: 1, proposalDescriptorsPerArm: 2,
    descriptorScoresPerArm: 2, repairCandidateEvaluations: 0, isolatedProcessStarts: 0,
    nativeFieldCalls: 0, externalProviderSpendUsd: 0 });
  assert.deepEqual(plan.frozenMechanism, { proposer: 'DETERMINISTIC_RULE_PROPOSER_V1',
    evaluator: 'TRAINING_TRACE_DESCRIPTOR_MATCH_V1', model: 'NONE',
    permissions: 'NO_NETWORK_NO_REPOSITORY_EXECUTION_NO_PATCH_APPLICATION',
    shuffleSeed: 'ruflo-rsi-inheritance-control-v1' });
  assert.deepEqual(plan.previousOptimizerState, {
    schema: 'ruflo.repair-previous-optimizer-binding/v1', availability: 'NO_PRIOR_REPAIR_OPTIMIZER',
    source: 'PARENT_GENERATION_ZERO', stateHash: stableHash(plan.parentState) });
  assert.deepEqual(plan.proofBoundary, { engineeringOnly: true, freshTaskOutcomesRead: false,
    empiricalHypothesisAdmitted: false, improvementCapacityMeasured: false,
    previousControlDegenerateWithFrozen: true,
    resourceProposalApproved: false, candidateExecutionEnabled: false,
    boundedRsiEvidenceAccepted: false });
  return { planHash: PLAN_HASH, candidateExecutionEnabled: false };
}

function trainingTraceHash(plan) {
  return stableHash({ task: plan.task, failureTrace: plan.failureTrace });
}

function learnedState(plan) {
  const state = copy(plan.parentState);
  state.generation = 1; state.parentStateHash = stableHash(plan.parentState);
  plan.failureTrace.signals.forEach((signal, index, signals) => {
    state.diagnosisRuleCredits[signal] += signals.length - index;
  });
  state.patchFamilyCredits[plan.failureTrace.successfulFamily] += 3;
  for (const test of plan.failureTrace.requiredTests) state.testCredits[test] += 1;
  state.trainingTraceHashes = [trainingTraceHash(plan)];
  return state;
}

function deterministicShuffle(values, seed) {
  return [...values].map(value => ({ value, key: stableHash({ seed, value }) }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(item => item.value);
}

function shuffledScoreMap(scoreMap, order, seed) {
  const shuffledKeys = deterministicShuffle(order, seed);
  const scores = order.map(key => scoreMap[key]);
  return Object.fromEntries(shuffledKeys.map((key, index) => [key, scores[index]]));
}

function stateForArm(plan, arm) {
  const parentHash = stableHash(plan.parentState);
  if (arm === 'inherited') return { state: learnedState(plan), stateSource: 'TRAINING_TRACE_INHERITED' };
  if (arm === 'frozen') return { state: { ...copy(plan.parentState), generation: 1, parentStateHash: parentHash },
    stateSource: 'PARENT_STATE_FROZEN' };
  if (arm === 'static') {
    const state = { ...copy(plan.parentState), generation: 1, parentStateHash: parentHash };
    Object.keys(state.diagnosisRuleCredits).sort().forEach((signal, index, values) => {
      state.diagnosisRuleCredits[signal] = values.length - index;
    });
    FAMILY_ORDER.forEach((family, index) => { state.patchFamilyCredits[family] = FAMILY_ORDER.length - index; });
    TEST_ORDER.forEach((test, index) => { state.testCredits[test] = TEST_ORDER.length - index; });
    return { state, stateSource: 'FIXED_STATIC_PRIOR' };
  }
  if (arm === 'previous') {
    assert.equal(plan.previousOptimizerState.stateHash, parentHash, 'previous optimizer binding');
    const state = { ...copy(plan.parentState), generation: 1, parentStateHash: parentHash };
    return { state, stateSource: 'NO_PRIOR_REPAIR_OPTIMIZER_USES_PARENT' };
  }
  assert.equal(arm, 'shuffled', 'known control arm');
  const learned = learnedState(plan), signals = Object.keys(learned.diagnosisRuleCredits).sort();
  learned.diagnosisRuleCredits = shuffledScoreMap(learned.diagnosisRuleCredits, signals,
    `${plan.frozenMechanism.shuffleSeed}:diagnosis`);
  learned.patchFamilyCredits = shuffledScoreMap(learned.patchFamilyCredits, FAMILY_ORDER,
    `${plan.frozenMechanism.shuffleSeed}:patch`);
  learned.testCredits = shuffledScoreMap(learned.testCredits, TEST_ORDER,
    `${plan.frozenMechanism.shuffleSeed}:test`);
  learned.trainingTraceHashes = [stableHash({ shuffled: trainingTraceHash(plan), seed: plan.frozenMechanism.shuffleSeed })];
  return { state: learned, stateSource: 'DETERMINISTICALLY_SHUFFLED_TRAINING_CREDIT' };
}

function proposalPriority(item, state) {
  return state.patchFamilyCredits[item.family] +
    item.signals.reduce((sum, signal) => sum + state.diagnosisRuleCredits[signal], 0) +
    item.tests.reduce((sum, name) => sum + state.testCredits[name], 0);
}

function rank(items, state) {
  return [...items].sort((a, b) => (proposalPriority(b, state) - proposalPriority(a, state)) ||
    a.id.localeCompare(b.id));
}

function selectTests(item, state) {
  return [...TEST_ORDER].sort((a, b) => {
    const aScore = state.testCredits[a] + (item.tests.includes(a) ? 1 : 0);
    const bScore = state.testCredits[b] + (item.tests.includes(b) ? 1 : 0);
    return (bScore - aScore) || a.localeCompare(b);
  }).slice(0, 2);
}

function descriptorScore(proposal, trace) {
  const familyMatch = proposal.family === trace.successfulFamily ? 2 : 0;
  const signalMatches = proposal.signals.filter(signal => trace.signals.includes(signal)).length;
  const testMatches = proposal.selectedTests.filter(test => trace.requiredTests.includes(test)).length;
  return { familyMatch, signalMatches, testMatches, total: familyMatch + signalMatches + testMatches };
}

export function runImproverChild(plan, expectedPlanHash, arm, executedAsChildProcess = false) {
  const check = validateImproverPlan(plan);
  assert.equal(expectedPlanHash, check.planHash, 'reviewed plan anchor required');
  assert(plan.controls.includes(arm), 'declared arm required');
  const { state, stateSource } = stateForArm(plan, arm);
  const stateHash = stableHash(state);
  const ranked = rank(plan.proposalLibrary, state).slice(0, plan.budgets.proposalDescriptorsPerArm);
  const proposals = ranked.map((item, index) => {
    const selectedTests = selectTests(item, state);
    const descriptor = { arm, rank: index + 1, libraryId: item.id, family: item.family,
      signals: item.signals, selectedTests, planHash: check.planHash,
      implementationParent: plan.implementationParent,
      stateHash, stateSource, generation: state.generation, parentStateHash: state.parentStateHash,
      proposer: plan.frozenMechanism.proposer, patchBytes: null };
    return { ...descriptor, descriptorHash: stableHash(descriptor),
      trainingOnlyDescriptorScore: descriptorScore(descriptor, plan.failureTrace) };
  });
  assert.equal(proposals.length, plan.budgets.proposalDescriptorsPerArm);
  return { schema: 'ruflo.repair-inherited-improver-child-result/v1', arm,
    planHash: check.planHash, stateSource, state, stateHash, proposals,
    costs: { engineeringChildProcessStarts: executedAsChildProcess ? 1 : 0, proposalDescriptors: proposals.length,
      trainingOnlyDescriptorScores: proposals.length, repairCandidateEvaluations: 0,
      isolatedProcessStarts: 0, nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0,
      totalAcquisitionUsd: null, totalEngineeringUsd: null },
    researcherCoachingAfterSpawn: false, freshTaskOutcomesRead: false,
    empiricalHypothesisAdmitted: false, improvementCapacityMeasured: false,
    candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false };
}

export function executeRepairCandidate() {
  throw Error('CANDIDATE_EXECUTION_DISABLED: compatible isolation and approved repair resources required');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, planPath, planHash, arm, extra] = process.argv.slice(2);
    if (command !== 'child' || !planPath || !planHash || !arm || extra) throw Error('usage: inherited-improver.mjs child PLAN PLAN_HASH ARM');
    console.log(JSON.stringify(runImproverChild(loadImproverPlan(planPath), planHash, arm, true)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
