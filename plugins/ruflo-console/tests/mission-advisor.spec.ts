/**
 * Advisor checkpoints (ADR-483), the pure half: failure counting, the tick plan, the consult text and command, the settings round trip.
 * The live half (the consult through the confirm card, the cap, the checkpoints, the Loop tab) is mission-advisor-live.spec.ts. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-advisor.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { Host } from '../hooks/host'
import { MISSION_OBJECTIVE_MAX } from '../hooks/full-text'
import { advisorPrompt, advisorSummary, consultArgv, CONSULT_AT, doneDue, escalationOf, EVENT_OFFERED, modelLabel, STOP_AT, streamsOf } from '../hooks/mission-advisor'
import { record } from '../hooks/mission-control'
import { loopPrompt } from '../hooks/mission-loop'
import { DEFAULT_AI, loadAiPrefs, saveAiPrefs, settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'
import { fail, GATE, ID, mission, pass, plan } from './fixtures/advisor-rig'

describe('counting repeated failures from the ledger', () => {
  it('needs two failures of the same check in a row on the same task', () => {
    const m = mission()

    expect(escalationOf(m).state).toBe('ok')
    fail(m)
    expect(escalationOf(m)).toMatchObject({ state: 'ok', count: 0 })
    fail(m)
    expect(escalationOf(m)).toMatchObject({ state: 'consult', count: CONSULT_AT })
  })

  it('does not mix different checks or different tasks', () => {
    const m = mission()

    fail(m, 'g1')
    fail(m, 'g2')
    fail(m, 'g1', 't2')
    expect(escalationOf(m).state).toBe('ok')
    expect(streamsOf(m)).toHaveLength(3)
  })

  it('a pass between two failures resets the run, and a retry (a new hand-out) does not', () => {
    const m = mission()

    fail(m)
    pass(m)
    fail(m)
    expect(escalationOf(m).state).toBe('ok')
    record(m, { type: 'task.dispatched', taskId: 't1' })
    fail(m)
    expect(escalationOf(m).state).toBe('consult')
  })

  it('an unknown exit is neither a failure nor a pass', () => {
    const m = mission()

    fail(m)
    record(m, { type: 'evidence.gate', taskId: 't1', status: 'unknown', evidenceRef: `gate:${GATE}:none`, note: 'no exit code' })
    fail(m)
    expect(escalationOf(m).count).toBe(2)
  })

  it('counts failed task events as their own check', () => {
    const m = mission()

    record(m, { type: 'task.result', taskId: 't1', status: 'failed' })
    record(m, { type: 'task.result', taskId: 't1', status: 'failed' })
    expect(escalationOf(m)).toMatchObject({ state: 'consult' })
    expect(escalationOf(m).stream?.key).toBe('task')
  })

  it('an offer after the second failure makes it consulted, and a third failure stops the line whatever was offered', () => {
    const m = mission()

    fail(m)
    fail(m)

    const ref = escalationOf(m).ref

    record(m, { type: EVENT_OFFERED, evidenceRef: ref })
    expect(escalationOf(m).state).toBe('consulted')
    fail(m)
    expect(escalationOf(m)).toMatchObject({ state: 'stop', count: STOP_AT })
  })

  it('an offer made before the second failure does not count for it', () => {
    const m = mission()

    fail(m)
    fail(m)

    const ref = escalationOf(m).ref

    pass(m)
    fail(m)
    fail(m)
    expect(escalationOf(m).ref).toBe(ref)
    expect(escalationOf(m).state).toBe('consult')
  })

  it('pre-done is due once every task is done, and not after an offer or when cancelled', () => {
    const m = mission()
    const done = new Map([['t1', 'done'], ['t2', 'done']] as const)

    expect(doneDue(m, new Map([['t1', 'done'], ['t2', 'ready']] as const))).toBe(false)
    expect(doneDue(m, done)).toBe(true)
    expect(doneDue({ ...m, cancelled: true }, done)).toBe(false)
    record(m, { type: EVENT_OFFERED, evidenceRef: `done:${ID}` })
    expect(doneDue(m, done)).toBe(false)
  })

  it('sums what the consults reported, with the models, and ignores nonsense costs', () => {
    const m = mission()

    record(m, { type: 'advisor.answered', model: 'opus', costUsd: 0.25 })
    record(m, { type: 'advisor.answered', model: 'opus', costUsd: -3 })
    record(m, { type: 'advisor.answered', model: 'haiku', costUsd: Number.NaN })
    expect(advisorSummary(m)).toEqual({ consults: 3, costUsd: 0.25, models: ['opus', 'haiku'] })
  })
})

describe('the tick plan', () => {
  it('is exactly what it was with the setting off or absent, whatever the ledger holds', () => {
    const m = mission()

    fail(m)
    fail(m)
    fail(m)

    const before = plan(m)

    expect(plan(m, { advisor: false })).toEqual(before)
    expect(before.action).toBe('run-next')
  })

  it('asks for a consult at the second failure, once an offer is recorded the tick moves on', () => {
    const m = mission()

    fail(m)
    fail(m)
    expect(plan(m, { advisor: true })).toMatchObject({ action: 'consult-advisor' })
    record(m, { type: EVENT_OFFERED, evidenceRef: escalationOf(m).ref })
    expect(plan(m, { advisor: true }).action).toBe('run-next')
  })

  it('stops the line at the third failure, and the spend cap and a running task still come first', () => {
    const m = mission()

    for (let i = 0; i < 3; i++) fail(m)
    expect(plan(m, { advisor: true })).toMatchObject({ action: 'stop', reason: expect.stringContaining('stop the line') })
    expect(plan(m, { advisor: true, spendUsd: 9, capUsd: 5 }).reason).toContain('cap')

    const m2 = mission()

    fail(m2)
    fail(m2)
    expect(plan(m2, { advisor: true, taskStatus: new Map([['t1', 'running'], ['t2', 'waiting']]) }).action).toBe('wait')
    expect(plan({ ...m2, paused: true }, { advisor: true }).action).toBe('wait')
  })

  it('consults before the loop stops when every task is done, once', () => {
    const m = mission()
    const done = new Map([['t1', 'done'], ['t2', 'done']] as const)

    expect(plan(m, { advisor: true, taskStatus: done }).action).toBe('consult-advisor')
    expect(plan(m, { taskStatus: done }).action).toBe('stop')
    record(m, { type: EVENT_OFFERED, evidenceRef: `done:${ID}` })
    expect(plan(m, { advisor: true, taskStatus: done }).action).toBe('stop')
  })
})

describe('the consult text and command', () => {
  const ai = { ...DEFAULT_AI, advisor: true }

  it('is plan mode (read-only) under the turn budget, names a model only when one is set', () => {
    expect(consultArgv({ ...ai, advisorModel: 'default' })).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', '1'])

    const argv = consultArgv({ ...ai, advisorModel: 'opus', budgetUsd: 0.5 })

    expect(argv.slice(-2)).toEqual(['--model', 'opus'])
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('plan')
    expect(argv[argv.indexOf('--max-budget-usd') + 1]).toBe('0.5')
  })

  it('never says a model the setting does not name', () => {
    expect(modelLabel({ advisorModel: 'default' })).toBe('the claude CLI default')
    expect(modelLabel({ advisorModel: 'sonnet' })).toBe('sonnet')
  })

  it('carries the whole objective, the failing check and the data fence, and washes control characters', () => {
    const m = mission()

    m.objective = `${'x'.repeat(MISSION_OBJECTIVE_MAX - 10)}\u001b[31m END`
    fail(m)
    fail(m)

    const text = advisorPrompt('stuck', { mission: m, statuses: new Map(), gates: ['npm test'], adrBlock: 'ADR-9 accepted: use sessions', escalation: escalationOf(m) })

    expect(text).toContain('x'.repeat(MISSION_OBJECTIVE_MAX - 10))
    expect(text).toContain('END')
    expect(text).not.toContain('\u001b')
    expect(text).toContain('untrusted project data')
    expect(text).toContain('2 times in a row')
    expect(text).toContain('npm test')
    expect(text).toContain('ADR-9 accepted')
    expect(text).toContain('Do not recommend another blind retry')
  })

  it('asks a different question at each checkpoint', () => {
    const base = { mission: mission(), statuses: new Map<string, never>(), gates: [], adrBlock: '' }

    expect(advisorPrompt('plan', base)).toContain('plan is about to lock')
    expect(advisorPrompt('done', { ...base, changed: ['a.ts'], scopeLines: ['warning: a.ts under ADR-9'] })).toContain('hidden regressions')
    expect(advisorPrompt('done', { ...base, changed: ['a.ts'], scopeLines: ['warning: a.ts under ADR-9'] })).toContain('a.ts')
  })

  it('adds the subagent line to the loop prompt only when asked', () => {
    expect(loopPrompt(mission(), DEFAULT_AI)).not.toContain('Subagents')
    expect(loopPrompt(mission(), { ...DEFAULT_AI, subagentSummaries: true })).toContain('structured summary')
  })
})

describe('the settings', () => {
  it('are off by default and survive a save and a load', async () => {
    expect(DEFAULT_AI).toMatchObject({ advisor: false, advisorModel: 'default', subagentSummaries: false })

    const stored = new Map<string, unknown>()
    const host = { storeGet: async (key: string) => stored.get(key), storeSet: async (key: string, value: unknown) => void stored.set(key, value), invalidate: () => undefined } as unknown as Host
    const state = newState({})

    saveAiPrefs(state, host, { advisor: true, advisorModel: 'opus', subagentSummaries: true })
    await Promise.resolve()

    const again = newState({})

    await loadAiPrefs(again, host)
    expect(settingsOf(again).ai).toMatchObject({ advisor: true, advisorModel: 'opus', subagentSummaries: true })

    stored.set('ai-prefs', { advisor: 'yes', advisorModel: 'gpt-9', subagentSummaries: 1 })
    await loadAiPrefs(again, host)
    expect(settingsOf(again).ai).toMatchObject({ advisor: false, advisorModel: 'default', subagentSummaries: false })
  })
})
