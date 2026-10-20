/**
 * The Missions list, pure and view-free (the view that draws it is views/missions.ts): which missions need attention first, how
 * old the observation is, what one mission spells on one line, and which rows a window of the list shows around the cursor. Tested
 * in tests/mission-list.spec.ts, so the list's behaviour is checked without the Claude Code test kit.
 */
import { money, type Mission } from './data/missions'
import { spinAt } from './spinner'
import { own } from './data/safe'

export { SPIN, spinAt } from './spinner'

/** The observation is older than this and the view says so: the daemon writes it after each change, so a long gap means it has stopped. */
export const STALE_AFTER_MS = 10 * 60_000

/** How many missions the list shows at once; the rest scroll with j and k. */
export const LIST_WINDOW = 10

export type Freshness = 'fresh' | 'stale' | 'undated'

/** Blocked and failed first, then the work in motion, then what is waiting or paused, then what has finished. */
export function missionRank(mission: Mission): number {
  switch (mission.state) {
    case 'blocked':
    case 'failed':
      return 0
    case 'running':
    case 'verifying':
    case 'pauseRequested':
    case 'cancelRequested':
      return 1
    case 'completed':
    case 'cancelled':
      return 3
    default:
      return 2
  }
}

/** Ranked by rank, then the most recently updated first; equal keys keep the order the record gave. */
export function sortMissions(missions: readonly Mission[]): Mission[] {
  return [...missions].sort((a, b) => missionRank(a) - missionRank(b) || (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
}

export function freshnessOf(observedAtMs: number | null, nowMs: number): Freshness {
  if (observedAtMs === null) return 'undated'

  return nowMs - observedAtMs > STALE_AFTER_MS ? 'stale' : 'fresh'
}

/** Tasks the runtime has recorded as done, out of the plan. A '+' marks a plan the record cut short, so the count is a floor. */
export function taskProgress(mission: Mission): string {
  const done = mission.plan.tasks.filter(task => task.status === 'recorded-done').length
  const partial = mission.plan.taskCount > mission.plan.tasks.length ? '+' : ''

  return `${done}${partial}/${mission.plan.taskCount}`
}

/** The budget in one short phrase: settled of the ceiling, or that there is none. */
export function budgetShort(mission: Mission): string {
  const budget = mission.budget

  if (budget === null) return 'no budget'
  if (budget.ceilingMinor === undefined) return `${money(budget.settledMinor ?? 0, budget.currency)} settled`

  return `${money(budget.settledMinor ?? 0, budget.currency)} of ${money(budget.ceilingMinor, budget.currency)}`
}

/** A mission or task the runtime is working on now. */
export const isLive = (state: string): boolean => state === 'running' || state === 'verifying'

const GLYPH: Record<string, string> = { completed: '●', failed: '✖', blocked: '✖', cancelled: '–' }

/** The one-line row: a state glyph (a spinner while it runs), the objective cut to fit, then the state, tasks, evidence and budget. */
export function missionRow(mission: Mission, nowMs = 0, maxObjective = 36): string {
  const objective = mission.objective === '' ? '(no objective)' : mission.objective
  const cut = objective.length > maxObjective ? `${objective.slice(0, maxObjective - 1)}…` : objective
  const glyph = isLive(mission.state) ? spinAt(nowMs) : (own(GLYPH, mission.state) ?? '○')

  return `${glyph} ${cut} · ${mission.state} · tasks ${taskProgress(mission)} · verified ${mission.evidence.verified}/${mission.evidence.count} · ${budgetShort(mission)}`
}

/**
 * Whether anything on the list is moving now (a mission running or verifying, a task running, or a guidance run in flight), so the
 * pane keeps redrawing while it is and stops when it is not.
 */
export function hasLiveWork(missions: readonly Mission[], guidanceRunning: boolean): boolean {
  return guidanceRunning || missions.some(mission => isLive(mission.state) || mission.plan.tasks.some(task => task.status === 'running'))
}

/** The cursor kept on the list: 0 for an empty list, else between the first and last mission. */
export function clampCursor(cursor: number, total: number): number {
  if (total <= 0) return 0

  return Math.min(Math.max(0, cursor), total - 1)
}

/**
 * The part of the list the view draws: a window of `size` missions that keeps the cursor on screen, the one-line row of each,
 * and the cursor's mission to expand below them. `hidden` counts the missions outside the window.
 */
export function listLayout(missions: readonly Mission[], cursor: number, nowMs = 0, size = LIST_WINDOW): { rows: { index: number; line: string }[]; expanded: Mission | null; hidden: number } {
  const sorted = sortMissions(missions)

  if (sorted.length === 0) return { rows: [], expanded: null, hidden: 0 }

  const at = clampCursor(cursor, sorted.length)
  const start = Math.min(Math.max(0, at - Math.floor(size / 2)), Math.max(0, sorted.length - size))
  const end = Math.min(sorted.length, start + size)
  const rows = sorted.slice(start, end).map((mission, i) => ({ index: start + i, line: missionRow(mission, nowMs) }))

  return { rows, expanded: sorted[at], hidden: sorted.length - rows.length }
}

/** How many missions need attention: blocked or failed. */
export function attentionCount(missions: readonly Mission[]): number {
  return missions.filter(mission => missionRank(mission) === 0).length
}
