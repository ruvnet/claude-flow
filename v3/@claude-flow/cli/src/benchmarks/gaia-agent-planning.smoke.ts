/**
 * GAIA Agent — Planning Interval Smoke Tests
 *
 * Verifies that the planning-checkpoint injection logic fires at the correct
 * turns and stays silent when conditions are not met.  All tests are fully
 * mocked — no live Anthropic API calls, $0 cost.
 *
 * Test cases:
 *   1. 12-turn loop with interval=4 → replans at turns 4, 8, 12  (3 replans)
 *   2.  3-turn loop with interval=4 → NO replan (interval never hit)
 *   3. end_turn at turn 5          → NO replan injected (terminal state)
 *   4. all-tool_use 8-turn loop    → exactly floor(8/4) = 2 replans
 *   5. planningInterval=0          → disabled entirely, 0 replans
 *
 * Refs: ADR-133, ADR-135, iter 34, #2156
 */

import assert from 'node:assert/strict';
import { runGaiaAgent, PLANNING_INTERVAL, buildPlanningCheckpoint } from './gaia-agent.js';
import type { GaiaQuestion } from './gaia-loader.js';
import type { GaiaAgentOptions } from './gaia-agent.js';
import type { GaiaToolCatalogue } from './gaia-tools/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal GAIA question fixture. */
const FAKE_QUESTION: GaiaQuestion = {
  task_id: 'smoke-planning-01',
  question: 'What is 2 + 2?',
  final_answer: '4',
  level: 1,
  file_name: null,
  file_path: null,
};

