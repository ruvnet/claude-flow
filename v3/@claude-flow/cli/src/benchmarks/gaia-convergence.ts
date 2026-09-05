/**
 * GAIA Convergence Layer — deterministic finalization for saturated agent loops.
 *
 * Detects three failure modes that cause empty FINAL_ANSWER extraction:
 *   1. max_turns hit without a final_answer call
 *   2. Loop detected (same tool + same args called 3× in a 5-turn window)
 *   3. Token budget exceeded (>120k tokens of conversation context)
 *
 * On detection, runs a FORCED COMMIT phase:
 *   - Injects a stripped-down summary prompt: "Based on all observations, answer with
 *     FINAL_ANSWER: X. Do NOT explore further."
 *   - Makes 1 final API call with strict instruction and no tools.
 *   - If still no FINAL_ANSWER in the response, runs the Stage 1 extraction cascade
 *     against ALL prior assistant messages (last to first), returns first non-empty hit.
 *   - If still empty: returns null but logs the failure mode.
 *
 * This is NOT a new cognition layer — it is a convergence controller.
 * It STRIPS information rather than adding it: one final chance to commit,
 * no tools available, prior context summarized rather than appended.
 *
 * Architecture principle (iter 60 post-mortem):
 *   "More information can reduce agent reliability. Past a certain point —
 *    retrieval depth, context size, browsing breadth, tool diversity — information
 *    increases trajectory entropy. The system becomes less likely to finalize coherently."
 *   This layer is the entropy-reducer.
 *
 * Refs: #2156, iter 60 (19/25 empty FINAL_ANSWER failures), iter 62
 */

import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Token threshold (sum of input tokens across all turns) that triggers overflow detection. */
export const TOKEN_OVERFLOW_THRESHOLD = 120_000;

/** Number of repeated identical tool+args calls in a window that signals a loop. */
export const LOOP_REPEAT_THRESHOLD = 3;

/** Sliding window size (turns) for loop detection. */
export const LOOP_WINDOW_SIZE = 5;

/** Pattern Claude must output to signal it has a final answer. */
const FINAL_ANSWER_RE = /FINAL_ANSWER:\s*(.+)/i;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tracks state that the convergence layer needs to evaluate triggers. */
export interface ConvergenceState {
  /** How many agent turns have elapsed so far. */
  turnCount: number;
  /** Sum of input tokens across all turns (used for overflow detection). */
  totalTokens: number;
  /** Ordered log of tool calls for loop detection. */
  toolCalls: Array<{ name: string; argsHash: string; turn: number }>;
  /** Set by checkConvergenceTriggers when a failure mode is detected. */
  detectedFailureMode: 'max_turns' | 'loop' | 'token_overflow' | null;
}

/** Result of a forced-commit attempt. */
export interface ForceCommitResult {
  /** The extracted answer, or null if even forced commit could not extract one. */
  answer: string | null;
  /** True when the answer was recovered from prior message history rather than
   *  from the forced-commit API call. */
  usedFallback: boolean;
  /** The failure mode that triggered this forced commit. */
  triggerMode: ConvergenceState['detectedFailureMode'];
}

// ---------------------------------------------------------------------------
// argsHash — deterministic fingerprint of a tool call
// ---------------------------------------------------------------------------

/**
 * Produce a stable hash of a tool call's name + args for loop detection.
 *
 * Uses SHA-256 truncated to 16 hex chars — collision probability is
 * negligible for the small call volumes in a single agent run.
 *
 * The hash is deterministic: same toolName + same args always → same hash.
 * Different args always → different hash (within SHA-256 collision bounds).
 */
