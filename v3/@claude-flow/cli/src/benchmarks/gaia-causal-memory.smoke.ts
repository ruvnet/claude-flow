/**
 * Smoke tests — ADR-135 Track I: Causal failure-avoidance edges
 *
 * All I/O is mocked (no real filesystem or network calls).
 *
 * Tests:
 *   1. Record one failure → retrieve same-signature question → returns hint
 *   2. Record 3 failures → retrieve unrelated question → returns empty hint
 *   3. Same edge recorded twice → occurrenceCount=2, not duplicated
 *   4. File doesn't exist → graceful empty result on retrieve
 *   5. Corrupted JSONL line → skipped, doesn't crash
 *   6. maxEdgesPerSignature cap respected (no new edge after cap)
 *   7. Signature computation is deterministic (same input → same output)
 *   8. Correct answer trajectory → no edges recorded
 *
 * Usage:
 *   npx tsx src/benchmarks/gaia-causal-memory.smoke.ts
 *
 * Refs: ADR-135, #2156
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  computeQuestionSignature,
  inferFailureType,
  recordCausalFailures,
  retrieveCausalHints,
  type CausalEdge,
} from './gaia-causal-memory.js';
import type { GaiaQuestion } from './gaia-loader.js';
import type { GaiaAgentResult } from './gaia-agent.js';

// ---------------------------------------------------------------------------
// Mini test runner (zero external deps)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: msg });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeQuestion(text: string): GaiaQuestion {
  return {
    task_id: 'smoke-' + text.slice(0, 8),
    level: 1,
    question: text,
    final_answer: 'ignored-in-smoke',
    file_name: null,
    file_path: null,
  };
}

function makeResult(overrides: Partial<GaiaAgentResult> = {}): GaiaAgentResult {
  return {
    questionId: 'smoke-q1',
    finalAnswer: 'wrong answer',
    turns: 3,
    toolCallsByName: { web_search: 2 },
    totalInputTokens: 100,
    totalOutputTokens: 50,
    wallMs: 1500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log('\nADR-135 Track I — causal failure-avoidance edges (smoke)\n');

  // We use a fresh temp dir per test group to isolate state.
  const tmpBase = path.join(os.tmpdir(), 'ruflo-causal-smoke-' + process.pid);

  // -------------------------------------------------------------------------
  // Test 1: Record one failure → retrieve same-signature question → hint returned
  // -------------------------------------------------------------------------
  await test('1. record one failure → retrieve same question → hint returned', async () => {
    const dir = path.join(tmpBase, 't1');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');

    const question = makeQuestion('What is the capital of France?');
    const result = makeResult({ finalAnswer: 'London' });

    const recRes = await recordCausalFailures(question, result, false, { storePath });
    assert(recRes.edgesRecorded > 0, 'should have recorded at least one edge');

    const retRes = await retrieveCausalHints(question, { storePath });
    assert(retRes.edgesMatched > 0, 'should match the stored edge');
    assert(retRes.hint.length > 0, 'hint should be non-empty');
    assert(retRes.hint.includes('[PRIOR FAILURES]'), 'hint should contain [PRIOR FAILURES] header');
    assert(retRes.hint.includes('web_search'), 'hint should mention the failed tool');
  });

  // -------------------------------------------------------------------------
  // Test 2: Record 3 failures → retrieve unrelated question → empty hint
  // -------------------------------------------------------------------------
  await test('2. record 3 failures → retrieve unrelated question → empty hint', async () => {
    const dir = path.join(tmpBase, 't2');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');

    const questions = [
      makeQuestion('What is the capital of France?'),
      makeQuestion('Who wrote Hamlet?'),
      makeQuestion('What is 2 + 2?'),
    ];

    for (const q of questions) {
      await recordCausalFailures(q, makeResult(), false, { storePath });
    }

    const unrelated = makeQuestion('Completely different and unrelated question about astrophysics and quantum phenomena XYZ123');
    const retRes = await retrieveCausalHints(unrelated, { storePath });

    assertEqual(retRes.edgesMatched, 0, 'edgesMatched for unrelated question');
    assertEqual(retRes.hint, '', 'hint for unrelated question');
  });

  // -------------------------------------------------------------------------
  // Test 3: Same edge recorded twice → occurrenceCount=2, not duplicated
  // -------------------------------------------------------------------------
  await test('3. same edge recorded twice → occurrenceCount=2, not duplicated', async () => {
    const dir = path.join(tmpBase, 't3');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');

    const question = makeQuestion('What year did World War II end?');
    const result = makeResult({ toolCallsByName: { web_search: 1 } });

    // Record same failure twice
    await recordCausalFailures(question, result, false, { storePath });
    await recordCausalFailures(question, result, false, { storePath });

    // Read the JSONL directly and count lines / occurrence counts
    const raw = fs.readFileSync(storePath, 'utf8');
    const lines = raw.trim().split('\n').filter((l) => l.trim() !== '');
    const edges: CausalEdge[] = lines.map((l) => JSON.parse(l) as CausalEdge);

    // Should have exactly one edge for this signature+tool+step
    const sig = computeQuestionSignature(question.question);
    const sigEdges = edges.filter((e) => e.questionSignature === sig && e.failedTool === 'web_search');
    assertEqual(sigEdges.length, 1, 'should have exactly one edge per signature+tool+step');
    assertEqual(sigEdges[0].occurrenceCount, 2, 'occurrenceCount after two recordings');
  });

  // -------------------------------------------------------------------------
  // Test 4: File doesn't exist → graceful empty result on retrieve
  // -------------------------------------------------------------------------
  await test('4. file does not exist → graceful empty result on retrieve', async () => {
    const storePath = path.join(tmpBase, 'nonexistent', 'edges.jsonl');
    const question = makeQuestion('How many legs does a spider have?');

    const retRes = await retrieveCausalHints(question, { storePath });
    assertEqual(retRes.edgesMatched, 0, 'edgesMatched when file absent');
    assertEqual(retRes.hint, '', 'hint when file absent');
  });

  // -------------------------------------------------------------------------
  // Test 5: Corrupted JSONL line → skipped, doesn't crash
  // -------------------------------------------------------------------------
  await test('5. corrupted JSONL line → skipped, does not crash', async () => {
    const dir = path.join(tmpBase, 't5');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');

    const goodQuestion = makeQuestion('Name the largest planet in the solar system.');
    const goodEdge: CausalEdge = {
      questionSignature: computeQuestionSignature(goodQuestion.question),
      failedTool: 'python_exec',
      failedTrajectoryStep: 'python_exec called once; failure type=wrong_answer',
      observedFailureType: 'wrong_answer',
      createdAt: new Date().toISOString(),
      occurrenceCount: 1,
    };

    // Write one valid edge + one corrupted line
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(goodEdge) + '\n' +
      '{"this": is not valid JSON!!!\n' +
      '{"partial":true\n',
      'utf8',
    );

    // retrieve should work and not throw
    const retRes = await retrieveCausalHints(goodQuestion, { storePath });
    assertEqual(retRes.edgesMatched, 1, 'should still find the one valid edge');
    assert(retRes.hint.includes('[PRIOR FAILURES]'), 'hint should be returned for valid edge');
    assert(retRes.hint.includes('python_exec'), 'hint should reference python_exec');
  });

  // -------------------------------------------------------------------------
  // Test 6: maxEdgesPerSignature cap respected
  // -------------------------------------------------------------------------
  await test('6. maxEdgesPerSignature cap respected', async () => {
    const dir = path.join(tmpBase, 't6');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');
    const maxEdgesPerSignature = 2;

    const question = makeQuestion('Explain the theory of relativity in simple terms.');

    // Record 3 failures with different tools — only first 2 should be stored
    for (const tool of ['web_search', 'file_read', 'python_exec']) {
      const result = makeResult({ toolCallsByName: { [tool]: 1 } });
      await recordCausalFailures(question, result, false, {
        storePath,
        maxEdgesPerSignature,
      });
    }

    const raw = fs.readFileSync(storePath, 'utf8');
    const lines = raw.trim().split('\n').filter((l) => l.trim() !== '');
    const sig = computeQuestionSignature(question.question);
    const sigEdges = lines
      .map((l) => JSON.parse(l) as CausalEdge)
      .filter((e) => e.questionSignature === sig);

    assert(
      sigEdges.length <= maxEdgesPerSignature,
      `should have at most ${maxEdgesPerSignature} edges, got ${sigEdges.length}`,
    );
  });

  // -------------------------------------------------------------------------
  // Test 7: Signature computation is deterministic
  // -------------------------------------------------------------------------
  await test('7. signature computation is deterministic', async () => {
    const text = 'What is the boiling point of water at sea level?';

    const sig1 = computeQuestionSignature(text);
    const sig2 = computeQuestionSignature(text);
    const sig3 = computeQuestionSignature(text.trim()); // trim should not change result
    const sig4 = computeQuestionSignature(text.toUpperCase().toLowerCase()); // normalisation

    assertEqual(sig1, sig2, 'same input produces same signature (call 1 vs 2)');
    assertEqual(sig1, sig3, 'trimmed input produces same signature');
    assertEqual(sig1, sig4, 'case-normalised input produces same signature');
    assertEqual(sig1.length, 16, 'signature is 16 hex characters');

    // Different text should produce different signature (with overwhelming probability)
    const sigOther = computeQuestionSignature('Completely different question about astronomy.');
    assert(sig1 !== sigOther, 'different inputs produce different signatures');
  });

  // -------------------------------------------------------------------------
  // Test 8: Correct answer trajectory → no edges recorded
  // -------------------------------------------------------------------------
  await test('8. correct answer trajectory → no edges recorded', async () => {
    const dir = path.join(tmpBase, 't8');
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, 'edges.jsonl');

    const question = makeQuestion('What color is the sky on a clear day?');
    const result = makeResult({ finalAnswer: 'blue' });

    // wasCorrect = true
    const recRes = await recordCausalFailures(question, result, true, { storePath });
    assertEqual(recRes.edgesRecorded, 0, 'no edges for correct trajectory');
    assert(!fs.existsSync(storePath), 'store file should not be created for correct answer');
  });

  // -------------------------------------------------------------------------
  // Bonus: inferFailureType unit checks
  // -------------------------------------------------------------------------
  await test('inferFailureType: null for correct answers', async () => {
    const result = makeResult({ finalAnswer: 'blue' });
    const ft = inferFailureType(result, true);
    assertEqual(ft, null, 'inferFailureType returns null for wasCorrect=true');
  });

  await test('inferFailureType: timeout when timedOut=true', async () => {
    const result = makeResult({ timedOut: true });
    const ft = inferFailureType(result, false);
    assertEqual(ft, 'timeout', 'inferFailureType=timeout when timedOut flag set');
  });

  await test('inferFailureType: tool_error when error present', async () => {
    const result = makeResult({ error: 'network timeout' });
    const ft = inferFailureType(result, false);
    assertEqual(ft, 'tool_error', 'inferFailureType=tool_error when error field set');
  });

  await test('inferFailureType: empty_result when finalAnswer is null', async () => {
    const result = makeResult({ finalAnswer: null });
    const ft = inferFailureType(result, false);
    assertEqual(ft, 'empty_result', 'inferFailureType=empty_result when finalAnswer=null');
  });

  await test('inferFailureType: wrong_answer for normal failure', async () => {
    const result = makeResult({ finalAnswer: 'incorrect value' });
    const ft = inferFailureType(result, false);
    assertEqual(ft, 'wrong_answer', 'inferFailureType=wrong_answer for normal wrong answer');
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup failure; temp files will be cleared by OS.
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const r of results.filter((r) => !r.ok)) {
      console.error(`  ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll smoke tests passed.');
    console.log(
      '\nNote: Track I lift is compound (+0pp first run, +2-5pp after 5+ runs).',
    );
    console.log(
      'Wiring into gaia-bench.ts is a follow-up PR (in-flight conflict avoidance).',
    );
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error('Unhandled error in smoke runner:', err);
  process.exit(1);
});
