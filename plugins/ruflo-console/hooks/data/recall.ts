/**
 * Explain-a-recall and the pattern lifecycle (ADR-456): what the intelligence hook recalled, and what the stores it and
 * the neural verbs act on hold. Pure parsers and scoring, plus one bounded reader. Four files, each read as the engine
 * allows (see files.ts: a file over READ_MAX is never read), and each its own fact:
 *
 *   - `.claude-flow/data/ranked-context.json`  what the hook recalls from (summary, confidence, pageRank, accessCount)
 *   - `.claude-flow/sessions/session-*.json`   `context.lastMatchedPatterns`: the ids of each session's LAST recall
 *   - `.claude-flow/routing-outcomes.json`     task texts the router judged (the only prompts any hook file keeps)
 *   - `.claude-flow/neural/models.json`        the store `neural_patterns delete` and `neural_compress prune` act on
 *
 * Since ADR-472 the hook also appends `.claude-flow/data/recall-log.jsonl` (a digest of the prompt, the ids/scores/ranks it surfaced,
 * the router's pick). When a record exists it is shown as recorded. Older projects have no log, so a "past prompt" is re-scored against today's ranked file
 * with the hook's own formula (copied from .claude/helpers/intelligence.cjs getContext: tokenize, trigrams, jaccard,
 * 0.6 * match + 0.4 * pageRank, threshold 0.05, top 5) and is labelled a recomputation. `.claude-flow/neural/patterns.json`
 * (the ReasoningBank) is usually over READ_MAX and is not read; `reads.bank` says so.
 */
import { looksSecret } from './automate'
import { sha256 } from './ap-envelope'
import { jsonObject, msOf, numberOf, plain, recordOf } from './parse'
import { PROJECT, READ_MAX, readBounded, under, type ReaderFs, type ReadCache } from './files'

export const RANKED = '.claude-flow/data/ranked-context.json'
export const SESSIONS = '.claude-flow/sessions'
export const MODELS = '.claude-flow/neural/models.json'
export const BANK = '.claude-flow/neural/patterns.json'
/** ADR-472: what the intelligence hook logs per surfaced recall (ids, scores, ranks; a digest of the prompt, never its text). */
export const RECALL_LOG = '.claude-flow/data/recall-log.jsonl'
/** Records kept from the log, newest first: the log itself is capped at 1000 by the hook. */
export const LOG_KEPT = 1000
/** Recorded recalls the Learning Lab lists. */
export const LOGGED_SHOWN = 6

/** The hook's constants (intelligence.cjs getContext). */
export const ALPHA = 0.6
export const MIN_SCORE = 0.05
export const TOP_K = 5
/** How many session files are read, newest first. */
export const SESSIONS_READ = 8
export const PROMPTS_KEPT = 10

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

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))

export function trigrams(words: readonly string[]): Set<string> {
  const out = new Set<string>()

  for (const word of words) for (let i = 0; i <= word.length - 3; i++) out.add(word.slice(i, i + 3))

  return out
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0

  let shared = 0

  for (const item of a) if (b.has(item)) shared++

  return shared / (a.size + b.size - shared)
}

/** Text drawn from a file or typed in: control characters out, and any word shaped like a credential masked (a task text can hold a pasted key). */
export const shown = (value: unknown, max: number): string => plain(value, max * 2).split(' ').map(word => (looksSecret(word) ? '••••' : word)).join(' ').slice(0, max)

export type RankedEntry = { id: string; summary: string; category: string; confidence: number | null; pageRank: number; accessCount: number; words: string[] }
export type Ranked = { computedAtMs: number | null; entries: RankedEntry[] }

/** The order the hook sorts its own entries in (intelligence.cjs: 0.6 pageRank + 0.4 confidence). */
export const compositeRank = (entry: Pick<RankedEntry, 'pageRank' | 'confidence'>): number => ALPHA * entry.pageRank + (1 - ALPHA) * (entry.confidence ?? 0.5)

