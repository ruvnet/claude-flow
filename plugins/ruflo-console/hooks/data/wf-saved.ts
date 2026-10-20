/**
 * What the Workflows page remembers across restarts (ADR-461): where the cursor was (by run, phase and agent NAME, not by index,
 * so a new run in the list does not move it), the filters and the search a feature set, and the runs the person pinned.
 * Lives in one small file, `.claude-flow/console/wf-views.json`, schema-versioned. Pure: `decodeSaved` never throws and never
 * trusts the file (a corrupt or hand-edited one comes back as defaults with the problem named, and a file from a NEWER version is
 * left alone: `isForeign`), every string is cleaned and masked on the way in and the way out, and every list is capped.
 */
import { cleanText } from './wf-clean'
import type { WfUi } from './workflows-nav'
import type { WfRun } from './workflows'

export const SAVED_VERSION = 1
export const SAVED_FILE = '.claude-flow/console/wf-views.json'
/** A saved file over this is not read (and the page says so): it holds a cursor, a few filters and 20 pins, so it never gets near. */
export const SAVED_MAX_BYTES = 64_000
export const MAX_PINS = 20
export const MAX_FILTERS = 8
const TEXT_MAX = 80

export type Drill = { runId?: string; runName?: string; phase?: string; agent?: string; column: 'phases' | 'agents'; isInspecting: boolean; tab: string }
export type Pin = { runId: string; name: string; pinnedAtMs: number }
export type Saved = { version: number; savedAtMs: number; drill: Drill | null; filters: Record<string, string>; search: string; pins: Pin[] }

export const emptySaved = (): Saved => ({ version: SAVED_VERSION, savedAtMs: 0, drill: null, filters: {}, search: '', pins: [] })

const RUN_ID = /^[A-Za-z0-9_-]{1,60}$/
const KEY = /^[a-z][a-z0-9-]{0,23}$/
const TAB = /^[a-z][a-z0-9-]{1,31}$/

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const word = (value: unknown, max = TEXT_MAX): string | undefined => {
  const clean = typeof value === 'string' ? cleanText(value).trim().slice(0, max) : ''

  return clean === '' ? undefined : clean
}

export type Decoded = { saved: Saved; /** Why the file was not used whole, or null. */ problem: string | null; /** A file from a newer console: read as defaults, never written over. */ isForeign: boolean }

export function decodeSaved(text: string | null): Decoded {
  if (text === null) return { saved: emptySaved(), problem: null, isForeign: false }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return { saved: emptySaved(), problem: 'the saved views file is not valid JSON, so it is ignored and will be replaced on the next change', isForeign: false }
  }

  const root = asRecord(parsed)

  if (root === null) return { saved: emptySaved(), problem: 'the saved views file is not an object, so it is ignored and will be replaced on the next change', isForeign: false }
  if (root.version !== SAVED_VERSION) return { saved: emptySaved(), problem: typeof root.version === 'number' && root.version > SAVED_VERSION ? `the saved views file is from a newer console (version ${root.version}): left alone, nothing is read from it or written to it` : 'the saved views file has an unknown version, so it is ignored and will be replaced on the next change', isForeign: typeof root.version === 'number' && root.version > SAVED_VERSION }

  const drillRaw = asRecord(root.drill)
  const runId = typeof drillRaw?.runId === 'string' && RUN_ID.test(drillRaw.runId) ? drillRaw.runId : undefined
  const runName = word(drillRaw?.runName)
  const phase = word(drillRaw?.phase)
  const agent = word(drillRaw?.agent)
  const tab = typeof drillRaw?.tab === 'string' && TAB.test(drillRaw.tab) ? drillRaw.tab : 'detail'
  const drill: Drill | null = drillRaw === null || (runId === undefined && runName === undefined) ? null : { column: drillRaw.column === 'agents' ? 'agents' : 'phases', isInspecting: drillRaw.isInspecting === true, tab, ...(runId !== undefined && { runId }), ...(runName !== undefined && { runName }), ...(phase !== undefined && { phase }), ...(agent !== undefined && { agent }) }
  const filters: Record<string, string> = {}

  for (const [key, value] of Object.entries(asRecord(root.filters) ?? {}).slice(0, MAX_FILTERS)) {
    const clean = word(value)

    if (KEY.test(key) && clean !== undefined) filters[key] = clean
  }

  const pins: Pin[] = []

  for (const entry of (Array.isArray(root.pins) ? root.pins : []).slice(0, MAX_PINS * 2)) {
    const pin = asRecord(entry)
    const id = typeof pin?.runId === 'string' && RUN_ID.test(pin.runId) ? pin.runId : undefined
    const name = word(pin?.name)

    if (id !== undefined && name !== undefined && !pins.some(held => held.runId === id) && pins.length < MAX_PINS) pins.push({ runId: id, name, pinnedAtMs: typeof pin?.pinnedAtMs === 'number' && Number.isFinite(pin.pinnedAtMs) && pin.pinnedAtMs >= 0 ? pin.pinnedAtMs : 0 })
  }

  return { saved: { version: SAVED_VERSION, savedAtMs: typeof root.savedAtMs === 'number' && Number.isFinite(root.savedAtMs) ? root.savedAtMs : 0, drill, filters, search: word(root.search) ?? '', pins }, problem: null, isForeign: false }
}

