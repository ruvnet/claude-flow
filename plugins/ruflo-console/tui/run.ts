/**
 * `ruflo tui` (ADR-489): the terminal loop. Everything it draws comes from the console's own views through `session.ts`; this file
 * owns only the screen (alternate buffer, raw keys, a footer, scrolling) and the headless path. Input and output are injected so
 * a test drives it without a terminal.
 */
import type { Depth } from './ansi'
import { cells, clean, widthOf } from './ansi'
import { VIEWS, viewOf } from '../hooks/state'
import { PAGE_IDS } from './parity'
import { openSession, TUI_VIEWS, type Look, type Page, type Session, type SessionOptions, type TuiView } from './session'

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
export type TuiOptions = { cwd: string; view?: Page; /** True: read SGR mouse reports (a click on the page bar, the wheel to scroll). Off by default; every mouse action has a key. */ mouse?: boolean; plain?: boolean; cliEntry?: string; configDir?: string; home?: string; pluginRoot?: string; refreshMs?: number; /** The look (bbs | orbital | plain: default bbs) and the frames per second of moving pictures (default 8, at most 30; 0 draws them still). */ look?: Look; fps?: number; /** False: no animation (a still frame, like fps 0). */ anim?: boolean; /** False: no pictures, only their words. */ pictures?: boolean; /** True: play the start-up screen first (as the console's boot setting). */ boot?: boolean; /** The AI page's settings; absent: the page is off. */ aiPage?: SessionOptions['aiPage'] }

export const isTuiView = (value: unknown): value is TuiView => typeof value === 'string' && (TUI_VIEWS as readonly string[]).includes(value)
/** Any page the shell can open, which is every console view and the AI page (`--view`, the go prompt). */
export const isPage = (value: unknown): value is Page => typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value)

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
export function navLine(view: Page, columns: number, depth: Depth): string {
  const wide = TUI_VIEWS.map((page, i) => {
    const text = ` ${i + 1} ${LABELS[page]} `

    return page === view && depth !== 'none' ? `${ESC}[7m${text}${ESC}[0m` : page === view ? `[${text.trim()}]` : text
  }).join(' ')
  const other = (TUI_VIEWS as readonly string[]).includes(view) ? null : (VIEWS.find(entry => entry.id === view)?.label ?? view)

  // A page that is not one of the six shows after them, as the one chip that is on.
  if (other !== null) {
    const chip = depth !== 'none' ? `${ESC}[7m ${other} ${ESC}[0m` : `[${other}]`
    const all = `${wide}  ${chip}`

    return widthOf(all) <= columns ? all : `‹ ${clean(other)} › (Esc back)`.slice(0, columns)
  }

  return widthOf(wide) <= columns ? wide : `‹ ${TUI_VIEWS.indexOf(view as TuiView) + 1}/${TUI_VIEWS.length} ${LABELS[view as TuiView]} ›`
}

/** Which of the six page chips a click at column `x` (1-based) lands on, or null: the same positions `navLine` draws when it fits. */
export function navHit(x: number, columns: number): TuiView | null {
  const chips = TUI_VIEWS.map((page, k) => ` ${k + 1} ${LABELS[page]} `)

  if (chips.join(' ').length > columns) return null

  let at = 1

  for (const [k, chip] of chips.entries()) {
    if (x >= at && x < at + chip.length) return TUI_VIEWS[k] as TuiView
    at += chip.length + 1
  }

  return null
}

/** The key line under the page: every key when there is room, fewer keys as the terminal narrows, always inside `columns` (the scroll position, when there is one, is counted in). `own` replaces the page keys (the AI page has its own). */
export function keyLine(columns: number, place = '', own?: readonly string[]): string {
  const pages = `1-${TUI_VIEWS.length}`
  const menu = '0 menu · : go to any page · Esc back'
  const tiers = own ?? [`${pages} or o c s e m a page · ${menu} · tab next · r refresh · t look · j/k scroll · q quit · ask first`, `${pages} or o c s e m a page · 0 menu · : go · tab next · r refresh · j/k scroll · q quit · ask first`, `${pages} page · 0 menu · : go · Esc back · tab next · r refresh · j/k scroll · q quit`, `${pages} page · tab next · r refresh · j/k scroll · q quit`, `${pages} page · j/k scroll · q quit`, `${pages} page · q quit`]
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
export type Key = 'quit' | 'look' | 'menu' | 'prompt' | 'back' | { page: TuiView } | 'next' | 'prev' | 'refresh' | 'down' | 'up' | 'pagedown' | 'pageup' | 'top' | 'bottom' | null

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
    case '0':
      return 'menu'
    case ':':
    case '/':
      return 'prompt'
    case `${ESC}`:
    case '\u007f':
    case '\b':
      return 'back'
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

/** A terminal that reports 0 (or nothing) does not know its size; some `docker exec` without -t and CI `script` wrappers do. Use the default rather than calling it too narrow (#4115). */
const sized = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback)

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

