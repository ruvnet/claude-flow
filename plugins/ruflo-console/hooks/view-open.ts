/**
 * What opening a view reads. Each view's own local, read-only loaders run when it is opened (never on a timer), so a
 * closed or hidden console reads nothing; anything that reaches the network or writes waits for a click.
 */
import { refreshChatAndDraw } from './chat'
import { loadEvolve } from './evolve'
import { refreshWorkflows } from './wf-live'
import type { Host } from './host'
import { loadCatalog } from './plugin-catalog'
import { probeTmux } from './sandbox'
import { loadAiPrefs, loadCore, loadPlugin, settingsOf } from './settings'
import { CLI_PREFIXES, type State } from './state'
import { adrOf, loadAdrs } from './adr'
import { closeWhatsNew, openWhatsNew } from './whatsnew'

import { loadCommandNames } from './mission-skills'

export function openLoaders(state: State, host: Host, view: State['view']): void {
  // What's new reads each plugin's bundled CHANGELOG.md (local files, no network) when it opens, and forgets the divider when it is left.
  if (view === 'whatsnew') void openWhatsNew(state, host)
  else closeWhatsNew(state)

  // ADR-480: the project's ADR folder is read when the page opens (local files only), and again by its reload button.
  if (view === 'adrs' && !adrOf(state).isLoading) void loadAdrs(state, host)

  // Mission Control asks the session which slash commands it offers (the ruflo-goals skills among them).
  // Every section can offer the slash command of the plugin that fits it, so the session's commands are read once.
  if (view === 'missions' || state.commandNames.length === 0) void loadCommandNames(state, host)

  // Chat reads the live conversation once when it opens (in memory only: nothing is written), and not at all while its preview setting is off.
  if (view === 'chat' && state.options.sessionPreview) void refreshChatAndDraw(host, state)

  // Self-Evolution reads ruflo's own flywheel files (local, no CLI run); its checks wait for a click.
  if (view === 'evolve') void loadEvolve(state, host)

  // Workflows reads Claude Code's run folders (local, read-only) when opened, and again on each refresh while it stays open.
  if (view === 'workflows') void refreshWorkflows(state, host, true)

  // The Sandbox page asks whether tmux is here (local, $0): without it the tmux rows say n/a.
  if (view === 'sandbox') void probeTmux(state, host)

  // The catalog is read from the marketplace clone on disk: local, so opening it is enough.
  if (view === 'market') loadCatalog(state, host)

  // Settings reads are local and read-only: the plugin's option schema, ruflo's config values, the saved AI preferences.
  if (view === 'settings') {
    void loadAiPrefs(state, host)
    loadCatalog(state, host)
    void loadPlugin(state, host, settingsOf(state).plugin)
    void loadCore(state, host, CLI_PREFIXES[state.options.cli])
  }
}
