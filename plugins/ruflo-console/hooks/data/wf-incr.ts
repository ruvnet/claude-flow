/**
 * Incremental transcript parsing (ADR-473). A live workflow agent's transcript only ever grows by appending lines, yet every
 * refresh used to parse the whole text again. Here a transcript keeps a parse state: how far the text was consumed (always just
 * after a newline, so no line straddles a chunk), a short anchor of the text before that point, and the running figures. A changed
 * text is checked against the anchor and, if it continues the old one, only the part after the consumed point is parsed. Anything
 * that does not check out (truncation, a rewrite, a window that slid past the anchor, an ambiguous match) is parsed whole: the
 * fallback is always a full parse, never a guess. A last line with no newline yet is parsed for the answer but not committed, so
 * the next call sees it again, finished.
 *
 * The folds below are written beside, not on top of, `parseTranscript` (data/workflows.ts) and `parseActivity` (data/wf-activity.ts):
 * those stay the reference the property test (tests/wf-incr.spec.ts) compares every append sequence against.
 *
 * This module parses text. It does not read: the host's `$.fs` has no range read, so on a whole-file read the saving is the parse (the
 * costly part), and the bytes saved are only where a host offers `readTail`.
 */
import { LINE_CAP, num, str, type TranscriptFacts } from './workflows'

export type Rec = Record<string, unknown>

/** One line as a record, by the rules of `jsonLines`: an object that parses, on a line of 2 to LINE_CAP characters starting with `{`. */
export function recordOf(line: string): Rec | null {
  if (line.length < 2 || line.length > LINE_CAP || line.charCodeAt(0) !== 123) return null

  try {
    const value: unknown = JSON.parse(line)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null
  } catch {
    return null
  }
}

/** Feeds every complete line of `text` from `from` to `fold`; returns the offset just after the last newline (never before `from`). */
export function scanLines(text: string, from: number, fold: (rec: Rec) => void): number {
  const end = text.lastIndexOf('\n') + 1
  let pos = from

  while (pos < end) {
    const nl = text.indexOf('\n', pos)
    const rec = nl - pos < 2 ? null : recordOf(text.slice(pos, nl))

    if (rec !== null) fold(rec)

    pos = nl + 1
  }

  return Math.max(from, end)
}

const ANCHOR_CHARS = 4096
const HEAD_CHARS = 512
/** A tail window slides, so its anchor is searched for: a short one could match some other place by chance, a long one cannot. Below this the window is parsed whole (it is small by definition). */
const MIN_TAIL_ANCHOR = 1024

type Cursor = { src: string; tag: string; consumed: number; head: string; anchor: string; isTail: boolean }

/** Where the old parse can carry on in `text`, or null where it cannot be shown to continue (then the caller parses whole). */
function resumeAt(c: Cursor, text: string, isTail: boolean): number | null {
  if (c.isTail !== isTail || c.anchor === '') return null

  if (!isTail) {
    // A whole file only grows at its end: same first characters, same text just before the consumed point (a text cut shorter than that point cannot hold it).
    return text.startsWith(c.head) && text.startsWith(c.anchor, c.consumed - c.anchor.length) ? c.consumed : null
  }

  // A tail window slides: the anchor must be found, once, in the new window.
  if (c.anchor.length < MIN_TAIL_ANCHOR) return null

  const at = text.indexOf(c.anchor)

  return at < 0 || text.indexOf(c.anchor, at + 1) >= 0 ? null : at + c.anchor.length
}

export type Outcome = 'fresh' | 'resumed' | 'same'
export type Update<R> = { value: R; how: Outcome; /** Characters this call parsed (the whole text for a fresh parse). */ fed: number }

/** What a fold does to its state for a line that may still change: apply it, and the returned function takes it back. */
export type Tentative = () => void

/** The shared machinery: resume or restart, scan the new lines, build the answer with an unfinished last line counted. */
export abstract class Incremental<R> {
  private cursor: Cursor | null = null
  private last: R | null = null
  protected abstract restart(): void
  protected abstract fold(rec: Rec): void
  protected abstract tentative(rec: Rec): Tentative
  /** Called after each committed batch (the activity fold trims its ring here). */
  protected settle(): void {}
  protected abstract build(isTail: boolean): R

  /** Characters held that belong to this state beyond the text (for the LRU's weight): the text itself is held by the caller. */
  abstract weight(): number

