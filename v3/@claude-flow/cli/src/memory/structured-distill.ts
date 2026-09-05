/**
 * Structured Distillation for trajectory content (#2241 §SOTA — arXiv:2603.13017).
 *
 * The arXiv paper compresses agent exchanges from ~371 to ~38 tokens (11×) using
 * a four-field schema, and reports retrieval MRR going from 0.745 (raw) to
 * 0.759 (distilled) on a 214 K-pair consensus-graded corpus. The schema is
 * domain-portable; we adopt it for trajectory step content so SONA's recall
 * works against a denser, higher-signal representation.
 *
 * This module is the RULE-BASED extractor. A future round can plug in a
 * learned distiller (cross-encoder / LLM); the schema and the harness stay
 * the same so the swap is drop-in.
 *
 * Schema:
 *   summary  — first sentence (capped); the headline of the exchange
 *   detail   — the rest of the content (capped); kept for fidelity
 *   labels   — domain tokens: verbs, nouns, and recognised actions
 *   paths    — file paths and file:line references (high-signal anchors)
 */

/** Distilled trajectory content. */
export interface DistilledContent {
  summary: string;
  detail: string;
  labels: string[];
  paths: string[];
}

const SUMMARY_MAX = 200;
const DETAIL_MAX = 1024;

// Imperative verbs typical of code-work trajectories (Reflexion / ReasoningBank
// vocabulary). Order-preserving for stable deduplication.
const ACTION_VOCAB = [
  'refactor', 'fix', 'add', 'remove', 'rename', 'extract', 'inline',
  'split', 'merge', 'delete', 'rewrite', 'simplify', 'optimize',
  'test', 'mock', 'stub', 'verify', 'assert', 'expect',
  'document', 'explain', 'comment',
  'debug', 'trace', 'log', 'diagnose',
  'wire', 'route', 'dispatch', 'register', 'unregister',
  'parse', 'validate', 'sanitize', 'normalize',
  'cache', 'invalidate', 'flush', 'persist', 'load',
  'embed', 'distill', 'train', 'consolidate', 'recall',
];

// A trajectory step might contain code blocks, file refs, or natural prose;
// these regexes catch the high-signal anchors without false positives on
// general English.
const PATH_REGEX = /\b([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|rb|md|json|yaml|yml|toml|sql))(?::(\d+))?\b/g;
const SENTENCE_END = /([.!?])\s+(?=[A-Z(])/;

function firstSentence(text: string): string {
  const m = text.match(SENTENCE_END);
  if (!m || m.index === undefined) return text.slice(0, SUMMARY_MAX);
  return text.slice(0, m.index + 1).slice(0, SUMMARY_MAX);
}

function extractPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PATH_REGEX)) {
    found.add(m[2] ? `${m[1]}:${m[2]}` : m[1]);
  }
  return [...found];
}

function extractLabels(text: string): string[] {
  const lower = text.toLowerCase();
  const labels = new Set<string>();
  // Action vocabulary
  for (const v of ACTION_VOCAB) {
    if (lower.includes(v)) labels.add(v);
  }
  // High-signal nouns (camelCase / PascalCase identifiers, ALL_CAPS constants).
  // Cap to the top 5 most-frequent so labels stay short.
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9]{3,}|[A-Z][A-Z0-9_]{3,}|[a-z][a-zA-Z0-9]{4,}[A-Z][a-zA-Z0-9]{1,})\b/g)) {
    const t = m[1];
    if (/^[a-zA-Z]+$/.test(t) && t.length > 20) continue; // skip very long words
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [t] of top) labels.add(t);
  return [...labels];
}

/**
 * Distill a raw trajectory step's content into the 4-field schema.
 * Deterministic, dependency-free, sub-millisecond.
 */
export function distillTrajectoryContent(raw: string): DistilledContent {
  const text = String(raw ?? '').trim();
  if (!text) return { summary: '', detail: '', labels: [], paths: [] };

  const paths = extractPaths(text);
  const labels = extractLabels(text);
  const summary = firstSentence(text);
  // detail = everything after the first sentence, up to cap
  const rest = text.slice(summary.length).trim();
  const detail = rest.slice(0, DETAIL_MAX);

  return { summary, detail, labels, paths };
}

/**
 * Serialise a distilled object into a compact embedding-ready string. The
 * resulting form is what gets embedded for retrieval — labels and paths come
 * first so they get high attention weight in the embedding.
 *
 * The paper's MRR uplift comes from the ordering: high-signal tokens (labels,
 * paths) lead, so the embedder allocates more probability mass to them.
 */
export function serialiseDistilled(d: DistilledContent): string {
  const parts: string[] = [];
  if (d.labels.length) parts.push(`[${d.labels.join(', ')}]`);
  if (d.paths.length) parts.push(`paths: ${d.paths.join(' ')}`);
  if (d.summary) parts.push(d.summary);
  if (d.detail) parts.push(d.detail);
  return parts.join('\n');
}

/** Convenience: distill then serialise. */
export function distillAndSerialise(raw: string): string {
  return serialiseDistilled(distillTrajectoryContent(raw));
}

/**
 * Compression ratio: raw bytes / distilled bytes. >1 means distilled is
 * smaller. Used by the benchmark harness.
 */
export function compressionRatio(raw: string): number {
  const distilled = distillAndSerialise(raw);
  if (distilled.length === 0) return 1;
  return raw.length / distilled.length;
}
