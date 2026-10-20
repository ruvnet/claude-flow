/**
 * The loop manager (ADR-443 §2.4): prepares, tracks and re-arms the `/loop` of a long-running mission. Pure: state in, state or text out.
 * The console never schedules anything. Claude owns the recurring task (and `CronDelete`); the console builds the `/loop` line, counts the
 * ticks that arrive carrying the mission's marker, and says when the loop is overdue, about to expire or gone.
 */
import { plain } from './data/parse'
import { MISSION_OBJECTIVE_MAX } from './full-text'
import { DEFAULT_LOOP, type LoopPrefs } from './goap'
import { doneDue, escalationOf, stopReason } from './mission-advisor'
import type { Derived, MissionRecord } from './mission-types'

export type LoopStatus = 'idle' | 'armed' | 'stopped' | 'expired' | 'done'
export type LoopState = { missionId: string; interval: string; startedAtMs: number; expiresAtMs: number; ticks: number; lastTickMs: number | null; status: LoopStatus }
export type LoopLevel = 'ok' | 'warn' | 'bad'
export type LoopReport = { text: string; level: LoopLevel; nextTickMs: number | null; msToExpiry: number; isOverdue: boolean; isExpiring: boolean }
export type TickAction = 'run-next' | 'run-gates' | 'wait' | 'stop' | 'rearm' | 'consult-advisor'

/** A recurring `/loop` task expires after 7 days. */
export const LOOP_LIFETIME_MS = 7 * 24 * 3600 * 1000
/** The warning window before expiry. */
export const EXPIRY_WARN_MS = 24 * 3600 * 1000
/** The event type the integrator records when the gates ran, so a tick does not run them twice in a row. */
export const GATE_EVENT = 'gate.run'

const MIN_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 24 * 3600 * 1000
const MAX_TICKS = 1_000_000
const STATUSES: readonly LoopStatus[] = ['idle', 'armed', 'stopped', 'expired', 'done']
const SAFE_ID = /[^A-Za-z0-9._:@-]/g
const INTERVAL = /^(\d{1,4})([smhd])$/
const MARKER = /\[mission:([A-Za-z0-9._:@-]{1,128}) loop\]/
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

const idOf = (value: unknown): string => (typeof value === 'string' ? value.replace(SAFE_ID, '').slice(0, 128) : '')
const msOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** An interval such as `5m` in milliseconds, or null when it is not `<digits><s|m|h|d>`. */
export function intervalMs(interval: unknown): number | null {
  const match = typeof interval === 'string' ? INTERVAL.exec(interval) : null

  return match === null ? null : Number(match[1]) * (UNIT_MS[match[2] as string] as number)
}

/** The interval as the loop will use it: the person's value when it is well formed, else the default; never below 1m, never above 1d. */
export function normalizeInterval(interval: unknown, fallback: string = DEFAULT_LOOP.loopInterval): string {
  const ms = intervalMs(interval)

  if (ms === null) return intervalMs(fallback) === null ? DEFAULT_LOOP.loopInterval : normalizeInterval(fallback, DEFAULT_LOOP.loopInterval)
  if (ms < MIN_INTERVAL_MS) return '1m'
  if (ms > MAX_INTERVAL_MS) return '1d'

  return interval as string
}

/** The marker a tick of this mission's loop carries. */
export const loopMarker = (missionId: string): string => `[mission:${idOf(missionId)} loop]`

