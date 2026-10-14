/**
 * The AI page (ADR-489 phase 3, decision D) end to end without a network or a real Codex: a stub fetch for OpenRouter and the fake pinned
 * Codex. Every send waits for a card that was drawn; a key is read by name and never reaches a frame; the reply's cost is the provider's.
 *   npx vitest run plugins/ruflo-console/tests/tui-ai-page.spec.ts
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { widthOf } from '../tui/ansi'
import { runTui, type TuiIO } from '../tui/run'
import { openSession } from '../tui/session'

const FAKE = join(__dirname, 'fixtures', 'fake-codex.mjs')
const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const ESC = '\u001b'
const isWin = process.platform === 'win32'
let root: string
let project: string
let codexHome: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-ai-page-'))
  project = join(root, 'project')
  codexHome = join(root, 'codex-home')
  mkdirSync(project, { recursive: true })
  mkdirSync(codexHome, { recursive: true })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))
beforeEach(() => void (process.env.OPENROUTER_API_KEY = KEY))
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
  delete process.env.CODEX_HOME
  vi.useRealTimers()
})

const reply = (content: string, cost = 0.004) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 7, cost }, model: 'stub/model' })

function open(extra: { maxSpendUsd?: number; model?: string; body?: unknown; status?: number } = {}) {
  const fetchSpy = vi.fn(async (_url: unknown, _init?: unknown) => new Response(JSON.stringify(extra.body ?? reply('hello from the stub')), { status: extra.status ?? 200 }))
  const session = openSession({ look: 'plain', fps: 0, cwd: project, home: root, aiPage: { codexBin: FAKE, fetch: fetchSpy as never, ...(extra.maxSpendUsd !== undefined && { maxSpendUsd: extra.maxSpendUsd }), ...(extra.model !== undefined && { model: extra.model }) } })

  session.show('ai')

  return { session, ai: session.ai!, fetchSpy }
}

const type = (ai: NonNullable<ReturnType<typeof open>['ai']>, text: string) => void ai.press(text)
const frame = (session: ReturnType<typeof open>['session'], columns = 100, rows = 30) => session.frame(columns, 'none', rows).join('\n')
/** A frame with the card's border and wrapping folded away, so a phrase that wrapped is still found. */
const flat = (text: string) => text.replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ')
const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms

  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20))
  expect(check()).toBe(true)
}
const body = (spy: ReturnType<typeof open>['fetchSpy']) => JSON.parse((spy.mock.calls[0]?.[1] as { body: string }).body) as { model: string; messages: { content: string }[] }

