/**
 * `ruflo tui` draws what the console draws (ADR-489 phase 4): the page's title art and its pictures as coloured cells, in the console's
 * own look (Classic BBS by default, Orbital, plain), moving at `--fps`, redrawing only the rows that changed, still with `--no-anim`,
 * and in words alone where there is no colour or no room. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-pictures.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fpsOf, keyOf, runTui, type TuiIO } from '../tui/run'
import { LOOKS, openSession } from '../tui/session'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const ESC = '\u001b'
const BLOCKS = /[█▀▄▌▐▓▒░⣿⠁-⣿]/
let root: string
let project: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-pictures-'))
  project = join(root, 'project')
  for (const [path, body] of Object.entries(RUFLO_FILES)) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), body)
  }
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const settle = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms))
const strip = (text: string) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')

async function opened(options: Record<string, unknown> = {}) {
  const session = openSession({ cwd: project, home: join(root, 'home'), ...options })

  await session.refresh()

  return session
}

describe('the pictures in a frame', () => {
  it('lead the page in the console look: block-letter title art in colour, over the words of the page', async () => {
    const session = await opened({ look: 'bbs', fps: 0 })
    const frame = session.frame(100, 'truecolor', 30)
    const text = strip(frame.join('\n'))

    expect(frame.join('\n')).toMatch(/\u001b\[0;38;2;\d+;\d+;\d+m/)
    expect(text).toMatch(BLOCKS)
    expect(text).toContain('Overview')
    expect(frame.every(line => strip(line).length <= 400)).toBe(true)
    session.stop()
  })

  it('are in Orbital too: the shaded RUFLO masthead with its globe, and the swarm graph on the Swarm page', async () => {
    const session = await opened({ look: 'orbital', fps: 0 })

    session.show('swarm')

    const text = strip(session.frame(120, '256', 40).join('\n'))

    expect(text).toContain('RUFLO / AGENT SWARM CONSOLE')
    expect(text).toMatch(/█/)
    expect(text).not.toContain('graph needs a terminal')
    session.stop()
  })

  it('are drawn as words alone with no colour, with --no-pictures, and below 44 columns', async () => {
    const colourless = await opened({ look: 'bbs', fps: 0 })
    const off = await opened({ look: 'bbs', fps: 0, pictures: false })
    const narrow = await opened({ look: 'bbs', fps: 0 })

    expect(colourless.frame(100, 'none', 30).join('\n')).not.toMatch(/\u001b/)
    expect(strip(off.frame(100, 'truecolor', 30).join('\n'))).not.toMatch(/[█▓]{3}/)
    expect(narrow.frame(40, 'truecolor', 30).join('\n')).not.toMatch(/\u001b\[0;38/)
    for (const session of [colourless, off, narrow]) session.stop()
  })

  it('keep a card\'s rows inside its borders (a picture is cut to the room it has)', async () => {
    const session = await opened({ look: 'orbital', fps: 0 })

    session.show('swarm')

    for (const columns of [60, 80, 132, 200]) {
      const widths = session.frame(columns, 'truecolor', 40).map(line => [...strip(line)].length)

      expect(Math.max(...widths)).toBeLessThanOrEqual(columns + 3)
    }
    session.stop()
  })

  it('stand still at fps 0 and move at fps above 0', async () => {
    const still = await opened({ look: 'orbital', fps: 0 })
    const moving = await opened({ look: 'orbital', fps: 20 })
    const first = still.frame(100, 'truecolor', 30).join('\n')
    const a = moving.frame(100, 'truecolor', 30).join('\n')

    await settle(350)

    expect(still.frame(100, 'truecolor', 30).join('\n')).toBe(first)
    expect(moving.frame(100, 'truecolor', 30).join('\n')).not.toBe(a)
    expect(still.moving()).toBe(false)
    expect(moving.moving()).toBe(true)
    still.stop()
    moving.stop()
  })
})

describe('the looks', () => {
  it('are Classic BBS (the console default), Orbital and plain, and t steps through them', async () => {
    const session = await opened()

    expect(LOOKS).toEqual(['bbs', 'orbital', 'plain'])
    expect(session.look).toBe('bbs')
    expect([session.cycleLook(), session.cycleLook(), session.cycleLook()]).toEqual(['orbital', 'plain', 'bbs'])
    expect(keyOf('t')).toBe('look')
    session.stop()
  })

  it('plain has no pictures: its pages are the words', async () => {
    const session = await opened({ look: 'plain' })

    expect(strip(session.frame(100, 'truecolor', 30).join('\n'))).not.toMatch(/█{2}/)
    session.stop()
  })
})

describe('--fps', () => {
  it('is a whole number from 0 to 30, and the console default (8) for anything else', () => {
    expect([fpsOf(0), fpsOf(8), fpsOf(30), fpsOf(99), fpsOf(-3), fpsOf(7.9)]).toEqual([0, 8, 30, 30, 0, 7])
    expect([fpsOf('12'), fpsOf(undefined), fpsOf(NaN), fpsOf(null)]).toEqual([8, 8, 8, 8])
  })
})

function terminal(columns = 100, rows = 32, env: Record<string, string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor' }) {
  const out: string[] = []
  const listeners: Array<(chunk: string) => void> = []
  const stdout = { isTTY: true, columns, rows, write: (text: string) => void out.push(text), on: () => undefined, off: () => undefined }
  const io: TuiIO = {
    stdin: { isTTY: true, setRawMode: () => undefined, on: (_e, fn) => void listeners.push(fn as never), off: () => void listeners.splice(0), resume: () => undefined, pause: () => undefined },
    stdout,
    stderr: { write: () => undefined },
    env,
  }

  return { io, out, press: (key: string) => listeners.forEach(fn => fn(key)) }
}

describe('the loop', () => {
  it('redraws a moving picture on its clock with only the rows that changed, and not when told --no-anim', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), look: 'orbital', fps: 25 }, t.io)

    await settle(900)

    const ticks = t.out.filter(chunk => /^\u001b\[\d+;1H/.test(chunk))

    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.every(chunk => !chunk.includes(`${ESC}[2J`) && chunk.length < 20000)).toBe(true)
    t.press('q')
    await running

    const quiet = terminal()
    const stilled = runTui({ cwd: project, home: join(root, 'home'), look: 'orbital', fps: 25, anim: false }, quiet.io)

    await settle(900)
    expect(quiet.out.filter(chunk => /^\u001b\[\d+;1H/.test(chunk))).toHaveLength(0)
    quiet.press('q')
    await stilled
  })

  it('stops drawing while the terminal reports focus lost and resumes when it is back', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), look: 'orbital', fps: 25 }, t.io)

    await settle(400)
    t.press(`${ESC}[O`)
    await settle(60)

    const mark = t.out.length

    await settle(500)
    expect(t.out.length).toBe(mark)
    t.press(`${ESC}[I`)
    await settle(300)
    expect(t.out.length).toBeGreaterThan(mark)
    t.press('q')
    await running
  })

  it('asks the terminal for focus reports and gives everything back on q', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), look: 'bbs', fps: 0 }, t.io)

    await settle(250)
    t.press('q')
    await running

    const all = t.out.join('')

    expect(all.startsWith(`${ESC}[?1049h${ESC}[?25l${ESC}[?1004h`)).toBe(true)
    expect(all.endsWith(`${ESC}[?1004l${ESC}[?25h${ESC}[?1049l`)).toBe(true)
  })

  it('draws no colour under NO_COLOR and no pictures on a dumb terminal', async () => {
    for (const env of [{ TERM: 'xterm-256color', NO_COLOR: '1' }, { TERM: 'dumb' }]) {
      const t = terminal(100, 32, env)
      const running = runTui({ cwd: project, home: join(root, 'home'), look: 'bbs', fps: 8 }, t.io)

      await settle(500)
      t.press('q')
      await running
      expect(t.out.join('').replace(/\u001b\[[?0-9;]*[hlHJK]/g, '')).not.toMatch(/\u001b\[[0-9;]*m/)
    }
  })

  it('t cycles the look on screen: BBS blocks, then Orbital\'s masthead, then plain words', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), look: 'bbs', fps: 0 }, t.io)

    await settle(300)

    const last = () => strip(t.out.join('').split(`${ESC}[H`).pop() ?? '')

    expect(last()).toMatch(/░▒▓/)
    t.press('t')
    await settle(100)
    expect(last()).toContain('RUFLO / AGENT SWARM CONSOLE')
    t.press('t')
    await settle(100)
    expect(last()).not.toMatch(/█{2}/)
    t.press('q')
    await running
  })
})
