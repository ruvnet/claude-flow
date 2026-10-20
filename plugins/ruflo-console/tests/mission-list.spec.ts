/**
 * The Missions list, pure: the order (attention first), the observation's age, one-line rows, and the window around the cursor.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-list.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { money, type Mission } from '../hooks/data/missions'
import { attentionCount, budgetShort, clampCursor, freshnessOf, hasLiveWork, listLayout, LIST_WINDOW, missionRank, missionRow, SPIN, sortMissions, spinAt, STALE_AFTER_MS, taskProgress } from '../hooks/mission-list'

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: 'm',
  objective: 'ship it',
  state: 'running',
  revision: 1,
  executionMode: 'session-bound',
  plan: { revision: 1, taskCount: 0, tasks: [] },
  budget: null,
  evidence: { count: 0, verified: 0 },
  executor: null,
  unresolvedOperations: 0,
  ...over,
})

describe('mission order', () => {
  it('ranks blocked and failed first, then the work in motion, then what waits, then what has finished', () => {
    expect(missionRank(mission({ state: 'blocked' }))).toBe(0)
    expect(missionRank(mission({ state: 'failed' }))).toBe(0)
    expect(missionRank(mission({ state: 'running' }))).toBe(1)
    expect(missionRank(mission({ state: 'queued' }))).toBe(2)
    expect(missionRank(mission({ state: 'paused' }))).toBe(2)
    expect(missionRank(mission({ state: 'completed' }))).toBe(3)
  })

  it('puts a failure above a newer running mission, newest first within a rank, and leaves the input alone', () => {
    const input = [
      mission({ id: 'old-run', state: 'running', updatedAtMs: 100 }),
      mission({ id: 'new-run', state: 'running', updatedAtMs: 300 }),
      mission({ id: 'old-fail', state: 'failed', updatedAtMs: 50 }),
      mission({ id: 'done', state: 'completed', updatedAtMs: 999 }),
    ]

    expect(sortMissions(input).map(entry => entry.id)).toEqual(['old-fail', 'new-run', 'old-run', 'done'])
    expect(input.map(entry => entry.id)).toEqual(['old-run', 'new-run', 'old-fail', 'done'])
  })

  it('counts the missions that need attention', () => {
    expect(attentionCount([mission({ state: 'blocked' }), mission({ state: 'failed' }), mission({ state: 'running' })])).toBe(2)
  })
})

describe('live indicators', () => {
  it('turns a spinner one frame every tenth of a second, so a running thing visibly moves', () => {
    expect(spinAt(0)).toBe(SPIN[0])
    expect(spinAt(100)).toBe(SPIN[1])
    expect(spinAt(1_000)).toBe(SPIN[0])
  })

  it('a running mission carries the spinner on its row; a finished one keeps its fixed glyph', () => {
    expect(missionRow(mission({ state: 'running' }), 200).startsWith(`${SPIN[2]} `)).toBe(true)
    expect(missionRow(mission({ state: 'completed' }), 200).startsWith('● ')).toBe(true)
  })

  it('there is live work while a mission, a task or a guidance run is moving, and none once all have stopped', () => {
    const task = (status: string) => ({ id: 't', title: 't', dependsOn: [], status })

    expect(hasLiveWork([mission({ state: 'running' })], false)).toBe(true)
    expect(hasLiveWork([mission({ plan: { revision: 1, taskCount: 1, tasks: [task('running')] } })], false)).toBe(true)
    expect(hasLiveWork([], true)).toBe(true)
    expect(hasLiveWork([mission({ state: 'completed' }), mission({ state: 'blocked' })], false)).toBe(false)
  })
})

describe('observation age', () => {
  const now = 1_000_000_000

  it('is undated without a time, fresh inside the threshold, and stale past it', () => {
    expect(freshnessOf(null, now)).toBe('undated')
    expect(freshnessOf(now - 1000, now)).toBe('fresh')
    expect(freshnessOf(now - STALE_AFTER_MS, now)).toBe('fresh')
    expect(freshnessOf(now - STALE_AFTER_MS - 1, now)).toBe('stale')
  })
})

describe('one-line row', () => {
  it('spells the state, the tasks done of the plan, the evidence and the budget in one line', () => {
    const line = missionRow(
      mission({
        state: 'running',
        plan: {
          revision: 1,
          taskCount: 4,
          tasks: [
            { id: 'a', title: 'a', dependsOn: [], status: 'recorded-done' },
            { id: 'b', title: 'b', dependsOn: [], status: 'running' },
            { id: 'c', title: 'c', dependsOn: [], status: 'pending' },
            { id: 'd', title: 'd', dependsOn: [], status: 'pending' },
          ],
        },
        evidence: { count: 3, verified: 2 },
        budget: { currency: 'USD', ceilingMinor: 1000, settledMinor: 250 },
      }),
    )

    expect(line).toContain('running')
    expect(line).toContain('tasks 1/4')
    expect(line).toContain('verified 2/3')
    expect(line).toContain(`${money(250, 'USD')} of ${money(1000, 'USD')}`)
    expect(line.includes('\n')).toBe(false)
  })

  it('marks a plan the record cut short with a plus, so the done count reads as a floor', () => {
    expect(taskProgress(mission({ plan: { revision: 1, taskCount: 9, tasks: [{ id: 'a', title: 'a', dependsOn: [], status: 'recorded-done' }] } }))).toBe('1+/9')
  })

  it('says when there is no budget or no ceiling', () => {
    expect(budgetShort(mission({ budget: null }))).toBe('no budget')
    expect(budgetShort(mission({ budget: { currency: 'USD', settledMinor: 5 } }))).toBe(`${money(5, 'USD')} settled`)
  })

  it('cuts a long objective to fit and names a missing one', () => {
    const long = missionRow(mission({ objective: 'x'.repeat(80) }), 0, 20)

    expect(long.startsWith(`${spinAt(0)} xxxxxxxxxxxxxxxxxxx… ·`)).toBe(true)
    expect(missionRow(mission({ objective: '' }))).toContain('(no objective)')
  })
})

describe('cursor and window', () => {
  it('keeps the cursor on the list', () => {
    expect(clampCursor(3, 0)).toBe(0)
    expect(clampCursor(-2, 5)).toBe(0)
    expect(clampCursor(9, 5)).toBe(4)
  })

  it('shows no rows for an empty list', () => {
    expect(listLayout([], 0)).toEqual({ rows: [], expanded: null, hidden: 0 })
  })

  it('draws one line per mission and expands only the cursor, so six missions take seven lines, not thirty', () => {
    const six = Array.from({ length: 6 }, (_, i) => mission({ id: `m${i}`, objective: `goal ${i}`, updatedAtMs: i }))
    const layout = listLayout(six, 0)

    expect(layout.rows).toHaveLength(6)
    expect(layout.hidden).toBe(0)
    expect(layout.expanded?.id).toBe('m5')
    expect(layout.rows.length + 1).toBeLessThan(six.length * 5)
  })

  it('keeps the cursor inside a window of the list and counts what is outside it', () => {
    const many = Array.from({ length: 25 }, (_, i) => mission({ id: `m${i}`, updatedAtMs: 100 - i }))
    const layout = listLayout(many, 20)

    expect(layout.rows).toHaveLength(LIST_WINDOW)
    expect(layout.rows.map(row => row.index)).toContain(20)
    expect(layout.hidden).toBe(25 - LIST_WINDOW)
    expect(layout.expanded?.id).toBe('m20')
  })

  it('starts the window at the top when the cursor is near it', () => {
    const many = Array.from({ length: 25 }, (_, i) => mission({ id: `m${i}`, updatedAtMs: 100 - i }))

    expect(listLayout(many, 0).rows[0]!.index).toBe(0)
    expect(listLayout(many, 99).rows[LIST_WINDOW - 1]!.index).toBe(24)
  })
})
