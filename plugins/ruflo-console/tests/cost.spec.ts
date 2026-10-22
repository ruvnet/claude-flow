import { describe, expect, it } from 'vitest'

import { BUDGET_ARGV, budgetAmount, canSetBudget, ladderDollars, projectSpend, setBudget } from '../hooks/cost'
import { budgetConfigProbe, modelStatsProbe, probeArgv } from '../hooks/data/cli'
import { filterPalette, paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { CONFIGURE_HELP, MODEL_STATS } from './fixtures/cost'

const samples = [{ atMs: 0, value: 1 }, { atMs: 30_000, value: 1.5 }, { atMs: 60_000, value: 2 }]

describe('cost projection', () => {
  it('measures dollars per minute and remaining budget from elapsed time', () => {
    expect(projectSpend(samples, 5)).toEqual({ usdPerMinute: 1, minutes: 3 })
    expect(projectSpend(samples, 5, 4)).toEqual({ usdPerMinute: 1, minutes: 1 })
    expect(projectSpend(samples.map(s => ({ ...s, atMs: s.atMs * 2 })), 5)).toEqual({ usdPerMinute: 0.5, minutes: 6 })
  })

  it('needs three samples spanning a minute and rejects resets or malformed observations', () => {
    expect(projectSpend(samples.slice(1), 5)).toBeNull()
    expect(projectSpend(samples.map(s => ({ ...s, atMs: s.atMs / 2 })), 5)).toBeNull()
    for (const bad of [{ atMs: 30_000, value: 2 }, { atMs: 60_000, value: 0 }, { atMs: NaN, value: 2 }, { atMs: 60_000, value: Infinity }]) {
      expect(projectSpend([...samples.slice(0, 2), bad], 5)).toBeNull()
    }
  })

  it('has no arrival time without a budget or positive burn, and clamps reached budgets to zero', () => {
    for (const limit of [undefined, 0, -1, NaN, Infinity]) expect(projectSpend(samples, limit)).toBeNull()
    expect(projectSpend(samples.map(s => ({ ...s, value: 1 })), 5)).toEqual({ usdPerMinute: 0, minutes: null })
    expect(projectSpend(samples, 2)?.minutes).toBe(0)
    expect(projectSpend(samples, 1)?.minutes).toBe(0)
  })

  it('uses only the newest 20 observations', () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({ atMs: i * 60_000, value: i }))

    expect(projectSpend([{ atMs: -60_000, value: 200 }, ...recent], 25)).toEqual({ usdPerMinute: 1, minutes: 6 })
  })
})

describe('budget dollars and actions', () => {
  it('shows the exact ruflo-mods threshold dollars, with OK below INFO', () => {
    expect(ladderDollars(10)).toEqual([{ level: 'INFO', percent: 50, usd: 5 }, { level: 'WARNING', percent: 75, usd: 7.5 }, { level: 'CRITICAL', percent: 90, usd: 9 }, { level: 'HARD_STOP', percent: 100, usd: 10 }])
    for (const limit of [undefined, 0, -1, NaN]) expect(ladderDollars(limit).every(rung => rung.usd === null)).toBe(true)
  })

  it('validates the inclusive range without accepting flags or shell text', () => {
    for (const value of ['0.01', '.5', ' 5 ', '10000', '25.125']) expect(budgetAmount(value)).toBe(Number(value))
    for (const value of ['', '0', '0.009', '10000.01', '-1', 'NaN', 'Infinity', '1e2', '0x10', '$5', '--help', '5; touch /tmp/x', '5\n6']) expect(budgetAmount(value)).toBeNull()
  })

  it('requires confirmed support, sends only one option on stdin, and shows the exact change', () => {
    const state = newState({})

    expect(setBudget(state, '5')).toBeNull()
    state.probes.set('budget-config', { value: true, okAtMs: 1, error: null, errorAtMs: null, isRunning: false })
    expect(setBudget(state, '5')).toMatchObject({ argv: BUDGET_ARGV, stdin: '{"costBudgetUsd":"5"}' })
    expect(setBudget(state, '5')?.shows).toContain('stdin {"costBudgetUsd":"5"}')
    expect(setBudget(state, '5')?.isReadOnly).not.toBe(true)
    expect(setBudget(state, '--help')).toBeNull()
    state.probes.set('budget-config', { value: true, okAtMs: 1, error: 'refused', errorAtMs: 2, isRunning: false })
    expect(canSetBudget(state)).toBe(false)
  })

  it('uses the exact keyword as the custom palette id', () => {
    const entries = filterPalette(paletteEntries(newState({}), 0), 'cost-budget 12.5', 'all')

    expect(entries.map(entry => entry.id)).toEqual(['cost-budget'])
  })
})

describe('local cost probes', () => {
  it('distinguishes absent terminal cost from measured zero and suppresses stale model counts', () => {
    const state = newState({})
    const shown = () => viewText({ state, nowMs: 3, columns: 100, act: {} as Actions }, 'cost')

    state.terminal.turns.codex = 2
    expect(shown()).toContain('n/a · reported subtotal this session (0 cost reports)')
    expect(shown()).toContain('codex 2 · claude 0')
    state.terminal.costReports = 1
    expect(shown()).toContain('$0.000 · reported subtotal this session (1 cost reports)')
    state.terminal.costUsd = 0.42
    expect(shown()).toContain('$0.420 · reported subtotal')
    state.probes.set('model-stats', { value: modelStatsProbe.parse(MODEL_STATS), okAtMs: 1, error: 'offline cache missing', errorAtMs: 2, isRunning: false })
    expect(shown()).not.toContain('8 decisions')
    expect(shown()).toContain('offline cache missing')
  })

  it('gates both probes to Cost and forces offline even with the download-enabled choice', () => {
    expect(modelStatsProbe.views).toEqual(['cost'])
    expect(budgetConfigProbe.views).toEqual(['cost'])
    expect(probeArgv(modelStatsProbe, 'npx')).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest', 'hooks', 'model-stats', '--format', 'json'])
    expect(probeArgv(modelStatsProbe, 'ruflo')).toEqual(['ruflo', 'hooks', 'model-stats', '--format', 'json'])
    expect(probeArgv(budgetConfigProbe, 'npx')).toEqual(['claude', 'plugin', 'configure', '--help'])
  })

  it('recognizes configure help and does not mistake generic help for support', () => {
    expect(budgetConfigProbe.parse(CONFIGURE_HELP)).toBe(true)
    expect(budgetConfigProbe.parse('Usage: claude plugin [options]')).toBe(false)
  })

  it('keeps measured routing counts, with no invented costs or tokens', () => {
    expect(modelStatsProbe.parse(MODEL_STATS)).toEqual({ isAvailable: true, total: 8, models: [{ name: 'haiku', count: 5 }, { name: 'sonnet', count: 3 }, { name: 'opus', count: 0 }, { name: 'inherit', count: 0 }] })
    expect(modelStatsProbe.parse('{"available":false}')).toEqual({ isAvailable: false, models: [] })
    expect(modelStatsProbe.parse('{"available":true,"modelDistribution":{"bad":-1,"string":"2"}}')?.models).toEqual([])
    expect(modelStatsProbe.parse('{}')).toBeNull()
    expect(modelStatsProbe.parse('not JSON')).toBeNull()
  })
})
