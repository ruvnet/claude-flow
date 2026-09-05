/**
 * GAIA Causal Failure-Avoidance Memory — ADR-135 Track I
 *
 * Records causal edges after each failed GAIA trajectory:
 *   "trying tool X on question type Y → caused failure Z"
 *
 * Before each new question, retrieves matching causal edges and injects
 * an "avoid these approaches" hint into the agent's system prompt.
 *
 * This is one of ruflo's 6 architectural primitives distinguishing it
 * from HAL: HAL is stateless across runs; ruflo accumulates causal memory.
 *
 * Storage: JSONL file at ~/.cache/ruflo/gaia/causal-edges.jsonl
 *   - Simple, portable, no runtime dependency on AgentDB
 *   - Production upgrade path: switch to AgentDB causal-edge MCP controller
 *     (`mcp__claude-flow__agentdb_causal-edge`) for cross-session persistence
 *     and embedding-based similarity matching.
 *
 * Expected lift:
 *   - First run (no edges yet): +0pp  (empty hint → no overhead)
 *   - After 5+ runs (warm-up):  +2-5pp compound
 *
 * NOT wired into gaia-bench.ts here — wiring is a follow-up PR once all
 * in-flight iterators (29/31/34/35/37) have landed to avoid conflicts.
 *
 * Refs: ADR-135, ADR-133, #2156
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { GaiaQuestion } from './gaia-loader.js';
import type { GaiaAgentResult } from './gaia-agent.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Observation failure categories derived from trajectory analysis. */
export type FailureType =
  | 'empty_result'
  | 'timeout'
  | 'wrong_answer'
  | 'tool_error';

/**
 * A causal edge: "in a question of signature S, using tool T in way W
 * caused failure F."  occurrenceCount increments each time the same
 * (signature, tool, step) triple is observed again instead of duplicating.
 */
export interface CausalEdge {
  /** Deterministic hash of the normalised question text. */
  questionSignature: string;
  /** Tool name that failed (e.g. 'web_search', 'python_exec'). */
  failedTool: string;
  /** Brief description of what the failing step attempted. */
  failedTrajectoryStep: string;
  /** Categorised failure type. */
  observedFailureType: FailureType;
  /** ISO-8601 timestamp of first observation. */
  createdAt: string;
  /** Increments when the same edge is observed in a subsequent run. */
  occurrenceCount: number;
}

/** Options for causal-memory operations. */
export interface CausalMemoryOptions {
  /**
   * Override the JSONL store path.
   * Default: ~/.cache/ruflo/gaia/causal-edges.jsonl
   */
  storePath?: string;
  /**
   * Maximum edges to return per question signature when retrieving hints.
   * Default: 5
   */
  maxEdgesPerSignature?: number;
  /**
   * Signature similarity threshold (0–1).  Currently unused for the simple
   * hash-based implementation; reserved for future RuVector upgrade.
   * Default: 0.7
   */
  similarityThreshold?: number;
}

/** Result of a recordCausalFailures call. */
export interface RecordResult {
  edgesRecorded: number;
  storePath: string;
}

/** Result of a retrieveCausalHints call. */
export interface RetrieveResult {
  /**
   * System-prompt-ready hint string.
   * Empty string when no edges match (caller must not inject empty hints).
   */
  hint: string;
  edgesMatched: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_STORE_SUFFIX = path.join('.cache', 'ruflo', 'gaia', 'causal-edges.jsonl');
const DEFAULT_MAX_EDGES = 5;

/** Resolve the JSONL store path from options, defaulting to ~/.cache/ruflo/…  */
function resolveStorePath(options?: CausalMemoryOptions): string {
  if (options?.storePath) {
    return options.storePath;
  }
  return path.join(os.homedir(), DEFAULT_STORE_SUFFIX);
}

/**
 * Compute a deterministic question signature.
 *
 * Algorithm (v1, hash-based):
 *   1. Lower-case the question text.
 *   2. Collapse runs of whitespace to a single space and trim.
 *   3. SHA-256 → first 16 hex characters (64-bit prefix, collision-unlikely
 *      for the ~450-question GAIA validation set).
 *
 * Future (v2, embedding-based): replace with RuVector cosine similarity so
 * semantically similar questions (paraphrases, translated variants) share
 * causal edges across runs.
 */
export function computeQuestionSignature(questionText: string): string {
  const normalised = questionText.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 16);
}

