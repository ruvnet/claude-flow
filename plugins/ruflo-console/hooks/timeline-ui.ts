/**
 * The Timeline page's own state, model and actions (ADR-474): the window and how far back it is panned, lane groups that fold, a sort,
 * a cursor over the visible lanes, one lane opened for detail, and the cross-links to the Events page. The model is memoised by the
 * lane store's version, the window, the sort and the clock second, and the page draws only the lanes of one page.
 */
import { activityOf, pathsOf } from './activity-live'
import { eventsUi, openEventsFor } from './events-ui'
import { LANE_GROUPS, type LaneGroup } from './data/activity-store'
import { exportSpecFor, lanesText, type LaneExport } from './data/event-export'
import { maskLine } from './data/event-mask'
import { rankOf } from './data/event-severity'
import { levelOfEvent } from './data/event-severity'
import type { ConsoleEvent } from './data/events'
import { busiestMinute, clockOf, concurrency, idleGaps, isTlWindow, lanesIn, lastProblem, sortLanes, SORTS, windowOf, zoomed, type Concurrency, type IdleGap, type LaneView, type SortId, type TlWindowId } from './data/timeline-model'
import { formatOf } from './data/event-export'
import type { ActionSpec } from './actions'
import type { Host } from './host'
import type { State, ViewId } from './state'

export const LANES_PAGE = 12
export const BARS_MIN = 24

export type Entry = { type: 'group'; group: LaneGroup; count: number; busy: number; isOpen: boolean } | { type: 'lane'; lane: LaneView }

export type TimelineUi = {
  window: TlWindowId
  /** How far the window is panned back from now (0 is the live edge). */
  offsetMs: number
  sort: SortId
  collapsed: Set<LaneGroup>
  page: number
  cursor: number
  open: string | null
  said: string | null
  /** The time of the problem the last jump went to (null after any other move): the next jump looks before it. */
  problemAt: number | null
  memoKey: string
  memo: TlModel | null
}

export type TlModel = {
  win: { fromMs: number; toMs: number; spanMs: number }
  lanes: LaneView[]
  entries: Entry[]
  concurrency: Concurrency
  gaps: IdleGap[]
  busiest: { atMs: number; n: number } | null
  problems: ConsoleEvent[]
  total: number
}

const uis = new WeakMap<State, TimelineUi>()

export function timelineUi(state: State): TimelineUi {
  let found = uis.get(state)

  if (found === undefined) {
    found = { window: '15m', offsetMs: 0, sort: 'busy', collapsed: new Set(), page: 0, cursor: 0, open: null, said: null, problemAt: null, memoKey: '', memo: null }
    uis.set(state, found)
  }

  return found
}

export function timelineModel(state: State, nowMs: number, bars = 60): TlModel {
  const act = activityOf(state)
  const ui = timelineUi(state)
  const key = [act.lanes.version, act.version, ui.window, ui.offsetMs, ui.sort, [...ui.collapsed].join(), Math.floor(nowMs / 2000), bars].join('|')

  if (ui.memo !== null && ui.memoKey === key) return ui.memo

  const win = windowOf(ui.window, ui.offsetMs, nowMs, state.loadedAtMs)
  const lanes = lanesIn(act.lanes, win, nowMs)
  const entries: Entry[] = []

  for (const group of LANE_GROUPS) {
    const inGroup = sortLanes(lanes.filter(lane => lane.group === group), ui.sort)

    if (inGroup.length === 0) continue

    const isOpen = !ui.collapsed.has(group)

    entries.push({ type: 'group', group, count: inGroup.length, busy: inGroup.filter(lane => (lane.busyPct ?? 0) > 0 || lane.calls > 0).length, isOpen })
    if (isOpen) for (const lane of inGroup) entries.push({ type: 'lane', lane })
  }

  const problems = act.log.filter(event => event.atMs >= win.fromMs && event.atMs < win.toMs && rankOf(levelOfEvent(event)) >= 2)
  const model: TlModel = { win, lanes, entries, concurrency: concurrency(lanes, win, act.lanes, Math.max(BARS_MIN, bars)), gaps: idleGaps(lanes.filter(lane => lane.group === 'ruflo' || lane.group === 'workflow'), win, act.lanes), busiest: busiestMinute(act.lanes, win), problems, total: lanes.length }

  ui.memo = model
  ui.memoKey = key

  return model
}

