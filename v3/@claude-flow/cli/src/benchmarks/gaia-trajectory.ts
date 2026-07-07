/**
 * GAIA trajectory serialization — ADR-167 §4 forward contract.
 *
 * Turns the in-memory `messages[]` array that `runGaiaAgent` already builds
 * into the per-question `trajectories.jsonl` record that
 * `plugins/ruflo-workflows/scripts/gaia-audit.mjs` (ADR-167) reads to make its
 * three schema-blocked CRITICAL checks — answer-leakage (AUD-1), oracle-leakage
 * (AUD-3) and grader-isolation (AUD-4) — enforceable instead of `skip`.
 *
 * SCHEMA — aligned to what gaia-audit.mjs ACTUALLY consumes (ADR-167 §4), which
 * is the authoritative contract. Note this differs from the loose paraphrase in
 * the build ticket (`type: 'assistant'`, `args`, `tokens`): the audit's
 * `stepText()` reads `output|content|input|url|text`, `checkGraderIsolation`
 * reads `tool_call.input` (NOT `args`), and `checkNoWork`/`checkOracleLeakage`
 * key off step types `'prompt' | 'llm_call' | 'tool_call' | 'tool_result'`
 * (there is no `'assistant'` type). We serialize exactly those so the checks
 * fire; the divergence is intentional and documented.
 *
 *   record = { task_id, prompt, turns, inputTokens, outputTokens,
 *              tools_used: string[], steps: TrajectoryStep[] }
 *   step   = { type, name?, input?, output?, content?, url?, is_error?,
 *              tokens_in?, tokens_out? }
 *
 * HARD REQUIREMENTS (this file records tool results + prompts):
 *   - Redaction: every string field is passed through `redactSecrets()` before
 *     it lands in a record, masking obvious secret shapes (sk-…, hf_…, Bearer,
 *     AWS keys, Authorization: headers, PEM private keys) and any value of a
 *     secret-named `process.env` var → `[REDACTED]`. A secret must NEVER reach
 *     the serialized output.
 *   - Size bound: every step field is truncated to a per-step byte cap and the
 *     whole record to a per-record cap (`…[truncated N bytes]` marker), so
 *     `trajectories.jsonl` cannot balloon.
 *
 * This module is pure (no network, no fs, no LLM) and unit-tested against
 * planted secrets and oversized inputs.
 *
 * Refs: ADR-167 §4/§7, issue #2544, PR #2543 (gaia-audit.mjs).
 */

// ---------------------------------------------------------------------------
// Types — the record shape gaia-audit.mjs reads
// ---------------------------------------------------------------------------

/** Step types the audit keys off. There is deliberately no `'assistant'`. */
export type TrajectoryStepType = 'prompt' | 'llm_call' | 'tool_call' | 'tool_result';

export interface TrajectoryStep {
  type: TrajectoryStepType;
  /** Tool name (tool_call / tool_result). */
  name?: string;
  /** tool_call arguments (object or string). Read by checkGraderIsolation. */
  input?: string | Record<string, unknown> | unknown[];
  /** tool_result fetched text / llm_call model text. Read by checkAnswerLeakage. */
  output?: string;
  /** prompt content (agent-visible). Read by checkOracleLeakage via stepText. */
  content?: string;
  /** tool_result source URL when known (answer-DB-signature surface). */
  url?: string;
  /** true when the tool returned an error. */
  is_error?: boolean;
  tokens_in?: number;
  tokens_out?: number;
}

export interface SerializedTrajectory {
  /** Agent-visible system+user prompt (never the gold answer). */
  prompt: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  tools_used: string[];
  steps: TrajectoryStep[];
}

export interface TrajectoryRecord extends SerializedTrajectory {
  task_id: string;
}

// ---------------------------------------------------------------------------
// Redaction — a secret must NEVER reach the serialized output
// ---------------------------------------------------------------------------

export const REDACTED = '[REDACTED]';

