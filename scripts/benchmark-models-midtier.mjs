#!/usr/bin/env node
/**
 * benchmark-models-midtier.mjs — Real measured benchmark of mid-tier
 * (sonnet-class) model alternatives via OpenRouter, with LLM-as-judge
 * grading because regex won't capture multi-step refactor quality.
 *
 * What this measures, per model:
 *   - latency: per-query mean, p50, p95, stdev (with --repeat > 1)
 *   - quality: judge score 0..1 from a strong judge model
 *              (default: anthropic/claude-sonnet-4-6) over a 5-criterion rubric
 *   - cost:    USD per query from OpenRouter's `usage` field
 *
 * The judge sees the user prompt + the candidate's response + a per-row
 * rubric, then returns a JSON verdict. Two layers of grading:
 *   1. Structural checks (lightweight regex/include) — fail fast on egregious
 *      output (empty, refused, didn't even attempt).
 *   2. Judge rubric — for everything that passes structural, a 0..1 score
 *      reflecting how well the response actually solved the task.
 *
 * USAGE
 *   # Dry-run (default — no API calls, prints projected cost)
 *   node scripts/benchmark-models-midtier.mjs
 *
 *   # Live — REAL OpenRouter API calls, spends real money
 *   OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-models-midtier.mjs --live
 *
 *   # Custom model list / repeats / judge
 *   node scripts/benchmark-models-midtier.mjs --live --models a,b --repeat 2 --judge anthropic/claude-sonnet-4-6
 *
 * COST NOTE: mid-tier responses are longer (~600-800 tokens) so each call
 * is more expensive than the cheap-tier bench. The judge call is also a
 * mid-class model. Default 7 models × 12 queries × 1 repeat + judges
 * projects to ~$0.20-0.40 USD. --max-cost gate defaults to $1.00.
 *
 * Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// ============================================================================
// Models under test (sonnet-tier focus)
// ============================================================================

const DEFAULT_MODELS = [
  // Anthropic baseline (the tier this corpus is designed against)
  { id: 'anthropic/claude-sonnet-4-6',          in_per_m: 3.00,  out_per_m: 15.00, family: 'anthropic' },
  // OpenAI
  { id: 'openai/gpt-4.1',                       in_per_m: 2.00,  out_per_m: 8.00,  family: 'openai' },
  { id: 'openai/gpt-5-mini',                    in_per_m: 0.25,  out_per_m: 2.00,  family: 'openai' },
  // Google
  { id: 'google/gemini-2.5-pro',                in_per_m: 1.25,  out_per_m: 10.00, family: 'google' },
  { id: 'google/gemini-2.5-flash',              in_per_m: 0.30,  out_per_m: 2.50,  family: 'google' },
  // Meta
  { id: 'meta-llama/llama-3.3-70b-instruct',    in_per_m: 0.13,  out_per_m: 0.40,  family: 'meta' },
  // Qwen
  { id: 'qwen/qwen3-32b',                       in_per_m: 0.10,  out_per_m: 0.30,  family: 'qwen' },
];

const DEFAULT_JUDGE = 'anthropic/claude-sonnet-4-6';

// ============================================================================
// Mid-tier corpus — 12 multi-step / multi-criterion tasks
// ============================================================================

/**
 * Each task has:
 *   id: stable identifier
 *   task: the user prompt sent to the candidate model
 *   structural: lightweight check (substring/regex) — if any is missing the
 *               judge stage is skipped and the row scores 0
 *   rubric: 3-5 criteria the judge grades, each as a `{name, weight}` pair.
 *           Weights sum to 1.0.
 */
