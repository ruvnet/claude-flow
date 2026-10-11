/**
 * One standalone console session (ADR-489): the mod's own state and controller over the Node host, with the mod's own page bodies
 * (`BODIES`, the same functions `paneView` calls) drawn by `standalonePane` into terminal lines. This is the "same code path": no view is
 * forked; only the Host, the Kit and the pane around the body differ (Claude Code's tab bar, footer and Launch section are not drawn here).
 */
import { createController, type Controller } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState, type State, type ViewId } from '../hooks/state'
import { BODIES } from '../hooks/views/pane'
import { standalonePane } from '../hooks/views/standalone-pane'
import { render, terminalKit, type Depth } from './ansi'
import { createNodeHost, type NodeHostOptions } from './node-host'

/**
 * The pages the standalone shell opens: Overview and Cost, then Swarm, Events and Missions (ADR-489 decision C). Room is left out on purpose:
 * its content is what people said to Claude in a session and a message box, neither of which this host has, so it could only draw empty cards.
 */
export const TUI_VIEWS = ['overview', 'cost', 'swarm', 'events', 'missions'] as const satisfies readonly ViewId[]
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
  state.isStandalone = true
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
      const tree = standalonePane({ kit: terminalKit(), state, nowMs: Date.now(), columns, pictures: new Map(), act: controller.actions }, BODIES[state.view])

      return render(tree, columns, depth)
    },
    stop: () => controller.stop(),
  }
}
