/**
 * A Yes runs only the card it was pressed on, and an ask of Claude's that lands after its tool call returned is checked against the level and
 * Stop as they are NOW (ADR-450 T17, #3815). Real controller, runner, palette and model tools; only the engine is faked (fixtures/live-console.ts).
 * Specs ported from PR #3820 (@proffesor-for-testing), adapted to the runner as it is on main.
 */
import { describe, expect, it } from 'vitest'

import { callTool } from '../hooks/model-tools'
import { settingsOf } from '../hooks/settings'
import { flush, liveConsole } from './fixtures/live-console'

const note = (label: string, value: string) => ({ label, args: ['memory', 'store', '--key', value, '--value', value], expect: 'stored' })

describe('a Yes runs only the card it was pressed on', () => {
  it('a Yes pressed on a card that has since been replaced runs nothing, and the new card stays', async () => {
    const { state, control, log } = liveConsole('read')

    control.runner.ask(note('store note one', 'one'), 'x')
    const seen = state.pending?.id

    control.runner.ask(note('store note two', 'two'), 'x')
    expect(seen).toBeDefined()
    expect(state.pending?.id).not.toBe(seen)
    await control.runner.confirm(seen)
    expect(log.runs.filter(argv => argv.includes('store'))).toEqual([])
    expect(state.pending?.label).toBe('store note two')
    expect(state.outcome?.ok).toBe(false)

    await control.runner.confirm(state.pending?.id)
    expect(log.runs.filter(argv => argv.includes('two')).length).toBe(1)
    expect(log.runs.filter(argv => argv.includes('one'))).toEqual([])
  })

  it('card ids are unique and rise, so an id is never reused by a later card', () => {
    const { state, control } = liveConsole('read')
    const ids: (number | undefined)[] = []

    for (const name of ['a', 'b', 'c']) {
      control.runner.ask(note(`store ${name}`, name), 'x')
      ids.push(state.pending?.id)
    }

    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual([...ids].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it('the confirm row\'s Yes, Always allow and Always accept buttons carry the id of the card they were drawn for', async () => {
    const { confirmRow } = await import('../hooks/views/common')
    const { newState } = await import('../hooks/state')
    type El = { kind: string; props: Record<string, unknown> }
    const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
    const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
    const seen: Record<string, unknown> = {}
    const act = { confirm: (id?: number) => (seen.confirm = id), remember: (id?: number) => (seen.remember = id), settings: { alwaysAccept: (id?: number) => (seen.always = id) }, cancel: () => undefined }
    const flat = (node: unknown): El[] => {
      const el = node as El

      return typeof node !== 'object' || node === null ? [] : [el, ...(Array.isArray(el.props.children) ? el.props.children.flatMap(flat) : flat(el.props.children))]
    }
    const state = newState({ boot: false })

    state.pending = { id: 41, label: 'ask Claude about the terminal', args: [], expect: 'e', askedAtMs: 1, rememberKey: 'ask' }
    state.terminal.harness = 'claude'
    state.terminal.asked = { key: 'k', label: 'ask Claude about the terminal', card: 41 }

    const card = confirmRow({ kit, state, act, columns: 100, nowMs: 1_000, pictures: new Map() } as never) as unknown as El

    for (const button of flat(card).filter(el => el.kind === 'Button')) (button.props.onPress as () => void)()

    // The press names the card that was drawn: a card that replaced it since is not the one answered.
    expect(seen).toEqual({ confirm: 41, remember: 41, always: 41 })
  })

  it('a Yes with no id still answers the card that is waiting (the /ruflo yes text command)', async () => {
    const { state, control, log } = liveConsole('read')

    control.runner.ask(note('store only', 'only'), 'x')
    await control.runner.confirm()
    expect(log.runs.filter(argv => argv.includes('only')).length).toBe(1)
    expect(state.pending).toBeNull()
  })

  it('a second Yes on a card that already ran is a quiet no-op: it does not overwrite the answer', async () => {
    const { state, control, log } = liveConsole('read')

    control.runner.ask(note('store once', 'once'), 'x')
    const seen = state.pending?.id

    await control.runner.confirm(seen)
    const answer = state.outcome

    await control.runner.confirm(seen)
    expect(log.runs.filter(argv => argv.includes('once')).length).toBe(1)
    expect(state.outcome).toBe(answer)
  })
})

/**
 * A screened ask can land while ANOTHER of Claude's tool calls is running: console_open settles nothing, so no call gates the ask. It is
 * still late, and gated in the runner (#3815, #3820 review). Ported in spirit from PR #3820 (@proffesor-for-testing).
 */
describe('Claude\'s asks are re-checked when they land and when the Yes arrives', () => {
  const late = () => ({ label: 'store a late note', args: ['memory', 'store', '--key', 'late', '--value', 'late'], expect: 'stored', byModel: true })

  it('an ask that lands while console_open is running, with the level lowered meanwhile, is not queued', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => (release = resolve))
    const { state, control, deps, log } = liveConsole('full', 'ask', { openPane: () => held })
    const opening = callTool('console_open', { view: 'overview' }, deps)

    await flush()
    expect(state.control.activeCalls).toBe(0)
    Object.assign(settingsOf(state).ai, { modelControl: 'read' })
    control.runner.ask(late(), 'x')
    release()
    expect(await opening).toMatch(/^Opened/)
    expect(state.pending).toBeNull()
    expect(log.runs).toEqual([])
  })

  it('a card Claude raised when the level allowed it, answered Yes after the level was lowered, runs nothing and is cleared', async () => {
    const { state, control, log } = liveConsole('full', 'ask')

    control.runner.ask(late(), 'x')
    expect(state.pending).toMatchObject({ source: 'claude' })
    Object.assign(settingsOf(state).ai, { modelControl: 'read' })
    await control.runner.confirm(state.pending?.id)
    expect(log.runs.filter(argv => argv.includes('late'))).toEqual([])
    expect(state.pending).toBeNull()
    expect(state.outcome?.detail).toMatch(/not run: .*control is now "read"/)
  })

  it('the same card answered Yes while the level still allows it runs', async () => {
    const { state, control, log } = liveConsole('full', 'ask')

    control.runner.ask(late(), 'x')
    await control.runner.confirm(state.pending?.id)
    expect(log.runs.filter(argv => argv.includes('late')).length).toBe(1)
  })

  it('Stop pressed after the card went up: a Yes runs nothing', async () => {
    const { state, control, log } = liveConsole('full', 'ask')

    control.runner.ask(late(), 'x')
    state.control.paused = true
    await control.runner.confirm(state.pending?.id)
    expect(log.runs.filter(argv => argv.includes('late'))).toEqual([])
  })
})

describe('an ask of Claude\'s that lands after its tool call returned is checked when it lands', () => {
  const late = (label: string) => ({ ...note(label, 'late'), byModel: true })

  it('at full: it waits for the person, marked as Claude\'s', () => {
    const { state, control } = liveConsole('full')

    control.runner.ask(late('store a late note'), 'x')
    expect(state.pending).toMatchObject({ source: 'claude', label: 'store a late note' })
  })

  it('a level lowered while the screen looked wins: the ask is not queued', () => {
    const { state, control } = liveConsole('full')

    Object.assign(settingsOf(state).ai, { modelControl: 'read' })
    control.runner.ask(late('store a late note'), 'x')
    expect(state.pending).toBeNull()
    expect(state.outcome?.detail).toMatch(/not queued.*control is now "read"/)
  })

  it('Stop pressed while the screen looked: the ask is not queued', () => {
    const { state, control } = liveConsole('full')

    state.control.paused = true
    control.runner.ask(late('store a late note'), 'x')
    expect(state.pending).toBeNull()
  })

  it('the person\'s own ask is never held to Claude\'s level', () => {
    const { state, control } = liveConsole('read')

    control.runner.ask(note('store my note', 'mine'), 'x')
    expect(state.pending).toMatchObject({ source: 'you' })
  })
})

describe('Always accept on a card that was replaced', () => {
  it('remembers nothing and leaves the draft, as a stale Yes runs nothing', async () => {
    const { settingsActions } = await import('../hooks/settings')
    const { newState } = await import('../hooks/state')
    const { settingsOf } = await import('../hooks/settings')
    const state = newState({})
    const confirmed: (number | undefined)[] = []
    const host = { storeSet: async () => undefined, invalidate: () => undefined, after: () => ({ cancel: () => undefined }) } as never
    const runner = { confirm: (seen?: number) => void confirmed.push(seen) } as never
    const actions = settingsActions(state, host, runner, () => undefined, () => [], () => [])

    settingsOf(state).ai.autoAccept = false
    state.terminal.draft = 'half typed'
    state.pending = { id: 2, label: 'the new card', args: [], expect: 'x', askedAtMs: Date.now() } as never
    actions.alwaysAccept(1)

    expect(settingsOf(state).ai.autoAccept).toBe(false)
    expect(state.terminal.draft).toBe('half typed')
    // The stale id still goes to the runner, which refuses it with a visible note; nothing is saved.
    expect(confirmed).toEqual([1])

    actions.alwaysAccept(2)
    expect(settingsOf(state).ai.autoAccept).toBe(true)
    expect(confirmed).toEqual([1, 2])
  })
})
