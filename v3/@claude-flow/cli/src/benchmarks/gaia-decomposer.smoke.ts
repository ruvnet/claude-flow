/**
 * Smoke tests for gaia-decomposer.ts (ADR-135 Track E)
 *
 * All HTTP calls are mocked — no live API calls, no cost.
 * Covers 7 assertions:
 *  1. Atomic question → decomposed=false, single sub-question = original
 *  2. 3-step question → decomposed=true, 3 sub-questions in dependency order
 *  3. Malformed JSON response → fallback to atomic (graceful degradation)
 *  4. API error → fallback to atomic (graceful degradation)
 *  5. synthesizeFromSubAnswers — atomic question returns sub-answer directly (no API call)
 *  6. synthesizeFromSubAnswers — valid JSON response → finalAnswer + reasoning
 *  7. synthesizeFromSubAnswers — malformed JSON → fallback to last sub-answer
 *
 * Run with:
 *   npx tsx src/benchmarks/gaia-decomposer.smoke.ts
 *
 * Expected cost: $0 (all mocked).
 */

import { decomposeQuestion, synthesizeFromSubAnswers, DecomposedQuestion } from './gaia-decomposer.js';

// ---------------------------------------------------------------------------
// Minimal fetch mock
// ---------------------------------------------------------------------------

type MockFetchResponder = (url: string, init: RequestInit) => {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

function installFetchMock(responder: MockFetchResponder): void {
  (globalThis as unknown as Record<string, unknown>).fetch = (
    url: unknown,
    init: unknown,
  ) => {
    const r = responder(url as string, init as RequestInit);
    return Promise.resolve(r);
  };
}

function mockSuccessResponse(jsonBody: unknown): ReturnType<MockFetchResponder> {
  const bodyStr = JSON.stringify(jsonBody);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(jsonBody),
  };
}

function mockErrorResponse(status: number): ReturnType<MockFetchResponder> {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(`HTTP ${status} error`),
    json: () => Promise.reject(new Error('error response has no JSON')),
  };
}

/** Build a minimal Anthropic Messages API response shape. */
function anthropicTextResponse(text: string, inputTokens = 100, outputTokens = 50): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';

let failures = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ${PASS}  ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL}  ${label}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

