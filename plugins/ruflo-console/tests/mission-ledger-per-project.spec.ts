/**
 * #4237: the mission ledger was stored under one machine-wide key, so the active mission of one project showed up (and was injected into the
 * prompt) in every other project, and two sessions in different projects overwrote each other. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-ledger-per-project.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { Host } from '../hooks/host'
import { activeMission, ledgerKeyOf, loadLedger, LEDGER_KEY, mcOf, saveLedger } from '../hooks/mission-control'
import type { MissionRecord } from '../hooks/mission-types'
import { newState, type State } from '../hooks/state'

const A = '/home/me/project-a'
const B = '/home/me/project-b'

const mission = (id: string, extra: Partial<MissionRecord> = {}): MissionRecord => ({
  id,
  objective: `goal ${id}`,
  profile: 'feature',
  rigor: 'standard',
  tasks: [],
  acceptance: [],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: 1,
  ...extra,
})

const ID_A = 'msn_aaaaaaaaaaaaaaaaaaaaaaaa'
const ID_B = 'msn_bbbbbbbbbbbbbbbbbbbbbbbb'
const ID_OLD = 'msn_cccccccccccccccccccccccc'

function storeHost(stored: Map<string, unknown>): Host {
  return { storeGet: async (key: string) => stored.get(key), storeSet: async (key: string, value: unknown) => void stored.set(key, value) } as unknown as Host
}

function stateIn(cwd: string): State {
  const state = newState()
  state.cwd = cwd
  return state
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('mission ledger per project (#4237)', () => {
  it("does not show project A's active mission in project B", async () => {
    const stored = new Map<string, unknown>()
    const host = storeHost(stored)
    const a = stateIn(A)
    mcOf(a).missions.set(ID_A, mission(ID_A, { cwd: A }))
    mcOf(a).active = ID_A
    saveLedger(a, host)
    await flush()

    const b = stateIn(B)
    await loadLedger(b, host)
    expect(activeMission(b)).toBeNull()
    expect(mcOf(b).missions.size).toBe(0)

    const again = stateIn(A)
    await loadLedger(again, host)
    expect(activeMission(again)?.id).toBe(ID_A)
  })

  it('sessions in two projects keep their own ledgers', async () => {
    const stored = new Map<string, unknown>()
    const host = storeHost(stored)
    const a = stateIn(A)
    const b = stateIn(B)
    mcOf(a).missions.set(ID_A, mission(ID_A, { cwd: A }))
    mcOf(a).active = ID_A
    mcOf(b).missions.set(ID_B, mission(ID_B, { cwd: B }))
    mcOf(b).active = ID_B
    saveLedger(a, host)
    saveLedger(b, host)
    await flush()

    const reloaded = stateIn(A)
    await loadLedger(reloaded, host)
    expect([...mcOf(reloaded).missions.keys()]).toEqual([ID_A])
    expect(stored.has(ledgerKeyOf(A))).toBe(true)
    expect(stored.has(ledgerKeyOf(B))).toBe(true)
  })

  it('reads the old shared ledger once, without adopting its active mission or other projects\' missions', async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { active: ID_OLD, missions: [mission(ID_OLD), mission(ID_A, { cwd: A })] }]])
    const b = stateIn(B)
    await loadLedger(b, storeHost(stored))
    expect([...mcOf(b).missions.keys()]).toEqual([ID_OLD])
    expect(activeMission(b)).toBeNull()
  })
})