/** The recurring prompt: the marker, then the per-tick checklist of ADR-441. Push and publish are named only when the settings allow them. */
export function loopPrompt(mission: MissionRecord, prefs: LoopPrefs & { subagentSummaries?: boolean }): string {
  const commit = prefs.loopCommit ? 'commit to the mission branch only' : 'make no commits, leave changes in the worktree'
  const push = prefs.loopPush ? 'the mission branch may be pushed to its remote' : 'do not push'
  const publish = prefs.loopPublish ? 'releases or packages the mission names may be published' : 'do not publish, release or deploy'
  const parts = [
    `${loopMarker(mission.id)} Mission ${idOf(mission.id)}: ${plain(mission.objective, MISSION_OBJECTIVE_MAX)}.`,
    'Each tick: 1 check progress against the plan; 2 fix what failed; 3 run the gates and read their real output; 4 repeat until every acceptance check passes and every gate is green on the same clean commit, then stop the loop and report.',
    'Stop and ask only when a gate fails the same way three ticks running or an action would leave the branch.',
    `${commit}; ${push}; ${publish}.`,
    // ADR-483: an instruction to Claude, not something the console can enforce on a subagent.
    ...(prefs.subagentSummaries === true ? ['Subagents you start do discovery and lookups only and return a structured summary (findings, file paths, a verdict), never raw file contents or logs.'] : []),
  ]

  // The whole objective rides in the prompt (a ruflo mission's objective is at most MISSION_OBJECTIVE_MAX); the fixed checklist is the other 1,000.
  return plain(parts.join(' '), MISSION_OBJECTIVE_MAX + 1000)
}

/** The line that starts the loop: `/loop <interval> <prompt>`, the interval well formed and never below 1m. */
export const startCommand = (mission: MissionRecord, prefs: LoopPrefs & { subagentSummaries?: boolean }, interval: string): string => `/loop ${normalizeInterval(interval, prefs.loopInterval)} ${loopPrompt(mission, prefs)}`

/** True only when the first marker in the text is this mission's: another mission's marker, or this one quoted later in a longer message, is not a tick. */
export function isTick(promptText: string, missionId: string): boolean {
  const id = idOf(missionId)

  if (id === '' || typeof promptText !== 'string') return false

  return MARKER.exec(promptText.slice(0, 2000))?.[1] === id
}

const fresh = (missionId: string, interval: string, nowMs: number): LoopState => ({ missionId, interval, startedAtMs: nowMs, expiresAtMs: nowMs + LOOP_LIFETIME_MS, ticks: 0, lastTickMs: null, status: 'armed' })

/** The loop armed for this mission: a fresh lifetime and tick count, unless this very loop is already armed and has not expired. */
export function armed(state0: LoopState | null, mission: MissionRecord, interval: string, nowMs: number): LoopState {
  const missionId = idOf(mission.id)
  const every = normalizeInterval(interval)

  if (state0 !== null && state0.missionId === missionId && state0.status === 'armed' && state0.interval === every && nowMs < state0.expiresAtMs) return state0

  return fresh(missionId, every, nowMs)
}

/** A tick arrived: counted while the loop is armed and inside its lifetime; past it the loop is expired and nothing is counted. */
export function tick(state: LoopState, nowMs: number): LoopState {
  if (state.status !== 'armed') return state
  if (nowMs >= state.expiresAtMs) return { ...state, status: 'expired' }

  return { ...state, ticks: Math.min(MAX_TICKS, state.ticks + 1), lastTickMs: nowMs }
}

/** The person asked to stop: an idle or armed loop is stopped; expired and done stay as they are. */
export const stop = (state: LoopState): LoopState => (state.status === 'armed' || state.status === 'idle' ? { ...state, status: 'stopped' } : state)

const IDLE: LoopReport = { text: 'no loop', level: 'ok', nextTickMs: null, msToExpiry: 0, isOverdue: false, isExpiring: false }

