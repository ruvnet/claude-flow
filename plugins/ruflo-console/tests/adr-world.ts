/** A project copy with a console state, a host over real files, and an active mission: the setup the ADR integration specs share (ADR-480). */
import { loadAdrs } from '../hooks/adr'
import { mcOf } from '../hooks/mission-control'
import type { MissionRecord } from '../hooks/mission-types'
import { newState } from '../hooks/state'
import { hostOfRoot, project } from './adr-helpers'

export const TASK = { id: 't1', title: 'Move sessions', phase: 'refinement', agent: 'coder', requirement: 'sessions live in the new store', dependsOn: [] }
export const missionOf = (patch: Partial<MissionRecord> = {}): MissionRecord => ({ id: 'msn_aaaaaaaaaaaaaaaaaaaaaaaa', objective: 'Move the graphql api sessions in api/public', profile: 'feature', rigor: 'standard', tasks: [TASK], acceptance: [{ id: 'a1', check: 'tests pass' }], events: [], paused: false, cancelled: false, auto: false, createdAtMs: Date.now() - 3_600_000, ...patch })

export async function world(name: string, mission: Partial<MissionRecord> | null = {}) {
  const root = project(name)

  const state = newState({})
  const hosted = hostOfRoot(root)
  const stored = new Map<string, unknown>()
  const host = { ...hosted.host, storeSet: async (key: string, value: unknown) => void stored.set(key, value), storeGet: async (key: string) => stored.get(key) }

  state.cwd = root
  state.isInteractive = true

  if (mission !== null) {
    const record = missionOf(mission)

    mcOf(state).missions.set(record.id, record)
    mcOf(state).active = record.id
  }

  await loadAdrs(state, host as never)

  return { root, state, host, stored, log: hosted.log, mission: mission === null ? null : (mcOf(state).missions.get('msn_aaaaaaaaaaaaaaaaaaaaaaaa') as MissionRecord) }
}
