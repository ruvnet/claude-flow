import { describe, expect, it } from 'vitest'

import { COST_PROBES, ledgerArgv, parseLedger, safeInstallPath, trackerOf } from '../hooks/data/cost-ledger'
import { probeArgv, probeReady, PROBES } from '../hooks/data/cli'
import { parseInstalled } from '../hooks/data/facts'
import { newState, type State } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { moneyText, shortModel, spark } from '../hooks/views/cost-providers'
import { viewText } from '../hooks/views/pane'

const LEDGER = JSON.stringify({
  since: '7d', priceDate: '2026-10-03', rows: 5,
  totals: { usd: 2945.1, credits: 41104.4 },
  byProvider: { claude: { usd: 2945.1 }, codex: { credits: 41104.4 } },
  byModel: { 'claude|claude-opus-5-5': { usd: 2191.8 }, 'codex|gpt-6-astra': { credits: 41104.4 } },
  tokens: { 'claude|claude-opus-5-5': { messages: 16885, output: 6101817 }, 'codex|gpt-6-astra': { messages: 1348, output: 566209 } },
  byDay: { '2026-10-02': { usd: 400 }, '2026-10-01': { usd: 100 }, '2026-10-03': { usd: 200 } },
  cache: { claude: { hitRatio: 0.981 }, codex: { hitRatio: 0.977 } },
  unpriced: { 'gpt-5.6-sol': { messages: 35 } },
  approx: [],
  findings: [
    { id: 'subagents-claude-opus-5-5', unit: 'usd', saving: 191.13, title: 'Sub-agents ran on claude-opus-5-5', evidence: '9782 sub-agent messages', action: 'Give simple sub-agents model: claude-sonnet-5-5.' },
    { id: 'context-bloat', unit: null, saving: null, title: '3 long sessions re-read a large context', evidence: 'x', action: '/compact at a natural break.' },
  ],
})

const installed = (path: string, version = '0.27.0'): State => {
  const state = newState({})

  state.snapshot = { plugins: { installed: [{ id: 'ruflo-cost-tracker@ruflo', name: 'ruflo-cost-tracker', marketplace: 'ruflo', version, scope: 'user', installPath: path }] } } as unknown as State['snapshot']

  return state
}
const shown = (state: State) => viewText({ state, nowMs: 5, columns: 110, act: {} as Actions }, 'cost')

