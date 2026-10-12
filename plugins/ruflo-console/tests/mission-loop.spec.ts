import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_LOOP } from '../hooks/goap'
import {
  armed,
  GATE_EVENT,
  intervalMs,
  isTick,
  LOOP_LIFETIME_MS,
  loopMarker,
  loopPrompt,
  normalizeInterval,
  parseLoop,
  rearmCommand,
  serializeLoop,
  span,
  startCommand,
  status,
  stop,
  stopRequest,
  tick,
  tickPlan,
  type LoopState,
  type TickInput,
} from '../hooks/mission-loop'
import type { MissionRecord } from '../hooks/mission-types'
import { loopRows } from '../hooks/views/mission-loop'
import type { Ctx } from '../hooks/views/common'

const MIN = 60_000
const HOUR = 3_600_000
const T0 = 1_000_000_000_000

const mission = (patch: Partial<MissionRecord> = {}): MissionRecord => ({
  id: 'm1',
  objective: 'Build the thing',
  profile: 'feature',
  rigor: 'standard',
  tasks: [
    { id: 't1', title: 'one', phase: 'S', agent: 'coder', requirement: 'r', dependsOn: [] },
    { id: 't2', title: 'two', phase: 'R', agent: 'coder', requirement: 'r', dependsOn: ['t1'] },
  ],
  acceptance: [],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: T0,
  ...patch,
})
const state = (patch: Partial<LoopState> = {}): LoopState => ({ missionId: 'm1', interval: '5m', startedAtMs: T0, expiresAtMs: T0 + LOOP_LIFETIME_MS, ticks: 0, lastTickMs: null, status: 'armed', ...patch })

describe('intervals and the start command', () => {
  it('reads <digits><unit> and nothing else', () => {
    expect(intervalMs('5m')).toBe(5 * MIN)
    expect(intervalMs('2h')).toBe(2 * HOUR)
    expect(intervalMs('1d')).toBe(24 * HOUR)
    for (const bad of ['5', 'm', '5 m', '5M', '-5m', '5m; rm', '', '1.5h', 5, null, undefined]) expect(intervalMs(bad)).toBeNull()
  })

  it('falls back to the default for a bad interval and clamps to 1m..1d', () => {
    expect(normalizeInterval('nope', '10m')).toBe('10m')
    expect(normalizeInterval('nope', 'also bad')).toBe(DEFAULT_LOOP.loopInterval)
    expect(normalizeInterval('30s')).toBe('1m')
    expect(normalizeInterval('0m')).toBe('1m')
    expect(normalizeInterval('1m')).toBe('1m')
    expect(normalizeInterval('9999d')).toBe('1d')
    expect(normalizeInterval('15m')).toBe('15m')
  })

  it('builds /loop <interval> <prompt> and never starts below a minute', () => {
    const prefs = { ...DEFAULT_LOOP, loopInterval: '10m' as const }
    const prompt = loopPrompt(mission(), prefs)

    expect(startCommand(mission(), prefs, '2m')).toBe(`/loop 2m ${prompt}`)
    expect(startCommand(mission(), prefs, '5s')).toBe(`/loop 1m ${prompt}`)
    expect(startCommand(mission(), prefs, 'whenever')).toBe(`/loop 10m ${prompt}`)
  })
})

describe('the recurring prompt', () => {
  it('opens with the marker and carries the ADR-441 per-tick checklist', () => {
    const prompt = loopPrompt(mission(), DEFAULT_LOOP)

    expect(loopMarker('m1')).toBe('[mission:m1 loop]')
    expect(prompt.startsWith('[mission:m1 loop] Mission m1: Build the thing.')).toBe(true)
    expect(prompt).toContain('check progress')
    expect(prompt).toContain('fix what failed')
    expect(prompt).toContain('run the gates')
    expect(prompt).toContain('then stop the loop and report')
    expect(prompt).not.toContain('\n')
  })

  it('names push and publish only when the settings allow them', () => {
    const closed = loopPrompt(mission(), DEFAULT_LOOP)
    const open = loopPrompt(mission(), { ...DEFAULT_LOOP, loopPush: true, loopPublish: true })

    expect(closed).toContain('do not push')
    expect(closed).toContain('do not publish, release or deploy')
    expect(open).toContain('may be pushed')
    expect(open).toContain('may be published')
    expect(open).not.toContain('do not push')
  })

  it('caps the text and strips control characters from the objective', () => {
    const prompt = loopPrompt(mission({ objective: `a\u001b[31mred\u0000\u0007 ${'x'.repeat(5000)}\nline` }), DEFAULT_LOOP)

    // The whole objective rides (ADR-481); only a ruflo objective's own 2,000-character bound applies.
    expect(prompt.length).toBeLessThanOrEqual(3000)
    expect(prompt).toContain('x'.repeat(1900))
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(prompt)).toBe(false)
    expect(prompt).not.toContain('[31m')
  })

  it('keeps a hostile mission id out of the marker', () => {
    expect(loopMarker('m1] [mission:other')).toBe('[mission:m1mission:other loop]')
    expect(loopMarker('a b\nc')).toBe('[mission:abc loop]')
  })
})

