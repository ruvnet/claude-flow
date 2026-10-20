/**
 * Every probe of the cost-tracker plugin's ledger: the Cost page's seven-day reading, and the active mission's spend (ADR-443). The
 * mission's needs a newer tracker than the Cost page's (the `--from`, `--to` and `--project` filters), so an older one is "not ready",
 * and the probe does not run. Local only: nothing here reaches the network.
 */
import { activeMission } from '../mission-control'
import type { State } from '../state'
import { costLedgerProbe } from './cost-ledger'
import { missionCostArgsFor } from './mission-cost-argv'
import { parseMissionCost, type MissionCost } from './mission-cost'
import type { Probe } from './cli'

export { MISSION_COST_FROM } from './mission-cost-argv'

function missionCostArgs(state: State): readonly string[] | null {
  return missionCostArgsFor(state, activeMission(state))
}

export const missionCostProbe: Probe<MissionCost> = {
  id: 'mission-cost', args: [], argvOf: missionCostArgs, views: ['missions'], everyMs: 120_000, timeoutMs: 60_000, parse: parseMissionCost,
}

export const ALL_COST_PROBES = [costLedgerProbe, missionCostProbe] as const
