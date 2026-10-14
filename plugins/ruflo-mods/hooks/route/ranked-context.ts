/**
 * Ranked-memory context for a prompt: the scoring of intelligence.cjs
 * `getContext` (query-coverage scoring over inflection variants with IDF
 * weights and a small PageRank blend, top 5 at coverage >= 0.15; #4136),
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

const MIN_COVERAGE = 0.15
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

/** An entry with its term set worked out once, when the file is read. */
export type PreparedEntry = RankedEntry & { readonly tri: ReadonlySet<string>; readonly terms: ReadonlySet<string> }

/**
 * Inflection variants of a prompt term (plural, -ed, -ing, -ion and their
 * stems), as in intelligence.cjs: "migrations" finds "migration", "deploying"
 * finds "deploy". The stem keeps at least 4 characters so short words stay exact.
 */
export function termVariants(word: string): string[] {
  const out = new Set<string>([word])
  for (const suffix of ['s', 'es', 'ed', 'ing', 'ion', 'ions']) out.add(word + suffix)
  for (const suffix of ['ions', 'ion', 'ing', 'ed', 'es', 's']) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length)
      out.add(stem)
      out.add(stem + 'e')
      out.add(stem + 's')
    }
  }
  return [...out]
}

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
      .map(e => {
        const words = Array.isArray(e.words) ? e.words.filter((w): w is string => typeof w === 'string') : []
        return { ...e, tri: trigrams(words), terms: new Set(words) }
      })
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
  const promptWords = [...new Set(tokenize(prompt))]
  if (promptWords.length === 0) return null

  // Query coverage is independent of entry length; IDF downweights terms shared
  // by many entries; terms absent from every entry still count against coverage.
  const variants = promptWords.map(termVariants)
  const hasTerm = (terms: ReadonlySet<string>, i: number): boolean => variants[i].some(v => terms.has(v))
  const weights = promptWords.map((_word, i) => {
    let frequency = 0
    for (const entry of entries) if (hasTerm(entry.terms, i)) frequency++
    return Math.log1p((entries.length - frequency + 0.5) / (frequency + 0.5))
  })
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight === 0) return null

  const scored: Array<RankedEntry & { score: number }> = []
  for (const entry of entries) {
    let matchedWeight = 0
    let matchedTerms = 0
    for (let i = 0; i < promptWords.length; i++) {
      if (weights[i] > 0 && hasTerm(entry.terms, i)) {
        matchedWeight += weights[i]
        matchedTerms++
      }
    }
    // A single common word in a long prompt is not evidence of relevance.
    if (matchedTerms < Math.min(2, promptWords.length)) continue
    const coverage = matchedWeight / totalWeight
    if (coverage >= MIN_COVERAGE) {
      const pageRank = Math.max(0, Math.min(1, Number(entry.pageRank) || 0))
      scored.push({ ...entry, score: 0.9 * coverage + 0.1 * pageRank })
    }
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