export function parseRanked(text: string | null): Ranked | null {
  const value = jsonObject(text)

  if (value === null || !Array.isArray(value.entries)) return null

  const entries = value.entries.flatMap((raw): RankedEntry[] => {
    const row = recordOf(raw)

    if (row === null || typeof row.id !== 'string') return []

    const words = Array.isArray(row.words) ? row.words.filter((word): word is string => typeof word === 'string') : []

    return [{ id: plain(row.id, 80), summary: shown(typeof row.summary === 'string' ? row.summary : typeof row.content === 'string' ? row.content : '', 80), category: plain(typeof row.category === 'string' ? row.category : '', 24), confidence: numberOf(row.confidence) ?? null, pageRank: numberOf(row.pageRank) ?? 0, accessCount: numberOf(row.accessCount) ?? 0, words }]
  })

  return { computedAtMs: msOf(value.computedAt) ?? null, entries }
}

export type Scored = { entry: RankedEntry; match: number; score: number }

/** An entry's trigram set, built once per entry object: the render re-explains the picked prompt on every refresh (profiled: trigrams() was 70% of the time). */
const gramsOf = new WeakMap<RankedEntry, Set<string>>()

const entryGrams = (entry: RankedEntry): Set<string> => {
  let grams = gramsOf.get(entry)

  if (grams === undefined) gramsOf.set(entry, (grams = trigrams(entry.words)))

  return grams
}

let lastExplain: { prompt: string; entries: readonly RankedEntry[]; out: Scored[] } | null = null

/** What the hook's getContext would surface for this prompt against these entries, best first; an empty list when nothing clears the threshold. The last answer is kept for the same prompt over the same entries array (a new ranked parse is a new array). */
export function explainPrompt(prompt: string, entries: readonly RankedEntry[]): Scored[] {
  if (lastExplain !== null && lastExplain.prompt === prompt && lastExplain.entries === entries) return lastExplain.out

  const words = tokenize(prompt)

  if (words.length === 0) return []

  const grams = trigrams(words)
  const out: Scored[] = []

  for (const entry of entries) {
    const match = jaccard(grams, entryGrams(entry))
    const score = ALPHA * match + (1 - ALPHA) * entry.pageRank

    if (score >= MIN_SCORE) out.push({ entry, match, score })
  }

  const best = out.sort((a, b) => b.score - a.score).slice(0, TOP_K)

  lastExplain = { prompt, entries, out: best }

  return best
}

/** One session's last recall: only ids are recorded (the prompt and the scores are not). */
export type SessionRecall = { file: string; startedAtMs: number | null; updatedAtMs: number | null; ids: string[] }

export function parseSessionRecall(file: string, text: string | null): SessionRecall | null {
  const value = jsonObject(text)
  const ids = recordOf(value?.context)?.lastMatchedPatterns

  if (value === null || !Array.isArray(ids)) return null

  return { file: plain(file, 60), startedAtMs: msOf(value.startedAt) ?? null, updatedAtMs: msOf(value.updatedAt) ?? null, ids: ids.filter((id): id is string => typeof id === 'string').slice(0, 20).map(id => plain(id, 80)) }
}

export type PastPrompt = { task: string; agent: string; ok: boolean; atMs: number; /** The hook's digest of this text (sha256 prefix, 16 hex): a recorded recall whose digest matches names this task. */ digest: string }

/** The distinct task texts the router judged, newest first: the only prompts a hook file keeps. */
export function parsePrompts(text: string | null): PastPrompt[] {
  const value = jsonObject(text)

  if (value === null || !Array.isArray(value.outcomes)) return []

  const rows = value.outcomes.flatMap((raw): PastPrompt[] => {
    const row = recordOf(raw)
    const atMs = msOf(row?.timestamp)

    return row === null || atMs === undefined || typeof row.task !== 'string' || row.task.trim() === '' ? [] : [{ task: shown(row.task, 160), agent: plain(typeof row.agent === 'string' ? row.agent : '?', 30), ok: row.success === true, atMs, digest: digestOf(row.task) }]
  })
  const seen = new Set<string>()
  const out: PastPrompt[] = []

  for (const row of rows.sort((a, b) => b.atMs - a.atMs)) {
    if (seen.has(row.task)) continue

    seen.add(row.task)
    out.push(row)
    if (out.length >= PROMPTS_KEPT) break
  }

  return out
}

/** The hook's digest of a prompt: first 16 hex characters of sha256 of the trimmed text (intelligence.cjs promptDigest). */
export const digestOf = (prompt: string): string => sha256(prompt.trim()).slice(0, 16)

export type LoggedItem = { id: string; score: number; rank: number; category: string }
/** One recall the hook recorded. No prompt text exists in the log; `digest` is the only handle on it. */
export type LoggedRecall = { atMs: number; sessionId: string | null; digest: string; surfaced: LoggedItem[]; router: { agent: string; confidence: number | null } | null }