describe('recognising a tick', () => {
  it('is true for this mission’s marker, with or without a prefix', () => {
    expect(isTick(loopPrompt(mission(), DEFAULT_LOOP), 'm1')).toBe(true)
    expect(isTick(`  [mission:m1 loop] go`, 'm1')).toBe(true)
    expect(isTick(`<scheduled> [mission:m1 loop] go`, 'm1')).toBe(true)
  })

  it('is false for another mission’s marker, a prefix id, and plain text', () => {
    expect(isTick('[mission:m2 loop] go', 'm1')).toBe(false)
    expect(isTick('[mission:m10 loop] go', 'm1')).toBe(false)
    expect(isTick('[mission:m1 loop] go', 'm')).toBe(false)
    expect(isTick('please keep looping on m1', 'm1')).toBe(false)
    expect(isTick('[mission:m1] loop', 'm1')).toBe(false)
    expect(isTick('', 'm1')).toBe(false)
    expect(isTick('[mission:m1 loop]', '')).toBe(false)
  })

  it('is spoof-proof: another mission’s longer message that quotes this marker is not a tick', () => {
    const other = `${loopMarker('m2')} Mission m2: as seen in ${loopMarker('m1')} earlier, keep going`

    expect(isTick(other, 'm1')).toBe(false)
    expect(isTick(other, 'm2')).toBe(true)
    expect(isTick(`someone said ${loopMarker('m2')} then ${loopMarker('m1')}`, 'm1')).toBe(false)
  })

  it('ignores a marker pushed past the scanned prefix and non-string input', () => {
    expect(isTick(`${'x'.repeat(2500)}${loopMarker('m1')}`, 'm1')).toBe(false)
    expect(isTick(undefined as unknown as string, 'm1')).toBe(false)
  })
})

describe('arming, ticking and stopping', () => {
  it('arms a fresh 7-day loop', () => {
    const s = armed(null, mission(), '5m', T0)

    expect(s).toEqual({ missionId: 'm1', interval: '5m', startedAtMs: T0, expiresAtMs: T0 + LOOP_LIFETIME_MS, ticks: 0, lastTickMs: null, status: 'armed' })
    expect(LOOP_LIFETIME_MS).toBe(7 * 24 * 3600 * 1000)
  })

  it('arming an armed, unexpired loop of the same interval changes nothing; an expired or other loop starts fresh', () => {
    const live = tick(armed(null, mission(), '5m', T0), T0 + 5 * MIN)

    expect(armed(live, mission(), '5m', T0 + 6 * MIN)).toBe(live)
    expect(armed(live, mission(), '10m', T0 + 6 * MIN).ticks).toBe(0)
    expect(armed(live, mission({ id: 'm2' }), '5m', T0 + 6 * MIN).missionId).toBe('m2')
    expect(armed({ ...live, status: 'expired' }, mission(), '5m', T0 + 6 * MIN).startedAtMs).toBe(T0 + 6 * MIN)
    expect(armed(live, mission(), '5m', live.expiresAtMs).startedAtMs).toBe(live.expiresAtMs)
  })

  it('arms with a safe interval', () => {
    expect(armed(null, mission(), 'bad', T0).interval).toBe(DEFAULT_LOOP.loopInterval)
    expect(armed(null, mission(), '10s', T0).interval).toBe('1m')
  })

  it('counts a tick while armed and keeps the last tick time', () => {
    const one = tick(state(), T0 + 5 * MIN)
    const two = tick(one, T0 + 10 * MIN)

    expect(one).toMatchObject({ ticks: 1, lastTickMs: T0 + 5 * MIN, status: 'armed' })
    expect(two).toMatchObject({ ticks: 2, lastTickMs: T0 + 10 * MIN })
  })

  it('does not mutate its input', () => {
    const s = state()

    tick(s, T0 + MIN)
    stop(s)
    expect(s).toEqual(state())
  })

  it('a tick at or after expiry marks it expired and counts nothing', () => {
    const s = state({ ticks: 4, lastTickMs: T0 })

    expect(tick(s, s.expiresAtMs)).toMatchObject({ status: 'expired', ticks: 4, lastTickMs: T0 })
    expect(tick(s, s.expiresAtMs - 1).ticks).toBe(5)
  })

  it('ticks are not counted for a stopped, idle, expired or done loop', () => {
    for (const status of ['stopped', 'idle', 'expired', 'done'] as const) expect(tick(state({ status }), T0 + MIN)).toEqual(state({ status }))
  })

  it('stop moves idle and armed to stopped and leaves expired and done alone', () => {
    expect(stop(state()).status).toBe('stopped')
    expect(stop(state({ status: 'idle' })).status).toBe('stopped')
    expect(stop(state({ status: 'expired' })).status).toBe('expired')
    expect(stop(state({ status: 'done' })).status).toBe('done')
  })
})

