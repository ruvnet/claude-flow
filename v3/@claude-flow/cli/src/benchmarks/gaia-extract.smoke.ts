/**
 * Smoke tests for extractFinalAnswer + buildUserMessage (iter 53a T2 narrowed).
 *
 * Iter 53a changes vs iter 52 T2:
 *   - Stage 2/3 (prose fallback) REMOVED — extractFinalAnswer is Stage 1 only.
 *   - Commitment prompt no longer has "FINAL_ANSWER: unknown" surrender instruction.
 *   - Reversed-text preprocessor PRESERVED (not the source of regressions).
 *
 * Anti-regression suite (7 cases):
 *   These are the exact failure modes from iter 52 T2 that must not regress.
 *   They test that the extraction logic is stable and correct for the 7 questions
 *   where iter 52 broke but iter 51 was correct.
 *
 * Run (after build):
 *   node dist/benchmarks/gaia-extract.smoke.js
 *
 * Exit 0 on all pass, 1 on any failure.
 *
 * Refs: ADR-133, ADR-135, iter 52 T2, iter 53a, #2156
 */

// ---------------------------------------------------------------------------
// Import the functions under test (via the compiled JS path at runtime).
// We keep a local copy of the types here to avoid circular build deps.
// ---------------------------------------------------------------------------

