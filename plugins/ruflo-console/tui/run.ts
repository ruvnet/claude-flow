/**
 * `ruflo tui` (ADR-489): the terminal loop. Everything it draws comes from the console's own views through `session.ts`; this file
 * owns only the screen (alternate buffer, raw keys, a footer, scrolling) and the headless path. Input and output are injected so
 * a test drives it without a terminal.
 */
import type { Depth } from './ansi'
import { openSession, TUI_VIEWS, type Session, type TuiView } from './session'

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
export type TuiOptions = { cwd: string; view?: TuiView; plain?: boolean; cliEntry?: string; configDir?: string; home?: string; pluginRoot?: string; refreshMs?: number }

export const isTuiView = (value: unknown): value is TuiView => typeof value === 'string' && (TUI_VIEWS as readonly string[]).includes(value)

/** Colour depth from the environment: NO_COLOR and a dumb terminal get none, COLORTERM truecolor/24bit gets 24-bit, the rest 256. */
export function depthOf(env: Record<string, string | undefined>): Depth {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none'
  if (env.TERM === 'dumb' || env.TERM === undefined || env.TERM === '') return 'none'

  return env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' ? 'truecolor' : '256'
}

const KEYS = 'o overview · c cost · r refresh · j/k scroll · q quit'
const ESC = '\u001b'

/** One keypress as an action, from the bytes a terminal sends. Anything else is ignored. */
export type Key = 'quit' | 'overview' | 'cost' | 'next' | 'refresh' | 'down' | 'up' | 'pagedown' | 'pageup' | 'top' | 'bottom' | null

export function keyOf(chunk: string): Key {
  switch (chunk) {
    case 'q':
    case '\u0003':
    case '\u0004':
      return 'quit'
    case 'o':
      return 'overview'
    case 'c':
      return 'cost'
    case '\t':
      return 'next'
    case 'r':
      return 'refresh'
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
    default:
      return null
  }
}

function paint(session: Session, io: TuiIO, depth: Depth, scroll: number): number {
  const columns = Math.max(40, Math.min(200, io.stdout.columns ?? 100))
  const rows = Math.max(5, io.stdout.rows ?? 30)
  const room = rows - 1
  let lines: string[]

  try {
    lines = session.frame(columns, depth)
  } catch {
    lines = ['The page could not be drawn. Press r to read again, q to quit.']
  }

  const top = Math.max(0, Math.min(scroll, Math.max(0, lines.length - room)))
  const footer = `${depth === 'none' ? '' : `${ESC}[7m`} ${session.state.view} · ${top + 1}-${Math.min(lines.length, top + room)}/${lines.length} · ${KEYS} · read-only ${depth === 'none' ? '' : `${ESC}[0m`}`

  io.stdout.write(`${ESC}[H${lines.slice(top, top + room).map(line => `${line}${ESC}[K`).join('\r\n')}${ESC}[J\r\n${footer.slice(0, columns + 12)}`)

  return top
}

/** `--plain`: one frame as plain text on stdout (the same views, read-only, no escapes) and exit 0. Nothing on stderr, so a script's output is only the frame. */
async function once(session: Session, io: TuiIO, view: TuiView): Promise<number> {
  session.show(view)
  await session.refresh()
  io.stdout.write(`${session.frame(Math.max(40, Math.min(200, io.stdout.columns ?? 100)), 'none').join('\n')}\n`)

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

  const session = openSession({ cwd: options.cwd, ...(options.cliEntry !== undefined && { cliEntry: options.cliEntry }), ...(options.configDir !== undefined && { configDir: options.configDir }), ...(options.home !== undefined && { home: options.home }), ...(options.pluginRoot !== undefined && { pluginRoot: options.pluginRoot }) })
  let view: TuiView = options.view ?? 'overview'

  try {
    if (options.plain === true || !interactive || io.stdin.setRawMode === undefined) return await once(session, io, view)

    const depth = depthOf(io.env)
    let scroll = 0
    let isDone = false
    let finish: () => void = () => undefined
    const done = new Promise<void>(resolve => void (finish = resolve))
    const draw = () => void (scroll = paint(session, io, depth, scroll))
    const reread = async () => {
      await session.refresh()
      if (!isDone) draw()
    }
    const onKey = (chunk: Buffer | string) => {
      const key = keyOf(chunk.toString())
      const page = Math.max(1, (io.stdout.rows ?? 30) - 2)

      if (key === 'quit') return finish()
      if (key === 'overview' || key === 'cost') (view = key), (scroll = 0), session.show(view)
      else if (key === 'next') (view = TUI_VIEWS[(TUI_VIEWS.indexOf(view) + 1) % TUI_VIEWS.length] as TuiView), (scroll = 0), session.show(view)
      else if (key === 'down') scroll += 1
      else if (key === 'up') scroll = Math.max(0, scroll - 1)
      else if (key === 'pagedown') scroll += page
      else if (key === 'pageup') scroll = Math.max(0, scroll - page)
      else if (key === 'top') scroll = 0
      else if (key === 'bottom') scroll = Number.MAX_SAFE_INTEGER
      else if (key === 'refresh') void reread()
      else return

      draw()
    }

    session.show(view)
    io.stdout.write(`${ESC}[?1049h${ESC}[?25l`)
    io.stdin.setRawMode(true)
    io.stdin.resume()
    io.stdin.on('data', onKey)
    io.stdout.on?.('resize', draw)
    io.signal?.addEventListener('abort', finish, { once: true })
    draw()

    const timer = setInterval(() => void reread(), Math.max(3000, options.refreshMs ?? 3000))

    void reread()

    try {
      await done
    } finally {
      isDone = true
      clearInterval(timer)
      io.stdin.off('data', onKey)
      io.stdout.off?.('resize', draw)
      io.stdin.setRawMode(false)
      io.stdin.pause()
      io.stdout.write(`${ESC}[?25h${ESC}[?1049l`)
    }

    return 0
  } finally {
    session.stop()
  }
}
