import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFreshTask } from './fresh-task-stage.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(ROOT, 'fresh-task-freeze.json');
const ARTIFACTS = resolve(ROOT, 'fresh-tasks');
const TASK = 'avoid-ai-writing-291';
const EXPECTED_FILES = ['LICENSE', 'detector/patterns.js', 'detector/patterns.test.js', 'package.json'];

function staged() {
  const outer = mkdtempSync(resolve(tmpdir(), 'ruflo-fresh-stage-'));
  const destinationRoot = resolve(outer, 'proposer');
  const result = prepareFreshTask({ manifestPath: MANIFEST, artifactRoot: ARTIFACTS, destinationRoot, taskId: TASK });
  return { outer, destinationRoot, result };
}

function cleanup(value) {
  chmodSync(value.destinationRoot, 0o700);
  chmodSync(resolve(value.destinationRoot, 'detector'), 0o700);
  rmSync(value.outer, { recursive: true, force: true });
}

function files(root, prefix = '') {
  return readdirSync(resolve(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, path) : [path];
  }).sort();
}

test('a fresh proposer workspace contains exactly the frozen source files', t => {
  const value = staged(); t.after(() => cleanup(value));
  assert.deepEqual(files(value.destinationRoot), EXPECTED_FILES);
  assert.deepEqual(value.result.proposer.files.map(file => file.path).sort(), EXPECTED_FILES);
});

test('staged files and directories are read only', t => {
  const value = staged(); t.after(() => cleanup(value));
  for (const path of EXPECTED_FILES) assert.equal(statSync(resolve(value.destinationRoot, path)).mode & 0o777, 0o444);
  assert.equal(statSync(value.destinationRoot).mode & 0o777, 0o555);
  assert.equal(statSync(resolve(value.destinationRoot, 'detector')).mode & 0o777, 0o555);
});

test('proposer receipt contains no parent evaluator identities or paths', t => {
  const value = staged(); t.after(() => cleanup(value));
  const proposer = JSON.stringify(value.result.proposer);
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')).tasks[0];
  assert.doesNotMatch(proposer, /evaluator|test-plan|parent-only/i);
  assert.ok(!proposer.includes(manifest.evaluator.capsuleSha256));
  assert.ok(!proposer.includes(manifest.evaluator.testPlanSha256));
  assert.ok(!proposer.includes(resolve(ARTIFACTS, TASK)));
});

test('proposer receipt includes the exact public task statement', t => {
  const value = staged(); t.after(() => cleanup(value));
  const prompt = JSON.parse(readFileSync(resolve(ARTIFACTS, TASK, 'task-spec.json')));
  assert.equal(value.result.proposer.taskInput.issueUrl, prompt.issueUrl);
  assert.equal(value.result.proposer.taskInput.title, prompt.title);
  assert.equal(value.result.proposer.taskInput.body, prompt.body);
  assert.match(value.result.proposer.taskInput.capsuleSha256, /^[a-f0-9]{64}$/);
  assert.ok(!files(value.destinationRoot).includes('task-spec.json'));
});

test('parent binding keeps both evaluator artifacts inaccessible to proposer', t => {
  const value = staged(); t.after(() => cleanup(value));
  assert.equal(value.result.parent.proposerAccess, false);
  assert.equal(value.result.parent.admissionOnly, true);
  assert.match(value.result.parent.evaluatorPath, /evaluator\.mjs$/);
  assert.match(value.result.parent.testPlanPath, /test-plan\.json$/);
  assert.ok(!files(value.destinationRoot).some(path => /evaluator|test-plan/i.test(path)));
});

test('source receipt binds all staged bytes', t => {
  const value = staged(); t.after(() => cleanup(value));
  for (const file of value.result.proposer.files) {
    const bytes = readFileSync(resolve(value.destinationRoot, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.equal(value.result.proposer.files.length, 4);
});

test('destination reuse is rejected without changing its contents', () => {
  const outer = mkdtempSync(resolve(tmpdir(), 'ruflo-fresh-stage-'));
  try {
    assert.throws(() => prepareFreshTask({ manifestPath: MANIFEST, artifactRoot: ARTIFACTS, destinationRoot: outer, taskId: TASK }), /EEXIST/);
    assert.deepEqual(readdirSync(outer), []);
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test('unknown tasks are rejected before a workspace is created', () => {
  const outer = mkdtempSync(resolve(tmpdir(), 'ruflo-fresh-stage-'));
  const destinationRoot = resolve(outer, 'proposer');
  try {
    assert.throws(() => prepareFreshTask({ manifestPath: MANIFEST, artifactRoot: ARTIFACTS, destinationRoot, taskId: 'not-frozen' }), /fresh task not found/);
    assert.throws(() => statSync(destinationRoot), /ENOENT/);
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test('staging cannot enable candidate execution or RSI acceptance', t => {
  const value = staged(); t.after(() => cleanup(value));
  for (const surface of [value.result.proposer, value.result.parent]) {
    assert.equal(surface.candidateExecutionEnabled, false);
    assert.equal(surface.boundedRsiEvidenceAccepted, false);
  }
});
