/**
 * Two runs of one workflow side by side (ADR-461): matching, marks and the thresholds that make a difference a change. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-compare.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { compareRuns, fmtRatio, otherRunsOf, TIME_DELTA, TOKEN_DELTA, type Comparison } from '../hooks/data/wf-compare'
import { BASE, runOf, type RecAgent } from './fixtures/wf-runs'

const ok = (c: ReturnType<typeof compareRuns>): Comparison => {
  if (!c.ok) throw new Error(c.why)

  return c
}
const marks = (c: Comparison): Record<string, string> => Object.fromEntries(c.rows.map(r => [r.label, r.mark]))
const tweak = (patch: Partial<RecAgent> & { id: string }): RecAgent[] => BASE.map(a => (a.id === patch.id ? { ...a, ...patch } : a))

describe('which runs compare', () => {
  it('offers only other workflow runs with the same name', () => {
    const a = runOf('wf_a', BASE)
    const b = runOf('wf_b', BASE)
    const other = runOf('wf_c', BASE, {}, 'another')

    expect(otherRunsOf(a, [a, b, other]).map(r => r.id)).toEqual(['wf_b'])
    expect(compareRuns(a, other)).toMatchObject({ ok: false, why: expect.stringMatching(/different workflows/) })
    expect(compareRuns(a, a)).toMatchObject({ ok: false })
  })
})

describe('marks', () => {
  it('= for identical runs, with totals', () => {
    const c = ok(compareRuns(runOf('wf_a', BASE), runOf('wf_b', BASE)))

    expect(Object.values(marks(c))).toEqual(['=', '=', '='])
    expect(c.counts).toEqual({ same: 3, changed: 0, added: 0, removed: 0 })
    expect(c.totals.agents).toMatchObject({ a: 3, b: 3, diff: 0 })
  })

  it('+ for an agent only in B and - for one only in A', () => {
    const b = runOf('wf_b', [...BASE.filter(a => a.id !== 'ra3'), { id: 'rb9', label: 'extra', phase: 'Review', at: 70, ms: 5, tokens: 10 }])
    const c = ok(compareRuns(runOf('wf_a', BASE), b))

    expect(marks(c)).toMatchObject({ 'review:a': '-', extra: '+' })
    expect(c.counts).toMatchObject({ added: 1, removed: 1 })
  })

  it('~ on a state change or a model change', () => {
    const c = ok(compareRuns(runOf('wf_a', BASE), runOf('wf_b', tweak({ id: 'ra1', state: 'failed' }))))

    expect(c.rows.find(r => r.label === 'build:a')).toMatchObject({ mark: '~', stateChange: 'done → failed' })

    const m = ok(compareRuns(runOf('wf_a', tweak({ id: 'ra1', model: 'claude-opus-5-5' })), runOf('wf_b', tweak({ id: 'ra1', model: 'claude-sonnet-5-5' }))))

    expect(m.rows[0]).toMatchObject({ mark: '~', modelChange: 'claude-opus-5-5 → claude-sonnet-5-5' })
  })

  it('treats tokens as changed from exactly TOKEN_DELTA, not below it', () => {
    const at = (tokens: number) => ok(compareRuns(runOf('wf_a', BASE), runOf('wf_b', tweak({ id: 'ra1', tokens })))).rows[0]?.mark

    expect(TOKEN_DELTA).toBe(0.1)
    expect(at(180_000 * 1.1)).toBe('~')
    expect(at(180_000 * 1.099)).toBe('=')
    expect(at(180_000 * 0.9)).toBe('~')
  })

  it('treats time as changed from exactly TIME_DELTA, not below it', () => {
    const at = (ms: number) => ok(compareRuns(runOf('wf_a', BASE), runOf('wf_b', tweak({ id: 'ra1', ms })))).rows[0]?.mark

    expect(TIME_DELTA).toBe(0.25)
    expect(at(75)).toBe('~')
    expect(at(74.9)).toBe('=')
  })

  it('never counts an unknown figure as a change', () => {
    const noTokens = BASE.map(a => (a.id === 'ra1' ? { id: a.id, label: a.label, phase: a.phase, at: a.at, ms: a.ms } : a))
    const c = ok(compareRuns(runOf('wf_a', BASE), runOf('wf_b', noTokens)))
    const row = c.rows.find(r => r.label === 'build:a')

    expect(row?.mark).toBe('=')
    expect(row?.tokens.diff).toBeUndefined()
    expect(fmtRatio(row?.tokens ?? {})).toBe('n/a')
  })

  it('pairs agents of one label by order, so a repeated label does not collapse', () => {
    const twice = (t2: number): RecAgent[] => [{ id: 'q1', label: 'w', phase: 'Build', at: 0, ms: 10, tokens: 100 }, { id: 'q2', label: 'w', phase: 'Build', at: 0, ms: 10, tokens: t2 }]
    const c = ok(compareRuns(runOf('wf_a', twice(100)), runOf('wf_b', twice(500))))

    expect(c.rows.map(r => r.mark)).toEqual(['=', '~'])
  })

  it('notes a floor and a run with no record, and a differing result', () => {
    const a = runOf('wf_a', BASE)
    const b = { ...runOf('wf_b', BASE), hasRecord: false, isTokensPartial: true }
    const c = ok(compareRuns(a, b))

    expect(c.notes.join(' ')).toMatch(/floor/)
    expect(c.notes.join(' ')).toMatch(/run B is derived/)
  })
})

describe('fmtRatio', () => {
  it('reads a percent with a sign and caps the extremes', () => {
    expect(fmtRatio({ ratio: 0.1234 })).toBe('+12%')
    expect(fmtRatio({ ratio: -0.5 })).toBe('-50%')
    expect(fmtRatio({ ratio: 50 })).toBe('>+999%')
    expect(fmtRatio({ diff: 0 })).toBe('0%')
  })
})
