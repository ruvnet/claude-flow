#!/usr/bin/env node
/** Parent-only evaluator for conorbronsdon/avoid-ai-writing issue 291. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const sourceRoot = process.argv[2];
if (!sourceRoot || process.argv.length !== 3) {
  console.error('usage: evaluator.mjs SOURCE_ROOT');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const detector = require(resolve(sourceRoot, 'detector/patterns.js'));
const body = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
const hits = text => detector.analyzeText(text).issues.filter(issue => issue.type === 'title-case-header');

const cases = [
  ['blank-line-lf', `## Benefits\n\nOf Good Writing\n\n${body}`, 0],
  ['adjacent-line-lf', `## Benefits\nOf Good Writing\n\n${body}`, 0],
  ['blank-line-crlf', `## Benefits\r\n\r\nOf Good Writing\r\n\r\n${body}`, 0],
  ['same-line-positive-control', `## Benefits Of Good Writing\n\n${body}`, 1],
];

const outcomes = [];
for (const [id, input, expected] of cases) {
  const actual = hits(input).length;
  outcomes.push({ id, expected, actual, pass: actual === expected });
}

const result = {
  schema: 'ruflo.parent-only-evaluator-result/v1',
  taskId: 'avoid-ai-writing-291',
  tests: outcomes.length,
  passed: outcomes.filter(outcome => outcome.pass).length,
  failed: outcomes.filter(outcome => !outcome.pass).length,
  outcomes,
};
console.log(JSON.stringify(result, null, 2));
assert.equal(result.failed, 0, `${result.failed} parent-only evaluator cases failed`);
