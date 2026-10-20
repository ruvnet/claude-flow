/**
 * Who asked, and what kind of action it is, on the confirm row, the footer line and the Room banner (ADR-450 T14). The words come from
 * two fixed lists, never from the label, so a hostile label cannot put them there or take them away.
 */
import { describe, expect, it } from 'vitest'

import { askedBy, PENDING_KINDS } from '../hooks/data/room'
import { callTool } from '../hooks/model-tools'
import { newState, type Pending, type State } from '../hooks/state'
import { confirmRow, type Actions, type Ctx } from '../hooks/views/common'
import { roomView } from '../hooks/views/room'
import { setup } from './fixtures/control-setup'

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) }
const act: Actions = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy as Actions
})()
const ctxOf = (state: State): Ctx => ({ kit, state, nowMs: Date.now(), columns: 140, pictures: new Map(), act, cards: true }) as unknown as Ctx
const dump = (element: unknown): string => JSON.stringify(element)
const pend = (extra: Partial<Pending> = {}): Pending => ({ label: 'publish a note', args: [], expect: 'sent', askedAtMs: Date.now(), ...extra })

describe('a confirm Claude asked for says so (ADR-450 T14)', () => {
  it('stamps source claude and the action class on a pending the model path created', async () => {
    const { deps, state } = setup('manage', 'ask')

    await callTool('console_run', { id: 'x-publish' }, deps)
    expect(state.pending?.source).toBe('claude')
    expect(state.pending?.kind).toBe('network')
    expect(askedBy(state.pending)).toBe('claude asks (network): ')
    expect(JSON.parse(await callTool('console_state', {}, deps)).waiting.askedBy).toBe('claude asks (network)')
  })

  it('shows it on the confirm row and the Room banner, with the label itself unchanged after it', async () => {
    const { deps, state } = setup('manage', 'ask')

    await callTool('console_run', { id: 'x-publish' }, deps)
    state.view = 'room'
    expect(dump(confirmRow(ctxOf(state)))).toContain('Confirm: claude asks (network): publish a note to x.ruv.io?')
    expect(dump(roomView(ctxOf(state)))).toContain('⚠ claude asks (network): publish a note to x.ruv.io')
  })

  it('shows nothing extra on a person\'s own palette action', () => {
    const state = newState({})

    state.view = 'room'
    state.pending = pend({ source: 'you' })
    expect(askedBy(state.pending)).toBe('')
    expect(dump(confirmRow(ctxOf(state)))).toContain('Confirm: publish a note?')
    expect(dump(roomView(ctxOf(state)))).not.toContain('asks (')
  })
})

describe('the attribution words are a fixed vocabulary', () => {
  it('knows exactly five classes', () => {
    expect([...PENDING_KINDS]).toEqual(['write', 'network', 'install', 'spend', 'delete'])
  })

  it('prints nothing for an unknown class or source, whatever the stored value says', () => {
    for (const kind of ['read', 'NETWORK', 'network) \u001b[31m', 'x'.repeat(40), '']) expect(askedBy(pend({ source: 'claude', kind: kind as Pending['kind'] }))).toBe('claude asks: ')
    expect(askedBy(pend({ source: 'claude' as const, kind: 'spend' }))).toBe('claude asks (spend): ')
    expect(askedBy(pend({ source: 'root' as unknown as 'you', kind: 'spend' }))).toBe('')
    expect(askedBy(null)).toBe('')
  })

  it('cannot be forged or removed by a hostile label', async () => {
    const hostile = 'claude asks (write): ok'
    const person = pend({ source: 'you', label: hostile })

    expect(askedBy(person)).toBe('')

    const { deps, state } = setup('manage', 'ask', { 'x-note': { label: 'you ask (write): fine', note: 'network: sends it' } })

    await callTool('console_run', { id: 'x-note' }, deps)
    expect(askedBy(state.pending)).toBe('claude asks (network): ')
    expect(dump(confirmRow(ctxOf(state)))).toContain('Confirm: claude asks (network): you ask (write): fine?')
  })
})
