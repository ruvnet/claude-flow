/**
 * Replay of a finished workflow run (ADR-461). Pure: it takes the `WfRun` the page already holds and re-derives the board at
 * every step, so a scrub can move back and forth and always lands on the same board.
 *
 * What a step is. The only moments a run records are the ones its agents carry: when each started (`startedMs`) and, for an
 * agent that finished or failed, how long it took (`elapsedMs`). Those two make the events, `start` and `end`, in time order
 * (an end before a start at the same instant, so a hand-off between phases never shows both running). The journal itself has
 * no timestamps, so nothing finer than that exists and none is invented:
 *   - an agent without a start time, or one that ended but has no span, is not placed on the timeline (`untimed`) and is left
 *     off the replayed board, with the count said by the view;
 *   - tokens are known only at the end (a run record stores the final figure; a transcript's running total is not kept), so a
 *     running agent shows n/a tokens rather than a guessed share;
 *   - the last step is the real board, agent for agent.
 */
import { groupPhases, type WfAgent, type WfRun } from './workflows'

export type ReplayEvent = { atMs: number; agentId: string; kind: 'start' | 'end'; phase: string; label: string }

export type Timeline = {
  events: ReplayEvent[]
  /** First and last event time; both 0 for an empty timeline. */
  t0: number
  t1: number
  /** Agents left off the replay for want of a start time, or of a span for a finished one. */
  untimed: string[]
  /** Why there is nothing to replay, or null. */
  why: string | null
}

/** Speeds a replay plays at, as multiples of the run's own clock: a 20 minute run at 64x takes about 19 seconds. */
export const SPEEDS: readonly number[] = [1, 4, 16, 64, 256]

const ENDED = (agent: WfAgent): boolean => agent.state === 'done' || agent.state === 'failed'

export function buildTimeline(run: WfRun): Timeline {
  const empty = (why: string): Timeline => ({ events: [], t0: 0, t1: 0, untimed: [], why })

  if (run.kind !== 'workflow') return empty('the ruflo swarm has no run history to replay: ruflo records no start or end per agent')

  const events: ReplayEvent[] = []
  const untimed: string[] = []

  for (const phase of run.phases) {
    for (const agent of phase.agents) {
      if (agent.startedMs === undefined || (ENDED(agent) && agent.elapsedMs === undefined)) {
        untimed.push(agent.id)
        continue
      }

      events.push({ atMs: agent.startedMs, agentId: agent.id, kind: 'start', phase: agent.phase, label: agent.label })
      if (ENDED(agent) && agent.elapsedMs !== undefined) events.push({ atMs: agent.startedMs + agent.elapsedMs, agentId: agent.id, kind: 'end', phase: agent.phase, label: agent.label })
    }
  }

  if (events.length === 0) return { ...empty(run.total === 0 ? 'this run has no agents yet' : 'no agent of this run has a start time, so there is no order to replay'), untimed }

  events.sort((a, b) => a.atMs - b.atMs || (a.kind === b.kind ? 0 : a.kind === 'end' ? -1 : 1) || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))

  return { events, t0: (events[0] as ReplayEvent).atMs, t1: (events[events.length - 1] as ReplayEvent).atMs, untimed, why: null }
}

/** Time since the first event at the moment a step has been reached (step 0 is before any event). */
export const offsetOf = (tl: Timeline, step: number): number => (step <= 0 || tl.events.length === 0 ? 0 : (tl.events[Math.min(step, tl.events.length) - 1] as ReplayEvent).atMs - tl.t0)

/** Steps at which an agent of a phase not seen before starts: where "next phase" and "previous phase" land. */
export function phaseSteps(tl: Timeline): number[] {
  const seen = new Set<string>()
  const out: number[] = []

  for (const [index, event] of tl.events.entries()) {
    if (event.kind === 'start' && !seen.has(event.phase)) {
      seen.add(event.phase)
      out.push(index + 1)
    }
  }

  return out
}

const BARE = (agent: WfAgent): WfAgent => {
  const { tokens: _t, isTokensPartial: _p, elapsedMs: _e, startedMs: _s, resultPreview: _r, toolCalls: _c, lastTool: _l, ...rest } = agent

  return rest
}

/** The run as it stood after `step` events: the same shape the page draws, so the same board draws it. */
export function boardAt(run: WfRun, tl: Timeline, step: number): WfRun {
  const at = Math.max(0, Math.min(tl.events.length, Math.floor(step)))
  const started = new Set<string>()
  const ended = new Set<string>()

  for (const event of tl.events.slice(0, at)) (event.kind === 'start' ? started : ended).add(event.agentId)

  const skip = new Set(tl.untimed)
  const nowMs = tl.t0 + offsetOf(tl, at)
  const isLast = at === tl.events.length
  const agents: WfAgent[] = run.phases.flatMap(phase => phase.agents).filter(agent => !skip.has(agent.id)).map(agent => {
    if (isLast || ended.has(agent.id)) return agent
    if (!started.has(agent.id)) return { ...BARE(agent), state: 'queued' as const }

    return { ...BARE(agent), state: 'running' as const, ...(agent.startedMs !== undefined && { startedMs: agent.startedMs, elapsedMs: Math.max(0, nowMs - agent.startedMs) }) }
  })
  const phases = groupPhases(agents, run.phases.map(phase => ({ title: phase.title, ...(phase.detail !== undefined && { detail: phase.detail }) })))
  const count = (state: WfAgent['state']): number => agents.filter(agent => agent.state === state).length
  const known = agents.filter(agent => agent.tokens !== undefined)
  const isReal = isLast && skip.size === 0
  const unsure = agents.some(agent => agent.tokens === undefined || agent.isTokensPartial === true) || skip.size > 0

  return {
    ...run,
    phases,
    running: count('running'),
    done: count('done'),
    failed: count('failed'),
    idle: 0,
    total: agents.length,
    state: isLast ? run.state : 'running',
    // The last step is the real run, whose own total counts agents whose files are gone; every earlier step can only add up what its agents show.
    totalTokens: isReal ? run.totalTokens : known.length === 0 ? null : known.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0),
    isTokensPartial: isReal ? run.isTokensPartial : unsure,
    durationMs: isLast && run.durationMs !== undefined ? run.durationMs : Math.max(0, nowMs - tl.t0),
  }
}

