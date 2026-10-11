/**
 * A confirm card that nobody answers expires at the 30 s window instead of blocking the console: the card is cleared, one event names it,
 * the outcome tells Claude to ask again, and the next ask is accepted. A Yes after the window still runs nothing. Claude can withdraw its own
 * ask (never the person's). The ADR and skills palette entries say which page or console to open instead of "not wired yet".
 *   npx vitest run plugins/ruflo-console/tests/pending-expiry.spec.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { adrActions } from '../hooks/adr-actions'
import { adrPalette } from '../hooks/adr-palette'
import type { Host } from '../hooks/host'
import { callTool, type ModelToolDeps } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { createController } from '../hooks/controller'
import { dispatch } from '../hooks/dispatch'
import { createRunner, EXPIRY_TIMER, PENDING_TTL_MS } from '../hooks/runner'
import { settingsOf } from '../hooks/settings'
import { skillPaletteEntries } from '../hooks/skills-lab'
import { newState, type State } from '../hooks/state'
import type { Actions, Ctx } from '../hooks/views/common'
import { roomView } from '../hooks/views/room'
import { world } from './adr-world'

type Timer = { ms: number; fn: () => void; cancelled: boolean }

function fake() {
  const ran: string[] = []
  const timers: Timer[] = []
  const host = {
    invalidate: () => undefined,
    after: (ms: number, fn: () => void) => {
      const timer: Timer = { ms, fn, cancelled: false }

      timers.push(timer)

      return { cancel: () => void (timer.cancelled = true) }
    },
  } as unknown as Host
  const state = newState({})
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const spec = (label: string, extra: Partial<ActionSpec> = {}) => ({ label, args: ['memory', 'store'], expect: 'x', run: async () => void ran.push(label), ...extra }) as unknown as ActionSpec
  const age = (ms = PENDING_TTL_MS + 1_000) => {
    if (state.pending !== null) state.pending = { ...state.pending, askedAtMs: Date.now() - ms }
  }
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn()
  }

  return { state, host, runner, spec, ran, timers, age, fire }
}

describe('a card nobody answers expires at the window', () => {
  it('its timer clears it, records one event, and tells Claude to ask again', () => {
    const { state, runner, spec, timers, age, fire } = fake()

    runner.ask(spec('store a note'), 'why not')
    expect(state.pending).not.toBeNull()
    expect(timers.some(timer => timer.ms >= PENDING_TTL_MS)).toBe(true)

    age()
    fire()

    expect(state.pending).toBeNull()
    expect(state.events.filter(event => /expired/.test(event.text))).toHaveLength(1)
    expect(state.events[0]?.text).toMatch(/ask for "store a note" expired after 30 s, not run/)
    expect(state.outcome).toMatchObject({ label: 'store a note', ok: false, expired: true })
    expect(state.outcome?.detail).toMatch(/^expired: ask again/)
  })

  it('a fresh ask from Claude is accepted after the stale card, not dropped', () => {
    const { state, runner, spec, age } = fake()

    runner.ask(spec('store a note', { byModel: true }), 'why not')
    age()
    runner.ask(spec('store another note', { byModel: true }), 'why not')

    expect(state.pending?.label).toBe('store another note')
    expect(state.events.some(event => /ask for "store a note" expired after 30 s, not run/.test(event.text))).toBe(true)
  })

  it('a Yes after the window still runs nothing', async () => {
    const { state, runner, spec, ran, age, fire } = fake()

    runner.ask(spec('store a note'), 'why not')

    const id = state.pending?.id

    age()
    fire()
    await runner.confirm(id)

    expect(ran).toEqual([])
    expect(state.pending).toBeNull()
  })

  it('an old timer never clears a newer card that is still inside its window', () => {
    const { state, runner, spec, fire } = fake()

    runner.ask(spec('store a note'), 'why not')
    runner.cancel()
    runner.ask(spec('store another note'), 'why not')
    fire()

    expect(state.pending?.label).toBe('store another note')
    expect(state.events).toEqual([])
  })
})

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) }
const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy as Actions
})()
const roomText = (state: State): string => JSON.stringify(roomView({ kit, state, nowMs: Date.now(), columns: 140, pictures: new Map(), act, cards: true } as unknown as Ctx))

describe('the Room never counts past the window', () => {
  it('a card past 30 s reads as expired, not "63s of 30s"', () => {
    const state = newState({})

    state.pending = { label: 'store a note', args: [], expect: 'x', askedAtMs: Date.now() - 63_000, source: 'claude', kind: 'delete' }

    const text = roomText(state)

    expect(text).not.toContain('63s of 30s')
    expect(text).toContain('expired')
  })

  it('after it expired the Room shows that briefly, in place of the card', () => {
    const { state, runner, spec, age, fire } = fake()

    runner.ask(spec('store a note'), 'why not')
    age()
    fire()

    const text = roomText(state)

    expect(text).toContain('store a note')
    expect(text).toContain('expired after 30 s')
  })
})

/** The model tools over a real runner, so the pending card, its expiry and the withdraw are the runner's own. */
function modelSetup() {
  const f = fake()

  Object.assign(settingsOf(f.state).ai, { modelControl: 'full', modelConfirm: 'ask' })

  const control = { host: f.host, runner: f.runner, setView: () => undefined, open: async () => undefined, actions: {} as Actions }

  return { ...f, deps: { state: f.state, control } as unknown as ModelToolDeps }
}

