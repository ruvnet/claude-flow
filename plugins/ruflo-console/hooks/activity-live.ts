/**
 * The Events and Timeline pages' live side (ADR-474): one record per console state that holds the retained event log, the lane store,
 * the saved searches, pins and alert rules, loads them from `.claude-flow/console/` once, and every 1.5 s takes in what is new:
 * events the diff recorded, events derived from the Workflows runs, the autopilot, Anatole, the band's notices, denies and mods,
 * lane samples and tool calls. New lines are queued and written in batches through hooks/activity-io.ts (the single write path), and
 * alert rules are evaluated over the NEW events only. Everything is fail-open: a disk problem is a note on the page, never a crash.
 * The option `eventsPersist` (default on) turns the writing off; the page and `/ruflo events forget` can still clear what exists.
 */
import { channelOf, flush, forgetChannel, pendingOf, queueLine, replaceFile, errorOf, type IoHost } from './activity-io'
import { storeOf } from './ap-live'
import { decodeEvents, decodeLanes, decodePrefs, emptyPrefs, encodeEvent, encodeLane, encodePrefs, EVENTS_CAP, EVENTS_FILE, LANES_CAP, LANES_FILE, MAX_LOG, PREFS_FILE, READ_MAX, type Prefs, type LaneRow } from './data/activity-store'
import { evaluateRules } from './data/event-rules'
import { anatoleEvents, apEvents, denyEvents, modEvents, newMemo, noticeEvents, runEvents, type Memo } from './data/event-sources'
import { agentLabels } from './data/parse'
import { readBounded } from './data/files'
import { addTools, completeTicks, loadRows, newLaneStore, observe, setInterval, trim, type LaneStore, type Sample } from './data/timeline-model'
import type { ConsoleEvent } from './data/events'
import { levelOf } from './data/event-severity'
import type { Host } from './host'
import { addNotice } from './notices'
import type { State } from './state'
import { eventOf, newSeen, pullToasts, type ToastSeen } from './toasts'
import type { Digest } from './toast-policy'

export const TICK_MS = 1_500
export const FLUSH_MS = 4_000
const PREFS_GAP_MS = 2_000

export type Loaded = { isLoaded: boolean; events: number; eventsBytes: number; lanesBytes: number; bad: number; newer: number; problem: string | null }

export type Activity = {
  /** The retained log, oldest first, at most MAX_LOG. The sequence number of log[i] is seqBase + i. */
  log: ConsoleEvent[]
  seqBase: number
  /** Bumps whenever the log changes: a memo key. */
  version: number
  lanes: LaneStore
  prefs: Prefs
  prefsProblem: string | null
  isPrefsForeign: boolean
  isPrefsDirty: boolean
  prefsWriteMs: number
  memo: Memo
  /** The last state.events item taken in. */
  cursor: ConsoleEvent | null
  loaded: Loaded
  session: string
  /** New events since the last rule pass. */
  fresh: ConsoleEvent[]
  lastFlushMs: number
  isLoading: boolean
  ruleHits: number
  /** What was taken in of the other plugins' toast digests (ADR-477), and the ones read but not yet turned into events. */
  toast: ToastSeen
  toastIn: Digest[]
}

const held = new WeakMap<State, Activity>()

export function activityOf(state: State): Activity {
  let found = held.get(state)

  if (found === undefined) {
    found = { log: [], seqBase: 0, version: 0, lanes: newLaneStore(), prefs: emptyPrefs(), prefsProblem: null, isPrefsForeign: false, isPrefsDirty: false, prefsWriteMs: 0, memo: newMemo(), cursor: null, loaded: { isLoaded: false, events: 0, eventsBytes: 0, lanesBytes: 0, bad: 0, newer: 0, problem: null }, session: Math.random().toString(36).slice(2, 8), fresh: [], lastFlushMs: 0, isLoading: false, ruleHits: 0, toast: newSeen(Date.now()), toastIn: [] }
    held.set(state, found)
  }

  return found
}

export const seqOf = (act: Activity): number => act.seqBase + act.log.length

export const pathsOf = (cwd: string): { events: string; lanes: string; prefs: string } => {
  const root = cwd.replace(/\/+$/, '')

  return { events: `${root}/${EVENTS_FILE}`, lanes: `${root}/${LANES_FILE}`, prefs: `${root}/${PREFS_FILE}` }
}

/** Adds events to the log (oldest first), keeping MAX_LOG. */
export function append(act: Activity, events: readonly ConsoleEvent[]): void {
  if (events.length === 0) return

  act.log.push(...events)

  if (act.log.length > MAX_LOG) {
    const drop = act.log.length - MAX_LOG

    act.log.splice(0, drop)
    act.seqBase += drop
  }

  act.version++
}

