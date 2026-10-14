/**
 * `ruflo tui` (ADR-489): the terminal loop. Everything it draws comes from the console's own views through `session.ts`; this file
 * owns only the screen (alternate buffer, raw keys, a footer, scrolling) and the headless path. Input and output are injected so
 * a test drives it without a terminal.
 */
import type { Depth } from './ansi'
import { cells, clean, widthOf } from './ansi'
import { openSession, TUI_VIEWS, type Look, type Session, type SessionOptions, type TuiView } from './session'

export type TuiInput = {
  isTTY?: boolean
  setRawMode?: (on: boolean) => unknown
  on: (event: 'data', fn: (chunk: Buffer | string) => void) => unknown
  off: (event: 'data', fn: (chunk: Buffer | string) => void) => unknown
  resume: () => unknown
  pause: () => unknown
}
export type TuiOutput = {
  isTTY?: boolean
  columns?: number
  rows?: number
  write: (text: string) => unknown
  on?: (event: 'resize', fn: () => void) => unknown
  off?: (event: 'resize', fn: () => void) => unknown
}
export type TuiIO = { stdin: TuiInput; stdout: TuiOutput; stderr: { write: (text: string) => unknown }; env: Record<string, string | undefined>; signal?: AbortSignal }
export type TuiOptions = { cwd: string; view?: TuiView; plain?: boolean; cliEntry?: string; configDir?: string; home?: string; pluginRoot?: string; refreshMs?: number; /** The look (bbs | orbital | plain: default bbs) and the frames per second of moving pictures (default 8, at most 30; 0 draws them still). */ look?: Look; fps?: number; /** False: no animation (a still frame, like fps 0). */ anim?: boolean; /** False: no pictures, only their words. */ pictures?: boolean; /** True: play the start-up screen first (as the console's boot setting). */ boot?: boolean; /** The AI page's settings; absent: the page is off. */ aiPage?: SessionOptions['aiPage'] }

export const isTuiView = (value: unknown): value is TuiView => typeof value === 'string' && (TUI_VIEWS as readonly string[]).includes(value)

/** Colour depth from the environment: NO_COLOR and a dumb terminal get none, COLORTERM truecolor/24bit gets 24-bit, the rest 256. */
export function depthOf(env: Record<string, string | undefined>): Depth {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none'
  if (env.TERM === 'dumb' || env.TERM === undefined || env.TERM === '') return 'none'

  return env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' ? 'truecolor' : '256'
}

const ESC = '\u001b'
/** Frames per second for moving pictures: the console's default 8, a whole number from 0 (still) to 30. Anything else is the default. */
export const DEFAULT_FPS = 8
export const MAX_FPS = 30
export const fpsOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(MAX_FPS, Math.floor(value))) : DEFAULT_FPS)
/** Below this the frame is a short message, not a squeezed page. The page bar and the key line shorten to what fits. */
export const MIN_COLUMNS = 40

const LABELS: Record<TuiView, string> = { overview: 'Overview', cost: 'Cost', swarm: 'Swarm', events: 'Events', missions: 'Missions', ai: 'AI' }
const LETTER: Partial<Record<string, TuiView>> = { o: 'overview', c: 'cost', s: 'swarm', e: 'events', m: 'missions', a: 'ai' }

/** The page bar: every page with its number (the current one in reverse), or `‹ 3/6 Swarm ›` when the terminal is too narrow for all of them. Page names are ours, never from a file. */
export function navLine(view: TuiView, columns: number, depth: Depth): string {
  const wide = TUI_VIEWS.map((page, i) => {
    const text = ` ${i + 1} ${LABELS[page]} `

    return page === view && depth !== 'none' ? `${ESC}[7m${text}${ESC}[0m` : page === view ? `[${text.trim()}]` : text
  }).join(' ')

  return widthOf(wide) <= columns ? wide : `‹ ${TUI_VIEWS.indexOf(view) + 1}/${TUI_VIEWS.length} ${LABELS[view]} ›`
}