const CORPUS = [
  {
    id: 'refactor-strategy-1',
    task: `Refactor this if/else chain into the Strategy pattern using TypeScript classes. Return ONLY the refactored code, no prose.

\`\`\`ts
function processPayment(method: string, amount: number) {
  if (method === 'card') {
    return { ok: true, txn: 'card-' + amount };
  } else if (method === 'paypal') {
    return { ok: true, txn: 'pp-' + amount };
  } else if (method === 'bank') {
    return { ok: amount > 10, txn: amount > 10 ? 'b-' + amount : null };
  }
  throw new Error('unknown method');
}
\`\`\``,
    structural: { mustInclude: ['class', 'interface', 'process'], mustNotInclude: [] },
    rubric: [
      { name: 'has_strategy_interface', weight: 0.25, desc: 'Defines an interface or abstract class with a process() (or similar) method' },
      { name: 'has_per_method_class',   weight: 0.25, desc: 'Has a concrete class per payment method (card/paypal/bank)' },
      { name: 'preserves_semantics',    weight: 0.30, desc: 'Behavior matches original (returns same shape, bank still has the amount > 10 condition)' },
      { name: 'idiomatic_typescript',   weight: 0.10, desc: 'Uses proper TS types, no any abuse, reasonable naming' },
      { name: 'no_extraneous_prose',    weight: 0.10, desc: 'Returned code only, no surrounding explanation/markdown' },
    ],
  },
  {
    id: 'design-event-sourcing-1',
    task: `Design the minimal TypeScript types for an event-sourced bank account: Event union (Deposit, Withdraw, AccountOpened, AccountClosed), a Reducer function, and a Snapshot type. Each event has timestamp and id. Withdraw must include a 'reason'. Return ONLY the TypeScript types and reducer, no prose.`,
    structural: { mustInclude: ['type', 'Event', 'Reducer', 'Snapshot'], mustNotInclude: [] },
    rubric: [
      { name: 'discriminated_union',    weight: 0.25, desc: 'Event is a tagged/discriminated union with a kind/type field' },
      { name: 'reducer_signature',      weight: 0.20, desc: 'Reducer is (state, event) => state, exhaustive over kinds' },
      { name: 'withdraw_reason',        weight: 0.15, desc: 'Withdraw event has a reason field' },
      { name: 'snapshot_separate',      weight: 0.20, desc: 'Snapshot is a distinct type (running balance + open/closed state)' },
      { name: 'no_extraneous_prose',    weight: 0.20, desc: 'Returned code only' },
    ],
  },
  {
    id: 'security-jwt-audit-1',
    task: `Audit this JWT-handling code for 3 specific security issues and propose a corrected version. Return your answer as JSON: { "issues": [{"line": N, "issue": "...", "severity": "high|medium|low"}], "fixed_code": "..." }. No prose outside the JSON.

\`\`\`js
const jwt = require('jsonwebtoken');
function verify(token) {
  const secret = process.env.JWT_SECRET || 'devsecret';
  const decoded = jwt.verify(token, secret);
  console.log('user:', decoded);
  return decoded;
}
\`\`\``,
    structural: { mustInclude: ['issues', 'fixed_code'], mustNotInclude: [] },
    rubric: [
      { name: 'flags_default_secret',   weight: 0.25, desc: 'Identifies the fallback "devsecret" as a security issue' },
      { name: 'flags_missing_alg',      weight: 0.20, desc: 'Identifies that no algorithms whitelist is passed to verify()' },
      { name: 'flags_unsafe_log',       weight: 0.15, desc: 'Identifies that logging the full decoded token can leak PII / claims' },
      { name: 'fix_addresses_issues',   weight: 0.25, desc: 'Fixed code actually addresses the flagged issues' },
      { name: 'valid_json_format',      weight: 0.15, desc: 'Output is parseable JSON matching the requested shape' },
    ],
  },
  {
    id: 'algo-sliding-window-1',
    task: `Implement a JavaScript function \`longestSubarrayWithSumAtMost(arr, k)\` that returns the length of the longest contiguous subarray whose sum is <= k. Use the sliding-window technique (O(n)). Include 3 inline test cases as comments showing input → expected output. Return ONLY the JavaScript, no prose.`,
    structural: { mustInclude: ['function', 'longestSubarrayWithSumAtMost'], mustNotInclude: [] },
    rubric: [
      { name: 'correct_algorithm',      weight: 0.35, desc: 'Implementation correctly returns the longest subarray length; sliding window with two pointers' },
      { name: 'is_linear_time',         weight: 0.20, desc: 'O(n) — does not use a nested loop or quadratic structure' },
      { name: 'has_3_test_cases',       weight: 0.20, desc: 'Has 3 inline test cases with expected outputs in comments' },
      { name: 'edge_cases_handled',     weight: 0.15, desc: 'Handles empty array, k smaller than smallest element, etc.' },
      { name: 'no_extraneous_prose',    weight: 0.10, desc: 'Returned code only' },
    ],
  },
  {
    id: 'sql-migration-1',
    task: `Write a PostgreSQL migration that adds a NOT NULL \`created_at TIMESTAMPTZ\` column with default NOW() to a 50M-row \`orders\` table, AND a separate down migration. The migration must be safe to run on a live system without locking writes for more than ~1s. Return ONLY the two SQL files concatenated, separated by '-- DOWN --'. No prose.`,
    structural: { mustInclude: ['ALTER TABLE', 'orders', '-- DOWN --'], mustNotInclude: [] },
    rubric: [
      { name: 'staged_approach',        weight: 0.30, desc: 'Adds the column as nullable first, backfills, then sets NOT NULL — or uses DEFAULT NOW() with a known-safe technique. Does not block writes.' },
      { name: 'idempotent_safe',        weight: 0.15, desc: 'Uses IF NOT EXISTS or equivalent guards so re-running is safe' },
      { name: 'down_reverses',          weight: 0.20, desc: 'Down migration removes the column cleanly' },
      { name: 'tx_or_no_tx_correct',    weight: 0.20, desc: 'Either avoids a single huge transaction (for the live constraint) or explains why it is needed' },
      { name: 'no_extraneous_prose',    weight: 0.15, desc: 'Returned SQL only, with the -- DOWN -- separator' },
    ],
  },
  {
    id: 'rate-limiter-1',
    task: `Implement a token-bucket rate limiter in TypeScript with this signature: \`class TokenBucket { constructor(capacity: number, refillRatePerSec: number); tryAcquire(tokens?: number): boolean; }\`. The bucket refills lazily on each check. Include JSDoc on the public methods. Return ONLY the TS class, no prose.`,
    structural: { mustInclude: ['class TokenBucket', 'tryAcquire', 'capacity'], mustNotInclude: [] },
    rubric: [
      { name: 'lazy_refill',            weight: 0.30, desc: 'Refills based on elapsed time since last check, not a timer/interval' },
      { name: 'cap_at_capacity',        weight: 0.15, desc: 'Available tokens are clamped to capacity' },
      { name: 'correct_signature',      weight: 0.20, desc: 'Constructor and tryAcquire match the requested signature' },
      { name: 'jsdoc_on_public',        weight: 0.15, desc: 'Has JSDoc on the constructor and tryAcquire' },
      { name: 'no_extraneous_prose',    weight: 0.20, desc: 'Returned code only' },
    ],
  },
  {
    id: 'tests-london-school-1',
    task: `Write 3 Vitest unit tests in TDD London School (mock-first) style for this UserService. Use vi.fn() / vi.mock to mock the repo. The tests should cover: (1) findById returns the user when repo finds one, (2) findById returns null when repo returns null, (3) createUser calls repo.save with normalized input (lowercased email). Return ONLY the test code, no prose.

\`\`\`ts
class UserService {
  constructor(private repo: { findById(id: string): User | null; save(u: User): User }) {}
  findById(id: string) { return this.repo.findById(id); }
  createUser(input: { email: string; name: string }) {
    return this.repo.save({ id: 'new', email: input.email.toLowerCase(), name: input.name });
  }
}
\`\`\``,
    structural: { mustInclude: ['vi.fn', 'expect', 'it'], mustNotInclude: [] },
    rubric: [
      { name: 'mock_first_pattern',     weight: 0.25, desc: 'Repo is mocked via vi.fn or vi.mock; assertions check on the mock' },
      { name: 'covers_3_cases',         weight: 0.30, desc: 'Has 3 distinct test cases covering the requested behaviors' },
      { name: 'asserts_normalization',  weight: 0.20, desc: 'Test 3 actually asserts that repo.save was called with a lowercased email' },
      { name: 'idiomatic_vitest',       weight: 0.15, desc: 'Uses describe/it, expect.toBeCalledWith, etc. correctly' },
      { name: 'no_extraneous_prose',    weight: 0.10, desc: 'Returned test code only' },
    ],
  },
  {
    id: 'api-design-1',
    task: `Design the OpenAPI 3.0 paths block (just the paths, not full spec) for a REST API around a Todo resource: list (with cursor pagination), get-by-id, create, partial-update, delete. Include the response schemas inline (no $ref). Return ONLY YAML, no prose.`,
    structural: { mustInclude: ['paths:', '/todos', 'get:', 'post:'], mustNotInclude: [] },
    rubric: [
      { name: 'all_five_operations',    weight: 0.25, desc: 'Has list, get-by-id, create, patch/partial-update, delete' },
      { name: 'cursor_pagination',      weight: 0.20, desc: 'List uses a cursor parameter (and ideally a nextCursor in the response)' },
      { name: 'inline_schemas',         weight: 0.20, desc: 'Response schemas are inline as requested, not $ref' },
      { name: 'valid_yaml_structure',   weight: 0.20, desc: 'Output is structurally valid YAML under the paths key' },
      { name: 'no_extraneous_prose',    weight: 0.15, desc: 'Returned YAML only' },
    ],
  },
  {
    id: 'reasoning-tradeoffs-1',
    task: `Compare CRDT and OT (Operational Transform) for a collaborative text editor. List 4 concrete trade-offs as JSON: { "tradeoffs": [{"dimension": "...", "crdt": "...", "ot": "...", "favors": "crdt|ot|neither"}] }. No prose outside the JSON.`,
    structural: { mustInclude: ['tradeoffs', 'crdt', 'ot'], mustNotInclude: [] },
    rubric: [
      { name: 'valid_json_format',      weight: 0.20, desc: 'Output is parseable JSON matching the requested shape' },
      { name: 'four_distinct_dims',     weight: 0.25, desc: 'Four distinct dimensions, not duplicates' },
      { name: 'technically_accurate',   weight: 0.30, desc: 'Trade-offs are technically correct (e.g., CRDT does not need a central server, OT typically does; CRDT data structures are typically larger; etc.)' },
      { name: 'verdict_is_meaningful',  weight: 0.15, desc: 'The "favors" field is not always the same value and reflects the dimension' },
      { name: 'no_extraneous_prose',    weight: 0.10, desc: 'JSON only, nothing else' },
    ],
  },
  {
    id: 'concurrent-bug-1',
    task: `Find the race condition in this Node.js code and produce a corrected version. The original tries to atomically increment a counter in a JSON file. Return your answer as JSON: { "bug": "...", "why_unsafe": "...", "fixed_code": "..." }. No prose outside the JSON.

\`\`\`js
const fs = require('fs');
async function increment() {
  const data = JSON.parse(await fs.promises.readFile('counter.json'));
  data.n += 1;
  await fs.promises.writeFile('counter.json', JSON.stringify(data));
}
\`\`\``,
    structural: { mustInclude: ['bug', 'fixed_code'], mustNotInclude: [] },
    rubric: [
      { name: 'identifies_race',        weight: 0.30, desc: 'Identifies the read-modify-write race between concurrent increments' },
      { name: 'fix_uses_lock_or_atomic',weight: 0.30, desc: 'Fix uses a file lock, atomic rename, or another concurrency-safe mechanism' },
      { name: 'fix_actually_works',     weight: 0.20, desc: 'Fixed code would actually prevent the race (not just rearrange the same race)' },
      { name: 'valid_json_format',      weight: 0.10, desc: 'Output is parseable JSON' },
      { name: 'no_extraneous_prose',    weight: 0.10, desc: 'JSON only' },
    ],
  },
  {
    id: 'regex-complex-1',
    task: `Write a JavaScript regex that matches: (a) a URL starting with https:// (b) on the github.com domain (c) a pull request URL of the form /owner/repo/pull/NUMBER. Capture owner, repo, and number as named groups. Then write 3 inline test cases (valid, invalid, edge) as JS asserts. Return ONLY the JS, no prose.`,
    structural: { mustInclude: ['regex', '/pull/'], mustNotInclude: [] },
    rubric: [
      { name: 'correct_pattern',        weight: 0.35, desc: 'Regex correctly matches the described shape (github.com host, /pull/N path)' },
      { name: 'named_groups',           weight: 0.20, desc: 'Uses (?<owner>...), (?<repo>...), (?<number>...) named captures' },
      { name: 'rejects_non_github',     weight: 0.15, desc: 'Test cases include an invalid non-github URL that the regex rejects' },
      { name: 'edge_case_meaningful',   weight: 0.15, desc: 'Third test case is a real edge case (e.g., trailing slash, query params, sub-paths)' },
      { name: 'no_extraneous_prose',    weight: 0.15, desc: 'Returned code only' },
    ],
  },
  {
    id: 'docker-multistage-1',
    task: `Write a Dockerfile that builds a TypeScript Node.js app in a multi-stage build: stage 1 installs deps + compiles, stage 2 is a slim production image with ONLY the compiled output and prod node_modules. Use \`node:20-alpine\`. Cache npm install separately from the source copy. Return ONLY the Dockerfile, no prose.`,
    structural: { mustInclude: ['FROM node:20-alpine', 'COPY', 'AS '], mustNotInclude: [] },
    rubric: [
      { name: 'multi_stage_present',    weight: 0.30, desc: 'Has at least two FROM stages with AS names' },
      { name: 'dep_install_cached',     weight: 0.25, desc: 'Copies package.json/package-lock.json first and runs npm install before copying source' },
      { name: 'prod_image_slim',        weight: 0.20, desc: 'Final stage uses npm install --omit=dev (or equivalent) and copies only dist + node_modules' },
      { name: 'uses_alpine_20',         weight: 0.10, desc: 'Both FROMs use node:20-alpine' },
      { name: 'no_extraneous_prose',    weight: 0.15, desc: 'Returned Dockerfile only' },
    ],
  },
];

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv) {
  const a = { live: false, models: null, judge: DEFAULT_JUDGE, maxCost: 1.00, repeat: 1, maxTokens: 768, save: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--models') a.models = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--judge') a.judge = argv[++i];
    else if (k === '--max-cost') a.maxCost = parseFloat(argv[++i]);
    else if (k === '--repeat') a.repeat = parseInt(argv[++i], 10) || 1;
    else if (k === '--max-tokens') a.maxTokens = parseInt(argv[++i], 10) || 768;
    else if (k === '--no-save') a.save = false;
    else if (k === '--help' || k === '-h') {
      console.log('Usage: node scripts/benchmark-models-midtier.mjs [--live] [--models a,b,c] [--judge id] [--max-cost USD] [--repeat N] [--max-tokens N] [--no-save]');
      process.exit(0);
    }
  }
  return a;
}
const ARGS = parseArgs(process.argv);