/** The records of a recall-log.jsonl, newest first; lines that are not a valid record are skipped, never guessed at. */
export function parseRecallLog(text: string | null): LoggedRecall[] {
  if (text === null) return []

  const out: LoggedRecall[] = []

  for (const line of text.split('\n')) {
    if (line === '' || line.length > 20_000) continue

    let value: unknown

    try {
      value = JSON.parse(line)
    } catch {
      continue
    }

    const row = recordOf(value)
    const atMs = numberOf(row?.at)
    const digest = typeof row?.digest === 'string' && /^[0-9a-f]{8,64}$/.test(row.digest) ? row.digest : null

    if (row === null || atMs === undefined || atMs <= 0 || digest === null || !Array.isArray(row.surfaced)) continue

    const surfaced = row.surfaced.slice(0, 10).flatMap((raw): LoggedItem[] => {
      const item = recordOf(raw)
      const score = numberOf(item?.score)
      const rank = numberOf(item?.rank)

      return item === null || typeof item.id !== 'string' || item.id === '' || score === undefined || rank === undefined ? [] : [{ id: plain(item.id, 80), score, rank, category: plain(typeof item.cat === 'string' ? item.cat : '', 40) }]
    })

    if (surfaced.length === 0) continue

    const router = recordOf(row.router)

    out.push({ atMs, sessionId: typeof row.sid === 'string' ? plain(row.sid, 64) : null, digest, surfaced, router: router === null ? null : { agent: plain(typeof router.agent === 'string' ? router.agent : '?', 30), confidence: numberOf(router.confidence) ?? null } })
  }

  return out.sort((a, b) => b.atMs - a.atMs).slice(0, LOG_KEPT)
}

export type SurfacedCount = { id: string; category: string; count: number; lastAtMs: number }

/** How often each id was surfaced, and when last, over the recorded recalls: the real count a pattern's lifecycle row can show. */
export function surfacedCounts(log: readonly LoggedRecall[]): Map<string, SurfacedCount> {
  const out = new Map<string, SurfacedCount>()

  for (const recall of log) {
    for (const item of recall.surfaced) {
      const known = out.get(item.id)

      if (known === undefined) out.set(item.id, { id: item.id, category: item.category, count: 1, lastAtMs: recall.atMs })
      else {
        known.count += 1
        known.lastAtMs = Math.max(known.lastAtMs, recall.atMs)
      }
    }
  }

  return out
}

/** The span the log covers, oldest record to `nowMs`: an id absent from the log proves "not surfaced" only over this span. */
export const logWindowMs = (log: readonly LoggedRecall[], nowMs: number): number => (log.length === 0 ? 0 : Math.max(0, nowMs - (log[log.length - 1]?.atMs ?? nowMs)))

/** One pattern of `.claude-flow/neural/models.json`: only what the file records (no rank, no last-used time). */
export type NeuralPattern = { id: string; name: string; type: string; content: string; createdAtMs: number | null; usageCount: number; verdict: string | null }

export function parseNeuralStore(text: string | null): NeuralPattern[] | null {
  const value = jsonObject(text)
  const patterns = recordOf(value?.patterns)

  if (patterns === null) return null

  return Object.values(patterns).slice(0, 1000).flatMap((raw): NeuralPattern[] => {
    const row = recordOf(raw)

    if (row === null || typeof row.id !== 'string') return []

    const verdict = recordOf(row.metadata)?.verdict

    return [{ id: plain(row.id, 80), name: shown(typeof row.name === 'string' ? row.name : '', 90), type: plain(typeof row.type === 'string' ? row.type : '?', 24), content: plain(typeof row.content === 'string' ? row.content : '', 600), createdAtMs: msOf(row.createdAt) ?? null, usageCount: numberOf(row.usageCount) ?? 0, verdict: typeof verdict === 'string' ? plain(verdict, 20) : null }]
  })
}

/** Most used first, then oldest first: the order a prune is read in (the never-used, oldest ones last-but-visible together). */
export const lifecycleOrder = (rows: readonly NeuralPattern[]): NeuralPattern[] => [...rows].sort((a, b) => b.usageCount - a.usageCount || (a.createdAtMs ?? Infinity) - (b.createdAtMs ?? Infinity))