interface AnthropicResponse {
  id: string;
  model: string;
  stop_reason: string;
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

// Dynamic import so this file can run either as TS source (tsx) or compiled JS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractFinalAnswer: (resp: AnthropicResponse) => string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _buildUserMessage: (question: string) => string;

function makeResp(text: string): AnthropicResponse {
  return {
    id: 'test',
    model: 'test',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// Test cases — (label, rawText, expectedExtraction) triples.
// expectedExtraction === null means we expect null (no answer found).
// ---------------------------------------------------------------------------

interface TestCase {
  label: string;
  input: string;
  expected: string | null;
  isUserMsg?: boolean;    // if true, test buildUserMessage instead
}

const CASES: TestCase[] = [
  // ---------------------------------------------------------------------------
  // Stage 1: primary FINAL_ANSWER: pattern (iter 53a: this is the ONLY stage)
  // ---------------------------------------------------------------------------
  {
    label: 'Stage1 basic FINAL_ANSWER:',
    input: 'I searched and found the capital.\nFINAL_ANSWER: Paris',
    expected: 'Paris',
  },
  {
    label: 'Stage1 case-insensitive final_answer:',
    input: 'The result is known.\nfinal_answer: 42',
    expected: '42',
  },
  {
    label: 'Stage1 with leading whitespace',
    input: 'Done.\n   FINAL_ANSWER:   Tokyo   ',
    expected: 'Tokyo',
  },

  // ---------------------------------------------------------------------------
  // Prose-only outputs with no FINAL_ANSWER: tag — must return null (iter 53a).
  // These were previously handled by Stage 2/3 (iter 52 T2).
  // In iter 53a, we rely on the agent committing with the tag instead.
  // ---------------------------------------------------------------------------
  {
    label: 'Prose-only "The answer is X" — null in iter 53a (no Stage 2)',
    input: 'After analysis, the answer is Right.',
    expected: null,
  },
  {
    label: 'Prose-only "Therefore X" — null in iter 53a (no Stage 2)',
    input: 'Based on the clues, therefore the answer is Berlin.',
    expected: null,
  },
  {
    label: 'Prose-only "Answer: X" — null in iter 53a (no Stage 2)',
    input: 'Let me compute this.\nAnswer: 17',
    expected: null,
  },
  {
    label: 'Prose-only all-caps last line — null in iter 53a (no Stage 3)',
    input: 'I computed the value based on many steps.\nRIGHT',
    expected: null,
  },
  {
    label: 'Prose-only numeric last line — null in iter 53a (no Stage 3)',
    input: 'The final calculation gives us:\n346',
    expected: null,
  },
  {
    label: 'Prose-only short-phrase last line — null in iter 53a (no Stage 3)',
    input: 'After extensive research, the result is:\nBerlin, Germany',
    expected: null,
  },

  // Null case: no answer extractable (verbose prose, no commitment)
  {
    label: 'Null case: only tool-call reasoning, no commitment',
    input: 'I tried searching but could not find the specific information requested.',
    expected: null,
  },

  // ---------------------------------------------------------------------------
  // Reversed text pre-processor (buildUserMessage) — PRESERVED in iter 53a
  // ---------------------------------------------------------------------------
  {
    label: 'Reversed text: adds decoded hint',
    input: '.rewsna eht sa "tfel" drow eht fo etisoppo eht etirw ,ecnetnes siht dnatsrednu uoy fI',
    expected: '[NOTE:',
    isUserMsg: true,
  },
  {
    label: 'Normal text: no hint added',
    input: 'What is the capital of France?',
    expected: 'What is the capital of France?',
    isUserMsg: true,
  },

  // ---------------------------------------------------------------------------
  // Anti-regression suite (iter 53a) — 7 cases for iter 52 regressions.
  //
  // These represent the exact regression patterns from iter 52 T2:
  //   a1e91b78: agent surrendered with "unknown" (commitment prompt over-trigger)
  //   935e2cff: agent gave empty answer (Stage 2/3 failed after extraction)
  //   305ac316: agent gave empty answer (Stage 2/3 failed after extraction)
  //   7673d772: agent gave empty answer (Stage 2/3 failed after extraction)
  //   3f57289b: Stage 3 grabbed wrong number from prose
  //   50ec8903: Stage 3 grabbed markdown fragment instead of correct answer
  //   5a0c1adf: Stage 3 grabbed "Claus Peter" instead of correct "Claus"
  //
  // Each test constructs a synthetic response that mimics the failure mode
  // and asserts the correct Stage 1 extraction behavior.
  // ---------------------------------------------------------------------------

  // AR-1: a1e91b78 — agent used to surrender with "FINAL_ANSWER: unknown"
  //   In iter 52, system prompt said to output "FINAL_ANSWER: unknown" if unsure.
  //   With that instruction removed, the agent reasons further and finds the answer.
  //   This test verifies: if the agent DOES output a correct FINAL_ANSWER, we extract it.
  {
    label: 'AR-1 (a1e91b78): Stage1 extracts correct answer — not "unknown"',
    input: 'I found the video. The maximum number of bird species seen together is 3.\nFINAL_ANSWER: 3',
    expected: '3',
  },

  // AR-2: 935e2cff — agent had the answer but Stage 2 produced empty string
  //   In iter 53a, agent should output FINAL_ANSWER: Research correctly.
  {
    label: 'AR-2 (935e2cff): Stage1 extracts "Research" correctly',
    input: 'After reviewing the policy document, R stands for Research.\nFINAL_ANSWER: Research',
    expected: 'Research',
  },

  // AR-3: 305ac316 — agent had "Wojciech" but extraction failed
  {
    label: 'AR-3 (305ac316): Stage1 extracts Polish name correctly',
    input: 'The actor played Wojciech in the movie.\nFINAL_ANSWER: Wojciech',
    expected: 'Wojciech',
  },

  // AR-4: 7673d772 — agent had "inference" but extraction failed
  {
    label: 'AR-4 (7673d772): Stage1 extracts legal term correctly',
    input: 'The fifth section of the federal rule uses the word "inference".\nFINAL_ANSWER: inference',
    expected: 'inference',
  },

  // AR-5: 3f57289b — Stage 3 grabbed wrong number (525 instead of 519)
  //   The regression was caused by Stage 3 picking a wrong number from prose.
  //   With Stage 3 removed, Stage 1 is the only source — agent must use the tag.
  {
    label: 'AR-5 (3f57289b): Stage1 extracts correct at-bat count',
    input: 'Reggie Jackson had 525 at-bats but the player with most walks had 519.\nFINAL_ANSWER: 519',
    expected: '519',
  },

  // AR-6: 50ec8903 — Stage 3 grabbed "- Orange-Green edge →" (markdown fragment)
  //   With Stage 3 removed, only FINAL_ANSWER: tag is extracted.
  {
    label: 'AR-6 (50ec8903): Stage1 extracts Rubik cube colors correctly',
    input: 'After solving the cube configuration, the answer is green, white.\nFINAL_ANSWER: green, white',
    expected: 'green, white',
  },

  // AR-7: 5a0c1adf — Stage 3 grabbed "Claus Peter" (too many words)
  //   With Stage 3 removed, only FINAL_ANSWER: tag is extracted.
  {
    label: 'AR-7 (5a0c1adf): Stage1 extracts first name only, not "Claus Peter"',
    input: 'The conductor\'s full name is Claus Peter Flor, but his first name is Claus.\nFINAL_ANSWER: Claus',
    expected: 'Claus',
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Import at runtime to work with both tsx and compiled JS.
  const mod = await import('./gaia-agent.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any;

  _extractFinalAnswer = m._extractFinalAnswerForTest;
  _buildUserMessage = m._buildUserMessageForTest;

  if (typeof _extractFinalAnswer !== 'function' || typeof _buildUserMessage !== 'function') {
    console.error(
      'ERROR: _extractFinalAnswerForTest / _buildUserMessageForTest not exported from gaia-agent.' +
      '\nAdd `export { extractFinalAnswer as _extractFinalAnswerForTest, ' +
      'buildUserMessage as _buildUserMessageForTest }` to gaia-agent.ts.',
    );
    process.exit(1);
  }

  let failures = 0;
  const PASS = '\x1b[32mPASS\x1b[0m';
  const FAIL = '\x1b[31mFAIL\x1b[0m';

  console.log('\n=== gaia-extract smoke (iter 53a T2 narrowed) ===\n');
  console.log('Suite: 12 original + 7 anti-regression = 19 cases\n');

  for (const tc of CASES) {
    let actual: string | null;

    if (tc.isUserMsg) {
      actual = _buildUserMessage(tc.input);
      // For user message tests, check startsWith instead of exact equality.
      const pass = tc.expected === null
        ? actual === null
        : actual !== null && (tc.expected === actual || actual.startsWith(tc.expected));
      if (pass) {
        console.log(`  ${PASS}  ${tc.label}`);
      } else {
        console.log(`  ${FAIL}  ${tc.label}`);
        console.log(`         expected starts-with: ${JSON.stringify(tc.expected)}`);
        console.log(`         actual:               ${JSON.stringify((actual ?? '').slice(0, 80))}`);
        failures++;
      }
    } else {
      actual = _extractFinalAnswer(makeResp(tc.input));
      const pass = tc.expected === null
        ? actual === null
        : actual !== null && actual === tc.expected;
      if (pass) {
        console.log(`  ${PASS}  ${tc.label}`);
      } else {
        console.log(`  ${FAIL}  ${tc.label}`);
        console.log(`         expected: ${JSON.stringify(tc.expected)}`);
        console.log(`         actual:   ${JSON.stringify(actual)}`);
        failures++;
      }
    }
  }

  const total = CASES.length;
  const passed = total - failures;
  console.log(`\n=== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} (${passed}/${total} cases) ===\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(2);
});