function paint(session: Session, io: TuiIO, depth: Depth, scroll: number, memory: Memory, clear = false, tick = false, line = ''): number {
  const ai = session.page === 'ai' ? session.ai : null
  const raw = sized(io.stdout.columns, 100)
  const rows = Math.max(5, sized(io.stdout.rows, 30))

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
  // A confirm card (or the last action's result) is pinned under the bar, so scrolling never hides what a y would run.
  const pinned = session.page === 'ai' ? [] : session.pinned(columns, depth, room)
  const space = Math.max(1, room - pinned.length)
  const top = session.page === 'ai' ? 0 : Math.max(0, Math.min(scroll, Math.max(0, lines.length - space)))
  const place = lines.length > space ? ` · ${top + 1}-${Math.min(lines.length, top + space)}/${lines.length}` : ''
  const footer = `${depth === 'none' ? '' : `${ESC}[2m`}${line !== '' ? clean(line).slice(0, columns) : clean(keyLine(columns, place, session.page === 'ai' && session.ai !== null ? aiKeyTiers(session.ai.mode, session.ai.card !== null) : undefined))}${depth === 'none' ? '' : `${ESC}[0m`}`

  const body = [...lines.slice(top, top + space), ...Array.from({ length: Math.max(0, space - (lines.length - top)) }, () => '')]

  const screen = [navLine(session.page, columns, depth), ...pinned, ...body, footer]

  if (tick && !clear) writeTick(io, screen, memory, columns, rows)
  else writeFrame(io, screen, memory, columns, rows, clear)

  // The question card is on screen now: from here a `y` may answer it, and not before (#3983).
  if (session.cardFits) ai?.drawn()

  return top
}

/** `--plain`: one frame as plain text on stdout (the same views, read-only, no escapes) and exit 0. Nothing on stderr, so a script's output is only the frame. */
async function once(session: Session, io: TuiIO, view: Page): Promise<number> {
  session.show(view)
  await session.refresh()
  const columns = Math.max(MIN_COLUMNS, Math.min(200, sized(io.stdout.columns, 100)))

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
  let view: Page = options.view ?? 'overview'

  try {
    if (options.plain === true || !interactive || io.stdin.setRawMode === undefined) return await once(session, io, view)

    const depth = depthOf(io.env)
    let scroll = 0
    let isDone = false
    let isFocused = true
    let finish: () => void = () => undefined
    const done = new Promise<void>(resolve => void (finish = resolve))
    const memory: Memory = { lines: [], columns: 0, rows: 0 }
    // The go prompt (":" or "/"): a page by its name, id or key, read from the keys, shown in the key line. `notice` is one line of news until the next key.
    let prompt: string | null = null
    let notice = ''
    const history: Page[] = []
    const line = () => (prompt !== null ? `go> ${prompt}▌  (a page, or an action to ask for · Enter · Esc cancels)` : notice !== '' ? notice : session.page !== 'ai' && session.pending() !== null ? 'y runs the command in the card · n or Esc cancels · the other keys still work' : '')
    const draw = (tick = false) => void (scroll = paint(session, io, depth, scroll, memory, false, tick, line()))
    const reread = async () => {
      await session.refresh()
      if (!isDone) draw()
    }
    session.onChange(() => void (isDone || draw()))

    const open = (next: Page) => {
      if (next !== view) history.push(view), history.length > 30 && history.shift()

      view = next
      scroll = 0
      session.show(view)
      view = session.page
      if (session.page === 'ai') session.ai?.enter()
      else if (!(TUI_VIEWS as readonly string[]).includes(view)) void reread()
    }
    const goTo = (word: string) => {
      const name = word.trim().replace(/^(go|open)\s+/i, '')
      const found = name.toLowerCase() === 'ai' ? 'ai' : viewOf(name)

      // A name that is not a page is an action, asked the console's way: a read runs at once, a change shows a card and waits for a y.
      if (name.startsWith('>')) notice = session.palette(name.slice(1))
      else if (found === null || found === 'agent') notice = session.palette(name)
      else open(found)
    }
    const onMouse = (chunk: string): boolean => {
      const hit = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(chunk)

      if (hit === null) return false

      const [button, x, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])]

      if (hit[4] !== 'M') return true
      if (button === 64) scroll = Math.max(0, scroll - 3)
      else if (button === 65) scroll += 3
      else if (button === 0 && y === 1) {
        const page = navHit(x, Math.min(200, sized(io.stdout.columns, 100)))

        if (page !== null) open(page)
      }

      draw()

      return true
    }

    const onKey = (chunk: Buffer | string) => {
      // The AI page takes the keys while you type (digits and letters are text there): Esc hands them back to the shell, and Ctrl-C always quits.
      if (session.page === 'ai' && session.ai !== null && session.ai.press(chunk.toString()).consumed) return draw()

      // Focus reports (the terminal tells us when it is behind another window): a hidden terminal draws nothing, and a refocused one draws at once.
      if (chunk.toString() === `${ESC}[O`) return void (isFocused = false)
      if (chunk.toString() === `${ESC}[I`) return void ((isFocused = true), draw())

      if (options.mouse === true && onMouse(chunk.toString())) return

      const text = chunk.toString()

      notice = ''

      if (prompt !== null) {
        if (text === '\r' || text === '\n') {
          const word = prompt

          prompt = null
          goTo(word)
        } else if (text === ESC || text === '\u0003') prompt = null
        else if (text === '\u007f' || text === '\b') prompt = prompt.slice(0, -1)
        else if (text.length === 1 && text >= ' ' && text !== '\u007f' && prompt.length < 40) prompt += text
        else if (text.length > 1 && !text.includes(ESC) && prompt.length + text.length <= 40) prompt += clean(text).replace(/[\r\n]/g, '')

        return draw()
      }

      // A waiting card: only a lone y, while the whole card is on screen, runs it; n or Esc drops it (a paste is text, never an answer).
      if (session.page !== 'ai' && session.pending() !== null) {
        if (text === 'y' || text === 'Y') return void (session.answer(true), draw())
        if (text === 'n' || text === 'N' || text === ESC) return void (session.answer(false), draw())
      }

      // The main menu's keys are the console's own: an entry opens by its key chip (q still quits, and p is the palette, here the go prompt).
      if (view === 'menu' && text.length === 1 && text !== 'q') {
        const entry = VIEWS.find(candidate => candidate.key !== '' && candidate.key === text)

        if (entry !== undefined) return void (open(entry.id), draw())
        if (text === 'p') return void ((prompt = ''), draw())
      }

      const key = keyOf(text)
      const page = Math.max(1, (sized(io.stdout.rows, 30)) - 2)

      if (key === 'quit') return finish()
      if (typeof key === 'object' && key !== null) open(key.page)
      else if (key === 'menu') open('menu')
      else if (key === 'prompt') prompt = ''
      else if (key === 'back') {
        const previous = history.pop()

        if (previous === undefined) notice = 'nothing to go back to'
        else (view = previous), (scroll = 0), session.show(view), (view = session.page)
      }
      else if (key === 'next') open(TUI_VIEWS[(TUI_VIEWS.indexOf(view as TuiView) + 1) % TUI_VIEWS.length] as TuiView)
      else if (key === 'prev') open(TUI_VIEWS[(TUI_VIEWS.indexOf(view as TuiView) + TUI_VIEWS.length - 1) % TUI_VIEWS.length] as TuiView)
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
    io.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1004h${options.mouse === true ? `${ESC}[?1000h${ESC}[?1006h` : ''}`)
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
      io.stdout.write(`${options.mouse === true ? `${ESC}[?1006l${ESC}[?1000l` : ''}${ESC}[?1004l${ESC}[?25h${ESC}[?1049l`)
    }

    return 0
  } finally {
    session.stop()
  }
}
