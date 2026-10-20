/**
 * One standalone console session (ADR-489): the mod's own state and controller over the Node host, with the mod's own page bodies
 * (`BODIES`, the same functions `paneView` calls) drawn by `standalonePane` into terminal lines. This is the "same code path": no view is
 * forked; only the Host, the Kit and the pane around the body differ (Claude Code's tab bar, footer and Launch section are not drawn here).
 */
import { createController, type Controller } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState, VIEWS, type Pending, type State, type ViewId } from '../hooks/state'
import { picturesOf } from '../hooks/views/frames'
import { BODIES, NARROW } from '../hooks/views/pane'
import { filterPalette, isUnavailable, paletteEntries } from '../hooks/palette'
import { PARITY } from './parity'
import { standalonePane } from '../hooks/views/standalone-pane'
import { clean, render, terminalKit, type Depth } from './ansi'
import { pinnedLines } from './pinned'
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
/** Any page the shell can show: every console view (ADR-489 phase 5, `parity.ts` says what each does here) and the AI page. */
export type Page = ViewId | 'ai'

/** What the AI page may do. Absent: the page says it is off and the host refuses every spawn, send and key read (phase 2). */
export type Look = 'bbs' | 'orbital' | 'plain'
export const LOOKS: readonly Look[] = ['bbs', 'orbital', 'plain']

export type SessionOptions = Omit<NodeHostOptions, 'ai'> & {
  /** The console's look (settings: look): Classic BBS is the default, as in the console. */
  look?: Look
  /** Frames per second for moving pictures (settings: fps, default 8; 0 draws every picture still). */
  fps?: number
  /** False draws no pictures: the words each picture falls back to. */
  pictures?: boolean
  /** True plays the look's start-up screen for its first seconds (settings: boot), as the console does. Off by default here. */
  boot?: boolean
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
  /** The look now drawn, and a step to the next one (bbs, orbital, plain). */
  look: Look
  cycleLook: () => Look
  /** True when this frame has anything that moves (a picture drawn at fps above 0): the shell redraws on its clock only then. */
  moving: () => boolean
  /** The page now showing. */
  page: Page
  /** The waiting confirm card, if any (the console's own `state.pending`). */
  pending: () => Pending | null
  /** Lines pinned under the page bar: the confirm card, or the last action's result for 20 s. `room` is the rows the terminal has for them and the page. The card counts as shown only when it is drawn whole. */
  pinned: (columns: number, depth: Depth, room: number) => string[]
  /** True when the whole card was on screen in the last frame: only then may a y answer it (#3983). */
  cardShown: () => boolean
  /** The best palette match for `word`, started the console's way: a read runs now, a change raises a card and waits. Returns one line saying what happened. */
  palette: (word: string) => string
  /** y or n on the waiting card. A yes names the card it answers, as on the console. */
  answer: (yes: boolean) => void
  /** Reads the disk again and runs the page's read-only probes, then returns. Never throws. */
  refresh: () => Promise<void>
  show: (view: Page) => void
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
  const state = newState({ look: options.look ?? 'bbs', fps: options.fps ?? 8, boot: options.boot === true, panel: 'off', eventsPersist: false } as never)

  state.cwd = options.cwd
  state.isInteractive = true
  state.isStandalone = true
  // The controller draws and probes only for a pane that is open and shown; here the whole terminal is that pane.
  state.pane.isOpen = true
  state.pane.isShown = true
  state.pane.isFocused = true
  state.pane.bootAtMs = options.boot === true ? Date.now() : 0

  const controller = createController(state, node)
  const ai = page === undefined ? null : openAi(state, node, page)
  const aiStatus: AiStatus = { codex: ai === null ? 'off' : 'checking…', openrouter: ai === null ? 'off' : 'checking…' }
  let current: Page = 'overview'
  let cardFits = false
  let isMoving = false

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
    get look() {
      return state.options.look as Look
    },
    cycleLook: () => {
      const next = LOOKS[(LOOKS.indexOf(state.options.look as Look) + 1) % LOOKS.length] as Look

      state.options.look = next

      return next
    },
    moving: () => isMoving,
    pending: () => state.pending,
    cardShown: () => state.pending !== null && state.shownCard === (state.pending.id ?? null),
    pinned: (columns, depth, room) => pinnedLines(state, columns, depth, room),
    palette: word => {
      const query = word.trim()
      const lower = query.toLowerCase()
      // Not the console's loose letters-in-order match: here a typed word must be IN the entry's name (or its id, or start a text command), so a typo never starts an action.
      const all = paletteEntries(state, Date.now())
      const best = all.find(entry => entry.id.toLowerCase() === lower) ?? filterPalette(all, query, 'all').find(entry => entry.label.toLowerCase().includes(lower) || (entry.run.kind === 'text' && lower.startsWith(`${entry.run.keyword.toLowerCase()} `)))

      if (query === '' || best === undefined) return `no page or action called "${clean(query).slice(0, 30)}"`
      if (best.run.kind !== 'spec' && best.run.kind !== 'text') return `"${clean(best.label).slice(0, 50)}" is a page or a Claude Code command: use its name as a page`
      if (isUnavailable(best)) return `"${clean(best.label).slice(0, 50)}" is not available here`

      state.shownCard = null
      controller.actions.paletteQuery(query)
      controller.actions.paletteRun(best.id)

      return state.pending !== null ? `ask: ${clean(best.label).slice(0, 60)} (read the card, then y or n)` : `ran: ${clean(best.label).slice(0, 60)}`
    },
    answer: yes => {
      const card = state.pending

      if (card === null) return
      if (!yes) return void controller.actions.cancel()
      // A yes runs the card that was drawn whole and read, never one that was not.
      if (state.shownCard === (card.id ?? null) && card.id !== undefined) controller.actions.confirm(card.id)
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
      // A page whose job another page does (the console's AI terminal is this shell's AI page) opens that page.
      current = view === 'ai' ? 'ai' : (PARITY[view]?.opens ?? view)

      if (current !== 'ai') {
        state.view = current
        state.back = current
      }
    },
    frame: (columns, depth, rows = 30) => {
      state.pane.columns = columns
      state.pane.rows = Math.max(0, rows)
      isMoving = false
      // The card was not on screen unless this frame (and the shell's pinned rows) draws it whole.
      if (state.pending === null) state.shownCard = null

      if (current === 'ai') {
        const drawn = aiFrame(state, ai, aiStatus, columns, depth, rows)

        cardFits = drawn.fits

        return drawn.lines
      }

      // A page about a Claude Code session says so in one screen, not as a page of empty cards.
      if (PARITY[current as ViewId]?.status === 'claude-only') {
        const entry = VIEWS.find(view => view.id === current)

        return [`${entry?.label ?? current}: Claude Code only`, '', PARITY[current as ViewId].why, '', 'Open it in the ruflo console inside Claude Code. Press 0 for the main menu, Esc to go back.']
      }

      // Pictures need colour and room: without either the views say in words what the picture shows (the same fallback the console has below NARROW columns).
      const draws = options.pictures !== false && depth !== 'none' && columns >= NARROW
      const now = Date.now()
      const pictures = draws ? picturesOf(state, columns, now, now, false) : new Map()

      isMoving = draws && state.options.fps > 0 && pictures.size > 0

      const tree = standalonePane({ kit: terminalKit({ raster: draws }), state, nowMs: now, columns, pictures, act: controller.actions }, BODIES[state.view])

      return render(tree, columns, depth)
    },
    onChange: fn => void (listener = fn),
    stop: () => controller.stop(),
  }
}