/** The key line under the page: every key when there is room, fewer keys as the terminal narrows, always inside `columns` (the scroll position, when there is one, is counted in). `own` replaces the page keys (the AI page has its own). */
export function keyLine(columns: number, place = '', own?: readonly string[]): string {
  const pages = `1-${TUI_VIEWS.length}`
  const tiers = own ?? [`${pages} or o c s e m a page · tab next · r refresh · t look · j/k scroll · q quit · read-only`, `${pages} page · tab next · r refresh · j/k scroll · q quit`, `${pages} page · j/k scroll · q quit`, `${pages} page · q quit`]
  const fits = tiers.find(line => cells(line + place) <= columns) ?? tiers[tiers.length - 1] as string

  return `${fits}${place}`.slice(0, columns)
}

/** The AI page's key line: what a typed key does now (typing, a card waiting, or after Esc). */
export function aiKeyTiers(mode: 'type' | 'nav', hasCard: boolean): string[] {
  if (hasCard) return ['y send it · n cancel · Ctrl-C quit', 'y send · n cancel']
  if (mode === 'nav') return ['1-6 page · tab next · i or Enter back to typing · q quit', '1-6 page · i type · q quit']

  return ['type · Enter ask · Ctrl-T codex/openrouter · Ctrl-S stop · PgUp/PgDn scroll · Esc keys · Ctrl-C quit', 'Enter ask · Ctrl-T target · Ctrl-S stop · Esc keys', 'Enter ask · Esc keys']
}

/** One keypress as an action, from the bytes a terminal sends. Anything else is ignored. */
export type Key = 'quit' | 'look' | { page: TuiView } | 'next' | 'prev' | 'refresh' | 'down' | 'up' | 'pagedown' | 'pageup' | 'top' | 'bottom' | null

export function keyOf(chunk: string): Key {
  switch (chunk) {
    case 'q':
    case '\u0003':
    case '\u0004':
      return 'quit'
    case '\t':
    case 'l':
    case `${ESC}[C`:
      return 'next'
    case `${ESC}[Z`:
    case 'h':
    case `${ESC}[D`:
      return 'prev'
    case 'r':
      return 'refresh'
    case 't':
      return 'look'
    case 'j':
    case `${ESC}[B`:
      return 'down'
    case 'k':
    case `${ESC}[A`:
      return 'up'
    case ' ':
    case `${ESC}[6~`:
      return 'pagedown'
    case 'b':
    case `${ESC}[5~`:
      return 'pageup'
    case 'g':
    case `${ESC}[H`:
      return 'top'
    case 'G':
    case `${ESC}[F`:
      return 'bottom'
    default: {
      const digit = /^[1-9]$/.test(chunk) ? TUI_VIEWS[Number(chunk) - 1] : undefined
      const page = digit ?? LETTER[chunk]

      return page === undefined ? null : { page }
    }
  }
}

/** What the last frame put on the screen, so the next one rewrites only the rows that changed (a moving picture then costs its own rows, not a whole redraw). */
type Memory = { lines: string[]; columns: number; rows: number }

