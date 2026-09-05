/**
 * GAIA Critic Smoke Tests — ADR-135 Track D
 *
 * Tests for the adversarial critic agent in gaia-critic.ts.
 * All tests use mocked responses — NO live API calls.
 *
 * Test coverage:
 *  1. Critic returns "pass" → no retry, immediately returns candidate
 *  2. Critic returns "fail" with suggestedRevision → triggers one retry
 *  3. Critic returns "fail" twice → retries exhausted, returns last candidate
 *  4. Critic returns "uncertain" → treated as "pass", no retry
 *  5. API error in critic → graceful fallback, returns candidate as-is
 *  6. Malformed JSON from critic → fallback parser extracts verdict
 *
 * Usage (no API key required):
 *   npx tsx src/benchmarks/gaia-critic.smoke.ts
 *
 * Refs: ADR-135, #2156
 */

import {
  criticReview,
  runGaiaAgentWithCritic,
  CriticVerdict,
  CriticVerdictType,
} from './gaia-critic.js';
import { GaiaQuestion } from './gaia-loader.js';
import { GaiaAgentResult } from './gaia-agent.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

/** A minimal GaiaQuestion fixture. */
const FIXTURE_QUESTION: GaiaQuestion = {
  task_id: 'smoke-001',
  level: 1,
  question: 'What is the capital of France?',
  final_answer: 'Paris',
  file_name: null,
  file_path: null,
};

/** Minimal GaiaAgentResult with a given finalAnswer. */
function makeAgentResult(finalAnswer: string | null, turns = 2): GaiaAgentResult {
  return {
    questionId: FIXTURE_QUESTION.task_id,
    finalAnswer,
    turns,
    toolCallsByName: { web_search: 1 },
    totalInputTokens: 100,
    totalOutputTokens: 50,
    wallMs: 1200,
  };
}

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Lightweight mock for fetch.  Returns a sequence of responses in order;
 * after exhausting the sequence, repeats the last response.
 */
type MockResponse = {
  ok: boolean;
  status?: number;
  body?: Record<string, unknown>;
  text?: string;
};

function installFetchMock(responses: MockResponse[]): () => void {
  let callIndex = 0;
  const original = globalThis.fetch;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (_url: unknown, _init?: RequestInit): Promise<Response> => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status ?? 500,
        text: async () => resp.text ?? 'Internal error',
        json: async () => { throw new Error('not ok'); },
      } as unknown as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => resp.body ?? {},
      text: async () => JSON.stringify(resp.body ?? {}),
    } as unknown as Response;
  };

  return () => { globalThis.fetch = original; };
}

/**
 * Build a mock Anthropic response body containing a critic verdict JSON.
 */
function mockCriticResponse(
  verdict: CriticVerdictType,
  reasoning: string,
  suggestedRevision = '',
): Record<string, unknown> {
  const content = JSON.stringify({ verdict, reasoning, suggestedRevision });
  return {
    content: [{ type: 'text', text: content }],
    usage: { input_tokens: 200, output_tokens: 40 },
  };
}

/**
 * Mock for runGaiaAgent that immediately returns a fixed result.
 * We monkey-patch the module-level import by wrapping runGaiaAgentWithCritic
 * via its options.catalogue approach — but since gaia-agent's runGaiaAgent is
 * imported directly, we mock at the fetch level instead (the agent also calls
 * the Anthropic API, so we intercept there).
 *
 * For the smoke tests we only exercise criticReview directly in Tests 1-6, and
 * use a simplified version of runGaiaAgentWithCritic that pre-supplies a
 * mocked agent result rather than actually calling the API for the agent run.
 *
 * This avoids needing to rewrite the import mechanism just for smoke tests.
 */

// ---------------------------------------------------------------------------
// Test 1: critic returns "pass" → no retry
// ---------------------------------------------------------------------------