/** A trivial tool catalogue with one no-op tool. */
const NOOP_CATALOGUE: GaiaToolCatalogue = [
  {
    name: 'noop',
    definition: {
      name: 'noop',
      description: 'Does nothing',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    execute: async () => 'ok',
  },
];

// ---------------------------------------------------------------------------
// Mock Anthropic API call factory
// ---------------------------------------------------------------------------

/**
 * Build a mock `fetch` that simulates a specific turn sequence.
 *
 * `sequence` is an array of stop_reasons.  The mock returns `tool_use`
 * responses (with one `noop` tool_use block) for `tool_use` entries, and
 * `end_turn` with a FINAL_ANSWER text block for `end_turn` entries.
 *
 * The mock replaces `global.fetch` for the duration of the test and is
 * restored automatically via the returned `restore` function.
 */
function mockFetchSequence(
  sequence: Array<'tool_use' | 'end_turn'>,
): { calls: number[]; restore: () => void } {
  const calls: number[] = [];   // turn indices (0-based) of actual calls
  let callIdx = 0;

  const originalFetch = global.fetch;

  (global as unknown as { fetch: typeof fetch }).fetch = async (
    _url: string | URL | Request,
    options?: RequestInit,
  ): Promise<Response> => {
    const idx = callIdx++;
    calls.push(idx);

    const stopReason = sequence[idx] ?? 'end_turn';

    let content: unknown[];
    if (stopReason === 'tool_use') {
      content = [
        {
          type: 'tool_use',
          id: `tool-${idx}`,
          name: 'noop',
          input: {},
        },
      ];
    } else {
      content = [
        {
          type: 'text',
          text: 'FINAL_ANSWER: 4',
        },
      ];
    }

    const body = JSON.stringify({
      id: `msg-${idx}`,
      model: 'claude-haiku-4-5',
      stop_reason: stopReason,
      content,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    calls,
    restore: () => {
      (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

// ---------------------------------------------------------------------------
// Base options for all tests
// ---------------------------------------------------------------------------

function baseOpts(overrides: Partial<GaiaAgentOptions> = {}): GaiaAgentOptions {
  return {
    apiKey: 'sk-ant-test-key',
    catalogue: NOOP_CATALOGUE,
    model: 'claude-haiku-4-5',
    perTurnTimeoutMs: 5_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: 12-turn all-tool_use loop → 3 replans at turns 4, 8, 12
// ---------------------------------------------------------------------------

async function test_twelveToolUseTurns_threeReplans(): Promise<void> {
  // Turns 0-11 are tool_use, turn 12 (index 12) is end_turn
  const sequence: Array<'tool_use' | 'end_turn'> = [
    ...Array<'tool_use'>(12).fill('tool_use'),
    'end_turn',
  ];
  const { restore } = mockFetchSequence(sequence);

  try {
    const result = await runGaiaAgent(FAKE_QUESTION, baseOpts({ maxTurns: 13 }));
    assert.equal(result.replanCount, 3, `Expected 3 replans, got ${result.replanCount}`);
  } finally {
    restore();
  }

  console.log('  PASS test_twelveToolUseTurns_threeReplans');
}

// ---------------------------------------------------------------------------
// Test 2: 3-turn loop → 0 replans (interval=4 never hit)
// ---------------------------------------------------------------------------

async function test_threeToolUseTurns_zeroReplans(): Promise<void> {
  const sequence: Array<'tool_use' | 'end_turn'> = [
    'tool_use',
    'tool_use',
    'tool_use',
    'end_turn',
  ];
  const { restore } = mockFetchSequence(sequence);

  try {
    const result = await runGaiaAgent(FAKE_QUESTION, baseOpts({ maxTurns: 8 }));
    assert.equal(result.replanCount, 0, `Expected 0 replans, got ${result.replanCount}`);
  } finally {
    restore();
  }

  console.log('  PASS test_threeToolUseTurns_zeroReplans');
}

// ---------------------------------------------------------------------------
// Test 3: end_turn at turn 5 → 1 replan (at turn 4), not at turn 5
// ---------------------------------------------------------------------------

async function test_endTurnAtFive_oneReplan(): Promise<void> {
  // Turns 0-4 are tool_use (5 of them), turn 5 is end_turn
  // Replan fires at turn 4 (turns=4, turns%4===0), but NOT at turn 5 (end_turn → no injection)
  const sequence: Array<'tool_use' | 'end_turn'> = [
    'tool_use',
    'tool_use',
    'tool_use',
    'tool_use',
    'tool_use',
    'end_turn',
  ];
  const { restore } = mockFetchSequence(sequence);

  try {
    const result = await runGaiaAgent(FAKE_QUESTION, baseOpts({ maxTurns: 10 }));
    assert.equal(result.replanCount, 1, `Expected 1 replan (at turn 4), got ${result.replanCount}`);
    assert.equal(result.timedOut, undefined, 'Should not time out');
  } finally {
    restore();
  }

  console.log('  PASS test_endTurnAtFive_oneReplan');
}

// ---------------------------------------------------------------------------
// Test 4: all tool_use for 8 turns → floor(8/4) = 2 replans
// ---------------------------------------------------------------------------

async function test_eightToolUseTurns_twoReplans(): Promise<void> {
  const sequence: Array<'tool_use' | 'end_turn'> = [
    ...Array<'tool_use'>(8).fill('tool_use'),
    'end_turn',
  ];
  const { restore } = mockFetchSequence(sequence);

  try {
    const result = await runGaiaAgent(FAKE_QUESTION, baseOpts({ maxTurns: 9 }));
    assert.equal(result.replanCount, 2, `Expected 2 replans, got ${result.replanCount}`);
  } finally {
    restore();
  }

  console.log('  PASS test_eightToolUseTurns_twoReplans');
}

// ---------------------------------------------------------------------------
// Test 5: planningInterval=0 → disabled, 0 replans even on long runs
// ---------------------------------------------------------------------------

async function test_intervalZero_disabledReplanning(): Promise<void> {
  const sequence: Array<'tool_use' | 'end_turn'> = [
    ...Array<'tool_use'>(8).fill('tool_use'),
    'end_turn',
  ];
  const { restore } = mockFetchSequence(sequence);

  try {
    const result = await runGaiaAgent(
      FAKE_QUESTION,
      baseOpts({ maxTurns: 9, planningInterval: 0 }),
    );
    assert.equal(result.replanCount, 0, `Expected 0 replans with interval=0, got ${result.replanCount}`);
  } finally {
    restore();
  }

  console.log('  PASS test_intervalZero_disabledReplanning');
}

// ---------------------------------------------------------------------------
// Test 6: buildPlanningCheckpoint content smoke
// ---------------------------------------------------------------------------

function test_buildPlanningCheckpoint_content(): void {
  const text = buildPlanningCheckpoint(4, 12);
  assert.ok(text.includes('[PLANNING CHECKPOINT'), 'Missing checkpoint header');
  assert.ok(text.includes('turn 4/12'), 'Missing turn counter');
  assert.ok(text.includes('4 turns so far'), 'Missing turn count phrase');
  assert.ok(text.includes('switch strategy'), 'Missing strategy-switch instruction');
  assert.ok(text.includes('FINAL_ANSWER'), 'Missing FINAL_ANSWER instruction');

  console.log('  PASS test_buildPlanningCheckpoint_content');
}

// ---------------------------------------------------------------------------
// Test 7: PLANNING_INTERVAL constant equals 4
// ---------------------------------------------------------------------------

function test_planningInterval_constant(): void {
  assert.equal(PLANNING_INTERVAL, 4, `Expected PLANNING_INTERVAL=4, got ${PLANNING_INTERVAL}`);
  console.log('  PASS test_planningInterval_constant');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== GAIA Agent Planning Interval Smoke Tests ===\n');

  // Synchronous tests first
  test_buildPlanningCheckpoint_content();
  test_planningInterval_constant();

  // Async tests
  await test_twelveToolUseTurns_threeReplans();
  await test_threeToolUseTurns_zeroReplans();
  await test_endTurnAtFive_oneReplan();
  await test_eightToolUseTurns_twoReplans();
  await test_intervalZero_disabledReplanning();

  console.log('\n=== All planning-interval smoke tests PASSED ===\n');
}

main().catch((err) => {
  console.error('Planning interval smoke failed:', err);
  process.exit(1);
});
