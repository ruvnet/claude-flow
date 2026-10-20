/**
 * The Events page's own state, its filter pipeline and its actions (ADR-474). The pipeline is memoised by (log version, pause point,
 * filters, query, window, follow, mutes, clock second): a ten-thousand-event log is filtered once per change, not once per frame, and
 * only the visible page is turned into rows. State here is per console and never written, except the saved searches, pins and rules
 * (data/activity-store.ts Prefs) which go through hooks/activity-live.ts.
 */
import { isoOf } from './data/safe'
import { activityOf, clearMemory, markPrefsDirty, pathsOf, seqOf, takeRing } from './activity-live'
import { MAX_PINS, MAX_RULES, MAX_SEARCHES, type Pin } from './data/activity-store'
import { exportSpecFor, eventsText, formatOf } from './data/event-export'
import { collapse, follow, idOf, templateOf, type Row } from './data/event-group'
import { maskLine } from './data/event-mask'
import { budgetOf, EMPTY_QUERY, matches, parseQuery, QUERY_MAX, REGEX_BUDGET_MS, type Query } from './data/event-query'
import { isLevel, levelOfEvent, LEVELS, rankOf, type Level } from './data/event-severity'
import { bars as barsOf, isWindowId, levelKey, windowStart, type Bars, type WindowId } from './data/event-stats'
import { EVENT_KINDS, type ConsoleEvent } from './data/events'
import type { ActionSpec } from './actions'
import type { Host } from './host'
import type { State, ViewId } from './state'

export const PAGE = 12
export const EVENTS_HELP = 'events [kind|level|since:15m|"query"|window <session|15m|1h|24h|all>|clear|forget|export <path>|follow <ref>|pin|rule]'

export type Narrow = { fromMs: number; toMs: number }

export type EventsUi = {
  query: string
  parsed: Query
  window: WindowId
  narrowed: Narrow | null
  level: Level | 'all'
  followRef: string | null
  mutedKinds: Set<string>
  mutedTemplates: Set<string>
  /** The sequence number of the log when the tail was paused, or null while it runs. */
  pausedSeq: number | null
  focus: number
  expanded: Set<string>
  isGrouped: boolean
  chartBy: 'kind' | 'level'
  seenSeq: number
  said: string | null
  page: number
  open: string | null
  memoKey: string
  memo: Model | null
}

export type Model = {
  shown: ConsoleEvent[]
  rows: Row[]
  kindCounts: Map<string, number>
  levelCounts: Map<Level, number>
  warnBad: number
  unread: number
  total: number
  unreadBad: number
  /** Events a regex term was not run on because its time budget was spent (the newest are searched first). */
  skipped: number
}

const uis = new WeakMap<State, EventsUi>()

export function eventsUi(state: State): EventsUi {
  let found = uis.get(state)

  if (found === undefined) {
    found = { query: '', parsed: EMPTY_QUERY, window: 'all', narrowed: null, level: 'all', followRef: null, mutedKinds: new Set(), mutedTemplates: new Set(), pausedSeq: null, focus: 0, expanded: new Set(), isGrouped: true, chartBy: 'kind', seenSeq: 0, said: null, page: 0, open: null, memoKey: '', memo: null }
    uis.set(state, found)
  }

  return found
}

/** The window the page shows, as times (null: unbounded). A narrowed span, set by pressing a bar, wins over the window id. */
export function rangeOf(state: State, ui: EventsUi, nowMs: number): { fromMs: number | null; toMs: number | null } {
  if (ui.narrowed !== null) return { fromMs: ui.narrowed.fromMs, toMs: ui.narrowed.toMs }

  return { fromMs: windowStart(ui.window, nowMs, state.loadedAtMs), toMs: null }
}

