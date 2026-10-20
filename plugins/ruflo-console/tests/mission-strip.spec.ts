/**
 * The Mission Control strip's words, pure: what the mission is doing in one line, the bar and the percentage. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-strip.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { barCells, percentOf, stripStatus, type StripInput } from '../hooks/mission-strip'

const base: StripInput = { done: 3, total: 15, paused: false, running: null, next: null }

describe('what the strip says is happening', () => {
  it('says which of the four things "nothing ready" used to mean', () => {
    expect(stripStatus({ ...base, total: 0, done: 0 })).toEqual({ text: 'no tasks yet: plan the goal first', tone: 'wait' })
    expect(stripStatus({ ...base, done: 15 })).toEqual({ text: '✔ every task is done', tone: 'done' })
    expect(stripStatus({ ...base, running: { id: 't4', title: 'Write tests' } })).toEqual({ text: '◐ running t4 Write tests', tone: 'live' })
    expect(stripStatus(base)).toEqual({ text: 'waiting: the next task needs one that is not done', tone: 'wait' })
  })

  it('names the next task with its stage when one can be handed out', () => {
    expect(stripStatus({ ...base, next: { id: 't1', stage: 'research', title: 'Research prior art' } })).toEqual({ text: '▶ next t1 [research] Research prior art', tone: 'ready' })
  })

  it('says paused before it says what is running or next, and done before paused', () => {
    expect(stripStatus({ ...base, paused: true, running: { id: 't4', title: 'x' }, next: { id: 't5', stage: 's', title: 'y' } }).tone).toBe('paused')
    expect(stripStatus({ ...base, done: 15, paused: true }).tone).toBe('done')
    expect(stripStatus({ ...base, total: 0, done: 0, paused: true }).tone).toBe('wait')
  })

  it('cuts a long task title to fit with an ellipsis, never past the width', () => {
    const long = stripStatus({ ...base, next: { id: 't1', stage: 'research', title: 'x'.repeat(200) } }, 48)

    expect(long.text.length).toBeLessThanOrEqual(48)
    expect(long.text.endsWith('…')).toBe(true)
  })
})

describe('the bar', () => {
  it('fills in proportion, always the same width, and none for no tasks or none done', () => {
    expect(barCells(0, 15)).toEqual({ filled: 0, empty: 10 })
    expect(barCells(0, 0)).toEqual({ filled: 0, empty: 10 })
    expect(barCells(15, 15)).toEqual({ filled: 10, empty: 0 })
    expect(barCells(3, 15)).toEqual({ filled: 2, empty: 8 })
    expect(barCells(7, 15, 20)).toEqual({ filled: 9, empty: 11 })
  })

  it('stays inside its width when the numbers are odd', () => {
    expect(barCells(20, 15)).toEqual({ filled: 10, empty: 0 })
    expect(barCells(-3, 15)).toEqual({ filled: 0, empty: 10 })
    expect(barCells(1, -1)).toEqual({ filled: 0, empty: 10 })
  })

  it('gives a percentage that is whole and between 0 and 100', () => {
    expect(percentOf(0, 15)).toBe(0)
    expect(percentOf(3, 15)).toBe(20)
    expect(percentOf(15, 15)).toBe(100)
    expect(percentOf(1, 0)).toBe(0)
    expect(percentOf(30, 15)).toBe(100)
  })
})
