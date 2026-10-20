/**
 * #3983: every confirm route answers the card the person saw. The card's own Yes and y were bound to its id; three other routes were not:
 * a typed `/ruflo yes`, the field's "Enter again" (matched by label), and the auto-confirm of a Claude call (settled whichever card waited).
 * Each is shown here to refuse the wrong card, and to still answer the right one.
 *   npx vitest run plugins/ruflo-console/tests/confirm-binding.spec.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { createController } from '../hooks/controller'
import { dispatch } from '../hooks/dispatch'
import type { Host } from '../hooks/host'
import { callTool } from '../hooks/model-tools'
import { parseRuflo } from '../hooks/commands'
import { settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'
import { confirmRow, type Ctx } from '../hooks/views/common'
import { isAskedAgain } from '../hooks/views/automate'
import { plainKit } from '../hooks/views/pane'
import { setup } from './fixtures/control-setup'

afterEach(() => vi.useRealTimers())

function console$() {
  vi.useFakeTimers({ now: 5_000_000 })

  const host = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'after' || key === 'every') return (ms: number, fn: () => void) => {
        const handle = key === 'after' ? setTimeout(fn, ms) : setInterval(fn, ms)

        return { cancel: () => (key === 'after' ? clearTimeout(handle) : clearInterval(handle)) }
      }
      if (key === 'pluginRoot') return '/plugin'
      if (key === 'fs') return { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }

      return () => Promise.resolve(undefined)
    },
  }) as unknown as Host
  const state = newState({ boot: false })

  Object.assign(settingsOf(state).ai, { modelControl: 'full', modelConfirm: 'ask' })

  const control = createController(state, host)
  const ran: string[] = []
  const spec = (label: string, extra: Partial<ActionSpec> = {}) => ({ label, args: ['memory', 'store'], expect: 'x', run: async () => void ran.push(label), ...extra }) as unknown as ActionSpec
  const say = (text: string) => dispatch(control, state, text, async () => undefined)
  /** The card drawn for a person in a pane that is open. */
  const draw = () => {
    state.pane.isShown = true
    confirmRow({ kit: plainKit(), state, nowMs: Date.now(), columns: 100, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) as never } as unknown as Ctx)
  }

  return { state, control, ran, spec, say, draw }
}

describe('a typed /ruflo yes names its card or answers only the card the person was shown', () => {
  it('parses an id', () => {
    expect(parseRuflo('yes 7')).toEqual({ kind: 'confirm', isYes: true, card: 7 })
    expect(parseRuflo('y #12')).toEqual({ kind: 'confirm', isYes: true, card: 12 })
    expect(parseRuflo('yes')).toEqual({ kind: 'confirm', isYes: true })
    expect(parseRuflo('yes now')).toEqual({ kind: 'confirm', isYes: true })
  })

  it('A expires, Claude raises B, a long while later a bare yes meant for A runs nothing; yes <B> runs B', async () => {
    const { state, control, ran, spec, say, draw } = console$()

    control.runner.ask(spec('store A'), 'x')
    draw()
    vi.advanceTimersByTime(30_300)
    expect(state.pending).toBeNull()

    control.runner.ask(spec('store B', { byModel: true }), 'x')

    const b = state.pending?.id

    vi.advanceTimersByTime(15_000)
    expect(await say('yes')).toMatchObject({ text: expect.stringMatching(/not run.*not put in front of you/) })
    expect(ran).toEqual([])
    expect(state.pending?.id).toBe(b)

    expect((await say(`yes ${(b ?? 0) + 1}`)).text).toMatch(/Ran|✗|✓/)
    expect(ran).toEqual([])
    expect(state.pending?.id).toBe(b)

    await say(`yes ${b}`)
    expect(ran).toEqual(['store B'])
  })

  it('a card drawn in the open pane is the one a bare yes answers; one drawn only for a text answer is not', async () => {
    const { state, control, ran, spec, say, draw } = console$()

    control.runner.ask(spec('store C'), 'x')
    // A model's text answer draws the same card for no one.
    state.pane.isShown = true
    confirmRow({ kit: plainKit(), state, nowMs: Date.now(), columns: 100, pictures: new Map(), text: true, act: {} as never } as unknown as Ctx)
    expect(state.shownCard).toBeNull()
    await say('yes')
    expect(ran).toEqual([])

    draw()
    expect(state.shownCard).toBe(state.pending?.id)
    vi.advanceTimersByTime(4_000)
    await say('yes')
    expect(ran).toEqual(['store C'])
  })

  it('/ruflo run names the card in its answer, and the bare yes after it answers that card', async () => {
    const { state, say } = console$()
    const asked = await say('run mem-store console k1 v1')

    expect(asked.text).toMatch(/^Asked: /)
    expect(state.pending).not.toBeNull()
    expect(state.shownCard).toBe(state.pending?.id)
    vi.advanceTimersByTime(4_000)

    const yes = await say('yes')

    expect(yes.text).not.toMatch(/not put in front of you/)
    expect(state.pending).toBeNull()
  })

  it('a card nobody showed the person is refused a bare yes with its id in the answer', async () => {
    const { state, control, ran, spec, say } = console$()

    control.runner.ask(spec('store E', { byModel: true }), 'x')
    vi.advanceTimersByTime(10_000)

    const refused = await say('yes')

    expect(refused.text).toMatch(new RegExp(`/ruflo yes ${state.pending?.id}`))
    expect(ran).toEqual([])
  })
})

