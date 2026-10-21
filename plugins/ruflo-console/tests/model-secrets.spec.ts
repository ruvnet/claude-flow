/**
 * What console_state hands the model from the terminal page: an x.ruv.io invite code minted there (a bearer secret, xruv.ts
 * INVITE_COMMAND) is masked in the scrollback itself, and a line holding any other secret shape is withheld whole. Real code
 * paths: the ruflo harness runs the INVITES row's command through a fake spawn, then callTool reads the console.
 */
import { describe, expect, it, vi } from 'vitest'

import { send, termText } from '../hooks/harness'
import type { Host } from '../hooks/host'
import { callTool, type ModelToolDeps } from '../hooks/model-tools'
import { settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'
import { INVITE_COMMAND, maskInvites } from '../hooks/xruv'

const CODE = 'v2.Zk3pQ9rT_u7WmB2xL0aYc4N'
// Built at run time so no token-shaped literal sits in this source.
const TOKEN = `ghp_${'Ab3'.repeat(12)}`

function fakeSpawn(stdout: string) {
  return (_argv: readonly string[]) => {
    const stream = (async function* () {
      yield { stream: 'stdout', text: stdout }

      return { code: 0, signal: null }
    })()

    return Object.assign(stream, { result: Promise.resolve({ code: 0, signal: null }), return: async () => ({ done: true, value: undefined }) }) as never
  }
}

/** Every action is a no-op: the view only needs the closures to exist. */
const deepNoop = (): unknown => new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : deepNoop()) })

const settled = async (state: State) => {
  for (let i = 0; i < 100 && (state.terminal.runs.size > 0 || i < 2); i++) await new Promise(resolve => setTimeout(resolve, 2))
}

/** Runs one ruflo command whose output is `stdout`, opens the terminal page as the model, and returns what console_state answers. */
async function stateAfter(command: string, stdout: string): Promise<{ state: State; answer: string }> {
  const state = newState({})
  const host = { spawn: fakeSpawn(stdout), invalidate: () => undefined, after: () => ({ cancel: () => undefined }), storeSet: async () => undefined, focus: async () => undefined } as unknown as Host

  state.terminal.harness = 'ruflo'
  send(state, host, command)
  await settled(state)

  expect(settingsOf(state).ai.modelControl).toBe('read')
  const control = { host, setView: (view: State['view']) => void (state.view = view), open: async () => undefined, actions: deepNoop(), runner: {} }
  const deps = { state, control } as unknown as ModelToolDeps

  expect(await callTool('console_open', { view: 'terminal' }, deps)).toMatch(/^Opened/)

  return { state, answer: await callTool('console_state', {}, deps) }
}

describe('console_state never carries a secret from the terminal', () => {
  it('a minted invite code is masked in the scrollback and never reaches the model', async () => {
    const { state, answer } = await stateAfter(INVITE_COMMAND, `[OK] Invite minted\n{\n  "code": "${CODE}",\n  "maxUses": 25\n}\n`)

    expect(state.terminal.lines.some(line => line.text.includes(CODE))).toBe(false)
    expect(state.terminal.lines.some(line => line.text.includes('invite code, masked'))).toBe(true)
    expect(answer).not.toContain(CODE)
    expect(answer).toContain('maxUses')
  })

  it('a line with a token in it is withheld from the model whole, and the lines around it are not', async () => {
    const { answer } = await stateAfter('config get', `before the token\nexport GITHUB_TOKEN=${TOKEN}\nafter the token\n`)

    expect(answer).not.toContain(TOKEN)
    expect(answer).toContain('looks like a secret: not shown')
    expect(answer).toContain('before the token')
    expect(answer).toContain('after the token')
  })

  it('a version with the invite prefix stays readable', () => {
    expect(maskInvites('upgraded to v2.1.0-beta.3')).toBe('upgraded to v2.1.0-beta.3')
    expect(termText(`code ${CODE} here`)).toBe('code v2.•••• (invite code, masked) here')
  })
})

describe('a result or a waiting note never carries a secret to the model', () => {
  it('lastResult.detail and waiting.note in console_state withhold a token or an invite code', async () => {
    const { state } = await stateAfter('memory list', '[OK] nothing\n')
    const control = { host: { invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }, setView: () => undefined, open: async () => undefined, actions: deepNoop(), runner: {} }
    const deps = { state, control } as unknown as ModelToolDeps

    state.outcome = { label: 'run it', ok: false, verified: 'n/a', detail: `failed: ${TOKEN}`, atMs: Date.now() }
    state.pending = { label: 'next', args: [], expect: 'x', askedAtMs: Date.now(), note: `invite ${CODE}` }
    const answer = await callTool('console_state', {}, deps)

    expect(answer).not.toContain(TOKEN)
    expect(answer).not.toContain(CODE)
  })

  it('a console_run answer withholds a token in the failed run\'s detail', async () => {
    const { setup } = await import('./fixtures/control-setup')
    const { state, deps } = setup('write', 'auto', { 'mission-open': { label: 'open Mission Control', readOnly: true } })
    const runner = (deps as unknown as { control: { runner: { runById: (id: string) => boolean } } }).control.runner

    runner.runById = () => ((state.outcome = { label: 'open Mission Control', ok: false, verified: 'n/a', detail: `stderr: ${TOKEN}`, atMs: Date.now() + 1 }), true)
    const answer = await callTool('console_run', { id: 'mission-open' }, deps)

    expect(answer).toMatch(/Failed/)
    expect(answer).not.toContain(TOKEN)
  })
})