/**
 * Known secret shapes. Order does not matter — all are applied. Bounds are
 * conservative (require enough entropy) so ordinary prose is not mangled.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Anthropic / OpenAI style keys (sk-, sk-ant-, sk-proj-…)
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  // Hugging Face tokens
  /\bhf_[A-Za-z0-9]{16,}/g,
  // OpenRouter
  /\bsk-or-[A-Za-z0-9-]{16,}/g,
  // AWS access key IDs
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g,
  // Google API keys (canonical is AIza+35; use {30,} so near-length variants
  // still mask — a redactor should err toward masking).
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // Bearer tokens (Authorization: Bearer …)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Authorization headers (any scheme)
  /\bAuthorization\s*[:=]\s*["']?[^\s"'&]{6,}/gi,
  // x-api-key headers
  /\bx-api-key\s*[:=]\s*["']?[^\s"'&]{6,}/gi,
  // PEM private key blocks
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
];

/** env var NAMES whose value must be scrubbed wherever it appears. */
const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASS(WORD)?|CRED|AUTH|SESSION|PRIVATE|BEARER)/i;
/** Do not scrub env values shorter than this (avoids catastrophic replacement). */
const MIN_ENV_VALUE_LEN = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask secret shapes and secret-named env values in `text`.
 *
 * @param text  arbitrary string (coerced if not a string)
 * @param env   environment to scrub against (default: process.env). Injectable
 *              for deterministic tests.
 */
export function redactSecrets(
  text: unknown,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  let s = typeof text === 'string' ? text : String(text ?? '');
  if (!s) return s;

  for (const re of SECRET_PATTERNS) {
    s = s.replace(re, REDACTED);
  }

  // Scrub literal env values (only for secret-named vars with enough length).
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_ENV_VALUE_LEN) continue;
    if (!SECRET_ENV_NAME.test(name)) continue;
    s = s.replace(new RegExp(escapeRegExp(value), 'g'), REDACTED);
  }

  return s;
}

/** Recursively redact string leaves of a JSON-ish value, preserving shape. */
export function redactValue<T>(
  value: T,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): T {
  if (typeof value === 'string') return redactSecrets(value, env) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, env)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = redactValue((value as Record<string, unknown>)[k], env);
    }
    return out as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Size bounding — trajectories.jsonl cannot balloon
// ---------------------------------------------------------------------------

export const DEFAULT_STEP_MAX_BYTES = 8 * 1024; // 8 KiB per step field
export const DEFAULT_RECORD_MAX_BYTES = 256 * 1024; // 256 KiB per record
const NAME_MAX_BYTES = 256;
const URL_MAX_BYTES = 512;

/**
 * Truncate `text` to at most `maxBytes` UTF-8 bytes, appending a
 * `…[truncated N bytes]` marker recording how many bytes were dropped.
 * Never splits a multibyte UTF-8 character.
 */
export function boundSize(text: string, maxBytes: number = DEFAULT_STEP_MAX_BYTES): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  let end = maxBytes;
  // back off the cut point until it is not in the middle of a UTF-8 sequence
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  const kept = buf.subarray(0, end).toString('utf8');
  const dropped = buf.byteLength - end;
  return `${kept}…[truncated ${dropped} bytes]`;
}

// ---------------------------------------------------------------------------
// Step + record assembly (redact THEN bound, always)
// ---------------------------------------------------------------------------

export interface SanitizeOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  stepMaxBytes?: number;
  recordMaxBytes?: number;
}

function sanitizeInput(
  input: TrajectoryStep['input'],
  env: SanitizeOptions['env'],
  maxBytes: number,
): TrajectoryStep['input'] {
  if (input === undefined || input === null) return undefined;
  const redacted = redactValue(input, env);
  if (typeof redacted === 'string') return boundSize(redacted, maxBytes);
  const asJson = JSON.stringify(redacted);
  if (Buffer.byteLength(asJson, 'utf8') > maxBytes) {
    // Too large to keep structured — fall back to a bounded JSON string.
    return boundSize(asJson, maxBytes);
  }
  return redacted;
}

