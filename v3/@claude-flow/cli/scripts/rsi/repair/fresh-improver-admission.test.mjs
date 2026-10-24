import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assessFreshImproverAdmission,
  executeFreshImprover,
  inspectFreshImproverAdmission,
} from './fresh-improver-admission.mjs';

const freshPath = fileURLToPath(new URL('./fresh-task-freeze.json', import.meta.url));
const improverPath = fileURLToPath(new URL('./inherited-improver-plan.json', import.meta.url));
const materializerPath = fileURLToPath(new URL('./control-materializer-plan.json', import.meta.url));
const modulePath = fileURLToPath(new URL('./fresh-improver-admission.mjs', import.meta.url));
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const assess = () => assessFreshImproverAdmission(load(freshPath), load(improverPath), load(materializerPath));

test('the current materializer admits no proposal family for the frozen fresh task', () => {
  const result = assess(), task = result.tasks[0];
  assert.equal(result.allAdmitted, false);
  assert.equal(task.taskId, 'avoid-ai-writing-291');
  assert.equal(task.sourceBindingMatches, false);
  assert.deepEqual(task.admittedProposalFamilies, []);
});

test('the negative result binds the exact exposed training and fresh sources', () => {
  const result = assess(), task = result.tasks[0];
  assert.deepEqual(result.trainingBinding, {
    taskId: 'p-limit-limit-function-clear-queue',
    repository: 'sindresorhus/p-limit',
    baseCommit: 'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
    sourcePath: 'index.js',
    partition: 'TRAINING_ONLY_CALIBRATION',
    exposure: 'PUBLISHED_FIX_AND_UPSTREAM_TESTS_KNOWN',
  });
  assert.equal(task.repository, 'conorbronsdon/avoid-ai-writing');
  assert.equal(task.baseCommit, 'fabd62d9c8785dd0edda35201359bcc635b7d3de');
  assert.equal(task.cluster, 'js-regex-line-boundary');
});

test('all five controls fail on the same task-binding gate', () => {
  const result = assess(), arms = result.tasks[0].armAdmission;
  assert.deepEqual(arms.map(item => item.arm), ['inherited','frozen','static','shuffled','previous']);
  assert(arms.every(item => item.admitted === false && item.admittedProposalFamilies === 0));
  assert(arms.every(item => item.blocker === 'TRAINING_ONLY_MATERIALIZER_TASK_BINDING_MISMATCH'));
});

test('the assessment produces no descriptor, patch bytes or resource charges', () => {
  const result = assess();
  assert.equal(result.candidateDescriptorsProduced, 0);
  assert.equal(result.candidateBytesProduced, 0);
  assert.deepEqual(result.costs, {
    proposerStarts: 0, evaluatorStarts: 0, repairCandidateEvaluations: 0,
    isolatedProcessStarts: 0, summedRepairProcessWallMs: 0, nativeFieldCalls: 0,
    modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null,
  });
});

test('fresh outcomes, empirical admission, execution and RSI gates remain closed', () => {
  const result = assess();
  for (const field of ['freshTaskOutcomesRead','empiricalHypothesisAdmitted',
    'improvementCapacityMeasured','candidateExecutionEnabled','boundedRsiEvidenceAccepted'])
    assert.equal(result[field], false);
  assert.throws(() => executeFreshImprover(), /FRESH_IMPROVER_EXECUTION_DISABLED/);
});

test('a known training task cannot be relabeled as fresh to bypass the mismatch', () => {
  const fresh = load(freshPath), training = load(materializerPath).task, task = fresh.tasks[0];
  task.id = training.id; task.repository = training.repository;
  task.source.baseCommit = training.baseCommit;
  task.source.sourceUrl = `https://github.com/${training.repository}/tree/${training.baseCommit}`;
  assert.throws(() => assessFreshImproverAdmission(fresh, load(improverPath), load(materializerPath)),
    /cannot be fresh/);
});

test('rehashed improver or materializer changes cannot manufacture compatibility', () => {
  const improver = load(improverPath), materializer = load(materializerPath);
  improver.task.repository = 'conorbronsdon/avoid-ai-writing';
  assert.throws(() => assessFreshImproverAdmission(load(freshPath), improver, load(materializerPath)), /hash/);
  materializer.task.repository = 'conorbronsdon/avoid-ai-writing';
  assert.throws(() => assessFreshImproverAdmission(load(freshPath), load(improverPath), materializer), /hash/);
});

test('bounded inspection is read only and preserves all source artifacts', () => {
  const before = [freshPath, improverPath, materializerPath].map(path => readFileSync(path));
  const result = inspectFreshImproverAdmission(freshPath, improverPath, materializerPath);
  assert.equal(result.allAdmitted, false);
  assert.deepEqual([freshPath, improverPath, materializerPath].map(path => readFileSync(path)), before);
});

test('CLI emits the same closed admission result without child execution', () => {
  const child = spawnSync(process.execPath,
    [modulePath, 'inspect', freshPath, improverPath, materializerPath],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, shell: false,
      env: { LANG: 'C', TZ: 'UTC' } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.allAdmitted, false);
  assert.equal(result.candidateDescriptorsProduced, 0);
  assert.equal(result.candidateExecutionEnabled, false);
});
