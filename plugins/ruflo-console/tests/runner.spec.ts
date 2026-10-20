/**
 * The runner's pending confirm (ADR-448 §3.2): a confirm that arrives after the 30 s window runs nothing, clears the pending action and
 * leaves a durable event in the feed (the outcome slot alone is overwritten by the next action).
 *   npx vitest run plugins/ruflo-console/tests/runner.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { newState } from '../hooks/state'

function fake() {
  const ran: string[] = []
  const host = { invalidate: () => undefined, after: () => ({ cancel: () => undefined }) } as unknown as Host
  const state = newState({})
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const spec = { label: 'create the mission and its tasks', args: ['mission', 'create'], expect: 'x', run: async () => void ran.push('ran') } as unknown as ActionSpec

  return { state, runner, spec, ran }
}

describe('a confirm after the window', () => {
  it('runs nothing, clears the pending action and leaves one event naming it', async () => {
    const { state, runner, spec, ran } = fake()

    runner.ask(spec, 'why not')
    expect(state.pending).not.toBeNull()
    state.pending = { ...state.pending!, askedAtMs: Date.now() - 46_000 }
    await runner.confirm()

    expect(ran).toEqual([])
    expect(state.pending).toBeNull()
    expect(state.events).toHaveLength(1)
    expect(state.events[0]?.text).toMatch(/create the mission and its tasks.*4[56]s after the ask and was not run \(30s window\)/)
  })

  it('a prompt confirm runs it and adds no event', async () => {
    const { state, runner, spec, ran } = fake()

    runner.ask(spec, 'why not')
    await runner.confirm()

    expect(ran).toEqual(['ran'])
    expect(state.events).toEqual([])
  })
})

describe('a remembered always-allow answer (ADR-444)', () => {
  // The kind key of a spec with no argv/run and plain args is its first two words (hooks/remember.ts).
  const spec = (ran: string[]) => ({ label: 'store a note', args: ['memory', 'store'], expect: 'x', note: 'writes one entry', exec: () => ran.push('ran') }) as unknown as ActionSpec

  it('runs a person action at once, with no pending ask', () => {
    const { state, runner } = fake()

    state.allowed.set('memory store', 'store a note')
    runner.ask(spec([]), 'why not')
    expect(state.pending).toBeNull()
  })

  it('never lets an action Claude asked for skip the pending path: the control level and confirm mode decide there', () => {
    const { state, runner } = fake()

    state.allowed.set('memory store', 'store a note')
    state.control.viaModel = true
    runner.ask(spec([]), 'why not')
    expect(state.pending?.label).toBe('store a note')
  })
})
