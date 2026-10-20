/** What the controller reads back from host storage when the pane opens: theme, AI terminal prefs, remembered answers and the mission ledger. */
import type { Host } from './host'
import { loadLedger } from './mission-control'
import { loadAllowed } from './remember'
import { loadAiPrefs } from './settings'
import type { State } from './state'
import { loadThemes } from './themes'

export function loadSaved(state: State, host: Host): void {
  void loadThemes(state, host)
  void loadAiPrefs(state, host)
  void loadAllowed(state, host)
  void loadLedger(state, host)
}