const MODELS = ARGS.models
  ? DEFAULT_MODELS.filter(m => ARGS.models.includes(m.id)).concat(
      ARGS.models.filter(id => !DEFAULT_MODELS.find(m => m.id === id))
        .map(id => ({ id, in_per_m: 0, out_per_m: 0, family: 'unknown' }))
    )
  : DEFAULT_MODELS;

// ============================================================================
// Cost projection (used in dry-run and as a refuse-to-run gate)
// ============================================================================

const AVG_IN_TOK = 250;   // mid-tier prompts are longer (~250 input tokens)
const AVG_OUT_TOK = 500;  // and responses are longer (~500 output tokens)
const JUDGE_IN_TOK  = 600;  // judge sees prompt + response + rubric
const JUDGE_OUT_TOK = 200;  // judge returns compact JSON

function projectedCost() {
  let total = 0;
  for (const m of MODELS) {
    const perQuery = (AVG_IN_TOK * m.in_per_m + AVG_OUT_TOK * m.out_per_m) / 1_000_000;
    total += perQuery * CORPUS.length * ARGS.repeat;
  }
  // Judge cost: 1 call per (model, query, repeat). Assume judge price is
  // ~claude-sonnet-4-6 = $3 in / $15 out per Mtok unless overridden.
  const judgePerCall = (JUDGE_IN_TOK * 3.0 + JUDGE_OUT_TOK * 15.0) / 1_000_000;
  total += judgePerCall * MODELS.length * CORPUS.length * ARGS.repeat;
  return total;
}

