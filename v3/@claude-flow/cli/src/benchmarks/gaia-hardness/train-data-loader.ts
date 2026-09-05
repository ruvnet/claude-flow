/**
 * GAIA Hardness Predictor — Training Data Loader (ADR-136 Track Q)
 *
 * Loads labelled training examples from prior bench-run result JSONs
 * (iter-15, iter-23, iter-28 outputs) and converts them into the
 * `LabeledExample[]` format consumed by `HardnessPredictor.train()`.
 *
 * Expected result JSON schema (matches gaia-bench --output json):
 * {
 *   level: number,
 *   model: string,
 *   summary: { total, passed, passRate, estCostUsd, meanTurns, meanWallMs },
 *   results: [
 *     {
 *       task_id: string, question: string, model: string, correct: boolean,
 *       answer: string | null, expected_output: string, error?: string,
 *       turns?: number, wallMs?: number, inputTokens?: number, outputTokens?: number
 *     }
 *   ]
 * }
 *
 * The file may contain either:
 *   (a) a single JSON object (one model run), or
 *   (b) a JSON array of objects (multi-model run from --models a,b,c), or
 *   (c) a text preamble followed by JSON (raw output from gaia-bench text mode
 *       — we scan for the first '[' or '{' and parse from there).
 *
 * Missing files are silently skipped (returns empty array).
 * Malformed files emit a warning to stderr and are skipped.
 *
 * Default search paths (tried in order, first found wins per iter):
 *   /tmp/gaia-l1-full.json
 *   /tmp/gaia-l1-haiku.json
 *   /tmp/gaia-all-p1b.json
 *   /tmp/gaia-all-p2.json
 *   <custom paths passed by caller>
 *
 * Refs: ADR-136, #2156
 */

import * as fs from 'node:fs';
import type { GaiaQuestion } from '../gaia-loader.js';
import type { LabeledExample } from './predictor.js';

// ---------------------------------------------------------------------------
// Default result-file search paths
// ---------------------------------------------------------------------------

/** Default candidate paths for historical bench-run result JSONs. */
export const DEFAULT_RESULT_PATHS: readonly string[] = [
  '/tmp/gaia-l1-full.json',
  '/tmp/gaia-l1-haiku.json',
  '/tmp/gaia-all-p1b.json',
  '/tmp/gaia-all-p2.json',
  '/tmp/gaia-all-probe.json',
] as const;

// ---------------------------------------------------------------------------
// Internal schema types (mirrors gaia-bench.ts)
// ---------------------------------------------------------------------------

interface RawQuestionResult {
  task_id: string;
  question: string;
  model: string;
  correct: boolean;
  answer: string | null;
  expected_output: string;
  error?: string;
  turns?: number;
  wallMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface RawBenchOutput {
  level: number;
  model: string;
  summary?: Record<string, unknown>;
  results: RawQuestionResult[];
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

/**
 * Attempt to extract and parse a JSON value (object or array) from a string
 * that may have a text preamble before the JSON.
 *
 * Strategy:
 *   1. Find the first '[' — parse as array.
 *   2. Find the first '{' — parse as object.
 *   3. Return null on failure.
 */
function extractJson(content: string): unknown {
  const bracketIdx = content.indexOf('[');
  const braceIdx = content.indexOf('{');

  // Prefer whichever appears first (handles both array and object formats).
  const candidates: Array<[number, string]> = [];
  if (bracketIdx >= 0) candidates.push([bracketIdx, '[']);
  if (braceIdx >= 0) candidates.push([braceIdx, '{']);
  candidates.sort((a, b) => a[0] - b[0]);

  for (const [startIdx] of candidates) {
    try {
      return JSON.parse(content.slice(startIdx));
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse a single file into RawBenchOutput[]
// ---------------------------------------------------------------------------

function parseBenchFile(filePath: string): RawBenchOutput[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const parsed = extractJson(content);
  if (parsed === null) {
    process.stderr.write(
      `[gaia-hardness] Warning: could not extract JSON from ${filePath}\n`,
    );
    return [];
  }

  // Normalise to array of RawBenchOutput.
  const outputs: RawBenchOutput[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object' && Array.isArray((item as RawBenchOutput).results)) {
        outputs.push(item as RawBenchOutput);
      }
    }
  } else if (
    parsed !== null &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as RawBenchOutput).results)
  ) {
    outputs.push(parsed as RawBenchOutput);
  }

  if (outputs.length === 0) {
    process.stderr.write(
      `[gaia-hardness] Warning: no valid bench outputs found in ${filePath}\n`,
    );
  }

  return outputs;
}

// ---------------------------------------------------------------------------
// Convert RawQuestionResult → LabeledExample
// ---------------------------------------------------------------------------

function toGaiaQuestion(r: RawQuestionResult): GaiaQuestion {
  return {
    task_id: r.task_id,
    level: 1, // level not stored in result JSON; default to 1
    question: r.question,
    final_answer: r.expected_output,
    file_name: null,
    file_path: null,
  };
}

function toBenchLabeledExample(r: RawQuestionResult): LabeledExample {
  return {
    question: toGaiaQuestion(r),
    wasCorrect: Boolean(r.correct),
    turns: r.turns,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load labelled training examples from historical bench-run result JSONs.
 *
 * @param additionalPaths - Extra file paths to scan beyond the defaults.
 * @param verbose - If true, log loaded example counts to stderr.
 * @returns Deduplicated array of LabeledExample (dedup by task_id, last write wins).
 */
export function loadTrainingData(
  additionalPaths: string[] = [],
  verbose = false,
): LabeledExample[] {
  const allPaths = [...DEFAULT_RESULT_PATHS, ...additionalPaths];
  const seen = new Set<string>();
  const examples: LabeledExample[] = [];

  for (const filePath of allPaths) {
    if (!fs.existsSync(filePath)) continue;

    const outputs = parseBenchFile(filePath);
    let fileCount = 0;

    for (const output of outputs) {
      for (const result of output.results) {
        if (!result.task_id || typeof result.correct !== 'boolean') continue;
        const key = result.task_id;
        if (seen.has(key)) continue; // first file wins (chronological order)
        seen.add(key);
        examples.push(toBenchLabeledExample(result));
        fileCount++;
      }
    }

    if (verbose && fileCount > 0) {
      process.stderr.write(
        `[gaia-hardness] Loaded ${fileCount} examples from ${filePath}\n`,
      );
    }
  }

  if (verbose) {
    process.stderr.write(
      `[gaia-hardness] Total training examples: ${examples.length}\n`,
    );
  }

  return examples;
}