/** Reads the three files once: the tail of each log (cap shown by the page) and the prefs. Never throws. */
export async function loadActivity(state: State, host: IoHost): Promise<void> {
  const act = activityOf(state)

  if (act.loaded.isLoaded || act.isLoading) return

  act.isLoading = true

  try {
    const paths = pathsOf(state.cwd)
    const [events, lanes, prefs] = await Promise.all([readBounded(host.fs, state.cache, paths.events, READ_MAX, true), readBounded(host.fs, state.cache, paths.lanes, READ_MAX, true), readBounded(host.fs, state.cache, paths.prefs, 70_000, true)])
    const e = decodeEvents(events.text)
    const l = decodeLanes(lanes.text)
    const p = decodePrefs(prefs.text)
    const problem = events.text === null && events.reason === 'too-large' ? 'the events file is over the read cap, so only new events are kept until it rotates' : null
    const live = act.log.splice(0)

    act.log = [...e.items, ...live].sort((a, b) => a.atMs - b.atMs)
    if (act.log.length > MAX_LOG) act.log.splice(0, act.log.length - MAX_LOG)
    loadRows(act.lanes, l.items as LaneRow[])
    act.prefs = p.prefs
    act.prefsProblem = p.problem
    act.isPrefsForeign = p.isForeign
    act.loaded = { isLoaded: true, events: e.items.length, eventsBytes: e.bytes, lanesBytes: l.bytes, bad: e.bad + l.bad, newer: e.newer + l.newer, problem }
    act.version++
  } catch {
    act.loaded = { ...act.loaded, isLoaded: true, problem: 'the history could not be read' }
  } finally {
    act.isLoading = false
  }
}

const BUSY = /busy|active|working|running/i

function laneSamples(state: State): { ruflo: Sample[] } {
  const agents = state.snapshot?.agents ?? []
  const labels = agentLabels(agents)

  return { ruflo: agents.slice(0, 200).map(agent => ({ lane: `ruflo:${agent.id}`, group: 'ruflo' as const, label: labels.get(agent.id) ?? agent.type, busy: BUSY.test(agent.status) })) }
}

/** Feeds the lane store from the state: ruflo agent statuses, Claude Code tool calls, workflow agents, mission tasks, autopilot steps. Returns the rows to persist. */
export function feedLanes(state: State, act: Activity, nowMs: number): LaneRow[] {
  const rows: LaneRow[] = [...observe(act.lanes, 'ruflo', laneSamples(state).ruflo, nowMs)]

  for (const [who, calls] of state.toolsByAgent) rows.push(...addTools(act.lanes, who === 'main' ? 'claude:main' : `claude:${who}`, 'claude', who === 'main' ? 'claude (main)' : `subagent ${who.replace(/[^a-z0-9]/gi, '').slice(-6)}`, calls, nowMs))

  for (const run of state.wf.read?.runs ?? []) {
    if (run.kind !== 'workflow') continue

    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        if (agent.startedMs === undefined) continue

        const row = setInterval(act.lanes, `workflow:${run.id}/${agent.id}`, 'workflow', `${run.name === run.id ? run.id : run.name}/${agent.label}`, agent.startedMs, agent.state === 'running' ? null : agent.startedMs + Math.max(0, agent.elapsedMs ?? 0), true)

        if (row !== null) rows.push(row)
      }
    }
  }

  for (const task of state.snapshot?.tasks ?? []) {
    if (task.startedAtMs === undefined) continue

    const done = task.completedAtMs ?? (/complete|done|fail|cancel/i.test(task.status) ? task.startedAtMs : null)
    const row = setInterval(act.lanes, `mission:${task.id}`, 'mission', task.description.slice(0, 40) || task.id, task.startedAtMs, done, true)

    if (row !== null) rows.push(row)
  }

  for (const step of storeOf(state).loop.steps) {
    const row = setInterval(act.lanes, `autopilot:${step.id}`, 'autopilot', `step ${step.id}`, step.startedAt, step.status === 'started' ? null : (step.endedAt ?? step.startedAt), step.status !== 'failed')

    if (row !== null) rows.push(row)
  }

  rows.push(...completeTicks(act.lanes, nowMs))
  trim(act.lanes, nowMs)

  return rows
}

/** Takes in the events the diff of reads and the tool calls recorded since the last call: cheap enough to run on every draw, so a page never lags a tick behind. */
export function takeRing(state: State, act: Activity): void {
  const ring = state.events
  const at = act.cursor === null ? -1 : ring.lastIndexOf(act.cursor)
  const fresh = ring.slice(at + 1)

  if (fresh.length === 0) return

  act.cursor = ring[ring.length - 1] as ConsoleEvent
  append(act, fresh)
  act.fresh.push(...fresh)

  if (state.options.eventsPersist) {
    const path = pathsOf(state.cwd).events

    for (const event of fresh) queueLine(path, EVENTS_CAP, encodeEvent(event, act.session))
  }
}

