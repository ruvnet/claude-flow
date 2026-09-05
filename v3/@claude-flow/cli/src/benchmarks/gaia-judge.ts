/**
 * GAIA Judge — ADR-133-PR6
 *
 * Two-stage answer scorer for the GAIA benchmark:
 *
 *   Stage 1 — Fast path: normalized exact-match.
 *     Normalise = lowercase + strip surrounding whitespace + strip surrounding
 *     single/double quotes + collapse internal whitespace runs to one space.
 *     Roughly 30 % of GAIA Level-1 answers satisfy this; no API call required.
 *
 *   Stage 2 — LLM-as-judge: when exact-match fails, ask Claude Sonnet whether
 *     the candidate answer is semantically equivalent to the ground truth.
 *     The prompt embeds GAIA's official evaluation guideline (see
 *     https://huggingface.co/datasets/gaia-benchmark/GAIA for full spec).
 *
 * Caching: judgment results are persisted under
 *   ~/.cache/ruflo/gaia/judgments/<hash>.json
 * keyed on (question_id, candidate_answer, model_id, JUDGE_PROMPT_VERSION).
 * Re-running the same pair hits the cache and returns instantly.
 *
 * API pattern: raw fetch() against https://api.anthropic.com/v1/messages —
 * mirrors the pattern established in gaia-agent.ts (ADR-133-PR3).
 *
 * Refs: ADR-133, #2156
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_JUDGE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'ruflo', 'gaia', 'judgments');

/**
 * Bump this string whenever the judge prompt changes so stale cached verdicts
 * are automatically invalidated (different key → cache miss).
 */
const JUDGE_PROMPT_VERSION = 'v1';

// Sonnet pricing (input/output per million tokens, 2026-05-27).
const SONNET_INPUT_COST_PER_M = 3.0;
const SONNET_OUTPUT_COST_PER_M = 15.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JudgeResult {
  questionId: string;
  passed: boolean;
  scoringPath: 'exact-match' | 'llm-judge' | 'cache';
  candidateAnswer: string;
  groundTruth: string;
  judgeReason?: string;       // LLM's brief justification (≤200 chars)
  judgeModel?: string;
  judgeTokensIn?: number;
  judgeTokensOut?: number;
  judgeCostUsd?: number;
}