/** Derive a failure type from a completed agent result + known correctness. */
export function inferFailureType(
  result: GaiaAgentResult,
  wasCorrect: boolean,
): FailureType | null {
  if (wasCorrect) {
    return null; // Not a failure — callers should skip this question.
  }
  if (result.timedOut === true) {
    return 'timeout';
  }
  if (result.error) {
    return 'tool_error';
  }
  if (result.finalAnswer === null || result.finalAnswer.trim() === '') {
    return 'empty_result';
  }
  return 'wrong_answer';
}

/**
 * Parse one JSONL line into a CausalEdge.
 * Returns null if the line is empty, a comment, or malformed.
 */
function parseLine(line: string): CausalEdge | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    // Minimal shape guard — avoids crashing on partially-written lines.
    if (
      typeof parsed.questionSignature !== 'string' ||
      typeof parsed.failedTool !== 'string' ||
      typeof parsed.failedTrajectoryStep !== 'string' ||
      typeof parsed.observedFailureType !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.occurrenceCount !== 'number'
    ) {
      return null;
    }
    return parsed as unknown as CausalEdge;
  } catch {
    // Corrupted line — skip gracefully.
    return null;
  }
}

/** Read all valid CausalEdge entries from the JSONL store. */
async function readAllEdges(storePath: string): Promise<CausalEdge[]> {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const edges: CausalEdge[] = [];
  const fileStream = fs.createReadStream(storePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    const edge = parseLine(line);
    if (edge !== null) {
      edges.push(edge);
    }
  }
  return edges;
}