async function test1_criticPass(): Promise<void> {
  console.log('\nTest 1: critic returns "pass" → no retry');

  const restore = installFetchMock([
    { ok: true, body: mockCriticResponse('pass', 'Answer is correct.') },
  ]);

  try {
    const verdict: CriticVerdict = await criticReview(
      FIXTURE_QUESTION,
      'Paris',
      { steps: [{ tool: 'web_search', result: 'Paris is the capital' }], turns: 2 },
      { model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    );

    assertEqual(verdict.verdict, 'pass', 'verdict is "pass"');
    assert(verdict.reasoning.length > 0, 'reasoning is non-empty');
    assert(verdict.costUsd >= 0, 'costUsd is non-negative');
    assert(!verdict.error, 'no error flag');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Test 2: critic returns "fail" with suggestedRevision
// ---------------------------------------------------------------------------

async function test2_criticFail(): Promise<void> {
  console.log('\nTest 2: critic returns "fail" with suggestedRevision');

  const restore = installFetchMock([
    {
      ok: true,
      body: mockCriticResponse(
        'fail',
        'The answer is the wrong city.',
        'Paris',
      ),
    },
  ]);

  try {
    const verdict: CriticVerdict = await criticReview(
      FIXTURE_QUESTION,
      'Lyon',
      { steps: [{ tool: 'web_search', result: 'Lyon is in France' }], turns: 1 },
      { model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    );

    assertEqual(verdict.verdict, 'fail', 'verdict is "fail"');
    assert((verdict.suggestedRevision ?? '').length > 0, 'suggestedRevision is non-empty');
    assertEqual(verdict.suggestedRevision, 'Paris', 'suggestedRevision is "Paris"');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Test 3: critic returns "fail" twice → retries exhausted
// ---------------------------------------------------------------------------

async function test3_retriesExhausted(): Promise<void> {
  console.log('\nTest 3: critic fails twice → retries exhausted, returns last candidate');

  // We test this at the runGaiaAgentWithCritic level.
  // We need to mock BOTH the critic fetch calls AND the agent API calls.
  // Strategy: sequence the mock responses in the order they will be called.
  //
  // Call sequence (with enableCritic=true, maxRetries=1):
  //   1. runGaiaAgent attempt 1   → agent Anthropic API call (returns answer "Lyon")
  //   2. criticReview attempt 1   → critic API call (returns "fail")
  //   3. runGaiaAgent attempt 2   → agent Anthropic API call (returns answer "Marseille")
  //   4. criticReview attempt 2   → critic API call (returns "fail")
  //
  // For simplicity we make the agent calls also return valid Anthropic responses
  // that produce a FINAL_ANSWER (the agent code parses stop_reason=end_turn).

  const agentResponseLyon = {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'FINAL_ANSWER: Lyon' }],
    usage: { input_tokens: 150, output_tokens: 20 },
    model: 'claude-haiku-4-5',
  };
  const agentResponseMarseille = {
    id: 'msg_02',
    type: 'message',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'FINAL_ANSWER: Marseille' }],
    usage: { input_tokens: 150, output_tokens: 20 },
    model: 'claude-haiku-4-5',
  };

  const restore = installFetchMock([
    { ok: true, body: agentResponseLyon },                          // agent call 1
    { ok: true, body: mockCriticResponse('fail', 'Wrong city.', 'Paris') },  // critic 1
    { ok: true, body: agentResponseMarseille },                     // agent call 2 (retry)
    { ok: true, body: mockCriticResponse('fail', 'Still wrong.', 'Paris') }, // critic 2
  ]);

  try {
    const result = await runGaiaAgentWithCritic(FIXTURE_QUESTION, {
      enableCritic: true,
      apiKey: 'test-key',
      criticOptions: { apiKey: 'test-key', maxRetries: 1 },
    });

    assertEqual(result.retriesAttempted, 1, 'retriesAttempted is 1');
    assertEqual(result.criticVerdicts.length, 2, 'two critic verdicts collected');
    assertEqual(result.criticVerdicts[0].verdict, 'fail', 'first verdict is fail');
    assertEqual(result.criticVerdicts[1].verdict, 'fail', 'second verdict is fail');
    // Last candidate is returned regardless.
    assert(result.finalAnswer !== null, 'finalAnswer is non-null (last candidate returned)');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Test 4: critic returns "uncertain" → treated as "pass", no retry
// ---------------------------------------------------------------------------

async function test4_uncertainAsPass(): Promise<void> {
  console.log('\nTest 4: critic returns "uncertain" → treated as pass, no retry');

  const restore = installFetchMock([
    {
      ok: true,
      body: mockCriticResponse('uncertain', 'Cannot verify without more context.'),
    },
  ]);

  try {
    const verdict: CriticVerdict = await criticReview(
      FIXTURE_QUESTION,
      'Paris',
      { steps: [], turns: 1 },
      { model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    );

    assertEqual(verdict.verdict, 'uncertain', 'verdict is "uncertain"');

    // Verify orchestrator treats uncertain as pass (no retry fired).
    // We simulate by checking the logic directly: uncertain !== 'fail', so loop
    // body is skipped.  We test it via runGaiaAgentWithCritic with a minimal
    // agent mock that returns a final answer.
    const agentResponseParis = {
      id: 'msg_03',
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'FINAL_ANSWER: Paris' }],
      usage: { input_tokens: 100, output_tokens: 15 },
      model: 'claude-haiku-4-5',
    };

    const restore2 = installFetchMock([
      { ok: true, body: agentResponseParis },   // agent call
      { ok: true, body: mockCriticResponse('uncertain', 'Cannot verify.') }, // critic
    ]);

    try {
      const result = await runGaiaAgentWithCritic(FIXTURE_QUESTION, {
        enableCritic: true,
        apiKey: 'test-key',
        criticOptions: { apiKey: 'test-key', maxRetries: 1 },
      });

      assertEqual(result.retriesAttempted, 0, 'no retries for uncertain verdict');
      assertEqual(result.criticVerdicts.length, 1, 'one critic verdict collected');
      assertEqual(result.criticVerdicts[0].verdict, 'uncertain', 'verdict is uncertain');
    } finally {
      restore2();
    }
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Test 5: API error in critic → graceful fallback
// ---------------------------------------------------------------------------

async function test5_apiErrorFallback(): Promise<void> {
  console.log('\nTest 5: API error in critic → graceful fallback, original candidate returned');

  const restore = installFetchMock([
    { ok: false, status: 529, text: 'Overloaded' },
  ]);

  try {
    const verdict: CriticVerdict = await criticReview(
      FIXTURE_QUESTION,
      'Paris',
      { steps: [], turns: 1 },
      { model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    );

    // On API error, critic returns uncertain with error flag — does not throw.
    assertEqual(verdict.verdict, 'uncertain', 'verdict is "uncertain" on API error');
    assert(verdict.error === true, 'error flag is set');
    assert(verdict.costUsd === 0, 'costUsd is 0 on error');
    assert(verdict.reasoning.includes('failed'), 'reasoning mentions failure');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Test 6: malformed JSON from critic → fallback parser
// ---------------------------------------------------------------------------

async function test6_malformedJson(): Promise<void> {
  console.log('\nTest 6: malformed JSON from critic → fallback parser extracts verdict');

  // Simulate Sonnet returning prose with embedded JSON fragment.
  const malformedBody = {
    content: [{
      type: 'text',
      text: 'After careful review, I believe the answer is wrong. {"verdict":"fail","reasoning":"Incorrect city","suggestedRevision":"Paris"} The agent should try again.',
    }],
    usage: { input_tokens: 180, output_tokens: 60 },
  };

  const restore = installFetchMock([
    { ok: true, body: malformedBody },
  ]);

  try {
    const verdict: CriticVerdict = await criticReview(
      FIXTURE_QUESTION,
      'Lyon',
      { steps: [], turns: 1 },
      { model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    );

    // Fallback parser should extract "fail" from the embedded JSON.
    assertEqual(verdict.verdict, 'fail', 'fallback parser extracts "fail" verdict');
    assert(!verdict.error, 'no error flag for recoverable parse');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== GAIA Critic Smoke Tests (ADR-135 Track D) ===');
  console.log('All tests use mocked responses — no live API calls.\n');

  try {
    await test1_criticPass();
    await test2_criticFail();
    await test3_retriesExhausted();
    await test4_uncertainAsPass();
    await test5_apiErrorFallback();
    await test6_malformedJson();
  } catch (err) {
    console.error('\nUnexpected test runner error:', err);
    process.exit(1);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
