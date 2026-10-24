#!/usr/bin/env node
/** Fail-closed metadata admission for fresh development tasks. Never executes tasks. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRESH_TASK_SCHEMA = 'ruflo.fresh-development-task-freeze/v1';
const digest40 = /^[a-f0-9]{40}$/;
const digest64 = /^[a-f0-9]{64}$/;
const safeId = /^[a-z0-9][a-z0-9-]{2,79}$/;
const safeRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REQUIRED_FORBIDDEN_IDS = [
  'click-sentinel-copy-pickle-identity',
  'p-limit-limit-function-clear-queue',
  'receipt-fractions',
  'receipt-roundtrip',
  'receipt-unknown-fields',
  'ruvector-cypher-not-precedence',
];
const REQUIRED_FORBIDDEN_COMMITS = [
  '99ea97607acd3498e3b48aeaa708ecb5df5d8f25',
  'df644e2a4050901fe8b75db9d2c512255b854f78',
  'df476048d023ff868cd45b35ee47f5fb0ca2b25a',
  'f3e7f9ba364a9357bd912d136367d06c46660917',
  '420c8fb44eeadb537cae69d2fee3796e808558dd',
  'f58ca3e81424a35626c8a475eb59ab95589008ce',
  'a295c68703158377a6ce827738bf8f13b94bd695',
  'ea2df4726cbeaa181d4f3bba8335b1c4160ebb35',
  'fa13ee4ad60ac2090b1480656eb233521790d640',
  'a38647e1f90f126cac0d23e452cfb2fa7fa3b196',
  '7d0bb9c53b9d26dc32e08788608ace9b18f4f8a9',
];

const assert = (condition, reason) => { if (!condition) throw Error(reason); };
const exactKeys = (value, keys, reason) => assert(
  value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), reason,
);
export const sha256 = value => createHash('sha256').update(
  typeof value === 'string' ? value : JSON.stringify(value),
).digest('hex');

function validateMission(mission) {
  exactKeys(mission, ['id', 'initialAnchor', 'ledgerHead', 'nativeFieldCallsReserved', 'epochsConsumed'], 'mission fields');
  assert(mission.id === 'rsi-ruflo-loop-20260912', 'mission identity');
  assert(mission.initialAnchor === 'c5c6da0b728c52414f2dff86f9d23121776d600defff0f214f1502a091f69088', 'initial ledger anchor');
  assert(mission.ledgerHead === '5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e', 'ledger head');
  assert(mission.nativeFieldCallsReserved === 209784 && mission.epochsConsumed === 7, 'mission counters changed');
}

function validateExclusions(exclusions) {
  exactKeys(exclusions, ['calibrationCorpusGitBlob', 'publicWorkloadsGitBlob', 'forbiddenTaskIds', 'forbiddenCommits'], 'exclusion registry fields');
  assert(digest40.test(exclusions.calibrationCorpusGitBlob) && digest40.test(exclusions.publicWorkloadsGitBlob), 'exclusion source identity');
  assert(Array.isArray(exclusions.forbiddenTaskIds) && new Set(exclusions.forbiddenTaskIds).size === exclusions.forbiddenTaskIds.length, 'forbidden task registry');
  assert(Array.isArray(exclusions.forbiddenCommits) && new Set(exclusions.forbiddenCommits).size === exclusions.forbiddenCommits.length && exclusions.forbiddenCommits.every(value => digest40.test(value)), 'forbidden commit registry');
  for (const id of REQUIRED_FORBIDDEN_IDS) assert(exclusions.forbiddenTaskIds.includes(id), `known exposed task omitted: ${id}`);
  for (const commit of REQUIRED_FORBIDDEN_COMMITS) assert(exclusions.forbiddenCommits.includes(commit), `known exposed revision omitted: ${commit}`);
  return {
    taskIds: new Set(exclusions.forbiddenTaskIds),
    commits: new Set(exclusions.forbiddenCommits),
  };
}

function validateTask(task, forbidden) {
  exactKeys(task, ['id', 'repository', 'cluster', 'license', 'source', 'prompt', 'evaluator', 'provenance'], 'fresh task fields');
  assert(safeId.test(task.id) && safeRepo.test(task.repository) && safeId.test(task.cluster), 'fresh task identity');
  assert(!forbidden.taskIds.has(task.id), 'exposed or consumed task cannot be fresh');
  assert(['MIT', 'BSD-3-Clause', 'Apache-2.0'].includes(task.license), 'reviewed permissive license required');

  exactKeys(task.source, ['baseCommit', 'baseTree', 'archiveSha256', 'archiveBytes', 'sourceUrl'], 'fresh source fields');
  assert(digest40.test(task.source.baseCommit) && digest40.test(task.source.baseTree) && digest64.test(task.source.archiveSha256), 'fresh source identity');
  assert(!forbidden.commits.has(task.source.baseCommit) && !forbidden.commits.has(task.source.baseTree), 'exposed source revision cannot be fresh');
  assert(Number.isSafeInteger(task.source.archiveBytes) && task.source.archiveBytes > 0, 'fresh source archive size');
  assert(task.source.sourceUrl === `https://github.com/${task.repository}/tree/${task.source.baseCommit}`, 'fresh source URL');

  exactKeys(task.prompt, ['capsuleSha256', 'capsuleBytes', 'sourceUrl', 'issueNumber', 'visibility', 'capturedBeforeProposal'], 'fresh prompt fields');
  assert(digest64.test(task.prompt.capsuleSha256) && Number.isSafeInteger(task.prompt.capsuleBytes) &&
    task.prompt.capsuleBytes > 0 && task.prompt.capsuleBytes <= 65536, 'fresh prompt capsule');
  assert(Number.isSafeInteger(task.prompt.issueNumber) && task.prompt.issueNumber > 0, 'fresh prompt issue number');
  assert(task.prompt.sourceUrl === `https://github.com/${task.repository}/issues/${task.prompt.issueNumber}`, 'fresh prompt URL');
  assert(task.prompt.visibility === 'PROPOSER_VISIBLE_PUBLIC_TASK_INPUT' &&
    task.prompt.capturedBeforeProposal === true, 'fresh prompt boundary');

  exactKeys(task.evaluator, ['capsuleSha256', 'capsuleBytes', 'testPlanSha256', 'visibility', 'authoredBeforeProposal'], 'fresh evaluator fields');
  assert(digest64.test(task.evaluator.capsuleSha256) && digest64.test(task.evaluator.testPlanSha256), 'fresh evaluator identity');
  assert(Number.isSafeInteger(task.evaluator.capsuleBytes) && task.evaluator.capsuleBytes > 0, 'fresh evaluator capsule size');
  assert(task.evaluator.visibility === 'PARENT_ONLY_UNREAD_BY_PROPOSER' && task.evaluator.authoredBeforeProposal === true, 'fresh evaluator boundary');

  exactKeys(task.provenance, ['sourceKind', 'selectedAt', 'selectedBeforeProposal', 'fixDataAcquired', 'outcomeRead', 'selectionQuerySha256'], 'fresh provenance fields');
  assert(task.provenance.sourceKind === 'PUBLIC_GITHUB_PRE_OUTCOME' && Number.isFinite(Date.parse(task.provenance.selectedAt)), 'fresh task provenance');
  assert(task.provenance.selectedBeforeProposal === true && task.provenance.fixDataAcquired === false && task.provenance.outcomeRead === false, 'freshness boundary violated');
  assert(digest64.test(task.provenance.selectionQuerySha256), 'selection query identity');
  return structuredClone(task);
}

function validateProofBoundary(boundary) {
  exactKeys(boundary, ['developmentOnly', 'freshOutcomesRead', 'fixDataAcquired', 'evaluatorKeys', 'resourceProposalApproved', 'candidateExecutionEnabled', 'confirmationEligible', 'boundedRsiEvidenceAccepted'], 'proof boundary fields');
  assert(boundary.developmentOnly === true && boundary.freshOutcomesRead === false && boundary.fixDataAcquired === false, 'fresh development proof boundary');
  assert(Array.isArray(boundary.evaluatorKeys) && boundary.evaluatorKeys.length === 0, 'local evaluator keys forbidden');
  assert(boundary.resourceProposalApproved === false && boundary.candidateExecutionEnabled === false && boundary.confirmationEligible === false && boundary.boundedRsiEvidenceAccepted === false, 'fresh freeze cannot enable trials or RSI');
}

function validateAccounting(accounting) {
  exactKeys(accounting, ['repairCandidateEvaluations', 'isolatedProcessStarts', 'summedProcessWallMs', 'newNativeFieldCalls', 'newEpochs', 'externalProviderSpendUsd', 'totalAcquisitionUsd', 'totalEvaluationUsd'], 'accounting fields');
  for (const key of ['repairCandidateEvaluations', 'isolatedProcessStarts', 'summedProcessWallMs', 'newNativeFieldCalls', 'newEpochs', 'externalProviderSpendUsd']) assert(accounting[key] === 0, `unapproved resource use: ${key}`);
  assert(accounting.totalAcquisitionUsd === null && accounting.totalEvaluationUsd === null, 'unknown total dollar costs must remain explicit');
}

export function validateFreshTaskFreeze(manifest, expectedHash) {
  exactKeys(manifest, ['schema', 'frozenAt', 'implementationParent', 'mission', 'selection', 'exclusions', 'proofBoundary', 'accounting', 'tasks'], 'fresh freeze fields');
  assert(manifest.schema === FRESH_TASK_SCHEMA && Number.isFinite(Date.parse(manifest.frozenAt)) && digest40.test(manifest.implementationParent), 'fresh freeze schema or source');
  validateMission(manifest.mission);
  exactKeys(manifest.selection, ['method', 'sampleFrozenBeforeProposal', 'outcomeBlind', 'taskCount'], 'selection fields');
  assert(typeof manifest.selection.method === 'string' && manifest.selection.method.length >= 40 && manifest.selection.sampleFrozenBeforeProposal === true && manifest.selection.outcomeBlind === true, 'pre-proposal selection required');
  assert(Number.isSafeInteger(manifest.selection.taskCount) && manifest.selection.taskCount >= 0 && manifest.selection.taskCount <= 12, 'bounded task count');
  const forbidden = validateExclusions(manifest.exclusions);
  validateProofBoundary(manifest.proofBoundary);
  validateAccounting(manifest.accounting);
  assert(Array.isArray(manifest.tasks) && manifest.tasks.length === manifest.selection.taskCount, 'task count mismatch');
  const tasks = manifest.tasks.map(task => validateTask(task, forbidden));
  assert(new Set(tasks.map(task => task.id)).size === tasks.length, 'duplicate fresh task id');
  assert(new Set(tasks.map(task => `${task.repository}@${task.source.baseCommit}`)).size === tasks.length, 'duplicate fresh source');
  const freezeHash = sha256(manifest);
  if (expectedHash !== undefined) assert(digest64.test(expectedHash) && freezeHash === expectedHash, 'fresh freeze hash mismatch');
  return {
    schema: 'ruflo.fresh-development-task-admission/v1',
    freezeHash,
    freshTaskCount: tasks.length,
    exclusionCount: forbidden.taskIds.size,
    partitionEnforced: true,
    fixesOrOutcomesAdmitted: false,
    candidateAdmissible: false,
    candidateExecutionEnabled: false,
    boundedRsiEvidenceAccepted: false,
  };
}

export function inspectFreshTaskFreeze(path = new URL('./fresh-task-freeze.json', import.meta.url), expectedHash) {
  return validateFreshTaskFreeze(JSON.parse(readFileSync(path, 'utf8')), expectedHash);
}

export function executeFreshTask() {
  throw Error('FRESH_TASK_EXECUTION_DISABLED: metadata freeze is not source, evaluator, isolation or resource authorization');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, path, expectedHash, extra] = process.argv.slice(2);
    if (command !== 'inspect' || !path || extra) throw Error('usage: fresh-task-admission.mjs inspect MANIFEST [FREEZE_HASH]');
    console.log(JSON.stringify(inspectFreshTaskFreeze(resolve(path), expectedHash), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
