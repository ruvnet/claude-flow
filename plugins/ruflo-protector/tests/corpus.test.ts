import { describe, expect, test, tier } from 'claude-code/testing'

import { corpus, engine, feed, matureEngine } from './support'

tier('user')

describe('corpus gate (ADR-453 section 3)', () => {
  test('at least 20 benign traces, and each rule has an attack trace', () => {
    expect(corpus('benign').length).toBeGreaterThanOrEqual(20)
    const ids = new Set(corpus('attacks').map(f => f.name.slice(0, 6)))
    for (let i = 1; i <= 13; i++) expect(ids.has(`PR-${String(i).padStart(3, '0')}`)).toBe(true)
  })

  test('benign traces give ZERO alerts and no block after a mature baseline (notify and enforce)', () => {
    for (const mode of ['notify', 'enforce'] as const) {
      const e = matureEngine(mode)
      const noisy: string[] = []
      for (const f of corpus('benign')) {
        const out = feed(e, f.items, 1_000_000 + 9 * 86_400_000)
        if (out.some(o => o.alert || o.verdict === 'block' || o.verdict === 'notify')) noisy.push(`${f.name}: ${out.flatMap(o => o.rules).join(',')}`)
      }
      expect(noisy).toEqual([])
      expect(e.alerts).toHaveLength(0)
    }
  })

  test('benign traces are also quiet on a brand-new project in notify (rules only)', () => {
    const e = engine('notify')
    for (const f of corpus('benign')) feed(e, f.items, 1_000_000)
    expect(e.alerts.map(a => a.rule)).toEqual([])
  })

  test('every attack trace is caught by the rule named in its file name', () => {
    const missed: string[] = []
    for (const f of corpus('attacks')) {
      const rule = f.name.slice(0, 6)
      const out = feed(matureEngine('enforce'), f.items, 1_000_000 + 9 * 86_400_000)
      if (!out.some(o => o.rules.includes(rule))) missed.push(f.name)
    }
    expect(missed).toEqual([])
  })
})
