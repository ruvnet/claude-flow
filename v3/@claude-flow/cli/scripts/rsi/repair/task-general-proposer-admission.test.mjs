import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TASK_GENERAL_PROPOSER_PLAN_HASH,
  assessTaskGeneralProposerAdmission,
  deriveGenericOperatorSignals,
  executeFreshTaskProposer,
  inspectTaskGeneralProposerAdmission,
  loadTaskGeneralProposerPlan,
  validateTaskGeneralProposerPlan,
} from './task-general-proposer-admission.mjs';
import { inspectFreshImproverAdmission } from './fresh-improver-admission.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(root, 'fresh-task-freeze.json');
const artifactRoot = join(root, 'fresh-tasks');
const planPath = join(root, 'task-general-proposer-plan.json');
const modulePath = join(root, 'task-general-proposer-admission.mjs');
const improverPath = join(root, 'inherited-improver-plan.json');
const materializerPath = join(root, 'control-materializer-plan.json');
const inspect = () => inspectTaskGeneralProposerAdmission(manifestPath, artifactRoot, planPath)[0];

test('reviewed task-general plan has a stable source-independent operator registry', () => {
  const plan = loadTaskGeneralProposerPlan(planPath);
  assert.equal(validateTaskGeneralProposerPlan(plan).planHash, TASK_GENERAL_PROPOSER_PLAN_HASH);
  assert.deepEqual(plan.supportedClusters, ['js-regex-line-boundary']);
  assert.equal(plan.operatorFamilies.length, 4);
  assert(plan.operatorFamilies.every(value => value.origin === 'CODEX_WRITTEN_GENERIC_OPERATOR'));
});

test('frozen public prompt and source admit four generic regex boundary operators', () => {
  const result = inspect();
  assert.equal(result.allArmsAdmitted, true);
  assert.equal(result.operators.filter(value => value.admitted).length, 4);
  assert.deepEqual(result.observations.namedSymbols, ['TITLE_CASE_HEADER']);
  assert.deepEqual(result.observations.matches, [{ path: 'detector/patterns.js', line: 1454,
    symbol: 'TITLE_CASE_HEADER', broadWhitespace: true, globalMultiline: true }]);
});

test('all five controls receive equal nonzero proposal-family admission', () => {
  const result = inspect();
  assert.deepEqual(result.armAdmission.map(value => value.arm),
    ['inherited','frozen','static','shuffled','previous']);
  assert(result.armAdmission.every(value => value.admitted && value.availableProposalFamilies === 4));
  assert(result.armAdmission.every(value => value.selectedProposalFamilies.length === 2));
});

test('new generic availability preserves the p-limit materializer negative', () => {
  const old = inspectFreshImproverAdmission(manifestPath, improverPath, materializerPath);
  const current = inspect();
  assert.equal(old.allAdmitted, false);
  assert(old.tasks[0].armAdmission.every(value => value.admittedProposalFamilies === 0));
  assert(current.armAdmission.every(value => value.selectedProposalFamilies.length === 2));
  assert.equal(current.inheritedStateInfluenceOnAdmission, false);
});

test('Codex-written availability is not mislabeled as inherited-state selection', () => {
  const result = inspect();
  assert.equal(result.codexWrittenProposerEffect, true);
  assert.equal(result.inheritedStateInfluenceOnAdmission, false);
  assert.equal(result.inheritedStateInfluenceOnSelection, false);
  assert(result.armAdmission.every(value => value.inheritedStateInfluence === false));
  assert.deepEqual(new Set(result.armAdmission.map(value => JSON.stringify(value.selectedProposalFamilies))).size, 1);
});

