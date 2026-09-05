/**
 * Smoke tests for the GAIA convergence layer (gaia-convergence.ts).
 *
 * 10 assertions covering:
 *   T1:  max_turns hit → checkConvergenceTriggers returns 'max_turns'
 *   T2:  same tool+args 3× in window → returns 'loop'
 *   T3:  120k tokens → returns 'token_overflow'
 *   T4:  forceCommit with prose-embedded answer in history → extraction succeeds
 *   T5:  forceCommit with explicit FINAL_ANSWER: X in response → returns X
 *   T6:  forceCommit on truly empty/looping conversation → returns null (graceful)
 *   T7:  argsHash deterministic — same args → same hash
 *   T8:  argsHash distinguishes — different args → different hash
 *   T9:  ConvergenceState records turn counts correctly via recordTurn
 *   T10: Anti-loop window correctly slides — only last 5 turns matter
 *
 * Refs: #2156, iter 62
 */

import assert from 'node:assert';
import {
  checkConvergenceTriggers,
  forceCommit,
  argsHash,
  createConvergenceState,
  recordTurn,
  extractFinalAnswerFromText,
  extractFromPriorMessages,
  TOKEN_OVERFLOW_THRESHOLD,
  LOOP_REPEAT_THRESHOLD,
  LOOP_WINDOW_SIZE,
} from './gaia-convergence.js';
import type { ConvergenceState } from './gaia-convergence.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  const result = fn();
  if (result && typeof (result as Promise<void>).then === 'function') {
    (result as Promise<void>)
      .then(() => {
        console.log(`  PASS  ${name}`);
        passed++;
      })
      .catch((err: unknown) => {
        console.error(`  FAIL  ${name}: ${(err as Error).message ?? err}`);
        failed++;
      });
  } else {
    try {
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`  FAIL  ${name}: ${(err as Error).message ?? err}`);
      failed++;
    }
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  FAIL  ${name}: ${(err as Error).message ?? err}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// T1: max_turns hit → returns 'max_turns'
// ---------------------------------------------------------------------------

test('T1: max_turns hit returns max_turns', () => {
  const state: ConvergenceState = {
    turnCount: 12,
    totalTokens: 1000,
    toolCalls: [],
    detectedFailureMode: null,
  };
  const result = checkConvergenceTriggers(state, 12);
  assert.strictEqual(result, 'max_turns', `Expected 'max_turns', got ${result!}`);
});

// ---------------------------------------------------------------------------
// T2: same tool+args 3× in last 5 turns → returns 'loop'
// ---------------------------------------------------------------------------

test('T2: loop detection — same tool+args 3x in window', () => {
  const hash = argsHash('web_search', { query: 'test' });
  const state: ConvergenceState = {
    turnCount: 5,
    totalTokens: 5000,
    toolCalls: [
      { name: 'web_search', argsHash: hash, turn: 1 },
      { name: 'web_search', argsHash: hash, turn: 2 },
      { name: 'web_search', argsHash: hash, turn: 3 },
    ],
    detectedFailureMode: null,
  };
  const result = checkConvergenceTriggers(state, 15);
  assert.strictEqual(result, 'loop', `Expected 'loop', got ${result!}`);
});

// ---------------------------------------------------------------------------
// T3: 120k tokens → returns 'token_overflow'
// ---------------------------------------------------------------------------

test('T3: token_overflow at threshold', () => {
  const state: ConvergenceState = {
    turnCount: 5,
    totalTokens: TOKEN_OVERFLOW_THRESHOLD,
    toolCalls: [],
    detectedFailureMode: null,
  };
  const result = checkConvergenceTriggers(state, 20);
  assert.strictEqual(result, 'token_overflow', `Expected 'token_overflow', got ${result!}`);
});

// ---------------------------------------------------------------------------
// T4: forceCommit with prose-embedded answer in prior history → extraction succeeds
// ---------------------------------------------------------------------------

await testAsync('T4: forceCommit — prose-embedded FINAL_ANSWER in prior history', async () => {
  const messages = [
    { role: 'user', content: 'What is 2+2?' },
    {
      role: 'assistant',
      content: 'Let me think about this. The answer is definitely 4. FINAL_ANSWER: 4',
    },
    { role: 'user', content: 'tool results...' },
    { role: 'assistant', content: 'I got confused. Let me recalculate.' },
  ];

  // callModel returns an empty response (simulating no new FINAL_ANSWER)
  const callModel = async () => 'I need to think more about this.';

  const result = await forceCommit(messages as Array<{ role: string; content: string | unknown }>, callModel, 'max_turns');

  assert.strictEqual(result.answer, '4', `Expected '4', got ${result.answer!}`);
  assert.strictEqual(result.usedFallback, true, 'Expected usedFallback=true for history scan');
});

// ---------------------------------------------------------------------------
// T5: forceCommit with explicit FINAL_ANSWER: X in forced response → returns X
// ---------------------------------------------------------------------------

await testAsync('T5: forceCommit — explicit FINAL_ANSWER in forced-commit response', async () => {
  const messages = [
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'I need to search for this.' },
  ];

  // callModel returns a response WITH FINAL_ANSWER
  const callModel = async () => 'Based on my knowledge, the capital is Paris. FINAL_ANSWER: Paris';

  const result = await forceCommit(messages as Array<{ role: string; content: string | unknown }>, callModel, 'max_turns');

  assert.strictEqual(result.answer, 'Paris', `Expected 'Paris', got ${result.answer!}`);
  assert.strictEqual(result.usedFallback, false, 'Expected usedFallback=false when direct extraction');
  assert.strictEqual(result.triggerMode, 'max_turns');
});

