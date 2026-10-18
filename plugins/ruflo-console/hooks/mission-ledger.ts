/**
 * The mission ledger in the host store: one key per project (#4237), and what is left of the machine-wide key that came before it. A
 * mission recorded for this project is taken out of the old key on load; one that names no project is offered, never taken in unasked (#4254).
 */
import type { Host } from './host'
import type { McState, MissionRecord } from './mission-types'
import type { State } from './state'

const states = new WeakMap<State, McState>()
/** The pre-#4237 ledger key, shared by every project on the machine. Read by each project for missions to claim or offer; written only to take them out. */
export const LEDGER_KEY = 'mission-ledger'

/** The mission ledger is per project, like the UI view (`storeKeyOf`): one machine-wide key let one project's active mission drive another's. */
export const ledgerKeyOf = (cwd: string): string => (cwd === '' ? LEDGER_KEY : `${LEDGER_KEY}:${cwd}`)

export function mcOf(state: State): McState {
  let found = states.get(state)

  if (found === undefined) {
    found = { goal: '', profile: 'feature', rigor: 'standard', isProfilePicked: false, planned: null, missions: new Map(), active: null, legacy: [], legacyDismissed: new Set(), tab: 'plan', lastGuide: '', guidance: null, screen: null, isScreenOn: true, last: null }
    states.set(state, found)
  }

  return found
}

/** `offered`: copies with no project that this project's own key held, kept until the person adopts them. `legacyDismissed` was `true` before it listed ids. */
type SavedLedger = { active?: unknown; missions?: unknown; offered?: unknown; legacyDismissed?: unknown }

/** The project a State's ledger was last loaded for: one State lives through every session.start, and the session may have moved. */
const loadedFor = new WeakMap<State, string>()
/** Offered missions that came from this project's own key: written back to it until adopted, so the offer outlives a save (#4254). */
const heldOffers = new WeakMap<State, Map<string, MissionRecord>>()

const held = (state: State): Map<string, MissionRecord> => {
  let found = heldOffers.get(state)

  if (found === undefined) {
    found = new Map()
    heldOffers.set(state, found)
  }

  return found
}

/** The 20 missions the next save keeps, newest last. */
const keptMissions = (missions: Map<string, MissionRecord>): MissionRecord[] => [...missions.values()].slice(-20)

/** Saves this project's ledger. The ids of the missions it saved, or null when the store refused the write: nothing is pruned on null. */
const writeLedger = (state: State, host: Host): Promise<string[] | null> => {
  const mc = mcOf(state)
  const missions = keptMissions(mc.missions)
  const offered = [...held(state).values()].filter(m => !mc.missions.has(m.id)).slice(-20)
  const dismissed = [...mc.legacyDismissed].slice(-100)
  const saved = { active: mc.active, missions, ...(offered.length > 0 && { offered }), ...(dismissed.length > 0 && { legacyDismissed: dismissed }) }

  return host.storeSet(ledgerKeyOf(state.cwd), saved).then(() => missions.map(m => m.id), () => null)
}

export function saveLedger(state: State, host: Host): void {
  void writeLedger(state, host)
}

/** A saved mission, or null when it is not shaped like one. Auto-run never survives a restart: a new session starts by asking. */
function missionOf(raw: unknown): MissionRecord | null {
  const m = raw as MissionRecord
  const isShaped = Array.isArray(m?.tasks) && m.tasks.every(task => typeof task?.id === 'string' && Array.isArray(task.dependsOn)) && Array.isArray(m.events)

  if (typeof m?.id !== 'string' || !/^msn_[a-f0-9]{24}$/.test(m.id) || !isShaped) return null

  return { ...m, auto: false, ...(Array.isArray(m.adrs) && { adrs: m.adrs.filter(file => typeof file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.md$/.test(file)).slice(0, 8) }) }
}

const savedMissions = (saved: unknown, field: 'missions' | 'offered' = 'missions'): MissionRecord[] => {
  const missions = (saved as SavedLedger | undefined)?.[field]

  return Array.isArray(missions) ? missions.slice(0, 20).flatMap(raw => missionOf(raw) ?? []) : []
}

const dismissedIds = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && /^msn_[a-f0-9]{24}$/.test(id)).slice(-100) : [])

/** Takes missions out of the old shared ledger once a project holds them. The host store has no delete, so an emptied ledger is left as `{ missions: [] }`. */
async function pruneShared(host: Host, ids: readonly string[]): Promise<void> {
  const saved = (await host.storeGet(LEDGER_KEY).catch(() => undefined)) as SavedLedger | undefined

  if (!Array.isArray(saved?.missions)) return

  const drop = new Set(ids)
  const left = saved.missions.filter(raw => !drop.has(String((raw as { id?: unknown } | null)?.id)))

  // Its `active` goes too: it was whichever project wrote last, and no project reads it (#4237).
  if (left.length < saved.missions.length) await host.storeSet(LEDGER_KEY, { missions: left }).catch(() => undefined)
}