/** A whole frame, from the home position: the page bar, the body rows, then the key line (the shape every key press and resize draws). */
function writeFrame(io: TuiIO, screen: string[], memory: Memory, columns: number, rows: number, clear: boolean): void {
  const body = screen.slice(1, -1)

  memory.lines = screen
  memory.columns = columns
  memory.rows = rows
  io.stdout.write(`${clear ? `${ESC}[2J` : ''}${ESC}[H${screen[0]}${ESC}[K\r\n${body.map(line => `${line}${ESC}[K`).join('\r\n')}${ESC}[J\r\n${screen[screen.length - 1]}`)
}

/** An animation tick: only the rows that differ from the last frame, each at its own position (a moving picture costs its own rows, not a whole redraw). Anything else is a whole frame. */
function writeTick(io: TuiIO, screen: string[], memory: Memory, columns: number, rows: number): void {
  if (memory.columns !== columns || memory.rows !== rows || memory.lines.length !== screen.length) return writeFrame(io, screen, memory, columns, rows, true)

  let out = ''

  screen.forEach((line, i) => {
    if (memory.lines[i] !== line) out += `${ESC}[${i + 1};1H${line}${ESC}[K`
  })
  memory.lines = screen

  if (out !== '') io.stdout.write(out)
}

function paint(session: Session, io: TuiIO, depth: Depth, scroll: number, memory: Memory, clear = false, tick = false): number {
  const ai = session.page === 'ai' ? session.ai : null
  const raw = io.stdout.columns ?? 100
  const rows = Math.max(5, io.stdout.rows ?? 30)

  // Too narrow for a page: say so in a line that fits, rather than a squeezed frame of broken cards.
  if (raw < MIN_COLUMNS) {
    memory.lines = []
    memory.columns = 0
    io.stdout.write(`${ESC}[2J${ESC}[H${'Too narrow: need 40 columns (q quits)'.slice(0, Math.max(1, raw))}${ESC}[K`)

    return 0
  }

  const columns = Math.min(200, raw)
  const room = rows - 2
  let lines: string[]

  try {
    lines = session.frame(columns, depth, room)
  } catch {
    lines = ['The page could not be drawn. Press r to read again, q to quit.']
  }

  // The AI page fits its own conversation to the room and follows the tail; the others scroll.
  const top = session.page === 'ai' ? 0 : Math.max(0, Math.min(scroll, Math.max(0, lines.length - room)))
  const place = lines.length > room ? ` · ${top + 1}-${Math.min(lines.length, top + room)}/${lines.length}` : ''
  const footer = `${depth === 'none' ? '' : `${ESC}[2m`}${clean(keyLine(columns, place, session.page === 'ai' && session.ai !== null ? aiKeyTiers(session.ai.mode, session.ai.card !== null) : undefined))}${depth === 'none' ? '' : `${ESC}[0m`}`

  const body = [...lines.slice(top, top + room), ...Array.from({ length: Math.max(0, room - (lines.length - top)) }, () => '')]

  const screen = [navLine(session.page, columns, depth), ...body, footer]

  if (tick && !clear) writeTick(io, screen, memory, columns, rows)
  else writeFrame(io, screen, memory, columns, rows, clear)

  // The question card is on screen now: from here a `y` may answer it, and not before (#3983).
  if (session.cardFits) ai?.drawn()

  return top
}

/** `--plain`: one frame as plain text on stdout (the same views, read-only, no escapes) and exit 0. Nothing on stderr, so a script's output is only the frame. */
async function once(session: Session, io: TuiIO, view: TuiView): Promise<number> {
  session.show(view)
  await session.refresh()
  const columns = Math.max(MIN_COLUMNS, Math.min(200, io.stdout.columns ?? 100))

  io.stdout.write(`${navLine(view, columns, 'none')}\n${session.frame(columns, 'none').join('\n')}\n`)

  return 0
}

/** Without a terminal and without `--plain` the live view cannot run: say so in one line and exit 2 (a usage error), so a script notices instead of reading a silent frame. */
export const NOT_A_TERMINAL_HINT = 'ruflo tui: not an interactive terminal. Run it in a terminal, or pass --plain to print one frame and exit 0.\n'

export async function runTui(options: TuiOptions, io: TuiIO): Promise<number> {
  const interactive = io.stdin.isTTY === true && io.stdout.isTTY === true && io.stdin.setRawMode !== undefined

  if (options.plain !== true && !interactive) {
    io.stderr.write(NOT_A_TERMINAL_HINT)

    return 2
  }

  const session = openSession({ cwd: options.cwd, ...((options.look ?? (options.plain === true ? 'plain' : undefined)) !== undefined && { look: options.look ?? 'plain' }), fps: options.anim === false ? 0 : fpsOf(options.fps), ...(options.pictures === false && { pictures: false }), ...(options.boot === true && { boot: true }), ...(options.cliEntry !== undefined && { cliEntry: options.cliEntry }), ...(options.configDir !== undefined && { configDir: options.configDir }), ...(options.home !== undefined && { home: options.home }), ...(options.pluginRoot !== undefined && { pluginRoot: options.pluginRoot }), ...(options.aiPage !== undefined && { aiPage: options.aiPage }) })
  let view: TuiView = options.view ?? 'overview'

  try {
    if (options.plain === true || !interactive || io.stdin.setRawMode === undefined) return await once(session, io, view)

    const depth = depthOf(io.env)
    let scroll = 0
    let isDone = false
    let isFocused = true
    let finish: () => void = () => undefined
    const done = new Promise<void>(resolve => void (finish = resolve))
    const memory: Memory = { lines: [], columns: 0, rows: 0 }
    const draw = (tick = false) => void (scroll = paint(session, io, depth, scroll, memory, false, tick))
    const reread = async () => {
      await session.refresh()
      if (!isDone) draw()
    }
    session.onChange(() => void (isDone || draw()))

    const onKey = (chunk: Buffer | string) => {
      // The AI page takes the keys while you type (digits and letters are text there): Esc hands them back to the shell, and Ctrl-C always quits.
      if (view === 'ai' && session.ai !== null && session.ai.press(chunk.toString()).consumed) return draw()

      // Focus reports (the terminal tells us when it is behind another window): a hidden terminal draws nothing, and a refocused one draws at once.
      if (chunk.toString() === `${ESC}[O`) return void (isFocused = false)
      if (chunk.toString() === `${ESC}[I`) return void ((isFocused = true), draw())

      const key = keyOf(chunk.toString())
      const page = Math.max(1, (io.stdout.rows ?? 30) - 2)

      if (key === 'quit') return finish()
      if (typeof key === 'object' && key !== null) (view = key.page), (scroll = 0), session.show(view), view === 'ai' && session.ai?.enter()
      else if (key === 'next') (view = TUI_VIEWS[(TUI_VIEWS.indexOf(view) + 1) % TUI_VIEWS.length] as TuiView), (scroll = 0), session.show(view)
      else if (key === 'prev') (view = TUI_VIEWS[(TUI_VIEWS.indexOf(view) + TUI_VIEWS.length - 1) % TUI_VIEWS.length] as TuiView), (scroll = 0), session.show(view)
      else if (key === 'down') scroll += 1
      else if (key === 'up') scroll = Math.max(0, scroll - 1)
      else if (key === 'pagedown') scroll += page
      else if (key === 'pageup') scroll = Math.max(0, scroll - page)
      else if (key === 'top') scroll = 0
      else if (key === 'bottom') scroll = Number.MAX_SAFE_INTEGER
      else if (key === 'refresh') void reread()
      else if (key === 'look') session.cycleLook()
      else return

      draw()
    }

    session.show(view)
    io.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1004h`)
    io.stdin.setRawMode(true)
    io.stdin.resume()
    io.stdin.on('data', onKey)
    const resize = () => void (scroll = paint(session, io, depth, scroll, memory, true))

    io.stdout.on?.('resize', resize)
    io.signal?.addEventListener('abort', finish, { once: true })
    draw()

    const timer = setInterval(() => void reread(), Math.max(3000, options.refreshMs ?? 3000))
    // The frame clock: only while something moves, the terminal is in front, and the last frame was done in time (a slow terminal skips frames, never queues them).
    const fps = options.anim === false ? 0 : fpsOf(options.fps)
    let isDrawing = false
    const clock = fps === 0 ? null : setInterval(() => {
      if (isDone || isDrawing || !isFocused || !session.moving()) return

      isDrawing = true
      try {
        draw(true)
      } finally {
        isDrawing = false
      }
    }, Math.round(1000 / fps))

    void reread()

    try {
      await done
    } finally {
      isDone = true
      clearInterval(timer)
      if (clock !== null) clearInterval(clock)
      io.stdin.off('data', onKey)
      io.stdout.off?.('resize', resize)
      io.stdin.setRawMode(false)
      io.stdin.pause()
      io.stdout.write(`${ESC}[?1004l${ESC}[?25h${ESC}[?1049l`)
    }

    return 0
  } finally {
    session.stop()
  }
}
