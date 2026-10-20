/**
 * A resume does not silently re-arm hand-outs that ran out (#3818, #3823). After MAX_HANDOUTS failed hand-outs auto-run pauses the mission and
 * waits for the person. `mission-resume` is a write action, so at write:auto Claude can resume it without a Yes: that resume keeps each task's
 * hand-out count, so an exhausted task is not handed out again (no new billed turn). The person's own resume (their click, their palette run)
 * is the one that gives every task its hand-outs back. Real controller, runner, palette, advance() and callTool over a fake host.
 */
import { describe, expect, it } from 'vitest'

import { activeMission, advance, mcOf } from '../hooks/mission-control'
import { EVENT_RESUMED, EVENT_STOP, stoppedByAdvisor } from '../hooks/mission-advisor'
import { MAX_HANDOUTS, setPaused } from '../hooks/mission-specs'
import type { MissionRecord } from '../hooks/mission-types'
import { callTool } from '../hooks/model-tools'
import { settingsOf } from '../hooks/settings'
import { rig } from './fixtures/real-rig'

const ID = 'msn_0123456789abcdef01234567'
const ok = { exitCode: 0, stdout: 'Result:\n{"success": true}', stderr: '' }
const mission = (): MissionRecord => ({ id: ID, objective: 'ship it', profile: 'feature', rigor: 'standard', tasks: [{ id: 't1', title: 'one', phase: 'S', agent: 'coder', requirement: 'r', dependsOn: [], rufloTaskId: 'r1' }], acceptance: [], events: [], paused: false, cancelled: false, auto: true, createdAtMs: 1 })
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

/** A mission whose only task came back unfinished MAX_HANDOUTS times, so auto-run paused it with `handout.limit`. */
async function exhausted() {
  const w = rig({ run: () => ok })

  Object.assign(settingsOf(w.state).ai, { modelControl: 'write', modelConfirm: 'auto' })
  w.state.cwd = '/work'
  mcOf(w.state).missions.set(ID, mission())
  mcOf(w.state).active = ID
  w.state.snapshot = { tasks: [{ id: 'r1', type: 'feature', description: '', status: 'pending', assignedTo: [], tags: [] }], plugins: { installed: [] } } as never
  w.control.setView('missions')

  for (let i = 0; i < 8; i++) {
    advance(w.state, w.host)
    await settle()
    w.fireTimers()
  }

  const m = activeMission(w.state) as MissionRecord

  expect(m.paused).toBe(true)
  expect(m.events.map(event => event.type)).toContain('handout.limit')
  expect(w.seen.prompts).toHaveLength(MAX_HANDOUTS)

  return { ...w, m }
}

describe('a resume does not re-arm exhausted hand-outs behind the person (#3823)', () => {
  it('Claude resuming at write:auto keeps the count, and auto-run hands out no new billed turn for the exhausted task', async () => {
    const w = await exhausted()
    const answer = await callTool('console_run', { id: 'mission-resume', text: '' }, w.deps)

    expect(answer).not.toMatch(/^Refused/)
    expect(w.m.tasks[0]?.handouts).toBe(MAX_HANDOUTS)

    for (let i = 0; i < 4; i++) {
      advance(w.state, w.host)
      await settle()
      w.fireTimers()
    }

    expect(w.seen.prompts).toHaveLength(MAX_HANDOUTS)
    expect(w.m.paused).toBe(true)
    expect(w.m.events.filter(event => event.type === 'mission.resumed').at(-1)?.note).toMatch(/Claude/)
  })

  it('Claude resuming again and again buys no hand-outs either', async () => {
    const w = await exhausted()

    for (let round = 0; round < 3; round++) {
      await callTool('console_run', { id: 'mission-resume', text: '' }, w.deps)
      advance(w.state, w.host)
      await settle()
      w.fireTimers()
    }

    expect(w.seen.prompts).toHaveLength(MAX_HANDOUTS)
  })

  it('the person resuming (the Missions button) gives each task its hand-outs back, and auto-run carries on', async () => {
    const w = await exhausted()

    w.control.actions.mission.resume()
    expect(w.m.tasks[0]?.handouts).toBe(0)
    expect(w.m.paused).toBe(false)
    advance(w.state, w.host)
    await settle()
    expect(w.seen.prompts).toHaveLength(MAX_HANDOUTS + 1)
  })

  it('the person running mission-resume from the palette is the person too', async () => {
    const w = await exhausted()

    expect(w.control.runner.runById('mission-resume', '', { exact: true })).toBe(true)
    await w.control.runner.settled()
    expect(w.m.tasks[0]?.handouts).toBe(0)
    expect(w.m.paused).toBe(false)
  })

  it('after an advisor stop-the-line, Claude\'s resume opens no fresh run of tries; the person\'s does (ADR-483)', () => {
    const w = rig()
    const m = { ...mission(), paused: true, events: [{ seq: 1, atMs: 1, type: EVENT_STOP, status: 'paused', taskId: 't1' }] }

    mcOf(w.state).missions.set(ID, m)
    mcOf(w.state).active = ID
    setPaused(w.state, w.host as never, false, 'model')
    expect(m.events.map(event => event.type)).not.toContain(EVENT_RESUMED)
    expect(stoppedByAdvisor(m)).toBe(true)
    setPaused(w.state, w.host as never, false, 'person')
    expect(stoppedByAdvisor(m)).toBe(false)
  })
})
