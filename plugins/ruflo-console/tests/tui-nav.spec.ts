/**
 * `ruflo tui` phase 2 (ADR-489): the six pages, the page bar and keys, resize and narrow terminals, and the chrome that must not
 * be drawn on a host with no Claude session and no mouse. Real ruflo files on disk, an injected terminal, no engine.
 *   npx vitest run plugins/ruflo-console/tests/tui-nav.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { widthOf } from '../tui/ansi'
import { keyLine, keyOf, MIN_COLUMNS, navLine, runTui, type TuiIO } from '../tui/run'
import { openSession, TUI_VIEWS } from '../tui/session'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const ESC = '\u001b'
let root: string
let project: string
let hostile: string

const put = (base: string, files: Record<string, string>) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), body)
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-nav-'))
  project = join(root, 'project')
  hostile = join(root, 'hostile')
  put(project, RUFLO_FILES)
  // A mission record whose objective and blocked reason carry an escape sequence and a token: the Missions page must show words only.
  put(hostile, {
    ...RUFLO_FILES,
    '.claude-flow/missions/observation.json': JSON.stringify({
      schemaVersion: 1,
      contract: 'ruflo.mission-observation/1',
      observedAt: new Date().toISOString(),
      missions: [{ missionId: 'msn_one', objective: `ship it ${ESC}]0;pwned\u0007 ghp_abcdefghijklmnopqrstuvwxyz0123456789`, state: 'blocked', blockedReason: `needs ${ESC}[31mred${ESC}[0m review`, revision: 2, plan: { revision: 1, taskCount: 1, tasks: [{ id: 't1', title: `do ${ESC}[2Jthings`, status: 'ready' }] }, evidence: { count: 1, verified: 0 } }],
    }),
  })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function terminal(columns = 100, rows = 30) {
  const out: string[] = []
  const listeners: Array<(chunk: string) => void> = []
  const resizers: Array<() => void> = []
  const stdout = { isTTY: true, columns, rows, write: (text: string) => void out.push(text), on: (_e: 'resize', fn: () => void) => void resizers.push(fn), off: () => void resizers.splice(0) }
  const io: TuiIO = {
    stdin: { isTTY: true, setRawMode: () => undefined, on: (_e, fn) => void listeners.push(fn as never), off: () => void listeners.splice(0), resume: () => undefined, pause: () => undefined },
    stdout,
    stderr: { write: () => undefined },
    env: { TERM: 'xterm-256color' },
  }

  return { io, out, stdout, press: (key: string) => listeners.forEach(fn => fn(key)), resize: (c: number, r = rows) => { stdout.columns = c; stdout.rows = r; resizers.forEach(fn => fn()) } }
}

const settle = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms))
const plain = (screen: string) => screen.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
/** The lines of the last frame drawn (a frame starts at cursor-home), as plain text. */
const lastFrame = (chunks: string[]) => plain((chunks.join('').split(`${ESC}[H`).pop() ?? '').replace(/\r/g, '')).split('\n')

describe('keys', () => {
  it('maps digits and letters to the pages, tab and arrows to neighbours, and ignores the rest', () => {
    expect(TUI_VIEWS).toEqual(['overview', 'cost', 'swarm', 'events', 'missions', 'ai'])
    expect(['1', '2', '3', '4', '5', '6'].map(keyOf)).toEqual(TUI_VIEWS.map(page => ({ page })))
    expect([keyOf('o'), keyOf('c'), keyOf('s'), keyOf('e'), keyOf('m'), keyOf('a')]).toEqual([{ page: 'overview' }, { page: 'cost' }, { page: 'swarm' }, { page: 'events' }, { page: 'missions' }, { page: 'ai' }])
    expect([keyOf('\t'), keyOf(`${ESC}[C`), keyOf('l')]).toEqual(['next', 'next', 'next'])
    expect([keyOf(`${ESC}[Z`), keyOf(`${ESC}[D`), keyOf('h')]).toEqual(['prev', 'prev', 'prev'])
    expect([keyOf('7'), keyOf('8'), keyOf('9'), keyOf('x'), keyOf(`${ESC}]0;t\u0007`)]).toEqual([null, null, null, null, null])
  })

  it('has no key for Room: its content is a message box and Claude sessions this host does not have', () => {
    expect(keyOf('R')).toBeNull()
    expect(TUI_VIEWS as readonly string[]).not.toContain('room')
  })
})

