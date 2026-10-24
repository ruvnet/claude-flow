import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeFreshTask, inspectFreshTaskFreeze, sha256, validateFreshTaskFreeze } from './fresh-task-admission.mjs';

const PATH = fileURLToPath(new URL('./fresh-task-freeze.json', import.meta.url));
const original = () => JSON.parse(readFileSync(PATH, 'utf8'));
const mutate = edit => { const value = original(); edit(value); return value; };
const synthetic = () => ({
  id: 'synthetic-fresh-task', repository: 'example/fresh-repo', cluster: 'fresh-cluster', license: 'MIT',
  source: { baseCommit: '1'.repeat(40), baseTree: '2'.repeat(40), archiveSha256: '3'.repeat(64), archiveBytes: 128, sourceUrl: `https://github.com/example/fresh-repo/tree/${'1'.repeat(40)}` },
  prompt: { capsuleSha256: '7'.repeat(64), capsuleBytes: 256, sourceUrl: 'https://github.com/example/fresh-repo/issues/123', issueNumber: 123, visibility: 'PROPOSER_VISIBLE_PUBLIC_TASK_INPUT', capturedBeforeProposal: true },
  evaluator: { capsuleSha256: '4'.repeat(64), capsuleBytes: 64, testPlanSha256: '5'.repeat(64), visibility: 'PARENT_ONLY_UNREAD_BY_PROPOSER', authoredBeforeProposal: true },
  provenance: { sourceKind: 'PUBLIC_GITHUB_PRE_OUTCOME', selectedAt: '2026-09-13T19:00:00.000Z', selectedBeforeProposal: true, fixDataAcquired: false, outcomeRead: false, selectionQuerySha256: '6'.repeat(64) },
});
const withTask = edit => mutate(m => { const task = synthetic(); edit?.(task, m); m.tasks = [task]; m.selection.taskCount = 1; });

test('current freeze admits one source-bound real task and preserves the mission lineage', () => {
  const result = inspectFreshTaskFreeze(PATH);
  assert.equal(result.freshTaskCount, 1);
  assert.equal(result.partitionEnforced, true);
  assert.equal(result.candidateAdmissible, false);
});

test('metadata-only synthetic fixture demonstrates the future admission path', () => {
  const result = validateFreshTaskFreeze(withTask());
  assert.equal(result.freshTaskCount, 1);
  assert.equal(result.fixesOrOutcomesAdmitted, false);
  assert.equal(result.candidateExecutionEnabled, false);
});

test('freeze hash is deterministic and externally pinnable', () => {
  const manifest = original(), expected = sha256(manifest);
  assert.equal(validateFreshTaskFreeze(manifest, expected).freezeHash, expected);
  assert.throws(() => validateFreshTaskFreeze(manifest, '0'.repeat(64)), /hash mismatch/);
});

test('all known calibration and exposed workload ids remain excluded', () => {
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.id = 'p-limit-limit-function-clear-queue'; })), /cannot be fresh/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.exclusions.forbiddenTaskIds = m.exclusions.forbiddenTaskIds.filter(id => id !== 'receipt-fractions'); })), /known exposed task omitted/);
});

test('known base and fix commits cannot be relabeled fresh', () => {
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.source.baseCommit = 'df476048d023ff868cd45b35ee47f5fb0ca2b25a'; task.source.sourceUrl = `https://github.com/${task.repository}/tree/${task.source.baseCommit}`; })), /exposed source revision/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.exclusions.forbiddenCommits.pop(); })), /known exposed revision omitted/);
});

test('solution-bearing and outcome-bearing fields fail the exact schema', () => {
  for (const field of ['fixCommit', 'patch', 'outcome', 'failureTrace']) {
    assert.throws(() => validateFreshTaskFreeze(withTask(task => { task[field] = 'forbidden'; })), /fresh task fields/);
  }
});

test('freshness provenance rejects fix acquisition and outcome reads', () => {
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.provenance.fixDataAcquired = true; })), /freshness boundary/);
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.provenance.outcomeRead = true; })), /freshness boundary/);
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.provenance.selectedBeforeProposal = false; })), /freshness boundary/);
});

test('evaluator capsule must be frozen before proposal and hidden from proposer', () => {
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.evaluator.authoredBeforeProposal = false; })), /evaluator boundary/);
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.evaluator.visibility = 'PUBLIC'; })), /evaluator boundary/);
});

test('task and source identities are exact, bounded and nonduplicated', () => {
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.source.archiveBytes = 0; })), /archive size/);
  assert.throws(() => validateFreshTaskFreeze(withTask(task => { task.source.sourceUrl = 'https://example.com'; })), /source URL/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { const task = synthetic(); m.tasks = [task, structuredClone(task)]; m.selection.taskCount = 2; })), /duplicate fresh task/);
});

test('task count stays bounded and must match the frozen sample', () => {
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.selection.taskCount = 0; })), /task count mismatch/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.selection.taskCount = 13; })), /bounded task count/);
});

test('mission ancestry and consumed counters cannot reset', () => {
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.mission.initialAnchor = '0'.repeat(64); })), /initial ledger anchor/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.mission.nativeFieldCallsReserved = 0; })), /mission counters/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.mission.epochsConsumed = 0; })), /mission counters/);
});

test('resource, evaluator and RSI gates remain closed', () => {
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.proofBoundary.resourceProposalApproved = true; })), /cannot enable trials/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.proofBoundary.evaluatorKeys = ['local']; })), /evaluator keys/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.proofBoundary.boundedRsiEvidenceAccepted = true; })), /cannot enable trials/);
  assert.throws(() => executeFreshTask(), /EXECUTION_DISABLED/);
});

test('unapproved use and fabricated zero dollar totals reject', () => {
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.accounting.repairCandidateEvaluations = 1; })), /unapproved resource/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.accounting.totalAcquisitionUsd = 0; })), /unknown total dollar costs/);
  assert.throws(() => validateFreshTaskFreeze(mutate(m => { m.accounting.totalEvaluationUsd = 0; })), /unknown total dollar costs/);
});

test('CLI inspection is read-only and reports the closed boundary', () => {
  const before = readFileSync(PATH), output = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('./fresh-task-admission.mjs', import.meta.url)), 'inspect', PATH,
  ], { encoding: 'utf8', timeout: 5000 }));
  assert.equal(output.freshTaskCount, 1);
  assert.equal(output.candidateExecutionEnabled, false);
  assert.equal(output.boundedRsiEvidenceAccepted, false);
  assert.deepEqual(readFileSync(PATH), before);
});
