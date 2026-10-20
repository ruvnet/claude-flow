/**
 * Persistence and the live pass (ADR-474): batching, the append path, rotation, a missing folder, a failing disk, a link in the way,
 * two consoles on one file, history loaded on open (corrupt lines, a cut line, schema skew), and the option that turns writing off.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { activityOf, loadActivity, pathsOf, tick } from '../hooks/activity-live'
import { BATCH_MAX, flush, pendingOf, queueLine, resetIo, PENDING_MAX } from '../hooks/activity-io'
import { encodeEvent, EVENTS_CAP, EVENTS_FILE } from '../hooks/data/activity-store'
import type { ConsoleEvent } from '../hooks/data/events'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { hostOn, newDisk, type Disk } from './fixtures/activity-fs'

const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const FILE = `${CWD}/${EVENTS_FILE}`
const ev = (text: string, atS = 0, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

function consoleOn(disk: Disk, options: Record<string, string | number | boolean> = {}) {
  const state = newState(options)

  state.cwd = CWD

  const host = { ...hostOn(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined } as unknown as Host

  return { state, host }
}

beforeEach(() => resetIo())

describe('the write path', () => {
  it('batches: a hundred queued lines are one append, not a hundred', async () => {
    const disk = newDisk()
    const host = hostOn(disk)

    for (let i = 0; i < 100; i++) queueLine(FILE, EVENTS_CAP, encodeEvent(ev(`e${i}`, i)))
    await flush(host, CWD, FILE, T)

    expect(disk.runs.filter(argv => argv.includes('oflag=append'))).toHaveLength(1)
    expect(disk.files.get(FILE)?.split('\n').filter(Boolean)).toHaveLength(100)
    expect(pendingOf(FILE)).toBe(0)
  })

  it('makes the missing folder once, and appends through the journal fixed dd argv', async () => {
    const disk = newDisk()
    const host = hostOn(disk)

    queueLine(FILE, EVENTS_CAP, encodeEvent(ev('a')))
    await flush(host, CWD, FILE, T)
    queueLine(FILE, EVENTS_CAP, encodeEvent(ev('b')))
    await flush(host, CWD, FILE, T + 1)

    expect(disk.runs.filter(argv => argv[0] === 'mkdir')).toHaveLength(1)
    expect(disk.runs.find(argv => argv.includes('oflag=append'))).toEqual(['dd', `of=${FILE}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])
  })

  it('writes a batch no bigger than the batch cap and the rest on the next pass', async () => {
    const disk = newDisk()
    const line = encodeEvent(ev('x'.repeat(100)))
    const n = Math.ceil((BATCH_MAX * 2) / line.length)

    for (let i = 0; i < n; i++) queueLine(FILE, EVENTS_CAP, line)
    await flush(hostOn(disk), CWD, FILE, T)

    expect(disk.files.get(FILE)!.length).toBeLessThanOrEqual(BATCH_MAX)
    expect(pendingOf(FILE)).toBeGreaterThan(0)
  })

  it('a failing disk is remembered, not thrown: the lines stay queued and are retried after the wait', async () => {
    const disk = newDisk()

    disk.failAppend = true
    queueLine(FILE, EVENTS_CAP, encodeEvent(ev('a')))
    await expect(flush(hostOn(disk), CWD, FILE, T)).resolves.toBeUndefined()
    expect(pendingOf(FILE)).toBe(1)

    await flush(hostOn(disk), CWD, FILE, T + 1000)
    expect(disk.runs.filter(argv => argv.includes('oflag=append'))).toHaveLength(1)

    disk.failAppend = false
    await flush(hostOn(disk), CWD, FILE, T + 60_000)
    expect(pendingOf(FILE)).toBe(0)
    expect(disk.files.get(FILE)).toContain('"text":"a"')
  })

  it('never writes through a link, and the queue is bounded', async () => {
    const disk = newDisk({ [FILE]: '' })

    disk.dirs.add(`${CWD}/.claude-flow`).add(`${CWD}/.claude-flow/console`)
    disk.links.add(FILE)
    queueLine(FILE, EVENTS_CAP, encodeEvent(ev('a')))
    await flush(hostOn(disk), CWD, FILE, T)
    expect(disk.runs.some(argv => argv.includes('oflag=append'))).toBe(false)

    for (let i = 0; i < PENDING_MAX + 50; i++) queueLine(FILE, EVENTS_CAP, 'x\n')
    expect(pendingOf(FILE)).toBe(PENDING_MAX)
  })

  it('past its cap the file is cut to its newest half and still holds whole lines', async () => {
    const disk = newDisk()
    const cap = 4000

    for (let i = 0; i < 200; i++) queueLine(FILE, cap, encodeEvent(ev(`event ${i}`, i)))

    for (let pass = 0; pass < 30 && pendingOf(FILE) > 0; pass++) await flush(hostOn(disk), CWD, FILE, T + pass)

    const text = disk.files.get(FILE) as string

    expect(text.length).toBeLessThan(cap)
    expect(text.split('\n').filter(Boolean).every(line => line.startsWith('{') && line.endsWith('}'))).toBe(true)
    expect(text).toContain('event 199')
    expect(text).not.toContain('"event 0"')
  })

  it('two consoles appending to one file never cut a batch in two', async () => {
    const disk = newDisk()
    const a = hostOn(disk)

    for (let i = 0; i < 20; i++) {
      queueLine(FILE, EVENTS_CAP, encodeEvent(ev(`from a ${i}`, i), 'a'))
      await flush(a, CWD, FILE, T + i * 10_000)
      disk.files.set(FILE, (disk.files.get(FILE) ?? '') + encodeEvent(ev(`from b ${i}`, i), 'b'))
    }

    const lines = (disk.files.get(FILE) as string).split('\n').filter(Boolean)

    expect(lines).toHaveLength(40)
    expect(lines.every(line => JSON.parse(line).v === 1)).toBe(true)
  })
})

describe('the live pass', () => {
  it('loads history on open: the tail, with corrupt lines counted and a cut line dropped', async () => {
    const good = encodeEvent(ev('before restart', -3600))
    const disk = newDisk({ [FILE]: `${good.slice(10)}${good}garbage\n${encodeEvent(ev('second', -60))}{"v":1,"t":5` })
    const { state, host } = consoleOn(disk)

    await loadActivity(state, host)

    const act = activityOf(state)

    expect(act.log.map(e => e.text)).toEqual(['before restart', 'second'])
    expect(act.loaded).toMatchObject({ isLoaded: true, events: 2 })
    expect(act.loaded.bad).toBeGreaterThanOrEqual(2)
  })

  it('a missing folder is an empty history, not an error', async () => {
    const { state, host } = consoleOn(newDisk())

    await loadActivity(state, host)
    expect(activityOf(state).loaded).toMatchObject({ isLoaded: true, events: 0, problem: null })
  })

  it('takes in new events once, writes them masked, and skips the write when eventsPersist is off', async () => {
    const disk = newDisk()
    const on = consoleOn(disk)
    const off = consoleOn(newDisk(), { eventsPersist: false })

    for (const { state, host } of [on, off]) {
      await tick(state, host, T)
      state.events.push(ev('agent x failed with token=abcdef123456', 5))
      await tick(state, host, T + 10_000)
      await tick(state, host, T + 20_000)
    }

    expect(activityOf(on.state).log).toHaveLength(1)
    expect(disk.files.get(FILE)).toContain('"level":"bad"')
    expect(disk.files.get(FILE)).not.toContain('abcdef123456')
    expect(disk.files.get(FILE)?.split('\n').filter(Boolean)).toHaveLength(1)
    expect(activityOf(off.state).log).toHaveLength(1)
    expect(pathsOf(CWD).events).toBe(FILE)
  })

  it('history from a previous run is on the page but never re-announced to alert rules', async () => {
    const disk = newDisk({ [FILE]: encodeEvent(ev('old failure failed', -100)) })
    const { state, host } = consoleOn(disk)

    await tick(state, host, T)
    activityOf(state).prefs.rules = [{ name: 'fails', q: 'failed' }]
    await tick(state, host, T + 2000)
    expect(state.notices).toHaveLength(0)

    state.events.push(ev('new failure failed', 5))
    await tick(state, host, T + 5000)
    expect(state.notices.map(n => n.key)).toEqual(['events-rule:fails'])
  })
})

describe('lanes from the state the console holds', () => {
  it('samples ruflo agents, aggregates tool calls per minute, and takes workflow agents and mission tasks as intervals once; lanes persist', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk)

    state.snapshot = { agents: [{ id: 'a1', type: 'coder', status: 'busy' }, { id: 'a2', type: 'tester', status: 'idle' }], tasks: [{ id: 't1', description: 'build it', status: 'completed', assignedTo: [], type: 'x', startedAtMs: T - 120_000, completedAtMs: T - 60_000 }], claims: [] } as never
    state.toolsByAgent.set('main', [{ atMs: T - 90_000, tool: 'Bash' }, { atMs: T - 80_000, tool: 'Bash' }, { atMs: T - 70_000, tool: 'Read' }])
    state.wf.read = { runs: [{ id: 'wf_1', name: 'build', kind: 'workflow', state: 'completed', total: 1, done: 1, failed: 0, running: 0, idle: 0, hasRecord: true, totalTokens: null, isTokensPartial: false, phases: [{ title: 'p', done: 1, total: 1, running: 0, failed: 0, agents: [{ id: 'ag1', label: 'writer', phase: 'p', state: 'done', hasWorktree: false, startedMs: T - 300_000, elapsedMs: 120_000 }] }] }], root: '/x', capBytes: 1, skipped: 0, more: 0 } as never

    await tick(state, host, T)
    await tick(state, host, T + 2000)

    const lanes = activityOf(state).lanes

    expect(lanes.open.get('ruflo:a1')?.busy).toBe(true)
    expect(lanes.open.get('ruflo:a2')?.busy).toBe(false)
    expect(lanes.spans.map(span => span.lane).sort()).toEqual(['mission:t1', 'workflow:wf_1/ag1'])
    expect([...lanes.ticks.values()].reduce((n, tick) => n + tick.n, 0)).toBe(3)

    // A second pass shows the same things and adds nothing.
    await tick(state, host, T + 4000)
    expect(lanes.spans).toHaveLength(2)

    // An agent that changes status closes its span, and the closed spans and finished minutes are written masked to lanes.jsonl.
    ;(state.snapshot as unknown as { agents: { status: string }[] }).agents[0]!.status = 'idle'
    await tick(state, host, T + 6000)
    await tick(state, host, T + 12_000)

    const written = disk.files.get(`${CWD}/.claude-flow/console/lanes.jsonl`) ?? ''

    expect(written.split('\n').filter(Boolean).every(line => JSON.parse(line).v === 1)).toBe(true)
    expect(written.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(4)
    expect(written).toContain('"l":"ruflo:a1"')
    expect(written).toContain('"l":"workflow:wf_1/ag1"')
    expect(written).toContain('"tools":{"Bash":2')
  })
})