// ---------------------------------------------------------------------------
// T6: forceCommit on truly empty conversation → returns null (graceful)
// ---------------------------------------------------------------------------

await testAsync('T6: forceCommit — graceful null on empty conversation', async () => {
  const messages = [
    { role: 'user', content: 'What is something unknowable?' },
    { role: 'assistant', content: 'I have been calling tools repeatedly with no progress.' },
  ];

  // callModel returns nothing useful
  const callModel = async () => 'I cannot determine the answer to this question.';

  const result = await forceCommit(messages as Array<{ role: string; content: string | unknown }>, callModel, 'loop');

  assert.strictEqual(result.answer, null, `Expected null, got ${result.answer!}`);
  assert.strictEqual(result.triggerMode, 'loop');
});

// ---------------------------------------------------------------------------
// T7: argsHash deterministic — same args → same hash
// ---------------------------------------------------------------------------

test('T7: argsHash is deterministic', () => {
  const h1 = argsHash('web_search', { query: 'hello world', limit: 5 });
  const h2 = argsHash('web_search', { query: 'hello world', limit: 5 });
  assert.strictEqual(h1, h2, 'Same inputs must produce identical hash');
  assert.ok(h1.length === 16, `Hash should be 16 hex chars, got ${h1.length}`);
});

// ---------------------------------------------------------------------------
// T8: argsHash distinguishes — different args → different hash
// ---------------------------------------------------------------------------

test('T8: argsHash distinguishes different args', () => {
  const h1 = argsHash('web_search', { query: 'hello' });
  const h2 = argsHash('web_search', { query: 'world' });
  assert.notStrictEqual(h1, h2, 'Different args must produce different hash');

  const h3 = argsHash('calculator', { query: 'hello' });
  assert.notStrictEqual(h1, h3, 'Different tool names must produce different hash');
});

// ---------------------------------------------------------------------------
// T9: ConvergenceState records turn counts correctly via recordTurn
// ---------------------------------------------------------------------------

test('T9: recordTurn increments turnCount and totalTokens', () => {
  const state = createConvergenceState();

  assert.strictEqual(state.turnCount, 0);
  assert.strictEqual(state.totalTokens, 0);
  assert.strictEqual(state.toolCalls.length, 0);

  recordTurn(state, 1500, [
    { name: 'web_search', args: { query: 'test' } },
    { name: 'calculator', args: { expr: '2+2' } },
  ]);

  assert.strictEqual(state.turnCount, 1, `Expected turnCount=1, got ${state.turnCount}`);
  assert.strictEqual(state.totalTokens, 1500, `Expected totalTokens=1500, got ${state.totalTokens}`);
  assert.strictEqual(state.toolCalls.length, 2, `Expected 2 tool calls recorded, got ${state.toolCalls.length}`);
  assert.strictEqual(state.toolCalls[0].name, 'web_search');
  assert.strictEqual(state.toolCalls[0].turn, 1);

  recordTurn(state, 2000, []);

  assert.strictEqual(state.turnCount, 2);
  assert.strictEqual(state.totalTokens, 3500);
});

// ---------------------------------------------------------------------------
// T10: Anti-loop window correctly slides — only last LOOP_WINDOW_SIZE turns matter
// ---------------------------------------------------------------------------

test('T10: loop window slides — old calls outside window do not trigger', () => {
  const hash = argsHash('web_search', { query: 'test' });

  // 4 repeated calls followed by 5 different calls — window is last 5 only
  const oldCalls = Array.from({ length: 4 }, (_, i) => ({
    name: 'web_search', argsHash: hash, turn: i + 1,
  }));
  const recentCalls = Array.from({ length: LOOP_WINDOW_SIZE }, (_, i) => ({
    name: `tool_${i}`, argsHash: argsHash(`tool_${i}`, {}), turn: i + 5,
  }));

  const state: ConvergenceState = {
    turnCount: 9,
    totalTokens: 9000,
    toolCalls: [...oldCalls, ...recentCalls],
    detectedFailureMode: null,
  };

  const result = checkConvergenceTriggers(state, 20);
  assert.strictEqual(result, null,
    `Expected null (old calls outside window), got ${result!}`);
});

// ---------------------------------------------------------------------------
// Bonus: extractFinalAnswerFromText edge cases
// ---------------------------------------------------------------------------

test('T11 (bonus): extractFinalAnswerFromText handles multiline and trailing content', () => {
  const text = 'After much deliberation:\nFINAL_ANSWER: 42\nSome extra text';
  const result = extractFinalAnswerFromText(text);
  assert.strictEqual(result, '42', `Expected '42', got ${result!}`);
});

test('T12 (bonus): extractFromPriorMessages scans in reverse order', () => {
  const messages = [
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: 'First answer FINAL_ANSWER: wrong' },
    { role: 'user', content: 'tool results' },
    { role: 'assistant', content: 'After more research FINAL_ANSWER: correct' },
  ];
  // Should return 'correct' (last assistant message first in reverse scan)
  const result = extractFromPriorMessages(messages as Array<{ role: string; content: string | unknown }>);
  assert.strictEqual(result, 'correct', `Expected 'correct' (most recent), got ${result!}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// Wait for all async tests to settle, then print summary
setTimeout(() => {
  const total = passed + failed;
  console.log('');
  console.log('=== GAIA Convergence Layer Smoke Test ===');
  console.log(`Pass rate:  ${passed}/${total}`);
  console.log(`Status:     ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
  if (failed > 0) {
    process.exit(1);
  }
}, 200);
