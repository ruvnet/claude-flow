/**
 * The merged Workflows features (ADR-464 seams): every feature's slots register with no refusal and no hotkey clash, the one wiring
 * point adds its hooks once, a hook runs after each read and one that throws costs only itself, and the guard options are read from
 * the settings checked. Pure and fast: an in-memory disk, no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-merge.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { guardOptionsOf } from '../hooks/data/wf-alerts'
import type { Host } from '../hooks/host'
import { newState, optionsOf } from '../hooks/state'
import '../hooks/views/wf-register'
import { refused } from '../hooks/wf-drill'
import { afterRead, refreshWorkflows } from '../hooks/wf-live'
import { slotsFor } from '../hooks/views/wf-slots'
import { wireWorkflows } from '../hooks/wf-wire'

const host = { fs: { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }, invalidate: () => undefined, run: async () => ({ ok: false, stdout: '', stderr: '' }) } as unknown as Host

describe('registration', () => {
  it('registers every feature with no refusal, so no slot or hotkey was turned away', () => {
    expect(refused).toEqual([])
  })

  it('gives each hotkey to exactly one slot, and the worktree and template keys are held', () => {
    const keys = slotsFor('key').map(s => s.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(slotsFor('key').find(s => s.key === 'w')?.id).toBe('wt-read')
    expect(slotsFor('key').find(s => s.key === 't')?.id).toBe('wf-template-next')
    expect(slotsFor('action').find(s => s.hotkey === 'g')?.id).toBe('wf-template-launch')
    expect(slotsFor('key').filter(s => s.id.startsWith('drill-')).length).toBe(8)
    const hotkeys = slotsFor('action').flatMap(s => (s.hotkey === undefined ? [] : [s.hotkey]))

    expect(hotkeys).toEqual(expect.arrayContaining(['c', 'g']))
    expect(new Set([...keys, ...hotkeys]).size).toBe(keys.length + hotkeys.length)
  })

  it('registers the boards of all five features', () => {
    const ids = slotsFor('board').map(s => s.id)

    expect(slotsFor('tab').map(s => s.id)).toEqual(expect.arrayContaining(['anatole', 'mission', 'guide']))
    expect(slotsFor('notice').map(s => s.id)).toEqual(expect.arrayContaining(['links', 'wf-guard', 'wt-timer', 'anatole-read', 'drill-follow']))

    for (const id of ['drill', 'links', 'replay', 'wf-triage', 'wf-cost', 'worktrees', 'templates', 'anatole']) expect(ids).toContain(id)
  })
})

describe('after a read', () => {
  it('adds its four hooks once however often it is wired', () => {
    const state = newState({})
    const start = afterRead.length

    wireWorkflows(state, host)
    wireWorkflows(state, host)
    expect(afterRead.length - start).toBe(4)
  })

  it('runs each hook with the runs read, and a hook that throws costs only itself', async () => {
    const state = newState({})
    const seen: number[] = []

    state.view = 'workflows'
    state.isInteractive = false
    state.configDir = '/nowhere/.claude'
    state.cwd = '/work/proj'
    afterRead.push(() => Promise.reject(new Error('boom')), (_s, _h, before, runs) => void seen.push(runs.length + (before === null ? 100 : 0)))
    await refreshWorkflows(state, host, true, 1_000)
    expect(seen).toEqual([100])
    expect(state.wf.error).toBeNull()
  })
})

describe('guard options', () => {
  it('reads the three settings checked: out-of-range and wrong-typed values are off', () => {
    expect(guardOptionsOf({ wfBudgetRunUsd: 5, wfBudgetDayUsd: 20000, wfAlertRules: 'stuck>20m dirty' })).toEqual({ wfBudgetRunUsd: 5, wfBudgetDayUsd: 0, wfAlertRules: 'stuck>20m dirty' })
    expect(guardOptionsOf({ wfBudgetRunUsd: 'lots', wfAlertRules: 7 })).toEqual({ wfBudgetRunUsd: 0, wfBudgetDayUsd: 0, wfAlertRules: '' })
  })

  it('reaches state.options through optionsOf', () => {
    expect(optionsOf({ wfBudgetRunUsd: 2.5 }).wfBudgetRunUsd).toBe(2.5)
    expect(optionsOf(undefined).wfAlertRules).toBe('')
  })
})

describe('review fixes: the export takes its cost from the Cost section', () => {
  it('is null where nothing was read and a labelled estimate where something was', async () => {
    const { exportCostOf } = await import('../hooks/wf-wire')
    const { guards } = await import('../hooks/wf-cost-live')
    const { costRun } = await import('../hooks/data/wf-cost')
    const { buildRun } = await import('../hooks/data/workflows')
    const { journal, meta, started } = await import('./fixtures/workflows')
    const wfRun = buildRun({ id: 'wf_x', journal: journal(started('a1', 'build:a', 'Build')), agents: new Map([['a1', { meta: meta('a1', 'Build'), transcript: null, isTail: false, path: '/p/a1.jsonl' }]]), nowMs: 0 } as never)

    guards.costs.clear()
    expect(exportCostOf(wfRun)).toBeNull()
    guards.costs.set('wf_x', costRun(wfRun, new Map(), null))
    expect(exportCostOf(wfRun)).toBeNull()
  })
})
