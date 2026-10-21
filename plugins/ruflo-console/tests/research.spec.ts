import { describe, expect, it } from 'vitest'

import { probeArgv, probeReady, PROBES } from '../hooks/data/cli'
import { parseInstalled } from '../hooks/data/facts'
import { goalsOf, parseResearch, researchArgv, researchProbe, safeInstallPath } from '../hooks/data/research'
import { mcOf } from '../hooks/mission-control'
import { newState, type State } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { spendText } from '../hooks/views/research-section'

const finding = (grade: string) => ({ claim: 'c', grade, sources: ['https://example.test/a'] })
const LIST = JSON.stringify({
  version: 1,
  records: [
    { version: 1, question: 'older question', depth: 'quick', capUsd: 1, spentUsd: 0.2, status: 'truncated', at: '2026-10-03T10:00:00Z', findings: [finding('Low')], screened: true },
    { version: 1, question: 'How do raft leaders fail over?', depth: 'standard', capUsd: 2, spentUsd: null, status: 'done', at: '2026-10-04T09:00:00Z', findings: [finding('High'), finding('High'), finding('Medium'), finding('bogus')], screened: true },
    { question: 'no screening', status: 'weird', at: '2026-10-01T00:00:00Z', findings: [] },
    { question: '', status: 'done' },
    'junk',
  ],
})

const installed = (path: string, version = '0.3.0'): State => {
  const state = newState({})

  state.snapshot = { plugins: { installed: [{ id: 'ruflo-goals@ruflo', name: 'ruflo-goals', marketplace: 'ruflo', version, scope: 'user', installPath: path }] } } as unknown as State['snapshot']

  return state
}
const shown = (state: State) => {
  mcOf(state).tab = 'record'

  return viewText({ state, nowMs: Date.parse('2026-10-04T12:00:00Z'), columns: 100, act: {} as Actions }, 'missions')
}
const result = (state: State, value: unknown, error: string | null = null, errorAtMs: number | null = null) => state.probes.set('research', { value, okAtMs: Date.parse('2026-10-04T11:58:00Z'), error, errorAtMs, isRunning: false })

describe('the research list parser', () => {
  it('reads records newest first, counting findings and the three grades, and keeps unknown spend as null', () => {
    const records = parseResearch(LIST)

    expect(records?.map(record => record.question)).toEqual(['How do raft leaders fail over?', 'older question', 'no screening'])
    expect(records?.[0]).toMatchObject({ status: 'done', findings: 4, grades: { High: 2, Medium: 1, Low: 0 }, spentUsd: null, capUsd: 2, isScreened: true })
    expect(records?.[1]).toMatchObject({ status: 'truncated', spentUsd: 0.2 })
    expect(records?.[2]).toMatchObject({ status: 'unknown', isScreened: false, findings: 0 })
  })

  it('is null for anything that is not version 1, and strips control text and bad numbers', () => {
    for (const bad of ['', 'nope', '[]', '{"records":[]}', '{"version":2,"records":[]}', '{"version":1}']) expect(parseResearch(bad)).toBeNull()
    expect(parseResearch(JSON.stringify({ version: 1, records: [{ question: 'q\u001b[31mx', spentUsd: -3, status: 'done' }] }))?.[0]).toMatchObject({ spentUsd: null })
    expect(parseResearch(JSON.stringify({ version: 1, records: [{ question: 'q\u001b[31mx', status: 'done' }] }))?.[0]?.question).not.toContain('\u001b')
  })

  it('caps the records it keeps', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ question: `q${i}`, status: 'done' }))

    expect(parseResearch(JSON.stringify({ version: 1, records: many }))).toHaveLength(8)
  })
})

