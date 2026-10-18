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
    found = { goal: '', profile: 'feature', rigor: 'standard', isProfilePicked: false, planned: null, missions: new Map(), active: null, legacy: [], isLegacyDismissed: false, tab: 'plan', lastGuide: '', guidance: null, screen: null, isScreenOn: true, last: null }
    states.set(state, found)
  }

  return found
}

type SavedLedger = { active?: unknown; missions?: unknown; legacyDismissed?: unknown }

/** The project a State's ledger was last loaded for: one State lives through every session.start, and the session may have moved. */
const loadedFor = new WeakMap<State, string>()

const writeLedger = (state: State, host: Host): Promise<void> => {
  const mc = mcOf(state)

  return host.storeSet(ledgerKeyOf(state.cwd), { active: mc.active, missions: [...mc.missions.values()].slice(-20), ...(mc.isLegacyDismissed && { legacyDismissed: true }) }).catch(() => undefined)
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

const savedMissions = (saved: unknown): MissionRecord[] => {
  const missions = (saved as SavedLedger | undefined)?.missions

  return Array.isArray(missions) ? missions.slice(0, 20).flatMap(raw => missionOf(raw) ?? []) : []
}

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
 * made in (#4254). A copy of one that 0.44.3 wrote into this project's own key is offered the same way.
 */
export async function loadLedger(state: State, host: Host): Promise<void> {
  const cwd = state.cwd
  const mc = mcOf(state)

  if (loadedFor.get(state) !== cwd) {
    mc.missions.clear()
    mc.active = null
    mc.legacy = []
    mc.isLegacyDismissed = false
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

  for (const m of savedMissions(own)) {
    if (isOurs(m)) mc.missions.set(m.id, m)
    else if (m.cwd === undefined) offered.set(m.id, m)
  }

  for (const m of shared) {
    if (isOurs(m)) {
      if (!mc.missions.has(m.id)) mc.missions.set(m.id, m)
      claimed.push(m.id)
    } else if (m.cwd === undefined && !mc.missions.has(m.id)) offered.set(m.id, m)
  }

  if (own?.legacyDismissed === true) mc.isLegacyDismissed = true
  mc.legacy = mc.isLegacyDismissed ? [] : [...offered.values()]

  const active = own?.active

  if (typeof active === 'string' && mc.missions.has(active)) mc.active = active

  // Written here before it leaves the shared ledger, so a mission is never in neither.
  if (claimed.length > 0) {
    await writeLedger(state, host)
    await pruneShared(host, claimed)
  }
}

/** The person's yes to the offer: the missions join this project's ledger, recorded under its directory, and leave the shared one (#4254). */
export async function adoptLegacy(state: State, host: Host): Promise<number> {
  const mc = mcOf(state)
  const taken = mc.legacy.map(m => ({ ...m, ...(state.cwd !== '' && { cwd: state.cwd }) }))

  if (taken.length === 0) return 0

  // Oldest first, as they were made: the save keeps the newest 20.
  mc.missions = new Map([...mc.missions.values(), ...taken].sort((a, b) => a.createdAtMs - b.createdAtMs).map(m => [m.id, m]))
  mc.legacy = []
  await writeLedger(state, host)
  await pruneShared(host, taken.map(m => m.id))

  return taken.length
}

/** The person's no: not offered in this project again. The missions stay in the shared ledger for the project they were made in. */
export function dismissLegacy(state: State, host: Host): void {
  const mc = mcOf(state)

  mc.legacy = []
  mc.isLegacyDismissed = true
  saveLedger(state, host)
}
