/**
 * GAIA Question Decomposer — ADR-135 Track E
 *
 * Decomposes complex GAIA benchmark questions into 1-5 ordered sub-questions
 * that can each be answered with a single tool call, then synthesizes the
 * sub-answers into a final response.
 *
 * Motivation (iter 29 finding): tool quality is the bottleneck on L1 (~20.8%).
 * Bad tools that fail on complex queries may succeed on focused sub-queries.
 * This mimics what humans do at 92% on GAIA (decompose-then-solve).
 * Expected L1 lift: +5-10pp on multi-step questions (~30-40% of L1 set).
 *
 * Design:
 *  - NEW standalone file only; NOT wired into gaia-bench.ts to avoid merge
 *    conflicts with in-flight iter 29/31/34/35/36 branches.
 *    Wiring is a small follow-up PR.
 *  - `decomposeQuestion()` — Haiku-cheap classification + decomposition
 *    (~$0.0003 per question).
 *  - `synthesizeFromSubAnswers()` — Sonnet synthesis from sub-answers
 *    (the sub-answers are the hard work; synthesis is just combination).
 *  - Atomic questions are returned as-is — no overhead when not needed.
 *  - Graceful fallback to atomic on API errors or malformed JSON.
 *
 * Cost discipline:
 *  - Decomposition uses claude-haiku-4-5 (~$0.0003/question).
 *  - Synthesis uses claude-sonnet-4-6 (~$0.002/question).
 *  - Total overhead per question (when decomposed): ~$0.002-0.003.
 *
 * Plugin sync TODO (follow-up PR after gaia-bench wiring):
 *  - Update plugins/ruflo-workflows/commands/gaia-run.md with --decompose flag.
 *  - Update plugins/ruflo-workflows/skills/gaia-debugging/SKILL.md: add
 *    decomposition as a recommended strategy for multi-step failures.
 *
 * Refs: ADR-135, ADR-133, iter 29 finding, #2156
 */

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Haiku for cheap decomposition classification (~$0.0003/question).
 * Callers can override via DecomposerOptions.model.
 */
const DEFAULT_DECOMPOSER_MODEL = 'claude-haiku-4-5';

/**
 * Sonnet for synthesis — sub-answers are the expensive part, synthesis is
 * just recombination, but needs good reasoning. Callers can override.
 */
const DEFAULT_SYNTHESIZER_MODEL = 'claude-sonnet-4-6';

const DECOMPOSER_MAX_TOKENS = 512;
const SYNTHESIZER_MAX_TOKENS = 512;

/** Haiku pricing per million tokens (2026-05-27). */
const HAIKU_INPUT_COST_PER_M = 0.8;
const HAIKU_OUTPUT_COST_PER_M = 4.0;

/** Sonnet pricing per million tokens (2026-05-27). */
const SONNET_INPUT_COST_PER_M = 3.0;
const SONNET_OUTPUT_COST_PER_M = 15.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DecomposedQuestion {
  /** The original unmodified question text. */
  originalQuestion: string;
  /**
   * Ordered sub-questions in dependency order (1-5).
   * If decomposed=false, contains exactly one entry equal to originalQuestion.
   */
  subQuestions: string[];
  /**
   * Brief hint for how to combine sub-answers into the final answer.
   * Example: "Multiply the two values found in sub-questions 1 and 2."
   */
  synthesisHint: string;
  /**
   * true if the question was split into multiple sub-questions;
   * false if it was deemed atomic (single lookup / single computation).
   */
  decomposed: boolean;
  /** USD spent on the decomposition API call (0 if fallback/atomic). */
  cost: number;
}

export interface DecomposerOptions {
  /**
   * Model to use for decomposition classification.
   * Default: 'claude-haiku-4-5' (cheap).
   */
  model?: string;
  /**
   * Maximum sub-questions to produce when decomposing.
   * Default: 5.
   */
  maxSubQuestions?: number;
  /** API key override. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

export interface SynthesizerOptions {
  /**
   * Model to use for final-answer synthesis.
   * Default: 'claude-sonnet-4-6'.
   */
  model?: string;
  /** API key override. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

export interface SynthesisResult {
  /** The synthesized final answer string. */
  finalAnswer: string;
  /** Brief reasoning that led to the final answer. */
  reasoning: string;
  /** USD spent on the synthesis API call. */
  cost: number;
}

// ---------------------------------------------------------------------------
// API key resolution (mirrors gaia-agent.ts / gaia-judge.ts pattern)
// ---------------------------------------------------------------------------

function resolveApiKey(supplied?: string): string {
  if (supplied && supplied.trim()) return supplied.trim();

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  try {
    const out = execSync(
      'gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY 2>/dev/null',
      { encoding: 'utf-8', timeout: 10_000 },
    ).trim();
    if (out) return out;
  } catch {
    /* fall through */
  }

  throw new Error(
    'ANTHROPIC_API_KEY not found. Set the env var or store it in GCP Secret Manager ' +
    'under "ANTHROPIC_API_KEY".',
  );
}

