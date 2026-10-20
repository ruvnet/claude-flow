/**
 * Text a person typed is never silently shortened (ADR-481). Two shared helpers, so no call site writes its own cut:
 *
 *  - {@link showFull}: the whole text, wrapped over as many lines as it needs, for the view where it is the primary content. When the
 *    block would pass `maxLines` it ends in an explicit marker with the number of lines that are hidden and how to see them: never an
 *    unmarked cut.
 *  - {@link checkLimit}: the one place a real limit (the ruflo mission record, a task title, an OS or MCP bound) is checked, BEFORE
 *    anything is sent. Over the limit it says the exact limit and how many characters are over; the caller keeps the person's text.
 *
 * Pure: strings in, strings out. Counts are code points ("characters" as a person counts them), and a wrap never splits a surrogate
 * pair, so unicode text survives both.
 */

import { plain } from './data/parse'

/**
 * The most a host Input holds. Measured (tests/full-text.test.ts): an Input whose `value` is longer makes the engine refuse the WHOLE pane
 * ("Input value longer than 10000 characters; the engine drew its own"), so no field can carry more, and no value above it may ever be drawn.
 */
export const INPUT_VALUE_MAX = 10_000

/** Characters a person's long-form text may have when it is sent to Claude as a prompt (stdin or the session prompt: no argv is involved): what a field can hold. */
export const LONG_TEXT_MAX = INPUT_VALUE_MAX

/**
 * The most a ruflo mission record takes as its objective: `mission_create`'s input schema says `objective: { maxLength: 2000 }`
 * (v3/@claude-flow/cli/src/mcp-tools/mission-tools.ts). A real limit; over it the mission is not created and the person is told by how much.
 */
export const MISSION_OBJECTIVE_MAX = 2_000

/**
 * The most text of a person's that rides in ONE argv element or one JSON argument of a `ruflo mcp exec -p <json>` child process. Linux allows 128 KiB
 * per element (MAX_ARG_STRLEN) and Windows 32,767 characters for the whole command line, so 8,000 characters (a JSON escape can double that) is
 * the largest value that is safe on both.
 */
export const ARGV_TEXT_MAX = 8_000

/** Lines a full-text block shows before it ends in the marker: generous (a screenful and then some), and always explicit. */
export const SHOW_LINES = 40

/** Number of code points in `text`. */
export const countOf = (text: string): number => {
  let count = 0

  for (const _ of text) count++

  return count
}

/** `12345` as `12,345`: the same digits whatever the locale, so a message is the same everywhere. */
export const grouped = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * The text as lines no wider than `width`: it breaks at spaces, keeps the person's own line breaks, and breaks a word longer than the
 * width (a URL, a path, 12,000 characters without a space) into pieces instead of cutting it. Nothing is dropped: the lines joined
 * back (spaces at a break aside) are the text.
 */
export function wrapFull(text: string, width: number): string[] {
  const w = Math.max(8, Math.floor(width))
  const out: string[] = []

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let current = ''
    let currentLen = 0

    const flush = () => {
      out.push(current)
      current = ''
      currentLen = 0
    }

    for (const word of paragraph.split(' ')) {
      const letters = Array.from(word)

      // A word that cannot fit on a line of its own is broken into full lines; the rest starts the next line.
      if (letters.length > w) {
        if (current !== '') flush()

        let i = 0

        for (; letters.length - i > w; i += w) out.push(letters.slice(i, i + w).join(''))
        current = letters.slice(i).join('')
        currentLen = letters.length - i

        continue
      }

      if (currentLen === 0 && current === '') {
        current = word
        currentLen = letters.length
      } else if (currentLen + 1 + letters.length > w) {
        flush()
        current = word
        currentLen = letters.length
      } else {
        current = `${current} ${word}`
        currentLen += 1 + letters.length
      }
    }

    flush()
  }

  return out
}

export type Shown = {
  /** The lines to draw, the marker last when some are hidden. */
  lines: string[]
  /** Lines the whole text needs at this width. */
  total: number
  /** Lines left out of `lines` (0 when all are shown). */
  hidden: number
  /** The marker line, or null when everything is shown. */
  marker: string | null
}

/** `… (+3 more lines, press ✎ edit to view/edit)`: how many lines are left out, and where to read them. */
export const markerFor = (hidden: number, hint: string): string => `… (+${grouped(hidden)} more line${hidden === 1 ? '' : 's'}, ${hint})`