// ============================================================================
// OpenRouter chat-completion call
// ============================================================================

async function callOpenRouter(modelId, userPrompt, apiKey, opts = {}) {
  const t0 = performance.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ruvnet/ruflo',
      'X-Title': 'ruflo-benchmark-midtier',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: opts.maxTokens ?? ARGS.maxTokens,
      temperature: opts.temperature ?? 0.0,
    }),
  });
  const dt = performance.now() - t0;
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error?.message ?? text.slice(0, 200), latencyMs: dt };
  }
  const content = body?.choices?.[0]?.message?.content ?? '';
  const usage = body?.usage ?? {};
  return {
    ok: true,
    content,
    latencyMs: dt,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

// ============================================================================
// Grading — structural pass/fail, then LLM judge for the rubric
// ============================================================================

function structuralPass(row, content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) return { ok: false, reason: 'empty response' };
  for (const s of row.structural.mustInclude ?? []) {
    if (!content.includes(s)) return { ok: false, reason: `missing required substring "${s}"` };
  }
  for (const s of row.structural.mustNotInclude ?? []) {
    if (content.includes(s)) return { ok: false, reason: `contains banned substring "${s}"` };
  }
  return { ok: true };
}

function buildJudgePrompt(row, response) {
  const rubricList = row.rubric.map(r => `  - ${r.name} (weight ${r.weight}): ${r.desc}`).join('\n');
  return `You are grading an AI model's response to a coding task. Score each rubric criterion as 0.0 (fails), 0.5 (partial), or 1.0 (meets). Return ONLY a JSON object of the form: {"scores": {"<criterion>": <0|0.5|1>}, "comment": "<≤80-char comment>"}. No prose outside the JSON.

USER PROMPT TO THE MODEL:
${row.task}

MODEL'S RESPONSE:
${response}

RUBRIC:
${rubricList}

Reminder: return ONLY the JSON object. Be strict — only award 1.0 if the criterion is unambiguously met.`;
}

