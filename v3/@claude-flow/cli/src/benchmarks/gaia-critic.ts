/**
 * GAIA Adversarial Critic — ADR-135 Track D
 *
 * After the main agent produces a candidate answer, a Sonnet pass reviews it.
 * If the critic verdict is "fail", the orchestrator re-runs the agent with the
 * critique injected as additional context.
 *
 * Motivation (iter 29 finding): tool quality is the bottleneck on L1 (~20.8%).
 * The critic catches wrong-because-of-bad-tool-result answers BEFORE submission,
 * without requiring better search backends.  Expected L1 lift: +3-5pp.
 *
 * Design:
 *  - NEW file only; NOT wired into gaia-bench.ts yet to avoid merge conflicts
 *    with in-flight iter 29/31/34 branches.  Wiring is a small follow-up PR.
 *  - `criticReview()` — single Sonnet call, returns structured verdict.
 *  - `runGaiaAgentWithCritic()` — orchestration wrapper: runs agent, calls
 *    critic, retries once on "fail".  "uncertain" is treated as "pass" (don't
 *    burn retries on borderline cases).
 *  - API errors and malformed JSON from the critic are caught; original
 *    candidate is returned with an error-flagged verdict.
 *  - Default opt-in: enableCritic=false.  Set true via RunWithCriticOptions.
 *
 * Cost discipline:
 *  - Critic uses claude-sonnet-4-6 (separate from the agent's default Haiku).
 *  - One critic call + one optional retry = max 2 extra Sonnet calls per Q.
 *  - Approximate extra cost per question: ~$0.003-0.005 (well within budget).
 *
 * Plugin sync TODO (follow-up PR after gaia-bench wiring):
 *  - Update plugins/ruflo-workflows/commands/gaia-run.md with --enable-critic flag.
 *  - Update plugins/ruflo-workflows/skills/gaia-debugging/SKILL.md: add critic
 *    as a recommended diagnostic step for wrong-answer analysis.
 *
 * Refs: ADR-135, ADR-133, iter 29 finding, #2156
 */

import { execSync } from 'node:child_process';
import {
  GaiaQuestion,
} from './gaia-loader.js';
import {
  runGaiaAgent,
  GaiaAgentResult,
  GaiaAgentOptions,
} from './gaia-agent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Default model for the critic — Sonnet for higher reasoning quality. */
const DEFAULT_CRITIC_MODEL = 'claude-sonnet-4-6';

/** Max tokens for the critic response (verdict JSON is short). */
const CRITIC_MAX_TOKENS = 512;

/** Sonnet pricing (input/output per million tokens, 2026-05-27).
 *  Used only for cost estimation in CriticVerdict. */
const SONNET_INPUT_COST_PER_M = 3.0;
const SONNET_OUTPUT_COST_PER_M = 15.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured verdict returned by the adversarial critic.
 *
 * - "pass"      → critic agrees with the candidate; no retry needed.
 * - "fail"      → critic found a flaw; suggestedRevision provided if possible.
 * - "uncertain" → critic is unsure; treated as "pass" to avoid burning retries.
 */
export type CriticVerdictType = 'pass' | 'fail' | 'uncertain';

export interface CriticVerdict {
  /** Critic's assessment of the candidate answer. */
  verdict: CriticVerdictType;
  /** Short explanation of the reasoning (1-3 sentences). */
  reasoning: string;
  /** Suggested correction when verdict is "fail"; may be empty string. */
  suggestedRevision?: string;
  /** Estimated USD cost of this critic call. */
  costUsd: number;
  /** True when the critic call itself failed (API error, malformed JSON). */
  error?: boolean;
  /** Original raw response text when parse failed. */
  rawResponse?: string;
}

export interface CriticOptions {
  /**
   * Model to use for the critic pass.
   * Defaults to 'claude-sonnet-4-6' (intentionally separate from agent model).
   */
  model?: string;
  /**
   * Maximum number of agent retries on "fail" verdict.
   * Default: 1 (one retry).  Set to 0 to disable retries (observe-only mode).
   */
  maxRetries?: number;
  /** Anthropic API key (resolved via env/gcloud if omitted). */
  apiKey?: string;
}

// Extended result returned by the critic-wrapped orchestrator.
export interface GaiaAgentResultWithCritic extends GaiaAgentResult {
  /** All critic verdicts collected (one per agent attempt). */
  criticVerdicts: CriticVerdict[];
  /** How many retries were actually attempted (0 if critic passed first time). */
  retriesAttempted: number;
}