/** The ids `neural_compress prune` with this threshold would remove: usageCount below it (neural-tools.ts). */
export const wouldPrune = (rows: readonly NeuralPattern[], threshold: number): string[] => rows.filter(row => row.usageCount < threshold).map(row => row.id)

export type ReadStatus = 'ok' | 'missing' | 'too-large' | 'refused' | 'not-regular'

export type RecallFacts = {
  ranked: Ranked | null
  sessions: SessionRecall[]
  prompts: PastPrompt[]
  neural: NeuralPattern[] | null
  /** ADR-472: the hook's recall log, newest first; empty when the hook has not written one (an older helper, or RUFLO_RECALL_LOG=0). */
  log: LoggedRecall[]
  /** Per source: ok, missing, or too-large (the ReasoningBank patterns.json is read only for its size). */
  reads: { ranked: ReadStatus; sessions: ReadStatus; prompts: ReadStatus; neural: ReadStatus; bank: ReadStatus; log: ReadStatus }
}

/** The recall facts of a snapshot that carries them, else null: the view's one accessor. */
export const recallOf = (snapshot: object | null | undefined): RecallFacts | null => (snapshot as { recall?: RecallFacts } | null | undefined)?.recall ?? null

const status = (read: { text: string | null; reason?: string }): ReadStatus => (read.text !== null ? 'ok' : ((read.reason ?? 'missing') as ReadStatus))

let lastRanked: { text: string; parsed: Ranked | null } | null = null
let lastModels: { text: string; parsed: NeuralPattern[] | null } | null = null
let lastOutcomes: { text: string; parsed: PastPrompt[] } | null = null
let lastLog: { text: string; parsed: LoggedRecall[] } | null = null

/** Reads the four files (and stats the bank); never rejects. `fs.read` of a file over its cap is refused by readBounded. */
export async function readRecall(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<RecallFacts> {
  const [ranked, models, outcomes, logRead, bankStat, listed] = await Promise.all([
    readBounded(fs, cache, under(cwd, RANKED)),
    readBounded(fs, cache, under(cwd, MODELS)),
    readBounded(fs, cache, under(cwd, PROJECT.outcomes)),
    readBounded(fs, cache, under(cwd, RECALL_LOG), READ_MAX, true),
    fs.stat(under(cwd, BANK)).catch(() => undefined),
    fs.list(under(cwd, SESSIONS)).catch(() => null),
  ])
  const files = (listed ?? []).filter(entry => entry.kind !== 'dir' && /^session-\d+\.json$/.test(entry.name)).sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)).slice(0, SESSIONS_READ)
  const reads = await Promise.all(files.map(async entry => ({ name: entry.name, read: await readBounded(fs, cache, under(cwd, `${SESSIONS}/${entry.name}`), 100_000, true) })))
  const sessions = reads.flatMap(({ name, read }) => {
    const parsed = parseSessionRecall(name, read.text)

    return parsed === null ? [] : [parsed]
  })

  // The ranked file is parsed again only when its text changed: the snapshot runs on a timer.
  if (ranked.text !== null && lastRanked?.text !== ranked.text) lastRanked = { text: ranked.text, parsed: parseRanked(ranked.text) }

  if (models.text !== null && lastModels?.text !== models.text) lastModels = { text: models.text, parsed: parseNeuralStore(models.text) }
  if (outcomes.text !== null && lastOutcomes?.text !== outcomes.text) lastOutcomes = { text: outcomes.text, parsed: parsePrompts(outcomes.text) }
  if (logRead.text !== null && lastLog?.text !== logRead.text) lastLog = { text: logRead.text, parsed: parseRecallLog(logRead.text) }

  return {
    ranked: ranked.text === null ? null : (lastRanked?.parsed ?? null),
    sessions,
    prompts: outcomes.text === null ? [] : (lastOutcomes?.parsed ?? []),
    neural: models.text === null ? null : (lastModels?.parsed ?? null),
    log: logRead.text === null ? [] : (lastLog?.parsed ?? []),
    reads: { ranked: status(ranked), sessions: listed === null ? 'missing' : 'ok', prompts: status(outcomes), neural: status(models), bank: bankStat === undefined ? 'missing' : (bankStat.size ?? 0) > READ_MAX ? 'too-large' : 'ok', log: status(logRead) },
  }
}
