/**
 * One standalone console session (ADR-489): the mod's own state and controller over the Node host, with the mod's own page bodies
 * (`BODIES`, the same functions `paneView` calls) drawn by `standalonePane` into terminal lines. This is the "same code path": no view is
 * forked; only the Host, the Kit and the pane around the body differ (Claude Code's tab bar, footer and Launch section are not drawn here).
 */
import { createController, type Controller } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'
import { BODIES } from '../hooks/views/pane'
import { standalonePane } from '../hooks/views/standalone-pane'
import { render, terminalKit, type Depth } from './ansi'
import { aiConfigOf, openAi, type Ai, type AiOptions as AiPageOptions } from './ai'
import { aiFrame } from './ai-page'
import { allowedHostsOf } from './ai-guard'
import { createNodeHost, resolveCodex, type NodeHostOptions } from './node-host'

/**
 * The pages the standalone shell opens: Overview and Cost, then Swarm, Events and Missions (ADR-489 decision C). Room is left out on purpose:
 * its content is what people said to Claude in a session and a message box, neither of which this host has, so it could only draw empty cards.
 */
export const TUI_VIEWS = ['overview', 'cost', 'swarm', 'events', 'missions', 'ai'] as const
export type TuiView = (typeof TUI_VIEWS)[number]
/** The pages that are the console's own views. `ai` is the terminal's own page (ADR-489 phase 3): ask Codex or OpenRouter. */
export type ConsoleView = Exclude<TuiView, 'ai'>

/** What the AI page may do. Absent: the page says it is off and the host refuses every spawn, send and key read (phase 2). */
export type SessionOptions = Omit<NodeHostOptions, 'ai'> & {
  aiPage?: AiPageOptions & { codexBin?: string; fetch?: typeof fetch }
}

export type AiStatus = { codex: string; openrouter: string }

export type Session = {
  state: State
  controller: Controller
  host: Host
  /** The terminal's own AI page (null: off). */
  ai: Ai | null
  aiStatus: AiStatus
  /** True when the last AI frame had the whole question card on screen: only then may a y answer it. */
  cardFits: boolean
  /** The page now showing. */
  page: TuiView
  /** Reads the disk again and runs the page's read-only probes, then returns. Never throws. */
  refresh: () => Promise<void>
  show: (view: TuiView) => void
  /** The page as terminal lines, `columns` wide. `rows` is how many the terminal has for it (the AI page fits its conversation to them). */
  frame: (columns: number, depth: Depth, rows?: number) => string[]
  /** Something changed that the screen should show (streamed output): the shell redraws. */
  onChange: (fn: () => void) => void
  stop: () => void
}

export function openSession(options: SessionOptions, host?: Host): Session {
  let listener: (() => void) | null = null
  const page = options.aiPage
  const aiConfig = page === undefined ? null : aiConfigOf(page).config
  const endpoints = aiConfig === null ? [] : aiConfig.endpoints.length > 0 ? aiConfig.endpoints : []
  const hostOptions: NodeHostOptions = {
    ...options,
    onInvalidate: () => listener?.(),
    ...(page !== undefined && aiConfig !== null && {
      ai: {
        ...(page.codexBin !== undefined && { codexBin: page.codexBin }),
        ...(page.fetch !== undefined && { fetch: page.fetch }),
        ...(page.allowWrite === true && { allowWrite: true }),
        allowedHosts: allowedHostsOf([...endpoints.map(endpoint => endpoint.baseUrl), 'https://openrouter.ai/api/v1']),
        keyEnvs: [...new Set([...endpoints.map(endpoint => endpoint.keyEnv), 'OPENROUTER_API_KEY'].filter(name => name !== 'NONE'))],
      },
    }),
  }
  const node = host ?? createNodeHost(hostOptions)
  const state = newState({ look: 'plain', fps: 0, boot: false, panel: 'off', eventsPersist: false } as never)

  state.cwd = options.cwd
  state.isInteractive = true
  state.isStandalone = true
  // The controller draws and probes only for a pane that is open and shown; here the whole terminal is that pane.
  state.pane.isOpen = true
  state.pane.isShown = true
  state.pane.isFocused = true
  state.pane.bootAtMs = 0

  const controller = createController(state, node)
  const ai = page === undefined ? null : openAi(state, node, page)
  const aiStatus: AiStatus = { codex: ai === null ? 'off' : 'checking…', openrouter: ai === null ? 'off' : 'checking…' }
  let current: TuiView = 'overview'
  let cardFits = false

  const ready = Promise.all([node.home().then(home => void (state.home = home ?? null), () => undefined), node.configDir().then(dir => void (state.configDir = dir ?? null), () => undefined)])

  return {
    state,
    controller,
    host: node,
    ai,
    aiStatus,
    get cardFits() {
      return cardFits
    },
    get page() {
      return current
    },
    refresh: async () => {
      try {
        await ready
        await controller.refresh()
        await controller.probe(false)
      } catch {
        // A read that fails is a page that says n/a, never a crashed terminal.
      }

      if (ai !== null) {
        const home = (await node.home()) ?? ''
        const found = await resolveCodex(home, page?.codexBin).catch(() => ({ ok: false as const, why: 'could not check' }))

        aiStatus.codex = found.ok ? 'ready: the pinned release, read-only' : found.why
        aiStatus.openrouter = ai.keyEnvs.some(name => (process.env[name] ?? '') !== '') ? `ready (${ai.keyEnvs.filter(name => (process.env[name] ?? '') !== '').join(', ')} is set)` : `not ready: $${ai.keyEnvs[0] ?? 'OPENROUTER_API_KEY'} is not set`
      }
    },
    show: view => {
      current = view

      if (view !== 'ai') {
        state.view = view
        state.back = view
      }
    },
    frame: (columns, depth, rows = 30) => {
      state.pane.columns = columns

      if (current === 'ai') {
        const drawn = aiFrame(state, ai, aiStatus, columns, depth, rows)

        cardFits = drawn.fits

        return drawn.lines
      }

      const tree = standalonePane({ kit: terminalKit(), state, nowMs: Date.now(), columns, pictures: new Map(), act: controller.actions }, BODIES[state.view])

      return render(tree, columns, depth)
    },
    onChange: fn => void (listener = fn),
    stop: () => controller.stop(),
  }
}