  /** `tag` says which version of the file `text` is (its size and mtime): a tail window can read the same at two places, and only a differing tag then tells them apart. */
  update(text: string, isTail: boolean, tag = ''): Update<R> {
    const c = this.cursor

    if (c !== null && this.last !== null && c.src === text && c.tag === tag && c.isTail === isTail) return { value: this.last, how: 'same', fed: 0 }

    const resume = c === null ? null : resumeAt(c, text, isTail)
    let from = resume

    if (from === null) {
      this.restart()
      // A tail window starts mid-line: its first line is dropped (the whole text where it holds no newline, as `parseTranscript` does).
      from = isTail ? text.indexOf('\n') + 1 : 0
    }

    const lower = resume === null ? from : 0
    const consumed = scanLines(text, from, rec => this.fold(rec))

    this.settle()

    const pending = consumed < text.length ? recordOf(text.slice(consumed)) : null
    const undo = pending === null ? null : this.tentative(pending)
    const value = this.build(isTail)

    undo?.()
    this.last = value
    this.cursor = { src: text, tag, consumed, isTail, head: text.slice(0, Math.min(HEAD_CHARS, consumed)), anchor: text.slice(Math.max(lower, consumed - ANCHOR_CHARS), consumed) }

    return { value, how: resume === null ? 'fresh' : 'resumed', fed: text.length - from }
  }
}

/**
 * `parseTranscript`'s answer, folded line by line. Messages are keyed by id (a streamed message repeats its lines), the line number
 * stands in for a missing id, and the tokens are those of the last keyed message that carried usage.
 */
export class FactsIncr extends Incremental<TranscriptFacts> {
  private usage = new Map<string, number>()
  private model: string | undefined
  private firstMs: number | undefined
  private lastMs: number | undefined
  private lastKey: string | undefined
  private toolCalls = 0
  private lastTool: string | undefined
  private lineNo = 0
  /** Set while a line is applied tentatively: the key it wrote and what was there. */
  private wrote: { key: string; prev: number | undefined } | null = null

  protected restart(): void {
    this.usage = new Map()
    this.model = this.firstMs = this.lastMs = this.lastKey = this.lastTool = undefined
    this.toolCalls = 0
    this.lineNo = 0
  }

  weight(): number {
    return this.usage.size * 48
  }

  protected fold(line: Rec): void {
    const index = this.lineNo++
    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN

    if (Number.isFinite(at)) {
      this.firstMs ??= at
      this.lastMs = at
    }

    const message = typeof line.message === 'object' && line.message !== null && !Array.isArray(line.message) ? (line.message as Rec) : null

    if (line.type !== 'assistant' || message === null) return

    const u = typeof message.usage === 'object' && message.usage !== null && !Array.isArray(message.usage) ? (message.usage as Rec) : null
    const key = str(message.id, 80) ?? `line-${index}`

    if (u !== null) {
      this.wrote = { key, prev: this.usage.get(key) }
      this.usage.set(key, (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.output_tokens) ?? 0))
      this.lastKey = key
    }

    this.model = str(message.model, 60) ?? this.model

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const b = typeof block === 'object' && block !== null && !Array.isArray(block) ? (block as Rec) : null

        if (b?.type === 'tool_use') {
          this.toolCalls += 1
          this.lastTool = str(b.name, 40) ?? this.lastTool
        }
      }
    }
  }

  protected tentative(rec: Rec): Tentative {
    const saved = { model: this.model, firstMs: this.firstMs, lastMs: this.lastMs, lastKey: this.lastKey, toolCalls: this.toolCalls, lastTool: this.lastTool, lineNo: this.lineNo }

    this.wrote = null
    this.fold(rec)

    const wrote = this.wrote as { key: string; prev: number | undefined } | null

    return () => {
      Object.assign(this, saved)

      if (wrote !== null) {
        if (wrote.prev === undefined) this.usage.delete(wrote.key)
        else this.usage.set(wrote.key, wrote.prev)
      }
    }
  }

  protected build(): TranscriptFacts {
    const tokens = this.lastKey === undefined ? undefined : this.usage.get(this.lastKey)

    return {
      toolCalls: this.toolCalls,
      messages: this.usage.size,
      ...(this.model !== undefined && { model: this.model }),
      ...(tokens !== undefined && { tokens }),
      ...(this.firstMs !== undefined && { firstMs: this.firstMs }),
      ...(this.lastMs !== undefined && { lastMs: this.lastMs }),
      ...(this.lastTool !== undefined && { lastTool: this.lastTool }),
    }
  }
}
