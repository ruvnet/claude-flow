/**
 * Every console view has a recorded decision for the standalone terminal (ADR-489 phase 5), the shell opens each one, and the go prompt, the
 * main-menu keys, Back and the mouse reach them. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-parity.spec.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { VIEWS } from '../hooks/state'
import { navHit, navLine, runTui, type TuiIO } from '../tui/run'
import { PAGE_IDS, PARITY } from '../tui/parity'
import { openSession } from '../tui/session'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const ESC = '\u001b'
const ADR = join(__dirname, '../../../v3/docs/adr/ADR-489-ruflo-tui-standalone-console.md')
let root: string
let project: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-parity-'))
  project = join(root, 'project')
  for (const [path, body] of Object.entries(RUFLO_FILES)) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), body)
  }
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms))
const strip = (text: string) => text.replace(/\u001b\[[0-9;?<]*[A-Za-z]/g, '')

describe('a decision for every console view', () => {
  it('has a row in PARITY for each view in VIEWS, and for nothing else', () => {
    const ids = [...VIEWS.map(view => view.id), 'agent'].sort()

    expect(Object.keys(PARITY).sort()).toEqual(ids)
    expect(PAGE_IDS).toEqual([...VIEWS.map(view => view.id), 'ai'])
    for (const [id, entry] of Object.entries(PARITY)) {
      expect(['same', 'partial', 'equivalent', 'claude-only'], id).toContain(entry.status)
      expect(entry.why.length, id).toBeGreaterThan(8)
    }
  })

  it('is written out in ADR-489, row for row, so the guide and the code cannot disagree', () => {
    const adr = readFileSync(ADR, 'utf8')

    for (const view of [...VIEWS, { id: 'agent', label: 'Agent drill-down' }]) {
      const entry = PARITY[view.id as keyof typeof PARITY]

      expect(adr, view.id).toContain(`| \`${view.id}\` | ${view.label} | ${entry.status} | ${entry.why} |`)
    }
  })

  it('opens every view without throwing, in words only, with nothing but colour in the bytes', async () => {
    const session = openSession({ cwd: project, home: join(root, 'home'), look: 'plain', fps: 0 })

    await session.refresh()
    for (const view of VIEWS) {
      session.show(view.id)

      const lines = session.frame(100, 'none', 40)

      expect(lines.length, view.id).toBeGreaterThan(0)
      expect(lines.join('\n'), view.id).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    }
    session.stop()
  })

  it('sends the console terminal to the AI page and says plainly that the Room needs Claude Code', async () => {
    const session = openSession({ cwd: project, home: join(root, 'home'), look: 'plain', fps: 0, aiPage: {} })

    session.show('terminal')
    expect(session.page).toBe('ai')
    session.show('room')
    expect(session.page).toBe('room')

    const note = session.frame(100, 'none', 30).join('\n')

    expect(note).toContain('Room: Claude Code only')
    expect(note).toContain(PARITY.room.why)
    session.stop()
  })

  it('draws the main menu entries as words next to their keys (they were blank)', async () => {
    const session = openSession({ cwd: project, home: join(root, 'home'), look: 'plain', fps: 0 })

    await session.refresh()
    session.show('menu')

    const text = session.frame(100, 'none', 60).join('\n')

    for (const word of ['Missions', 'Overview', 'Hive-Mind', 'Memory Lab', 'Settings']) expect(text, word).toContain(word)
    session.stop()
  })
})

function terminal(columns = 110, rows = 36) {
  const out: string[] = []
  const listeners: Array<(chunk: string) => void> = []
  const io: TuiIO = {
    stdin: { isTTY: true, setRawMode: () => undefined, on: (_e, fn) => void listeners.push(fn as never), off: () => void listeners.splice(0), resume: () => undefined, pause: () => undefined },
    stdout: { isTTY: true, columns, rows, write: (text: string) => void out.push(text), on: () => undefined, off: () => undefined },
    stderr: { write: () => undefined },
    env: { TERM: 'xterm-256color' },
  }

  return { io, out, press: (key: string) => listeners.forEach(fn => fn(key)), screen: () => strip(out.join('').split(`${ESC}[H`).pop() ?? '') }
}

const options = { look: 'plain' as const, fps: 0 }

describe('getting to every view from the keys', () => {
  it('0 opens the menu, a menu key opens that view, and Esc comes back to where you were', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), ...options }, t.io)

    await settle()
    t.press('0')
    await settle()
    expect(t.screen()).toContain('Main Menu')
    expect(navLine('menu', 110, 'none')).toContain('[Main Menu]')
    t.press('b') // Hive-Mind on the board (b is Page Up everywhere else)
    await settle()
    expect(t.screen()).toMatch(/Hive-Mind/)
    t.press(ESC)
    await settle()
    expect(t.screen()).toContain('Main Menu')
    t.press(ESC)
    await settle()
    expect(t.screen()).toMatch(/Overview/)
    t.press('q')
    await running
  })

  it('has a go prompt that takes a name, an id or a prefix, and says so when there is no such page', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), ...options }, t.io)

    await settle()
    t.press(':')
    for (const ch of 'go federation') t.press(ch)
    expect(t.screen()).toContain('go> go federation')
    t.press('\r')
    await settle()
    expect(t.screen()).toContain('Federation')
    t.press('/')
    for (const ch of 'nonsense') t.press(ch)
    t.press('\r')
    await settle()
    expect(t.screen()).toContain('no page or action called "nonsense"')
    t.press(':')
    for (const ch of 'term') t.press(ch)
    t.press('\r')
    await settle()
    expect(t.screen()).toMatch(/AI/)
    t.press('q')
    await running
  })

  it('lets a pasted escape sequence into the prompt as nothing (the prompt keeps text, not bytes)', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), ...options }, t.io)

    await settle()
    t.press(':')
    t.press(`${ESC}]0;evil\u0007`)
    expect(t.screen()).toContain('go> ▌')
    t.press(ESC)
    t.press('q')
    await running
  })

  it('--view takes any page', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), view: 'federation', ...options }, t.io)

    await settle()
    expect(t.screen()).toContain('Federation')
    t.press('q')
    await running
  })
})

describe('the mouse', () => {
  it('is off unless asked for: no reporting is switched on, and report bytes are not read as keys', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), ...options }, t.io)

    await settle()
    expect(t.out.join('')).not.toContain('?1000h')
    t.press(`${ESC}[<0;14;1M`)
    await settle()
    expect(t.screen()).toMatch(/Overview/)
    t.press('q')
    await running
  })

  it('with --mouse: a click on a page chip opens it, the wheel scrolls, and reporting is switched off on q', async () => {
    const t = terminal(110, 12)
    const running = runTui({ cwd: project, home: join(root, 'home'), mouse: true, ...options }, t.io)

    await settle()
    expect(t.out.join('')).toContain(`${ESC}[?1000h${ESC}[?1006h`)
    expect(navHit(1, 110)).toBe('overview')
    expect(navHit(14, 110)).toBe('cost')
    t.press(`${ESC}[<0;14;1M`)
    await settle()
    expect(t.screen()).toMatch(/Cost/)
    t.press(`${ESC}[<65;5;5M`)
    await settle()
    expect(t.screen()).toMatch(/\d+-\d+\/\d+/)
    t.press(`${ESC}[<0;14;1m`) // a release is not a click
    t.press('q')
    await running
    expect(t.out.join('').endsWith(`${ESC}[?1006l${ESC}[?1000l${ESC}[?1004l${ESC}[?25h${ESC}[?1049l`)).toBe(true)
  })
})
