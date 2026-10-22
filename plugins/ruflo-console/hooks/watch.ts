/**
 * The Timeline and Events pages' own state and actions: how far back the timeline looks (5, 15 or 60 minutes), and for the event
 * stream a kind filter with counts, a text search, pause (the tail stops moving so a line can be read), paging back through what was
 * kept, and one event opened for its detail. Pure state over what the console already observed; nothing here reads or writes ruflo.
 */
import { plain } from './data/parse'
import type { ConsoleEvent } from './data/events'
import type { State } from './state'

export const RANGES: readonly { ms: number; label: string }[] = [
  { ms: 5 * 60_000, label: '5 min' },
  { ms: 15 * 60_000, label: '15 min' },
  { ms: 60 * 60_000, label: '60 min' },
]
export const PAGE = 12

export type WatchState = {
  rangeMs: number
  query: string
  /** The number of events when the tail was paused, or null while it runs. */
  pausedAt: number | null
  /** The event opened for detail: `<atMs>:<text length>`. */
  open: string | null
  /** Pages back from the newest. */
  page: number
}

const states = new WeakMap<State, WatchState>()

export function watchOf(state: State): WatchState {
  let found = states.get(state)

  if (found === undefined) {
    found = { rangeMs: 15 * 60_000, query: '', pausedAt: null, open: null, page: 0 }
    states.set(state, found)
  }

  return found
}

export const idOf = (event: ConsoleEvent): string => `${event.atMs}:${event.text.length}`

/** The events this page shows: the kind filter, the text search, and nothing newer than the pause point; oldest first. */
export function eventsShown(state: State): ConsoleEvent[] {
  const watch = watchOf(state)
  const query = watch.query.trim().toLowerCase()
  const base = watch.pausedAt === null ? state.events : state.events.slice(0, watch.pausedAt)

  return base.filter(event => (state.eventFilter === 'all' || event.kind === state.eventFilter) && (query === '' || event.text.toLowerCase().includes(query) || event.kind.includes(query)))
}

/** How many events of each kind (of what the pause point lets through), for the chips. */
export function kindCounts(state: State): Map<string, number> {
  const watch = watchOf(state)
  const base = watch.pausedAt === null ? state.events : state.events.slice(0, watch.pausedAt)
  const counts = new Map<string, number>()

  for (const event of base) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)

  return counts
}

/** Events per minute over the last `minutes`, oldest first, for a sparkline. */
export function perMinute(events: readonly ConsoleEvent[], nowMs: number, minutes = 15): number[] {
  const bins = new Array<number>(minutes).fill(0)

  for (const event of events) {
    const back = Math.floor((nowMs - event.atMs) / 60_000)

    if (back >= 0 && back < minutes) bins[minutes - 1 - back] = (bins[minutes - 1 - back] ?? 0) + 1
  }

  return bins
}

export type WatchActions = {
  range: (ms: number) => void
  kind: (kind: State['eventFilter']) => void
  query: (text: string) => void
  /** Stops the tail where it is, or lets it run again. */
  pause: () => void
  /** Opens an event for detail, or closes it. */
  open: (id: string) => void
  /** Pages back (positive) or forward through the shown events. */
  page: (by: number) => void
  /** Asks the main Claude about one event or one agent (it asks first). */
  ask: (question: string) => void
}

export function watchActions(state: State, invalidate: () => void, ask: (question: string, view: 'events' | 'timeline') => void): WatchActions {
  const watch = watchOf(state)

  return {
    range: ms => {
      if (RANGES.some(range => range.ms === ms)) watch.rangeMs = ms
      invalidate()
    },
    kind: kind => {
      state.eventFilter = kind
      watch.page = 0
      invalidate()
    },
    query: text => {
      watch.query = plain(text, 80)
      watch.page = 0
      invalidate()
    },
    pause: () => {
      watch.pausedAt = watch.pausedAt === null ? state.events.length : null
      watch.page = 0
      invalidate()
    },
    open: id => {
      watch.open = watch.open === id ? null : id
      invalidate()
    },
    page: by => {
      const last = Math.max(0, Math.ceil(eventsShown(state).length / PAGE) - 1)

      watch.page = Math.max(0, Math.min(last, watch.page + by))
      invalidate()
    },
    ask: question => ask(plain(question, 600), state.view === 'timeline' ? 'timeline' : 'events'),
  }
}
