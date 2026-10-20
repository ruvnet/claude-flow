/**
 * Alert rules and the derived sources (ADR-474): a rule fires only on NEW events, a bad rule never fires, the first read of every
 * source is a baseline, and each source says what happened between two reads.
 */
import { describe, expect, it } from 'vitest'

import { evaluateRules } from '../hooks/data/event-rules'
import { anatoleEvents, apEvents, denyEvents, modEvents, newMemo, noticeEvents, runEvents } from '../hooks/data/event-sources'
import type { ConsoleEvent } from '../hooks/data/events'
import type { WfRun } from '../hooks/data/workflows'

const T = Date.UTC(2026, 9, 7, 12)
const ev = (text: string, kind: ConsoleEvent['kind'] = 'swarm'): ConsoleEvent => ({ kind, text, atMs: T })

describe('evaluateRules', () => {
  const rules = [{ name: 'bad swarm', q: 'kind:swarm level:bad' }, { name: 'broken', q: 'kind:' }, { name: 'empty', q: '' }, { name: 'rx', q: '/step s\\d/' }]

  it('fires per matching rule over the new events only, with the count and the newest', () => {
    const hits = evaluateRules(rules, [ev('agent a failed'), ev('agent b failed'), ev('topology mesh'), ev('step s2 ran')], T)

    expect(hits.map(hit => [hit.rule, hit.count])).toEqual([['bad swarm', 2], ['rx', 1]])
    expect(hits[0]?.newest.text).toBe('agent b failed')
    expect(hits[0]?.level).toBe('bad')
  })

  it('nothing new, nothing fired; a rule with errors or no terms never fires', () => {
    expect(evaluateRules(rules, [], T)).toEqual([])
    expect(evaluateRules([{ name: 'x', q: 'since:soon' }], [ev('failed')], T)).toEqual([])
  })
})

const run = (id: string, state: WfRun['state'], extra: Partial<WfRun> = {}): WfRun => ({ id, name: id, kind: 'workflow', state, phases: [], running: 0, done: 0, failed: 0, idle: 0, total: 2, totalTokens: null, isTokensPartial: false, hasRecord: true, ...extra })

describe('derived sources', () => {
  it('workflow runs: the first read is a baseline, then started, failed, stuck, empty and finished are events with a run ref', () => {
    const memo = newMemo()

    expect(runEvents(memo, [run('a', 'running')], T)).toEqual([])

    const out = runEvents(memo, [run('a', 'failed', { failed: 1 }), run('b', 'running'), run('c', 'stalled')], T + 1)

    expect(out.map(e => e.text)).toEqual(['run a failed (1 of 2 agents)', 'run b started', 'run c seen stalled'])
    expect(out.every(e => e.kind === 'workflows' && e.ref?.startsWith('run:'))).toBe(true)
    expect(runEvents(memo, [run('a', 'failed'), run('b', 'completed', { done: 2 }), run('c', 'stalled')], T + 2).map(e => e.text)).toEqual(['run b finished: 2 of 2 agents done'])
    expect(runEvents(memo, [run('b', 'completed', { total: 0 }), run('a', 'failed'), run('c', 'stalled')], T + 3).map(e => e.text)).toEqual(['run b finished empty: no agents'])
    expect(runEvents(memo, [run('a', 'failed'), run('b', 'completed', { total: 0 }), run('c', 'stalled')], T + 4)).toEqual([])
  })

  it('autopilot: start, a step handed over, done, failed, parked, stop and the kill flag', () => {
    const memo = newMemo()
    const base = { phase: 'idle', steps: [], killed: false, parked: [], reason: null }
    const step = (status: 'started' | 'done' | 'failed', extra = {}) => ({ id: 's1', task: 't1', cls: 'c', attempt: 1, startedAt: 1, deadline: 2, status, tier: 'low', ...extra })

    expect(apEvents(memo, base, T)).toEqual([])
    expect(apEvents(memo, { ...base, phase: 'running' }, T).map(e => e.text)).toEqual(['autopilot started'])
    expect(apEvents(memo, { ...base, phase: 'running', steps: [step('started')] }, T).map(e => e.text)).toEqual(['step s1 handed over: t1'])
    expect(apEvents(memo, { ...base, phase: 'running', steps: [step('done', { verified: true })] }, T).map(e => e.text)).toEqual(['step s1 done (verified)'])
    expect(apEvents(memo, { ...base, phase: 'running', steps: [step('failed', { why: 'tests red' })], parked: [{ id: 'p1', question: 'which?' }], killed: true }, T).map(e => e.text)).toEqual(['step s1 failed: tests red', 'step p1 parked: which?', 'kill flag set: the autopilot is blocked'])
    expect(apEvents(memo, { ...base, phase: 'stopped', reason: 'you', steps: [step('failed', { why: 'tests red' })], parked: [{ id: 'p1', question: 'which?' }], killed: true }, T).map(e => e.text)).toEqual(['autopilot stopped: you'])
  })

  it('anatole alerts, band notices, denies and mods: baseline first, then only what is new; a rule notice is not an event', () => {
    const memo = newMemo()
    const alert = (id: string) => ({ id, atMs: T, rule: 'r1', owasp: [], severity: 'high' as const, action: 'blocked' as const, tool: 'Bash', summary: 's', fp: null, state: 'open' as const })

    expect(anatoleEvents(memo, [alert('a1')], T)).toEqual([])
    expect(anatoleEvents(memo, [alert('a1'), alert('a2')], T).map(e => [e.kind, e.text, e.ref])).toEqual([['anatole', 'Anatole blocked Bash: rule r1 (high)', 'rule:r1']])

    expect(noticeEvents(memo, [], 5)).toEqual([])
    expect(noticeEvents(memo, [{ id: 6, level: 'warn', text: '2 new approvals waiting', key: 'approvals', atMs: T }, { id: 7, level: 'warn', text: 'rule hit', key: 'events-rule:x', atMs: T }], 7).map(e => e.text)).toEqual(['band: 2 new approvals waiting'])

    expect(denyEvents(memo, [])).toEqual([])
    expect(denyEvents(memo, [{ tool: 'Bash', reason: 'policy', atMs: T }]).map(e => e.text)).toEqual(['permission denied: Bash (policy)'])
    expect(denyEvents(memo, [{ tool: 'Bash', reason: 'policy', atMs: T }])).toEqual([])

    expect(modEvents(memo, [{ name: 'm1', isLoaded: true }], T)).toEqual([])
    expect(modEvents(memo, [{ name: 'm1', isLoaded: false, reason: 'untrusted' }, { name: 'm2', isLoaded: true }], T).map(e => e.text)).toEqual(['mod m1 refused: untrusted', 'mod m2 loaded'])
  })
})
