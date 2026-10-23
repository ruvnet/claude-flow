/**
 * The Workflows page's saved views, live (ADR-461): reads `.claude-flow/console/wf-views.json` once per project, puts the
 * cursor back where it was when the runs have been read, and writes the file again when the cursor, a pin, a filter or the search
 * changed (at most once every SAVE_GAP_MS, one write at a time). The data rules are in data/wf-saved.ts; this holds the one
 * copy per project and the reads and writes, with the host's `fs` and `run` passed in so a test supplies its own.
 *
 * The write is the console's own state file: a fixed-argv `dd` or `install -D` (no shell; the text is stdin), about 1 kB, only under
 * `.claude-flow/console/` of the project, and the page says where the file is. Forgetting it goes through the confirm card.
 */
import type { ActionSpec } from './actions'
import { decodeSaved, emptySaved, encodeSaved, captureDrill, restoreDrill, sameDrill, SAVED_FILE, SAVED_MAX_BYTES, type Saved } from './data/wf-saved'
import { cleanText } from './data/wf-clean'
import { checkNoLinks, dirOf, removeFileArgv } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import { writeVia } from './data/write-via'
import { readBounded } from './data/files'
import type { Host } from './host'
import type { State } from './state'
import { workflowsModelOf } from './wf-live'
import { DETAIL_TAB, slotsFor } from './views/wf-slots'

export const SAVE_GAP_MS = 2000

export type SavedHost = Pick<Host, 'fs' | 'run'>

export type HeldSaved = {
  saved: Saved
  problem: string | null
  isForeign: boolean
  isLoaded: boolean
  isRestored: boolean
  isDirty: boolean
  /** Off after the file was forgotten: the cursor is not saved again until something is pinned or set. */
  isAuto: boolean
  isWriting: boolean
  lastWriteMs: number
  /** Why the last write failed, or null. */
  error: string | null
  /** How the cursor was found when it was put back, for the page to say. */
  restored: 'exact' | 'name' | 'gone' | null
  /** The last thing a pin or forget did, in words. */
  said: string | null
}

const held = new Map<string, HeldSaved>()

const fresh = (): HeldSaved => ({ saved: emptySaved(), problem: null, isForeign: false, isLoaded: false, isRestored: false, isDirty: false, isAuto: true, isWriting: false, lastWriteMs: 0, error: null, restored: null, said: null })

export const savedFor = (cwd: string): HeldSaved => {
  const own = held.get(cwd) ?? fresh()

  held.set(cwd, own)

  return own
}

export const savedPathOf = (cwd: string): string => `${cwd.replace(/\/+$/, '')}/${SAVED_FILE}`

/** Changes the held views (a pin, a filter, the search) and marks them to be written. A file from a newer console is never changed. */
export function updateSaved(cwd: string, change: (saved: Saved) => Saved, said?: string): void {
  const own = savedFor(cwd)

  if (own.isForeign) return

  own.saved = change(own.saved)
  own.isDirty = true
  own.isAuto = true
  if (said !== undefined) own.said = said
}

/** For tests: forgets everything held. */
export const resetSavedLive = (): void => held.clear()

async function load(state: State, host: SavedHost, own: HeldSaved): Promise<void> {
  own.isLoaded = true

  const read = await readBounded(host.fs, state.cache, savedPathOf(state.cwd), SAVED_MAX_BYTES, true)

  if (read.text === null && read.reason === 'too-large') {
    own.problem = `the saved views file is over ${SAVED_MAX_BYTES / 1000} kB, so it is not read and will be replaced on the next change`
    return
  }

  const decoded = decodeSaved(read.text)

  own.saved = decoded.saved
  own.problem = decoded.problem
  own.isForeign = decoded.isForeign
}

/**
 * One pass, called while the Workflows page is the one in front, after its read: loads the file the first time, puts the cursor back
 * once there are runs to put it on, notes a cursor that moved, and writes when something changed. Never throws.
 */
export async function syncSavedViews(state: State, host: SavedHost, nowMs: number = Date.now()): Promise<void> {
  try {
    const own = savedFor(state.cwd)

    if (!own.isLoaded) await load(state, host, own)

    const runs = workflowsModelOf(state, nowMs)?.runs ?? []

    if (runs.length === 0) return

    if (!own.isRestored) {
      own.isRestored = true

      const back = restoreDrill(own.saved.drill, runs, state.wf.ui)

      if (back !== null) {
        own.restored = back.found
        if (back.found !== 'gone') {
          state.wf.ui = back.ui
          state.wf.tab = back.tab === DETAIL_TAB || slotsFor('tab').some(slot => slot.id === back.tab) ? back.tab : DETAIL_TAB
        }
      }

      return
    }

    const drill = captureDrill(state.wf.ui, runs, state.wf.tab)

    if (own.isAuto && !own.isForeign && !sameDrill(drill, own.saved.drill)) {
      own.saved = { ...own.saved, drill }
      own.isDirty = true
    }

    if (!own.isDirty || own.isForeign || own.isWriting || nowMs - own.lastWriteMs < SAVE_GAP_MS) return

    own.isWriting = true
    own.lastWriteMs = nowMs

    try {
      const path = savedPathOf(state.cwd)
      // dd follows a link: a `.claude-flow` folder or a wf-views.json that is one (a repository can ship either) would send this write to any file the person can write. Refused, and said.
      const clear = await checkNoLinks(host.fs, path, { cwd: state.cwd }, { allowExisting: true })

      if (!clear.ok) {
        own.error = cleanText(clear.why).slice(0, 80)

        return
      }

      const hasDir = (await host.fs.stat(dirOf(path)).catch(() => undefined)) !== undefined
      const result = await writeVia(await writeFlavorReady(), host, { kind: 'replace', path, text: encodeSaved(own.saved, nowMs), hasDir })

      own.error = result.exitCode === 0 ? null : `the write exited ${result.exitCode}`
      if (result.exitCode === 0) own.isDirty = false
    } catch (error) {
      own.error = error instanceof Error ? cleanText(error.message).slice(0, 80) : 'the write was refused'
    } finally {
      own.isWriting = false
    }
  } catch {
    // Saved views are a convenience: a failure here must never reach the page.
  }
}

/** The confirm-gated removal of the saved views file; once it ran the held copy is emptied and the cursor is not saved again until a pin or filter is set. */
export function forgetSpec(cwd: string): ActionSpec {
  const path = savedPathOf(cwd)

  return {
    label: 'forget saved Workflows views',
    args: [],
    argv: removeFileArgv(path),
    expect: `${path} removed`,
    declared: 'delete',
    shows: `rm -f -- ${path}`,
    note: 'deletes the console\'s own saved cursor, filters and pins for this project; runs and their files are not touched',
    timeoutMs: 10_000,
    onOutput: () => {
      const own = savedFor(cwd)

      own.saved = emptySaved()
      own.isDirty = false
      own.isAuto = false
      own.problem = null
      own.restored = null
      own.said = 'saved views forgotten'
    },
    verifyLocal: async host => (await host.fs.stat(path).catch(() => undefined)) === undefined,
  }
}