/** The events the page shows now, their counts, and the rows of the page (collapsed bursts, newest first). Memoised. */
export function eventsModel(state: State, nowMs: number): Model {
  const act = activityOf(state)
  const ui = eventsUi(state)

  takeRing(state, act)

  const key = [act.version, ui.pausedSeq, state.eventFilter, ui.level, ui.query, ui.window, ui.narrowed?.fromMs, ui.narrowed?.toMs, ui.followRef, [...ui.mutedKinds].join(), [...ui.mutedTemplates].join(), ui.isGrouped, Math.floor(nowMs / 5000)].join('|')

  if (ui.memo !== null && ui.memoKey === key) return ui.memo

  const upTo = ui.pausedSeq === null ? act.log.length : Math.max(0, Math.min(act.log.length, ui.pausedSeq - act.seqBase))
  const range = rangeOf(state, ui, nowMs)
  let pool: ConsoleEvent[] = []

  for (let i = 0; i < upTo; i++) {
    const event = act.log[i] as ConsoleEvent

    if ((range.fromMs !== null && event.atMs < range.fromMs) || (range.toMs !== null && event.atMs >= range.toMs)) continue
    if (ui.mutedKinds.has(event.kind) || (ui.mutedTemplates.size > 0 && ui.mutedTemplates.has(templateOf(event.text)))) continue
    pool.push(event)
  }

  if (ui.followRef !== null) pool = follow(pool, ui.followRef).events

  const kindCounts = new Map<string, number>()
  const levelCounts = new Map<Level, number>()
  const shown: ConsoleEvent[] = []

  const budget = budgetOf(REGEX_BUDGET_MS)

  // Newest first, so that when a slow pattern spends its budget it is the oldest events that are not searched.
  for (let i = pool.length - 1; i >= 0; i--) {
    const event = pool[i] as ConsoleEvent

    if (!matches(event, ui.parsed, nowMs, budget)) continue

    const level = levelOfEvent(event)

    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1)
    if (state.eventFilter !== 'all' && event.kind !== state.eventFilter) continue
    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1)
    if (ui.level !== 'all' && level !== ui.level) continue
    shown.push(event)
  }

  shown.reverse()

  const rows = (ui.isGrouped ? collapse(shown) : shown.map(event => ({ event, members: [event], id: idOf(event) }))).reverse()
  const taken = new Map<string, number>()

  // Two events can share a millisecond, a kind and a text (a diff makes several at once): a row id must still be its own.
  for (const entry of rows) {
    const seen = taken.get(entry.id) ?? 0

    taken.set(entry.id, seen + 1)
    if (seen > 0) entry.id = `${entry.id}~${seen}`
  }

  const unread = ui.pausedSeq === null ? 0 : seqOf(act) - ui.pausedSeq
  const sinceSeen = Math.max(0, Math.min(act.log.length, seqOf(act) - ui.seenSeq))
  let unreadBad = 0

  for (let i = act.log.length - sinceSeen; i < act.log.length; i++) if (rankOf(levelOfEvent(act.log[i] as ConsoleEvent)) >= 2) unreadBad++

  const model: Model = { shown, rows, kindCounts, levelCounts, warnBad: (levelCounts.get('bad') ?? 0) + (levelCounts.get('warn') ?? 0), unread, total: upTo, unreadBad, skipped: budget.skipped }

  ui.memo = model
  ui.memoKey = key

  return model
}

/** Where an event's ref lives: the current state of that thing, in words, and the page that shows it. */
export function entityOf(state: State, ref: string | undefined): { text: string; go: ViewId } | null {
  if (ref === undefined) return null

  const [kind, ...rest] = ref.split(':')
  const id = rest.join(':')
  const snap = state.snapshot

  switch (kind) {
    case 'agent': {
      const agent = snap?.agents.find(item => item.id === id)

      return { text: agent === undefined ? 'agent: not in the store now' : `agent ${agent.name ?? agent.type}: ${agent.status}`, go: 'swarm' }
    }
    case 'claim': {
      const claim = snap?.claims.find(item => item.issueId === id)

      return { text: claim === undefined ? 'claim: released or not on the board now' : `claim ${id}: ${claim.status}${claim.progress === undefined ? '' : ` (${claim.progress}%)`}`, go: 'claims' }
    }
    case 'task': {
      const task = snap?.tasks.find(item => item.id === id)

      return { text: task === undefined ? 'task: not in the store now' : `task ${id}: ${task.status}`, go: 'claims' }
    }
    case 'run': {
      const run = state.wf.read?.runs.find(item => item.id === id)

      return { text: run === undefined ? 'run: not in the last read' : `run ${run.name}: ${run.state}, ${run.done} of ${run.total} agents done`, go: 'workflows' }
    }
    case 'mission': {
      const mission = snap?.missions?.missions.find(item => item.id === id)

      return { text: mission === undefined ? 'mission: not in the last read' : `mission ${id}: ${mission.state}`, go: 'missions' }
    }
    case 'step':
      return { text: 'autopilot step: see the Automation page', go: 'automate' }
    case 'rule':
      return { text: `Anatole rule ${id}`, go: 'secure' }
    default:
      return null
  }
}