describe('the multi-provider ledger probe', () => {
  it('parses the ledger JSON, keeping USD and credits as separate currencies', () => {
    const ledger = parseLedger(LEDGER)

    expect(ledger?.totals).toEqual({ usd: 2945.1, credits: 41104.4 })
    expect(ledger?.providers).toEqual([{ name: 'claude', cost: { usd: 2945.1 }, hitRatio: 0.981 }, { name: 'codex', cost: { credits: 41104.4 }, hitRatio: 0.977 }])
    expect(ledger?.models[0]).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5', messages: 16885 })
    expect(ledger?.days.map(day => day.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(ledger?.unpriced).toEqual(['gpt-5.6-sol'])
    expect(ledger?.findings[1]).toMatchObject({ saving: null, unit: null })
  })

  it('is null for anything that is not the ledger, and strips control text', () => {
    for (const bad of ['', 'not json', '{"a":1}', '[]']) expect(parseLedger(bad)).toBeNull()
    expect(parseLedger(JSON.stringify({ totals: {}, byProvider: { 'cl\u001b[31maude': { usd: 1 } } }))?.providers[0]?.name).not.toContain('\u001b')
  })

  it('takes the script path only from a validated install path', () => {
    expect(safeInstallPath('/home/u/.claude/plugins/cache/ruflo/ruflo-cost-tracker/0.27.0')).toBeDefined()
    for (const bad of ['relative/path', '/a/../etc', '/x; rm', '/x$(id)', '/x`id`', '', undefined, 42, `/${'a'.repeat(400)}`]) expect(safeInstallPath(bad)).toBeUndefined()
  })

  it('builds a fixed argv from the installed plugin, and none when it is absent or hostile', () => {
    expect(ledgerArgv(installed('/p/ruflo-cost-tracker/0.27.0'))).toEqual(['node', '/p/ruflo-cost-tracker/0.27.0/scripts/ledger.mjs', '--since', '7d', '--format', 'json', '--advise'])
    expect(ledgerArgv(newState({}))).toBeNull()
    expect(ledgerArgv(installed('/p/$(id)'))).toBeNull()
    expect(probeArgv(COST_PROBES[0], 'npx', installed('/p/ruflo-cost-tracker/0.27.0'))[1]).toBe('/p/ruflo-cost-tracker/0.27.0/scripts/ledger.mjs')
    expect(COST_PROBES[0].views).toEqual(['cost'])
    expect(COST_PROBES[0].isNetwork).toBeUndefined()
  })

  it('runs only while the tracker is installed and new enough: absent or old means the probe is not ready, every other probe always is', () => {
    expect(probeReady(COST_PROBES[0], newState({}))).toBe(false)
    expect(probeReady(COST_PROBES[0], installed('/p/ruflo-cost-tracker/0.26.3', '0.26.3'))).toBe(false)
    expect(probeReady(COST_PROBES[0], installed('/p/ruflo-cost-tracker/0.27.0'))).toBe(true)
    expect(probeReady(COST_PROBES[0], installed('/p/ruflo-cost-tracker/1.0.0', '1.0.0'))).toBe(true)
    expect(trackerOf(installed('/p/x', '0.26.3'))).toEqual({ kind: 'old', version: '0.26.3' })
    expect(trackerOf(installed('/p/x', 'unknown'))).toEqual({ kind: 'old', version: 'unknown' })
    for (const probe of PROBES.filter(candidate => candidate.argvOf === undefined)) expect(probeReady(probe, newState({}))).toBe(true)
  })

  it('reads installPath from installed_plugins.json only when it is a short string', () => {
    const file = (installPath: unknown) => JSON.stringify({ version: 2, plugins: { 'ruflo-cost-tracker@ruflo': [{ scope: 'user', version: '0.27.0', installPath }] } })

    expect(parseInstalled(file('/p/x'))?.[0]?.installPath).toBe('/p/x')
    expect(parseInstalled(file(7))?.[0]?.installPath).toBeUndefined()
    expect(parseInstalled(file('/'.padEnd(400, 'a')))?.[0]?.installPath).toBeUndefined()
  })
})

describe('the Cost page across providers', () => {
  it('says the plugin is missing, with a way to install it, and shows nothing invented', () => {
    const text = shown(newState({}))

    expect(text).toContain('Across providers')
    expect(text).toContain('ruflo-cost-tracker is not installed')
    expect(text).toContain('Plugin Catalog: ruflo-cost-tracker')
  })

  it('says an installed but older tracker needs updating, and does not show a ledger', () => {
    const text = shown(installed('/p/ruflo-cost-tracker/0.26.3', '0.26.3'))

    expect(text).toContain('ruflo-cost-tracker 0.26.3 is installed; needs 0.27.0 or newer')
    expect(text).toContain('Plugins: update it')
  })

  it('shows each provider in its own currency, the cache hit, unpriced models and the savings with evidence', () => {
    const state = installed('/p/ruflo-cost-tracker/0.27.0')

    state.probes.set('cost-ledger', { value: parseLedger(LEDGER), okAtMs: 1, error: null, errorAtMs: null, isRunning: false })
    const text = shown(state)

    expect(text).toContain('$2,945 · cache hit')
    expect(text).toContain('41,104 credits')
    expect(text).toContain('Unpriced, NOT counted as $0: gpt-5.6-sol')
    expect(text).toContain('never added together')
    expect(text).toContain('ledger: cost-tracker plugin')
    expect(text).toContain('Sub-agents ran on claude-opus-5-5')
    expect(text).toContain('up to $191 ·')
    expect(text).toContain('saving n/a')
    expect(text).not.toMatch(/\$2,945\.1.*credits|credits.*\$2,945/)
  })

  it('does not show a stale ledger as live', () => {
    const state = installed('/p/ruflo-cost-tracker/0.27.0')

    state.probes.set('cost-ledger', { value: parseLedger(LEDGER), okAtMs: 1, error: 'exit 1: boom', errorAtMs: 2, isRunning: false })
    expect(shown(state)).not.toContain('$2,945')
    expect(shown(state)).toContain('boom')
  })
})

describe('ledger formatting', () => {
  it('keeps sonnet-5 and sonnet-5-5 apart and drops dates', () => {
    expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
    expect(shortModel('claude-sonnet-5')).toBe('sonnet-5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
    expect(shortModel('gpt-6-astra')).toBe('gpt-6-astra')
  })

  it('scales the daily bars to the busiest day', () => {
    expect(spark([0, 50, 100])).toBe('▁▄█')
    expect(spark([0, 0])).toBe('▁▁')
  })

  it('writes dollars and credits apart', () => {
    expect(moneyText({ usd: 12.5 })).toBe('$12.50')
    expect(moneyText({ credits: 1234.4 })).toBe('1,234 credits')
    expect(moneyText({})).toBe('n/a')
  })
})