export function argsHash(toolName: string, args: object): string {
  const payload = toolName + '::' + JSON.stringify(args);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// checkConvergenceTriggers
// ---------------------------------------------------------------------------

/**
 * Evaluate the current ConvergenceState and return the first failure mode
 * detected, or null if no trigger has fired.
 *
 * Evaluation order:
 *   1. max_turns — turnCount >= maxTurns
 *   2. token_overflow — totalTokens >= TOKEN_OVERFLOW_THRESHOLD
 *   3. loop — same tool+argsHash appears >= LOOP_REPEAT_THRESHOLD times
 *              in the last LOOP_WINDOW_SIZE entries of toolCalls
 *
 * Only the FIRST matching trigger is returned (stops at first detection).
 * The caller is responsible for setting state.detectedFailureMode.
 */
export function checkConvergenceTriggers(
  state: ConvergenceState,
  maxTurns: number,
): ConvergenceState['detectedFailureMode'] {
  // 1. max_turns
  if (state.turnCount >= maxTurns) {
    return 'max_turns';
  }

  // 2. token_overflow
  if (state.totalTokens >= TOKEN_OVERFLOW_THRESHOLD) {
    return 'token_overflow';
  }

  // 3. loop — check the sliding window
  const window = state.toolCalls.slice(-LOOP_WINDOW_SIZE);
  if (window.length >= LOOP_REPEAT_THRESHOLD) {
    const callKey = (c: { name: string; argsHash: string }) => c.name + '::' + c.argsHash;
    const counts = new Map<string, number>();
    for (const call of window) {
      const key = callKey(call);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count >= LOOP_REPEAT_THRESHOLD) {
        return 'loop';
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildForcedCommitPrompt
// ---------------------------------------------------------------------------

/**
 * Build the stripped-down "commit now" prompt injected as a final user turn.
 *
 * Deliberately short and directive — this is an entropy-reducer, not a
 * context-enricher. Adding more information at this point would worsen the
 * problem we are solving.
 */
function buildForcedCommitPrompt(triggerMode: string): string {
  return (
    `[CONVERGENCE: ${triggerMode.toUpperCase()}]\n` +
    `You must commit to a final answer NOW. Do NOT call any more tools.\n` +
    `Based only on the information you have already gathered:\n` +
    `- Summarize your best answer in one line.\n` +
    `- Output it in EXACTLY this format: FINAL_ANSWER: <your answer>\n` +
    `- If you are uncertain, give your best estimate — do not say "I don't know".\n` +
    `You have ONE response. No further tool calls are permitted.`
  );
}

// ---------------------------------------------------------------------------
// extractFinalAnswerFromText — Stage 1 extraction against raw text
// ---------------------------------------------------------------------------

/**
 * Run Stage 1 extraction (FINAL_ANSWER: pattern) against a raw text string.
 * Returns the matched answer or null.
 */
export function extractFinalAnswerFromText(text: string): string | null {
  const match = FINAL_ANSWER_RE.exec(text);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// extractFromPriorMessages — fallback scan of message history
// ---------------------------------------------------------------------------

/**
 * Scan prior assistant messages from last to first, looking for FINAL_ANSWER.
 *
 * This is the fallback path when the forced-commit API call still does not
 * produce a FINAL_ANSWER. We search backwards because the most recent
 * assistant message is most likely to contain the best answer.
 */
export function extractFromPriorMessages(
  messages: Array<{ role: string; content: string | unknown }>,
): string | null {
  // Iterate in reverse, assistant messages only
  const assistantMessages = messages
    .filter((m) => m.role === 'assistant')
    .reverse();

  for (const msg of assistantMessages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : extractTextFromContent(msg.content);

    if (!text) continue;

    const answer = extractFinalAnswerFromText(text);
    if (answer) return answer;
  }

  return null;
}

/**
 * Extract plain text from a content block array (Anthropic API format).
 * Returns concatenated text from all text-type blocks, or empty string.
 */
function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type: string }).type === 'text') {
      const text = (block as { type: string; text: string }).text;
      if (text) parts.push(text);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// forceCommit
// ---------------------------------------------------------------------------

/**
 * Run the forced-commit phase for a saturated agent loop.
 *
 * Steps:
 *   1. Append a stripped directive prompt to the message history.
 *   2. Call the model once with NO tools — forces text-only response.
 *   3. If FINAL_ANSWER found in the response → return it.
 *   4. If not → scan prior assistant messages last-to-first for FINAL_ANSWER.
 *   5. If still empty → return { answer: null, usedFallback: false }.
 *
 * The callModel callback must return the raw text response (assistant turn
 * text blocks concatenated). It should be called WITHOUT tool definitions
 * so the model cannot call tools in this turn.
 *
 * @param messages  Current conversation history (mutated: 1 user turn appended)
 * @param callModel Callback that makes a single API call and returns the response text
 * @param triggerMode  The failure mode that triggered this forced commit
 */
export async function forceCommit(
  messages: Array<{ role: string; content: string | unknown }>,
  callModel: (messages: Array<{ role: string; content: string | unknown }>) => Promise<string>,
  triggerMode: ConvergenceState['detectedFailureMode'] = 'max_turns',
): Promise<ForceCommitResult> {
  const trigger = triggerMode ?? 'max_turns';

  // Step 1: append the forced-commit directive
  const commitMessages = [
    ...messages,
    { role: 'user', content: buildForcedCommitPrompt(trigger) },
  ];

  // Step 2: call the model once, no tools
  let responseText = '';
  try {
    responseText = await callModel(commitMessages);
  } catch {
    // If the API call itself fails, fall through to fallback scan
    responseText = '';
  }

  // Step 3: try to extract from the forced-commit response
  if (responseText) {
    const answer = extractFinalAnswerFromText(responseText);
    if (answer) {
      return { answer, usedFallback: false, triggerMode: triggerMode };
    }
  }

  // Step 4: scan prior messages last-to-first
  const fallbackAnswer = extractFromPriorMessages(messages);
  if (fallbackAnswer) {
    return { answer: fallbackAnswer, usedFallback: true, triggerMode: triggerMode };
  }

  // Step 5: graceful failure
  return { answer: null, usedFallback: false, triggerMode: triggerMode };
}

// ---------------------------------------------------------------------------
// createConvergenceState — factory for a fresh state object
// ---------------------------------------------------------------------------

/** Create a new ConvergenceState with zero counters. */
export function createConvergenceState(): ConvergenceState {
  return {
    turnCount: 0,
    totalTokens: 0,
    toolCalls: [],
    detectedFailureMode: null,
  };
}

// ---------------------------------------------------------------------------
// recordTurn — update state after a completed turn
// ---------------------------------------------------------------------------

/**
 * Update ConvergenceState after each agent turn completes.
 *
 * @param state       Mutable state object (modified in place)
 * @param inputTokens Tokens consumed in this turn
 * @param toolCallsThisTurn  Tool calls made in this turn (name + args)
 */
export function recordTurn(
  state: ConvergenceState,
  inputTokens: number,
  toolCallsThisTurn: Array<{ name: string; args: object }>,
): void {
  state.turnCount += 1;
  state.totalTokens += inputTokens;

  for (const tc of toolCallsThisTurn) {
    state.toolCalls.push({
      name: tc.name,
      argsHash: argsHash(tc.name, tc.args),
      turn: state.turnCount,
    });
  }
}