/** What the sources the console already holds say happened since the last pass (oldest first); the first pass of each is a baseline. */
export function gather(state: State, act: Activity, nowMs: number): ConsoleEvent[] {
  const out: ConsoleEvent[] = [...runEvents(act.memo, state.wf.read?.runs ?? [], nowMs)]
  const loop = storeOf(state).loop
  const store = storeOf(state)

  out.push(...apEvents(act.memo, { phase: loop.phase, steps: loop.steps, killed: store.killed, parked: loop.parked, reason: loop.reason }, nowMs))
  out.push(...anatoleEvents(act.memo, state.snapshot?.anatole?.alerts ?? [], nowMs))
  out.push(...noticeEvents(act.memo, state.notices, state.noticeSeq))
  out.push(...denyEvents(act.memo, state.denied))
  out.push(...modEvents(act.memo, state.mods, nowMs))
  // Every toast, drawn or not (ADR-477): the console's own, and what the other plugins left under .claude-flow/console/toasts/.
  out.push(...state.toastLog.splice(0).map(eventOf), ...act.toastIn.splice(0).map(eventOf))

  return out.sort((a, b) => a.atMs - b.atMs)
}

/** One pass: takes in what is new, evaluates alert rules over it, queues lines, and writes what is due. Never throws. */
export async function tick(state: State, host: Host, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const act = activityOf(state)

    if (!act.loaded.isLoaded) {
      await loadActivity(state, host)

      return true
    }

    takeRing(state, act)
    act.toastIn.push(...(await pullToasts(host, state.cwd, act.toast)))

    const derived = gather(state, act, nowMs)
    const rows = feedLanes(state, act, nowMs)
    const paths = pathsOf(state.cwd)

    append(act, derived)

    const fresh = [...act.fresh.splice(0), ...derived]

    if (fresh.length > 0) {
      for (const rule of evaluateRules(act.prefs.rules, fresh, nowMs)) {
        act.ruleHits++
        addNotice(state, { level: rule.level, text: `events rule "${rule.rule}": ${rule.count} new · ${rule.newest.text.slice(0, 60)}`, key: `events-rule:${rule.rule}`, go: 'events' }, nowMs)
      }
    }

    if (state.options.eventsPersist) {
      for (const event of derived) queueLine(paths.events, EVENTS_CAP, encodeEvent(event, act.session))
      for (const row of rows) queueLine(paths.lanes, LANES_CAP, encodeLane(row))

      if (nowMs - act.lastFlushMs >= FLUSH_MS) {
        act.lastFlushMs = nowMs
        await Promise.all([flush(host, state.cwd, paths.events, nowMs), flush(host, state.cwd, paths.lanes, nowMs)])
      }
    }

    // The option turns off every write: the saved searches, pins and rules (pinned text is event text) stay in memory only.
    if (state.options.eventsPersist && act.isPrefsDirty && !act.isPrefsForeign && nowMs - act.prefsWriteMs >= PREFS_GAP_MS) {
      act.isPrefsDirty = false
      act.prefsWriteMs = nowMs
      act.prefsProblem = await replaceFile(host, state.cwd, paths.prefs, encodePrefs(act.prefs))
    }

    return fresh.length > 0 || rows.length > 0
  } catch {
    return false
  }
}

/** Starts the 1.5 s pass (once per state). The page redraws only when something changed and it is the one in front. */
export function wireActivity(state: State, host: Host): void {
  if (state.timers.has('activity')) return

  state.timers.set(
    'activity',
    host.every(TICK_MS, () => {
      void tick(state, host).then(changed => {
        if (changed && (state.view === 'events' || state.view === 'timeline')) host.invalidate()
      })
    }),
  )
  void loadActivity(state, host)
}

export const markPrefsDirty = (state: State): void => {
  activityOf(state).isPrefsDirty = true
}

/** What the page says about the files: the cap, the bytes read, a problem. */
export function storeNote(state: State): string {
  const act = activityOf(state)
  const paths = pathsOf(state.cwd)
  const ch = channelOf(paths.events, EVENTS_CAP)
  const parts = [state.options.eventsPersist ? `kept in ${EVENTS_FILE} (cap ${EVENTS_CAP / 1_048_576} MiB, newest half kept past it)` : 'not kept: the eventsPersist option is off', act.loaded.isLoaded ? `read ${act.loaded.events} events from ${Math.round(act.loaded.eventsBytes / 1000)} kB` : 'reading history…']

  if (act.loaded.bad > 0) parts.push(`${act.loaded.bad} bad lines skipped`)
  if (act.loaded.newer > 0) parts.push(`${act.loaded.newer} lines from a newer console skipped`)
  if (act.loaded.problem !== null) parts.push(act.loaded.problem)
  if (pendingOf(paths.events) > 0) parts.push(`${pendingOf(paths.events)} waiting to write`)
  if (errorOf(paths.events) !== null || ch.error !== null) parts.push(`write failed: ${errorOf(paths.events)}`)

  return parts.join(' · ')
}

export const clearMemory = (state: State): void => {
  const act = activityOf(state)
  const paths = pathsOf(state.cwd)

  act.log = []
  act.seqBase = 0
  act.lanes = newLaneStore()
  act.version++
  forgetChannel(paths.events)
  forgetChannel(paths.lanes)
}

export { levelOf }
