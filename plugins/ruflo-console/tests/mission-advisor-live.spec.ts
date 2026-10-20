/**
 * Advisor checkpoints (ADR-483), the live half on a fake host: the consult through the runner's confirm card (plan, repeated failure,
 * stop-the-line, pre-done), the spend cap, the setting off meaning no change, and what the Loop tab says about the model. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-advisor-live.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { advisorSummary, escalationOf, EVENT_OFFERED } from '../hooks/mission-advisor'
import { answerOf, checkpoint, checkpointDone, checkpointPlan, consultSpec, offerConsult, whyNot } from '../hooks/mission-advisor-live'
import { onPromptSubmit, onTurnComplete } from '../hooks/mission-claude'
import { mcOf, record, setPaused } from '../hooks/mission-control'
import { loopMarker } from '../hooks/mission-loop'
import { settingsOf } from '../hooks/settings'
import { viewText } from '../hooks/views/pane'
import { allDone, fail, ID, on, rig, runGates, settle, task } from './fixtures/advisor-rig'

describe('a failing gate twice in a row', () => {
  it('offers exactly one consult card, with the exact command and the model, and starts nothing until confirmed', async () => {
    const r = rig()

    on(r, 'opus')
    await runGates(r)
    expect(r.asked).toHaveLength(1)
    await runGates(r)

    const consults = r.asked.filter(spec => spec.label.startsWith('advisor consult'))

    expect(consults).toHaveLength(1)
    expect(consults[0]?.label).toContain('model: opus')
    expect(consults[0]?.label).toContain('read-only')
    expect(consults[0]?.shows).toContain('--permission-mode plan')
    expect(consults[0]?.shows).toContain('--model opus')
    expect(r.log.spawns).toHaveLength(0)
    expect(r.m().events.filter(event => event.type === EVENT_OFFERED)).toHaveLength(1)
  })

  it('a third run does not offer again, it stops the line: the mission is paused and a toast says so', async () => {
    const r = rig()

    on(r)
    await runGates(r)
    await runGates(r)
    await runGates(r)

    expect(r.asked.filter(spec => spec.label.startsWith('advisor consult'))).toHaveLength(1)
    expect(r.m().paused).toBe(true)
    expect(r.m().events.some(event => event.type === 'advisor.stop')).toBe(true)
    expect(r.log.toasts.some(text => text.includes('stop the line'))).toBe(true)

    // the stop is said once, not on every look
    expect(checkpoint(r.state, r.host, r.m())).toBeNull()
    expect(r.m().events.filter(event => event.type === 'advisor.stop')).toHaveLength(1)
  })

  it('resuming gives the failing check a fresh run: two more failures consult again', async () => {
    const r = rig()

    on(r)
    await runGates(r)
    await runGates(r)
    await runGates(r)
    setPaused(r.state, r.host, false)
    expect(r.m().events.some(event => event.type === 'advisor.resumed')).toBe(true)
    expect(escalationOf(r.m()).state).toBe('ok')
    await runGates(r)
    expect(escalationOf(r.m()).state).toBe('ok')
    await runGates(r)
    expect(r.asked.filter(spec => spec.label.startsWith('advisor consult'))).toHaveLength(2)
  })

  it('runs read-only on confirm, records the model and the cost, and hands the answer to the session as quoted data', async () => {
    const r = rig()

    on(r, 'haiku')
    await runGates(r)
    await runGates(r)

    const spec = r.asked.find(item => item.label.startsWith('advisor consult')) as ActionSpec

    await spec.run?.()
    await settle()

    expect(r.log.spawns).toHaveLength(1)
    expect(r.log.spawns[0]?.argv).toEqual([...(spec.args as string[])])
    expect(r.log.spawns[0]?.argv).toContain('plan')
    expect(r.log.spawns[0]?.input).toContain('Do not recommend another blind retry')
    expect(r.m().events.find(event => event.type === 'advisor.consulted')).toMatchObject({ model: 'haiku' })
    expect(r.m().events.find(event => event.type === 'advisor.answered')).toMatchObject({ model: 'haiku', costUsd: 0.1234, status: 'done' })
    expect(advisorSummary(r.m())).toMatchObject({ consults: 1, costUsd: 0.1234 })
    expect(answerOf(r.state, ID)?.status).toBe('done')

    const sent = [...r.log.submits, ...r.log.fills][0] ?? ''

    expect(sent).toContain('not an instruction')
    expect(sent.split('\n').slice(1).every(line => line.startsWith('│ '))).toBe(true)
    expect(r.log.toasts.some(text => text.includes('answered'))).toBe(true)
  })

  it('with the setting off nothing is offered, recorded or paused, however often it fails', async () => {
    const r = rig()

    for (let i = 0; i < 5; i++) await runGates(r)

    expect(r.asked.filter(spec => spec.label.startsWith('advisor'))).toHaveLength(0)
    expect(r.m().paused).toBe(false)
    expect(r.m().events.some(event => event.type.startsWith('advisor.'))).toBe(false)
    expect(checkpoint(r.state, r.host, r.m())).toBeNull()
    expect(whyNot(r.state, r.m())).toContain('off')
  })
})

describe('the spend cap', () => {
  const reading = (r: ReturnType<typeof rig>, usd: number) => r.state.probes.set('mission-cost', { value: { usd, credits: null, unpriced: [], rows: 1, fromMs: r.m().createdAtMs }, okAtMs: Date.now(), error: null, errorAtMs: null, isRunning: false })

  it('refuses a consult at the cap, before the card and again if the cap is hit while the card is open', async () => {
    const r = rig()

    on(r)
    settingsOf(r.state).ai.missionCapUsd = '5'
    reading(r, 4)
    expect(offerConsult(r.state, r.host, r.runner, r.m(), 'plan')).toBeNull()
    reading(r, 6)
    expect(offerConsult(r.state, r.host, r.runner, r.m(), 'done')).toContain('cap')

    const spec = consultSpec(r.state, r.host, r.m(), 'plan')

    await spec.run?.()
    expect(r.log.spawns).toHaveLength(0)
    expect(r.m().events.at(-1)).toMatchObject({ type: 'advisor.refused' })
  })

  it('holds the consult while a cap is set and there is no fresh spend reading', () => {
    const r = rig()

    on(r)
    settingsOf(r.state).ai.missionCapUsd = '5'
    expect(whyNot(r.state, r.m())).toContain('fresh')
  })

  it('a cancelled mission gets none', () => {
    const r = rig()

    on(r)
    r.m().cancelled = true
    expect(whyNot(r.state, r.m())).toContain('cancelled')
  })
})

describe('the other checkpoints', () => {
  it('offers the plan consult when the mission is created, once per call and not at all when off', () => {
    const r = rig()

    checkpointPlan(r.state, r.host, r.m())
    expect(r.asked).toHaveLength(0)
    on(r)
    checkpointPlan(r.state, r.host, r.m())
    expect(r.asked.map(spec => spec.label)).toEqual([expect.stringContaining('review the plan before it locks')])
  })

  it('offers the pre-done consult once, after the turn that finished the last task', () => {
    const r = rig()

    on(r)
    onTurnComplete(r.state, r.host, 'answer')
    expect(r.asked).toHaveLength(0)
    r.state.snapshot = { ...(r.state.snapshot as object), tasks: allDone } as never
    onTurnComplete(r.state, r.host, 'answer')
    onTurnComplete(r.state, r.host, 'answer')
    expect(r.asked.map(spec => spec.label)).toEqual([expect.stringContaining('check before declaring done')])
    checkpointDone(r.state, r.host)
    expect(r.asked).toHaveLength(1)
  })

  it('a loop tick that finds the repeated failure offers the consult once and starts no turn', () => {
    const r = rig()

    on(r)
    r.state.snapshot = { ...(r.state.snapshot as object), tasks: [task('r1', 'pending'), task('r2', 'pending')] } as never
    fail(r.m())
    fail(r.m())
    onPromptSubmit(r.state, r.host, `${loopMarker(ID)} tick`)
    onPromptSubmit(r.state, r.host, `${loopMarker(ID)} tick`)
    expect(r.asked.filter(spec => spec.label.startsWith('advisor consult'))).toHaveLength(1)
    expect(r.log.spawns).toHaveLength(0)
    expect(r.m().events.find(event => event.type === 'loop.tick')?.note).toContain('consult-advisor')
  })

  it('the Loop tab button asks first, and says why when it cannot', () => {
    const r = rig()

    r.actions.advisor('plan')
    expect(r.asked).toHaveLength(0)
    expect(mcOf(r.state).last).toMatchObject({ label: 'advisor', ok: false })
    on(r)
    r.actions.advisor('stuck')
    expect(r.asked).toHaveLength(1)
    expect(r.asked[0]?.label).toContain('root-cause')
  })
})

describe('what the Loop tab says', () => {
  const tab = (r: ReturnType<typeof rig>) => {
    mcOf(r.state).tab = 'loop'

    return viewText({ state: r.state, nowMs: 5_000, columns: 100, act: { mission: r.actions } as never }, 'missions')
  }

  it('draws nothing with the setting off', () => {
    expect(tab(rig())).not.toContain('Advisor')
  })

  it('names the configured model, the in-session advisor caveat, and splits the cost', () => {
    const r = rig()

    on(r, 'default')
    record(r.m(), { type: 'advisor.answered', model: 'sonnet', costUsd: 0.5 })

    const rows = tab(r)

    expect(rows).toContain('the claude CLI default')
    expect(rows).not.toMatch(/opus/i)
    expect(rows).toContain('in-session advisor')
    expect(rows).toContain('$0.500 as claude reported it')
    expect(rows).toContain('Review plan')
  })
})


describe('always accept, Claude driving, and the offer toast', () => {
  it('under always accept the second failure runs the consult at once, with no card, and still records the offer', async () => {
    const r = rig()

    on(r)
    settingsOf(r.state).ai.autoAccept = true
    await runGates(r)
    await runGates(r)
    await settle()
    expect(r.asked.filter(spec => spec.label.startsWith('advisor consult'))).toHaveLength(0)
    expect(r.log.spawns).toHaveLength(1)
    expect(r.log.spawns[0]?.argv).toContain('plan')
    expect(r.m().events.filter(event => event.type === EVENT_OFFERED)).toHaveLength(1)
    // the cap still holds under always accept
    r.m().cancelled = true
    expect(offerConsult(r.state, r.host, r.runner, r.m(), 'plan')).toContain('cancelled')
    expect(r.log.spawns).toHaveLength(1)
  })

  it('an automatic offer is skipped while Claude drives the console, the person’s button is not', () => {
    const r = rig()

    on(r)
    r.state.control.drivingUntilMs = Date.now() + 60_000
    expect(offerConsult(r.state, r.host, r.runner, r.m(), 'plan')).toContain('driving')
    expect(r.asked).toHaveLength(0)
    expect(r.m().events.some(event => event.type === EVENT_OFFERED)).toBe(false)
    r.actions.advisor('plan')
    expect(r.asked).toHaveLength(1)
  })

  it('an automatic offer says so in a toast, the 30 second window included; the button does not repeat it', async () => {
    const r = rig()

    on(r)
    await runGates(r)
    await runGates(r)
    expect(r.log.toasts.some(text => text.includes('offered') && text.includes('30 s'))).toBe(true)

    const before = r.log.toasts.length

    r.actions.advisor('plan')
    expect(r.log.toasts).toHaveLength(before)
  })

  it('does not offer while another action waits for the person’s answer', () => {
    const r = rig()

    on(r)
    r.state.pending = { label: 'x', askedAtMs: Date.now() } as never
    expect(offerConsult(r.state, r.host, r.runner, r.m(), 'plan')).toContain('waiting')
    expect(r.m().events.some(event => event.type === EVENT_OFFERED)).toBe(false)
  })
})