/** A duration as a short phrase: `45s`, `4m`, `3h 10m`, `2d 4h`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))

  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`

  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
}

/** Where the loop stands at `nowMs`. Total: a missing or malformed state reads as no loop. */
export function status(state: LoopState | null, nowMs: number): LoopReport {
  const every = state === null ? null : intervalMs(state.interval)

  if (state === null || typeof state !== 'object' || !Number.isFinite(nowMs) || every === null || msOf(state.startedAtMs) === null || msOf(state.expiresAtMs) === null) return IDLE

  const msToExpiry = Math.max(0, state.expiresAtMs - nowMs)
  const ticks = `${state.ticks} tick${state.ticks === 1 ? '' : 's'}`

  if (state.status === 'expired' || (state.status === 'armed' && msToExpiry === 0)) return { text: `expired after ${ticks}: the 7-day task is gone`, level: 'bad', nextTickMs: null, msToExpiry: 0, isOverdue: false, isExpiring: false }
  if (state.status === 'stopped') return { text: `stopped after ${ticks}`, level: 'warn', nextTickMs: null, msToExpiry, isOverdue: false, isExpiring: false }
  if (state.status === 'done') return { text: `done after ${ticks}`, level: 'ok', nextTickMs: null, msToExpiry, isOverdue: false, isExpiring: false }
  if (state.status === 'idle') return { text: 'not started', level: 'ok', nextTickMs: null, msToExpiry, isOverdue: false, isExpiring: false }

  const base = Math.max(state.startedAtMs, state.lastTickMs ?? 0)
  const nextTickMs = base + every
  const isOverdue = nowMs - base > 3 * every
  const isExpiring = msToExpiry <= EXPIRY_WARN_MS
  const next = nextTickMs <= nowMs ? 'due now' : `next in ${span(nextTickMs - nowMs)}`
  const text = isOverdue ? `armed but overdue: no tick for ${span(nowMs - base)} (${ticks})` : `armed · ${ticks} · ${next}`

  return { text, level: isOverdue ? 'bad' : isExpiring ? 'warn' : 'ok', nextTickMs, msToExpiry, isOverdue, isExpiring }
}

/** Text for Claude to cancel the recurring task. Only Claude owns the schedule (CronList, CronDelete), so the console can only ask. */
export const stopRequest = (state: LoopState | null, mission: MissionRecord): string =>
  [
    `Please stop the recurring loop for mission ${idOf(mission.id)}.`,
    `The console cannot cancel it: only you own the schedule. List your scheduled tasks (CronList) and delete (CronDelete) the one whose prompt starts with ${loopMarker(mission.id)}${state === null ? '' : ` (every ${normalizeInterval(state.interval)}, ${state.ticks} ticks so far)`}.`,
    'Change nothing else, then confirm that no task with that marker is left.',
  ].join(' ')

/** The `/loop` line to arm again with the same prompt, or null while the loop is armed and healthy. Overdue needs the clock, so pass `nowMs`. */
export function rearmCommand(state: LoopState | null, mission: MissionRecord, prefs: LoopPrefs, nowMs?: number): string | null {
  if (state === null || state.missionId !== idOf(mission.id)) return null

  const gone = state.status === 'expired' || state.status === 'stopped' || (nowMs !== undefined && status(state, nowMs).level === 'bad' && state.status === 'armed')

  return gone ? startCommand(mission, prefs, state.interval) : null
}

export const serializeLoop = (state: LoopState): unknown => ({ ...state })

/** A loop read back from storage, or null when anything is off: the id, interval, times, tick count or status. */
export function parseLoop(value: unknown): LoopState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null

  const v = value as Record<string, unknown>
  const missionId = idOf(v.missionId)
  const startedAtMs = msOf(v.startedAtMs)
  const expiresAtMs = msOf(v.expiresAtMs)
  const lastTickMs = v.lastTickMs === null ? null : msOf(v.lastTickMs)

  if (missionId === '' || missionId !== v.missionId || startedAtMs === null || expiresAtMs === null || expiresAtMs < startedAtMs) return null
  if (intervalMs(v.interval) === null || typeof v.interval !== 'string' || normalizeInterval(v.interval) !== v.interval) return null
  if (v.lastTickMs !== null && lastTickMs === null) return null
  if (typeof v.ticks !== 'number' || !Number.isInteger(v.ticks) || v.ticks < 0 || v.ticks > MAX_TICKS) return null
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status as LoopStatus)) return null

  return { missionId, interval: v.interval, startedAtMs, expiresAtMs, ticks: v.ticks, lastTickMs, status: v.status as LoopStatus }
}

