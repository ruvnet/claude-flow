import { describe, expect, it } from 'vitest'

import { CONTEXT_MAX, CONTEXT_PREF_KEY, CONTEXT_ROW, CONTEXT_SECTION_ID, contextEnabled, missionContextKey, missionContextText, turnNote } from '../hooks/mission-context'
import type { LedgerTask, MissionRecord } from '../hooks/mission-types'

const task: LedgerTask = { id: 't3', title: 'Write the parser', phase: 'refinement', agent: 'coder', requirement: 'parser passes its tests', dependsOn: [] }
const mission = (patch: Partial<MissionRecord> = {}): MissionRecord => ({
  id: 'msn_abc',
  objective: 'Ship the parser',
  profile: 'feature',
  rigor: 'standard',
  tasks: [task],
  acceptance: [{ id: 'a1', check: 'tests pass' }, { id: 'a2', check: 'no lint errors' }],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: 1,
  ...patch,
})
const loop = { interval: '5m', status: 'armed' }

describe('missionContextText', () => {
  it('names the section id and carries objective, task, checks and both rules', () => {
    const text = missionContextText(mission(), task, loop, 'running')

    expect(CONTEXT_SECTION_ID).toBe('ruflo-console:mission')
    expect(text).toContain('Ship the parser')
    expect(text).toContain('Active task t3 (running): Write the parser')
    expect(text).toContain('parser passes its tests')
    expect(text).toContain('- tests pass')
    expect(text).toContain('a task is done only with evidence: record it with task_complete and put what you ran and what it printed in the result'.replace(/^a/, 'A'))
    expect(text).toContain('Stop when every task is done')
    expect(text).toContain('Loop: 5m, armed.')
    expect(text).not.toContain('Do not start new work')
  })

  it('is deterministic', () => {
    expect(missionContextText(mission(), task, loop)).toBe(missionContextText(mission(), task, loop))
  })

  it('says not to start new work when paused or cancelled', () => {
    expect(missionContextText(mission({ paused: true }), task, null)).toContain('The mission is paused. Do not start new work.')
    expect(missionContextText(mission({ cancelled: true }), task, null)).toContain('The mission is cancelled. Do not start new work.')
  })

  it('omits the task and loop lines when there is none', () => {
    const text = missionContextText(mission(), null, null)

    expect(text).not.toContain('Active task')
    expect(text).not.toContain('Loop:')
    expect(text).toContain('Ship the parser')
  })

  it('strips control characters and ANSI from every field', () => {
    const dirty = mission({ objective: 'a\u001b[31mred\u001b[0m\u0007 goal\nline', acceptance: [{ id: 'x', check: 'ok\u0000check' }] })
    const text = missionContextText(dirty, { ...task, title: 'ti\u009ftle' }, { interval: '5m\u0001', status: 'armed' })

    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    expect(text).toContain('ared goal line')
  })

  it('stays within the cap and keeps both rules at maximum field sizes', () => {
    const big = 'x'.repeat(5000)
    const huge = mission({ id: big, objective: big, paused: true, acceptance: Array.from({ length: 20 }, (_, index) => ({ id: `a${index}`, check: big })) })
    const text = missionContextText(huge, { ...task, id: big, title: big, requirement: big }, { interval: big, status: big })

    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX)
    expect(text).toContain('task_complete')
    expect(text).toContain('Stop when every task is done')
    expect(text).toContain('Do not start new work')
  })
})

describe('missionContextKey', () => {
  const base = missionContextKey(mission(), task, loop, 'ready')

  it('does not change with events, timestamps, spend-like fields, objective text or acceptance', () => {
    const noisy = mission({ events: [{ seq: 1, atMs: 5, type: 'x' }, { seq: 2, atMs: 9, type: 'y', note: 'cost $4' }], createdAtMs: 999, auto: true, objective: 'reworded', acceptance: [] })

    expect(missionContextKey(noisy, task, loop, 'ready')).toBe(base)
    expect(missionContextKey(noisy, task, { interval: '30m', status: 'overdue' }, 'ready')).toBe(base)
  })

  it('changes with mission id, active task id, its status, paused, cancelled and loop on/off', () => {
    const keys = [
      missionContextKey(mission({ id: 'msn_other' }), task, loop, 'ready'),
      missionContextKey(mission(), { ...task, id: 't4' }, loop, 'ready'),
      missionContextKey(mission(), task, loop, 'running'),
      missionContextKey(mission({ paused: true }), task, loop, 'ready'),
      missionContextKey(mission({ cancelled: true }), task, loop, 'ready'),
      missionContextKey(mission(), task, null, 'ready'),
      missionContextKey(mission(), null, loop),
    ]

    expect(new Set([base, ...keys]).size).toBe(keys.length + 1)
  })
})

describe('settings row', () => {
  it('is on by default and only the exact off value turns it off', () => {
    expect(contextEnabled(undefined)).toBe(true)
    expect(contextEnabled('on')).toBe(true)
    expect(contextEnabled('OFF')).toBe(true)
    expect(contextEnabled(0)).toBe(true)
    expect(contextEnabled(null)).toBe(true)
    expect(contextEnabled('off')).toBe(false)
    expect(contextEnabled(false)).toBe(false)
  })

  it('has the LOOP_ROWS shape and round-trips through patch/current', () => {
    expect(CONTEXT_ROW.id).toBe('ctx-mission')
    expect(CONTEXT_ROW.title).toBe('Mission context in Claude’s prompt')
    expect(CONTEXT_ROW.options).toEqual(['on', 'off'])
    expect(CONTEXT_ROW.current({})).toBe('on')
    expect(CONTEXT_ROW.isChanged({})).toBe(false)

    const off = CONTEXT_ROW.patch('off')

    expect(off).toEqual({ [CONTEXT_PREF_KEY]: false })
    expect(CONTEXT_ROW.current(off)).toBe('off')
    expect(CONTEXT_ROW.isChanged(off)).toBe(true)
    expect(CONTEXT_ROW.patch('on')).toEqual({ [CONTEXT_PREF_KEY]: true })
    expect(CONTEXT_ROW.patch('garbage')).toEqual({ [CONTEXT_PREF_KEY]: true })
  })
})

describe('turnNote', () => {
  it('is null with no active task', () => {
    expect(turnNote('answer', null)).toBeNull()
  })

  it('names the task and never claims it finished, for every reason', () => {
    for (const reason of ['answer', 'aborted', 'refusal', 'error'] as const) {
      const note = turnNote(reason, task)

      expect(note?.taskId).toBe('t3')
      expect(note?.type).toBe('turn')
      expect(note?.note.length).toBeGreaterThan(10)
      expect(note?.note).not.toMatch(/\b(completed|is done|was finished|succeeded)\b/i)
    }
  })

  it('tells the reasons apart', () => {
    const notes = (['answer', 'aborted', 'refusal', 'error'] as const).map(reason => turnNote(reason, task)?.note)

    expect(new Set(notes).size).toBe(4)
  })
})