// ---------------------------------------------------------------------------
// Anthropic Messages API helper
// ---------------------------------------------------------------------------

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  model: string,
  maxTokens: number,
  apiKey: string,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '(no body)');
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const textBlock = data.content.find((c) => c.type === 'text');
  const text = textBlock?.text ?? '';

  return {
    text,
    tokensIn: data.usage.input_tokens,
    tokensOut: data.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Decomposer prompt
// ---------------------------------------------------------------------------

function buildDecomposerSystemPrompt(maxSubQuestions: number): string {
  return [
    'You are decomposing GAIA benchmark questions into sub-questions for a tool-using agent.',
    '',
    `Rules:`,
    '1. If the question is ATOMIC (single fact lookup or single computation — one tool call',
    '   would answer it directly), return:',
    '   {"decomposed": false, "subQuestions": ["<original question>"], "synthesisHint": "Use directly."}',
    '',
    `2. If the question requires ${maxSubQuestions > 2 ? '2-' + maxSubQuestions : '2'} dependent steps, decompose into ORDERED`,
    '   sub-questions where each can be answered with a single tool call:',
    '   {"decomposed": true, "subQuestions": ["...", "...", "..."], "synthesisHint": "How to combine"}',
    '',
    'Sub-question requirements:',
    '  - Each sub-question must be SELF-CONTAINED (no pronouns referring to earlier sub-questions).',
    '  - Sub-questions must be in DEPENDENCY ORDER (earlier answers feed into later questions if needed).',
    '  - Sub-questions should be specific enough for a single web search or computation.',
    `  - Maximum ${maxSubQuestions} sub-questions.`,
    '',
    'Examples of ATOMIC questions (decomposed=false):',
    '  "What year was the Eiffel Tower built?"',
    '  "What is 25% of 840?"',
    '  "Who wrote Pride and Prejudice?"',
    '',
    'Examples of COMPLEX questions (decomposed=true):',
    '  "Who directed the highest-grossing film of the decade that contained the year',
    '   the Eiffel Tower was built?" → sub-questions:',
    '    1. "What year was the Eiffel Tower built?"',
    '    2. "What decade contains [year from Q1]?" (compute from Q1 answer)',
    '    3. "What was the highest-grossing film of [decade from Q2]?"',
    '    4. "Who directed [film from Q3]?"',
    '',
    'Respond with JSON only. No markdown, no explanation outside the JSON object.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Synthesis prompt
// ---------------------------------------------------------------------------

function buildSynthesizerSystemPrompt(): string {
  return [
    'You are synthesizing a final answer to a GAIA benchmark question from answers',
    'to sub-questions.',
    '',
    'Rules:',
    '1. Use ONLY the sub-answers provided — do not hallucinate additional information.',
    '2. The final answer must be CONCISE — match the GAIA expected format (often a',
    '   single word, number, name, or short phrase).',
    '3. Apply the synthesis hint if provided.',
    '4. State your reasoning briefly, then give the final answer.',
    '',
    'Respond with JSON only:',
    '{"finalAnswer": "<concise answer>", "reasoning": "<brief chain of reasoning, ≤300 chars>"}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

interface DecomposerPayload {
  decomposed?: boolean;
  subQuestions?: unknown[];
  synthesisHint?: string;
}

function parseDecomposerResponse(raw: string): DecomposerPayload | null {
  // Strip optional code fences
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(clean) as DecomposerPayload;
  } catch {
    return null;
  }
}

interface SynthesizerPayload {
  finalAnswer?: string;
  reasoning?: string;
}

function parseSynthesizerResponse(raw: string): SynthesizerPayload | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(clean) as SynthesizerPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Atomic fallback
// ---------------------------------------------------------------------------

function atomicFallback(questionText: string): DecomposedQuestion {
  return {
    originalQuestion: questionText,
    subQuestions: [questionText],
    synthesisHint: 'Use directly.',
    decomposed: false,
    cost: 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decomposes a complex question into 1-5 sub-questions in dependency order,
 * OR returns the question as-is if it is already atomic.
 *
 * Uses `claude-haiku-4-5` by default for cheap classification + decomposition
 * (~$0.0003 per question).
 *
 * Heuristics the model uses internally for "should decompose":
 *  - Question contains "and", "then", "after", "if X …"
 *  - Question contains multiple named entities that must each be looked up
 *  - Question asks for a derived/computed answer (X of Y where Y must be found)
 *
 * Graceful degradation: on API errors or malformed JSON, returns the question
 * as atomic so the calling agent can still attempt a direct answer.
 *
 * @param questionText - The full GAIA question text.
 * @param options      - Optional overrides (model, maxSubQuestions, apiKey).
 * @returns            - DecomposedQuestion with subQuestions and synthesisHint.
 */
export async function decomposeQuestion(
  questionText: string,
  options?: DecomposerOptions,
): Promise<DecomposedQuestion> {
  const model = options?.model ?? DEFAULT_DECOMPOSER_MODEL;
  const maxSubQuestions = options?.maxSubQuestions ?? 5;

  let apiKey: string;
  try {
    apiKey = resolveApiKey(options?.apiKey);
  } catch {
    // No API key available — return atomic fallback (graceful degradation)
    return atomicFallback(questionText);
  }

  let text: string;
  let tokensIn: number;
  let tokensOut: number;

  try {
    ({ text, tokensIn, tokensOut } = await callAnthropic(
      buildDecomposerSystemPrompt(maxSubQuestions),
      `Question: ${questionText}`,
      model,
      DECOMPOSER_MAX_TOKENS,
      apiKey,
    ));
  } catch {
    // API error — return atomic fallback so the pipeline can continue
    return atomicFallback(questionText);
  }

  const costUsd =
    (tokensIn / 1_000_000) * HAIKU_INPUT_COST_PER_M +
    (tokensOut / 1_000_000) * HAIKU_OUTPUT_COST_PER_M;

  const parsed = parseDecomposerResponse(text);

  // Validate parsed payload — fall back to atomic on any malformed response
  if (
    parsed === null ||
    !Array.isArray(parsed.subQuestions) ||
    parsed.subQuestions.length === 0
  ) {
    return { ...atomicFallback(questionText), cost: costUsd };
  }

  const subQuestions = parsed.subQuestions
    .slice(0, maxSubQuestions)
    .map((q) => String(q).trim())
    .filter((q) => q.length > 0);

  if (subQuestions.length === 0) {
    return { ...atomicFallback(questionText), cost: costUsd };
  }

  const decomposed = parsed.decomposed !== false && subQuestions.length > 1;
  const synthesisHint = String(parsed.synthesisHint ?? 'Combine sub-answers into a final answer.').trim();

  return {
    originalQuestion: questionText,
    subQuestions,
    synthesisHint,
    decomposed,
    cost: costUsd,
  };
}

/**
 * Given a decomposed question and answers to each sub-question, synthesizes
 * a final concise answer.
 *
 * Uses `claude-sonnet-4-6` by default for higher reasoning quality — the
 * sub-answers contain the hard-won information; synthesis is recombination.
 *
 * Graceful degradation: on API errors or malformed JSON, returns the last
 * sub-answer concatenated with reasoning note.
 *
 * @param decomposed  - The DecomposedQuestion from `decomposeQuestion()`.
 * @param subAnswers  - Array of string answers, one per sub-question.
 *                      Must be the same length as decomposed.subQuestions.
 * @param options     - Optional overrides (model, apiKey).
 * @returns           - SynthesisResult with finalAnswer, reasoning, and cost.
 */
export async function synthesizeFromSubAnswers(
  decomposed: DecomposedQuestion,
  subAnswers: string[],
  options?: SynthesizerOptions,
): Promise<SynthesisResult> {
  const model = options?.model ?? DEFAULT_SYNTHESIZER_MODEL;

  // If not truly decomposed, just return the single sub-answer directly
  if (!decomposed.decomposed || decomposed.subQuestions.length === 1) {
    const singleAnswer = subAnswers[0] ?? '';
    return {
      finalAnswer: singleAnswer,
      reasoning: 'Atomic question — sub-answer is the final answer.',
      cost: 0,
    };
  }

  let apiKey: string;
  try {
    apiKey = resolveApiKey(options?.apiKey);
  } catch {
    const fallback = subAnswers[subAnswers.length - 1] ?? '';
    return {
      finalAnswer: fallback,
      reasoning: 'No API key — returning last sub-answer as fallback.',
      cost: 0,
    };
  }

  // Build the user message: list each sub-question with its answer
  const qaLines = decomposed.subQuestions.map((q, i) => {
    const a = subAnswers[i] ?? '(no answer)';
    return `Sub-question ${i + 1}: ${q}\nSub-answer ${i + 1}: ${a}`;
  });

  const userMessage = [
    `Original question: ${decomposed.originalQuestion}`,
    '',
    'Sub-question answers:',
    qaLines.join('\n\n'),
    '',
    `Synthesis hint: ${decomposed.synthesisHint}`,
  ].join('\n');

  let text: string;
  let tokensIn: number;
  let tokensOut: number;

  try {
    ({ text, tokensIn, tokensOut } = await callAnthropic(
      buildSynthesizerSystemPrompt(),
      userMessage,
      model,
      SYNTHESIZER_MAX_TOKENS,
      apiKey,
    ));
  } catch {
    const fallback = subAnswers[subAnswers.length - 1] ?? '';
    return {
      finalAnswer: fallback,
      reasoning: 'API error during synthesis — returning last sub-answer.',
      cost: 0,
    };
  }

  const costUsd =
    (tokensIn / 1_000_000) * SONNET_INPUT_COST_PER_M +
    (tokensOut / 1_000_000) * SONNET_OUTPUT_COST_PER_M;

  const parsed = parseSynthesizerResponse(text);

  if (!parsed || !parsed.finalAnswer) {
    // Malformed JSON — return last sub-answer as fallback
    const fallback = subAnswers[subAnswers.length - 1] ?? '';
    return {
      finalAnswer: fallback,
      reasoning: `Parse error — raw: ${text.slice(0, 100)}`,
      cost: costUsd,
    };
  }

  return {
    finalAnswer: String(parsed.finalAnswer).trim(),
    reasoning: String(parsed.reasoning ?? '').slice(0, 300),
    cost: costUsd,
  };
}