describe('"Enter again" answers the card its field raised, not one that reads the same', () => {
  it('the automate field: a replacement card with the same label is not confirmed; the original is', () => {
    const { state } = console$()
    const ctx = { kit: plainKit(), state, nowMs: Date.now(), columns: 100, pictures: new Map(), act: {} as never } as unknown as Ctx

    state.pending = { id: 4, label: 'train coordination', args: [], expect: 'x', askedAtMs: Date.now() }
    state.askedAgain = { entry: 'neural-train', text: 'coordination 20', card: 4 }
    expect(isAskedAgain(ctx, 'neural-train', 'coordination 20')).toBe(true)
    // Another card with the very same words took its place (a re-ask with other arguments).
    state.pending = { id: 5, label: 'train coordination', args: [], expect: 'x', askedAtMs: Date.now() }
    expect(isAskedAgain(ctx, 'neural-train', 'coordination 20')).toBe(false)
    state.pending = { id: 4, label: 'train coordination', args: [], expect: 'x', askedAtMs: Date.now() }
    expect(isAskedAgain(ctx, 'neural-train', 'coordination 30')).toBe(false)
    expect(isAskedAgain(ctx, 'other-entry', 'coordination 20')).toBe(false)
  })

  it('the terminal field: Enter again confirms the card it raised; a same-labelled card that replaced it is not confirmed by that Enter', async () => {
    const { state, control, spec } = console$()
    const submit = (text: string) => control.actions.term.submit(text)

    submit('hello there')

    const first = state.pending

    expect(first).not.toBeNull()
    expect(state.terminal.asked?.card).toBe(first?.id)

    // The card the field raised is replaced by another that reads exactly the same (a re-ask from elsewhere, same label).
    control.runner.ask(spec(first?.label ?? ''), 'x')
    expect(state.pending?.label).toBe(first?.label)
    expect(state.pending?.id).not.toBe(first?.id)

    const second = state.pending?.id

    submit('hello there')
    // Enter again did not answer the replacement: it asked afresh (a new card), and nothing was confirmed on the replaced one.
    expect(state.pending?.id).not.toBe(second)
    expect(state.terminal.asked?.card).toBe(state.pending?.id)

    // And now the card this field raised is the one Enter again answers.
    const raised = state.pending?.id

    submit('hello there')
    expect(state.pending === null || state.pending.id !== raised).toBe(true)
    expect(state.terminal.asked === null || state.terminal.asked.card !== raised).toBe(true)
  })
})

describe('auto-confirm settles only the card the call raised', () => {
  it('a read still running while an unrelated write lands: the write is not confirmed under the read call', async () => {
    const { state, calls, deps } = setup('full', 'auto', { search: { label: 'search', readOnly: true } })
    const control = (deps as unknown as { control: { runner: { settled: () => Promise<void> } } }).control
    let release: () => void = () => undefined

    control.runner.settled = () => new Promise<void>(resolve => (release = resolve))

    const running = callTool('console_run', { id: 'search', text: 'x' }, deps)

    // The unrelated deferred write lands while the read is still waiting.
    state.pending = { id: 99, label: 'store a thing', args: [], expect: 'stored', askedAtMs: Date.now(), source: 'claude' }
    release()

    const answer = await running

    expect(calls.confirm).toBe(0)
    expect(state.pending?.id).toBe(99)
    expect(answer).not.toMatch(/Waiting for the person|Done: store a thing|Failed: store a thing/)
  })

  it('a deferred write that carries ANOTHER call\'s number is not settled by this call; one that carries this call\'s number is', async () => {
    for (const mine of [false, true]) {
      const { state, calls, deps } = setup('full', 'auto', { search: { label: 'search', readOnly: true } })
      const control = (deps as unknown as { control: { runner: { settled: () => Promise<void> } } }).control
      let release: () => void = () => undefined

      let waited = false

      // Only the first wait (the read still running) is held; a later one (after a confirm) returns at once.
      control.runner.settled = () => (waited ? Promise.resolve() : ((waited = true), new Promise<void>(resolve => (release = resolve))))

      const running = callTool('console_run', { id: 'search', text: 'x' }, deps)

      // This is the first call, so its number is 1; the stranger carries 7.
      state.pending = { id: 50, label: 'store a thing', args: [], expect: 'stored', askedAtMs: Date.now(), source: 'claude', byCall: mine ? 1 : 7 }
      release()
      await running
      expect(calls.confirm, mine ? 'own deferred card' : 'stranger').toBe(mine ? 1 : 0)
    }
  })

  it('the card the call itself raised is still settled as before (auto: confirmed)', async () => {
    const { state, calls, deps } = setup('full', 'auto')
    const runner = (deps as unknown as { control: { runner: { runById: (id: string) => boolean } } }).control.runner
    const original = runner.runById

    runner.runById = id => {
      const ok = original(id)

      if (state.pending !== null) state.pending.id = 7

      return ok
    }

    const answer = await callTool('console_run', { id: 'mission-create' }, deps)

    expect(calls.confirm).toBe(1)
    expect(answer).toMatch(/Done|Ran/)
  })
})
