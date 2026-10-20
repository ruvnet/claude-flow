/**
 * The ledger command for the active mission's spend (ADR-443), as a leaf: the probe in cost-probes.ts and the auto-run spend guard
 * (mission-guard.ts) both build it from here, and neither imports Mission Control.
 */
import type { MissionRecord } from '../mission-types'
import type { State } from '../state'
import { bumpKind, parseSemver } from '../updates'
import { COST_PLUGIN, trackerOf } from './cost-ledger'
import { missionCostArgv } from './mission-cost'

/** The first tracker release whose ledger takes the window and project filters. */
export const MISSION_COST_FROM = '0.27.1'

export function missionCostArgsFor(state: State, mission: MissionRecord | null): readonly string[] | null {
  const tracker = trackerOf(state)

  if (tracker.kind !== 'ready' || mission === null) return null

  const version = state.snapshot?.plugins.installed?.find(plugin => plugin.id === COST_PLUGIN)?.version ?? ''

  // Older than the filters (or not a version we can read): not ready, never guessed at.
  if (parseSemver(version) === null || bumpKind(version, MISSION_COST_FROM) !== null) return null

  // A finished or cancelled mission's window closes at its last event; a live one stays open at the right.
  const end = mission.cancelled ? Math.max(mission.createdAtMs, ...mission.events.map(event => event.atMs)) : null

  return missionCostArgv(tracker.root, mission.createdAtMs, end, state.cwd)
}

