/**
 * The Optimizer under vitest: what it finds from what was measured, worst first; which fixes each scope offers; that every fix is a
 * real palette entry (a typo would be a dead button); and that pressing a fix remembers the metric before and runs that entry.
 */
import { describe, expect, it } from 'vitest'

import { diagnose, offered, optimizerActions, optimizerOf } from '../hooks/optimizer'
import { paletteEntries } from '../hooks/palette'
import { newState, type State } from '../hooks/state'

const NOW = Date.UTC(2026, 9, 3, 12)

function stateWith(snapshot: Record<string, unknown>, probes: Record<string, unknown> = {}): State {
  const state = newState({})

  state.snapshot = { neural: null, router: null, outcomes: null, sona: null, agents: [], claims: [], tasks: [], daemon: null, isRufloProject: true, plugins: { missingFromClone: [] }, readAtMs: NOW, ...snapshot } as never

  for (const [key, value] of Object.entries(probes)) state.probes.set(key, { value, okAtMs: NOW, error: null, errorAtMs: null, isRunning: false } as never)

  return state
}

const ids = (state: State) => diagnose(state, NOW, NOW - 1_000).map(finding => finding.id)

describe('optimizer', () => {
  it('an empty project: nothing learned, memory and performance unchecked, the health check on offer', () => {
    const found = ids(stateWith({}))

    expect(found).toEqual(expect.arrayContaining(['learning-empty', 'router-state', 'memory-unchecked', 'performance-unprofiled', 'health-doctor']))
    expect(found).not.toContain('router-accuracy')
  })

  it('what was learned is not called empty; a low router success rate with enough outcomes is a finding, a small N is not', () => {
    const learned = { neural: { trajectories: 4, patterns: 12, signals: 3 } }

    expect(ids(stateWith(learned))).not.toContain('learning-empty')
    expect(ids(stateWith({ ...learned, outcomes: { total: 20, successes: 8, points: [] } }))).toContain('router-accuracy')
    expect(ids(stateWith({ ...learned, outcomes: { total: 5, successes: 1, points: [] } }))).not.toContain('router-accuracy')
    expect(ids(stateWith({ ...learned, outcomes: { total: 20, successes: 18, points: [] } }))).not.toContain('router-accuracy')
  })

  it('memory is judged only once its probes have read: thin vector coverage, a second store, and a large store each become findings', () => {
    const entries = [1, 2, 3, 4, 5].map(i => ({ key: `k${i}`, namespace: 'n', hasVector: i === 1 }))
    const state = stateWith({}, { memory: { total: 900, unread: 7, vectors: 1 }, namespaces: { entries, byName: [], sampled: 5 } })
    const found = ids(state)

    expect(found).toEqual(expect.arrayContaining(['memory-vectors', 'memory-second-store', 'memory-size']))
    expect(found).not.toContain('memory-unchecked')
    expect(diagnose(state, NOW, NOW - 1_000).find(finding => finding.id === 'memory-vectors')?.metric).toBe('vectors 1/5')
  })

  it('alerts the console already raises become findings, worst first, and the safe scope offers only the safe fixes', () => {
    const state = stateWith({ claims: [{ issueId: 'X-1', status: 'active', claimant: { id: 'a1', agentType: 'coder' }, expiresAtMs: NOW - 1_000, claimedAtMs: NOW - 5_000 }] })
    const found = diagnose(state, NOW, NOW - 1_000)

    expect(found[0]?.level).toBe('bad')
    expect(found[0]?.id).toBe('alert-expired-X-1')

    const empty = diagnose(stateWith({}), NOW, NOW).find(finding => finding.id === 'learning-empty')

    expect(offered(empty as never, 'safe').map(item => item.id)).toEqual(['nn-pretrain-shallow'])
    expect(offered(empty as never, 'balanced').map(item => item.id)).toEqual(['nn-pretrain-shallow', 'nn-pretrain-medium', 'nn-train-coordination-10'])
  })

  it('every fix is a real palette entry, so no button is dead', () => {
    const entries = [1, 2, 3, 4, 5].map(i => ({ key: `k${i}`, namespace: 'n', hasVector: false }))
    const state = stateWith({ outcomes: { total: 20, successes: 5, points: [] } }, { memory: { total: 900, unread: 3 }, namespaces: { entries, byName: [], sampled: 5 } })
    const known = new Set(paletteEntries(state, NOW).map(entry => entry.id))
    const missing = diagnose(state, NOW, NOW).flatMap(finding => finding.fixes.map(item => item.id)).filter(id => !known.has(id))

    expect([...new Set(missing)]).toEqual([])
  })

  it('pressing a fix remembers the metric before and runs that entry; an unknown fix runs nothing; ask words the finding', () => {
    const state = stateWith({})
    const ran: string[] = []
    const asked: string[] = []
    const actions = optimizerActions(state, () => undefined, id => void ran.push(id), question => void asked.push(question))

    actions.fix('learning-empty', 'nn-pretrain-shallow')
    expect(ran).toEqual(['nn-pretrain-shallow'])
    expect(optimizerOf(state).before.get('learning-empty')).toBe('patterns n/a')
    expect(optimizerOf(state).ran.get('learning-empty')).toBe('nn-pretrain-shallow')
    actions.fix('learning-empty', 'rm-everything')
    actions.fix('no-such-finding', 'nn-pretrain-shallow')
    expect(ran).toHaveLength(1)
    actions.ask('learning-empty')
    expect(asked[0]).toContain('ruflo has learned nothing here yet')
    actions.scope('deep')
    expect(optimizerOf(state).scope).toBe('deep')
  })
})
