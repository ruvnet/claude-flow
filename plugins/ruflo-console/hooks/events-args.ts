/**
 * `/ruflo events <args>` (ADR-474): sets the Events page's filters and returns what to say. The export and forget verbs are for the
 * caller (they need the host and the confirm card).
 */
import { eventsActions, eventsModel, eventsUi } from './events-ui'
import { formatOf } from './data/event-export'
import { maskLine } from './data/event-mask'
import { EMPTY_QUERY, parseQuery, QUERY_MAX } from './data/event-query'
import { isLevel } from './data/event-severity'
import { isWindowId } from './data/event-stats'
import { EVENT_KINDS } from './data/events'
import type { Host } from './host'
import type { State } from './state'

export function applyEventsArgs(state: State, args: readonly string[]): { text: string; export?: { format: 'md' | 'jsonl'; path: string }; forget?: boolean } {
  const ui = eventsUi(state)
  const [first = '', ...rest] = args
  const word = first.toLowerCase()
  const sync = (): void => {
    ui.page = 0
    ui.focus = 0
  }

  if (word === '') return { text: summary(state) }

  if (word === 'clear') {
    ui.query = ''
    ui.parsed = EMPTY_QUERY
    ui.level = 'all'
    ui.followRef = null
    ui.narrowed = null
    state.eventFilter = 'all'
    sync()

    return { text: 'events: filters cleared' }
  }

  if (word === 'forget') return { text: 'asking before the history files are removed', forget: true }

  if (word === 'export') {
    const path = rest.join(' ').trim()

    return { text: 'checking the path', export: { format: formatOf(path) === 'jsonl' ? 'jsonl' : 'md', path } }
  }

  if (word === 'follow') {
    const ref = rest.join(' ').trim()

    ui.followRef = ref === '' ? null : maskLine(ref, 80)
    sync()

    return { text: ref === '' ? 'events: follow off' : `events: following ${ui.followRef} and what happened within 30 s of it` }
  }

  if (word === 'window') {
    const id = rest[0] ?? ''

    if (!isWindowId(id)) return { text: 'window takes session, 15m, 1h, 24h or all' }
    ui.window = id
    ui.narrowed = null
    sync()

    return { text: `events: window ${id}` }
  }

  if (word === 'pin') {
    const event = eventsModel(state, Date.now()).rows[ui.focus]?.event

    if (event === undefined) return { text: 'nothing focused to pin' }
    eventsActions(state, { fillPrompt: async () => false } as unknown as Host, () => undefined, () => undefined, () => undefined).pin(event)

    return { text: ui.said ?? 'pinned' }
  }

  if (word === 'rule') {
    eventsActions(state, {} as Host, () => undefined, () => undefined, () => undefined).addRule()

    return { text: ui.said ?? '' }
  }

  // `level bad` and `kind swarm` as the help names them, besides the bare `bad` and `swarm`.
  if ((word === 'level' || word === 'kind') && rest.length === 1) {
    const value = (rest[0] ?? '').toLowerCase()

    if (word === 'level' && (value === 'all' || isLevel(value))) {
      ui.level = value
      sync()

      return { text: `events: level ${value}` }
    }

    if (word === 'kind' && ((EVENT_KINDS as readonly string[]).includes(value) || value === 'all')) {
      state.eventFilter = value as State['eventFilter']
      sync()

      return { text: `events: ${value}` }
    }

    return { text: word === 'level' ? 'level takes all, bad, warn, ok or info' : `kind takes all, ${EVENT_KINDS.join(', ')}` }
  }

  if ((EVENT_KINDS as readonly string[]).includes(word) || word === 'all') {
    state.eventFilter = word as State['eventFilter']
    sync()

    return { text: `events: ${word}` }
  }

  if (isLevel(word)) {
    ui.level = word
    sync()

    return { text: `events: level ${word}` }
  }

  const joined = args.join(' ')

  ui.query = maskLine(joined, QUERY_MAX)
  ui.parsed = parseQuery(ui.query)
  sync()

  return { text: ui.parsed.errors.length > 0 ? `events: query set, but ${ui.parsed.errors[0]}` : `events: query ${ui.parsed.source}` }
}

function summary(state: State): string {
  const ui = eventsUi(state)
  const model = eventsModel(state, Date.now())

  return `events: ${model.shown.length} of ${model.total} shown · kind ${state.eventFilter} · level ${ui.level} · window ${ui.narrowed === null ? ui.window : 'narrowed'}${ui.parsed.source === '' ? '' : ` · query ${ui.parsed.source}`}${ui.followRef === null ? '' : ` · following ${ui.followRef}`} · ${model.warnBad} warn/bad`
}