describe('status', () => {
  it('reports an armed loop: next tick from start, then from the last tick', () => {
    const fresh = status(state(), T0 + MIN)

    expect(fresh).toMatchObject({ level: 'ok', nextTickMs: T0 + 5 * MIN, isOverdue: false, isExpiring: false })
    expect(fresh.text).toBe('armed · 0 ticks · next in 4m')
    expect(status(state({ ticks: 1, lastTickMs: T0 + 5 * MIN }), T0 + 6 * MIN).nextTickMs).toBe(T0 + 10 * MIN)
    expect(status(state({ ticks: 1 }), T0 + 5 * MIN).text).toContain('1 tick ·')
    expect(status(state(), T0 + 6 * MIN).text).toContain('due now')
  })

  it('is overdue only after three intervals without a tick, measured from the later of start and last tick', () => {
    expect(status(state(), T0 + 15 * MIN).isOverdue).toBe(false)
    expect(status(state(), T0 + 15 * MIN + 1).isOverdue).toBe(true)

    const late = status(state({ lastTickMs: T0 + 100 * MIN, ticks: 3 }), T0 + 114 * MIN)

    expect(late.isOverdue).toBe(false)
    expect(status(state({ lastTickMs: T0 + 100 * MIN, ticks: 3 }), T0 + 116 * MIN)).toMatchObject({ isOverdue: true, level: 'bad' })
    expect(status(state(), T0 + 20 * MIN).text).toContain('overdue')
  })

  it('warns inside the last 24 hours and not before', () => {
    const edge = T0 + LOOP_LIFETIME_MS - 24 * HOUR
    const s = state({ lastTickMs: edge - MIN, ticks: 5 })

    expect(status(s, edge - 1)).toMatchObject({ isExpiring: false, level: 'ok' })
    expect(status(s, edge)).toMatchObject({ isExpiring: true, level: 'warn', msToExpiry: 24 * HOUR })
  })

  it('is expired when now reaches expiresAtMs, and when the status says so', () => {
    const atEdge = status(state({ ticks: 9, lastTickMs: T0 }), T0 + LOOP_LIFETIME_MS)

    expect(atEdge).toMatchObject({ level: 'bad', msToExpiry: 0, nextTickMs: null, isOverdue: false, isExpiring: false })
    expect(atEdge.text).toContain('expired after 9 ticks')
    expect(status(state({ status: 'expired' }), T0 + MIN).level).toBe('bad')
    expect(status(state({ lastTickMs: T0 + LOOP_LIFETIME_MS - MIN }), T0 + LOOP_LIFETIME_MS - 1).level).not.toBe('bad')
  })

  it('reports stopped, done and idle without a next tick', () => {
    expect(status(state({ status: 'stopped', ticks: 2 }), T0 + MIN)).toMatchObject({ level: 'warn', nextTickMs: null, text: 'stopped after 2 ticks' })
    expect(status(state({ status: 'done' }), T0 + MIN)).toMatchObject({ level: 'ok', nextTickMs: null })
    expect(status(state({ status: 'idle' }), T0 + MIN)).toMatchObject({ level: 'ok', nextTickMs: null, text: 'not started' })
  })

  it('is total: bad input is a safe idle status', () => {
    const idle = { text: 'no loop', level: 'ok', nextTickMs: null, msToExpiry: 0, isOverdue: false, isExpiring: false }

    expect(status(null, T0)).toEqual(idle)
    expect(status(state(), Number.NaN)).toEqual(idle)
    expect(status(state({ interval: 'x' }), T0)).toEqual(idle)
    expect(status({ ...state(), startedAtMs: Number.NaN }, T0)).toEqual(idle)
    expect(status({ ...state(), expiresAtMs: 'soon' as unknown as number }, T0)).toEqual(idle)
    expect(status('nope' as unknown as LoopState, T0)).toEqual(idle)
  })

  it('formats spans', () => {
    expect([span(-5), span(45_000), span(4 * MIN), span(3 * HOUR + 10 * MIN), span(2 * 24 * HOUR + 4 * HOUR)]).toEqual(['0s', '45s', '4m', '3h 10m', '2d 4h'])
  })
})