/** The one cross-link both pages use: the Events page pre-filtered to follow `ref`, over `win` (a span the Timeline shows) when given. */
export function openEventsFor(state: State, ref: string, win: Narrow | null = null): void {
  const ui = eventsUi(state)

  ui.followRef = maskLine(ref, 80)
  ui.narrowed = win
  ui.page = 0
  ui.focus = 0
  ui.open = null
  state.eventFilter = 'all'
  ui.level = 'all'
}

const nextOf = <T>(order: readonly T[], at: T): T => order[(order.indexOf(at) + 1) % order.length] as T

export type EventsActions = {
  query: (text: string) => void
  clearFilters: () => void
  window: (id: WindowId) => void
  narrow: (fromMs: number, toMs: number) => void
  level: (level: Level | 'all') => void
  cycleLevel: () => void
  follow: (ref: string | null) => void
  muteKind: (kind: string) => void
  muteTemplate: (text: string) => void
  unmute: () => void
  pause: () => void
  move: (by: number) => void
  focusId: (id: string) => void
  open: (id: string) => void
  toggleBurst: (id: string) => void
  toggleGroup: () => void
  chartBy: () => void
  pin: (event: ConsoleEvent) => void
  unpin: (atMs: number, text: string) => void
  saveSearch: () => void
  runSearch: (name: string) => void
  deleteSearch: (name: string) => void
  addRule: () => void
  removeRule: (name: string) => void
  copy: (event: ConsoleEvent | null) => void
  exportTo: (format: 'md' | 'jsonl', target: string) => Promise<void>
  forget: () => void
  ask: (event: ConsoleEvent) => void
  page: (by: number) => void
}

const say = (ui: EventsUi, text: string): void => {
  ui.said = text
}