/** The file's text: what `decodeSaved` would accept, built from the (already clean) held value, passed through the decoder's own rules once more. */
export function encodeSaved(saved: Saved, nowMs: number): string {
  const { saved: clean } = decodeSaved(JSON.stringify({ ...saved, version: SAVED_VERSION }))

  return `${JSON.stringify({ ...clean, savedAtMs: nowMs }, null, 1)}\n`
}

export const sameDrill = (a: Drill | null, b: Drill | null): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Where the cursor is, by names. Null where there is no run to stand on. */
export function captureDrill(ui: WfUi, runs: readonly WfRun[], tab: string): Drill | null {
  const run = runs[Math.max(0, Math.min(runs.length - 1, ui.run))]

  if (run === undefined) return null

  const phase = run.phases[Math.max(0, Math.min(run.phases.length - 1, ui.phase))]
  const agent = phase?.agents[Math.max(0, Math.min(phase.agents.length - 1, ui.agent))]
  const id = RUN_ID.test(run.id) ? run.id : undefined
  const name = word(run.name)
  const title = word(phase?.title)
  const label = word(agent?.label)

  return { column: ui.column, isInspecting: ui.isInspecting && agent !== undefined, tab: TAB.test(tab) ? tab : 'detail', ...(id !== undefined && { runId: id }), ...(name !== undefined && { runName: name }), ...(title !== undefined && { phase: title }), ...(label !== undefined && { agent: label }) }
}

export type Restored = { ui: WfUi; tab: string; /** `exact` found the run by id; `name` the newest run of the same workflow; `gone` neither (the cursor is left where it is). */ found: 'exact' | 'name' | 'gone' }

/** The cursor a saved drill stands for in `runs` (phase and agent by title and label, falling back to the first), or null for nothing to restore. */
export function restoreDrill(drill: Drill | null, runs: readonly WfRun[], at: WfUi): Restored | null {
  if (drill === null) return null

  const byId = drill.runId === undefined ? -1 : runs.findIndex(run => run.id === drill.runId)
  const byName = byId >= 0 || drill.runName === undefined ? -1 : runs.findIndex(run => run.name === drill.runName)
  const index = byId >= 0 ? byId : byName

  if (index < 0) return { ui: at, tab: 'detail', found: 'gone' }

  const run = runs[index] as WfRun
  const phase = Math.max(0, drill.phase === undefined ? 0 : run.phases.findIndex(entry => entry.title === drill.phase))
  const agent = Math.max(0, drill.agent === undefined ? 0 : (run.phases[phase]?.agents.findIndex(entry => entry.label === drill.agent) ?? 0))
  const isInspecting = drill.isInspecting && (run.phases[phase]?.agents.length ?? 0) > 0

  return { ui: { run: index, phase, agent, column: drill.column === 'agents' && (run.phases[phase]?.agents.length ?? 0) > 0 ? 'agents' : 'phases', isInspecting }, tab: isInspecting ? drill.tab : 'detail', found: byId >= 0 ? 'exact' : 'name' }
}

export const isPinned = (saved: Saved, runId: string): boolean => saved.pins.some(pin => pin.runId === runId)

/** Pins the run, or unpins it when it is pinned; a full list refuses a new pin (the oldest is not silently dropped) and says so. */
export function togglePin(saved: Saved, run: WfRun, nowMs: number): { saved: Saved; said: string } {
  if (isPinned(saved, run.id)) return { saved: { ...saved, pins: saved.pins.filter(pin => pin.runId !== run.id) }, said: `unpinned ${word(run.name, 40) ?? run.id}` }
  if (!RUN_ID.test(run.id)) return { saved, said: 'this run has no id that can be saved' }
  if (saved.pins.length >= MAX_PINS) return { saved, said: `${MAX_PINS} runs are pinned already: unpin one first` }

  return { saved: { ...saved, pins: [...saved.pins, { runId: run.id, name: word(run.name) ?? run.id, pinnedAtMs: nowMs }] }, said: `pinned ${word(run.name, 40) ?? run.id}` }
}

/** Each pin with where its run now is in the list (null when the run is no longer among the runs read). */
export const pinsIn = (saved: Saved, runs: readonly WfRun[]): { pin: Pin; index: number | null; run: WfRun | null }[] => saved.pins.map(pin => {
  const index = runs.findIndex(run => run.id === pin.runId)

  return { pin, index: index < 0 ? null : index, run: index < 0 ? null : (runs[index] as WfRun) }
})

/** A filter set to a value, or removed with an empty one; keys and values are held to the file's own rules. */
export function setFilter(saved: Saved, key: string, value: string): Saved {
  if (!KEY.test(key)) return saved

  const { [key]: _gone, ...rest } = saved.filters
  const clean = word(value)

  return clean === undefined ? { ...saved, filters: rest } : Object.keys(rest).length >= MAX_FILTERS ? saved : { ...saved, filters: { ...rest, [key]: clean } }
}

export const setSearch = (saved: Saved, value: string): Saved => ({ ...saved, search: word(value) ?? '' })
