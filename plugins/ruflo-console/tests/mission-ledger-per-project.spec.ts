/**
 * #4237: the mission ledger was stored under one machine-wide key, so the active mission of one project showed up (and was injected into the
 * prompt) in every other project, and two sessions in different projects overwrote each other. #4254: a mission from that key with no project
 * recorded was still taken into every project that opened. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-ledger-per-project.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { Host } from '../hooks/host'
import { activeMission, adoptLegacy, dismissLegacy, ledgerKeyOf, loadLedger, LEDGER_KEY, mcOf, saveLedger } from '../hooks/mission-control'
import type { MissionRecord } from '../hooks/mission-types'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { missionControlView } from '../hooks/views/mission-control'

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

  it("offers the old shared ledger's missions with no project instead of taking them in, and never its active mission", async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { active: ID_OLD, missions: [mission(ID_OLD), mission(ID_A, { cwd: A })] }]])
    const b = stateIn(B)
    await loadLedger(b, storeHost(stored))
    expect(mcOf(b).missions.size).toBe(0)
    expect(mcOf(b).legacy.map(m => m.id)).toEqual([ID_OLD])
    expect(activeMission(b)).toBeNull()
  })

  it('adopting stamps the project on the missions and takes them out of the shared ledger, which is left empty', async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { active: ID_OLD, missions: [mission(ID_OLD)] }]])
    const host = storeHost(stored)
    const b = stateIn(B)
    await loadLedger(b, host)
    expect(await adoptLegacy(b, host)).toBe(1)
    expect(mcOf(b).missions.get(ID_OLD)?.cwd).toBe(B)
    expect(mcOf(b).legacy).toEqual([])
    expect(stored.get(LEDGER_KEY)).toEqual({ missions: [] })
    expect((stored.get(ledgerKeyOf(B)) as { missions: MissionRecord[] }).missions.map(m => [m.id, m.cwd])).toEqual([[ID_OLD, B]])

    // Another project no longer sees it.
    const c = stateIn('/home/me/project-c')
    await loadLedger(c, host)
    expect(mcOf(c).legacy).toEqual([])
  })

  it("takes a mission the shared ledger records for this project and prunes it there, leaving other projects' missions", async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { missions: [mission(ID_A, { cwd: A }), mission(ID_B, { cwd: B })] }]])
    const a = stateIn(A)
    await loadLedger(a, storeHost(stored))
    expect([...mcOf(a).missions.keys()]).toEqual([ID_A])
    expect((stored.get(ledgerKeyOf(A)) as { missions: MissionRecord[] }).missions.map(m => m.id)).toEqual([ID_A])
    expect((stored.get(LEDGER_KEY) as { missions: MissionRecord[] }).missions.map(m => m.id)).toEqual([ID_B])
  })

  it('dismissing keeps the offer away in this project and leaves the missions in the shared ledger for others', async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { missions: [mission(ID_OLD)] }]])
    const host = storeHost(stored)
    const b = stateIn(B)
    await loadLedger(b, host)
    dismissLegacy(b, host)
    await flush()

    const again = stateIn(B)
    await loadLedger(again, host)
    expect(mcOf(again).legacy).toEqual([])
    expect(mcOf(again).missions.size).toBe(0)

    const c = stateIn('/home/me/project-c')
    await loadLedger(c, host)
    expect(mcOf(c).legacy.map(m => m.id)).toEqual([ID_OLD])
  })

  it('offers, rather than keeps, a copy with no project that 0.44.3 wrote into this project\'s own key', async () => {
    const stored = new Map<string, unknown>([[ledgerKeyOf(B), { active: ID_OLD, missions: [mission(ID_OLD), mission(ID_B, { cwd: B })] }]])
    const b = stateIn(B)
    await loadLedger(b, storeHost(stored))
    expect([...mcOf(b).missions.keys()]).toEqual([ID_B])
    expect(mcOf(b).legacy.map(m => m.id)).toEqual([ID_OLD])
    expect(activeMission(b)).toBeNull()
  })

  it('a session that starts again in another project carries none of the last project\'s missions', async () => {
    const stored = new Map<string, unknown>([[ledgerKeyOf(A), { active: ID_A, missions: [mission(ID_A, { cwd: A })] }]])
    const host = storeHost(stored)
    const state = stateIn(A)
    await loadLedger(state, host)
    expect(activeMission(state)?.id).toBe(ID_A)

    // session.start reuses the same State with the new directory (register.ts).
    state.cwd = B
    await loadLedger(state, host)
    expect(activeMission(state)).toBeNull()
    expect(mcOf(state).missions.size).toBe(0)
  })

  it('Mission Control lists the offer with adopt and dismiss, and nothing when there is no offer', () => {
    type El = { kind: string; props: Record<string, unknown> }
    const node = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
    const kit = { Box: node('Box'), Text: node('Text'), Button: node('Button'), Input: node('Input') }
    const flat = (el: unknown): El[] => {
      const n = el as El
      if (typeof n !== 'object' || n === null) return []
      const kids = n.props.children
      return [n, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
    }
    const pressed: string[] = []
    const act = new Proxy({ mission: new Proxy({}, { get: (_t, key) => () => void pressed.push(String(key)) }) }, { get: (t, key) => (key in t ? t[key as 'mission'] : () => undefined) })
    const state = stateIn(B)
    const ctx = { kit, state, nowMs: 5_000, columns: 100, pictures: new Map(), act, cards: false } as unknown as Ctx
    const words = () => flat(missionControlView(ctx)).filter(n => n.kind === 'Text').map(n => String(n.props.children)).join('\n')
    const button = (key: string) => flat(missionControlView(ctx)).find(n => n.kind === 'Button' && n.props.key === key)

    expect(button('mc-legacy-adopt')).toBeUndefined()

    mcOf(state).legacy = [mission(ID_OLD, { objective: 'an old goal from somewhere' })]
    expect(words()).toContain('1 mission from before per-project storage')
    expect(words()).toContain('an old goal from somewhere')
    ;(button('mc-legacy-adopt')?.props.onPress as () => void)()
    ;(button('mc-legacy-dismiss')?.props.onPress as () => void)()
    expect(pressed).toEqual(['adoptLegacy', 'dismissLegacy'])
  })
})