async function runSmoke(): Promise<void> {
  console.log('\n=== gaia-decomposer smoke (mocked, $0) ===\n');

  // Set a fake API key so resolveApiKey() doesn't throw
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Atomic question → decomposed=false, single sub-question
  // ─────────────────────────────────────────────────────────────────────────
  console.log('-- Test 1: Atomic question --');
  {
    const atomicPayload = {
      decomposed: false,
      subQuestions: ['What year was the Eiffel Tower built?'],
      synthesisHint: 'Use directly.',
    };
    installFetchMock(() => mockSuccessResponse(anthropicTextResponse(JSON.stringify(atomicPayload))));

    const result = await decomposeQuestion('What year was the Eiffel Tower built?');

    check('decomposed=false for atomic question', result.decomposed === false);
    check('single sub-question equals original', result.subQuestions.length === 1 && result.subQuestions[0] === 'What year was the Eiffel Tower built?');
    check('cost > 0 (Haiku tokens consumed)', result.cost > 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: 3-step complex question → decomposed=true, 3 sub-questions in order
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 2: 3-step complex question --');
  {
    const complexPayload = {
      decomposed: true,
      subQuestions: [
        'What year was the Eiffel Tower built?',
        'What decade contains the year 1889?',
        'Who directed the highest-grossing film of the 1880s?',
      ],
      synthesisHint: 'The answer to sub-question 3 is the final answer.',
    };
    installFetchMock(() => mockSuccessResponse(anthropicTextResponse(JSON.stringify(complexPayload))));

    const question = 'Who directed the highest-grossing film of the decade the Eiffel Tower was built?';
    const result = await decomposeQuestion(question);

    check('decomposed=true for 3-step question', result.decomposed === true);
    check('3 sub-questions returned', result.subQuestions.length === 3);
    check('first sub-question asks about Eiffel Tower year', result.subQuestions[0].toLowerCase().includes('eiffel tower'));
    check('synthesisHint is non-empty', result.synthesisHint.length > 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Malformed JSON response → fallback to atomic
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 3: Malformed JSON fallback --');
  {
    installFetchMock(() =>
      mockSuccessResponse(anthropicTextResponse('This is not JSON at all { broken')),
    );

    const question = 'What is the capital of France?';
    const result = await decomposeQuestion(question);

    check('malformed JSON → decomposed=false', result.decomposed === false);
    check('malformed JSON → sub-question is original', result.subQuestions[0] === question);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: API error → fallback to atomic
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 4: API error fallback --');
  {
    installFetchMock(() => mockErrorResponse(500));

    const question = 'How many planets are in the solar system?';
    const result = await decomposeQuestion(question);

    check('API error → decomposed=false', result.decomposed === false);
    check('API error → sub-question is original', result.subQuestions[0] === question);
    check('API error → cost=0', result.cost === 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: synthesizeFromSubAnswers — atomic question (decomposed=false)
  //         returns sub-answer directly WITHOUT an API call
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 5: synthesize — atomic passthrough (no API call) --');
  {
    // Install a fetch mock that throws if called — should NOT be called
    let fetchCalled = false;
    installFetchMock(() => {
      fetchCalled = true;
      return mockSuccessResponse({ finalAnswer: 'unexpected', reasoning: 'should not reach here' });
    });

    const atomicDecomposed: DecomposedQuestion = {
      originalQuestion: 'What year was the Eiffel Tower built?',
      subQuestions: ['What year was the Eiffel Tower built?'],
      synthesisHint: 'Use directly.',
      decomposed: false,
      cost: 0,
    };

    const result = await synthesizeFromSubAnswers(atomicDecomposed, ['1889']);

    check('atomic synthesize returns sub-answer directly', result.finalAnswer === '1889');
    check('atomic synthesize has cost=0', result.cost === 0);
    check('atomic synthesize did NOT call API', fetchCalled === false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: synthesizeFromSubAnswers — valid JSON → finalAnswer + reasoning
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 6: synthesize — valid JSON response --');
  {
    const synthPayload = {
      finalAnswer: 'Georges Méliès',
      reasoning: 'The highest-grossing film of the 1880s was X. Its director was Georges Méliès.',
    };
    installFetchMock(() => mockSuccessResponse(anthropicTextResponse(JSON.stringify(synthPayload))));

    const decomposed: DecomposedQuestion = {
      originalQuestion: 'Who directed the highest-grossing film of the decade the Eiffel Tower was built?',
      subQuestions: [
        'What year was the Eiffel Tower built?',
        'What decade contains 1889?',
        'Who directed the highest-grossing film of the 1880s?',
      ],
      synthesisHint: 'The director from sub-question 3 is the answer.',
      decomposed: true,
      cost: 0.0003,
    };

    const result = await synthesizeFromSubAnswers(
      decomposed,
      ['1889', '1880s', 'Georges Méliès'],
    );

    check('synthesize returns correct finalAnswer', result.finalAnswer === 'Georges Méliès');
    check('synthesize reasoning is non-empty', result.reasoning.length > 0);
    check('synthesize cost > 0 (Sonnet tokens consumed)', result.cost > 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7: synthesizeFromSubAnswers — malformed JSON → fallback to last sub-answer
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n-- Test 7: synthesize — malformed JSON fallback --');
  {
    installFetchMock(() =>
      mockSuccessResponse(anthropicTextResponse('{ bad json here ]]}')),
    );

    const decomposed: DecomposedQuestion = {
      originalQuestion: 'How many people live in Tokyo?',
      subQuestions: [
        'What is the population of Tokyo metropolitan area?',
        'What is the population of Tokyo proper?',
      ],
      synthesisHint: 'Use the Tokyo proper figure.',
      decomposed: true,
      cost: 0.0003,
    };

    const result = await synthesizeFromSubAnswers(
      decomposed,
      ['37.4 million (metropolitan)', '13.96 million (proper)'],
    );

    check('malformed JSON fallback → returns last sub-answer', result.finalAnswer === '13.96 million (proper)');
    check('malformed JSON fallback → reasoning mentions parse error', result.reasoning.toLowerCase().includes('parse error'));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  const total = passed + failures;
  console.log(`\n=== smoke ${failures === 0 ? 'PASSED' : `FAILED (${failures}/${total} assertion(s))`} — ${passed}/${total} passed ===\n`);

  if (failures > 0) process.exit(1);
}

// Run when executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('gaia-decomposer.smoke.ts') ||
  process.argv[1].endsWith('gaia-decomposer.smoke.js')
);
if (isMain) {
  runSmoke().catch((err) => {
    console.error('Smoke failed with exception:', err);
    process.exit(1);
  });
}

export { runSmoke };
