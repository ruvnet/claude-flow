/** What the controller reads back from host storage when the pane opens: theme, AI terminal prefs, remembered answers and the mission ledger. */
import type { Host } from './host'
import { loadLedger } from './mission-control'
import { loadAllowed } from './remember'
import { loadAiPrefs } from './settings'
import type { State } from './state'
import { loadThemes } from './themes'
import { prefsFromStore, saveToastPrefs, TOASTS_KEY } from './toasts'
import { runUpdateCheck } from './update-flow'
import { parseMode, RECHECK_EVERY_MS, UPDATES_KEY } from './updates'
import { hydrateWhatsNew } from './whatsnew'

export function loadSaved(state: State, host: Host): void {
  void loadThemes(state, host)
  void loadAiPrefs(state, host)
  void loadAllowed(state, host)
  void loadLedger(state, host)
}

/**
 * What a session reads from the plugin's store when it starts, and the one update check that follows (moved out of register.ts, which the
 * console smoke holds to 500 lines). Never throws and never blocks the console. `built` settles once the build is known.
 */
export function loadAtStart(state: State, here: Host, built: Promise<unknown>): void {
  // The update mode is the person's, kept in the plugin's store; then, once the build is known (a development checkout is never offered
  // an update) and the screen has settled, one check for a newer published version. It never throws and never blocks the console.
  const moded = here.storeGet(UPDATES_KEY).then(
    value => {
      state.updates = parseMode(value)
      here.invalidate()
    },
    () => undefined,
  )

  // The Toasts setting is the person's, kept in the plugin's store and mirrored to a file the other plugins read (ADR-477).
  const toasted = here.storeGet(TOASTS_KEY).then(
    value => {
      state.toastPrefs = prefsFromStore(value)
      if (state.toastPrefs.mode !== 'all' || state.toastPrefs.muted.length > 0) void saveToastPrefs(state, here)
    },
    () => undefined,
  )

  // What's new (ADR-478): the record of what was looked at, read once; the controller's first disk read then takes the baseline.
  const looked = hydrateWhatsNew(state, here).catch(() => undefined)

  void toasted
  void looked
  void Promise.all([built, moded]).then(() => {
    if (!state.isInteractive) return

    here.after(2_500, () => void runUpdateCheck(state, here))
    // A session left open for days re-asks too, quietly (no dialog mid-work); the daily gate keeps the network to once a day.
    state.timers.set('update-recheck', here.every(RECHECK_EVERY_MS, () => void runUpdateCheck(state, here, { quiet: true })))
  })
}