describe('stop request and re-arm', () => {
  it('says plainly that Claude owns the schedule and names the marker and the tools', () => {
    const text = stopRequest(state({ ticks: 7 }), mission())

    expect(text).toContain('only you own the schedule')
    expect(text).toContain('CronList')
    expect(text).toContain('CronDelete')
    expect(text).toContain('[mission:m1 loop]')
    expect(text).toContain('7 ticks')
    expect(stopRequest(null, mission())).not.toContain('ticks so far')
  })

  it('re-arms only a stopped, expired or overdue loop, with the same prompt and interval', () => {
    const prefs = DEFAULT_LOOP
    const expected = startCommand(mission(), prefs, '15m')

    expect(rearmCommand(state({ interval: '15m', status: 'stopped' }), mission(), prefs)).toBe(expected)
    expect(rearmCommand(state({ interval: '15m', status: 'expired' }), mission(), prefs)).toBe(expected)
    expect(rearmCommand(state({ interval: '15m' }), mission(), prefs)).toBeNull()
    expect(rearmCommand(state({ interval: '15m' }), mission(), prefs, T0 + 10 * MIN)).toBeNull()
    expect(rearmCommand(state({ interval: '15m' }), mission(), prefs, T0 + 46 * MIN)).toBe(expected)
    expect(rearmCommand(state({ interval: '15m' }), mission(), prefs, T0 + LOOP_LIFETIME_MS + 1)).toBe(expected)
    expect(rearmCommand(state({ status: 'done' }), mission(), prefs, T0 + LOOP_LIFETIME_MS + 1)).toBeNull()
    expect(rearmCommand(state({ status: 'idle' }), mission(), prefs)).toBeNull()
    expect(rearmCommand(null, mission(), prefs)).toBeNull()
    expect(rearmCommand(state({ status: 'expired' }), mission({ id: 'other' }), prefs)).toBeNull()
  })
})

describe('serialize and parse', () => {
  it('round-trips through JSON', () => {
    const s = state({ ticks: 12, lastTickMs: T0 + 50 * MIN, interval: '10m', status: 'stopped' })

    expect(parseLoop(JSON.parse(JSON.stringify(serializeLoop(s))))).toEqual(s)
    expect(parseLoop(serializeLoop(state()))).toEqual(state())
  })

  it('drops anything off: not an object, missing or wrong fields, a bad status, interval or id', () => {
    const good = serializeLoop(state()) as Record<string, unknown>
    const bad: unknown[] = [null, undefined, 5, 'x', [], [good], {}, true]

    for (const patch of [
      { missionId: '' },
      { missionId: 'm 1' },
      { missionId: 7 },
      { missionId: 'x'.repeat(200) },
      { interval: '5' },
      { interval: '30s' },
      { interval: '9999d' },
      { interval: 5 },
      { startedAtMs: -1 },
      { startedAtMs: Number.NaN },
      { startedAtMs: '1' },
      { expiresAtMs: T0 - 1 },
      { expiresAtMs: Number.POSITIVE_INFINITY },
      { ticks: -1 },
      { ticks: 1.5 },
      { ticks: 1e9 },
      { ticks: '3' },
      { lastTickMs: 'x' },
      { lastTickMs: -5 },
      { lastTickMs: undefined },
      { status: 'running' },
      { status: 7 },
    ]) bad.push({ ...good, ...patch })

    for (const value of bad) expect(parseLoop(value), JSON.stringify(value)).toBeNull()
  })

  it('does not trust extra fields and does not return the stored object', () => {
    const stored = { ...(serializeLoop(state()) as object), evil: 'x', __proto__: { polluted: 1 } }
    const parsed = parseLoop(stored) as LoopState

    expect(parsed).toEqual(state())
    expect(Object.keys(parsed)).not.toContain('evil')
    expect(parsed).not.toBe(stored)
  })
})