describe('page bar and key line', () => {
  it('lists the pages with the current one marked, and shortens to a position when narrow', () => {
    expect(navLine('swarm', 100, 'none')).toBe(' 1 Overview   2 Cost  [3 Swarm]  4 Events   5 Missions   6 AI ')
    expect(navLine('swarm', 100, '256')).toContain(`${ESC}[7m 3 Swarm ${ESC}[0m`)
    expect(navLine('swarm', 59, 'none')).toBe('‹ 3/6 Swarm ›')
    expect(widthOf(navLine('missions', 60, '256'))).toBeLessThanOrEqual(60)
  })

  it('has a short key line for a narrow terminal and says ask first on a wide one', () => {
    expect(keyLine(100)).toContain('ask first')
    expect(keyLine(100)).toContain('q quit')
    expect(keyLine(50)).toBe('1-6 page · j/k scroll · q quit')
    expect(keyLine(25)).toBe('1-6 page · q quit')
    for (const columns of [40, 50, 59, 60, 70, 80, 99, 120]) for (const place of ['', ' · 1-18/42']) expect(widthOf(keyLine(columns, place)), `${columns}${place}`).toBeLessThanOrEqual(columns)
  })
})

describe('every page, on a host with no Claude session and no mouse', () => {
  for (const columns of [80, 120]) {
    it(`draws all six pages at ${columns} columns, no wider than the terminal, with none of Claude Code's chrome`, async () => {
      for (const view of TUI_VIEWS) {
        const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), aiPage: {} })

        try {
          session.show(view)
          await session.refresh()

          const lines = session.frame(columns, 'none')
          const text = lines.join('\n')

          expect(lines.length, view).toBeGreaterThan(3)
          for (const line of lines) expect(widthOf(line), `${view}: ${line}`).toBeLessThanOrEqual(columns)
          // Claude Code's surface: Ask Claude, the Claude-control card, the footer and tab buttons, hotkey brackets.
          expect(text, view).not.toMatch(/ask claude|✦|Claude control|Take back control/i)
          expect(text, view).not.toMatch(/Palette|Actions\]|\bClose\b|\[\s*[0-9a-z]\s{2}/)
          expect(text, view).not.toMatch(/\[[^\]\n]*[▸▶⇩⧉🔔★][^\]\n]*\]/)
        } finally {
          session.stop()
        }
      }
    })
  }

  it('the Missions page reads the mission record only: no goal field, no plan, no research launch', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') })

    try {
      session.show('missions')
      await session.refresh()

      const text = session.frame(100, 'none').join('\n')

      expect(text).toContain('Mission record')
      expect(text).not.toMatch(/goal:|Plan options|Start research|use the palette/i)
    } finally {
      session.stop()
    }
  })

  it('hostile mission text: words only reach the screen (no escape, no token)', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: hostile, home: join(root, 'home') })

    try {
      session.show('missions')
      await session.refresh()

      const text = session.frame(120, '256').join('\n')

      expect(text).toContain('msn_one')
      expect(text).not.toContain(']0;pwned')
      expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
      expect(text.replace(/\u001b\[[0-9;]*m/g, '')).not.toContain(ESC)
    } finally {
      session.stop()
    }
  })
})