/** Where a replay is. While `playFromMs` is set the step follows the wall clock from `baseMs` at `speed`; otherwise `step` is exact. */
export type ReplayUi = { step: number; speed: number; /** Wall-clock moment play began, or null when paused. */ playFromMs: number | null; /** Time since the first event when play began. */ baseMs: number }

export const newReplay = (): ReplayUi => ({ step: 0, speed: 16, playFromMs: null, baseMs: 0 })

/** The step the replay is at right now: a playing one counts the events its clock has passed, and stops at the end. */
export function stepNow(ui: ReplayUi, tl: Timeline, nowMs: number): number {
  const n = tl.events.length

  if (ui.playFromMs === null) return Math.max(0, Math.min(n, ui.step))

  const clock = ui.baseMs + Math.max(0, nowMs - ui.playFromMs) * ui.speed
  let step = Math.max(0, Math.min(n, ui.step))

  while (step < n && offsetOf(tl, step + 1) <= clock) step += 1

  return step
}

/** The most events one clock tick may carry a playing replay over: a tick is bounded work however fast the speed or long the gap since the last. */
export const TICK_MAX_STEPS = 400

/**
 * A playing replay brought up to `nowMs` and re-based there, so the next tick scans only the events that fall after it (never again from
 * where play began). The clock keeps its fractional progress between two events (a step minutes apart at 16x is reached by ticks, not
 * lost to each of them). It stops at the end, and carries at most TICK_MAX_STEPS events in one call. A paused replay is returned as it is.
 */
export function settle(ui: ReplayUi, tl: Timeline, nowMs: number): ReplayUi {
  if (ui.playFromMs === null) return ui

  const n = tl.events.length
  const from = Math.max(0, Math.min(n, ui.step))
  const clock = ui.baseMs + Math.max(0, nowMs - ui.playFromMs) * ui.speed
  const reached = stepNow(ui, tl, nowMs)
  const step = Math.min(reached, from + TICK_MAX_STEPS)

  if (step >= n) return { ...ui, step: n, baseMs: offsetOf(tl, n), playFromMs: null }

  return { ...ui, step, baseMs: step < reached ? offsetOf(tl, step) : clock, playFromMs: nowMs }
}

export const isPlaying = (ui: ReplayUi, tl: Timeline, nowMs: number): boolean => ui.playFromMs !== null && stepNow(ui, tl, nowMs) < tl.events.length

export type ReplayCommand = 'next' | 'prev' | 'first' | 'last' | 'next-phase' | 'prev-phase' | 'play' | 'faster' | 'slower'

/** One command applied to a replay. A manual move pauses it; `play` toggles (and restarts from the top when it is at the end). */
export function stepReplay(ui: ReplayUi, tl: Timeline, command: ReplayCommand, nowMs: number): ReplayUi {
  const n = tl.events.length
  const here = stepNow(ui, tl, nowMs)
  const settled: ReplayUi = { ...ui, step: here, playFromMs: null, baseMs: offsetOf(tl, here) }
  const go = (step: number): ReplayUi => ({ ...settled, step: Math.max(0, Math.min(n, step)), baseMs: offsetOf(tl, step) })
  const starts = phaseSteps(tl)
  const speedAt = SPEEDS.indexOf(ui.speed)

  switch (command) {
    case 'next':
      return go(here + 1)
    case 'prev':
      return go(here - 1)
    case 'first':
      return go(0)
    case 'last':
      return go(n)
    case 'next-phase':
      return go(starts.find(step => step > here) ?? n)
    case 'prev-phase':
      return go([...starts].reverse().find(step => step < here) ?? 0)
    case 'play':
      if (ui.playFromMs !== null && here < n) return settled

      return n === 0 ? settled : { ...settled, step: here >= n ? 0 : here, baseMs: offsetOf(tl, here >= n ? 0 : here), playFromMs: nowMs }
    case 'faster':
    case 'slower': {
      const speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (speedAt < 0 ? 2 : speedAt) + (command === 'faster' ? 1 : -1)))] as number

      // A playing replay keeps its place and carries on at the new speed.
      return ui.playFromMs === null ? { ...ui, speed } : { ...settled, speed, playFromMs: nowMs }
    }
  }
}

/** Jumps to a place along the run: `fraction` 0 is the first event's moment, 1 the last. Lands on the last step at or before it. */
export function jumpReplay(ui: ReplayUi, tl: Timeline, fraction: number): ReplayUi {
  const clock = (tl.t1 - tl.t0) * Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  let step = 0

  while (step < tl.events.length && offsetOf(tl, step + 1) <= clock) step += 1

  return { ...ui, step, playFromMs: null, baseMs: offsetOf(tl, step) }
}

/** What happened at a step, in a line: `+0:42  wire started (Wire)`; step 0 says nothing has happened yet. */
export function describeStep(tl: Timeline, step: number): string {
  const event = tl.events[step - 1]

  return event === undefined ? 'before the first agent started' : `${event.label} ${event.kind === 'start' ? 'started' : 'ended'} (${event.phase})`
}