describe('tick plan', () => {
  const base = (patch: Partial<TickInput> = {}): TickInput => ({ mission: mission(), loop: state({ lastTickMs: T0, ticks: 1 }), prefs: DEFAULT_LOOP, gatesConfigured: false, spendUsd: null, capUsd: null, nowMs: T0 + 5 * MIN, ...patch })
  const ev = (seq: number, type: string, taskId?: string, status?: string) => ({ seq, atMs: T0, type, ...(taskId !== undefined && { taskId }), ...(status !== undefined && { status }) })
  const done = (...ids: string[]) => ids.map((id, i) => ev(i + 1, 'task.completed', id, 'completed'))

  it('runs the next task when nothing blocks', () => {
    expect(tickPlan(base())).toEqual({ action: 'run-next', reason: 'hand over the next ready task' })
  })

  it('stops for a cancelled mission, a finished one and a reached spend cap', () => {
    expect(tickPlan(base({ mission: mission({ cancelled: true }) })).action).toBe('stop')
    expect(tickPlan(base({ mission: mission({ events: done('t1', 't2') }) }))).toMatchObject({ action: 'stop', reason: expect.stringContaining('every task is done') })
    expect(tickPlan(base({ spendUsd: 5, capUsd: 5 }))).toMatchObject({ action: 'stop', reason: expect.stringContaining('cap') })
    expect(tickPlan(base({ spendUsd: 7.5, capUsd: 5 })).action).toBe('stop')
    expect(tickPlan(base({ spendUsd: 4.99, capUsd: 5 })).action).toBe('run-next')
  })

  it('has no cap without a cap, a spend figure or a positive cap', () => {
    expect(tickPlan(base({ spendUsd: 100, capUsd: null })).action).toBe('run-next')
    expect(tickPlan(base({ spendUsd: null, capUsd: 5 })).action).toBe('run-next')
    expect(tickPlan(base({ spendUsd: 100, capUsd: 0 })).action).toBe('run-next')
  })

  it('stop beats wait: a cancelled paused mission stops', () => {
    expect(tickPlan(base({ mission: mission({ cancelled: true, paused: true }) })).action).toBe('stop')
  })

  it('a loop that was stopped or is done tells Claude to cancel its task', () => {
    expect(tickPlan(base({ loop: state({ status: 'stopped' }) }))).toMatchObject({ action: 'stop', reason: expect.stringContaining('cancel') })
    expect(tickPlan(base({ loop: state({ status: 'done' }) })).action).toBe('stop')
  })

  it('waits while paused, while a task runs, and until the interval has passed', () => {
    expect(tickPlan(base({ mission: mission({ paused: true }) })).action).toBe('wait')
    expect(tickPlan(base({ mission: mission({ events: [ev(1, 'task.dispatched', 't1', 'in_progress')] }) }))).toMatchObject({ action: 'wait', reason: 'a task is still running' })
    expect(tickPlan(base({ nowMs: T0 + 2 * MIN })).action).toBe('wait')
    expect(tickPlan(base({ nowMs: T0 + 4.5 * MIN })).action).toBe('run-next')
    expect(tickPlan(base({ loop: state(), nowMs: T0 + MIN })).action).toBe('run-next')
  })

  it('prefers the task store status over the ledger events', () => {
    const taskStatus = new Map([['t1', 'running' as const], ['t2', 'waiting' as const]])

    expect(tickPlan(base({ taskStatus }))).toMatchObject({ action: 'wait', reason: 'a task is still running' })
    expect(tickPlan(base({ taskStatus: new Map([['t1', 'done' as const], ['t2', 'done' as const]]) })).action).toBe('stop')
  })

  it('rearms an expired loop (by status or by the clock) but not a paused mission', () => {
    expect(tickPlan(base({ loop: state({ status: 'expired' }) })).action).toBe('rearm')
    expect(tickPlan(base({ nowMs: T0 + LOOP_LIFETIME_MS })).action).toBe('rearm')
    expect(tickPlan(base({ loop: state({ status: 'expired' }), mission: mission({ paused: true }) })).action).toBe('wait')
  })

  it('runs the gates after a finished task when gates are configured, once', () => {
    const finished = mission({ events: done('t1') })

    expect(tickPlan(base({ mission: finished, gatesConfigured: true }))).toMatchObject({ action: 'run-gates' })
    expect(tickPlan(base({ mission: finished, gatesConfigured: false })).action).toBe('run-next')
    expect(tickPlan(base({ mission: mission({ events: [...done('t1'), ev(9, GATE_EVENT)] }), gatesConfigured: true })).action).toBe('run-next')
    expect(tickPlan(base({ mission: mission(), gatesConfigured: true })).action).toBe('run-next')
  })

  it('a failed task does not count as running or done', () => {
    const failed = mission({ events: [ev(1, 'task.failed', 't1', 'failed')] })

    expect(tickPlan(base({ mission: failed })).action).toBe('run-next')
  })

  it('a mission with no tasks never reads as finished', () => {
    expect(tickPlan(base({ mission: mission({ tasks: [] }) })).action).toBe('run-next')
  })
})