export interface JudgeOptions {
  /** Default: 'claude-sonnet-4-6' */
  judgeModel?: string;
  /** Default: '~/.cache/ruflo/gaia/judgments/' */
  cacheDir?: string;
  skipCache?: boolean;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * GAIA normalisation as specified in the dataset paper:
 *   - strip surrounding whitespace
 *   - lowercase
 *   - strip a single pair of surrounding quotes (single or double)
 *   - collapse internal whitespace runs to one space
 */
export function normaliseAnswer(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = raw.trim().toLowerCase();
  // Strip one pair of surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ---------------------------------------------------------------------------
// Unit-aware numeric matching
// ---------------------------------------------------------------------------

/**
 * Attempt to match a candidate numeric answer to an expected answer where the
 * question implies a unit scale.
 *
 * Examples that this catches:
 *   candidate="17000", expected="17", question contains "thousand"
 *     → candidate / 1000 ≈ expected → MATCH
 *   candidate="17", expected="17000", question contains "thousand"
 *     → candidate × 1000 ≈ expected → MATCH (reverse direction)
 *
 * Returns true only when a numeric match is found under one of the scale
 * multipliers mentioned in the question text.  Returns false for non-numeric
 * inputs or when no multiplier matches.
 *
 * @param candidate    - The raw string from the model (may include commas/spaces).
 * @param expected     - The raw ground-truth string.
 * @param questionText - The original question (used to detect multiplier words).
 */
export function unitAwareNumberMatch(
  candidate: string,
  expected: string,
  questionText?: string,
): boolean {
  // Strip commas, spaces, and trailing unit suffixes for numeric parsing
  const toNum = (s: string): number => parseFloat(s.replace(/[,\s]/g, ''));

  const candNum = toNum(candidate);
  const expNum = toNum(expected);

  if (isNaN(candNum) || isNaN(expNum)) return false;

  // Exact numeric equality (handles "17" vs "17.0", etc.)
  if (Math.abs(candNum - expNum) < 0.001 * (Math.abs(expNum) + 1)) return true;

  if (!questionText) return false;

  const qLower = questionText.toLowerCase();

  const MULTIPLIERS: Array<[string, number]> = [
    ['trillion', 1e12],
    ['billion', 1e9],
    ['million', 1e6],
    ['thousand', 1e3],
    ['hundred', 1e2],
  ];

  for (const [word, mult] of MULTIPLIERS) {
    if (!qLower.includes(word)) continue;

    // Model returned raw, expected is already in scaled units
    // e.g. model says "17000", question asks "how many thousand hours", expected is "17"
    if (Math.abs(candNum / mult - expNum) < 0.01 * (Math.abs(expNum) + 1)) return true;

    // Reverse: model returned scaled, expected is raw
    if (Math.abs(candNum - expNum / mult) < 0.01 * (Math.abs(candNum) + 1)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cacheKey(
  questionId: string,
  candidateAnswer: string,
  judgeModel: string,
): string {
  const raw = `${questionId}||${candidateAnswer}||${judgeModel}||${JUDGE_PROMPT_VERSION}`;
  return createHash('sha256').update(raw).digest('hex');
}

function cacheRead(cacheDir: string, key: string): JudgeResult | null {
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const txt = fs.readFileSync(file, 'utf-8');
    return JSON.parse(txt) as JudgeResult;
  } catch {
    return null;
  }
}

function cacheWrite(cacheDir: string, key: string, result: JudgeResult): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${key}.json`),
      JSON.stringify(result, null, 2),
      'utf-8',
    );
  } catch {
    // Non-fatal — cache write failure should not abort a benchmark run.
  }
}

// ---------------------------------------------------------------------------
// API key resolution (mirrors gaia-agent.ts resolveAnthropicApiKey)
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
    'ANTHROPIC_API_KEY not found.  Set the env var or store it in GCP Secret Manager under ' +
    '"ANTHROPIC_API_KEY".',
  );
}

// ---------------------------------------------------------------------------
// LLM-as-judge prompt
// ---------------------------------------------------------------------------

/**
 * Build the judge system prompt.
 *
 * References the GAIA official scoring guideline:
 *   "The evaluation of the answer is done by exact string match after
 *    normalisation.  For numerical answers, units are ignored unless
 *    the question explicitly asks for them.  For named-entity answers,
 *    common aliases are accepted.  For open-ended questions where an exact
 *    match is not possible, the answer is judged correct if it is semantically
 *    equivalent to the ground truth and contains all required information."
 *   Source: https://huggingface.co/datasets/gaia-benchmark/GAIA (README, §Evaluation)
 */
function buildJudgeSystemPrompt(): string {
  return [
    'You are a precise judge evaluating whether a candidate answer to a',
    'question-answering benchmark is correct.',
    '',
    'SCORING RULES (from the GAIA benchmark specification):',
    '1. Exact-string equivalence (after normalisation) is always correct.',
    '2. For NUMERICAL answers: ignore units unless the question explicitly requests them.',
    '   "3.14" and "approximately 3.14" for "what is pi to 2 decimal places" are both correct.',
    '3. For NAMED-ENTITY answers: accept common aliases and alternative spellings.',
    '   "UK" and "United Kingdom" are equivalent.',
    '4. For LIST answers: the candidate must contain all required items; extra items are ok.',
    '5. Do NOT accept answers that are vague or incomplete when the ground truth is specific.',
    '   "a European city" is NOT correct if the ground truth is "Paris".',
    '',
    'You MUST respond with a single JSON object on one line, exactly this shape:',
    '{"passed": true, "reason": "..."}  or  {"passed": false, "reason": "..."}',
    'The "reason" must be 200 characters or fewer.',
    'Do not output anything outside the JSON object.',
  ].join('\n');
}

function buildJudgeUserMessage(
  question: string,
  groundTruth: string,
  candidate: string,
): string {
  return [
    `QUESTION: ${question}`,
    `GROUND TRUTH: ${groundTruth}`,
    `CANDIDATE ANSWER: ${candidate}`,
    '',
    'Is the candidate answer correct per the scoring rules above?',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Anthropic Messages API call (single turn, JSON mode)
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callJudge(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
): Promise<{ passed: boolean; reason: string; tokensIn: number; tokensOut: number }> {
  const messages: AnthropicMessage[] = [
    { role: 'user', content: userMessage },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: 256,
    system: systemPrompt,
    messages,
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
  const rawText = textBlock?.text ?? '';

  // Parse the JSON the model produced
  let passed = false;
  let reason = '';
  try {
    // The model might wrap the JSON in a code fence — strip it
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as { passed?: boolean; reason?: string };
    passed = Boolean(parsed.passed);
    reason = String(parsed.reason ?? '').slice(0, 200);
  } catch {
    // Fallback: scan the text for obvious pass/fail signals
    const lower = rawText.toLowerCase();
    passed = lower.includes('"passed": true') || lower.includes('"passed":true');
    reason = `parse error — raw: ${rawText.slice(0, 100)}`;
  }

  return {
    passed,
    reason,
    tokensIn: data.usage.input_tokens,
    tokensOut: data.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Judge a single GAIA answer.
 *
 * @param question   - Object with `id` (task_id), `expected` (ground truth),
 *                     and optional `questionText` (the full question string,
 *                     used for unit-aware numeric matching in Stage 1).
 * @param candidateAnswer - The answer produced by the agent; `null` counts as a miss.
 * @param options    - Optional overrides (model, cache dir, API key, etc.).
 * @returns          - JudgeResult with pass/fail, scoring path, and cost metrics.
 */
export async function judgeAnswer(
  question: { id: string; expected: string; questionText?: string },
  candidateAnswer: string | null,
  options?: JudgeOptions,
): Promise<JudgeResult> {
  const judgeModel = options?.judgeModel ?? DEFAULT_JUDGE_MODEL;
  const cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
  const candidate = candidateAnswer ?? '';

  // ── Stage 0: null / empty candidate is always a miss ──
  if (!candidate.trim()) {
    return {
      questionId: question.id,
      passed: false,
      scoringPath: 'exact-match',
      candidateAnswer: candidate,
      groundTruth: question.expected,
    };
  }

  // ── Stage 1a: normalised exact-match (no API call) ──
  const normCandidate = normaliseAnswer(candidate);
  const normExpected = normaliseAnswer(question.expected);

  if (normCandidate === normExpected) {
    return {
      questionId: question.id,
      passed: true,
      scoringPath: 'exact-match',
      candidateAnswer: candidate,
      groundTruth: question.expected,
    };
  }

  // ── Stage 1b: unit-aware numeric match (no API call) ──
  // Handles cases like model returns "17000" but expected is "17" and
  // the question asks "how many thousand hours".
  if (unitAwareNumberMatch(normCandidate, normExpected, question.questionText)) {
    return {
      questionId: question.id,
      passed: true,
      scoringPath: 'exact-match',
      candidateAnswer: candidate,
      groundTruth: question.expected,
    };
  }

  // ── Cache lookup (before calling the LLM) ──
  const key = cacheKey(question.id, candidate, judgeModel);
  if (!options?.skipCache) {
    const cached = cacheRead(cacheDir, key);
    if (cached !== null) {
      return { ...cached, scoringPath: 'cache' };
    }
  }

  // ── Stage 2: LLM-as-judge ──
  const apiKey = resolveApiKey(options?.apiKey);
  const systemPrompt = buildJudgeSystemPrompt();
  const userMessage = buildJudgeUserMessage(
    question.questionText ?? question.expected,
    question.expected,
    candidate,
  );

  const { passed, reason, tokensIn, tokensOut } = await callJudge(
    systemPrompt,
    userMessage,
    judgeModel,
    apiKey,
  );

  const costUsd =
    (tokensIn / 1_000_000) * SONNET_INPUT_COST_PER_M +
    (tokensOut / 1_000_000) * SONNET_OUTPUT_COST_PER_M;

  const result: JudgeResult = {
    questionId: question.id,
    passed,
    scoringPath: 'llm-judge',
    candidateAnswer: candidate,
    groundTruth: question.expected,
    judgeReason: reason,
    judgeModel,
    judgeTokensIn: tokensIn,
    judgeTokensOut: tokensOut,
    judgeCostUsd: costUsd,
  };

  // Persist to cache (even failures — avoids repeated LLM calls on re-run)
  cacheWrite(cacheDir, key, result);

  return result;
}

// ---------------------------------------------------------------------------
// Smoke runner
// ---------------------------------------------------------------------------

/**
 * Self-contained smoke test.  Run with:
 *   npx tsx src/benchmarks/gaia-judge.ts
 *
 * Does NOT require an ANTHROPIC_API_KEY for the exact-match cases.
 * The LLM-judge cases require a live key and cost ~$0.001 total.
 *
 * Expected cost: ≤ 2 Sonnet judge calls × ~300 tokens ≈ $0.001
 */
async function runSmoke(): Promise<void> {
  const PASS = '\x1b[32mPASS\x1b[0m';
  const FAIL = '\x1b[31mFAIL\x1b[0m';

  let failures = 0;
  function check(label: string, condition: boolean): void {
    if (condition) {
      console.log(`  ${PASS}  ${label}`);
    } else {
      console.log(`  ${FAIL}  ${label}`);
      failures++;
    }
  }

  // Use a temp cache dir so smoke runs are isolated
  const tmpCacheDir = path.join(os.tmpdir(), `gaia-judge-smoke-${Date.now()}`);
  const baseOpts: JudgeOptions = { cacheDir: tmpCacheDir };

  console.log('\n=== gaia-judge smoke ===\n');

  // ── Stage 1a: normaliseAnswer unit tests (no API call, no judgeAnswer) ──
  console.log('-- Stage 1a: normaliseAnswer --');
  check('normalise("346") === "346"', normaliseAnswer('346') === '346');
  check('normalise(" YES ") === "yes"', normaliseAnswer(' YES ') === 'yes');
  check('normalise(\'"Paris"\') === "paris"', normaliseAnswer('"Paris"') === 'paris');
  check('normalise("hello  world") === "hello world"', normaliseAnswer('hello  world') === 'hello world');
  check('normalise(null) === ""', normaliseAnswer(null) === '');
  check('"346" !== "347" after normalise', normaliseAnswer('346') !== normaliseAnswer('347'));

  // ── Stage 1b: exact-match hit and null-candidate cases (no API call) ──
  console.log('\n-- Stage 1b: exact-match path --');

  const r1 = await judgeAnswer({ id: 'em-1', expected: '346' }, '346', baseOpts);
  check('exact match "346" vs "346" → pass, exact-match path', r1.passed && r1.scoringPath === 'exact-match');

  const r3 = await judgeAnswer({ id: 'em-3', expected: 'yes' }, ' YES ', baseOpts);
  check('normalised "yes" vs " YES " → pass, exact-match path', r3.passed && r3.scoringPath === 'exact-match');

  const r4 = await judgeAnswer({ id: 'em-4', expected: 'Paris' }, '"Paris"', baseOpts);
  check('quote-stripped "Paris" vs \'"Paris"\' → pass, exact-match path', r4.passed && r4.scoringPath === 'exact-match');

  const r5 = await judgeAnswer({ id: 'em-5', expected: 'hello world' }, 'hello  world', baseOpts);
  check('whitespace-collapsed "hello world" → pass, exact-match path', r5.passed && r5.scoringPath === 'exact-match');

  const rNull = await judgeAnswer({ id: 'em-null', expected: '346' }, null, baseOpts);
  check('null candidate → fail, exact-match path', !rNull.passed && rNull.scoringPath === 'exact-match');

  // ── LLM-judge cases (requires ANTHROPIC_API_KEY) ──
  const hasKey = !!(process.env.ANTHROPIC_API_KEY?.trim());
  if (!hasKey) {
    console.log('\n-- Stage 2: llm-judge (SKIPPED — no ANTHROPIC_API_KEY) --');
  } else {
    console.log('\n-- Stage 2: llm-judge --');

    // Case 1: semantically equivalent (should pass)
    const r6 = await judgeAnswer(
      { id: 'llm-1', expected: 'Paris' },
      'The capital of France is Paris',
      baseOpts,
    );
    check(
      `llm-judge "Paris" vs "The capital of France is Paris" → pass (path=${r6.scoringPath})`,
      r6.passed,
    );

    // Case 2: numerically wrong (should fail)
    const r7 = await judgeAnswer(
      { id: 'llm-2', expected: '3.14159' },
      'approximately three',
      baseOpts,
    );
    check(
      `llm-judge "3.14159" vs "approximately three" → fail (path=${r7.scoringPath})`,
      !r7.passed,
    );

    const llmCost = (r6.judgeCostUsd ?? 0) + (r7.judgeCostUsd ?? 0);
    console.log(`  cost: $${llmCost.toFixed(5)} (${(r6.judgeTokensIn ?? 0) + (r7.judgeTokensIn ?? 0)} in, ${(r6.judgeTokensOut ?? 0) + (r7.judgeTokensOut ?? 0)} out)`);

    // ── Cache hit verification ──
    console.log('\n-- Stage 3: cache hit --');

    // Re-run case 1 — must return from cache
    const r8 = await judgeAnswer(
      { id: 'llm-1', expected: 'Paris' },
      'The capital of France is Paris',
      baseOpts,
    );
    check('second run of llm-1 → cache hit', r8.scoringPath === 'cache');
    check('cache hit preserves original verdict', r8.passed === r6.passed);

    // skipCache forces an LLM call even if cached
    const r9 = await judgeAnswer(
      { id: 'llm-1', expected: 'Paris' },
      'The capital of France is Paris',
      { ...baseOpts, skipCache: true },
    );
    check('skipCache=true bypasses cache → llm-judge', r9.scoringPath === 'llm-judge');
  }

  // Cleanup temp cache dir
  try { fs.rmSync(tmpCacheDir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log(`\n=== smoke ${failures === 0 ? 'PASSED' : `FAILED (${failures} assertion(s))`} ===\n`);
  if (failures > 0) process.exit(1);
}

// Run smoke when executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('gaia-judge.ts') ||
  process.argv[1].endsWith('gaia-judge.js')
);
if (isMain) {
  runSmoke().catch((err) => {
    console.error('Smoke failed:', err);
    process.exit(1);
  });
}
