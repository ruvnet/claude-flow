#!/usr/bin/env node
/** Stage only frozen source bytes for a proposer; evaluator artifacts remain parent-only. */
import { createHash } from 'node:crypto';
import { constants, chmodSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateFreshTaskFreeze } from './fresh-task-admission.mjs';
import { parseSourceArchive, validateCapsuleBytes } from './fresh-task-capsule.mjs';
import { validatePromptBytes } from './fresh-task-prompt.mjs';

const assert = (condition, reason) => { if (!condition) throw Error(reason); };
const inside = (root, path) => path.startsWith(`${root}${sep}`);
const digest = value => createHash('sha256').update(value).digest('hex');

function writeExclusive(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  try {
    writeFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o444);
}

function loadTask(manifestPath, artifactRoot, taskId) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const admission = validateFreshTaskFreeze(manifest);
  const task = manifest.tasks.find(value => value.id === taskId);
  assert(task, 'fresh task not found');
  const artifactBase = resolve(artifactRoot);
  const root = resolve(artifactBase, task.id);
  assert(inside(artifactBase, root), 'artifact path escaped root');
  const sourceArchive = readFileSync(resolve(root, 'source.tar.gz'));
  const taskPrompt = readFileSync(resolve(root, 'task-spec.json'));
  const evaluator = readFileSync(resolve(root, 'evaluator.mjs'));
  const testPlan = readFileSync(resolve(root, 'test-plan.json'));
  const inspection = validateCapsuleBytes(task, { sourceArchive, evaluator, testPlan });
  const prompt = validatePromptBytes(task, taskPrompt);
  return { admission, task, root, sourceArchive, taskPrompt, prompt, evaluator, testPlan, inspection };
}

export function prepareFreshTask({ manifestPath, artifactRoot, destinationRoot, taskId }) {
  assert(typeof taskId === 'string' && taskId.length > 0, 'task id required');
  const loaded = loadTask(resolve(manifestPath), resolve(artifactRoot), taskId);
  const workspaceRoot = resolve(destinationRoot);
  mkdirSync(workspaceRoot, { mode: 0o700 });

  const entries = parseSourceArchive(loaded.sourceArchive, loaded.task.source.baseCommit);
  const files = [];
  for (const entry of entries) {
    const target = resolve(workspaceRoot, entry.path);
    assert(inside(workspaceRoot, target), 'staged path escaped workspace');
    if (entry.type === 'directory') {
      mkdirSync(target, { mode: 0o700 });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeExclusive(target, entry.bytes);
    files.push({ path: entry.path, bytes: entry.bytes.length, sha256: digest(entry.bytes) });
  }
  for (const entry of entries.filter(value => value.type === 'directory').sort((a, b) => b.path.length - a.path.length)) {
    chmodSync(resolve(workspaceRoot, entry.path), 0o555);
  }
  chmodSync(workspaceRoot, 0o555);

  return {
    proposer: {
      schema: 'ruflo.fresh-proposer-source-stage/v1',
      taskId: loaded.task.id,
      repository: loaded.task.repository,
      baseCommit: loaded.task.source.baseCommit,
      baseTree: loaded.task.source.baseTree,
      freezeHash: loaded.admission.freezeHash,
      sourceArchiveSha256: loaded.task.source.archiveSha256,
      taskInput: {
        schema: loaded.prompt.schema,
        issueUrl: loaded.prompt.issueUrl,
        title: loaded.prompt.title,
        body: loaded.prompt.body,
        capsuleSha256: loaded.task.prompt.capsuleSha256,
      },
      workspaceRoot,
      files,
      candidateExecutionEnabled: false,
      boundedRsiEvidenceAccepted: false,
    },
    parent: {
      schema: 'ruflo.fresh-parent-evaluator-binding/v1',
      taskId: loaded.task.id,
      evaluatorPath: resolve(loaded.root, 'evaluator.mjs'),
      evaluatorSha256: loaded.task.evaluator.capsuleSha256,
      testPlanPath: resolve(loaded.root, 'test-plan.json'),
      testPlanSha256: loaded.task.evaluator.testPlanSha256,
      proposerAccess: false,
      admissionOnly: true,
      candidateExecutionEnabled: false,
      boundedRsiEvidenceAccepted: false,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [manifestPath, artifactRoot, destinationRoot, taskId, extra] = process.argv.slice(2);
    if (!manifestPath || !artifactRoot || !destinationRoot || !taskId || extra) throw Error('usage: fresh-task-stage.mjs MANIFEST ARTIFACT_ROOT DESTINATION TASK_ID');
    console.log(JSON.stringify(prepareFreshTask({ manifestPath, artifactRoot, destinationRoot, taskId }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