export function eventsActions(state: State, host: Host, invalidate: () => void, askSpec: (spec: ActionSpec | null, why?: string) => void, askClaude: (question: string) => void): EventsActions {
  const ui = eventsUi(state)
  const act = activityOf(state)
  const touch = (): void => {
    ui.page = 0
    ui.focus = 0
    invalidate()
  }
  const current = (): ConsoleEvent | null => {
    const rows = eventsModel(state, Date.now()).rows

    return (rows[ui.focus]?.event ?? null) as ConsoleEvent | null
  }
  /** A line under the toolbar, and a redraw: every press says what it did, even when nothing else changed. */
  const note = (text: string): void => {
    say(ui, text)
    invalidate()
  }
  const nameOf = (): string => maskLine(ui.parsed.source, 24).replace(/\s+/g, ' ') || 'all'

  return {
    query: text => {
      ui.query = maskLine(text, QUERY_MAX)
      ui.parsed = parseQuery(ui.query)
      say(ui, ui.parsed.errors[0] ?? '')
      touch()
    },
    clearFilters: () => {
      ui.query = ''
      ui.parsed = EMPTY_QUERY
      ui.level = 'all'
      ui.followRef = null
      ui.narrowed = null
      state.eventFilter = 'all'
      say(ui, 'filters cleared')
      touch()
    },
    window: id => {
      if (isWindowId(id)) ui.window = id
      ui.narrowed = null
      touch()
    },
    narrow: (fromMs, toMs) => {
      ui.narrowed = { fromMs, toMs }
      touch()
    },
    level: level => {
      ui.level = level === 'all' || isLevel(level) ? level : 'all'
      say(ui, ui.level === 'all' ? 'every level shown' : `only ${ui.level} events shown`)
      touch()
    },
    cycleLevel: () => {
      ui.level = nextOf(['all', ...LEVELS] as const, ui.level)
      touch()
    },
    follow: ref => {
      ui.followRef = ref === null ? null : maskLine(ref, 80)
      touch()
    },
    muteKind: kind => {
      ui.mutedKinds.add(kind)
      say(ui, `muted kind ${kind} for this session`)
      touch()
    },
    muteTemplate: text => {
      ui.mutedTemplates.add(templateOf(text))
      say(ui, 'muted lines like that for this session')
      touch()
    },
    unmute: () => {
      ui.mutedKinds.clear()
      ui.mutedTemplates.clear()
      say(ui, 'unmuted')
      touch()
    },
    pause: () => {
      ui.pausedSeq = ui.pausedSeq === null ? seqOf(act) : null
      ui.page = 0
      invalidate()
    },
    move: by => {
      const model = eventsModel(state, Date.now())

      if (model.rows.length === 0) return note(by < 0 ? 'no events above' : 'no events below')

      const next = Math.max(0, Math.min(Math.max(0, model.rows.length - 1), ui.focus + by))

      if (next === ui.focus) return note(by < 0 ? 'already on the newest event' : 'already on the oldest event')

      ui.focus = next
      ui.page = Math.floor(ui.focus / PAGE)
      invalidate()
    },
    focusId: id => {
      const at = eventsModel(state, Date.now()).rows.findIndex(row => row.id === id)

      if (at >= 0) ui.focus = at
      invalidate()
    },
    open: id => {
      ui.open = ui.open === id ? null : id
      invalidate()
    },
    toggleBurst: id => {
      if (ui.expanded.has(id)) ui.expanded.delete(id)
      else ui.expanded.add(id)
      invalidate()
    },
    toggleGroup: () => {
      ui.isGrouped = !ui.isGrouped
      touch()
    },
    chartBy: () => {
      ui.chartBy = ui.chartBy === 'kind' ? 'level' : 'kind'
      invalidate()
    },
    pin: event => {
      if (act.isPrefsForeign) return note('the saved file is from a newer console: not changed')
      if (act.prefs.pins.some(pin => pin.atMs === event.atMs && pin.text === event.text)) return note('already pinned')
      if (act.prefs.pins.length >= MAX_PINS) return note(`${MAX_PINS} pins is the limit: unpin one first`)
      act.prefs.pins.push({ atMs: event.atMs, kind: event.kind, text: maskLine(event.text, 240), level: levelOfEvent(event) } satisfies Pin)
      markPrefsDirty(state)
      say(ui, 'pinned')
      invalidate()
    },
    unpin: (atMs, text) => {
      act.prefs.pins = act.prefs.pins.filter(pin => !(pin.atMs === atMs && pin.text === text))
      markPrefsDirty(state)
      invalidate()
    },
    saveSearch: () => {
      if (ui.parsed.source === '') return note('type a query first')
      if (act.isPrefsForeign) return note('the saved file is from a newer console: not changed')

      const name = nameOf()

      act.prefs.searches = [...act.prefs.searches.filter(item => item.name !== name), { name, q: ui.parsed.source }].slice(-MAX_SEARCHES)
      markPrefsDirty(state)
      say(ui, `saved search "${name}" (${act.prefs.searches.length} of ${MAX_SEARCHES})`)
      invalidate()
    },
    runSearch: name => {
      const found = act.prefs.searches.find(item => item.name === name)

      if (found === undefined) return
      ui.query = found.q
      ui.parsed = parseQuery(found.q)
      say(ui, ui.parsed.errors[0] ?? '')
      touch()
    },
    deleteSearch: name => {
      act.prefs.searches = act.prefs.searches.filter(item => item.name !== name)
      markPrefsDirty(state)
      invalidate()
    },
    addRule: () => {
      if (ui.parsed.terms.length === 0 || ui.parsed.errors.length > 0) return note('a rule needs a valid query with at least one term')
      if (act.isPrefsForeign) return note('the saved file is from a newer console: not changed')
      if (act.prefs.rules.length >= MAX_RULES && !act.prefs.rules.some(rule => rule.name === nameOf())) return note(`${MAX_RULES} rules is the limit: remove one first`)

      const name = nameOf()

      act.prefs.rules = [...act.prefs.rules.filter(rule => rule.name !== name), { name, q: ui.parsed.source }]
      markPrefsDirty(state)
      say(ui, `alert rule "${name}": a band notice when a NEW event matches (history is never scanned)`)
      invalidate()
    },
    removeRule: name => {
      act.prefs.rules = act.prefs.rules.filter(rule => rule.name !== name)
      markPrefsDirty(state)
      invalidate()
    },
    copy: event => {
      const target = event ?? current()

      if (target === null) return note('nothing focused to copy')

      const text = `${isoOf(target.atMs)} ${levelOfEvent(target)} ${target.kind} ${maskLine(target.text, 240)}`

      void host.fillPrompt(text).then(
        ok => {
          say(ui, ok ? 'put the masked line in the prompt box' : 'no prompt box here: the line is not copied')
          invalidate()
        },
        () => say(ui, 'the prompt box refused it'),
      )
    },
    exportTo: async (format, target) => {
      const model = eventsModel(state, Date.now())
      const title = ui.parsed.source === '' ? `${model.shown.length} shown` : ui.parsed.source
      const checked = formatOf(target) === null ? `${target}.${format}` : target
      const made = await exportSpecFor(host.fs, state.cwd, checked, eventsText(model.shown, formatOf(checked) === 'jsonl' ? 'jsonl' : 'md', title, Date.now()), `${model.shown.length} events`, ['md', 'jsonl'])

      if (!made.ok) {
        say(ui, made.why)
        invalidate()

        return
      }

      askSpec(made.spec, 'that export cannot run here')
    },
    forget: () => {
      const paths = pathsOf(state.cwd)

      askSpec(
        {
          label: 'forget the Events and Timeline history',
          args: [],
          argv: ['rm', '-f', '--', paths.events, paths.lanes],
          expect: 'events.jsonl and lanes.jsonl removed',
          declared: 'delete',
          shows: `rm -f -- ${paths.events} ${paths.lanes}`,
          note: 'deletes only the console\'s own history files for this project; saved searches, pins and rules stay',
          timeoutMs: 10_000,
          onOutput: () => {
            clearMemory(state)
            say(ui, 'history forgotten')
          },
          verifyLocal: async h => (await h.fs.stat(paths.events).catch(() => undefined)) === undefined,
        },
        'that cannot run here',
      )
    },
    ask: event => askClaude(`This event appeared in my ruflo console: "${maskLine(event.text, 200)}" (kind ${event.kind}, level ${levelOfEvent(event)}). What does it mean, and should I do anything?`),
    page: by => {
      const model = eventsModel(state, Date.now())
      const last = Math.max(0, Math.ceil(model.rows.length / PAGE) - 1)

      ui.page = Math.max(0, Math.min(last, ui.page + by))
      ui.focus = ui.page * PAGE
      invalidate()
    },
  }
}

