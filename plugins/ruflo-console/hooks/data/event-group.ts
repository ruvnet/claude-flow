/**
 * Grouping and correlation for the Events page (ADR-474): bursts of the same kind of line collapse into one row with a count, a ref
 * (an agent, a claim, a run) gathers its events, and `follow` keeps one ref's events with whatever happened within 30 s of them.
 * Pure over an oldest-first list.
 */
import { refOf, type ConsoleEvent } from './events'

export const BURST_GAP_MS = 30_000
export const FOLLOW_SPAN_MS = 30_000

/** The line with its numbers, hex runs and quoted names turned into placeholders: two lines of one template share it. */
export function templateOf(text: string): string {
  return text.replace(/\b[0-9a-f]{6,}\b/gi, '#').replace(/\d+(?:\.\d+)?/g, '#').replace(/"[^"]*"/g, '"_"').toLowerCase()
}

export type Row = {
  /** The newest event of the burst: what the row shows. */
  event: ConsoleEvent
  /** Every event of the burst, oldest first (one for a plain row). */
  members: ConsoleEvent[]
  /** `<atMs>:<kind>:<length>:<hash>` of the newest member, the row's identity (the page adds `~n` where two rows are still identical). */
  id: string
}

export const idOf = (event: ConsoleEvent): string => `${event.atMs}:${event.kind}:${event.text.length}:${hashOf(event.text)}`

/** A short hash of the words (FNV-1a, 32 bits, base 36): two events of one millisecond and one length no longer share an id. */
function hashOf(text: string): string {
  let h = 0x811c9dc5

  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)

  return (h >>> 0).toString(36)
}

/** Newest-last events as rows: neighbours of one kind and template inside `gapMs` of each other are one row. */
export function collapse(events: readonly ConsoleEvent[], gapMs = BURST_GAP_MS): Row[] {
  const rows: Row[] = []
  const open = new Map<string, Row>()

  for (const event of events) {
    const key = `${event.kind}|${event.agentId ?? ''}|${templateOf(event.text)}`
    const row = open.get(key)

    if (row !== undefined && event.atMs - row.event.atMs <= gapMs) {
      row.members.push(event)
      row.event = event
      row.id = idOf(event)
      continue
    }

    const fresh: Row = { event, members: [event], id: idOf(event) }

    open.set(key, fresh)
    rows.push(fresh)
  }

  return rows
}

/** The events of `ref`, and every event within `spanMs` before or after any of them. A ref nothing matches gives []. */
export function follow(events: readonly ConsoleEvent[], ref: string, spanMs = FOLLOW_SPAN_MS): { own: number; events: ConsoleEvent[] } {
  const wanted = ref.toLowerCase()
  const own = events.filter(event => (refOf(event) ?? '').toLowerCase() === wanted || `agent:${event.agentId ?? ''}`.toLowerCase() === wanted)

  if (own.length === 0) return { own: 0, events: [] }

  const marks = own.map(event => event.atMs).sort((x, y) => x - y)

  return {
    own: own.length,
    events: events.filter(event => {
      let lo = 0
      let hi = marks.length

      while (lo < hi) {
        const mid = (lo + hi) >> 1

        if ((marks[mid] as number) < event.atMs) lo = mid + 1
        else hi = mid
      }

      return Math.abs((marks[lo] ?? Infinity) - event.atMs) <= spanMs || Math.abs((marks[lo - 1] ?? Infinity) - event.atMs) <= spanMs
    }),
  }
}

/** The `n` events before and after `events[index]`, oldest first; nothing for an index outside the list. */
export function neighbours(events: readonly ConsoleEvent[], index: number, n = 5): { before: ConsoleEvent[]; after: ConsoleEvent[] } {
  if (index < 0 || index >= events.length) return { before: [], after: [] }

  return { before: events.slice(Math.max(0, index - n), index), after: events.slice(index + 1, index + 1 + n) }
}
