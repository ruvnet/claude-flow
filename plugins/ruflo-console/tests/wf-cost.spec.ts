/**
 * Workflows cost and guards (ADR-462), the pure half: transcript usage, the price book and its lookup, what a run costs by phase and
 * agent, the options and rules, and the guard evaluator. Fast and disk-free. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-cost.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { alertKey, evaluateGuards, guardOptionsOf, newAlerts, parseGuardRules, trackProgress, type GuardInput, type GuardRules, NO_RULES } from '../hooks/data/wf-alerts'
import { billedTokens, costOfUsage, costRun, fmtCosted, fmtUsd, isUnread, parsePriceBook, priceFor, spendOf, usageOfTranscript, usdOf, zeroUsage, type AgentUsage, type PriceBook } from '../hooks/data/wf-cost'
import { buildRun, type WfRun } from '../hooks/data/workflows'
import { journal, meta, result, started, T0, transcript } from './fixtures/workflows'

const BOOK_TEXT = JSON.stringify({
  asOf: '2026-10-03',
  models: [
    { id: 'claude-opus-5-5', provider: 'claude', match: 'opus-5', unit: 'usd', input: 4, output: 20, cache_write_5m: 5, cache_write_1h: 8, cache_read: 0.2 },
    { id: 'claude-sonnet-5-5', provider: 'claude', match: 'sonnet-5', unit: 'usd', input: 2, output: 10, cache_write_5m: 2.5, cache_write_1h: 4, cache_read: 0.2 },
    { id: 'claude-opus-legacy', provider: 'claude', match: 'opus', unit: 'usd', input: 15, output: 75, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, approx: true },
    { id: 'claude-haiku-nocache', provider: 'claude', match: 'haiku', unit: 'usd', input: 1, output: 5 },
    { id: 'gpt-5', provider: 'codex', match: 'gpt-5', unit: 'usd', input: 1, output: 1 },
    { id: 'gpt-6-sol', provider: 'claude', match: 'gpt-6', unit: 'credits', input: 50, output: 250 },
    { id: 'broken', provider: 'claude', match: 'x', unit: 'usd', input: 'a', output: 1 },
  ],
})
const BOOK = parsePriceBook(BOOK_TEXT) as PriceBook

const line = (over: { id?: string; model?: string; role?: string; usage: Record<string, unknown>; requestId?: string }): string =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(T0).toISOString(), requestId: over.requestId ?? 'r1', message: { id: over.id ?? 'm1', model: over.model ?? 'claude-sonnet-5-5', role: over.role ?? 'assistant', content: [], usage: over.usage } })

describe('usageOfTranscript', () => {
  it('counts a streamed request once, each bucket at its largest, and sums distinct requests', () => {
    const usage = usageOfTranscript(transcript([{ at: 1, id: 'm1', input: 10, write: 100, read: 1000, output: 50 }, { at: 2, id: 'm2', input: 20, write: 0, read: 2000, output: 70 }]))
    const sonnet = usage.get('claude-sonnet-5-5')

    // The fixture streams each request on two lines, the first with output 3: the real count (50, 70) wins, not the first line's.
    expect(sonnet).toMatchObject({ input: 30, cacheRead: 3000, write5m: 100, write1h: 0, output: 120, messages: 2 })
    expect(billedTokens({ usd: 0, pricedTokens: 3250, unpricedTokens: 0, unpricedModels: [], isApprox: false, isFloor: false })).toBe(3250)
  })

  it('splits cache writes by TTL where the transcript says, and marks them unsplit where it does not', () => {
    const split = usageOfTranscript(line({ usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } } }))
    const bare = usageOfTranscript(line({ usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 300 } }))

    expect(split.get('claude-sonnet-5-5')).toMatchObject({ write5m: 100, write1h: 200, isUnsplit: false })
    expect(bare.get('claude-sonnet-5-5')).toMatchObject({ write5m: 300, write1h: 0, isUnsplit: true })
  })

  it('skips synthetic, model-less, non-assistant and half-written lines, and keeps models apart', () => {
    const text = [line({ model: '<synthetic>', usage: { input_tokens: 99 } }), line({ role: 'user', id: 'u', usage: { input_tokens: 99 } }), '{"half":', line({ id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 5 } }), line({ id: 'b', usage: { input_tokens: 7 } })].join('\n')
    const usage = usageOfTranscript(text)

    expect([...usage.keys()].sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(usage.get('claude-opus-5-5')?.input).toBe(5)
    expect(usageOfTranscript(null).size).toBe(0)
  })

  it('drops the first, probably cut, line of a tail', () => {
    const text = `${line({ id: 'cut', usage: { input_tokens: 1000 } })}\n${line({ id: 'kept', usage: { input_tokens: 5 } })}\n`

    expect(usageOfTranscript(text, true).get('claude-sonnet-5-5')?.input).toBe(5)
    expect(usageOfTranscript(text, false).get('claude-sonnet-5-5')?.input).toBe(1005)
  })
})

describe('the price book', () => {
  it('keeps the well-formed Claude USD entries and nothing else', () => {
    expect(BOOK.asOf).toBe('2026-10-03')
    expect(BOOK.models.map(model => model.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-legacy', 'claude-haiku-nocache'])
    expect(parsePriceBook('not json')).toBeNull()
    expect(parsePriceBook('{"models":3}')).toBeNull()
    expect(parsePriceBook(null)).toBeNull()
  })

  it('finds the most specific entry, as the ledger does', () => {
    expect(priceFor(BOOK, 'claude-opus-5-5')?.id).toBe('claude-opus-5-5')
    expect(priceFor(BOOK, 'claude-opus-4-1')?.id).toBe('claude-opus-legacy')
    expect(priceFor(BOOK, 'claude-opus-4-1')?.isApprox).toBe(true)
    expect(priceFor(BOOK, 'claude-mystery-9')).toBeNull()
    expect(priceFor(null, 'claude-opus-5-5')).toBeNull()
    expect(priceFor(BOOK, '')).toBeNull()
  })

  it('treats a pattern that does not compile as no match instead of throwing', () => {
    const odd = parsePriceBook(JSON.stringify({ models: [{ id: 'a', provider: 'claude', match: 'zzz', re: '(', unit: 'usd', input: 1, output: 1 }] })) as PriceBook

    expect(priceFor(odd, 'zzz-1')).toBeNull()
  })
})

describe('what tokens cost', () => {
  const million = (over: Partial<ReturnType<typeof zeroUsage>>) => ({ ...zeroUsage(), ...over })

  it('prices each bucket at its own rate (sonnet-5: 2 / 10 / 0.2 / 2.5 / 4 per million)', () => {
    const price = priceFor(BOOK, 'claude-sonnet-5-5') as NonNullable<ReturnType<typeof priceFor>>

    expect(usdOf(million({ input: 1e6 }), price)).toBeCloseTo(2, 9)
    expect(usdOf(million({ output: 1e6 }), price)).toBeCloseTo(10, 9)
    expect(usdOf(million({ cacheRead: 1e6 }), price)).toBeCloseTo(0.2, 9)
    expect(usdOf(million({ write5m: 1e6 }), price)).toBeCloseTo(2.5, 9)
    expect(usdOf(million({ write1h: 1e6 }), price)).toBeCloseTo(4, 9)
  })

  it('bills an unpublished cache rate at the input rate and calls the figure approximate', () => {
    const haiku = priceFor(BOOK, 'claude-haiku-4-5') as NonNullable<ReturnType<typeof priceFor>>

    expect(usdOf(million({ cacheRead: 1e6, write5m: 1e6, write1h: 1e6 }), haiku)).toBeCloseTo(3, 9)
    expect(costOfUsage({ byModel: new Map([['claude-haiku-4-5', million({ cacheRead: 1e6 })]]), isTail: false }, BOOK).isApprox).toBe(true)
  })

  it('never turns a model with no price into $0: its tokens are counted apart and the cell says no price', () => {
    const cost = costOfUsage({ byModel: new Map([['claude-mystery-9', million({ input: 500, output: 500 })]]), isTail: false }, BOOK)

    expect(cost).toMatchObject({ usd: 0, pricedTokens: 0, unpricedTokens: 1000, unpricedModels: ['claude-mystery-9'] })
    expect(fmtCosted(cost)).toBe('no price')
    expect(fmtCosted(undefined)).toBe('n/a')
    // With no book at all (the tracker is absent) every model is unpriced.
    expect(fmtCosted(costOfUsage({ byModel: new Map([['claude-sonnet-5-5', million({ input: 5 })]]), isTail: false }, null))).toBe('no price')
  })

  it('marks a floor (tail read or unpriced company) and an approximate family price', () => {
    const mixed = costOfUsage({ byModel: new Map([['claude-sonnet-5-5', million({ output: 1e6 })], ['claude-mystery-9', million({ input: 1 })]]), isTail: false }, BOOK)
    const tail = costOfUsage({ byModel: new Map([['claude-sonnet-5-5', million({ output: 1e6 })]]), isTail: true }, BOOK)
    const family = costOfUsage({ byModel: new Map([['claude-opus-4-1', million({ output: 1e6 })]]), isTail: false }, BOOK)

    expect(fmtCosted(mixed)).toBe('≥$10.00 + unpriced')
    expect(fmtCosted(tail)).toBe('≥$10.00')
    expect(fmtCosted(family)).toBe('≈$75.00')
  })

  it('formats dollars at their boundaries', () => {
    expect([0, 0.0004, 0.001, 0.0999, 0.1, 99.994, 100, 1234.5].map(fmtUsd)).toEqual(['$0', '<$0.001', '$0.001', '$0.100', '$0.10', '$99.99', '$100', '$1235'])
  })
})

const run = (id = 'wf_c1'): WfRun =>
  buildRun({
    id,
    journal: journal(started('a1', 'build:a', 'Build'), started('a2', 'build:b', 'Build'), started('a3', 'rev:a', 'Review'), result('a1', 'ok')),
    agents: new Map(['a1', 'a2', 'a3'].map(agent => [agent, { meta: meta(agent, agent === 'a3' ? 'Review' : 'Build'), transcript: null, isTail: false, path: `/p/${agent}.jsonl` }])),
    record: null,
    script: null,
    nowMs: T0 + 5000,
    lastActivityMs: T0,
  })

const usageOf = (model: string, over: Partial<ReturnType<typeof zeroUsage>>): AgentUsage => ({ byModel: new Map([[model, { ...zeroUsage(), ...over }]]), isTail: false })

describe('costRun', () => {
  it('rolls agents into phases and the run, and shows an agent that was not read as n/a with the totals as floors', () => {
    const usage = new Map([['wf_c1/a1', usageOf('claude-sonnet-5-5', { output: 1e6 })], ['wf_c1/a3', usageOf('claude-opus-5-5', { output: 1e6 })]])
    const cost = costRun(run(), usage, BOOK)

    expect(cost.agents.get('a1')?.usd).toBeCloseTo(10, 9)
    expect(cost.agents.has('a2')).toBe(false)
    expect(cost.phases.get('Build')?.usd).toBeCloseTo(10, 9)
    expect(cost.phases.get('Build')?.isFloor).toBe(true)
    expect(cost.phases.get('Review')?.isFloor).toBe(false)
    expect(cost.total.usd).toBeCloseTo(30, 9)
    expect(cost).toMatchObject({ covered: 2, count: 3 })
    expect(fmtCosted(cost.total)).toBe('≥$30.00')
  })

  it('spendOf gives a floor flag and leaves out a run with no priced token', () => {
    const priced = costRun(run('wf_c1'), new Map([['wf_c1/a1', usageOf('claude-sonnet-5-5', { output: 1e6 })]]), BOOK)
    const dark = costRun(run('wf_c2'), new Map([['wf_c2/a1', usageOf('claude-mystery-9', { output: 1e6 })]]), BOOK)
    const spend = spendOf([priced, dark])

    expect([...spend.keys()]).toEqual(['wf_c1'])
    expect(spend.get('wf_c1')?.isFloor).toBe(true)
  })
})

describe('the options and rules', () => {
  it('reads dollar options from 0.01 to 10000 and turns anything else off', () => {
    const of = (value: unknown) => guardOptionsOf({ wfBudgetRunUsd: value }).wfBudgetRunUsd

    expect([of(0.01), of(0.009), of(10_000), of(10_001), of('5'), of('-1'), of('1e3'), of(Number.NaN), of(undefined), of(null)]).toEqual([0.01, 0, 10_000, 0, 5, 0, 0, 0, 0, 0])
    expect(guardOptionsOf(null)).toEqual({ wfBudgetRunUsd: 0, wfBudgetDayUsd: 0, wfAlertRules: '' })
  })

  it('parses stuck, tokens and dirty, and names every word it did not understand', () => {
    const rules = parseGuardRules({ wfAlertRules: 'stuck>20m, tokens>2M dirty', wfBudgetRunUsd: 5, wfBudgetDayUsd: 0 })

    expect(rules).toMatchObject({ stuckMin: 20, tokens: 2_000_000, isDirty: true, runUsd: 5, dayUsd: null, problems: [] })
    expect(parseGuardRules({ wfAlertRules: 'stuck>20 tokens>500k' })).toMatchObject({ stuckMin: 20, tokens: 500_000 })
    expect(parseGuardRules({}).stuckMin).toBeNull()
  })

  it('holds the rule limits: stuck 1 to 1440 minutes, tokens at least 1000', () => {
    expect([1, 1440].map(m => parseGuardRules({ wfAlertRules: `stuck>${m}` }).stuckMin)).toEqual([1, 1440])
    expect([0, 1441].map(m => parseGuardRules({ wfAlertRules: `stuck>${m}` }).stuckMin)).toEqual([null, null])
    expect(parseGuardRules({ wfAlertRules: 'tokens>1000' }).tokens).toBe(1000)
    expect(parseGuardRules({ wfAlertRules: 'tokens>999' }).tokens).toBeNull()

    const bad = parseGuardRules({ wfAlertRules: 'stuck>0 loud \u001b[31mdirty' })

    expect(bad.problems).toHaveLength(3)
    expect(bad.problems.join('')).not.toMatch(/\u001b/)
  })
})

const rules = (over: Partial<GuardRules>): GuardRules => ({ ...NO_RULES, problems: [], ...over })
const live = (running = true): WfRun => {
  const base = run('wf_g1')
  const state = running ? 'running' : 'done'

  return { ...base, startedMs: T0, totalTokens: 1_500_000, isTokensPartial: false, phases: base.phases.map(phase => ({ ...phase, agents: phase.agents.map(agent => ({ ...agent, state, hasWorktree: true })) })) }
}
const input = (over: Partial<GuardInput>): GuardInput => ({ runs: [live()], rules: rules({}), marks: new Map(), dirty: null, spend: new Map(), nowMs: T0 + 60_000, ...over })

describe('evaluateGuards', () => {
  it('raises the run ceiling at the ceiling and not below it, saying nothing was stopped', () => {
    const at = evaluateGuards(input({ rules: rules({ runUsd: 5 }), spend: new Map([['wf_g1', { usd: 5, isFloor: false }]]) }))
    const under = evaluateGuards(input({ rules: rules({ runUsd: 5 }), spend: new Map([['wf_g1', { usd: 4.99, isFloor: false }]]) }))

    expect(at.map(alert => alert.key)).toEqual([alertKey('budget-run', 'wf_g1')])
    expect(at[0]?.text).toMatch(/\$5\.00.*\$5\.00 run ceiling \(nothing was stopped\)/)
    expect(under).toEqual([])
  })

  it('counts only runs started in the last 24 hours towards the day ceiling', () => {
    const recent = live()
    const old = { ...live(), id: 'wf_old', startedMs: T0 - 86_400_000 - 1 }
    const spend = new Map([['wf_g1', { usd: 3, isFloor: false }], ['wf_old', { usd: 50, isFloor: false }]])
    const day = (usdCap: number) => evaluateGuards(input({ runs: [recent, old], rules: rules({ dayUsd: usdCap }), spend })).filter(alert => alert.key === 'budget-day')

    expect(day(3)).toHaveLength(1)
    expect(day(3.01)).toHaveLength(0)
    // A run started exactly 24h ago is still inside the window.
    expect(evaluateGuards(input({ runs: [{ ...recent, startedMs: T0 + 60_000 - 86_400_000 }], rules: rules({ dayUsd: 3 }), spend })).some(alert => alert.key === 'budget-day')).toBe(true)
  })

  it('raises the token rule at the threshold, with a floor sign for partial tokens', () => {
    expect(evaluateGuards(input({ rules: rules({ tokens: 1_500_000 }) })).map(alert => alert.key)).toEqual([alertKey('tokens', 'wf_g1')])
    expect(evaluateGuards(input({ rules: rules({ tokens: 1_500_001 }) }))).toEqual([])
    expect(evaluateGuards(input({ runs: [{ ...live(), isTokensPartial: true }], rules: rules({ tokens: 1000 }) }))[0]?.text).toContain('≥1.5M')
  })

  it('raises stuck from a mark that has not moved for N minutes, and at once for a stale agent when N is within 15', () => {
    const marks = new Map([['wf_g1/a1', { sig: 's', sinceMs: T0 }]])
    const at = (nowMs: number, stuckMin: number) => evaluateGuards(input({ rules: rules({ stuckMin }), marks, nowMs })).map(alert => alert.key)

    expect(at(T0 + 20 * 60_000, 20)).toEqual([alertKey('stuck', 'wf_g1', 'a1')])
    expect(at(T0 + 20 * 60_000 - 1, 20)).toEqual([])

    const stale = { ...live(), phases: live().phases.map(phase => ({ ...phase, agents: phase.agents.map(agent => ({ ...agent, state: 'stale' as const })) })) }

    expect(evaluateGuards(input({ runs: [stale], rules: rules({ stuckMin: 15 }) })).length).toBe(3)
    expect(evaluateGuards(input({ runs: [stale], rules: rules({ stuckMin: 16 }) }))).toEqual([])
  })

  it('raises dirty only for an ended agent whose worktree was read dirty: no reading, a clean one, or a running agent is silent', () => {
    const ended = live(false)
    const dirty = new Map([['wf_g1/a1', true], ['wf_g1/a2', false]])
    const keys = (runs: WfRun[], map: ReadonlyMap<string, boolean> | null) => evaluateGuards(input({ runs, rules: rules({ isDirty: true }), dirty: map })).map(alert => alert.key)

    expect(keys([ended], dirty)).toEqual([alertKey('dirty', 'wf_g1', 'a1')])
    expect(keys([ended], null)).toEqual([])
    expect(keys([live(true)], dirty)).toEqual([])
  })

  it('ignores a ruflo swarm and a run with no figure', () => {
    expect(evaluateGuards(input({ runs: [{ ...live(), kind: 'ruflo-swarm' }], rules: rules({ tokens: 1000, runUsd: 1 }), spend: new Map([['wf_g1', { usd: 9, isFloor: false }]]) }))).toEqual([])
    expect(evaluateGuards(input({ rules: rules({ runUsd: 1 }) }))).toEqual([])
  })

  it('strips control characters from the names it puts in a notice', () => {
    const run = { ...live(), name: 'x\u001b[31mred' }
    const text = evaluateGuards(input({ runs: [run], rules: rules({ tokens: 1000 }) }))[0]?.text ?? ''

    expect(text).not.toMatch(/\u001b/)
  })
})

describe('alert keys', () => {
  it('stay distinct for 17-character ids that differ only in the last character, and fit the 40 the notice ring keeps', () => {
    const run = 'wf_8a5f1ac7-b9a-4'
    const keys = [alertKey('stuck', run, 'a362131950d43961b'), alertKey('stuck', run, 'a362131950d43961c'), alertKey('dirty', run, 'a362131950d43961b'), alertKey('tokens', run), alertKey('budget-run', run)]

    expect(new Set(keys.map(key => key.slice(0, 40))).size).toBe(5)
    expect(Math.max(...keys.map(key => key.length))).toBeLessThanOrEqual(30)
    expect(alertKey('stuck', run, 'a362131950d43961b')).toBe(keys[0])
  })
})

describe('trackProgress and newAlerts', () => {
  it('keeps a mark while the agent shows the same figures, restarts it when they move, and forgets agents that stopped running', () => {
    const first = trackProgress(new Map(), [live()], T0)
    const same = trackProgress(first, [live()], T0 + 5000)
    const moved = trackProgress(first, [{ ...live(), phases: live().phases.map(phase => ({ ...phase, agents: phase.agents.map(agent => ({ ...agent, tokens: 9 })) })) }], T0 + 9000)

    expect(same.get('wf_g1/a1')?.sinceMs).toBe(T0)
    expect(moved.get('wf_g1/a1')?.sinceMs).toBe(T0 + 9000)
    expect(trackProgress(first, [live(false)], T0 + 9000).size).toBe(0)
  })

  it('raises a key once while it stays true, forgets it when it clears, and raises it again if it returns', () => {
    const alert = { key: 'k', level: 'warn' as const, text: 't', runId: 'r' }
    const one = newAlerts([alert], new Set())
    const again = newAlerts([alert], one.raised)
    const cleared = newAlerts([], again.raised)

    expect(one.fresh).toHaveLength(1)
    expect(again.fresh).toHaveLength(0)
    expect(newAlerts([alert], cleared.raised).fresh).toHaveLength(1)
  })
})

describe('review fixes: nothing read is n/a, never $0', () => {
  it('a run whose agents were not read has no figure, and a read zero-token agent is still $0', () => {
    const none = costRun(run('wf_c9'), new Map(), BOOK)

    expect(fmtCosted(none.total)).toBe('n/a')
    expect([...none.phases.values()].map(fmtCosted)).toEqual(['n/a', 'n/a'])
    expect(isUnread(none.total)).toBe(true)
    expect(fmtCosted(costOfUsage({ byModel: new Map([['claude-sonnet-5-5', zeroUsage()]]), isTail: false }, BOOK))).toBe('$0')
  })
})

describe('review fixes: the export cost is the Cost section figure, labelled', () => {
  it('carries a floor caveat when agents are unread and null when no token was priced', async () => {
    const { exportCostOf } = await import('../hooks/wf-wire')
    const { guards } = await import('../hooks/wf-cost-live')
    const r = run('wf_c7')

    guards.costs.clear()
    guards.costs.set('wf_c7', costRun(r, new Map([['wf_c7/a1', usageOf('claude-sonnet-5-5', { output: 1e6 })]]), BOOK))
    expect(exportCostOf(r)).toMatchObject({ usd: 10, source: expect.stringContaining('a floor: 1 of 3 agents') })
    guards.costs.set('wf_c7', costRun(r, new Map([['wf_c7/a1', usageOf('claude-mystery-9', { output: 1e6 })]]), BOOK))
    expect(exportCostOf(r)).toBeNull()
    guards.costs.clear()
  })
})