/**
 * The text in full: wrapped to `width` and cut at `maxLines` lines only with the marker, which names the hidden line count. `hint` says
 * where the rest can be read or edited (`press ✎ edit to view/edit`). The marker counts as one of the lines drawn.
 */
export function showFull(text: string, width: number, opts: { maxLines?: number; hint?: string } = {}): Shown {
  const maxLines = Math.max(2, opts.maxLines ?? SHOW_LINES)
  const hint = opts.hint ?? 'press ✎ edit to view/edit'
  const all = wrapFull(text, width)

  if (all.length <= maxLines) return { lines: all, total: all.length, hidden: 0, marker: null }

  // One slot goes to the marker, so the block is never taller than maxLines.
  const kept = all.slice(0, maxLines - 1)
  const hidden = all.length - kept.length
  const marker = markerFor(hidden, hint)

  return { lines: [...kept, marker], total: all.length, hidden, marker }
}

export type Limit = { ok: true; length: number } | { ok: false; length: number; limit: number; over: number; message: string }

/**
 * Whether `text` fits a real limit. Over it: the exact message (what, the limit, the length, the characters over), for the caller to show
 * BEFORE acting; the caller keeps the text in the field and runs nothing. `why` names the reason for the limit.
 */
export function checkLimit(text: string, limit: number, what: string, why = '', tail = 'Nothing was sent or changed; shorten it and ask again.'): Limit {
  const length = countOf(text)

  if (length <= limit) return { ok: true, length }

  const over = length - limit

  return {
    ok: false,
    length,
    limit,
    over,
    message: `${what} is ${grouped(length)} characters; the limit is ${grouped(limit)}${why === '' ? '' : ` (${why})`}: ${grouped(over)} over. ${tail}`,
  }
}

/** A one-line label for the text with an ellipsis where it is shortened (a title, a menu line); the full text lives elsewhere. */
export function labelOf(text: string, width: number): string {
  const letters = Array.from(text.replace(/\s+/g, ' ').trim())

  return letters.length <= width ? letters.join('') : `${letters.slice(0, Math.max(0, width - 1)).join('')}…`
}

/**
 * Printable text for a long-form field: the escape sequences, controls and hidden characters `plain` removes go too, but the person's own
 * line breaks stay, and nothing is shortened. Use it where the destination takes several lines (a prompt to Claude); use `plain(text,
 * LONG_TEXT_MAX)` where the destination is one line (a slash command's arguments, a title) and say so.
 */
export function keepLines(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value
    .split(/\r\n|\r|\n/)
    .map(line => plain(line, Number.MAX_SAFE_INTEGER))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The text as pieces of at most `size` characters, each overlapping the previous by `overlap` (so a phrase that straddles a boundary is whole in one
 * of them), for a check that can take only `size` at a time. One piece when the text fits. Code-point safe.
 */
export function chunksOf(text: string, size: number, overlap = 0): string[] {
  const letters = Array.from(text)

  if (letters.length <= size) return [text]

  const step = Math.max(1, size - Math.max(0, Math.min(overlap, size - 1)))
  const out: string[] = []

  for (let i = 0; i < letters.length; i += step) {
    out.push(letters.slice(i, i + size).join(''))
    if (i + size >= letters.length) break
  }

  return out
}

/** The typed two-character sequence `\n` is a line break (the host's field is one line and has no key for a new line); real line breaks are kept as they are. */
export const withBreaks = (text: string): string => text.replace(/\\n/g, '\n')

/**
 * A draft as it is typed: wrapped to `width`, and when it is taller than `maxLines` the LAST lines (where the cursor is), led by an explicit marker
 * with the number of earlier lines. `total` is the line count for a "N lines" indicator.
 */
export function showTail(text: string, width: number, maxLines = 12): Shown {
  const all = wrapFull(withBreaks(text), width)

  if (all.length <= maxLines) return { lines: all, total: all.length, hidden: 0, marker: null }

  const kept = all.slice(all.length - (maxLines - 1))
  const hidden = all.length - kept.length
  const marker = `… (${grouped(hidden)} earlier line${hidden === 1 ? '' : 's'} above; all of it is kept and sent)`

  return { lines: [marker, ...kept], total: all.length, hidden, marker }
}