/**
 * This project's missions, from its own key. The old machine-wide ledger (#4237) is read as well: a mission recorded for this project is
 * taken in and removed from it, and one that names no project is only offered (`mc.legacy`), because nothing says which project it was
 * made in (#4254). A copy of one that 0.44.3 wrote into this project's own key is offered the same way, and kept in that key until adopted.
 */
export async function loadLedger(state: State, host: Host): Promise<void> {
  const cwd = state.cwd
  const mc = mcOf(state)

  if (loadedFor.get(state) !== cwd) {
    mc.missions.clear()
    mc.active = null
    mc.legacy = []
    mc.legacyDismissed = new Set()
    held(state).clear()
    // A goal planned in the last project must not be created in this one.
    if (loadedFor.has(state)) Object.assign(mc, { goal: '', planned: null, guidance: null, screen: null })
    loadedFor.set(state, cwd)
  }

  const key = ledgerKeyOf(cwd)
  const own = (await host.storeGet(key).catch(() => undefined)) as SavedLedger | undefined
  const shared = key === LEDGER_KEY ? [] : savedMissions(await host.storeGet(LEDGER_KEY).catch(() => undefined))

  // The session moved to another project while the store was read: that load is the one that counts.
  if (state.cwd !== cwd) return

  // With no project directory the old key is this ledger, and a mission with no project is its own.
  const isOurs = (m: MissionRecord) => m.cwd === cwd || (key === LEDGER_KEY && m.cwd === undefined)
  const offered = new Map<string, MissionRecord>()
  const claimed: string[] = []

  for (const m of [...savedMissions(own), ...savedMissions(own, 'offered')]) {
    if (isOurs(m)) mc.missions.set(m.id, m)
    else if (m.cwd === undefined && !mc.missions.has(m.id)) {
      offered.set(m.id, m)
      held(state).set(m.id, m)
    }
  }

  for (const m of shared) {
    if (isOurs(m)) {
      if (!mc.missions.has(m.id)) mc.missions.set(m.id, m)
      claimed.push(m.id)
    } else if (m.cwd === undefined && !mc.missions.has(m.id)) offered.set(m.id, m)
  }

  // 0.44.4 before review saved one `true` for the whole offer: it covered every mission offered then.
  for (const id of own?.legacyDismissed === true ? offered.keys() : dismissedIds(own?.legacyDismissed)) mc.legacyDismissed.add(id)
  mc.legacy = [...offered.values()].filter(m => !mc.legacyDismissed.has(m.id))

  const active = own?.active

  if (typeof active === 'string' && mc.missions.has(active)) mc.active = active

  // Written here before it leaves the shared ledger, and pruned only for what the write kept, so a mission is never in neither.
  if (claimed.length > 0) {
    const saved = await writeLedger(state, host)

    if (saved !== null) await pruneShared(host, claimed.filter(id => saved.includes(id)))
  }
}

/** `full`: the mission is older than the 20 this project keeps, so adopting it would drop it. `failed`: the store refused the write. */
export type AdoptResult = 'adopted' | 'none' | 'full' | 'failed'

/**
 * The person's yes for one offered mission: it joins this project's ledger, recorded under its directory, and leaves the shared one
 * (#4254). One at a time, because an offer can mix missions from several projects and nothing records which.
 */
export async function adoptLegacy(state: State, host: Host, id: string): Promise<AdoptResult> {
  const mc = mcOf(state)
  const offer = mc.legacy.find(m => m.id === id)

  if (offer === undefined) return 'none'

  const before = mc.missions
  // Oldest first, as they were made: the save keeps the newest 20.
  const next = new Map([...before.values(), { ...offer, ...(state.cwd !== '' && { cwd: state.cwd }) }].sort((a, b) => a.createdAtMs - b.createdAtMs).map(m => [m.id, m]))

  if (!keptMissions(next).some(m => m.id === id)) return 'full'

  mc.missions = next
  const saved = await writeLedger(state, host)

  if (saved === null) {
    mc.missions = before
    return 'failed'
  }

  mc.legacy = mc.legacy.filter(m => m.id !== id)
  held(state).delete(id)
  await pruneShared(host, [id])

  return 'adopted'
}

/** The person's no, for one offered mission or (no id) all of them: not offered in this project again. They stay where they were for the project they were made in. */
export function dismissLegacy(state: State, host: Host, id?: string): void {
  const mc = mcOf(state)

  for (const m of mc.legacy) if (id === undefined || m.id === id) mc.legacyDismissed.add(m.id)
  mc.legacy = mc.legacy.filter(m => !mc.legacyDismissed.has(m.id))
  saveLedger(state, host)
}