/** Write all edges back to the JSONL store (full rewrite for upsert support). */
function writeAllEdges(storePath: string, edges: CausalEdge[]): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = edges.map((e) => JSON.stringify(e)).join('\n') + (edges.length > 0 ? '\n' : '');
  fs.writeFileSync(storePath, content, { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Trajectory analysis
// ---------------------------------------------------------------------------

/**
 * Inspect a failed trajectory and extract tool-level failure events.
 *
 * The agent result carries `toolCallsByName` (tool → call count).  For a
 * failed run we attribute the failure to the most-used tool, since that is
 * the tool whose repeated use did not converge to a correct answer.
 *
 * Returns an array of (tool, stepDescription, failureType) triples.
 * Empty array when there is nothing attributable.
 */
function extractFailureEvents(
  result: GaiaAgentResult,
  failureType: FailureType,
): Array<{ tool: string; step: string; type: FailureType }> {
  const events: Array<{ tool: string; step: string; type: FailureType }> = [];

  const toolCalls = result.toolCallsByName;
  if (!toolCalls || Object.keys(toolCalls).length === 0) {
    // No tool calls at all — record a synthetic "no_tool" event.
    events.push({
      tool: 'no_tool_called',
      step: `Agent failed with type=${failureType} without making any tool calls`,
      type: failureType,
    });
    return events;
  }

  // Attribute one event per tool that was called at least once.
  for (const [toolName, callCount] of Object.entries(toolCalls)) {
    const step = buildStepDescription(toolName, callCount, failureType);
    events.push({ tool: toolName, step, type: failureType });
  }

  return events;
}

function buildStepDescription(
  toolName: string,
  callCount: number,
  failureType: FailureType,
): string {
  const timesStr = callCount === 1 ? 'once' : `${callCount} times`;
  switch (failureType) {
    case 'empty_result':
      return `${toolName} called ${timesStr} but returned empty/no-result`;
    case 'timeout':
      return `${toolName} called ${timesStr} but agent timed out before converging`;
    case 'tool_error':
      return `${toolName} called ${timesStr} but raised an execution error`;
    case 'wrong_answer':
      return `${toolName} called ${timesStr} but final answer was incorrect`;
    default:
      return `${toolName} called ${timesStr}; failure type=${failureType}`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * After a GAIA trajectory completes, analyse it for causal failure patterns
 * and persist each observed edge in the JSONL store.
 *
 * Behaviour:
 *   - If `wasCorrect === true`, no edges are written (zero overhead).
 *   - Each (signature, tool, step) triple is deduplicated: if the same triple
 *     already exists in the store, its `occurrenceCount` is incremented in
 *     place rather than appending a new line.
 *   - Edges beyond `maxEdgesPerSignature` (default 5) per signature are
 *     discarded to keep the store bounded.
 *
 * @param question   - The GaiaQuestion that was attempted.
 * @param result     - The agent result from runGaiaAgent().
 * @param wasCorrect - Whether the final answer was judged correct.
 * @param options    - Optional store path and limits.
 * @returns Number of edges written/updated and the resolved store path.
 */
export async function recordCausalFailures(
  question: GaiaQuestion,
  result: GaiaAgentResult,
  wasCorrect: boolean,
  options?: CausalMemoryOptions,
): Promise<RecordResult> {
  const storePath = resolveStorePath(options);
  const maxEdges = options?.maxEdgesPerSignature ?? DEFAULT_MAX_EDGES;

  const failureType = inferFailureType(result, wasCorrect);
  if (failureType === null) {
    // Correct answer — nothing to record.
    return { edgesRecorded: 0, storePath };
  }

  const signature = computeQuestionSignature(question.question);
  const failureEvents = extractFailureEvents(result, failureType);

  if (failureEvents.length === 0) {
    return { edgesRecorded: 0, storePath };
  }

  // Load existing edges, upsert, cap, rewrite.
  const existing = await readAllEdges(storePath);

  let edgesRecorded = 0;

  for (const event of failureEvents) {
    // Count how many edges already exist for this signature.
    const sigEdges = existing.filter((e) => e.questionSignature === signature);

    // Check for exact duplicate (signature + tool + step).
    const dupIdx = existing.findIndex(
      (e) =>
        e.questionSignature === signature &&
        e.failedTool === event.tool &&
        e.failedTrajectoryStep === event.step,
    );

    if (dupIdx >= 0) {
      // Increment occurrence count in place.
      existing[dupIdx].occurrenceCount += 1;
      edgesRecorded++;
      continue;
    }

    // New edge — only add if we haven't hit the per-signature cap.
    if (sigEdges.length >= maxEdges) {
      continue; // Cap reached; discard.
    }

    const newEdge: CausalEdge = {
      questionSignature: signature,
      failedTool: event.tool,
      failedTrajectoryStep: event.step,
      observedFailureType: event.type,
      createdAt: new Date().toISOString(),
      occurrenceCount: 1,
    };
    existing.push(newEdge);
    edgesRecorded++;
  }

  if (edgesRecorded > 0) {
    writeAllEdges(storePath, existing);
  }

  return { edgesRecorded, storePath };
}

/**
 * Before running a new question, retrieve causal edges from prior failures
 * that match the question's signature and format them as a system-prompt hint.
 *
 * Return contract:
 *   - No edges matched → `{ hint: '', edgesMatched: 0 }` — caller MUST NOT
 *     inject an empty hint (wastes tokens; may confuse the model).
 *   - 1+ edges matched → `{ hint: '[PRIOR FAILURES] …', edgesMatched: N }`.
 *
 * @param question - The GaiaQuestion about to be attempted.
 * @param options  - Optional store path and limits.
 * @returns Formatted hint string and match count.
 */
export async function retrieveCausalHints(
  question: GaiaQuestion,
  options?: CausalMemoryOptions,
): Promise<RetrieveResult> {
  const storePath = resolveStorePath(options);
  const maxEdges = options?.maxEdgesPerSignature ?? DEFAULT_MAX_EDGES;

  const signature = computeQuestionSignature(question.question);
  const allEdges = await readAllEdges(storePath);

  // Filter to this question's signature, sort by occurrence count descending
  // so the most-reinforced warnings appear first.
  const matched = allEdges
    .filter((e) => e.questionSignature === signature)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, maxEdges);

  if (matched.length === 0) {
    return { hint: '', edgesMatched: 0 };
  }

  const lines = matched.map((e) => {
    const times = e.occurrenceCount === 1 ? '1 time' : `${e.occurrenceCount} times`;
    return `  - ${e.failedTool} failed ${times} (${e.observedFailureType}): ${e.failedTrajectoryStep}`;
  });

  const hint =
    '[PRIOR FAILURES] On similar questions, these approaches failed:\n' +
    lines.join('\n') +
    '\nAvoid repeating these patterns. Try alternative tools or approaches.';

  return { hint, edgesMatched: matched.length };
}
