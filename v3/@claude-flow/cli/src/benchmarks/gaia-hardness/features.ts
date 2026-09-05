/**
 * GAIA Hardness Predictor — Feature Extraction (ADR-136 Track Q)
 *
 * Extracts a 17-dimensional feature vector from a GaiaQuestion for use
 * in the linear hardness classifier.  Deliberately avoids external
 * dependencies (no spacy, no heavy NLP) — all extraction is regex-based
 * with O(1) per question.
 *
 * Feature vector layout (17 dims):
 *   [0]  question length in characters (normalised / 500)
 *   [1]  question length in words      (normalised / 100)
 *   [2]  sentence count                (normalised / 5)
 *   [3]  question word: "what"         (0/1)
 *   [4]  question word: "how"          (0/1)
 *   [5]  question word: "who/when/where" (0/1)
 *   [6]  question word: "calculate/compute/how many/what percentage" (0/1)
 *   [7]  has numeric token             (0/1)
 *   [8]  has year token (4-digit)      (0/1)
 *   [9]  has comparison keyword        (0/1)
 *   [10] estimated named-entity count  (normalised / 5)
 *   [11] digit-token count             (normalised / 5)
 *   [12] multi-hop signal              (0/1)  — bridge/relative clause pattern
 *   [13] requires math                 (0/1)  — "how many/much/percentage/calculate/compute"
 *   [14] temporal chain                (0/1)  — "before/after X happened / since / until"
 *   [15] tool implication count        (normalised / 4)  — PDF/image/video/URL markers
 *   [16] file attachment present       (0/1)
 *
 * All continuous values are min-max normalised to [0, 1] using fixed
 * divisors chosen so typical GAIA questions fall in [0.1, 0.9].
 *
 * Refs: ADR-136, #2156
 */

import type { GaiaQuestion } from '../gaia-loader.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FeatureVector {
  /** Raw 17-element array in [0, 1]. */
  values: number[];
  /** Human-readable labels matching values index. */
  labels: string[];
}

// ---------------------------------------------------------------------------
// Feature labels (in order, matches values array)
// ---------------------------------------------------------------------------

export const FEATURE_LABELS: readonly string[] = [
  'len_chars_norm',
  'len_words_norm',
  'sentence_count_norm',
  'qword_what',
  'qword_how',
  'qword_who_when_where',
  'qword_calc_compute',
  'has_numeric',
  'has_year',
  'has_comparison',
  'entity_count_norm',
  'digit_token_norm',
  'multi_hop_signal',
  'requires_math',
  'temporal_chain',
  'tool_implication_norm',
  'has_file_attachment',
] as const;

// ---------------------------------------------------------------------------
// Regex catalogue (compiled once at module load)
// ---------------------------------------------------------------------------

// Named entity proxy: capitalised word sequences (not at sentence start)
// e.g. "Barack Obama", "New York City", "United States of America"
const RE_ENTITY = /(?<!^|\.\s{1,3})(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})/g;

const RE_YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
const RE_DIGIT_TOKEN = /\b\d[\d,._]*/g;
const RE_NUMERIC = /\b\d/;
const RE_COMPARISON = /\b(more|fewer|greater|less|compare|versus|vs\.?|differ|increase|decrease|ratio|proportion)\b/i;
const RE_MULTI_HOP = /\b(the\s+\w+\s+that\s+|which\s+was\s+|who\s+was\s+|whose\s+|of\s+the\s+\w+\s+that\s+)/i;
// Requires math: stems without trailing \b to handle "calculate", "multiply", "division", etc.
const RE_MATH = /\b(how\s+many|how\s+much|what\s+percentage|what\s+fraction|what\s+proportion|calculat|comput|multipli|divis|subtract|sum\s+of|total\s+of|average\s+of|product\s+of|express\s+as\s+a\s+decimal)/i;
const RE_TEMPORAL = /\b(before|after|since|until|during|between\s+\d|in\s+the\s+year|by\s+the\s+time|at\s+the\s+time)\b/i;

// Tool implication markers
const RE_TOOL_FILE = /\b(pdf|\.docx|\.xlsx|\.csv|file|attachment|document|spreadsheet)\b/i;
const RE_TOOL_IMAGE = /\b(image|photo|picture|screenshot|figure|diagram|chart)\b/i;
const RE_TOOL_VIDEO = /\b(video|youtube|clip|footage)\b/i;
const RE_TOOL_URL = /https?:\/\//i;

