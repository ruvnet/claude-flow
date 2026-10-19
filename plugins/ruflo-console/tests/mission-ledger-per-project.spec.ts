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
    expect(await adoptLegacy(b, host, ID_OLD)).toBe('adopted')
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
    expect(button('mc-legacy-dismiss')).toBeUndefined()
    ;(button(`mc-legacy-adopt-${ID_OLD}`)?.props.onPress as () => void)()
    ;(button(`mc-legacy-dismiss-${ID_OLD}`)?.props.onPress as () => void)()
    expect(pressed).toEqual(['adoptLegacy', 'dismissLegacy'])

    // Two or more: each has its own row, and one button turns them all away.
    mcOf(state).legacy.push(mission(ID_A))
    expect(button(`mc-legacy-adopt-${ID_A}`)).toBeDefined()
    ;(button('mc-legacy-dismiss')?.props.onPress as () => void)()
    expect(pressed).toEqual(['adoptLegacy', 'dismissLegacy', 'dismissLegacy'])
  })
})

// From the review of #4276: each of these asserted the defect against c85c5f3; here they assert the fix.
describe('mission ledger offers after review (#4254)', () => {
  const hex = (n: number) => 'msn_' + n.toString(16).padStart(24, '0')
  const idsAt = (stored: Map<string, unknown>, key: string): string[] => ((stored.get(key) as { missions?: MissionRecord[] } | undefined)?.missions ?? []).map(m => m.id)

  it("adopting one mission leaves the others offered, in this project and in the projects they came from", async () => {
    const fromA = hex(1), fromX = hex(2), fromY = hex(3)
    const stored = new Map<string, unknown>([[LEDGER_KEY, { active: fromY, missions: [mission(fromA), mission(fromX), mission(fromY)] }]])
    const host = storeHost(stored)
    const a = stateIn(A)
    await loadLedger(a, host)
    expect(await adoptLegacy(a, host, fromA)).toBe('adopted')
    expect(idsAt(stored, ledgerKeyOf(A))).toEqual([fromA])
    expect(mcOf(a).legacy.map(m => m.id)).toEqual([fromX, fromY])

    const x = stateIn('/home/me/project-x')
    await loadLedger(x, host)
    expect(mcOf(x).legacy.map(m => m.id)).toEqual([fromX, fromY])
  })

  it('dismissing one mission keeps the rest offered, across a reload', async () => {
    const one = hex(1), two = hex(2)
    const stored = new Map<string, unknown>([[LEDGER_KEY, { missions: [mission(one), mission(two)] }]])
    const host = storeHost(stored)
    const b = stateIn(B)
    await loadLedger(b, host)
    dismissLegacy(b, host, one)
    await flush()
    expect(mcOf(b).legacy.map(m => m.id)).toEqual([two])

    const again = stateIn(B)
    await loadLedger(again, host)
    expect(mcOf(again).legacy.map(m => m.id)).toEqual([two])
    expect(idsAt(stored, LEDGER_KEY)).toEqual([one, two])
  })

  it('an offer saved by the earlier 0.44.4 as one dismissal still covers the missions offered then', async () => {
    const stored = new Map<string, unknown>([[ledgerKeyOf(B), { active: null, missions: [], legacyDismissed: true }], [LEDGER_KEY, { missions: [mission(ID_OLD)] }]])
    const b = stateIn(B)
    await loadLedger(b, storeHost(stored))
    expect(mcOf(b).legacy).toEqual([])
  })

  it('refuses to adopt past the cap instead of losing the mission', async () => {
    const own = Array.from({ length: 20 }, (_, i) => mission(hex(100 + i), { cwd: A, createdAtMs: 100 + i }))
    const old = mission(hex(1), { createdAtMs: 1 })
    const stored = new Map<string, unknown>([[ledgerKeyOf(A), { active: null, missions: own }], [LEDGER_KEY, { missions: [old] }]])
    const host = storeHost(stored)
    const a = stateIn(A)
    await loadLedger(a, host)
    expect(await adoptLegacy(a, host, old.id)).toBe('full')
    expect(idsAt(stored, LEDGER_KEY)).toEqual([old.id])
    expect(mcOf(a).legacy.map(m => m.id)).toEqual([old.id])
    expect(mcOf(a).missions.size).toBe(20)
  })

  it('an offer held only in the project key is still offered after a save and reload', async () => {
    const L = hex(7)
    const stored = new Map<string, unknown>([[ledgerKeyOf(A), { active: null, missions: [mission(L)] }]])
    const host = storeHost(stored)
    const a = stateIn(A)
    await loadLedger(a, host)
    expect(mcOf(a).legacy.map(m => m.id)).toEqual([L])
    saveLedger(a, host)
    await flush()

    const again = stateIn(A)
    await loadLedger(again, host)
    expect(mcOf(again).legacy.map(m => m.id)).toEqual([L])
    expect(mcOf(again).missions.size).toBe(0)

    // Adopted, it becomes this project's and stops being held as an offer.
    expect(await adoptLegacy(again, host, L)).toBe('adopted')
    const saved = stored.get(ledgerKeyOf(A)) as { missions: MissionRecord[]; offered?: MissionRecord[] }
    expect(saved.missions.map(m => [m.id, m.cwd])).toEqual([[L, A]])
    expect(saved.offered).toBeUndefined()
  })

  it('a failed project-key write prunes nothing from the shared key', async () => {
    const id = hex(8)
    const stored = new Map<string, unknown>([[LEDGER_KEY, { missions: [mission(id)] }]])
    const base = storeHost(stored)
    const host = { ...base, storeSet: async (k: string, v: unknown) => { if (k === ledgerKeyOf(A)) throw new Error('write failed'); return base.storeSet(k, v) } } as Host
    const a = stateIn(A)
    await loadLedger(a, host)
    expect(await adoptLegacy(a, host, id)).toBe('failed')
    expect(idsAt(stored, LEDGER_KEY)).toEqual([id])
    expect(mcOf(a).legacy.map(m => m.id)).toEqual([id])
    expect(mcOf(a).missions.size).toBe(0)
  })

  it('a failed write while claiming on load leaves the mission in the shared key', async () => {
    const stored = new Map<string, unknown>([[LEDGER_KEY, { missions: [mission(ID_A, { cwd: A })] }]])
    const base = storeHost(stored)
    const host = { ...base, storeSet: async (k: string, v: unknown) => { if (k === ledgerKeyOf(A)) throw new Error('write failed'); return base.storeSet(k, v) } } as Host
    await loadLedger(stateIn(A), host)
    expect(idsAt(stored, LEDGER_KEY)).toEqual([ID_A])
  })

  it('a session that moves to another project drops the goal and plan made in the last one', async () => {
    const host = storeHost(new Map())
    const state = stateIn(A)
    await loadLedger(state, host)
    Object.assign(mcOf(state), { goal: 'add dark mode', planned: { nodes: [] } })
    state.cwd = B
    await loadLedger(state, host)
    expect(mcOf(state).goal).toBe('')
    expect(mcOf(state).planned).toBeNull()
  })
})
