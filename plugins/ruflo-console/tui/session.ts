/**
 * One standalone console session (ADR-489): the mod's own state and controller over the Node host, drawn by the mod's own
 * `paneView` into terminal lines. This is the "same code path": nothing below `paneView` is forked; only the Host and the Kit differ.
 */
import { createController, type Controller } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState, type State, type ViewId } from '../hooks/state'
import { paneView } from '../hooks/views/pane'
import { render, terminalKit, type Depth } from './ansi'
import { createNodeHost, type NodeHostOptions } from './node-host'

/** The pages the standalone shell opens in this phase: the rest need the Claude Code host's panes, prompt or dialogs. */
export const TUI_VIEWS = ['overview', 'cost'] as const satisfies readonly ViewId[]
export type TuiView = (typeof TUI_VIEWS)[number]

export type Session = {
  state: State
  controller: Controller
  host: Host
  /** Reads the disk again and runs the page's read-only probes, then returns. Never throws. */
  refresh: () => Promise<void>
  show: (view: TuiView) => void
  /** The page as terminal lines, `columns` wide. */
  frame: (columns: number, depth: Depth) => string[]
  stop: () => void
}

export function openSession(options: NodeHostOptions, host: Host = createNodeHost(options)): Session {
  const state = newState({ look: 'plain', fps: 0, boot: false, panel: 'off', eventsPersist: false } as never)

  state.cwd = options.cwd
  state.isInteractive = true
  // The controller draws and probes only for a pane that is open and shown; here the whole terminal is that pane.
  state.pane.isOpen = true
  state.pane.isShown = true
  state.pane.isFocused = true
  state.pane.bootAtMs = 0

  const controller = createController(state, host)

  const ready = Promise.all([host.home().then(home => void (state.home = home ?? null), () => undefined), host.configDir().then(dir => void (state.configDir = dir ?? null), () => undefined)])

  return {
    state,
    controller,
    host,
    refresh: async () => {
      try {
        await ready
        await controller.refresh()
        await controller.probe(false)
      } catch {
        // A read that fails is a page that says n/a, never a crashed terminal.
      }
    },
    show: view => {
      state.view = view
      state.back = view
    },
    frame: (columns, depth) => {
      state.pane.columns = columns
      const tree = paneView({ kit: terminalKit(), state, nowMs: Date.now(), columns, pictures: new Map(), act: controller.actions })

      return render(tree, columns, depth)
    },
    stop: () => controller.stop(),
  }
}