/** The colours of the chart's keys: kinds and levels each have one. */
export const KIND_RGB = [0x2fa4c9, 0xe0a526, 0x2bb673, 0x8b7cf6, 0x6ec1e4, 0xe5534b, 0xb48ead, 0x56b6c2, 0xd19a66, 0xe5c07b, 0x98c379, 0x6b7280]
export const LEVEL_RGB_LIST = [0xe5534b, 0xe0a526, 0x2bb673, 0x2fa4c9]

/** The activity chart's bars for the page: by kind or level, over the window shown (a window with no start spans the shown events, at least 15 min). */
export function chartOf(state: State, model: Model, nowMs: number, columns: number): { data: Bars; colors: number[] } {
  const ui = eventsUi(state)
  const range = rangeOf(state, ui, nowMs)
  const span = range.fromMs === null ? Math.max(15 * 60_000, nowMs - (model.shown[0]?.atMs ?? nowMs)) : (range.toMs ?? nowMs) - range.fromMs
  const keys: string[] = ui.chartBy === 'kind' ? [...EVENT_KINDS] : [...LEVELS]

  return { data: barsOf(model.shown, keys, ui.chartBy === 'kind' ? event => event.kind : levelKey, Math.max(60_000, span), range.toMs ?? nowMs, Math.max(12, Math.min(48, columns - 12))), colors: ui.chartBy === 'kind' ? KIND_RGB : LEVEL_RGB_LIST }
}