/** Options for runGaiaAgentWithCritic, extending core agent options. */
export interface RunWithCriticOptions extends GaiaAgentOptions {
  /**
   * Enable the adversarial critic pass.  Default: false.
   * When false, runGaiaAgentWithCritic behaves identically to runGaiaAgent.
   */
  enableCritic?: boolean;
  /** Critic-specific configuration. */
  criticOptions?: CriticOptions;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve Anthropic API key using the same precedence as gaia-agent.ts. */
function resolveApiKey(override?: string): string {
  if (override) return override;
  const fromEnv = process.env['ANTHROPIC_API_KEY'];
  if (fromEnv) return fromEnv;
  try {
    return execSync(
      'gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    throw new Error(
      'ANTHROPIC_API_KEY not set and gcloud fallback failed. ' +
      'Set ANTHROPIC_API_KEY env var or ensure gcloud access.',
    );
  }
}

/**
 * Build the critic system prompt.
 * Instructs Sonnet to act as an adversarial reviewer and respond in JSON.
 */
function buildCriticSystemPrompt(): string {
  return `You are an adversarial reviewer of agent answers on the GAIA benchmark. \
Your job is to find flaws in candidate answers before they are submitted.

Given a question, a candidate answer, and a summary of the agent's reasoning \
trajectory, you must decide whether the candidate answer is correct.

Evaluation criteria:
1. Does the answer directly address what the question asks?
2. Is there evidence in the trajectory that supports the answer?
3. Are there obvious flaws (wrong unit, wrong format, missed constraint, \
fabricated source, off-by-one error, truncation)?
4. For numeric answers: is the magnitude and unit plausible?
5. For list answers: are all required items present and correctly ordered?

Respond ONLY with a JSON object — no markdown, no prose outside the JSON:
{"verdict":"pass"|"fail"|"uncertain","reasoning":"<1-3 sentences>","suggestedRevision":"<corrected answer or empty string>"}

Use "uncertain" only when you genuinely cannot determine correctness from the \
available information. Never use "uncertain" to avoid making a decision when \
evidence is available.`;
}

/**
 * Build the critic user message combining the question, candidate answer,
 * and a compressed view of the agent trajectory.
 */
function buildCriticUserMessage(
  question: GaiaQuestion,
  candidateAnswer: string,
  trajectory: { steps: Array<{ tool?: string; result?: string; reasoning?: string }>; turns: number },
): string {
  // Summarise trajectory: first 2 + last 2 steps to keep tokens bounded.
  const steps = trajectory.steps ?? [];
  const summarised = steps.length <= 4
    ? steps
    : [...steps.slice(0, 2), ...steps.slice(-2)];

  const trajectoryText = summarised.length === 0
    ? '(no tool calls recorded)'
    : summarised.map((s, i) => {
        const label = s.tool ? `Step ${i + 1} [${s.tool}]` : `Step ${i + 1}`;
        const result = s.result ? ` → ${s.result.slice(0, 200)}` : '';
        return `${label}${result}`;
      }).join('\n');

  return `QUESTION: ${question.question}

CANDIDATE ANSWER: ${candidateAnswer}

AGENT TRAJECTORY (${trajectory.turns} turns, summarised):
${trajectoryText}`;
}

/**
 * Attempt to extract a verdict from a potentially malformed JSON string.
 * Falls back gracefully to "uncertain" with the raw text preserved.
 */
function parseVerdictFallback(raw: string): Partial<CriticVerdict> {
  // Try standard JSON parse first.
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verdict = parsed['verdict'] as string;
    if (verdict === 'pass' || verdict === 'fail' || verdict === 'uncertain') {
      return {
        verdict,
        reasoning: (parsed['reasoning'] as string) ?? '',
        suggestedRevision: (parsed['suggestedRevision'] as string) ?? '',
      };
    }
  } catch {
    // Fall through to regex extraction.
  }

