/**
 * `ruflo tui`: the page bar always marks the page that is on screen, the AI page included. The bar used to be painted from the
 * console view the session last showed, and the AI page is not a console view, so on page 6 the bar kept the previous page lit.
 *   npx vitest run plugins/ruflo-console/tests/tui-pagebar.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runTui, type TuiIO } from '../tui/run'
import { TUI_VIEWS } from '../tui/session'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const ESC = '\u001b'
const LABEL: Record<string, string> = { overview: '1 Overview', cost: '2 Cost', swarm: '3 Swarm', events: '4 Events', missions: '5 Missions', ai: '6 AI' }
let root: string
let project: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-pagebar-'))
  project = join(root, 'project')
  for (const [path, body] of Object.entries(RUFLO_FILES)) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), body)
  }
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

  return { io, out, press: (key: string) => listeners.forEach(fn => fn(key)), resize: (c: number, r = rows) => { stdout.columns = c; stdout.rows = r; resizers.forEach(fn => fn()) } }
}

const settle = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms))
/** The page bar (first row) of the last frame drawn, escapes kept. */
const bar = (chunks: string[]) => (chunks.join('').split(`${ESC}[H`).pop() ?? '').split('\r\n')[0] ?? ''
/** The label(s) drawn in reverse video on the bar. */
const lit = (row: string) => [...row.matchAll(/\u001b\[7m ([^\u001b]*) \u001b\[0m/g)].map(match => match[1])

async function run(columns = 100) {
  const t = terminal(columns)
  const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), aiPage: {} }, t.io)

  await settle(250)

  return { ...t, finish: async () => { t.press(`${ESC}`); t.press('q'); await running } }
}

describe('the page bar follows the page on screen', () => {
  for (const [index, view] of TUI_VIEWS.entries()) {
    it(`marks ${LABEL[view]} after the ${index + 1} key and after its letter`, async () => {
      const t = await run()

      // Go somewhere else first, so a stale bar cannot pass by accident.
      t.press(view === 'overview' ? '2' : '1')
      await settle()
      t.press(String(index + 1))
      await settle()
      expect(lit(bar(t.out)), `digit ${index + 1}`).toEqual([LABEL[view]])

      await t.finish()
    })
  }

  it('marks AI, not the page before it, when AI is reached with its letter from Missions', async () => {
    const t = await run()

    t.press('m')
    await settle()
    expect(lit(bar(t.out))).toEqual([LABEL.missions])
    t.press('a')
    await settle()
    expect(lit(bar(t.out))).toEqual([LABEL.ai])
    await t.finish()
  })

  it('marks AI when Tab walks onto it from Missions, and keeps it lit through a resize and a redraw', async () => {
    const t = await run(120)

    t.press('5')
    await settle()
    t.press('\t')
    await settle()
    expect(lit(bar(t.out))).toEqual([LABEL.ai])

    t.resize(90, 24)
    await settle(150)
    expect(lit(bar(t.out)), 'after a resize').toEqual([LABEL.ai])
    await t.finish()
  })

  it('shows the position form on a narrow terminal, with AI as 6/6', async () => {
    const t = await run(50)

    t.press('6')
    await settle()

    const row = (bar(t.out)).replace(/\u001b\[[0-9;]*m/g, '')

    expect(row).toContain('6/6 AI')
    await t.finish()
  })
})
