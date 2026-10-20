/**
 * Auto-run's spend guard (ADR-443): a leaf module, so `advance()` in mission-control.ts can ask it without a cycle. The spend is the
 * cost ledger's reading for the mission's window and project (the `mission-cost` probe), a list-price estimate; the cap is the person's
 * own Settings value. With no cap there is nothing to check. With a cap, a task is handed out only against a FRESH reading for this mission:
 * a missing, stale or failed reading holds the hand-out (and the probe keeps running to get one), it never lets the task go (#3818).
 */
import { budgetAmount } from './cost'
import { missionCostArgsFor } from './data/mission-cost-argv'
import { capState, parseMissionCost, shouldPause, type MissionCost } from './data/mission-cost'
import type { Host } from './host'
import { live } from './views/common'
import { settingsOf } from './settings'
import type { MissionRecord } from './mission-types'
import type { State } from './state'

/** A reading older than this is not evidence of what is spent now (the probe runs every two minutes while it is wanted). */
export const COST_FRESH_MS = 5 * 60_000

/** The mission's cost reading, only while it is the one the probe was asked about (its window starts when the mission did). */
export function costOf(state: State, mission: MissionRecord): MissionCost | null {
  const cost = live<MissionCost>(state.probes.get('mission-cost'))

  return cost !== null && cost.fromMs === mission.createdAtMs ? cost : null
}

/** The cap in dollars: null for none (''); a non-empty value outside 0.01 to 10000 is NaN, which holds auto-run instead of meaning "no cap". */
export const capOf = (state: State): number | null => {
  const text = settingsOf(state).ai.missionCapUsd

  return text === '' ? null : (budgetAmount(text) ?? Number.NaN)
}

export type CapGate = 'clear' | 'reached' | 'hold'

/**
 * Whether auto-run may hand out the next task: `clear` (no cap, or a fresh reading under it), `reached` (a fresh reading at or past it: pause),
 * or `hold` (a cap is set but there is no fresh reading under it for this mission: hand out nothing yet). A reading past the cap pauses at any age.
 */
export function capGate(state: State, mission: MissionRecord, nowMs = Date.now()): CapGate {
  const cap = capOf(state)

  if (cap === null) return 'clear'

  const reading = state.probes.get('mission-cost')
  const cost = costOf(state, mission)

  if (Number.isNaN(cap) || cost === null) return 'hold'

  // A spend only grows inside a mission's window, so a reading at or past the cap stays past it however old it is: pause on it.
  if (shouldPause(capState(cost.usd, cap), mission.auto)) return 'reached'

  // Under the cap is only as good as the reading is new.
  return reading?.okAtMs === null || reading?.okAtMs === undefined || nowMs - reading.okAtMs > COST_FRESH_MS ? 'hold' : 'clear'
}

/** True when auto-run should stop handing out tasks because this mission's spend reached its cap. */
export const isCapReached = (state: State, mission: MissionRecord, nowMs = Date.now()): boolean => capGate(state, mission, nowMs) === 'reached'

const refreshing = new WeakMap<State, { running: boolean; atMs: number }>()
/** The reading is asked again when it is older than this (the Missions page's own probe uses the same cadence). */
export const COST_REFRESH_MS = 120_000

/**
 * Reads the active mission's spend itself when it is needed and the Missions page is not doing it: auto-run under a cap must not depend on a
 * page being in front. The same local ledger command and the same `mission-cost` probe slot as the page's probe; one run at a time.
 */
export async function refreshCost(state: State, host: Host, mission: MissionRecord, nowMs = Date.now()): Promise<void> {
  const held = state.probes.get('mission-cost')
  const mine = refreshing.get(state) ?? { running: false, atMs: 0 }

  if (mine.running || held?.isRunning === true || nowMs - mine.atMs < COST_REFRESH_MS / 4) return
  if (held?.okAtMs !== null && held?.okAtMs !== undefined && nowMs - held.okAtMs < COST_REFRESH_MS) return

  const argv = missionCostArgsFor(state, mission);

  if (argv === null) return

  refreshing.set(state, { running: true, atMs: nowMs })

  const before = held ?? { value: null, okAtMs: null, error: null, errorAtMs: null, isRunning: false }

  try {
    const result = await host.run(argv, 60_000)
    const value = result.exitCode === 0 ? parseMissionCost(result.stdout) : null

    state.probes.set('mission-cost', value !== null ? { value, okAtMs: Date.now(), error: null, errorAtMs: before.errorAtMs, isRunning: false } : { ...before, isRunning: false, errorAtMs: Date.now(), error: 'the cost ledger did not answer' })
  } catch {
    state.probes.set('mission-cost', { ...before, isRunning: false, errorAtMs: Date.now(), error: 'the cost ledger was refused' })
  } finally {
    refreshing.set(state, { running: false, atMs: nowMs })
    host.invalidate()
  }
}
