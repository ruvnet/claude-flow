/**
 * Everything the console hands the model goes through one path (model-tools.ts modelLine): console_state's fields, every console_run /
 * console_set / console_open answer, every refusal that quotes a label, a result or the model's own input, and the thrown-error answer. This
 * enumerates the builders: each is fed a token, a minted invite code (whole, and split by C0, C1 and zero-width characters) and an escape
 * sequence, and none of it may come out. A new builder that skips modelLine fails here, not in a review.
 * Specs for the single path ported in part from PR #3821 (@proffesor-for-testing).
 */
import { describe, expect, it } from 'vitest'

import { callTool, modelLine, modelLines, type ModelToolDeps } from '../hooks/model-tools'
import { catalogOf } from '../hooks/plugin-catalog'
import { setup } from './fixtures/control-setup'

const CODE = 'v2.Zk3pQ9rT_u7WmB2xL0aYc4N'
// Built at run time so no token-shaped literal sits in this source.
const TOKEN = `ghp_${'Ab3'.repeat(12)}`
const SPLITS = [`${CODE.slice(0, 6)}\u0001${CODE.slice(6)}`, `${CODE.slice(0, 6)}\u0085${CODE.slice(6)}`, `${CODE.slice(0, 8)}​${CODE.slice(8)}`, `${CODE.slice(0, 5)}\u001b[0m${CODE.slice(5)}`]
const ESC = '\u001b]8;;https://evil.example\u0007LINK\u001b]8;;\u0007'
/** One string holding every hostile shape. */
const HOSTILE = `token ${TOKEN} code ${CODE} split ${SPLITS.join(' ')} link ${ESC}`
const LEAKS = [TOKEN, CODE, ...SPLITS.map(() => CODE.slice(8, 16)), CODE.slice(3, 9)]
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/

const clean = (answer: string, where: string) => {
  for (const leak of LEAKS) expect(answer, `${where} leaked ${leak}`).not.toContain(leak)
  expect(CONTROL.test(answer), `${where} kept a control character`).toBe(false)
  expect(answer, `${where} kept an escape residue`).not.toContain('8;;https')
}

const waiting = (state: ModelToolDeps['state']) => {
  state.pending = { id: 1, label: `store ${HOSTILE}`, args: [], expect: `stored ${HOSTILE}`, askedAtMs: Date.now(), note: `effect ${HOSTILE}` }
}

describe('modelLine is the one path', () => {
  it('masks, withholds and strips in one pass', () => {
    clean(modelLine(HOSTILE, 4000), 'modelLine')
    expect(modelLine(`a\u001b[31mred\u001b[0m b`, 40)).toBe('ared b')
    expect(modelLine(undefined, 40)).toBe('')
    expect(modelLines(`ok\n${TOKEN}\nfine`)).toBe('ok\n(line withheld: it looks like a secret: not shown)\nfine')
  })

  it('a version with the invite prefix stays readable', () => {
    expect(modelLine('upgraded to v2.1.0-beta.3', 80)).toBe('upgraded to v2.1.0-beta.3')
  })
})

describe('every model-facing builder', () => {
  it('console_state: waiting, lastResult and the screen', async () => {
    const { state, deps } = setup('read')

    waiting(state)
    state.outcome = { label: `ran ${HOSTILE}`, ok: false, verified: 'n/a', detail: `failed ${HOSTILE}`, atMs: Date.now(), lines: [HOSTILE, `second ${HOSTILE}`] }
    clean(await callTool('console_state', {}, deps), 'console_state')
  })

  it('console_run: a read that finished, and one that failed with a token in its stderr', async () => {
    for (const ok of [true, false]) {
      const { state, deps } = setup('write', 'auto', { 'mission-open': { label: 'open Mission Control', readOnly: true } })
      const runner = (deps as unknown as { control: { runner: { runById: (id: string) => boolean } } }).control.runner

      runner.runById = () => ((state.outcome = { label: `open ${HOSTILE}`, ok, verified: 'n/a', detail: `stderr: ${HOSTILE}`, atMs: Date.now() + 1, lines: [HOSTILE] }), true)
      clean(await callTool('console_run', { id: 'mission-open' }, deps), `console_run read ok=${ok}`)
    }
  })

  it('console_run and console_set: the refusal that quotes the card already waiting', async () => {
    const { state, deps } = setup('write')

    waiting(state)
    clean(await callTool('console_run', { id: 'mission-open' }, deps), 'console_run already waiting')
    clean(await callTool('console_set', { field: 'goal', value: 'x' }, deps), 'console_set already waiting')
  })

  it('console_run: the answers that settle a queued card (waiting, level, budget, started, done)', async () => {
    const queued = (state: ModelToolDeps['state'], deps: ModelToolDeps) => {
      const runner = (deps as unknown as { control: { runner: { runById: (id: string) => boolean } } }).control.runner

      runner.runById = () => (waiting(state), true)
    }
    const ask = setup('full', 'ask')
    const low = setup('read', 'ask')
    const auto = setup('full', 'auto')
    const slow = setup('full', 'auto')

    for (const { state, deps } of [ask, low, auto, slow]) queued(state, deps)
    clean(await callTool('console_run', { id: 'x' }, ask.deps), 'settle: waiting')
    clean(await callTool('console_run', { id: 'x' }, low.deps), 'settle: level refusal')
    clean(await callTool('console_run', { id: 'x' }, auto.deps), 'settle: done')
    // A run that does not finish inside the limit answers "Started".
    slow.calls.finishAfter = new Promise<void>(() => undefined)
    clean(await callTool('console_run', { id: 'x' }, slow.deps), 'settle: started')
  })

  it('the refusals that echo what the model typed (an unknown id, field, chip, tool)', async () => {
    const { deps } = setup('full', 'auto')

    clean(await callTool('console_run', { id: HOSTILE }, deps), 'unknown id')
    clean(await callTool('console_set', { field: HOSTILE, value: 'x' }, deps), 'unknown field')
    clean(await callTool('console_open', { view: 'settings', chip: HOSTILE }, deps), 'unknown chip')
    clean(await callTool(`console_${HOSTILE}`, {}, deps), 'unknown tool')
  })

  it('console_open: the answer names the plugin the chip selected, and that name is withheld when it holds a secret shape', async () => {
    const { state, deps } = setup('full', 'auto')
    // All lower case: the chip is matched lower-cased, and the name must be found for the "Opened … options selected" answer to quote it.
    const lower = `ghp_${'a1b2c3'.repeat(6)}`

    catalogOf(state).plugins = [{ name: `ruflo-${lower}`, options: ['x'] }] as never
    state.snapshot = { plugins: { installed: [{ id: `ruflo-${lower}@ruflo`, name: `ruflo-${lower}`, marketplace: 'ruflo', version: '1', scope: 'user', installPath: '/p' }] } } as never
    const answer = await callTool('console_open', { view: 'settings', chip: lower }, deps)

    // The whole answer line is withheld: only the closing pass over every answer can do that, the builder quotes the name as it is.
    expect(answer).toContain('withheld')
    expect(answer).not.toContain(lower)
  })

  it('the answer to a call that threw', async () => {
    const { deps } = setup('full', 'auto')
    const runner = (deps as unknown as { control: { runner: { runById: () => boolean } } }).control.runner

    runner.runById = () => {
      throw new Error(`boom ${HOSTILE}`)
    }
    clean(await callTool('console_run', { id: 'anything' }, deps), 'thrown error')
  })
})
