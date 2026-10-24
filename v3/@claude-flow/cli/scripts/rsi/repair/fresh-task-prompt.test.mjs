import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFreshTaskPrompts, validatePromptBytes } from './fresh-task-prompt.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(ROOT, 'fresh-task-freeze.json');
const ARTIFACTS = resolve(ROOT, 'fresh-tasks');
const value = () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')), task = manifest.tasks[0];
  return { task, bytes: readFileSync(resolve(ARTIFACTS, task.id, 'task-spec.json')) };
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('the exact public issue is frozen as proposer-visible task input', () => {
  const result = inspectFreshTaskPrompts(MANIFEST, ARTIFACTS);
  assert.equal(result.prompts.length, 1);
  assert.equal(result.prompts[0].taskId, 'avoid-ai-writing-291');
  assert.equal(result.prompts[0].proposerVisible, true);
  assert.match(result.prompts[0].title, /physical line/);
});

test('changed prompt bytes fail the frozen digest', () => {
  const item = value(), changed = Buffer.from(item.bytes);
  changed[changed.length - 3] ^= 1;
  assert.throws(() => validatePromptBytes(item.task, changed), /task prompt digest/);
});

test('declared prompt size and digest are independently bound', () => {
  const item = value(), sized = structuredClone(item.task), digested = structuredClone(item.task);
  sized.prompt.capsuleBytes++;
  digested.prompt.capsuleSha256 = '0'.repeat(64);
  assert.throws(() => validatePromptBytes(sized, item.bytes), /task prompt byte count/);
  assert.throws(() => validatePromptBytes(digested, item.bytes), /task prompt digest/);
});

test('unknown task fields cannot smuggle evaluator or outcome data', () => {
  const item = value(), prompt = JSON.parse(item.bytes);
  prompt.evaluator = { hidden: false };
  const bytes = Buffer.from(JSON.stringify(prompt)), task = structuredClone(item.task);
  task.prompt.capsuleBytes = bytes.length;
  task.prompt.capsuleSha256 = sha256(bytes);
  assert.throws(() => validatePromptBytes(task, bytes), /task prompt fields/);
});

test('issue identity, state and zero-comment boundary are enforced', () => {
  const item = value();
  for (const edit of [
    prompt => { prompt.issueNumber++; },
    prompt => { prompt.state = 'closed'; },
    prompt => { prompt.comments = 1; },
  ]) {
    const prompt = JSON.parse(item.bytes); edit(prompt);
    const bytes = Buffer.from(JSON.stringify(prompt)), task = structuredClone(item.task);
    task.prompt.capsuleBytes = bytes.length;
    task.prompt.capsuleSha256 = sha256(bytes);
    assert.throws(() => validatePromptBytes(task, bytes), /task prompt issue identity|task prompt must remain pre-claim/);
  }
});

test('the prompt binds the source base and pre-proposal provenance', () => {
  const item = value(), prompt = validatePromptBytes(item.task, item.bytes);
  assert.ok(prompt.body.includes(item.task.source.baseCommit));
  assert.equal(prompt.selectedBeforeProposal, true);
  assert.equal(prompt.fixDataAcquired, false);
  assert.equal(prompt.outcomeRead, false);
});

test('prompt inspection cannot enable execution or RSI acceptance', () => {
  const result = inspectFreshTaskPrompts(MANIFEST, ARTIFACTS);
  assert.equal(result.candidateExecutionEnabled, false);
  assert.equal(result.boundedRsiEvidenceAccepted, false);
});