export type TickInput = {
  mission: MissionRecord
  loop: LoopState
  prefs: LoopPrefs
  gatesConfigured: boolean
  spendUsd: number | null
  capUsd: number | null
  nowMs: number
  /** Each task's status from the ruflo task store (`derive`); without it the ledger events decide. */
  taskStatus?: ReadonlyMap<string, Derived>
  /** ADR-483: advisor checkpoints are on (Settings). Off or absent: the plan is exactly what it was before. */
  advisor?: boolean
}

/** Task statuses from the ledger alone: the latest event of a task decides, a dispatch without a later result is running. */
function statusFromEvents(mission: MissionRecord): Map<string, Derived> {
  const out = new Map<string, Derived>()

  for (const task of mission.tasks) {
    const last = mission.events.filter(event => event.taskId === task.id).sort((a, b) => a.seq - b.seq).at(-1)
    const s = last?.status
    const done = (id: string) => out.get(id) === 'done'

    out.set(task.id, s === 'completed' || s === 'done' ? 'done' : s === 'failed' ? 'failed' : s === 'cancelled' ? 'cancelled' : s === 'in_progress' || s === 'running' ? 'running' : task.dependsOn.every(done) ? 'ready' : 'waiting')
  }

  return out
}

/**
 * What a tick should do. Call it before `tick()` counts the arrival, so the interval is measured from the previous tick. Stop wins over
 * everything (cancelled, all tasks done, the spend cap reached, or a loop that was stopped); then wait while paused; rearm when the loop
 * has expired; wait while a task runs or the interval (less 10% for clock jitter) has not passed; then gates after a finished task, else the next task.
 */
export function tickPlan(input: TickInput): { action: TickAction; reason: string } {
  const { mission, loop, gatesConfigured, spendUsd, capUsd, nowMs } = input
  const states = input.taskStatus ?? statusFromEvents(mission)
  const values = mission.tasks.map(task => states.get(task.id) ?? 'waiting')
  const every = intervalMs(loop.interval) ?? (intervalMs(DEFAULT_LOOP.loopInterval) as number)

  if (mission.cancelled) return { action: 'stop', reason: 'the mission is cancelled' }
  if (mission.tasks.length > 0 && values.every(value => value === 'done')) {
    if (input.advisor === true && doneDue(mission, states)) return { action: 'consult-advisor', reason: 'every task is done: the advisor checks before the loop stops' }

    return { action: 'stop', reason: 'every task is done: report and stop the loop' }
  }
  if (spendUsd !== null && capUsd !== null && capUsd > 0 && spendUsd >= capUsd) return { action: 'stop', reason: `spend $${spendUsd.toFixed(2)} reached the cap $${capUsd.toFixed(2)}` }
  const escalation = input.advisor === true ? escalationOf(mission) : null

  if (escalation?.state === 'stop') return { action: 'stop', reason: stopReason(escalation) }
  if (loop.status === 'stopped' || loop.status === 'done') return { action: 'stop', reason: `the loop was ${loop.status}: cancel its recurring task` }
  if (mission.paused) return { action: 'wait', reason: 'the mission is paused' }
  if (loop.status === 'expired' || nowMs >= loop.expiresAtMs) return { action: 'rearm', reason: 'the 7-day loop task has expired' }
  if (values.includes('running')) return { action: 'wait', reason: 'a task is still running' }
  if (loop.lastTickMs !== null && nowMs - loop.lastTickMs < every * 0.9) return { action: 'wait', reason: `the ${loop.interval} interval has not elapsed` }

  if (escalation?.state === 'consult') return { action: 'consult-advisor', reason: `${escalation.stream?.label ?? 'a check'} failed ${escalation.count} times in a row: root-cause it with the advisor before a third try` }

  const lastEvent = mission.events.reduce<{ seq: number; type: string } | null>((best, event) => (best === null || event.seq > best.seq ? event : best), null)
  const gatesRanSince = lastEvent?.type === GATE_EVENT

  if (gatesConfigured && values.includes('done') && !gatesRanSince) return { action: 'run-gates', reason: 'the previous task finished: run the gates' }

  return { action: 'run-next', reason: 'hand over the next ready task' }
}
