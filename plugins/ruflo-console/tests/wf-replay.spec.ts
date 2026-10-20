/**
 * Replay of a finished run (ADR-461): the timeline from the agents' own start and end moments, the board re-derived at every step,
 * and the cursor (step, jump, phase, play, speed). Pure and fast. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-replay.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { boardAt, buildTimeline, describeStep, isPlaying, jumpReplay, newReplay, offsetOf, phaseSteps, SPEEDS, stepNow, stepReplay } from '../hooks/data/wf-replay'
import { swarmRun } from '../hooks/data/wf-swarm'
import { BASE, runOf } from './fixtures/wf-runs'

const run = runOf('wf_a', BASE)
const tl = buildTimeline(run)
const NOW = 5_000_000

describe('timeline', () => {
  it('orders start and end moments, an end before a start at the same instant', () => {
    expect(tl.why).toBeNull()
    expect(tl.events.map(e => `${e.kind}:${e.label}`)).toEqual(['start:build:a', 'start:build:b', 'end:build:b', 'end:build:a', 'start:review:a', 'end:review:a'])
    expect(tl.t1 - tl.t0).toBe(90_000)
  })

  it('leaves out an agent with no start time, or a finished one with no span, and counts it', () => {
    const whole = runOf('wf_odd', [...BASE, { id: 'x1', label: 'nostart', phase: 'Build' }, { id: 'x2', label: 'nospan', phase: 'Build', at: 3 }])
    // buildRun always derives a span for an agent that has a start; a hand-made agent without one is the case being tested.
    const odd = { ...whole, phases: whole.phases.map(p => ({ ...p, agents: p.agents.map(a => (a.id === 'x2' ? { ...a, elapsedMs: undefined } : a)) })) }
    const t = buildTimeline(odd)

    expect(t.untimed.sort()).toEqual(['x1', 'x2'])
    expect(t.events).toHaveLength(6)
    expect(boardAt(odd, t, 6).total).toBe(3)
  })

  it('says why there is nothing to replay: the swarm, an empty run, a run with no times', () => {
    const swarm = swarmRun(null, [{ id: 'a1', type: 'coder', status: 'busy' } as never], NOW)

    expect(buildTimeline(swarm as never).why).toMatch(/swarm/)
    expect(buildTimeline(runOf('wf_e', [])).why).toMatch(/no agents/)
    expect(buildTimeline(runOf('wf_n', [{ id: 'n1', label: 'n', phase: 'Build' }])).why).toMatch(/no order to replay/)
  })
})

describe('the board at a step', () => {
  it('starts with every agent queued and no tokens', () => {
    const b = boardAt(run, tl, 0)

    expect(b.phases.flatMap(p => p.agents).every(a => a.state === 'queued' && a.tokens === undefined)).toBe(true)
    expect(b.running).toBe(0)
    expect(b.totalTokens).toBeNull()
    expect(b.state).toBe('running')
  })

  it('shows a running agent with time measured to the step and tokens n/a, then its final figures once it ends', () => {
    const mid = boardAt(run, tl, 2)
    const a = mid.phases[0]?.agents.find(x => x.label === 'build:a')

    expect(mid.running).toBe(2)
    expect(a).toMatchObject({ state: 'running', elapsedMs: 0 })
    expect(a?.tokens).toBeUndefined()

    const after = boardAt(run, tl, 3)

    expect(after.failed).toBe(1)
    expect(after.totalTokens).toBe(1200)
    expect(after.phases[0]?.agents.find(x => x.label === 'build:b')).toMatchObject({ state: 'failed', tokens: 1200 })
    expect(boardAt(run, tl, 5).phases[1]?.agents[0]).toMatchObject({ state: 'running', elapsedMs: 0 })
    expect(boardAt(run, tl, 5).phases[0]?.agents.find(x => x.label === 'build:a')).toMatchObject({ state: 'done', tokens: 180_000 })
  })

  it('ends on the real board: same states, counts, totals and state', () => {
    const last = boardAt(run, tl, tl.events.length)

    expect(last.phases.map(p => p.agents.map(a => [a.id, a.state]))).toEqual(run.phases.map(p => p.agents.map(a => [a.id, a.state])))
    expect(last).toMatchObject({ done: run.done, failed: run.failed, running: 0, total: run.total, totalTokens: run.totalTokens, state: run.state, durationMs: run.durationMs })
  })

  it('is the same board whichever way the cursor arrived (forward, back, jump)', () => {
    const direct = JSON.stringify(boardAt(run, tl, 3))
    let ui = newReplay()

    for (const c of ['last', 'first', 'next', 'next', 'next', 'next', 'prev'] as const) ui = stepReplay(ui, tl, c, NOW)

    expect(stepNow(ui, tl, NOW)).toBe(3)
    expect(JSON.stringify(boardAt(run, tl, stepNow(ui, tl, NOW)))).toBe(direct)
    expect(JSON.stringify(boardAt(run, tl, 3))).toBe(direct)
  })

  it('clamps a step outside the run', () => {
    expect(boardAt(run, tl, -4).done).toBe(0)
    expect(boardAt(run, tl, 99).done).toBe(run.done)
  })
})

describe('the cursor', () => {
  it('steps, clamps at both ends and describes where it is', () => {
    let ui = stepReplay(newReplay(), tl, 'prev', NOW)

    expect(stepNow(ui, tl, NOW)).toBe(0)
    expect(describeStep(tl, 0)).toMatch(/before the first/)
    ui = stepReplay(ui, tl, 'next', NOW)
    expect(describeStep(tl, 1)).toBe('build:a started (Build)')
    for (let i = 0; i < 20; i += 1) ui = stepReplay(ui, tl, 'next', NOW)
    expect(stepNow(ui, tl, NOW)).toBe(6)
    expect(describeStep(tl, 6)).toBe('review:a ended (Review)')
  })

  it('jumps by phase: the step where the next phase first starts, back to the start', () => {
    expect(phaseSteps(tl)).toEqual([1, 5])
    let ui = stepReplay(newReplay(), tl, 'next-phase', NOW)

    expect(stepNow(ui, tl, NOW)).toBe(1)
    ui = stepReplay(ui, tl, 'next-phase', NOW)
    expect(stepNow(ui, tl, NOW)).toBe(5)
    ui = stepReplay(ui, tl, 'next-phase', NOW)
    expect(stepNow(ui, tl, NOW)).toBe(6)
    ui = stepReplay(stepReplay(ui, tl, 'prev-phase', NOW), tl, 'prev-phase', NOW)
    expect(stepNow(ui, tl, NOW)).toBe(1)
    expect(stepNow(stepReplay(ui, tl, 'prev-phase', NOW), tl, NOW)).toBe(0)
  })

  it('jumps along the run by fraction, landing on the last step at or before it', () => {
    expect(stepNow(jumpReplay(newReplay(), tl, 0), tl, NOW)).toBe(2) // both start at +0
    expect(stepNow(jumpReplay(newReplay(), tl, 0.5), tl, NOW)).toBe(3) // +5s is before +45s; +60s is after
    expect(stepNow(jumpReplay(newReplay(), tl, 1), tl, NOW)).toBe(6)
    expect(stepNow(jumpReplay(newReplay(), tl, Number.NaN), tl, NOW)).toBe(2)
  })

  it('plays on the wall clock at its speed and stops at the end', () => {
    const base = { ...newReplay(), speed: 4 }
    const playing = stepReplay(base, tl, 'play', NOW)

    expect(playing.playFromMs).toBe(NOW)
    // the two agents that start at +0 have started the moment the clock does
    expect(stepNow(playing, tl, NOW)).toBe(2)
    // 2s of wall clock at 4x is 8s of run time: past the +5s end of build:b (steps 1..3)
    expect(stepNow(playing, tl, NOW + 2000)).toBe(3)
    expect(isPlaying(playing, tl, NOW + 2000)).toBe(true)
    // 30s at 4x is 120s: everything has happened
    expect(stepNow(playing, tl, NOW + 30_000)).toBe(6)
    expect(isPlaying(playing, tl, NOW + 30_000)).toBe(false)
  })

  it('pauses where it is, and play at the end starts again from the top', () => {
    const playing = stepReplay({ ...newReplay(), speed: 4 }, tl, 'play', NOW)
    const paused = stepReplay(playing, tl, 'play', NOW + 2000)

    expect(paused.playFromMs).toBeNull()
    expect(stepNow(paused, tl, NOW + 99_000)).toBe(3)

    const end = stepReplay(newReplay(), tl, 'last', NOW)
    const again = stepReplay(end, tl, 'play', NOW)

    expect(stepNow(again, tl, NOW)).toBe(2) // from the top: the +0 starts are at once
    expect(again.step).toBe(0)
    expect(again.playFromMs).toBe(NOW)
  })

  it('a manual step while playing pauses it', () => {
    const playing = stepReplay(newReplay(), tl, 'play', NOW)

    expect(stepReplay(playing, tl, 'next', NOW + 1).playFromMs).toBeNull()
  })

  it('changes speed within the offered speeds only, and keeps its place while playing', () => {
    let ui = newReplay()

    for (let i = 0; i < 10; i += 1) ui = stepReplay(ui, tl, 'faster', NOW)
    expect(ui.speed).toBe(SPEEDS[SPEEDS.length - 1])
    for (let i = 0; i < 10; i += 1) ui = stepReplay(ui, tl, 'slower', NOW)
    expect(ui.speed).toBe(SPEEDS[0])

    const playing = stepReplay({ ...newReplay(), speed: 4 }, tl, 'play', NOW)
    const quicker = stepReplay(playing, tl, 'faster', NOW + 2000)

    expect(quicker.speed).toBe(16)
    expect(stepNow(quicker, tl, NOW + 2000)).toBe(3)
    expect(offsetOf(tl, 3)).toBe(5000)
  })
})