/** The page that shows a lane's thing, and the ref the Events page follows for it. */
export function laneRef(lane: LaneView): { ref: string; go: ViewId } {
  const id = lane.lane.slice(lane.lane.indexOf(':') + 1)

  switch (lane.group) {
    case 'ruflo':
      return { ref: `agent:${id}`, go: 'swarm' }
    case 'workflow':
      return { ref: `run:${id.split('/')[0]}`, go: 'workflows' }
    case 'mission':
      return { ref: `task:${id}`, go: 'missions' }
    case 'autopilot':
      return { ref: `step:${id}`, go: 'automate' }
    default:
      return { ref: lane.lane, go: 'events' }
  }
}

export type TimelineActions = {
  window: (id: TlWindowId) => void
  zoom: (by: 1 | -1) => void
  pan: (by: number) => void
  now: () => void
  start: () => void
  problem: () => void
  move: (by: number) => void
  open: (lane: string | null) => void
  toggleGroup: (group: LaneGroup) => void
  sort: () => void
  page: (by: number) => void
  events: (lane: LaneView) => void
  go: (lane: LaneView) => void
  ask: (lane: LaneView) => void
  exportTo: (format: 'md' | 'csv', target: string) => Promise<void>
}

export function timelineActions(state: State, host: Host, invalidate: () => void, view: (id: ViewId) => void, askSpec: (spec: ActionSpec | null, why?: string) => void, askClaude: (question: string) => void): TimelineActions {
  const ui = timelineUi(state)
  const act = activityOf(state)
  const model = (): TlModel => timelineModel(state, Date.now())
  const lanesOnly = (): LaneView[] => model().entries.flatMap(entry => (entry.type === 'lane' ? [entry.lane] : []))
  const keep = (): void => {
    ui.problemAt = null
    ui.offsetMs = Math.max(0, ui.offsetMs)
    invalidate()
  }

  return {
    window: id => {
      if (isTlWindow(id)) ui.window = id
      ui.page = 0
      keep()
    },
    zoom: by => {
      ui.window = zoomed(ui.window, by)
      keep()
    },
    pan: by => {
      const span = model().win.spanMs

      ui.offsetMs = Math.max(0, ui.offsetMs - by * span * 0.5)
      keep()
    },
    now: () => {
      ui.said = ui.offsetMs === 0 ? 'already at the live edge' : 'back at the live edge'
      ui.offsetMs = 0
      keep()
    },
    start: () => {
      const first = Math.min(...act.lanes.spans.map(span => span.fromMs), Number.POSITIVE_INFINITY)

      if (Number.isFinite(first)) {
        ui.offsetMs = Math.max(0, Date.now() - first - model().win.spanMs)
        ui.said = `jumped to the start of what was observed (${clockOf(first, true)})`
      } else ui.said = 'nothing has been observed yet'

      keep()
    },
    problem: () => {
      const m = model()
      // Pressed again after a jump it goes one problem further back: the window is centred on the last one found, so look before that centre.
      const found = lastProblem(act.log, ui.problemAt !== null && ui.offsetMs > 0 ? ui.problemAt : m.win.toMs)

      if (found === null) {
        ui.said = 'no warn or bad event before this window'
        return invalidate()
      }

      ui.offsetMs = Math.max(0, Date.now() - found.atMs - m.win.spanMs / 2)
      ui.said = `jumped to ${found.kind}: ${maskLine(found.text, 60)}`
      keep()
      ui.problemAt = found.atMs
    },
    move: by => {
      const lanes = lanesOnly()
      const next = Math.max(0, Math.min(Math.max(0, lanes.length - 1), ui.cursor + by))

      // At either end the press still answers: a button that does nothing and says nothing looks broken.
      ui.said = lanes.length === 0 ? 'no lanes in this window' : next === ui.cursor && ui.cursor === (by < 0 ? 0 : lanes.length - 1) && lanes.length > 0 ? (by < 0 ? 'already on the first lane' : 'already on the last lane') : ui.said
      ui.cursor = next
      ui.page = Math.floor(model().entries.findIndex(entry => entry.type === 'lane' && entry.lane === lanes[ui.cursor]) / LANES_PAGE)
      ui.page = Math.max(0, ui.page)
      invalidate()
    },
    open: lane => {
      ui.open = ui.open === lane ? null : lane
      invalidate()
    },
    toggleGroup: group => {
      if (ui.collapsed.has(group)) ui.collapsed.delete(group)
      else ui.collapsed.add(group)
      ui.page = 0
      invalidate()
    },
    sort: () => {
      ui.sort = SORTS[(SORTS.indexOf(ui.sort) + 1) % SORTS.length] as SortId
      invalidate()
    },
    page: by => {
      const last = Math.max(0, Math.ceil(model().entries.length / LANES_PAGE) - 1)

      ui.page = Math.max(0, Math.min(last, ui.page + by))
      invalidate()
    },
    events: lane => {
      const m = model()

      openEventsFor(state, laneRef(lane).ref, { fromMs: m.win.fromMs, toMs: m.win.toMs })
      eventsUi(state).said = `following ${laneRef(lane).ref} over the Timeline's window`
      view('events')
    },
    go: lane => view(laneRef(lane).go),
    ask: lane => askClaude(`In my ruflo console the lane "${maskLine(lane.label, 40)}" (${lane.group}) was busy ${lane.busyPct ?? 'n/a'}% of the observed time with ${lane.calls} tool calls in this window. Is that healthy, and what should I look at?`),
    exportTo: async (format, target) => {
      const m = model()
      const data: LaneExport = { lanes: m.lanes, concurrency: m.concurrency, fromMs: m.win.fromMs, toMs: m.win.toMs, busiest: m.busiest }
      const checked = formatOf(target) === null ? `${target}.${format}` : target
      const made = await exportSpecFor(host.fs, state.cwd, checked, lanesText(data, formatOf(checked) === 'csv' ? 'csv' : 'md', Date.now()), `${m.lanes.length} lane summaries`, ['md', 'csv'])

      if (!made.ok) {
        ui.said = made.why
        return invalidate()
      }

      askSpec(made.spec, 'that export cannot run here')
    },
  }
}

