/**
 * gaia-audit.mjs tests — Node's built-in test runner (no extra deps).
 * Run with: node --test scripts/gaia-audit.test.mjs
 *
 * Every pure check is exercised against a fixture that TRIGGERS its vector
 * and against the clean fixture that must pass. The CLI is driven end-to-end
 * on both fixture sets (clean → exit 0, dirty → exit 1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normaliseAnswer,
  parseResults,
  parseTrajectories,
  checkAnswerLeakage,
  checkNoWork,
  checkOracleLeakage,
  checkGraderIsolation,
  checkNormalizationCollision,
  checkVotingDisclosure,
  checkSplitIntegrity,
  runAudit,
  AUDITED_AT_PLACEHOLDER,
} from './gaia-audit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'gaia-audit.mjs');
const FIX = join(__dirname, 'fixtures', 'gaia-audit');

const clean = () => ({
  results: parseResults(readFileSync(join(FIX, 'clean-results.json'), 'utf8')),
  trajById: parseTrajectories(readFileSync(join(FIX, 'clean-trajectories.jsonl'), 'utf8')),
  metadata: JSON.parse(readFileSync(join(FIX, 'clean-metadata.json'), 'utf8')),
});
const dirty = () => ({
  results: parseResults(readFileSync(join(FIX, 'dirty-results.json'), 'utf8')),
  trajById: parseTrajectories(readFileSync(join(FIX, 'dirty-trajectories.jsonl'), 'utf8')),
  metadata: JSON.parse(readFileSync(join(FIX, 'dirty-metadata.json'), 'utf8')),
});

// ── normalisation (must mirror gaia-judge.ts) ──────────────────────────────
test('normaliseAnswer mirrors gaia-judge', () => {
  assert.equal(normaliseAnswer(' "Paris" '), 'paris');
  assert.equal(normaliseAnswer('hello  world'), 'hello world');
  assert.equal(normaliseAnswer(null), '');
  assert.equal(normaliseAnswer(346), '346');
});

// ── parsing: BenchRunOutput, array, and JSONL forms ────────────────────────
test('parseResults handles BenchRunOutput, array, and jsonl', () => {
  assert.equal(parseResults(readFileSync(join(FIX, 'clean-results.json'), 'utf8')).length, 3);
  const jsonl = '{"task_id":"a","correct":true,"answer":"1","expected_output":"1"}\n{"task_id":"b","correct":false,"answer":null,"expected_output":"2"}';
  assert.equal(parseResults(jsonl).length, 2);
  const arr = JSON.stringify([{ results: [{ task_id: 'x', correct: true, answer: '1', expected_output: '1' }] }]);
  assert.equal(parseResults(arr).length, 1);
});

// ── AUD-1 answer-leakage ───────────────────────────────────────────────────
test('answer-leakage: clean passes', () => {
  const { results, trajById } = clean();
  assert.equal(checkAnswerLeakage(results, trajById).status, 'pass');
});
test('answer-leakage: dirty fails with answer-DB signature', () => {
  const { results, trajById } = dirty();
  const c = checkAnswerLeakage(results, trajById);
  assert.equal(c.status, 'fail');
  assert.equal(c.severity, 'critical');
  assert.ok(c.evidence.some((e) => e.includes('fx-dirty-leak') && e.includes('ANSWER-DB SIGNATURE')));
});
test('answer-leakage: skips (harness gap) when no tool_result outputs recorded', () => {
  const results = [{ task_id: 't', correct: true, answer: 'x', expected_output: 'x' }];
  const c = checkAnswerLeakage(results, new Map());
  assert.equal(c.status, 'skip');
  assert.match(c.harness_gap, /tool_result/);
});

// ── AUD-2 no-work ──────────────────────────────────────────────────────────
test('no-work: clean passes', () => {
  const { results, trajById } = clean();
  assert.equal(checkNoWork(results, trajById).status, 'pass');
});
test('no-work: dirty fails on turns=0/outputTokens=0', () => {
  const { results, trajById } = dirty();
  const c = checkNoWork(results, trajById);
  assert.equal(c.status, 'fail');
  assert.ok(c.evidence.some((e) => e.includes('fx-dirty-nowork') && e.includes('turns=0')));
});

// ── AUD-3 oracle-leakage ───────────────────────────────────────────────────
test('oracle-leakage: clean passes', () => {
  const { results, trajById } = clean();
  assert.equal(checkOracleLeakage(results, trajById).status, 'pass');
});
test('oracle-leakage: dirty fails when gold in visible prompt', () => {
  const { results, trajById } = dirty();
  const c = checkOracleLeakage(results, trajById);
  assert.equal(c.status, 'fail');
  assert.ok(c.evidence.some((e) => e.includes('fx-dirty-oracle')));
});
test('oracle-leakage: skips when no prompt recorded', () => {
  const results = [{ task_id: 't', correct: true, answer: 'paris', expected_output: 'paris' }];
  assert.equal(checkOracleLeakage(results, new Map()).status, 'skip');
});

// ── AUD-4 grader-isolation ─────────────────────────────────────────────────
test('grader-isolation: clean passes', () => {
  const { results, trajById } = clean();
  assert.equal(checkGraderIsolation(results, trajById).status, 'pass');
});
test('grader-isolation: dirty fails on judge/witness-targeting write tool', () => {
  const { results, trajById } = dirty();
  const c = checkGraderIsolation(results, trajById);
  assert.equal(c.status, 'fail');
  assert.ok(c.evidence.some((e) => e.includes('fx-dirty-grader') && e.includes('WRITE-CAPABLE')));
});

// ── AUD-5 normalization-collision ──────────────────────────────────────────
test('normalization-collision: clean passes', () => {
  assert.equal(checkNormalizationCollision(clean().results).status, 'pass');
});
test('normalization-collision: dirty flags generic "yes" against specific gold', () => {
  const c = checkNormalizationCollision(dirty().results);
  assert.equal(c.status, 'fail');
  assert.equal(c.severity, 'warn');
  assert.ok(c.evidence.some((e) => e.includes('fx-dirty-collision')));
});
test('normalization-collision: flags strict-substring credit', () => {
  const c = checkNormalizationCollision([
    { task_id: 's', correct: true, answer: 'Gaudi', expected_output: 'Antoni Gaudi' },
  ]);
  assert.equal(c.status, 'fail');
  assert.ok(c.evidence.some((e) => e.includes('strict substring')));
});

// ── AUD-6 voting-disclosure ────────────────────────────────────────────────
test('voting-disclosure: clean metadata (voting_attempts present) passes', () => {
  assert.equal(checkVotingDisclosure(clean().metadata).status, 'pass');
});
test('voting-disclosure: dirty metadata (no voting field) fails', () => {
  assert.equal(checkVotingDisclosure(dirty().metadata).status, 'fail');
});
test('voting-disclosure: no metadata skips', () => {
  assert.equal(checkVotingDisclosure(null).status, 'skip');
});

// ── AUD-7 split-integrity ──────────────────────────────────────────────────
test('split-integrity: clean (split=validation disclosed) passes as info', () => {
  const c = checkSplitIntegrity(clean().metadata);
  assert.equal(c.status, 'pass');
  assert.equal(c.severity, 'info');
});
test('split-integrity: dirty (undisclosed split) fails', () => {
  assert.equal(checkSplitIntegrity(dirty().metadata).status, 'fail');
});

// ── report assembly + determinism ──────────────────────────────────────────
test('runAudit: clean is clean and strict_clean', () => {
  const { results, trajById, metadata } = clean();
  const rep = runAudit({ results, trajById, metadata });
  assert.equal(rep.attestation.clean, true);
  assert.equal(rep.attestation.strict_clean, true);
  assert.equal(rep.attestation.critical_failures.length, 0);
});
test('runAudit: dirty fails all 4 CRITICAL vectors', () => {
  const { results, trajById, metadata } = dirty();
  const rep = runAudit({ results, trajById, metadata });
  assert.equal(rep.attestation.clean, false);
  assert.deepEqual(
    [...rep.attestation.critical_failures].sort(),
    ['answer-leakage', 'grader-isolation', 'no-work-pass', 'oracle-leakage'],
  );
  assert.ok(rep.attestation.warn_failures.includes('normalization-collision'));
});
test('runAudit: deterministic body (placeholder timestamp, stable JSON)', () => {
  const { results, trajById, metadata } = dirty();
  const a = runAudit({ results, trajById, metadata });
  const b = runAudit({ results, trajById, metadata });
  assert.equal(a.audited_at, AUDITED_AT_PLACEHOLDER);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ── CLI end-to-end ─────────────────────────────────────────────────────────
function runCli(args) {
  return spawnSync('node', [AUDIT, ...args], { encoding: 'utf8' });
}
test('CLI: clean fixture → exit 0', () => {
  const r = runCli([
    '--results', join(FIX, 'clean-results.json'),
    '--trajectories', join(FIX, 'clean-trajectories.jsonl'),
    '--metadata', join(FIX, 'clean-metadata.json'),
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /clean=true/);
});
test('CLI: dirty fixture → exit 1 with CRITICAL findings', () => {
  const r = runCli([
    '--results', join(FIX, 'dirty-results.json'),
    '--trajectories', join(FIX, 'dirty-trajectories.jsonl'),
    '--metadata', join(FIX, 'dirty-metadata.json'),
  ]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /clean=false/);
  assert.match(r.stdout, /CRITICAL failures: /);
});
test('CLI: missing results file → exit 2 usage error', () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(['--results', join(FIX, 'does-not-exist.json')]).status, 2);
});
test('CLI: clean fixture with --strict still exit 0 (no warn failures)', () => {
  const r = runCli([
    '--results', join(FIX, 'clean-results.json'),
    '--trajectories', join(FIX, 'clean-trajectories.jsonl'),
    '--metadata', join(FIX, 'clean-metadata.json'),
    '--strict',
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