describe('loop rows', () => {
  type El = { kind: string; props: Record<string, unknown> }
  const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) }
  const ctx = { kit, state: { view: 'missions', sections: new Set<string>() }, nowMs: T0, columns: 100, pictures: new Map(), act: {} } as unknown as Ctx
  const flat = (value: unknown): El[] => (Array.isArray(value) ? value.flatMap(flat) : value !== null && typeof value === 'object' && 'kind' in value ? [value as El, ...flat((value as El).props.children)] : [])
  const make = (loop: LoopState | null, nowMs = T0 + MIN) => {
    const actions = { start: vi.fn(), stop: vi.fn(), rearm: vi.fn() }
    const els = flat(loopRows(ctx, loop, actions, nowMs))

    return { actions, els, texts: els.filter(e => e.kind === 'Text').map(e => String(e.props.children)), buttons: els.filter(e => e.kind === 'Button') }
  }

  it('with no loop shows only Start, and the ownership note', () => {
    const { texts, buttons, actions } = make(null)

    expect(buttons.map(b => b.props.label)).toEqual(['Start loop'])
    expect(texts.join('\n')).toContain('no loop')
    expect(texts.some(t => t.includes('Claude owns the schedule'))).toBe(true)
    ;(buttons[0]?.props.onPress as () => void)()
    expect(actions.start).toHaveBeenCalledTimes(1)
    expect(actions.stop).not.toHaveBeenCalled()
  })

  it('an armed loop shows its facts and only Stop', () => {
    const { texts, buttons, actions } = make(state({ ticks: 3, lastTickMs: T0 }))

    expect(texts.join('\n')).toContain('armed · 3 ticks')
    expect(texts.join('\n')).toContain('time to expiry')
    expect(buttons.map(b => b.props.label)).toEqual(['Stop loop'])
    ;(buttons[0]?.props.onPress as () => void)()
    expect(actions.stop).toHaveBeenCalledTimes(1)
  })

  it('warns in the last 24 hours', () => {
    const s = state({ ticks: 3, lastTickMs: T0 + LOOP_LIFETIME_MS - 2 * HOUR })
    const { texts, els } = make(s, T0 + LOOP_LIFETIME_MS - HOUR)

    expect(texts.some(t => t.includes('Expires within 24 hours'))).toBe(true)
    expect(els.some(e => e.kind === 'Text' && String(e.props.children).includes('Expires within') && e.props.color !== undefined)).toBe(true)
    expect(make(state({ lastTickMs: T0 }), T0 + MIN).texts.some(t => t.includes('Expires within'))).toBe(false)
  })

  it('shows Re-arm for an expired, stopped or overdue loop; Stop only while it may still be running', () => {
    for (const [loop, at, labels] of [
      [state({ status: 'expired' }), T0 + MIN, ['Re-arm loop']],
      [state({ status: 'stopped' }), T0 + MIN, ['Re-arm loop']],
      [state(), T0 + 20 * MIN, ['Stop loop', 'Re-arm loop']],
      [state(), T0 + LOOP_LIFETIME_MS + 1, ['Re-arm loop']],
    ] as const) {
      const { buttons, actions } = make(loop, at)

      expect(buttons.map(b => b.props.label)).toEqual(labels)
      ;(buttons.at(-1)?.props.onPress as () => void)()
      expect(actions.rearm).toHaveBeenCalledTimes(1)
    }
  })

  it('a done loop has no buttons; disclaimer lines stay under 50 characters', () => {
    expect(make(state({ status: 'done' })).buttons).toEqual([])

    const dim = make(null).els.filter(e => e.kind === 'Text' && e.props.dimColor === true).map(e => String(e.props.children)).filter(t => t.includes('Claude owns') || t.includes('prepares'))

    expect(dim.length).toBeGreaterThan(0)
    for (const line of dim) expect(line.length).toBeLessThan(50)
  })
})