describe('OpenRouter', () => {
  it('Enter shows a card of exactly what would be sent and sends nothing', () => {
    const { session, ai, fetchSpy } = open({ model: 'stub/model' })

    ai.press('\u0014')
    type(ai, 'what is two plus two')
    ai.press('\r')

    const text = frame(session)

    expect(ai.card).toMatchObject({ target: 'openrouter', text: 'what is two plus two' })
    expect(text).toContain('Ask first, #1')
    expect(flat(text)).toContain('POST https://openrouter.ai/api/v1/chat/completions')
    expect(flat(text)).toContain('Authorization: Bearer ‹from $OPENROUTER_API_KEY›')
    expect(flat(text)).toContain('"model":"stub/model"')
    expect(text).toContain('y sends it')
    expect(text).not.toContain(KEY)
    expect(fetchSpy).not.toHaveBeenCalled()
    session.stop()
  })

  it('a y before the card was on screen answers nothing; once drawn, it sends one request with the key in one header', async () => {
    const { session, ai, fetchSpy } = open({ model: 'stub/model' })

    ai.press('\u0014')
    type(ai, 'hello')
    ai.press('\r')
    ai.press('y')
    expect(ai.notice).toMatch(/not on screen yet/)
    expect(fetchSpy).not.toHaveBeenCalled()

    frame(session)
    ai.drawn()
    ai.press('y')
    await until(() => fetchSpy.mock.calls.length === 1 && session.state.terminal.lines.some(line => line.kind === 'end'))

    const [url, init] = fetchSpy.mock.calls[0] as [URL, { method: string; headers: Record<string, string>; redirect: string }]

    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(body(fetchSpy)).toMatchObject({ model: 'stub/model', messages: [{ role: 'user', content: 'hello' }] })

    const text = frame(session)

    expect(text).toContain('hello from the stub')
    expect(text).toContain('$0.004000')
    expect(text).not.toContain(KEY)
    expect(ai.spentUsd).toBeCloseTo(0.004, 6)
    session.stop()
  })

  it('masks the key if the provider echoes it, and strips escape sequences from a reply', async () => {
    const { session, ai } = open({ body: reply(`your key is ${KEY} ${ESC}]0;pwned\u0007 and ${ESC}[2J gone`) })

    ai.press('\u0014')
    type(ai, 'echo it')
    ai.press('\r')
    frame(session)
    ai.drawn()
    ai.press('y')
    await until(() => session.state.terminal.lines.some(line => line.kind === 'end'))

    const text = frame(session)

    expect(text).not.toContain(KEY)
    expect(text).not.toContain(']0;pwned')
    expect(frame(session, 100, 30)).not.toContain(ESC)
    session.stop()
  })

  it('stops at the spend cap using the provider-reported cost, and says why', async () => {
    const { session, ai, fetchSpy } = open({ maxSpendUsd: 0.004 })

    ai.press('\u0014')
    type(ai, 'one')
    ai.press('\r')
    frame(session)
    ai.drawn()
    ai.press('y')
    await until(() => session.state.terminal.lines.some(line => line.kind === 'end'))
    type(ai, 'two')
    ai.press('\r')
    expect(ai.card).toBeNull()
    expect(ai.notice).toMatch(/spend cap is reached \(reported \$0\.004000 of \$0\.004000\)/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    session.stop()
  })

  it('refuses without a key, naming the variable and never a value', async () => {
    delete process.env.OPENROUTER_API_KEY

    const { session, ai, fetchSpy } = open()

    ai.press('\u0014')
    type(ai, 'hi')
    ai.press('\r')
    frame(session)
    ai.drawn()
    ai.press('y')
    await until(() => session.state.terminal.lines.some(line => line.kind === 'err'))
    expect(session.state.terminal.lines.map(line => line.text).join('\n')).toMatch(/\$OPENROUTER_API_KEY is not set/)
    expect(fetchSpy).not.toHaveBeenCalled()
    session.stop()
  })

  it('a card expires after 60 s with no answer and then runs nothing', () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { session, ai, fetchSpy } = open()

    ai.press('\u0014')
    type(ai, 'late')
    ai.press('\r')
    frame(session)
    ai.drawn()
    vi.setSystemTime(Date.now() + 61_000)
    ai.press('y')
    expect(ai.card).toBeNull()
    expect(ai.notice).toMatch(/expired after 60 s/)
    expect(fetchSpy).not.toHaveBeenCalled()
    session.stop()
  })

  it('n and Esc cancel, a replaced card is the only one a y answers, and pasted text is never an answer', () => {
    const { session, ai, fetchSpy } = open()

    ai.press('\u0014')
    type(ai, 'first')
    ai.press('\r')
    ai.press('n')
    expect(ai.card).toBeNull()
    type(ai, 'second')
    ai.press('\r')
    expect(ai.card?.id).toBe(2)
    ai.press(ESC)
    expect(ai.card).toBeNull()
    // A paste with a newline and a y in it is text, not an Enter and not an answer.
    type(ai, 'pasted\ry')
    expect(ai.draft).toBe('pastedy')
    expect(ai.card).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    session.stop()
  })

  it('refuses a message that looks like a credential before a card is made', () => {
    const { session, ai } = open()

    ai.press('\u0014')
    type(ai, `use this ${KEY} please`)
    ai.press('\r')
    expect(ai.card).toBeNull()
    expect(ai.notice).not.toBeNull()
    expect(frame(session)).not.toContain(KEY)
    session.stop()
  })
})

