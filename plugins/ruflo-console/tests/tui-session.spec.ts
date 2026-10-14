/**
 * `ruflo tui` end to end without a terminal (ADR-489): real ruflo files on disk, the mod's own controller and views over the Node
 * host, drawn by the mod's own page bodies in the standalone pane, headless and with an injected terminal. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-session.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { depthOf, keyOf, NOT_A_TERMINAL_HINT, runTui, type TuiIO } from '../tui/run'
import { openSession } from '../tui/session'
import { RUFLO_FILES } from './fixtures/ruflo-run'

let root: string
let project: string
let hostile: string

const ESC = '\u001b'
const put = (base: string, files: Record<string, string>) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), body)
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-session-'))
  project = join(root, 'project')
  hostile = join(root, 'hostile')
  put(project, RUFLO_FILES)
  // The same project with an escape sequence and a token where a swarm id and topology are read from disk (both files that name it).
  put(hostile, { ...RUFLO_FILES, '.swarm/state.json': JSON.stringify({ id: `swarm-\u001b]0;pwned\u0007-1`, topology: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', status: 'running' }), '.claude-flow/swarm/swarm-state.json': JSON.stringify({ swarms: { 'swarm-1': { swarmId: `swarm-\u001b]0;pwned\u0007-1`, topology: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', status: 'running', agents: [] } } }) })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function fakeIO(isTTY: boolean) {
  const out: string[] = []
  const err: string[] = []
  const listeners: Array<(chunk: string) => void> = []
  const raw: boolean[] = []
  const io: TuiIO = {
    stdin: { isTTY, setRawMode: isTTY ? on => void raw.push(on) : undefined, on: (_e, fn) => void listeners.push(fn as never), off: () => void listeners.splice(0), resume: () => undefined, pause: () => undefined },
    stdout: { isTTY, columns: 100, rows: 30, write: text => void out.push(text) },
    stderr: { write: text => void err.push(text) },
    env: { TERM: 'xterm-256color' },
  }

  return { io, out, err, raw, press: (key: string) => listeners.forEach(fn => fn(key)) }
}

describe('the same views over real ruflo files', () => {
  it('Overview shows the swarm, the daemon and the helpers read from disk', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') })

    await session.refresh()
    const text = session.frame(110, 'none').join('\n')

    expect(text).toContain('swarm-1790903031804-y9rnjr')
    expect(text).toContain('running per daemon-state.json')
    expect(text).toContain('manifest v3.32.24')
    expect(text).toContain('Overview')
    session.stop()
  })

  it('Cost shows its sections and says n/a for what only the Claude Code host can measure', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') })

    await session.refresh()
    session.show('cost')
    const text = session.frame(110, 'none').join('\n')

    expect(text).toContain('Where it goes')
    expect(text).toContain('Alert thresholds')
    expect(text).toMatch(/Claude Code\s+n\/a/)
    session.stop()
  })

  it('is the mod\'s own tree: the standalone frame carries the same pane header the mod draws', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') })

    await session.refresh()
    expect(session.frame(110, 'none').join('\n')).toContain('what ruflo is doing here')
    session.stop()
  })

  it('hostile ruflo files: no escape from content and no token reach the frame (the data layer refuses the id, the renderer strips the rest)', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: hostile, home: join(root, 'home') })

    await session.refresh()
    for (const depth of ['none', '256'] as const) {
      const text = session.frame(110, depth).join('\n')

      expect(text).toContain('Subsystems')
      expect(text).not.toContain('pwned')
      expect(text).not.toContain('ghp_abcdefghij')
      expect(text.match(/\u001b\[[0-9;]*m/g)?.length ?? 0).toBe(depth === 'none' ? 0 : text.match(/\u001b/g)?.length)
    }
    session.stop()
  })

  it.each([
    ['escapes only: the words stay, the sequences go', 'boom \u001b]0;pwned\u0007\u001b[2J\u009b31m end', /exit 1: .*boom.* end/],
    ['an escape and a token: the whole line is withheld', 'boom \u001b]0;pwned\u0007 ghp_abcdefghijklmnopqrstuvwxyz0123456789 end', /line withheld/],
  ])('what a failing child prints reaches the frame as clean text (stderr is not JSON, so no data layer in front): %s', async (_name, stderr, expected) => {
    const base = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }).host
    const hostileRun = async () => ({ exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false })
    const session = openSession({ look: 'plain', fps: 0, cwd: project }, { ...base, run: hostileRun })

    await session.refresh()
    await session.refresh()
    for (const depth of ['none', '256'] as const) {
      const text = session.frame(110, depth).join('\n')

      expect(text).toMatch(expected)
      expect(text).not.toContain('pwned')
      expect(text).not.toContain('ghp_abcdefghij')
      expect(text.match(/\u001b/g)?.length ?? 0).toBe(text.match(/\u001b\[[0-9;]*m/g)?.length ?? 0)
    }
    session.stop()
  })

  it('never calls the engine: every host call the controller made was a read or a refusal', async () => {
    const ran: string[][] = []
    const calls: string[] = []
    const base = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }).host
    const spy = new Proxy(base, { get: (target, key: string) => (typeof target[key as keyof typeof target] === 'function' ? (...args: never[]) => (calls.push(key), (target[key as keyof typeof target] as (...a: never[]) => unknown)(...args)) : target[key as keyof typeof target]) })
    const session = openSession({ look: 'plain', fps: 0, cwd: project }, { ...spy, run: async argv => (ran.push([...argv]), Promise.reject(new Error('no program'))) })

    await session.refresh()
    expect(calls.filter(call => ['openPane', 'blit', 'toolCall', 'submitPrompt', 'spawn', 'askChoice'].includes(call))).toEqual([])
    expect(ran.length).toBeGreaterThan(0)
    expect(ran.every(argv => argv[0] === 'npx' || argv[0] === 'claude')).toBe(true)
    session.stop()
  })
})

describe('headless', () => {
  it('--plain prints one plain frame to stdout, nothing to stderr, and returns 0', async () => {
    const { io, out, err } = fakeIO(false)
    const code = await runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), plain: true }, io)

    expect(code).toBe(0)
    expect(out.join('')).toContain('swarm-1790903031804-y9rnjr')
    expect(out.join('')).not.toContain(ESC)
    expect(err.join('')).toBe('')
  })

  it('--plain opens the page asked for', async () => {
    const { io, out } = fakeIO(false)

    await runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), view: 'cost', plain: true }, io)
    expect(out.join('')).toContain('Where it goes')
  })

  it('--plain in a real terminal still prints one frame and never enters the alternate screen or raw mode', async () => {
    const { io, out, raw } = fakeIO(true)
    const code = await runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home'), plain: true }, io)

    expect(code).toBe(0)
    expect(out.join('')).toContain('swarm-1790903031804-y9rnjr')
    expect(out.join('')).not.toContain(ESC)
    expect(raw).toEqual([])
  })

  it('without a terminal and without --plain prints a one-line hint to stderr and returns 2, with nothing on stdout', async () => {
    const { io, out, err } = fakeIO(false)
    const code = await runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, io)

    expect(code).toBe(2)
    expect(out).toEqual([])
    expect(err.join('')).toBe(NOT_A_TERMINAL_HINT)
    expect(NOT_A_TERMINAL_HINT.trimEnd().split('\n')).toHaveLength(1)
    expect(NOT_A_TERMINAL_HINT).toMatch(/--plain/)
  })

  it('a terminal that cannot do raw mode counts as no terminal', async () => {
    const { io, out, err } = fakeIO(true)
    const code = await runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, { ...io, stdin: { ...io.stdin, setRawMode: undefined } })

    expect(code).toBe(2)
    expect(out).toEqual([])
    expect(err.join('')).toBe(NOT_A_TERMINAL_HINT)
  })
})

describe('interactive', () => {
  it('enters the alternate screen, switches page on a key, and restores the terminal on q', async () => {
    const { io, out, raw, press } = fakeIO(true)
    const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, io)

    await new Promise(resolve => setTimeout(resolve, 150))
    press('c')
    press('j')
    press('q')
    await expect(running).resolves.toBe(0)

    const screen = out.join('')

    expect(screen.startsWith(`${ESC}[?1049h`)).toBe(true)
    expect(screen).toContain('Where it goes')
    expect(screen).toContain('2 Cost')
    expect(screen.endsWith(`${ESC}[?25h${ESC}[?1049l`)).toBe(true)
    expect(raw).toEqual([true, false])
  })

  it('restores the terminal when the signal aborts', async () => {
    const { io, out, raw } = fakeIO(true)
    const stop = new AbortController()
    const running = runTui({ look: 'plain', fps: 0, cwd: project, home: join(root, 'home') }, { ...io, signal: stop.signal })

    await new Promise(resolve => setTimeout(resolve, 100))
    stop.abort()
    await expect(running).resolves.toBe(0)
    expect(out.join('').endsWith(`${ESC}[?1049l`)).toBe(true)
    expect(raw).toEqual([true, false])
  })
})

describe('keys and colour depth', () => {
  it('maps the documented keys and ignores the rest', () => {
    expect([keyOf('q'), keyOf('\u0003'), keyOf('o'), keyOf('c'), keyOf('r'), keyOf('j'), keyOf(`${ESC}[A`), keyOf(' ')]).toEqual(['quit', 'quit', { page: 'overview' }, { page: 'cost' }, 'refresh', 'down', 'up', 'pagedown'])
    expect([keyOf('x'), keyOf(`${ESC}]0;t\u0007`), keyOf('')]).toEqual([null, null, null])
  })

  it('picks the colour depth from the environment', () => {
    expect(depthOf({ NO_COLOR: '1', TERM: 'xterm' })).toBe('none')
    expect(depthOf({ TERM: 'dumb' })).toBe('none')
    expect(depthOf({})).toBe('none')
    expect(depthOf({ TERM: 'xterm-256color' })).toBe('256')
    expect(depthOf({ TERM: 'xterm', COLORTERM: 'truecolor' })).toBe('truecolor')
  })
})
