#!/usr/bin/env node
/** Admit generic source-derived repair operators without creating or evaluating candidates. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundRegularFile } from './bounded-file.mjs';
import { validateFreshTaskFreeze } from './fresh-task-admission.mjs';
import { parseSourceArchive } from './fresh-task-capsule.mjs';
import { validatePromptBytes } from './fresh-task-prompt.mjs';
import { stableHash } from './inherited-improver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = resolve(ROOT, 'task-general-proposer-plan.json');
export const TASK_GENERAL_PROPOSER_PLAN_HASH = '8cf99c276596dc5d66f57b63bc0c1e77da1df3253310fe3a403652c8d93a9248';
export const TASK_GENERAL_PROPOSER_RAW_SHA256 = 'f1917c1720b42686fb5ad0f0887a8fdae9686ff60cdcf19d2da5ae7326c696a2';
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const EXPECTED_CONTROLS = ['inherited', 'frozen', 'static', 'shuffled', 'previous'];
const EXPECTED_FAMILIES = ['NARROW_REGEX_WHITESPACE_CLASS', 'EXCLUDE_CRLF_FROM_WHITESPACE',
  'PRESERVE_MULTILINE_ANCHORS_WITH_LINE_LOCAL_TOKENS', 'POST_MATCH_REJECT_LINEBREAK'];

const exact = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);
const inside = (root, path) => path.startsWith(`${root}${sep}`);

export function loadTaskGeneralProposerPlan(path = PLAN_PATH) {
  const bytes = readBoundRegularFile(path, MAX_JSON_BYTES, 'task-general proposer plan').bytes;
  // Keep a raw-byte anchor separate from semantic validation.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), TASK_GENERAL_PROPOSER_RAW_SHA256,
    'raw task-general plan bytes mismatch');
  const plan = JSON.parse(bytes);
  validateTaskGeneralProposerPlan(plan);
  return plan;
}

export function validateTaskGeneralProposerPlan(plan) {
  exact(plan, ['schema','purpose','implementationParent','trainingInputs','admittedInputs','supportedClusters',
    'operatorFamilies','controls','budgets','proofBoundary'], 'task-general plan');
  assert.equal(plan.schema, 'ruflo.task-general-proposer-engineering-plan/v1');
  assert.equal(stableHash(plan), TASK_GENERAL_PROPOSER_PLAN_HASH, 'task-general plan hash mismatch');
  assert.equal(plan.implementationParent, 'a4f50ce028b033c475b1e28a402eb598369b4309');
  assert.deepEqual(plan.controls, EXPECTED_CONTROLS);
  assert.deepEqual(plan.supportedClusters, ['js-regex-line-boundary']);
  assert.deepEqual(plan.operatorFamilies.map(value => value.family), EXPECTED_FAMILIES);
  assert.equal(new Set(plan.operatorFamilies.map(value => value.id)).size, EXPECTED_FAMILIES.length);
  for (const operator of plan.operatorFamilies) {
    exact(operator, ['id','family','requiredPromptSignals','requiredSourceSignals','origin'], 'operator');
    assert.equal(operator.origin, 'CODEX_WRITTEN_GENERIC_OPERATOR');
    assert(operator.requiredPromptSignals.length > 0 && operator.requiredSourceSignals.length > 0);
  }
  assert.deepEqual(plan.trainingInputs, {
    inheritedImproverPlanHash: 'd9ff24763a9398763e79bde5741b8e5ec092b5da642f28c827bdd78008b002a0',
    materializerPlanHash: 'a7a8df26ef90d815824234e064ea611fc926502f0eb904af81aade258df9287e',
    role: 'PROVENANCE_ONLY_NO_SELECTION_INFLUENCE', freshOutcomesAllowed: false,
  });
  assert.deepEqual(plan.budgets, { admittedProposalFamiliesPerArm: 2, candidateDescriptors: 0,
    candidateBytes: 0, repairCandidateEvaluations: 0, proposerStarts: 0, evaluatorStarts: 0,
    isolatedProcessStarts: 0, nativeFieldCalls: 0, modelCalls: 0, externalProviderSpendUsd: 0 });
  assert.deepEqual(plan.proofBoundary, { engineeringOnly: true, codexWrittenProposerEffect: true,
    inheritedStateInfluenceOnAdmission: false, inheritedStateInfluenceOnSelection: false,
    freshTaskOutcomesRead: false, evaluatorInputsRead: false, candidateDescriptorsProduced: false,
    candidateBytesProduced: false, empiricalHypothesisAdmitted: false,
    improvementCapacityMeasured: false, resourceProposalApproved: false,
    candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false });
  return { planHash: TASK_GENERAL_PROPOSER_PLAN_HASH, candidateExecutionEnabled: false };
}

export function deriveGenericOperatorSignals(prompt, files) {
  const namedSymbols = [...new Set([...prompt.body.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map(match => match[1]))];
  const promptSignals = [];
  if (/horizontal whitespace/i.test(prompt.body)) promptSignals.push('HORIZONTAL_WHITESPACE_REQUESTED');
  if (/physical line/i.test(prompt.body)) promptSignals.push('PHYSICAL_LINE_SCOPE');
  if (/(?:separate lines|adjacent-line|CRLF|blank lines)/i.test(prompt.body))
    promptSignals.push('CROSS_LINE_REPRODUCTION');
  if (namedSymbols.length) promptSignals.push('NAMED_SYMBOL_PRESENT');

  const matches = [];
  for (const file of files.filter(value => /\.(?:c?js|mjs)$/.test(value.path))) {
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const symbol of namedSymbols) {
        if (line.includes(symbol) && /\b(?:const|let|var)\b/.test(line) && /=\s*\//.test(line))
          matches.push({ path: file.path, line: index + 1, symbol, broadWhitespace: line.includes('\\s'),
            globalMultiline: /\/[a-z]*g[a-z]*m[a-z]*;?\s*$|\/[a-z]*m[a-z]*g[a-z]*;?\s*$/.test(line) });
      }
    });
  }
  const sourceSignals = [];
  if (matches.length) sourceSignals.push('NAMED_REGEX_SYMBOL');
  if (matches.some(value => value.broadWhitespace)) sourceSignals.push('BROAD_WHITESPACE_TOKEN');
  if (matches.some(value => value.globalMultiline)) sourceSignals.push('GLOBAL_MULTILINE_REGEX');
  return { namedSymbols, promptSignals, sourceSignals, matches };
}

export function assessTaskGeneralProposerAdmission({ plan, task, freezeHash, prompt, files, inputCosts }) {
  validateTaskGeneralProposerPlan(plan);
  const observations = deriveGenericOperatorSignals(prompt, files);
  const supported = plan.supportedClusters.includes(task.cluster);
  const operators = plan.operatorFamilies.map(operator => {
    const promptSatisfied = operator.requiredPromptSignals.every(value => observations.promptSignals.includes(value));
    const sourceSatisfied = operator.requiredSourceSignals.every(value => observations.sourceSignals.includes(value));
    return { id: operator.id, family: operator.family, admitted: supported && promptSatisfied && sourceSatisfied,
      origin: operator.origin, promptSatisfied, sourceSatisfied };
  });
  const admitted = operators.filter(value => value.admitted);
  const selected = admitted.slice(0, plan.budgets.admittedProposalFamiliesPerArm).map(value => value.family);
  const armAdmission = plan.controls.map(arm => ({ arm, admitted: selected.length ===
    plan.budgets.admittedProposalFamiliesPerArm, availableProposalFamilies: admitted.length,
    selectedProposalFamilies: selected, inheritedStateInfluence: false }));
  return { schema: 'ruflo.task-general-proposer-admission/v1', planHash: TASK_GENERAL_PROPOSER_PLAN_HASH,
    freezeHash, task: { id: task.id, repository: task.repository, baseCommit: task.source.baseCommit,
      cluster: task.cluster }, observations, operators, armAdmission,
    allArmsAdmitted: armAdmission.every(value => value.admitted),
    codexWrittenProposerEffect: true, inheritedStateInfluenceOnAdmission: false,
    inheritedStateInfluenceOnSelection: false, candidateDescriptorsProduced: 0,
    candidateBytesProduced: 0, costs: { ...inputCosts, repairCandidateEvaluations: 0, proposerStarts: 0,
      evaluatorStarts: 0, isolatedProcessStarts: 0, summedRepairProcessWallMs: 0, nativeFieldCalls: 0,
      modelCalls: 0, externalProviderSpendUsd: 0, totalEngineeringUsd: null },
    freshTaskOutcomesRead: false, evaluatorInputsRead: false, empiricalHypothesisAdmitted: false,
    improvementCapacityMeasured: false, candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false };
}

export function inspectTaskGeneralProposerAdmission(manifestPath, artifactRoot, planPath = PLAN_PATH) {
  const manifestRead = readBoundRegularFile(manifestPath, MAX_JSON_BYTES, 'fresh manifest');
  const manifest = JSON.parse(manifestRead.bytes);
  const admission = validateFreshTaskFreeze(manifest);
  const planRead = readBoundRegularFile(planPath, MAX_JSON_BYTES, 'task-general proposer plan');
  assert.equal(createHash('sha256').update(planRead.bytes).digest('hex'), TASK_GENERAL_PROPOSER_RAW_SHA256,
    'raw task-general plan bytes mismatch');
  const plan = JSON.parse(planRead.bytes); validateTaskGeneralProposerPlan(plan);
  const base = resolve(artifactRoot);
  return manifest.tasks.map(task => {
    const root = resolve(base, task.id); assert(inside(base, root), 'task path escaped artifact root');
    const promptRead = readBoundRegularFile(resolve(root, 'task-spec.json'), MAX_JSON_BYTES, 'task prompt');
    const archiveRead = readBoundRegularFile(resolve(root, 'source.tar.gz'), MAX_ARCHIVE_BYTES, 'source archive');
    const prompt = validatePromptBytes(task, promptRead.bytes);
    const entries = parseSourceArchive(archiveRead.bytes, task.source.baseCommit);
    const files = entries.filter(value => value.type === 'file').map(value =>
      ({ path: value.path, text: value.bytes.toString('utf8'), bytes: value.bytes.length }));
    return assessTaskGeneralProposerAdmission({ plan, task, freezeHash: admission.freezeHash, prompt, files,
      inputCosts: { manifestBytesRead: manifestRead.bytes.length, planBytesRead: planRead.bytes.length,
        promptBytesRead: promptRead.bytes.length, sourceArchiveBytesRead: archiveRead.bytes.length,
        decodedSourceBytesRead: files.reduce((sum, value) => sum + value.bytes, 0) } });
  });
}

export function executeFreshTaskProposer() {
  throw Error('FRESH_TASK_PROPOSER_EXECUTION_DISABLED: reviewed hypothesis and resources required');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, manifest, artifactRoot, plan, extra] = process.argv.slice(2);
    if (command !== 'inspect' || !manifest || !artifactRoot || !plan || extra)
      throw Error('usage: task-general-proposer-admission.mjs inspect MANIFEST ARTIFACT_ROOT PLAN');
    console.log(JSON.stringify(inspectTaskGeneralProposerAdmission(resolve(manifest), resolve(artifactRoot),
      resolve(plan)), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
