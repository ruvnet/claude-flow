/**
 * The parsed transcripts the console holds, by path (ADR-473): one `ActivityIncr` state per transcript, so a transcript that grew is
 * parsed from where it left off, not from its first line. The drill's `parsedOf` and the folder reader's background warm-up both go through
 * here, which is what lets a search over every agent find its transcripts already parsed.
 *
 * Bounded by the text held, not by a count of files: a live project has 6 runs x 60 agents. The state of a transcript no frame has asked for
 * (a path not seen again) is the oldest in the map and goes first.
 */
import type { Parsed } from './wf-activity'
import { ActivityIncr } from './wf-incr-activity'

/** What the memo may keep, in characters of transcript text (a parsed transcript is no bigger than its text). */
export const PARSED_BUDGET_CHARS = 24_000_000
const PARSED_MAX_ENTRIES = 1024
/**
 * What the background warm-up may parse in one refresh: about 10 ms, inside one frame. It fills the memo up to its budget and no further, so it never
 * evicts what it parsed a minute before (the search stops at 8 million characters of entries, which is most of the 24 million of transcript text the memo
 * keeps: the lines carry ids, usage and streamed repeats).
 */
export const WARM_CHARS_PER_REFRESH = 400_000

type Held = { src: string; tag: string; isTail: boolean; parsed: Parsed; state: ActivityIncr }

const memo = new Map<string, Held>()
let chars = 0
let parses = 0
let resumed = 0
let fed = 0
let warmed = 0
let warmLeft = WARM_CHARS_PER_REFRESH

/** What the memo holds and how much parsing it has done: what a test or a bench reads to prove a frame parsed nothing, or only what was new. */
export const parsedStats = (): { entries: number; chars: number; parses: number; /** Of those, the ones that carried on from a held state. */ resumed: number; /** Characters parsed in all (a fresh parse counts the whole text). */ fed: number; /** Parses done ahead of time by a refresh; not in `parses`. */ warmed: number } => ({ entries: memo.size, chars, parses, resumed, fed, warmed })

export function resetStore(): void {
  memo.clear()
  chars = parses = resumed = fed = warmed = 0
  warmLeft = WARM_CHARS_PER_REFRESH
}

function hold(path: string, entry: Held): void {
  const old = memo.get(path)

  if (old !== undefined) chars -= old.src.length

  memo.delete(path)
  memo.set(path, entry)
  chars += entry.src.length

  for (const [key, held] of memo) {
    if (key === path || (chars <= PARSED_BUDGET_CHARS && memo.size <= PARSED_MAX_ENTRIES)) break

    memo.delete(key)
    chars -= held.src.length
  }
}

function parse(path: string, text: string, isTail: boolean, tag: string): Held {
  const held = memo.get(path)

  if (held !== undefined && held.isTail === isTail && held.tag === tag && held.src === text) return held

  const state = held?.state ?? new ActivityIncr()
  const done = state.update(text, isTail, tag)
  const entry: Held = { src: text, tag, isTail, parsed: done.value, state }

  fed += done.fed
  if (done.how === 'resumed') resumed += 1

  hold(path, entry)

  return entry
}

/** A transcript's activity, parsed from where the last parse of this path ended; the held answer where the text is the one it was made from. */
export function activityOf(path: string, text: string, isTail: boolean, tag = ''): Parsed {
  const held = memo.get(path)

  if (held !== undefined && held.isTail === isTail && held.tag === tag && held.src === text) return held.parsed

  parses += 1

  return parse(path, text, isTail, tag).parsed
}

/** Called once at the start of a refresh: gives the warm-up its allowance for this pass. */
export function beginWarm(): void {
  warmLeft = WARM_CHARS_PER_REFRESH
}

/**
 * Parses a whole transcript a refresh has just read, ahead of any frame that would ask for it, while this pass's allowance and the held-text
 * ceiling last. A transcript already current costs nothing; one that grew costs the new lines. Never parses a tail.
 */
export function warmActivity(path: string, text: string): void {
  const held = memo.get(path)

  if (held !== undefined && !held.isTail && held.tag === '' && held.src === text) return
  if (warmLeft <= 0 || (held === undefined && chars + text.length > PARSED_BUDGET_CHARS)) return

  const before = fed

  warmed += 1
  parse(path, text, false, '')
  warmLeft -= Math.max(1, fed - before)
}