describe('the research probe', () => {
  it('takes the script path only from a validated install path', () => {
    expect(safeInstallPath('/home/u/.claude/plugins/cache/ruflo/ruflo-goals/0.3.0')).toBeDefined()
    for (const bad of ['relative', '/a/../etc', '/x; rm', '/x$(id)', '/x`id`', '', undefined, 42, `/${'a'.repeat(400)}`]) expect(safeInstallPath(bad)).toBeUndefined()
  })

  it('builds a fixed argv, and none when absent, old or hostile', () => {
    expect(researchArgv(installed('/p/ruflo-goals/0.3.0'))).toEqual(['node', '/p/ruflo-goals/0.3.0/scripts/research-list.mjs', '--limit', '8'])
    expect(researchArgv(newState({}))).toBeNull()
    expect(researchArgv(installed('/p/$(id)'))).toBeNull()
    expect(researchArgv(installed('/p/x', '0.2.9'))).toBeNull()
    expect(probeArgv(researchProbe, 'npx', installed('/p/ruflo-goals/0.3.0'))[1]).toBe('/p/ruflo-goals/0.3.0/scripts/research-list.mjs')
    expect(researchProbe.views).toEqual(['missions'])
    expect(researchProbe.everyMs).toBeGreaterThanOrEqual(300_000)
    expect(PROBES).toContain(researchProbe)
  })

  it('is ready only while ruflo-goals is new enough, and every other probe always is', () => {
    expect(probeReady(researchProbe, newState({}))).toBe(false)
    expect(probeReady(researchProbe, installed('/p/x', '0.2.9'))).toBe(false)
    expect(probeReady(researchProbe, installed('/p/x', '0.3.0'))).toBe(true)
    expect(probeReady(researchProbe, installed('/p/x', '1.0.0'))).toBe(true)
    expect(goalsOf(installed('/p/x', 'unknown'))).toEqual({ kind: 'old', version: 'unknown' })
    for (const probe of PROBES.filter(entry => entry !== researchProbe)) expect(probeReady(probe, newState({}))).toBe(true)
  })

  it('reads installPath from installed_plugins.json only when it is a short string', () => {
    const file = (installPath: unknown) => JSON.stringify({ version: 2, plugins: { 'ruflo-goals@ruflo': [{ scope: 'user', version: '0.3.0', installPath }] } })

    expect(parseInstalled(file('/p/x'))?.[0]?.installPath).toBe('/p/x')
    expect(parseInstalled(file(7))?.[0]?.installPath).toBeUndefined()
  })
})

describe('the Research section on the Missions page', () => {
  it('says ruflo-goals is missing, with a way to get it', () => {
    const text = shown(newState({}))

    expect(text).toContain('Research')
    expect(text).toContain('ruflo-goals is not installed')
    expect(text).toContain('Plugin Catalog: ruflo-goals')
  })

  it('says an older ruflo-goals needs updating and lists nothing', () => {
    const text = shown(installed('/p/x', '0.2.9'))

    expect(text).toContain('ruflo-goals 0.2.9; needs 0.3.0 or newer')
    expect(text).toContain('Plugins: update it')
  })

  it('lists question, status, findings, grade counts and spend, with n/a for unknown spend', () => {
    const state = installed('/p/ruflo-goals/0.3.0')

    result(state, parseResearch(LIST))
    const text = shown(state)

    expect(text).toContain('How do raft leaders fail over?')
    expect(text).toContain('done · 4 findings')
    expect(text).toContain('High 2 · Medium 1 · Low 0 · spend n/a')
    expect(text).toContain('truncated · 1 finding ·')
    expect(text).toContain('spend $0.20')
    expect(text).toContain('unscreened')
    expect(text).toContain('Read-only')
    expect(text.indexOf('How do raft')).toBeLessThan(text.indexOf('older question'))
  })

  it('says so when there are no records, and keeps every line short enough for the host', () => {
    const state = installed('/p/ruflo-goals/0.3.0')

    result(state, [])
    expect(shown(state)).toContain('No research records yet.')
    result(state, parseResearch(JSON.stringify({ version: 1, records: [{ question: 'x'.repeat(200), status: 'done' }] })))
    for (const line of shown(state).split('\n').filter(l => /Read-only|records:/.test(l))) expect(line.trim().length).toBeLessThanOrEqual(50)
  })

  it('does not show stale records as live', () => {
    const state = installed('/p/ruflo-goals/0.3.0')

    result(state, parseResearch(LIST), 'exit 1: boom', Date.parse('2026-10-04T11:59:00Z'))
    const text = shown(state)

    expect(text).not.toContain('raft leaders')
    expect(text).toContain('boom')
  })

  it('formats spend without inventing it', () => {
    expect(spendText(null)).toBe('n/a')
    expect(spendText(0)).toBe('$0.000')
    expect(spendText(1.234)).toBe('$1.23')
  })
})
