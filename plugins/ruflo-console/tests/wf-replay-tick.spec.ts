/**
 * The replay's clock (ADR-469): a playing replay advances on the console's own timer (host.every), not only when something else redraws the
 * page; it stops when it ends, is paused, or the page is left; each tick is bounded work. A fake host and a fake clock; no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-replay-tick.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTimeline, newReplay, offsetOf, settle, stepNow, TICK_MAX_STEPS, type ReplayUi, type Timeline } from '../hooks/data/wf-replay'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { workflowsActions } from '../hooks/wf-actions'
import { resetSavedLive } from '../hooks/wf-saved-live'
import type { Actions, Ctx } from '../hooks/views/common'
import { resetCompare } from '../hooks/views/wf-compare'
import { resetExport } from '../hooks/views/wf-export'
import { resetFolds } from '../hooks/views/wf-fold'
import { replayOf, resetReplays, TICK_MS } from '../hooks/views/wf-replay'
import { workflowsPage } from '../hooks/views/wf-page'
import { BASE, runOf } from './fixtures/wf-runs'
import { T0 } from './fixtures/workflows'
import { click, kit } from './fixtures/wf-drill-world'

type Timer = { ms: number; fn: () => void; cancelled: boolean }

const run = runOf('wf_tick', BASE)
const START = 1_800_000_000_000

function world() {
  const timers: Timer[] = []
  const state = newState({})
  let drawn = 0

  state.view = 'workflows'
  state.cwd = '/work/proj'
  state.isInteractive = false
  state.wf.read = { runs: [run], root: '/x', capBytes: 1, skipped: 0, more: 0 }

  const host = { invalidate: () => void (drawn += 1), every: (ms: number, fn: () => void) => { const timer = { ms, fn, cancelled: false }; timers.push(timer); return { cancel: () => void (timer.cancelled = true) } } } as unknown as Host
  const act = { workflows: workflowsActions(state, host, { ask: () => undefined } as never), focus: () => undefined, view: () => undefined } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: T0 + 600_000, columns: 100, pictures: new Map(), act }

  return { state, timers, page: () => workflowsPage(ctx), drawn: () => drawn, live: () => timers.filter(t => !t.cancelled) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  resetFolds()
  resetReplays()
  resetCompare()
  resetExport()
  resetSavedLive()
})
afterEach(() => vi.useRealTimers())

describe('the play loop', () => {
  it('starts one timer on play and advances the replay on each tick with no other redraw', () => {
    const w = world()

    click(w.page(), 'wf-replay-fold')
    expect(w.timers).toHaveLength(0)
    click(w.page(), 'wf-rp-play')
    expect(w.live()).toHaveLength(1)
    expect(w.live()[0]?.ms).toBe(TICK_MS)
    expect(replayOf(run.id).step).toBe(0)

    vi.setSystemTime(START + 1000)
    w.live()[0]?.fn()
    // 16x: one second of wall clock is 16 s of the run: both starts and build:b's end at 5 s are behind it.
    expect(replayOf(run.id).step).toBe(3)
    expect(replayOf(run.id).playFromMs).not.toBeNull()
    expect(w.drawn()).toBeGreaterThan(1)

    // The page drawn again while playing does not start a second timer.
    w.page()
    w.page()
    expect(w.timers).toHaveLength(1)
  })

  it('plays to the end and then stops its timer, leaving the final board', () => {
    const w = world()

    click(w.page(), 'wf-replay-fold')
    click(w.page(), 'wf-rp-play')
    vi.setSystemTime(START + 30_000)
    w.live()[0]?.fn()
    expect(replayOf(run.id).step).toBe(6)
    expect(replayOf(run.id).playFromMs).toBeNull()
    expect(w.live()).toHaveLength(0)
    expect(w.state.timers.size).toBe(0)
  })

  it('stops on pause, and a replay started again gets a fresh timer', () => {
    const w = world()

    click(w.page(), 'wf-replay-fold')
    click(w.page(), 'wf-rp-play')
    vi.setSystemTime(START + 500)
    click(w.page(), 'wf-rp-play')
    expect(replayOf(run.id).playFromMs).toBeNull()
    w.live()[0]?.fn()
    expect(w.live()).toHaveLength(0)

    const held = replayOf(run.id).step

    vi.setSystemTime(START + 60_000)
    expect(replayOf(run.id).step).toBe(held)
    click(w.page(), 'wf-rp-play')
    expect(w.live()).toHaveLength(1)
  })

  it('stops when the page is left, and when the pane is hidden, without redrawing a closed page forward', () => {
    const w = world()

    click(w.page(), 'wf-replay-fold')
    click(w.page(), 'wf-rp-play')
    w.state.view = 'overview'
    vi.setSystemTime(START + 1000)
    w.live()[0]?.fn()
    expect(w.live()).toHaveLength(0)
    // The replay itself still says where its own clock puts it when the page comes back, and the draw then restarts the timer.
    w.state.view = 'workflows'
    w.page()
    expect(w.live()).toHaveLength(1)

    w.state.isInteractive = true
    w.state.pane.isOpen = true
    w.state.pane.isShown = false
    w.live()[0]?.fn()
    expect(w.live()).toHaveLength(0)
  })

  it('swallows a failing tick and ends it', () => {
    const w = world()
    const act = workflowsActions(w.state, { invalidate: () => undefined, every: (_ms: number, fn: () => void) => (fn(), { cancel: () => undefined }) } as unknown as Host, { ask: () => undefined } as never)

    w.state.view = 'workflows'
    expect(() => act.tick?.('boom', 10, () => { throw new Error('x') })).not.toThrow()
  })
})

describe('settle: bounded work per tick', () => {
  const longRun = (events: number, gapMs: number): Timeline => ({ events: Array.from({ length: events }, (_, i) => ({ atMs: 1000 + i * gapMs, agentId: `a${i}`, kind: 'start' as const, phase: 'p', label: `a${i}` })), t0: 1000, t1: 1000 + (events - 1) * gapMs, untimed: [], why: null })
  const playing = (speed: number): ReplayUi => ({ ...newReplay(), speed, playFromMs: 0, baseMs: 0 })

  it('carries at most TICK_MAX_STEPS events in one call, however far the clock ran', () => {
    const tl = longRun(5000, 10)
    const next = settle(playing(256), tl, 600_000)

    expect(next.step).toBe(TICK_MAX_STEPS)
    expect(next.playFromMs).toBe(600_000)
    expect(next.baseMs).toBe(offsetOf(tl, TICK_MAX_STEPS))
    expect(settle(next, tl, 600_001).step).toBeGreaterThan(TICK_MAX_STEPS)
  })

  it('re-bases at the tick, so ticks scan only the new events, and it never loses the time between two events', () => {
    const tl = longRun(10, 100_000)
    let ui = playing(16)

    // 100 s between events at 16x is 6.25 s of wall clock: ticks of 400 ms get there only if each keeps its partial progress.
    for (let now = 400; now <= 6600; now += 400) ui = settle(ui, tl, now)
    expect(ui.step).toBe(1 + 1)
    expect(stepNow(ui, tl, 6600)).toBe(2)
  })

  it('ends at the last event and leaves a paused replay alone', () => {
    const tl = longRun(3, 1000)

    expect(settle(playing(256), tl, 10_000)).toMatchObject({ step: 3, playFromMs: null })

    const paused = { ...newReplay(), step: 1 }

    expect(settle(paused, tl, 10_000)).toBe(paused)
  })

  it('stays consistent with the timeline the page builds from a run', () => {
    const tl = buildTimeline(run)

    expect(settle({ ...newReplay(), speed: 16, playFromMs: 0, baseMs: 0 }, tl, 1000).step).toBe(3)
  })
})
