import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFreshTaskCapsules, parseSourceTar, validateCapsuleBytes } from './fresh-task-capsule.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(ROOT, 'fresh-task-freeze.json');
const ARTIFACTS = resolve(ROOT, 'fresh-tasks');
const manifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));
const bytes = () => {
  const task = manifest().tasks[0], root = resolve(ARTIFACTS, task.id);
  return {
    task,
    sourceArchive: readFileSync(resolve(root, 'source.tar.gz')),
    evaluator: readFileSync(resolve(root, 'evaluator.mjs')),
    testPlan: readFileSync(resolve(root, 'test-plan.json')),
  };
};
const rawTar = () => gunzipSync(bytes().sourceArchive);
const rewriteChecksum = (tar, offset) => {
  tar.fill(32, offset + 148, offset + 156);
  const sum = tar.subarray(offset, offset + 512).reduce((total, byte) => total + byte, 0);
  tar.write(`${sum.toString(8).padStart(6, '0')}\0 `, offset + 148, 8, 'ascii');
};

test('the first real fresh development task has complete bound capsules', () => {
  const result = inspectFreshTaskCapsules(MANIFEST, ARTIFACTS);
  assert.equal(result.freshTaskCount, 1);
  assert.equal(result.capsules[0].taskId, 'avoid-ai-writing-291');
  assert.equal(result.capsules[0].archiveEntries, 5);
  assert.equal(result.capsules[0].evaluatorCases, 4);
  assert.equal(result.candidateExecutionEnabled, false);
});

test('a changed source archive fails its frozen digest', () => {
  const value = bytes();
  value.sourceArchive = Buffer.from(value.sourceArchive);
  value.sourceArchive[100] ^= 1;
  assert.throws(() => validateCapsuleBytes(value.task, value), /source archive digest/);
});

test('a changed evaluator fails its frozen digest', () => {
  const value = bytes();
  value.evaluator = Buffer.concat([value.evaluator.subarray(0, -1), Buffer.from('x')]);
  assert.throws(() => validateCapsuleBytes(value.task, value), /evaluator capsule digest/);
});

test('a changed test plan fails before its assertions can change', () => {
  const value = bytes();
  value.testPlan = Buffer.concat([value.testPlan.subarray(0, -2), Buffer.from('\n}\n')]);
  assert.throws(() => validateCapsuleBytes(value.task, value), /test plan digest/);
});

test('declared byte counts bind both source and evaluator', () => {
  const value = bytes(), sourceTask = structuredClone(value.task), evaluatorTask = structuredClone(value.task);
  sourceTask.source.archiveBytes++;
  evaluatorTask.evaluator.capsuleBytes++;
  assert.throws(() => validateCapsuleBytes(sourceTask, value), /source archive byte count/);
  assert.throws(() => validateCapsuleBytes(evaluatorTask, value), /evaluator capsule byte count/);
});

test('capsule inspection never enables execution or RSI acceptance', () => {
  const result = inspectFreshTaskCapsules(MANIFEST, ARTIFACTS);
  assert.equal(result.candidateExecutionEnabled, false);
  assert.equal(result.boundedRsiEvidenceAccepted, false);
});

test('tar paths cannot escape the future proposer workspace', () => {
  const tar = rawTar(), licenseHeader = 1024;
  tar.fill(0, licenseHeader, licenseHeader + 100);
  tar.write('../LICENSE', licenseHeader, 'utf8');
  rewriteChecksum(tar, licenseHeader);
  assert.throws(() => parseSourceTar(tar), /unsafe tar path/);
});

test('links and other non-source tar entry types are rejected', () => {
  const tar = rawTar(), licenseHeader = 1024;
  tar[licenseHeader + 156] = '2'.charCodeAt(0);
  rewriteChecksum(tar, licenseHeader);
  assert.throws(() => parseSourceTar(tar), /tar entry type/);
});

test('PAX metadata binds the archive to the frozen base commit', () => {
  const value = bytes();
  assert.throws(() => parseSourceTar(rawTar(), '0'.repeat(40)), /source archive commit metadata/);
  assert.equal(parseSourceTar(rawTar(), value.task.source.baseCommit).length, 5);
});
