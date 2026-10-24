#!/usr/bin/env node
/** Prove whether the current training-only improver can materialize a frozen fresh task. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundRegularFile } from './bounded-file.mjs';
import { validateFreshTaskFreeze } from './fresh-task-admission.mjs';
import { loadImproverPlan, PLAN_HASH, validateImproverPlan } from './inherited-improver.mjs';
import {
  CONTROL_MATERIALIZER_PLAN_HASH,
  loadControlMaterializerPlan,
  validateControlMaterializerPlan,
} from './control-materializer.mjs';

const MAX_MANIFEST_BYTES = 1024 * 1024;

function sameBinding(task, training) {
  return task.id === training.id && task.repository === training.repository &&
    task.source.baseCommit === training.baseCommit;
}

export function assessFreshImproverAdmission(freshManifest, improverPlan, materializerPlan) {
  const fresh = validateFreshTaskFreeze(freshManifest);
  const improver = validateImproverPlan(improverPlan);
  const materializer = validateControlMaterializerPlan(materializerPlan);
  assert.deepEqual(improverPlan.controls, materializerPlan.arms, 'control arm mismatch');
  assert.equal(materializerPlan.improverPlanSemanticHash, improver.planHash,
    'materializer improver binding');
  assert.deepEqual({
    id: materializerPlan.task.id,
    repository: materializerPlan.task.repository,
    baseCommit: materializerPlan.task.baseCommit,
  }, {
    id: improverPlan.task.id,
    repository: improverPlan.task.repository,
    baseCommit: improverPlan.task.baseCommit,
  }, 'training task binding mismatch');

  const trainingBinding = {
    taskId: materializerPlan.task.id,
    repository: materializerPlan.task.repository,
    baseCommit: materializerPlan.task.baseCommit,
    sourcePath: materializerPlan.task.path,
    partition: materializerPlan.task.partition,
    exposure: materializerPlan.task.exposure,
  };
  const tasks = freshManifest.tasks.map(task => {
    const bindingMatches = sameBinding(task, materializerPlan.task);
    // The only current materializer reads its exact p-limit fixture and has no
    // API for caller-supplied fresh source. A different task binding therefore
    // has zero admitted proposal families, for every arm equally.
    const admittedFamilies = bindingMatches ? materializerPlan.rules.map(rule => rule.family) : [];
    const armAdmission = materializerPlan.arms.map(arm => ({
      arm,
      admitted: bindingMatches,
      admittedProposalFamilies: admittedFamilies.length,
      blocker: bindingMatches ? null : 'TRAINING_ONLY_MATERIALIZER_TASK_BINDING_MISMATCH',
    }));
    return {
      taskId: task.id,
      repository: task.repository,
      baseCommit: task.source.baseCommit,
      cluster: task.cluster,
      sourceBindingMatches: bindingMatches,
      admittedProposalFamilies: admittedFamilies,
      armAdmission,
    };
  });
  const allAdmitted = tasks.length > 0 && tasks.every(task => task.sourceBindingMatches);
  return {
    schema: 'ruflo.fresh-improver-admission/v1',
    freshFreezeHash: fresh.freezeHash,
    improverPlanHash: improver.planHash,
    materializerPlanHash: materializer.planHash,
    trainingBinding,
    controls: [...materializerPlan.arms],
    tasks,
    allAdmitted,
    candidateDescriptorsProduced: 0,
    candidateBytesProduced: 0,
    costs: {
      proposerStarts: 0,
      evaluatorStarts: 0,
      repairCandidateEvaluations: 0,
      isolatedProcessStarts: 0,
      summedRepairProcessWallMs: 0,
      nativeFieldCalls: 0,
      modelCalls: 0,
      externalProviderSpendUsd: 0,
      totalEngineeringUsd: null,
    },
    freshTaskOutcomesRead: false,
    empiricalHypothesisAdmitted: false,
    improvementCapacityMeasured: false,
    candidateExecutionEnabled: false,
    boundedRsiEvidenceAccepted: false,
  };
}

export function inspectFreshImproverAdmission(freshPath, improverPath, materializerPath) {
  const freshBytes = readBoundRegularFile(freshPath, MAX_MANIFEST_BYTES, 'fresh manifest').bytes;
  return assessFreshImproverAdmission(
    JSON.parse(freshBytes.toString('utf8')),
    loadImproverPlan(improverPath),
    loadControlMaterializerPlan(materializerPath),
  );
}

export function executeFreshImprover() {
  throw Error('FRESH_IMPROVER_EXECUTION_DISABLED: no materializer is admitted for the frozen fresh task');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, freshPath, improverPath, materializerPath, extra] = process.argv.slice(2);
    if (command !== 'inspect' || !freshPath || !improverPath || !materializerPath || extra)
      throw Error('usage: fresh-improver-admission.mjs inspect FRESH IMPROVER MATERIALIZER');
    const result = inspectFreshImproverAdmission(resolve(freshPath), resolve(improverPath),
      resolve(materializerPath));
    assert.equal(result.improverPlanHash, PLAN_HASH);
    assert.equal(result.materializerPlanHash, CONTROL_MATERIALIZER_PLAN_HASH);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