/** `/ruflo timeline <args>`: window, zoom, follow. `export` is for the caller. */
export function applyTimelineArgs(state: State, args: readonly string[]): { text: string; export?: { format: 'md' | 'csv'; path: string }; follow?: string } {
  const ui = timelineUi(state)
  const [first = '', ...rest] = args
  const word = first.toLowerCase()

  if (isTlWindow(word)) {
    ui.window = word
    ui.offsetMs = 0
    ui.page = 0

    return { text: `timeline: ${word}` }
  }

  if (word === 'zoom') {
    const dir = rest[0]

    if (dir !== 'in' && dir !== 'out') return { text: 'zoom takes in or out' }
    ui.window = zoomed(ui.window, dir === 'in' ? -1 : 1)

    return { text: `timeline: ${ui.window}` }
  }

  if (word === 'follow') {
    const ref = rest.join(' ').trim()

    if (ref === '') return { text: 'follow takes a ref such as agent:<id> or run:<id>' }
    const m = timelineModel(state, Date.now())

    openEventsFor(state, ref, { fromMs: m.win.fromMs, toMs: m.win.toMs })

    return { text: `timeline: following ${maskLine(ref, 80)} on the Events page`, follow: ref }
  }

  if (word === 'export') {
    const path = rest.join(' ').trim()

    return { text: 'checking the path', export: { format: formatOf(path) === 'csv' ? 'csv' : 'md', path } }
  }

  if (word === '') {
    const m = timelineModel(state, Date.now())

    return { text: `timeline: window ${ui.window}${ui.offsetMs > 0 ? ` panned ${Math.round(ui.offsetMs / 60000)} min back` : ''} · ${m.total} lanes · concurrency peak ${m.concurrency.peak}, mean ${m.concurrency.mean}` }
  }

  return { text: 'timeline [5m|15m|1h|6h|24h|session|zoom <in|out>|follow <ref>|export <path>]' }
}

export { pathsOf }