describe('Codex', () => {
  it.skipIf(isWin)('Ctrl-T picks Codex; the card shows a read-only argv; y runs the pinned fake with the prompt on stdin and streams its answer', async () => {
    process.env.CODEX_HOME = codexHome

    const { session, ai } = open()

    expect(ai.target).toBe('codex')
    type(ai, 'summarize this repo')
    ai.press('\r')

    const card = flat(frame(session))

    expect(card).toContain('Ask first, #1')
    expect(card).toContain('codex exec --json --sandbox read-only --skip-git-repo-check -')
    expect(card).toContain('prompt on stdin: "summarize this repo"')
    expect(card).toContain('Codex 0.162.0, read-only')
    expect(card).not.toMatch(/danger-full-access|--yolo|workspace-write/)
    ai.drawn()
    ai.press('y')
    await until(() => session.state.terminal.lines.some(line => line.kind === 'end'))

    const ran = JSON.parse(readFileSync(join(codexHome, 'fake-codex.log'), 'utf8').trim().split('\n').pop() as string) as { args: string[]; input: string }
    const text = frame(session)

    expect(ran.args).toEqual(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'])
    expect(ran.input).toBe('summarize this repo')
    expect(text).toContain('echo: summarize this repo')
    expect(text).toContain('and a second line')
    expect(text).not.toContain(']0;pwned')
    expect(session.state.terminal.sessions.codex).toBe('019f0000-aaaa-bbbb-cccc-000000000001')
    session.stop()
  })

  it('without the pinned release the answer says so and nothing falls back to PATH or current', async () => {
    const session = openSession({ look: 'plain', fps: 0, cwd: project, home: join(root, 'no-codex-here'), aiPage: { fetch: vi.fn() as never } })

    session.show('ai')

    const ai = session.ai!

    type(ai, 'hi')
    ai.press('\r')
    frame(session)
    ai.drawn()
    ai.press('y')
    await until(() => session.state.terminal.lines.some(line => line.kind === 'end'))
    expect(session.state.terminal.lines.map(line => line.text).join('\n')).toMatch(/pinned Codex 0\.162\.0 is not installed/)
    session.stop()
  })
})

describe('the page', () => {
  it('Esc hands the keys back to the shell and i takes them again; Ctrl-C is never typed', () => {
    const { session, ai } = open()

    expect(ai.press('7').consumed).toBe(true)
    expect(ai.draft).toBe('7')
    expect(ai.press(ESC).consumed).toBe(true)
    expect(ai.mode).toBe('nav')
    expect(ai.press('3').consumed).toBe(false)
    expect(ai.press('i').consumed).toBe(true)
    expect(ai.mode).toBe('type')
    expect(ai.press('\u0003').consumed).toBe(false)
    expect(ai.draft).toBe('7')
    session.stop()
  })

  it('fits every width and height: no line wider than the terminal, no more rows than it has', () => {
    const { session, ai } = open()

    ai.press('\u0014')
    type(ai, 'a long question '.repeat(20))
    ai.press('\r')

    for (const [columns, rows] of [[40, 12], [60, 20], [80, 24], [120, 40]] as const) {
      const lines = session.frame(columns, 'none', rows)

      expect(lines.length, `${columns}x${rows}`).toBeLessThanOrEqual(rows - 2)
      for (const line of lines) expect(widthOf(line), line).toBeLessThanOrEqual(columns)
    }
    session.stop()
  })

  it('--plain prints the status and an empty conversation, and is off with no AI options', async () => {
    const out: string[] = []
    const io = (): TuiIO => ({ stdin: { on: () => undefined, off: () => undefined, resume: () => undefined, pause: () => undefined }, stdout: { columns: 100, rows: 30, write: text => void out.push(text) }, stderr: { write: () => undefined }, env: {} })

    expect(await runTui({ look: 'plain', fps: 0, cwd: project, home: root, plain: true, view: 'ai', aiPage: { codexBin: FAKE } }, io())).toBe(0)
    expect(out.join('')).toMatch(/codex .*ready|codex .*pinned/)
    expect(out.join('')).toContain('openrouter')
    expect(out.join('')).not.toContain(KEY)
    out.length = 0
    expect(await runTui({ look: 'plain', fps: 0, cwd: project, home: root, plain: true, view: 'ai' }, io())).toBe(0)
    expect(out.join('')).toContain('The AI page is off')
  })
})