describe('console_run with a stale or withdrawable card', () => {
  it('a stale card of Claude’s no longer refuses the next console_run', async () => {
    const { state, deps, age } = modelSetup()

    expect(await callTool('console_run', { id: 'mem-store', text: 'console k1 v1' }, deps)).toMatch(/Waiting for the person/)
    age()

    const again = await callTool('console_run', { id: 'mem-store', text: 'console k2 v2' }, deps)

    expect(again).not.toMatch(/already waiting/)
    expect(again).toMatch(/Waiting for the person/)
    expect(state.pending?.label).toMatch(/k2/)
    expect(state.events.some(event => /expired after 30 s, not run/.test(event.text))).toBe(true)
  })

  it('console_run ask-withdraw takes back Claude’s own write-class card; nothing runs', async () => {
    const { state, deps, ran } = modelSetup()

    expect(await callTool('console_run', { id: 'store', text: 'a note' }, deps)).toMatch(/Waiting for the person/)
    expect(state.pending).toMatchObject({ source: 'claude', origin: 'console_run', kind: 'write' })

    const said = await callTool('console_run', { id: 'ask-withdraw' }, deps)

    expect(said).toMatch(/withdr/i)
    expect(state.pending).toBeNull()
    expect(ran).toEqual([])
    expect(state.events.some(event => /Claude withdrew its ask "store "a note"/.test(event.text))).toBe(true)
  })

  it('a delete, spend, install or network card is never withdrawn: the person must see it, and it expires by itself', async () => {
    const { state, deps } = modelSetup()

    await callTool('console_run', { id: 'mem-delete', text: 'console k1' }, deps)
    expect(state.pending?.kind).toBe('delete')

    const label = state.pending?.label

    expect(await callTool('console_run', { id: 'ask-withdraw' }, deps)).toMatch(/Refused.*not withdrawn.*must see/)
    expect(state.pending?.label).toBe(label)
  })

  it('a card that landed late (a screened, deferred ask) is not Claude’s to withdraw, even of the write class', async () => {
    const { state, runner, spec, deps } = modelSetup()

    runner.ask(spec('store a screened note', { byModel: true }), 'why not')
    state.pending = { ...state.pending!, kind: 'write' }
    expect(await callTool('console_run', { id: 'ask-withdraw' }, deps)).toMatch(/Refused.*not withdrawn.*not raised by your own console_run/)
    expect(state.pending?.label).toBe('store a screened note')
  })

  it('console_run ask-withdraw never cancels the person’s own card', async () => {
    const { state, runner, spec, deps } = modelSetup()

    runner.ask(spec('the person’s own action'), 'why not')

    expect(await callTool('console_run', { id: 'ask-withdraw' }, deps)).toMatch(/Refused.*not withdrawn/)
    expect(state.pending?.label).toBe('the person’s own action')
  })

  it('the person cannot use ask-withdraw: it is Claude’s, and only shows for Claude’s own card', async () => {
    const { state, runner, deps } = modelSetup()

    expect(paletteEntries(state, Date.now()).map(entry => entry.id)).not.toContain('ask-withdraw')
    await callTool('console_run', { id: 'store', text: 'a note' }, deps)
    expect(paletteEntries(state, Date.now()).map(entry => entry.id)).toContain('ask-withdraw')
    expect(runner.runById('ask-withdraw', '', { exact: true })).toBe(true)
    expect(state.pending).not.toBeNull()
  })

  it('withdraw then re-ask cannot loop: the same ask waits out a cooldown, and at most 3 withdraws a minute', async () => {
    vi.useFakeTimers({ now: 1_000_000 })

    const { state, deps } = modelSetup()

    await callTool('console_run', { id: 'store', text: 'a note' }, deps)
    await callTool('console_run', { id: 'ask-withdraw' }, deps)
    await callTool('console_run', { id: 'store', text: 'a note' }, deps)
    expect(state.pending).toBeNull()
    expect(state.outcome?.detail).toMatch(/withdrew this same ask 0 s ago/)

    for (const text of ['b', 'c']) {
      await callTool('console_run', { id: 'store', text }, deps)
      expect(await callTool('console_run', { id: 'ask-withdraw' }, deps)).not.toMatch(/Refused/)
    }

    await callTool('console_run', { id: 'store', text: 'd' }, deps)
    expect(await callTool('console_run', { id: 'ask-withdraw' }, deps)).toMatch(/Refused.*3 asks were withdrawn in the last minute/)
    expect(state.pending?.label).toMatch(/"d"/)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** A runner on vitest's fake clock: host.after is a real setTimeout, so the expiry fires when the clock says so. */
function clocked() {
  vi.useFakeTimers({ now: 0 })

  const ran: string[] = []
  const host = { invalidate: () => undefined, after: (ms: number, fn: () => void) => {
    const handle = setTimeout(fn, ms)

    return { cancel: () => clearTimeout(handle) }
  } } as unknown as Host
  const state = newState({})
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const spec = (label: string) => ({ label, args: ['memory', 'store'], expect: 'x', run: async () => void ran.push(label) }) as unknown as ActionSpec

  return { state, runner, spec, ran }
}

describe('the window to the millisecond (fake clock)', () => {
  it('at 29.9 s the card waits and a Yes runs it', async () => {
    const { state, runner, spec, ran } = clocked()

    runner.ask(spec('store a note'), 'x')
    vi.advanceTimersByTime(29_900)
    expect(state.pending?.label).toBe('store a note')
    expect(roomText(state)).not.toContain('expired')
    await runner.confirm(state.pending?.id)
    expect(ran).toEqual(['store a note'])
  })

  it('at 30.0 s the card is expired: the Room says so, a Yes runs nothing, the next ask replaces it', async () => {
    const { state, runner, spec, ran } = clocked()

    runner.ask(spec('store a note'), 'x')
    vi.advanceTimersByTime(30_000)
    expect(state.pending?.label).toBe('store a note')
    expect(roomText(state)).toContain('expired')
    expect(roomText(state)).not.toContain('30s of 30s')

    const id = state.pending?.id

    runner.ask(spec('store another note'), 'x')
    expect(state.pending?.label).toBe('store another note')
    expect(state.events.some(event => /ask for "store a note" expired after 30 s, not run/.test(event.text))).toBe(true)
    await runner.confirm(id)
    expect(ran).toEqual([])
  })

  it('at 30.3 s the timer has cleared it, with one event and "expired: ask again"', () => {
    const { state, runner, spec } = clocked()

    runner.ask(spec('store a note'), 'x')
    vi.advanceTimersByTime(30_300)
    expect(state.pending).toBeNull()
    expect(state.events.filter(event => /expired after 30 s/.test(event.text))).toHaveLength(1)
    expect(state.outcome).toMatchObject({ ok: false, expired: true })
    expect(state.outcome?.detail).toMatch(/^expired: ask again/)
  })
})

/** A whole console over a host whose every call resolves empty, its timers tracked, its runner real. */
function console$() {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ now: 5_000_000 })

  const timers: Timer[] = []
  const host = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'after' || key === 'every') return (ms: number, fn: () => void) => {
        const timer: Timer = { ms, fn, cancelled: false }
        const handle = key === 'after' ? setTimeout(fn, ms) : setInterval(fn, ms)

        timers.push(timer)

        return { cancel: () => void ((timer.cancelled = true), clearTimeout(handle)) }
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

  return { state, control, timers, ran, spec }
}

describe('the expiry timer does not outlive the console', () => {
  it('lives in state.timers, so closing the console cancels it and leaves no live timer', async () => {
    const { state, control, timers, spec } = console$()

    control.runner.ask(spec('store a note'), 'x')

    const expiry = timers.find(timer => timer.ms === PENDING_TTL_MS + 250)

    expect(expiry).toBeDefined()
    expect(state.timers.has(EXPIRY_TIMER)).toBe(true)
    await control.close()
    expect(state.timers.has(EXPIRY_TIMER)).toBe(false)
    expect(expiry?.cancelled).toBe(true)
  })

  it('answering the card cancels its timer too', async () => {
    const { state, control, timers, spec } = console$()

    control.runner.ask(spec('store a note'), 'x')
    await control.runner.confirm(state.pending?.id)
    expect(state.timers.has(EXPIRY_TIMER)).toBe(false)
    expect(timers.find(timer => timer.ms === PENDING_TTL_MS + 250)?.cancelled).toBe(true)
  })
})

describe('a typed /ruflo yes is bound to no card', () => {
  const yes = (control: ReturnType<typeof console$>['control'], state: State) => dispatch(control, state, 'yes', async () => undefined)

  it('runs the person’s own card, as before', async () => {
    const { state, control, ran, spec } = console$()

    control.runner.ask(spec('store a note'), 'x')
    // The card is on the person's screen: a bare typed yes answers it.
    state.shownCard = state.pending?.id ?? null
    await yes(control, state)
    expect(ran).toEqual(['store a note'])
  })

  it('is refused for a card Claude raised under 3 s ago: press the card itself', async () => {
    vi.useFakeTimers({ now: 5_000_000 })

    const { state, control, ran, spec } = console$()

    control.runner.ask(spec('store a note', { byModel: true }), 'x')
    state.shownCard = state.pending?.id ?? null
    vi.advanceTimersByTime(2_000)
    expect((await yes(control, state)).text).toMatch(/press Yes on the card itself/)
    expect(ran).toEqual([])
    expect(state.pending?.label).toBe('store a note')
    vi.advanceTimersByTime(1_500)
    await yes(control, state)
    expect(ran).toEqual(['store a note'])
  })

  it('is refused for a card that replaced an expired one under 10 s ago, so a Yes meant for the old card never runs the new one', async () => {
    vi.useFakeTimers({ now: 5_000_000 })

    const { state, control, ran, spec } = console$()

    control.runner.ask(spec('the old card'), 'x')
    vi.advanceTimersByTime(PENDING_TTL_MS + 500)
    expect(state.pending).toBeNull()
    control.runner.ask(spec('the new card'), 'x')
    state.shownCard = state.pending?.id ?? null
    vi.advanceTimersByTime(4_000)
    expect((await yes(control, state)).text).toMatch(/replaced one that left unanswered/)
    expect(ran).toEqual([])
    vi.advanceTimersByTime(6_000)
    await yes(control, state)
    expect(ran).toEqual(['the new card'])
  })
})

describe('the ADR and skills entries say what to open', () => {
  const whyOf = (state: State, id: string, text: string): string => {
    const run = adrPalette(state).find(entry => entry.id === id)?.run

    return run?.kind === 'text' ? run.why?.(text) ?? '' : run?.kind === 'spec' ? run.why : ''
  }

  it('with the console running but the ADRs page never opened, it says to open the ADRs page (console_open adrs)', () => {
    const state = newState({})

    adrActions(state, { invalidate: () => undefined } as never, { ask: () => undefined } as never)

    const why = whyOf(state, 'adr-show', '3')

    expect(why).not.toMatch(/not wired yet|open the console first/)
    expect(why).toMatch(/open the ADRs page first \(console_open adrs\)/)
  })

  it('without a console, it says to open the console, naming the call', () => {
    const why = whyOf(newState({}), 'adr-accept', '3')

    expect(why).not.toMatch(/not wired yet/)
    expect(why).toMatch(/console_open adrs/)
  })

  it('adr-supersede asks for two numbers, even when the one given exists', async () => {
    const w = await world('nygard')

    adrActions(w.state, w.host as never, { ask: () => undefined } as never)
    expect(whyOf(w.state, 'adr-supersede', '3')).toMatch(/type two ADR numbers, the old then the new: "adr-supersede 1 3"/)
    expect(whyOf(w.state, 'adr-accept', 'x')).toMatch(/type the ADR number: "adr-accept 3"/)
  })

  it('with the folder read, a number that is not there is named', async () => {
    const w = await world('nygard')

    adrActions(w.state, w.host as never, { ask: () => undefined } as never)
    expect(whyOf(w.state, 'adr-show', '99')).toMatch(/no ADR 99/)
  })

  it('the skills entries name the call that opens the console', () => {
    const update = skillPaletteEntries(newState({})).find(entry => entry.id === 'skills-update')

    expect(update?.run.kind === 'spec' ? update.run.why : '').toMatch(/console_open skills/)
  })
})