describe('the shared escape set stays linear', () => {
  it('a long run of OSC introducers with no terminator cleans in linear time', () => {
    const t0 = Date.now()

    termText('\u009d'.repeat(100_000))
    termText(`x${'\u009d]'.repeat(50_000)}`)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})

describe('labels the person typed never carry a secret to the model', () => {
  const labelled = async () => {
    const { state } = await stateAfter('memory list', '[OK] nothing\n')
    const control = { host: { invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }, setView: () => undefined, open: async () => undefined, actions: deepNoop(), runner: {} }

    return { state, deps: { state, control } as unknown as ModelToolDeps }
  }

  it('waiting.label, waiting.expect and lastResult.label withhold a token and mask an invite code', async () => {
    const { state, deps } = await labelled()

    state.outcome = { label: `store "${TOKEN}"`, ok: true, verified: 'n/a', detail: '', atMs: Date.now() }
    state.pending = { label: `send ${CODE} to the room`, args: [], expect: `stored ${TOKEN}`, askedAtMs: Date.now() }
    const answer = await callTool('console_state', {}, deps)

    expect(answer).not.toContain(TOKEN)
    expect(answer).not.toContain(CODE)
  })

  it('the "already waiting" refusal does not quote a token from the waiting label', async () => {
    const { state, deps } = await labelled()

    state.pending = { label: `store "${TOKEN}"`, args: [], expect: 'x', askedAtMs: Date.now() }
    const answer = await callTool('console_run', { id: 'mission-open' }, deps)

    expect(answer).toMatch(/already waiting/)
    expect(answer).not.toContain(TOKEN)
  })

  it('an invite split by a zero-width character, or cut by the length limit, is still masked', async () => {
    const { state, deps } = await labelled()
    const split = `${CODE.slice(0, 8)}\u200b${CODE.slice(8)}`

    state.outcome = { label: 'joined', ok: true, verified: 'n/a', detail: `${'x'.repeat(190)} ${CODE}`, atMs: Date.now(), lines: [`code ${split}`] }
    const answer = await callTool('console_state', {}, deps)

    expect(answer).not.toContain(CODE.slice(3, 9))
    expect(answer).not.toContain(CODE.slice(9, 15))
  })
})

describe('the settle answer and control characters', () => {
  it('the "waiting" settle answer withholds a token in the expectation', async () => {
    const { setup } = await import('./fixtures/control-setup')
    const { state, deps } = setup('full', 'ask', { 'set-opt': { label: 'set opt' } })
    const runner = (deps as unknown as { control: { runner: { runById: (id: string) => boolean } } }).control.runner

    runner.runById = () => ((state.pending = { label: 'set ruflo-x token', args: [], expect: `ruflo-x token = ${TOKEN}`, askedAtMs: Date.now() }), true)
    const answer = await callTool('console_run', { id: 'set-opt' }, deps)

    expect(answer).toMatch(/Waiting/)
    expect(answer).not.toContain(TOKEN)
  })

  it('an invite split by a C0 or C1 control character is still masked, and an escape sequence leaves no residue', async () => {
    const { state } = await stateAfter('memory list', '[OK] nothing\n')
    const control = { host: { invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }, setView: () => undefined, open: async () => undefined, actions: deepNoop(), runner: {} }
    const deps = { state, control } as unknown as ModelToolDeps

    state.outcome = { label: 'joined', ok: true, verified: 'n/a', detail: `code ${CODE.slice(0, 6)}\u0001${CODE.slice(6)}`, atMs: Date.now(), lines: [`code ${CODE.slice(0, 6)}\u0085${CODE.slice(6)}`, '\u001b[31mred\u001b[0m done'] }
    const answer = await callTool('console_state', {}, deps)

    expect(answer).not.toContain(CODE.slice(6, 14))
    expect(answer).toContain('red done')
    expect(answer).not.toContain('[31m')
  })
})

describe('palette entry ids', () => {
  it('an entry whose id holds a secret shape is left out of console_state', async () => {
    const { state } = await stateAfter('memory list', '[OK] nothing\n')
    const control = { host: { invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }, setView: () => undefined, open: async () => undefined, actions: deepNoop(), runner: {} }
    const deps = { state, control } as unknown as ModelToolDeps
    const palette = await import('../hooks/palette')
    const key = `AKIA${'Q7XB'.repeat(4)}`
    const real = palette.paletteEntries

    vi.spyOn(palette, 'paletteEntries').mockImplementation((...args) => [...real(...args), { id: `auto-ses-resume-${key}`, label: 'resume session' } as never])
    const answer = await callTool('console_state', { filter: 'resume session' }, deps)

    expect(answer).not.toContain(key)
    vi.restoreAllMocks()
  })
})
