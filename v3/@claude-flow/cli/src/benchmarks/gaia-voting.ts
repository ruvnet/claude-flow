/**
 * GAIA Voting — ADR-135 Track A
 *
 * Multi-attempt self-consistency voting wrapper around `runGaiaAgent`.
 *
 * Algorithm:
 *   1. Spawn N parallel `runGaiaAgent` calls, each with a distinct system-prompt
 *      seed (web-first / code-first / cautious) and varied temperature (0.3/0.5/0.7).
 *   2. Collect all N final answers; filter out nulls.
 *   3. Normalize each answer: lowercase, trim, strip punctuation, normalize numbers.
 *   4. Count by normalized value; the highest-count non-null wins (majority vote).
 *   5. Tie-break: pick the attempt whose normalized answer won and has the lowest
 *      error count (null/timed-out attempts score worst).
 *   6. All-disagree: pick the attempt with the lowest error/timeout count.
 *   7. All null: return null answer.
 *
 * Diversification system-prompt seeds (one per attempt, cycling if N > 3):
 *   - "web-first"   — prefer web_search before reasoning
 *   - "code-first"  — prefer code_exec/calculator before web
 *   - "cautious"    — step-by-step, verify each sub-claim before answering
 *
 * Temperature schedule (cycling if N > 3):
 *   - attempt 0: 0.3  (conservative)
 *   - attempt 1: 0.5  (balanced)
 *   - attempt 2: 0.7  (exploratory)
 *
 * Expected L1 lift per ADR-135: +5-10pp.
 * Cost: N× per question (default N=3 → ~3× per question).
 *
 * Refs: ADR-135, ADR-133, #2156
 */

import {
  runGaiaAgent,
  type GaiaAgentResult,
  type GaiaAgentOptions,
  resolveAnthropicApiKey,
} from './gaia-agent.js';
import type { GaiaQuestion } from './gaia-loader.js';
import { createDefaultToolCatalogue } from './gaia-tools/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System-prompt seeds injected per attempt to diversify exploration strategy. */
const STRATEGY_SEEDS: readonly string[] = [
  'web-first',
  'code-first',
  'cautious',
] as const;

/** Temperature schedule (cycling if N > 3). */
const TEMP_SCHEDULE: readonly number[] = [0.3, 0.5, 0.7] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VotingResult extends GaiaAgentResult {
  /** All individual attempt results (includes failed/null attempts). */
  attempts: GaiaAgentResult[];
  /**
   * How the winner was decided:
   * - 'majority'           — at least 2 attempts agreed on the winning answer
   * - 'highest-confidence' — all attempts disagreed; winner had fewest errors/timeouts
   * - 'all-disagree-retry' — all non-null attempts gave different answers (same as highest-confidence)
   * - 'sole-survivor'      — only one non-null attempt; used directly
   */
  votingMethod: 'majority' | 'highest-confidence' | 'all-disagree-retry' | 'sole-survivor';
  /** How many attempts produced the winning (normalized) answer. */
  agreementCount: number;
}