describe('the terminal loop', () => {
  it('a terminal that reports 0 columns draws the page at the default width, not a repeated "T" (#4115)', async () => {
    const t = terminal(0, 0)
    const running = runTui({ cwd: project, home: join(root, 'home') }, t.io)

    await settle()
    t.press('q')
    await expect(running).resolves.toBe(0)

    const text = plain(t.out.join(''))

    expect(text).toMatch(/1 Overview {1,3}2 Cost/)
    expect(text).not.toContain('Too narrow')
  })

  it('jumps to a page on a digit, cycles with tab and shift-tab, and the page bar follows', async () => {
    const t = terminal()
    const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, t.io)

    await settle()
    t.press('3')
    t.press('\t')
    t.press(`${ESC}[Z`)
    t.press('e')
    t.press('5')
    t.press('q')
    await expect(running).resolves.toBe(0)

    const bars = plain(t.out.join('')).match(/1 Overview {1,3}2 Cost {1,3}3 Swarm {1,3}4 Events {1,3}5 Missions {1,3}6 AI/g) ?? []

    expect(bars.length).toBeGreaterThanOrEqual(5)
    expect(t.out.join('')).toContain(`${ESC}[7m 3 Swarm ${ESC}[0m`)
    expect(t.out.join('')).toContain(`${ESC}[7m 4 Events ${ESC}[0m`)
    expect(t.out.join('')).toContain(`${ESC}[7m 5 Missions ${ESC}[0m`)
  })

  it('highlights 6 AI in the page bar on the AI page, started there or reached by key (not the page before it)', async () => {
    const started = terminal()
    const first = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), view: 'ai', aiPage: { codexBin: '/nonexistent/codex' } }, started.io)

    await settle()
    started.press('\u0003')
    await first

    const reached = terminal()
    const second = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), aiPage: { codexBin: '/nonexistent/codex' } }, reached.io)

    await settle()
    reached.press('5')
    reached.press('6')
    await settle(50)
    reached.press('\u0003')
    await second

    // The bar is checked in the raw output (the reverse-video mark is an escape): the AI page is marked, the page before it is not.
    const startedOut = started.out.join('')
    const reachedOut = reached.out.join('')

    expect(startedOut, 'started on ai').toContain(`${ESC}[7m 6 AI ${ESC}[0m`)
    expect(startedOut, 'started on ai').not.toContain(`${ESC}[7m 1 Overview`)
    expect(reachedOut, 'reached with 6').toContain(`${ESC}[7m 5 Missions ${ESC}[0m`)
    expect(reachedOut.slice(reachedOut.lastIndexOf(`${ESC}[7m `)), 'reached with 6').toContain(`${ESC}[7m 6 AI ${ESC}[0m`)
  })

  it('fills the terminal exactly: the page bar on the first row, the key line on the last', async () => {
    for (const rows of [24, 40]) {
      const t = terminal(100, rows)
      const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, t.io)

      await settle()
      t.press('4')
      await settle(50)
      t.press('q')
      await running

      const frame = lastFrame(t.out)

      expect(frame, `${rows} rows`).toHaveLength(rows)
      expect(frame[0]).toContain('4 Events')
      expect(frame[rows - 1]).toMatch(/^1-6 or o c s e m a page/)
    }
  })

  it('redraws at the new width on a resize, clearing the screen first', async () => {
    const t = terminal(120, 30)
    const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, t.io)

    await settle()

    const before = t.out.length

    t.resize(70, 20)
    await settle(50)

    const after = t.out.slice(before).join('')

    expect(after.startsWith(`${ESC}[2J`)).toBe(true)
    for (const line of lastFrame(t.out)) expect(widthOf(line), line).toBeLessThanOrEqual(70)
    t.press('q')
    await running
  })

  it('under 60 columns it draws the position bar and the short key line; under 40 it says how wide it needs to be', async () => {
    const narrow = terminal(52, 24)
    const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, narrow.io)

    await settle()
    expect(plain(narrow.out.join(''))).toContain('‹ 1/6 Overview ›')
    expect(plain(narrow.out.join(''))).toContain('1-6 page · j/k scroll · q quit')
    for (const line of lastFrame(narrow.out)) expect(widthOf(line), line).toBeLessThanOrEqual(52)

    const before = narrow.out.length

    narrow.resize(MIN_COLUMNS - 1)
    await settle(50)
    expect(plain(narrow.out.slice(before).join(''))).toContain('Too narrow: need 40 columns')
    narrow.press('q')
    await expect(running).resolves.toBe(0)
  })

  it('--plain prints the page bar then the frame, with no escapes, for any page', async () => {
    for (const view of TUI_VIEWS) {
      const out: string[] = []
      const code = await runTui(
        { cwd: project, home: join(root, 'home'), plain: true, view },
        { stdin: { on: () => undefined, off: () => undefined, resume: () => undefined, pause: () => undefined }, stdout: { columns: 90, rows: 30, write: text => void out.push(text) }, stderr: { write: () => undefined }, env: {} },
      )
      const text = out.join('')

      expect(code).toBe(0)
      expect(text).not.toContain(ESC)
      expect(text.split('\n')[0]).toContain(`[${{ overview: '1 Overview', cost: '2 Cost', swarm: '3 Swarm', events: '4 Events', missions: '5 Missions', ai: '6 AI' }[view]}]`)
    }
  })
})