/** Redact + size-bound a single raw step into a serialization-safe step. */
export function sanitizeStep(step: TrajectoryStep, opts: SanitizeOptions = {}): TrajectoryStep {
  const env = opts.env ?? process.env;
  const stepMax = opts.stepMaxBytes ?? DEFAULT_STEP_MAX_BYTES;
  const out: TrajectoryStep = { type: step.type };
  if (step.name != null) out.name = boundSize(redactSecrets(step.name, env), NAME_MAX_BYTES);
  if (step.content != null) out.content = boundSize(redactSecrets(step.content, env), stepMax);
  if (step.output != null) out.output = boundSize(redactSecrets(step.output, env), stepMax);
  if (step.url != null) out.url = boundSize(redactSecrets(step.url, env), URL_MAX_BYTES);
  if (step.input !== undefined) out.input = sanitizeInput(step.input, env, stepMax);
  if (typeof step.is_error === 'boolean') out.is_error = step.is_error;
  if (typeof step.tokens_in === 'number') out.tokens_in = step.tokens_in;
  if (typeof step.tokens_out === 'number') out.tokens_out = step.tokens_out;
  return out;
}

/**
 * Enforce the per-record byte cap: progressively shrink the largest
 * text fields (tool_result/llm_call output + prompt content) until the
 * JSON-serialized record fits, or a floor is reached.
 */
function boundRecord(traj: SerializedTrajectory, recordMax: number): SerializedTrajectory {
  const size = (t: SerializedTrajectory) => Buffer.byteLength(JSON.stringify(t), 'utf8');
  if (size(traj) <= recordMax) return traj;
  let bound = DEFAULT_STEP_MAX_BYTES;
  let cur = traj;
  while (size(cur) > recordMax && bound > 256) {
    bound = Math.floor(bound / 2);
    cur = {
      ...traj,
      prompt: boundSize(traj.prompt, bound),
      steps: traj.steps.map((s) => {
        const c: TrajectoryStep = { ...s };
        if (c.output != null) c.output = boundSize(c.output, bound);
        if (c.content != null) c.content = boundSize(c.content, bound);
        return c;
      }),
    };
  }
  return cur;
}

export interface RawTrajectory {
  prompt: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** Explicit tools list; derived from tool_call step names when omitted. */
  toolsUsed?: string[];
  steps: TrajectoryStep[];
}

/**
 * Assemble a raw (in-memory) trajectory into a redacted, size-bounded
 * `SerializedTrajectory` ready to write to `trajectories.jsonl`.
 */
export function assembleTrajectory(raw: RawTrajectory, opts: SanitizeOptions = {}): SerializedTrajectory {
  const env = opts.env ?? process.env;
  const stepMax = opts.stepMaxBytes ?? DEFAULT_STEP_MAX_BYTES;
  const recordMax = opts.recordMaxBytes ?? DEFAULT_RECORD_MAX_BYTES;

  const steps = raw.steps.map((s) => sanitizeStep(s, { env, stepMaxBytes: stepMax }));
  const tools_used =
    raw.toolsUsed ??
    Array.from(
      new Set(
        steps
          .filter((s) => s.type === 'tool_call' && typeof s.name === 'string' && s.name)
          .map((s) => s.name as string),
      ),
    );

  const traj: SerializedTrajectory = {
    prompt: boundSize(redactSecrets(raw.prompt ?? '', env), stepMax),
    turns: raw.turns,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    tools_used,
    steps,
  };
  return boundRecord(traj, recordMax);
}

/** Prepend the task_id to make a `trajectories.jsonl` record. */
export function toTrajectoryRecord(taskId: string, traj: SerializedTrajectory): TrajectoryRecord {
  return { task_id: taskId, ...traj };
}

/** Serialize an array of records into `trajectories.jsonl` text (one per line). */
export function toJsonl(records: TrajectoryRecord[]): string {
  if (records.length === 0) return '';
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
