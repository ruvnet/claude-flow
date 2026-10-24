import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepairTestCoverage, auditRepositoryCoverage, executableRepairReferences } from './ci-coverage.mjs';

const prefix = 'v3/@claude-flow/cli/scripts/rsi/repair/';

test('every repository repair test has one executable workflow reference', () => {
  const result = auditRepositoryCoverage();
  assert(result.testFiles > 0);
  assert.equal(result.executableReferences, result.testFiles);
});

test('missing repair tests fail closed', () => {
  assert.throws(() => auditRepairTestCoverage(['a.test.mjs', 'b.test.mjs'], ['a.test.mjs']),
    /missing from executable workflow: b\.test\.mjs/);
});

test('duplicate repair test references fail closed', () => {
  assert.throws(() => auditRepairTestCoverage(['a.test.mjs'], ['a.test.mjs', 'a.test.mjs']),
    /referenced more than once: a\.test\.mjs/);
});

test('comments and non-executable YAML text do not count as coverage', () => {
  const text = '# run: node --test ' + prefix + 'comment.test.mjs\n' +
    'description: ' + prefix + 'description.test.mjs\n' +
    'run: node --test ' + prefix + 'real.test.mjs';
  assert.deepEqual(executableRepairReferences(text), ['real.test.mjs']);
});

test('one command may explicitly execute multiple repair tests', () => {
  const text = '  run: node --test --test-isolation=none ' + prefix + 'a.test.mjs ' + prefix + 'b.test.mjs';
  assert.deepEqual(executableRepairReferences(text), ['a.test.mjs', 'b.test.mjs']);
  assert.deepEqual(auditRepairTestCoverage(['a.test.mjs', 'b.test.mjs'], ['a.test.mjs', 'b.test.mjs']),
    { testFiles: 2, executableReferences: 2, missing: [], duplicates: [] });
});