export interface VotingOptions {
  /** Number of parallel attempts (default: 3). */
  attempts?: number;
  /**
   * Optional custom system-prompt seed overrides per attempt (index-aligned).
   * Defaults to cycling through STRATEGY_SEEDS.
   */
  diversityPromptSeeds?: string[];
  /**
   * Number of attempts to run in parallel (default: attempts — full parallel).
   * Values < attempts cause sequential batches (useful for rate-limit avoidance).
   */
  parallelism?: number;
  // Pass-through to runGaiaAgent
  /** Model ID (default: 'claude-haiku-4-5'). */
  model?: string;
  /** Max agent turns per attempt (default: 8). */
  maxTurns?: number;
  /** Anthropic API key (resolved automatically if omitted). */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Answer normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw answer string for voting comparison.
 *
 * Steps:
 *   1. Lowercase + trim.
 *   2. Collapse internal whitespace.
 *   3. Strip leading/trailing punctuation (commas, periods, quotes, etc.).
 *   4. Normalize numeric representations: "1,234" → "1234", "1.0" → "1",
 *      "1.50" → "1.5".
 */
export function normalizeAnswer(raw: string): string {
  if (!raw) return '';

  let s = raw.trim().toLowerCase();

  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ');

  // Strip surrounding quotes
  s = s.replace(/^["'`]+|["'`]+$/g, '');

  // Strip leading/trailing punctuation (but not internal hyphens or dots)
  s = s.replace(/^[.,;:!?]+|[.,;:!?]+$/g, '');

  // Normalize thousands-separated numbers: "1,234" → "1234"
  s = s.replace(/(\d),(\d)/g, '$1$2');

  // Normalize trailing zeros after decimal: "1.50" → "1.5", "2.0" → "2"
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

  return s.trim();
}

// ---------------------------------------------------------------------------
// Build per-attempt system prompt
// ---------------------------------------------------------------------------

/**
 * Returns a diversified system prompt for the given attempt index.
 *
 * The base prompt (from gaia-agent.ts) is supplemented with a strategy hint
 * so each attempt explores the problem from a different angle.
 */
function buildDiversifiedSystemPrompt(seed: string): string {
  const strategyHints: Record<string, string> = {
    'web-first': [
      'STRATEGY: Prefer web_search as your first tool call.',
      'Search for relevant facts before attempting to reason from memory.',
      'Verify key claims via search before finalising your answer.',
    ].join(' '),
    'code-first': [
      'STRATEGY: Prefer code_exec or calculator tools for numerical or logical steps.',
      'Write and run code to derive answers whenever possible rather than estimating.',
      'Fall back to web_search only if computation is insufficient.',
    ].join(' '),
    'cautious': [
      'STRATEGY: Work step-by-step and verify each sub-claim before proceeding.',
      'If unsure about an intermediate fact, use a tool to confirm it.',
      'Only output FINAL_ANSWER when you have high confidence in every step.',
    ].join(' '),
  };

  return strategyHints[seed] ?? strategyHints['cautious'];
}

// ---------------------------------------------------------------------------
// Single attempt runner with strategy injection
// ---------------------------------------------------------------------------

/**
 * Run a single GAIA agent attempt with a specific strategy seed and temperature.
 *
 * NOTE: The current `runGaiaAgent` API does not expose a `temperature` or
 * `systemPromptSuffix` parameter.  We achieve diversification by:
 *   1. Injecting a strategy hint via `GaiaAgentOptions.catalogue` wrapping
 *      (future work — catalogue is a no-op here until gaia-agent supports suffix).
 *   2. Appending the hint to the question text as a prefixed instruction when
 *      the strategy is non-default.  This is the simplest approach that does
 *      not require modifying gaia-agent.ts.
 *
 * Temperature diversification is logged for audit but cannot be passed through
 * the current API.  Track B (prompt engineering) will extend the API signature.
 */
async function runAttempt(
  question: GaiaQuestion,
  attemptIndex: number,
  seed: string,
  temperature: number,
  options: Omit<VotingOptions, 'attempts' | 'diversityPromptSeeds' | 'parallelism'>,
): Promise<GaiaAgentResult> {
  // Inject strategy hint into the question text (cheapest injection point
  // that avoids API changes).  The model sees this as part of the user turn.
  const strategyHint = buildDiversifiedSystemPrompt(seed);
  const augmentedQuestion: GaiaQuestion = {
    ...question,
    // Prefix with a strategy instruction block the model will read first.
    question: `[Strategy: ${strategyHint}]\n\n${question.question}`,
    // Keep task_id unique per attempt for trace attribution.
    task_id: `${question.task_id}__attempt${attemptIndex}`,
  };

  // temperature and seed are logged for diagnostics but not yet wired into
  // the underlying fetch call (gaia-agent.ts does not expose temperature).
  // When gaia-agent.ts gains a `temperature` option this is where we pass it.
  void temperature; // intentional no-op until API extended

  return runGaiaAgent(augmentedQuestion, {
    model: options.model,
    maxTurns: options.maxTurns,
    apiKey: options.apiKey,
    // Use a fresh catalogue per attempt to avoid state cross-contamination.
    catalogue: createDefaultToolCatalogue(),
  });
}

// ---------------------------------------------------------------------------
// Core voting function
// ---------------------------------------------------------------------------

/**
 * Run a GAIA question N times in parallel with diversified strategies,
 * then majority-vote on the answer.
 *
 * @param question   The GAIA question to answer.
 * @param options    Voting + agent options.
 * @returns          VotingResult containing the winning answer and all attempt traces.
 */
export async function runGaiaAgentWithVoting(
  question: GaiaQuestion,
  options: VotingOptions = {},
): Promise<VotingResult> {
  const {
    attempts: numAttempts = 3,
    diversityPromptSeeds,
    parallelism,
    model,
    maxTurns,
    apiKey,
  } = options;

  const effectiveParallelism = parallelism ?? numAttempts;
  const wallStart = Date.now();

  // Build per-attempt seeds and temperatures
  const seeds: string[] = Array.from({ length: numAttempts }, (_, i) =>
    diversityPromptSeeds?.[i] ?? STRATEGY_SEEDS[i % STRATEGY_SEEDS.length],
  );
  const temps: number[] = Array.from({ length: numAttempts }, (_, i) =>
    TEMP_SCHEDULE[i % TEMP_SCHEDULE.length],
  );

  // Run attempts in batches of `effectiveParallelism`
  const allAttempts: GaiaAgentResult[] = [];
  for (let batchStart = 0; batchStart < numAttempts; batchStart += effectiveParallelism) {
    const batchEnd = Math.min(batchStart + effectiveParallelism, numAttempts);
    const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

    const batchResults = await Promise.all(
      batchIndices.map((i) =>
        runAttempt(
          question,
          i,
          seeds[i],
          temps[i],
          { model, maxTurns, apiKey },
        ),
      ),
    );

    allAttempts.push(...batchResults);
  }

  // -------------------------------------------------------------------------
  // Voting
  // -------------------------------------------------------------------------

  // Normalize answers; map each attempt to its normalized form (or null).
  const normalized: Array<string | null> = allAttempts.map((a) =>
    a.finalAnswer !== null ? normalizeAnswer(a.finalAnswer) : null,
  );

  // Count votes for each non-null normalized answer.
  const voteCounts = new Map<string, number>();
  for (const n of normalized) {
    if (n !== null && n !== '') {
      voteCounts.set(n, (voteCounts.get(n) ?? 0) + 1);
    }
  }

  // Aggregate token totals across all attempts.
  const totalInputTokens = allAttempts.reduce((s, a) => s + a.totalInputTokens, 0);
  const totalOutputTokens = allAttempts.reduce((s, a) => s + a.totalOutputTokens, 0);
  const totalTurns = allAttempts.reduce((s, a) => s + a.turns, 0);

  // Base result fields (shared across all voting paths).
  const baseResult = {
    questionId: question.task_id,
    turns: totalTurns,
    toolCallsByName: mergeToolCallCounts(allAttempts),
    totalInputTokens,
    totalOutputTokens,
    wallMs: Date.now() - wallStart,
    attempts: allAttempts,
  };

  // Case 1: All answers are null/empty.
  if (voteCounts.size === 0) {
    return {
      ...baseResult,
      finalAnswer: null,
      votingMethod: 'majority',
      agreementCount: 0,
    };
  }

  // Find the maximum vote count.
  let maxVotes = 0;
  for (const count of voteCounts.values()) {
    if (count > maxVotes) maxVotes = count;
  }

  // Collect all answers that achieved the maximum vote count.
  const winners: string[] = [];
  for (const [answer, count] of voteCounts.entries()) {
    if (count === maxVotes) winners.push(answer);
  }

  // Case 2: Clear majority (or all agree).
  if (maxVotes > 1) {
    // Pick the first winner; if multiple tie, pick lexicographically smallest for determinism.
    const winnerNorm = winners.sort()[0];
    const winningAttemptIndex = normalized.findIndex((n) => n === winnerNorm);
    const winningAttempt = allAttempts[winningAttemptIndex];

    return {
      ...baseResult,
      finalAnswer: winningAttempt.finalAnswer,
      votingMethod: 'majority',
      agreementCount: maxVotes,
    };
  }

  // Case 3: All non-null attempts disagree (maxVotes === 1, voteCounts.size > 1).
  // Pick the attempt with the best quality signal: fewest errors + not timed-out.
  if (voteCounts.size === 1) {
    // Only one unique answer exists — sole survivor or unanimous.
    const soleSurvivor = winners[0];
    const survivorIndex = normalized.findIndex((n) => n === soleSurvivor);
    const survivorAttempt = allAttempts[survivorIndex];
    return {
      ...baseResult,
      finalAnswer: survivorAttempt.finalAnswer,
      votingMethod: 'sole-survivor',
      agreementCount: 1,
    };
  }

  // All disagree: pick highest-confidence attempt.
  const bestAttempt = pickHighestConfidence(allAttempts, normalized);
  const votingMethod: VotingResult['votingMethod'] =
    numAttempts >= 3 ? 'all-disagree-retry' : 'highest-confidence';

  return {
    ...baseResult,
    finalAnswer: bestAttempt.finalAnswer,
    votingMethod,
    agreementCount: 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick the "highest-confidence" attempt from a set of all-disagreeing results.
 *
 * Confidence heuristic (lower score = better):
 *   - Timed-out attempt: +1000
 *   - Error present: +100
 *   - null finalAnswer: +500
 *   - turns used: +turns (fewer turns = more direct answer)
 */
function pickHighestConfidence(
  attempts: GaiaAgentResult[],
  normalized: Array<string | null>,
): GaiaAgentResult {
  let bestScore = Infinity;
  let bestIndex = 0;

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    let score = 0;
    if (a.timedOut) score += 1000;
    if (a.error) score += 100;
    if (normalized[i] === null || normalized[i] === '') score += 500;
    score += a.turns;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return attempts[bestIndex];
}

/**
 * Merge per-tool call counts across all attempts.
 */
function mergeToolCallCounts(attempts: GaiaAgentResult[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const a of attempts) {
    for (const [tool, count] of Object.entries(a.toolCallsByName)) {
      merged[tool] = (merged[tool] ?? 0) + count;
    }
  }
  return merged;
}