test('generic signal derivation requires a public named source symbol', () => {
  const prompt = { body: 'Keep a physical line and use horizontal whitespace; blank lines must not join.' };
  const files = [{ path: 'rule.js', text: 'const RULE = /A\\s+B/gm;' }];
  const absent = deriveGenericOperatorSignals(prompt, files);
  assert.deepEqual(absent.namedSymbols, []);
  assert.deepEqual(absent.matches, []);
  const present = deriveGenericOperatorSignals({ body: prompt.body + ' Change `RULE`.' }, files);
  assert.equal(present.matches[0].symbol, 'RULE');
  assert(present.sourceSignals.includes('BROAD_WHITESPACE_TOKEN'));
});

test('semantic or raw plan tampering fails closed', () => {
  const plan = JSON.parse(readFileSync(planPath));
  plan.budgets.candidateDescriptors = 1;
  assert.throws(() => validateTaskGeneralProposerPlan(plan), /hash/);
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-task-general-plan-'));
  try {
    const changed = join(dir, 'plan.json');
    writeFileSync(changed, readFileSync(planPath, 'utf8') + '\n');
    assert.throws(() => inspectTaskGeneralProposerAdmission(manifestPath, artifactRoot, changed), /raw/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('inspection needs no evaluator or test-plan files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-proposer-only-'));
  try {
    const taskRoot = join(dir, 'avoid-ai-writing-291'); mkdirSync(taskRoot);
    copyFileSync(join(artifactRoot, 'avoid-ai-writing-291', 'source.tar.gz'), join(taskRoot, 'source.tar.gz'));
    copyFileSync(join(artifactRoot, 'avoid-ai-writing-291', 'task-spec.json'), join(taskRoot, 'task-spec.json'));
    const encoded = JSON.stringify(inspectTaskGeneralProposerAdmission(manifestPath, dir, planPath));
    assert(!encoded.includes('evaluatorPath') && !encoded.includes('testPlanPath'));
    assert(JSON.parse(encoded)[0].allArmsAdmitted);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('input identities and byte costs bind the exact frozen public source', () => {
  const result = inspect();
  assert.deepEqual(result.task, { id: 'avoid-ai-writing-291', repository: 'conorbronsdon/avoid-ai-writing',
    baseCommit: 'fabd62d9c8785dd0edda35201359bcc635b7d3de', cluster: 'js-regex-line-boundary' });
  assert.equal(result.freezeHash, '1ed08cdbc62d67392529b6bc8d02ae3e3a8f5f07e1432ca842382c36167830e3');
  assert.deepEqual({ prompt: result.costs.promptBytesRead, archive: result.costs.sourceArchiveBytesRead,
    decoded: result.costs.decodedSourceBytesRead }, { prompt: 2448, archive: 88498, decoded: 296812 });
});

test('admission creates no descriptor, patch, evaluation, model or isolated work', () => {
  const result = inspect();
  assert.equal(result.candidateDescriptorsProduced, 0);
  assert.equal(result.candidateBytesProduced, 0);
  for (const field of ['repairCandidateEvaluations','proposerStarts','evaluatorStarts','isolatedProcessStarts',
    'summedRepairProcessWallMs','nativeFieldCalls','modelCalls','externalProviderSpendUsd'])
    assert.equal(result.costs[field], 0);
});

test('empirical, execution and RSI gates remain closed', () => {
  const result = inspect();
  for (const field of ['freshTaskOutcomesRead','evaluatorInputsRead','empiricalHypothesisAdmitted',
    'improvementCapacityMeasured','candidateExecutionEnabled','boundedRsiEvidenceAccepted'])
    assert.equal(result[field], false);
  assert.throws(() => executeFreshTaskProposer(), /FRESH_TASK_PROPOSER_EXECUTION_DISABLED/);
});

test('CLI reproduces read-only admission without starting a proposer child', () => {
  const child = spawnSync(process.execPath, [modulePath, 'inspect', manifestPath, artifactRoot, planPath],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, shell: false,
      env: { LANG: 'C', TZ: 'UTC' } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout)[0];
  assert.equal(result.allArmsAdmitted, true);
  assert.equal(result.costs.proposerStarts, 0);
  assert.equal(result.candidateExecutionEnabled, false);
});