// Question-word detection (first word of question, or full-text for calc/compute)
const RE_QWORD_WHAT = /^(what|which)\b/i;
const RE_QWORD_HOW = /^how\b/i;
const RE_QWORD_WHO_WHEN_WHERE = /^(who|when|where|why|whom)\b/i;
// calc/compute: fires if question contains calculate/compute anywhere (stems, no trailing \b)
const RE_QWORD_CALC = /\b(calculat|comput|how\s+many|what\s+percentage|how\s+much)/i;

// Sentence boundary (rough — period/exclamation/question-mark followed by space+capital)
const RE_SENTENCE = /[.!?]\s+[A-Z]/g;

// ---------------------------------------------------------------------------
// Helper: clamp value to [0, 1]
// ---------------------------------------------------------------------------

function clamp(v: number, max: number): number {
  return Math.min(v / max, 1.0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the 17-dimensional feature vector from a GaiaQuestion.
 * All features are in [0, 1].  Never throws.
 */
export function extractFeatures(q: GaiaQuestion): FeatureVector {
  const text = q.question ?? '';

  // ── Syntactic scalars ──────────────────────────────────────────────────
  const lenChars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lenWords = words.length;
  const sentenceMatches = text.match(RE_SENTENCE);
  const sentenceCount = 1 + (sentenceMatches ? sentenceMatches.length : 0);

  // ── Question-word one-hot ─────────────────────────────────────────────
  const firstWord = text.trim();
  const qwWhat = RE_QWORD_WHAT.test(firstWord) ? 1 : 0;
  const qwHow = RE_QWORD_HOW.test(firstWord) ? 1 : 0;
  const qwWhoWhenWhere = RE_QWORD_WHO_WHEN_WHERE.test(firstWord) ? 1 : 0;
  const qwCalcCompute = RE_QWORD_CALC.test(text) ? 1 : 0;

  // ── Lexical booleans ──────────────────────────────────────────────────
  const hasNumeric = RE_NUMERIC.test(text) ? 1 : 0;

  // Count year tokens
  const yearMatches = text.match(RE_YEAR);
  const hasYear = yearMatches && yearMatches.length > 0 ? 1 : 0;

  const hasComparison = RE_COMPARISON.test(text) ? 1 : 0;

  // ── Named entity proxy (capitalised word sequences) ───────────────────
  // Reset lastIndex for global regex
  RE_ENTITY.lastIndex = 0;
  let entityCount = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const m = RE_ENTITY.exec(text);
    if (!m) break;
    entityCount++;
  }

  // ── Digit token count ─────────────────────────────────────────────────
  RE_DIGIT_TOKEN.lastIndex = 0;
  const digitTokenMatches = text.match(RE_DIGIT_TOKEN);
  const digitTokenCount = digitTokenMatches ? digitTokenMatches.length : 0;

  // ── Multi-hop signal ──────────────────────────────────────────────────
  const multiHopSignal = RE_MULTI_HOP.test(text) ? 1 : 0;

  // ── Math requirement ──────────────────────────────────────────────────
  const requiresMath = RE_MATH.test(text) ? 1 : 0;

  // ── Temporal chain ────────────────────────────────────────────────────
  const temporalChain = RE_TEMPORAL.test(text) ? 1 : 0;

  // ── Tool implication (PDF/image/video/URL → file_read/web_browse/image_describe) ──
  let toolImplication = 0;
  if (RE_TOOL_FILE.test(text) || q.file_name) toolImplication++;
  if (RE_TOOL_IMAGE.test(text)) toolImplication++;
  if (RE_TOOL_VIDEO.test(text)) toolImplication++;
  if (RE_TOOL_URL.test(text)) toolImplication++;

  // ── File attachment ───────────────────────────────────────────────────
  const hasFileAttachment = q.file_name && q.file_name.trim() ? 1 : 0;

  // ── Assemble normalised vector ────────────────────────────────────────
  const values: number[] = [
    clamp(lenChars, 500),        // [0]
    clamp(lenWords, 100),        // [1]
    clamp(sentenceCount, 5),     // [2]
    qwWhat,                      // [3]
    qwHow,                       // [4]
    qwWhoWhenWhere,               // [5]
    qwCalcCompute,               // [6]
    hasNumeric,                  // [7]
    hasYear,                     // [8]
    hasComparison,               // [9]
    clamp(entityCount, 5),       // [10]
    clamp(digitTokenCount, 5),   // [11]
    multiHopSignal,              // [12]
    requiresMath,                // [13]
    temporalChain,               // [14]
    clamp(toolImplication, 4),   // [15]
    hasFileAttachment ? 1 : 0,   // [16]
  ];

  return { values, labels: FEATURE_LABELS as string[] };
}
