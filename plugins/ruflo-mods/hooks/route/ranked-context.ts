/**
 * Ranked-memory context for a prompt: the scoring of intelligence.cjs
 * `getContext` (trigram Jaccard blended with PageRank, top 5 over 0.05),
 * read-only.
 *
 * Copied because a hooks module cannot import intelligence.cjs; the parity
 * test runs both over the same ranked-context.json and compares the text.
 * What this does not do: the classic path also writes `lastMatchedPatterns`
 * and boosts the previous match's confidence on every prompt. Those writes
 * stay with the classic helpers (ADR-404, "What the mod does not carry").
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same',
  'than', 'too', 'very', 'just', 'because', 'if', 'when', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its',
])

/** An entry as shown: no control or bidi characters, one line (the same cleaning the research guard applies to text it shows). */
const plainText = (s: string): string =>
  s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const ALPHA = 0.6
const MIN_THRESHOLD = 0.05
const TOP_K = 5

export type RankedEntry = {
  readonly id?: string
  readonly words?: readonly string[]
  readonly pageRank?: number
  readonly summary?: string
  readonly content?: string
  readonly accessCount?: number
}

export function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

export function trigrams(words: readonly string[]): Set<string> {
  const t = new Set<string>()
  for (const w of words) {
    for (let i = 0; i <= w.length - 3; i++) t.add(w.slice(i, i + 3))
  }
  return t
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const item of a) if (b.has(item)) shared++
  return shared / (a.size + b.size - shared)
}

/** An entry with its trigrams worked out once, when the file is read. */
export type PreparedEntry = RankedEntry & { readonly tri: ReadonlySet<string> }

/**
 * Parses ranked-context.json text into its entries, each with its trigrams
 * (the file is re-read only when it changes, so this runs once per change,
 * not per prompt); anything not the expected shape reads as no entries.
 */
export function parseRanked(text: string): readonly PreparedEntry[] {
  try {
    const parsed: unknown = JSON.parse(text)
    const entries = (parsed as { entries?: unknown } | null)?.entries
    if (!Array.isArray(entries)) return []
    return entries
      .filter((e): e is RankedEntry => e !== null && typeof e === 'object')
      .map(e => ({ ...e, tri: trigrams(Array.isArray(e.words) ? e.words.filter(w => typeof w === 'string') : []) }))
  } catch {
    return []
  }
}

/**
 * The `[INTELLIGENCE]` block for a prompt, or null when nothing scores.
 *
 * @param prompt the prompt text
 * @param entries the ranked entries
 */
export function rankedContext(prompt: string, entries: readonly PreparedEntry[]): string | null {
  if (!prompt || entries.length === 0) return null
  const words = tokenize(prompt)
  if (words.length === 0) return null
  const promptTrigrams = trigrams(words)

  const scored: Array<RankedEntry & { score: number }> = []
  for (const entry of entries) {
    const pageRank = typeof entry.pageRank === 'number' ? entry.pageRank : 0
    const score = ALPHA * jaccard(promptTrigrams, entry.tri) + (1 - ALPHA) * pageRank
    if (score >= MIN_THRESHOLD) scored.push({ ...entry, score })
  }
  if (scored.length === 0) return null

  scored.sort((a, b) => b.score - a.score)
  const lines = ['[INTELLIGENCE] Relevant patterns for this task:']
  scored.slice(0, TOP_K).forEach((e, i) => {
    const display = plainText(String(e.summary || e.content || '')).slice(0, 80)
    lines.push(`  * (${e.score.toFixed(2)}) ${display} [rank #${i + 1}, ${e.accessCount || 0}x accessed]`)
  })
  return lines.join('\n')
}