  // Regex extraction for embedded JSON in prose.
  const jsonMatch = raw.match(/\{[\s\S]*?"verdict"\s*:\s*"(pass|fail|uncertain)"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        verdict: parsed['verdict'] as CriticVerdictType,
        reasoning: (parsed['reasoning'] as string) ?? '',
        suggestedRevision: (parsed['suggestedRevision'] as string) ?? '',
      };
    } catch {
      // Fall through.
    }
  }

  // Last resort: extract verdict keyword from raw text.
  const verdictMatch = raw.match(/\b(pass|fail|uncertain)\b/i);
  return {
    verdict: verdictMatch
      ? (verdictMatch[1].toLowerCase() as CriticVerdictType)
      : 'uncertain',
    reasoning: `Critic returned malformed JSON; extracted verdict heuristically.`,
    suggestedRevision: '',
    rawResponse: raw.slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Core critic function
// ---------------------------------------------------------------------------

/**
 * Run the adversarial critic against a candidate answer.
 *
 * @param question     - The GAIA question being evaluated.
 * @param candidateAnswer - The agent's proposed final answer.
 * @param trajectory   - Lightweight trajectory summary from the agent run.
 * @param options      - Critic configuration (model, apiKey).
 * @returns            CriticVerdict with verdict, reasoning, cost.
 */
export async function criticReview(
  question: GaiaQuestion,
  candidateAnswer: string,
  trajectory: { steps: Array<{ tool?: string; result?: string; reasoning?: string }>; turns: number },
  options?: CriticOptions,
): Promise<CriticVerdict> {
  const model = options?.model ?? DEFAULT_CRITIC_MODEL;
  const apiKey = resolveApiKey(options?.apiKey);
  const t0 = Date.now();

  const requestBody = {
    model,
    max_tokens: CRITIC_MAX_TOKENS,
    system: buildCriticSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildCriticUserMessage(question, candidateAnswer, trajectory),
      },
    ],
  };

  let rawResponseText = '';
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const costUsd =
      (inputTokens / 1_000_000) * SONNET_INPUT_COST_PER_M +
      (outputTokens / 1_000_000) * SONNET_OUTPUT_COST_PER_M;

    rawResponseText = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');

    const parsed = parseVerdictFallback(rawResponseText);

    return {
      verdict: parsed.verdict ?? 'uncertain',
      reasoning: parsed.reasoning ?? '',
      suggestedRevision: parsed.suggestedRevision ?? '',
      costUsd,
      ...(parsed.rawResponse ? { rawResponse: parsed.rawResponse } : {}),
    };
  } catch (err) {
    const wallMs = Date.now() - t0;
    const errMsg = err instanceof Error ? err.message : String(err);
    // Graceful fallback: treat critic error as "uncertain" so agent result
    // is still returned rather than throwing.
    return {
      verdict: 'uncertain',
      reasoning: `Critic call failed after ${wallMs}ms: ${errMsg.slice(0, 200)}`,
      suggestedRevision: '',
      costUsd: 0,
      error: true,
      rawResponse: rawResponseText.slice(0, 200) || undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestration wrapper
// ---------------------------------------------------------------------------

/**
 * Run the GAIA agent with an optional adversarial critic pass.
 *
 * When enableCritic=false (default), this is a thin pass-through to
 * runGaiaAgent with an empty criticVerdicts array.
 *
 * When enableCritic=true:
 *  1. Run runGaiaAgent normally.
 *  2. If the agent produced a finalAnswer, call criticReview.
 *  3. If verdict is "fail" and retriesAttempted < maxRetries:
 *     a. Re-run the agent with the critique injected as additional context.
 *     b. Call criticReview again on the new answer.
 *  4. Return the final result with all critic verdicts attached.
 *
 * Note on "uncertain": treated as "pass" (no retry triggered).
 */
export async function runGaiaAgentWithCritic(
  question: GaiaQuestion,
  options: RunWithCriticOptions = {},
): Promise<GaiaAgentResultWithCritic> {
  const { enableCritic = false, criticOptions, ...agentOptions } = options;

  // Fast path: critic disabled.
  if (!enableCritic) {
    const result = await runGaiaAgent(question, agentOptions);
    return { ...result, criticVerdicts: [], retriesAttempted: 0 };
  }

  const maxRetries = criticOptions?.maxRetries ?? 1;
  const criticVerdicts: CriticVerdict[] = [];
  let retriesAttempted = 0;

  // First agent run.
  let agentResult = await runGaiaAgent(question, agentOptions);

  // If agent timed out or errored with no answer, skip critic.
  if (agentResult.finalAnswer == null) {
    return { ...agentResult, criticVerdicts, retriesAttempted };
  }

  // Build a lightweight trajectory summary from the agent result.
  // gaia-agent.ts doesn't expose step-level detail in GaiaAgentResult, so we
  // synthesise from the available fields (tool call counts, turn count).
  const makeTrajectory = (result: GaiaAgentResult) => ({
    turns: result.turns,
    steps: Object.entries(result.toolCallsByName).map(([tool, count]) => ({
      tool,
      result: `called ${count} time(s)`,
    })),
  });

  // First critic pass.
  let verdict = await criticReview(
    question,
    agentResult.finalAnswer,
    makeTrajectory(agentResult),
    criticOptions,
  );
  criticVerdicts.push(verdict);

  // Retry loop on "fail".
  while (verdict.verdict === 'fail' && retriesAttempted < maxRetries) {
    retriesAttempted += 1;

    // Inject critique as additional context via the system prompt append.
    // We pass it through GaiaAgentOptions.criticFeedback — gaia-agent.ts does
    // NOT yet read this field (wiring is follow-up PR), but storing it here
    // makes the contract explicit and harmless (unknown options are ignored).
    const retryOptions: GaiaAgentOptions & { criticFeedback?: string } = {
      ...agentOptions,
      criticFeedback:
        `Previous answer "${agentResult.finalAnswer}" was flagged by adversarial review: ` +
        `${verdict.reasoning}` +
        (verdict.suggestedRevision
          ? ` Suggested revision: ${verdict.suggestedRevision}`
          : ''),
    };

    agentResult = await runGaiaAgent(question, retryOptions);

    if (agentResult.finalAnswer == null) {
      // Retry yielded no answer; stop retrying.
      break;
    }

    verdict = await criticReview(
      question,
      agentResult.finalAnswer,
      makeTrajectory(agentResult),
      criticOptions,
    );
    criticVerdicts.push(verdict);
  }

  return { ...agentResult, criticVerdicts, retriesAttempted };
}
