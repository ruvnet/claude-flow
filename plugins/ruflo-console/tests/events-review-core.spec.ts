/**
 * The adversarial review of ADR-474 (Events and Timeline), part: the concurrency strip, the problem jump and the verbs through the real command path. Each block names the defect it pins.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { append, tick } from '../hooks/activity-live'
import { resetIo } from '../hooks/activity-io'
import { EVENTS_FILE, LANES_FILE } from '../hooks/data/activity-store'
import type { ConsoleEvent } from '../hooks/data/events'
import { cellsOf, concurrency, lanesIn, newLaneStore, addTools, type LaneView } from '../hooks/data/timeline-model'
import { applyEventsArgs } from '../hooks/events-args'
import { eventsActions, eventsUi } from '../hooks/events-ui'
import type { Host } from '../hooks/host'
import { parseRuflo } from '../hooks/commands'
import { newState } from '../hooks/state'
import { timelineActions, timelineUi } from '../hooks/timeline-ui'
import { watchCommand } from '../hooks/watch-command'
import { rig } from './fixtures/ev-rig'
import { hostOn, newDisk, type Disk } from './fixtures/activity-fs'


const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const ev = (text: string, atS = 0, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

function consoleOn(disk: Disk, options: Record<string, string | number | boolean> = {}) {
  const state = newState(options)

  state.cwd = CWD

  const host = { ...hostOn(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined } as unknown as Host

  return { state, host }
}

beforeEach(() => resetIo())

describe('the concurrency strip against a brute force', () => {
  it('counts, peak, peak time and mean agree on 300 random lanes of spans', () => {
    let seed = 1234567
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff

      return seed % n
    }

    for (let round = 0; round < 300; round++) {
      const fromMs = rand(1000)
      const spanMs = 100 + rand(2400)
      const bars = 1 + rand(40)
      const win = { fromMs, toMs: fromMs + spanMs }
      const lanes: LaneView[] = Array.from({ length: rand(8) }, (_, k) => ({
        lane: `l${k}`, group: 'ruflo', label: `l${k}`, calls: 0, byTool: [], busyMs: 0, observedMs: 0, busyPct: null, longestMs: 0, lastAtMs: 0, tickMins: [],
        spans: Array.from({ length: rand(5) }, () => {
          const a = fromMs - 200 + rand(spanMs + 400)

          return { lane: `l${k}`, group: 'ruflo' as const, label: 'x', fromMs: a, toMs: a + 1 + rand(600), busy: rand(3) > 0 }
        }),
      }))
      const got = concurrency(lanes, win, newLaneStore(), bars)
      const step = spanMs / bars
      const want = new Array<number>(bars).fill(0)

      for (const lane of lanes) {
        const busy = new Set<number>()

        for (const span of lane.spans) {
          if (!span.busy) continue

          // The integer milliseconds the span covers, inside the window, each placed in the bar that holds it.
          for (let m = Math.max(span.fromMs, win.fromMs); m <= Math.min(span.toMs, win.toMs) - 1; m++) busy.add(Math.floor((m - win.fromMs) / step))
        }

        for (const i of busy) want[i]!++
      }

      const peak = Math.max(0, ...want)
      const active = want.filter(n => n > 0)

      expect(got.counts, `round ${round}`).toEqual(want)
      expect(got.peak).toBe(peak)
      expect(got.mean).toBe(active.length === 0 ? 0 : Math.round((active.reduce((x, y) => x + y, 0) / active.length) * 10) / 10)
      expect(got.peakAtMs).toBe(peak === 0 ? null : win.fromMs + want.indexOf(peak) * step)
    }
  })

  it('an idle span never hides a busy one, a tool-call minute marks its bar, and lanes with no overlap with the window are absent', () => {
    const lane = (spans: { fromMs: number; toMs: number; busy: boolean }[], tickMins: number[] = []): LaneView => ({ lane: 'a', group: 'ruflo', label: 'a', calls: 0, byTool: [], busyMs: 0, observedMs: 0, busyPct: null, longestMs: 0, lastAtMs: 0, tickMins, spans: spans.map(s => ({ lane: 'a', group: 'ruflo' as const, label: 'a', ...s })) })
    const win = { fromMs: 0, toMs: 600_000 }

    expect([...cellsOf(lane([{ fromMs: 0, toMs: 600_000, busy: false }, { fromMs: 0, toMs: 60_000, busy: true }]), win, 10)].slice(0, 3)).toEqual([2, 1, 1])
    expect(cellsOf(lane([], [5]), win, 10)[5]).toBe(3)

    const store = newLaneStore()

    store.spans.push({ lane: 'z', group: 'ruflo', label: 'z', fromMs: 5_000_000, toMs: 5_000_100, busy: true })
    expect(lanesIn(store, win, 600_000)).toEqual([])
  })

  it('tool names that are also object property names are counted, and a minute persists once', () => {
    const store = newLaneStore()

    addTools(store, 'claude:main', 'claude', 'main', [{ atMs: 61_000, tool: 'constructor' }, { atMs: 62_000, tool: '__proto__' }, { atMs: 63_000, tool: 'constructor' }, { atMs: 64_000, tool: 'toString' }], 61_000)

    const tick = [...store.ticks.values()][0]!

    expect(tick.n).toBe(4)
    expect(tick.tools.constructor).toBe(2)
    expect(tick.tools.toString).toBe(1)
    expect(Object.getPrototypeOf(tick.tools)).toBeNull()
  })
})

describe('jump to the last problem walks back', () => {
  it('pressed again it goes to the next older problem and says so when there is none', () => {
    const w = rig(100, { events: 0 })

    w.act.log.length = 0
    append(w.act, [{ atMs: T - 3 * 3_600_000, kind: 'swarm', text: 'step a failed' }, { atMs: T - 2 * 3_600_000, kind: 'swarm', text: 'step b failed' }, { atMs: T - 3_600_000 / 2, kind: 'swarm', text: 'step c failed' }])
    w.state.loadedAtMs = T - 86_400_000

    const ui = timelineUi(w.state)
    const real = Date.now

    Date.now = () => T

    try {
      w.actions.timeline.problem()
      expect(ui.said).toContain('step c failed')
      Date.now = () => T + 7
      w.actions.timeline.problem()
      expect(ui.said).toContain('step b failed')
      w.actions.timeline.problem()
      expect(ui.said).toContain('step a failed')
      w.actions.timeline.problem()
      expect(ui.said).toContain('no warn or bad event before')
    } finally {
      Date.now = real
    }
  })
})

// ------------------------------------------------------------------------------------------------------------------ reachability

describe('every documented verb does what the help says, through the real parse and command path', () => {
  async function run(words: string): Promise<{ text: string; state: ReturnType<typeof newState>; asked: { label: string; argv?: readonly string[]; stdin?: string }[]; views: string[] }> {
    const w = rig(100)
    const asked: { label: string; argv?: readonly string[]; stdin?: string }[] = []
    const views: string[] = []
    const control = {
      actions: { events: eventsActions(w.state, { fs: hostOn(newDisk()).fs, fillPrompt: async () => true } as unknown as Host, () => undefined, spec => {
        if (spec !== null) {
          asked.push(spec as never)
          w.state.pending = { label: spec.label, args: [], expect: '', askedAtMs: Date.now(), shows: spec.shows } as never
        }
      }, () => undefined), timeline: timelineActions(w.state, { fs: hostOn(newDisk()).fs } as unknown as Host, () => undefined, id => void views.push(id), spec => {
        if (spec !== null) {
          asked.push(spec as never)
          w.state.pending = { label: spec.label, args: [], expect: '', askedAtMs: Date.now(), shows: spec.shows } as never
        }
      }, () => undefined) },
      setView: (id: string) => void views.push(id),
      open: async () => ({ isPlaced: true, reason: '' }),
      host: { invalidate: () => undefined },
    }
    const intent = parseRuflo(words)

    expect(intent.kind === 'events' || intent.kind === 'timeline' || intent.kind === 'open').toBe(true)

    if (intent.kind === 'open') return { text: 'opened', state: w.state, asked, views: [intent.view as string] }

    const out = await watchCommand(control as never, w.state, intent as never)

    return { text: out.text, state: w.state, asked, views }
  }

  it('events: kind, level, since, a quoted query, window, clear, follow, pin, rule', async () => {
    expect((await run('events swarm')).text).toBe('events: swarm')
    expect((await run('events bad')).text).toBe('events: level bad')
    expect((await run('events since:15m kind:claims')).text).toContain('query since:15m kind:claims')
    expect((await run('events "agent coder"')).text).toContain('"agent coder"')
    expect((await run('events window 1h')).text).toBe('events: window 1h')
    expect((await run('events clear')).text).toBe('events: filters cleared')

    const follow = await run('events follow agent:coder-12')

    expect(follow.text).toContain('following agent:coder-12')
    expect(eventsUi(follow.state).followRef).toBe('agent:coder-12')
    expect(follow.views).toContain('events')
    expect((await run('events pin')).text).toBe('pinned')
    expect((await run('events level bad')).text).toBe('events: level bad')
    expect((await run('events kind:swarm rule')).text).not.toBe('')
  })

  it('forget asks first with the exact rm of the two files; export asks with a new-file write; a bad path says why and asks nothing', async () => {
    const forget = await run('events forget')

    expect(forget.asked).toHaveLength(1)
    expect(forget.asked[0]?.argv).toEqual(['rm', '-f', '--', `${'/work/proj'}/${EVENTS_FILE}`, `${'/work/proj'}/${LANES_FILE}`])
    expect(forget.text).toContain('Asked: forget the Events and Timeline history')

    const exported = await run('events export run.jsonl')

    expect(['dd', 'install']).toContain(exported.asked[0]?.argv?.[0])
    expect(exported.asked[0]?.argv?.some(arg => arg === 'conv=excl' || arg === '/dev/stdin')).toBe(true)
    expect(exported.asked[0]?.stdin).toContain('"kind"')

    const bad = await run('events export ../../etc/x.md')

    expect(bad.asked).toHaveLength(0)
    expect(bad.text).toContain('..')

    const tl = await run('timeline export lanes.csv')

    expect(tl.asked[0]?.stdin).toContain('group,lane,busy_pct')
    expect((await run('timeline export ../x.csv')).asked).toHaveLength(0)
  })

  it('timeline: every window, zoom in and out, follow; bare opens the page', async () => {
    for (const id of ['5m', '15m', '1h', '6h', '24h', 'session']) expect((await run(`timeline ${id}`)).text).toBe(`timeline: ${id}`)
    expect((await run('timeline zoom in')).text).toMatch(/^timeline: /)
    expect((await run('timeline zoom sideways')).text).toContain('zoom takes')

    const follow = await run('timeline follow run:wf_1')

    expect(follow.views).toContain('events')
    expect(eventsUi(follow.state).followRef).toBe('run:wf_1')
    expect((await run('timeline')).views).toEqual(['timeline'])
    expect(applyEventsArgs(newState({}), []).text).toMatch(/^events: /)
  })
})