function aggregateRubric(row, judgeJson) {
  if (!judgeJson || typeof judgeJson !== 'object') return { score: 0, breakdown: {}, error: 'no judge output' };
  const scores = judgeJson.scores ?? {};
  let total = 0;
  const breakdown = {};
  for (const crit of row.rubric) {
    const v = typeof scores[crit.name] === 'number' ? Math.max(0, Math.min(1, scores[crit.name])) : 0;
    breakdown[crit.name] = v;
    total += v * crit.weight;
  }
  return { score: total, breakdown, comment: typeof judgeJson.comment === 'string' ? judgeJson.comment.slice(0, 120) : '' };
}

async function judge(row, response, apiKey) {
  const prompt = buildJudgePrompt(row, response);
  const r = await callOpenRouter(ARGS.judge, prompt, apiKey, { maxTokens: 512, temperature: 0.0 });
  if (!r.ok) return { ok: false, error: r.error, ...aggregateRubric(row, null), usdCost: 0 };
  // Extract the first JSON object from the response (tolerant of stray text).
  const match = r.content.match(/\{[\s\S]*\}/);
  let parsed = null;
  if (match) { try { parsed = JSON.parse(match[0]); } catch { /* fall through */ } }
  const agg = aggregateRubric(row, parsed);
  // Compute judge cost using Sonnet's listed price (used as proxy if --judge differs).
  const judgeIn = 3.00; const judgeOut = 15.00;
  const usdCost = (r.promptTokens * judgeIn + r.completionTokens * judgeOut) / 1_000_000;
  return { ok: true, ...agg, usdCost, latencyMs: r.latencyMs };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('# Mid-tier model benchmark (ADR-148 phase 2 follow-up)\n');
  console.log(`- ts: ${new Date().toISOString().slice(0, 19)}Z`);
  console.log(`- node: ${process.version}  platform: ${process.platform}-${process.arch}`);
  console.log(`- corpus: ${CORPUS.length} mid-tier queries × ${ARGS.repeat} repeat`);
  console.log(`- models: ${MODELS.length} (${MODELS.map(m => m.id).join(', ')})`);
  console.log(`- judge: ${ARGS.judge}`);
  console.log(`- max-tokens per response: ${ARGS.maxTokens}`);
  const projected = projectedCost();
  console.log(`- projected total cost (incl. judge): ~$${projected.toFixed(4)} USD`);
  console.log(`- max-cost gate: $${ARGS.maxCost.toFixed(2)}`);
  console.log(`- live mode: ${ARGS.live ? '**YES — real API calls**' : 'no (dry run)'}\n`);

  if (!ARGS.live) {
    console.log('Dry run — no API calls. To run live:');
    console.log(`  OPENROUTER_API_KEY=sk-or-... node scripts/benchmark-models-midtier.mjs --live\n`);
    console.log('===BENCH_JSON===');
    console.log(JSON.stringify({ dryRun: true, projectedCostUSD: projected, models: MODELS.map(m => m.id), judge: ARGS.judge, corpusSize: CORPUS.length }, null, 2));
    return;
  }

  if (!apiKey) {
    console.error('[bench] --live requires OPENROUTER_API_KEY in env.');
    process.exit(2);
  }
  if (projected > ARGS.maxCost) {
    console.error(`[bench] projected $${projected.toFixed(4)} > --max-cost $${ARGS.maxCost.toFixed(2)}; refusing. Override with --max-cost.`);
    process.exit(3);
  }

  const results = MODELS.map(m => ({
    model: m.id, family: m.family,
    latencies: [], structuralPasses: 0, scores: [],
    total: 0, errors: [], usdCost: 0, judgeUsdCost: 0,
    promptTokens: 0, completionTokens: 0,
  }));

  for (let r = 0; r < ARGS.repeat; r++) {
    for (const row of CORPUS) {
      // Parallel across models for this row
      const tasks = MODELS.map((m, mi) => async () => {
        const acc = results[mi];
        try {
          const resp = await callOpenRouter(m.id, row.task, apiKey);
          acc.total++;
          acc.latencies.push(resp.latencyMs);
          if (!resp.ok) {
            acc.errors.push({ row: row.id, status: resp.status, error: resp.error });
            acc.scores.push(0);
            return;
          }
          acc.promptTokens += resp.promptTokens;
          acc.completionTokens += resp.completionTokens;
          acc.usdCost += (resp.promptTokens * m.in_per_m + resp.completionTokens * m.out_per_m) / 1_000_000;
          const sp = structuralPass(row, resp.content);
          if (!sp.ok) {
            acc.scores.push(0);
            acc.errors.push({ row: row.id, error: `structural: ${sp.reason}` });
            return;
          }
          acc.structuralPasses++;
          // Judge stage
          const j = await judge(row, resp.content, apiKey);
          acc.judgeUsdCost += j.usdCost;
          acc.scores.push(j.score);
        } catch (e) {
          acc.total++;
          acc.scores.push(0);
          acc.errors.push({ row: row.id, error: e instanceof Error ? e.message : String(e) });
        }
      });
      await Promise.all(tasks.map(t => t()));
    }
  }

  const showStdev = ARGS.repeat > 1;
  const rows = results.map(r => {
    const sorted = r.latencies.slice().sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0;
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    let lstdev = 0;
    if (sorted.length > 1) {
      const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (sorted.length - 1);
      lstdev = Math.sqrt(variance);
    }
    const avgScore = r.scores.length ? r.scores.reduce((s, x) => s + x, 0) / r.scores.length : 0;
    let sstdev = 0;
    if (r.scores.length > 1) {
      const v = r.scores.reduce((s, x) => s + (x - avgScore) ** 2, 0) / (r.scores.length - 1);
      sstdev = Math.sqrt(v);
    }
    return {
      model: r.model, family: r.family,
      avgScore, scoreStdev: sstdev,
      structuralPassRate: r.total ? r.structuralPasses / r.total : 0,
      total: r.total,
      latency: { mean, p50, p95, stdev: lstdev },
      usdCost: r.usdCost, judgeUsdCost: r.judgeUsdCost,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens,
      errorCount: r.errors.length,
      errorSample: r.errors.slice(0, 2),
    };
  });

  // Sort: judge score desc, then $/query asc — Pareto-friendly
  rows.sort((a, b) => b.avgScore - a.avgScore || a.usdCost - b.usdCost);

  console.log(`| Model | Family | Avg score | Struct pass | Latency mean${showStdev ? ' ± σ' : ''} | $/run | $/quality |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    const qualityCost = r.avgScore > 0 ? r.usdCost / r.avgScore : Infinity;
    const lat = showStdev
      ? `${r.latency.mean.toFixed(0)} ± ${r.latency.stdev.toFixed(0)} ms`
      : `${r.latency.mean.toFixed(0)} ms`;
    console.log(`| \`${r.model}\` | ${r.family} | **${(r.avgScore * 100).toFixed(1)}%${showStdev ? ' ± ' + (r.scoreStdev * 100).toFixed(1) + '%' : ''}** | ${(r.structuralPassRate * 100).toFixed(0)}% | ${lat} | $${r.usdCost.toFixed(5)} | ${qualityCost === Infinity ? '∞' : '$' + qualityCost.toFixed(5)} |`);
  }
  console.log('');
  console.log(`Total model spend: $${rows.reduce((s, r) => s + r.usdCost, 0).toFixed(5)}`);
  console.log(`Total judge spend: $${rows.reduce((s, r) => s + r.judgeUsdCost, 0).toFixed(5)}`);
  console.log(`Total errors: ${rows.reduce((s, r) => s + r.errorCount, 0)}`);
  console.log('');

  if (ARGS.save) {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + 'Z';
    const outDir = resolvePath(REPO_ROOT, 'docs', 'benchmarks', 'runs');
    mkdirSync(outDir, { recursive: true });
    const jsonPath = resolvePath(outDir, `midtier-models-${ts}.json`);
    writeFileSync(jsonPath, JSON.stringify({
      meta: { ts: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, args: ARGS, judge: ARGS.judge, corpusSize: CORPUS.length },
      results: rows,
    }, null, 2));
    console.log(`Saved: ${jsonPath}`);
  }
  console.log('\n===BENCH_JSON===');
  console.log(JSON.stringify({ rows, totalModelUSD: rows.reduce((s, r) => s + r.usdCost, 0), totalJudgeUSD: rows.reduce((s, r) => s + r.judgeUsdCost, 0) }, null, 2));
}

main().catch(e => { console.error('[bench] fatal:', e); process.exit(1); });
