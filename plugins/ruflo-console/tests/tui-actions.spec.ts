/**
 * Actions in the standalone terminal go through the console's own confirm gate (ADR-489 phase 6): the go prompt takes an action by name, a read
 * runs at once, a change raises the console's card (who asked, the exact command, the effect) and runs only on a lone y while the whole card is
 * on screen. A paste, a half-drawn card, another key or a different card never run it. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-actions.spec.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runTui, type TuiIO } from '../tui/run'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const ESC = '\u001b'
let root: string
let project: string
let cli: string
let log: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-actions-'))
  project = join(root, 'project')
  for (const [path, body] of Object.entries(RUFLO_FILES)) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), body)
  }
  // A stand-in for the ruflo CLI: it records the argv it was given and prints a line.
  log = join(root, 'argv.log')
  cli = join(root, 'cli.js')
  writeFileSync(cli, `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n'); console.log('stub ran: ' + process.argv.slice(2).join(' '))\n`)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const settle = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))
const strip = (text: string) => text.replace(/\u001b\[[0-9;?<]*[A-Za-z]/g, '')
/** The commands the CLI stand-in was given, minus the console's own background reads (--version, memory stats, doctor …). */
const ran = (): string[][] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]) : []).filter(argv => argv.some(word => word === 'stop' || (word === 'worker' && argv.includes('list'))))

function terminal(columns = 110, rows = 36) {
  const out: string[] = []
  const listeners: Array<(chunk: string) => void> = []
  const io: TuiIO = {
    stdin: { isTTY: true, setRawMode: () => undefined, on: (_e, fn) => void listeners.push(fn as never), off: () => void listeners.splice(0), resume: () => undefined, pause: () => undefined },
    stdout: { isTTY: true, columns, rows, write: (text: string) => void out.push(text), on: () => undefined, off: () => undefined },
    stderr: { write: () => undefined },
    env: { TERM: 'xterm-256color' },
  }

  return { io, press: (key: string) => listeners.forEach(fn => fn(key)), screen: () => strip(out.join('').split(`${ESC}[H`).pop() ?? ''), type: (text: string) => [...text].forEach(ch => listeners.forEach(fn => fn(ch))) }
}

async function started(columns = 110, rows = 36) {
  const t = terminal(columns, rows)
  const running = runTui({ cwd: project, home: join(root, 'home'), look: 'plain', fps: 0, cliEntry: cli }, t.io)

  await settle()

  return { t, running }
}

const ask = async (t: ReturnType<typeof terminal>, word: string) => {
  t.press(':')
  t.type(word)
  t.press('\r')
  await settle()
}

describe('a change asked for by name', () => {
  it('raises the console\'s card with the exact command, and runs nothing until a y', async () => {
    const before = ran().length
    const { t, running } = await started()

    await ask(t, 'swarm-stop')

    const screen = t.screen()

    expect(screen).toContain('CONFIRM NEEDED')
    expect(screen).toMatch(/runs: .*swarm stop/)
    expect(screen).toContain('y runs')
    expect(ran()).toHaveLength(before)
    t.press('q')
    await running
    expect(ran()).toHaveLength(before)
  })

  it('runs exactly the command the card showed on a lone y, and shows the console own verdict on it', async () => {
    const before = ran().length
    const { t, running } = await started()

    await ask(t, 'swarm-stop')
    t.press('y')
    await settle(600)

    const after = ran().slice(before)

    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(expect.arrayContaining(['swarm', 'stop']))
    // The console's own verdict is shown: the stand-in CLI answered but changed nothing, and the page says so rather than claiming success.
    expect(t.screen()).toContain('stop the swarm: ruflo answered ok')
    expect(t.screen()).not.toContain('CONFIRM NEEDED')
    t.press('q')
    await running
  })

  it('n and Esc drop the card without running it', async () => {
    const before = ran().length
    const { t, running } = await started()

    for (const key of ['n', ESC]) {
      await ask(t, 'swarm-stop')
      expect(t.screen()).toContain('CONFIRM NEEDED')
      t.press(key)
      await settle()
      expect(t.screen()).not.toContain('CONFIRM NEEDED')
    }
    t.press('q')
    await running
    expect(ran()).toHaveLength(before)
  })

  it('is not answered by a paste, by Enter, or by a y inside other text', async () => {
    const before = ran().length
    const { t, running } = await started()

    await ask(t, 'swarm-stop')
    for (const text of ['yy', 'y\n', 'yes', '\r', ' y']) {
      t.press(text)
      await settle(80)
    }
    expect(ran()).toHaveLength(before)
    expect(t.screen()).toContain('CONFIRM NEEDED')
    t.press('n')
    t.press('q')
    await running
  })

  it('is not answered when the window is too small to show the whole card', async () => {
    const before = ran().length
    const { t, running } = await started(60, 9)

    await ask(t, 'swarm-stop')
    t.press('y')
    await settle(500)
    expect(ran()).toHaveLength(before)
    expect(t.screen()).toContain('too small')
    t.press('n')
    t.press('q')
    await running
  })
})

describe('what is not an action', () => {
  it('a name that is in no entry runs nothing (a typo never starts an action), and a page name opens the page', async () => {
    const before = ran().length
    const { t, running } = await started()

    await ask(t, 'swrmstp')
    expect(t.screen()).toContain('no page or action called "swrmstp"')
    await ask(t, 'federation')
    expect(t.screen()).toContain('Federation')
    expect(ran()).toHaveLength(before)
    t.press('q')
    await running
  })

  it('a read runs at once with no card, through the ruflo CLI entry only', async () => {
    const before = ran().length
    const { t, running } = await started()

    await ask(t, 'auto-workers-list')
    await settle(500)
    expect(t.screen()).not.toContain('CONFIRM NEEDED')
    expect(ran().slice(before)[0]).toEqual(expect.arrayContaining(['worker', 'list']))
    t.press('q')
    await running
  })

  it('without a ruflo CLI entry nothing runs and the screen says so', async () => {
    const t = terminal()
    const running = runTui({ cwd: project, home: join(root, 'home'), look: 'plain', fps: 0 }, t.io)
    const before = ran().length

    await settle()
    await ask(t, 'swarm-stop')
    t.press('y')
    await settle(500)
    expect(ran()).toHaveLength(before)
    t.press('q')
    await running
  })
})
