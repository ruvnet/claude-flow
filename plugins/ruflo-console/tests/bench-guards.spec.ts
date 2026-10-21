/**
 * What the benchmarks fixed, held in place (scripts/bench-workflows.mjs, scripts/bench-autopilot.mjs): the autopilot's journal fold stays linear and
 * says what the old quadratic one said, the journal encoder says the same bytes in one pass, an unchanged journal is not replayed, the parse memo holds
 * a live project's transcripts, a frame with no query parses nothing, the search stops parsing where its scan cap stops, and an unchanged oversized
 * transcript is not read again. Pure and fast (the one timing bound is 40x above the measured figure and 10x below the old one). Run with
 *   npx vitest run plugins/ruflo-console/tests/bench-guards.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { hashOf } from '../hooks/data/ap-envelope'
import { encodeLine, parseJournal, wash, type JournalEvent } from '../hooks/data/ap-journal'
import { compactState, emptyLoop, foldJournal, replayJournal, type LoopState, type ParkedRec, type StepRec } from '../hooks/data/ap-loop'
import { parseActivity, type Parsed } from '../hooks/data/wf-activity'
import { PARSED_BUDGET_CHARS, parsedOf, parsedStats, resetDrillIo } from '../hooks/data/wf-drill-io'
import { search, SCAN_CHARS } from '../hooks/data/wf-search'
import { readWorkflowRuns } from '../hooks/data/workflows-read'
import type { WfAgent, WfRun } from '../hooks/data/workflows'
import { resultOf } from '../hooks/views/wf-search'
import { click, frame, inputOf, liveFiles, useDrill, worldOf } from './fixtures/wf-drill-world'

const T0 = Date.parse('2026-10-06T00:00:00.000Z')
const ENV_HASH = hashOf({ name: 'x', toolClasses: ['edit'], paths: ['/w'], repos: [], network: [], secretEnv: [], spend: { hourUsd: 1, dayUsd: 2, totalUsd: 3 }, concurrency: 1, maxDurationMs: 3_600_000, verify: [], acceptWithoutAnatole: false })

/** The fold as it was before the indexes: a scan of the step and park lists for every event. The reference the fast one must agree with. */
function slowFold(events: readonly JournalEvent[], base: LoopState = emptyLoop()): LoopState {
  const s: LoopState = { ...base, steps: base.steps.map(step => ({ ...step })), parked: base.parked.map(p => ({ ...p })), receipts: [...base.receipts] }

  for (const e of events) {
    switch (e.t) {
      case 'start':
        s.starts += 1
        Object.assign(s, { phase: 'running', startedAtMs: e.at, envHash: e.envHash, revision: e.revision, anatole: e.anatole, reason: null, failures: 0, lastFailureAt: null })
        break
      case 'step.started':
        if (!s.steps.some(step => step.id === e.id)) {
          s.steps.push({ id: e.id, task: e.task, cls: e.cls, attempt: e.attempt, startedAt: e.at, deadline: e.deadline, status: 'started', tier: e.tier, ...(e.par !== undefined && { par: e.par }) })

          const once = s.parked.find(p => p.task === e.task && p.answer === 'once' && p.isUsed !== true)

          if (once !== undefined) once.isUsed = true
        }
        break
      case 'step.done': {
        const step = s.steps.find(x => x.id === e.id && x.status === 'started')

        if (step !== undefined) {
          Object.assign(step, { status: 'done', verified: e.verified, endedAt: e.at })
          s.failures = 0
        }
        break
      }
      case 'step.failed': {
        const step = s.steps.find(x => x.id === e.id && x.status === 'started')

        if (step !== undefined) {
          Object.assign(step, { status: 'failed', why: e.why, endedAt: e.at })
          s.failures += 1
          s.lastFailureAt = e.at
        }
        break
      }
      case 'parked':
        if (!s.parked.some(p => p.id === e.id && p.answer === undefined)) s.parked.push({ id: e.id, task: e.task, question: e.question, at: e.at })
        break
      case 'answered': {
        const held = s.parked.find(p => p.id === e.id && p.answer === undefined)

        if (held !== undefined) held.answer = e.answer
        break
      }
      case 'pause':
        if (s.phase === 'running') Object.assign(s, { phase: 'paused', reason: e.reason })
        break
      case 'resume':
        if (s.phase === 'paused') Object.assign(s, { phase: 'running', reason: null, failures: 0 })
        break
      case 'stop':
        Object.assign(s, { phase: 'stopped', reason: e.reason })
        break
      case 'beat':
        s.lastBeatAt = e.at
        break
      case 'adapt':
        s.receipts.push(e.receipt)
        break
      case 'digest':
        s.lastDigestDay = e.day
        break
    }
  }

  return compactState(s)
}

/** A seeded random journal that leans on every rule the indexes carry: repeated step ids, repeated parks of one id, answers before and after, `once` answers used by a later step of the task. */
function randomJournal(seed: number, n: number): JournalEvent[] {
  let x = seed

  const next = (): number => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0

    return x / 2 ** 32
  }
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
  const events: JournalEvent[] = [{ t: 'start', at: T0, envHash: ENV_HASH, revision: 1, anatole: 'on' }]

  for (let i = 0; i < n; i++) {
    const at = T0 + i * 1000
    const sid = `s${Math.floor(next() * 40)}`
    const task = `t${Math.floor(next() * 25)}`
    const park = `p${Math.floor(next() * 15)}`
    const roll = next()

    if (roll < 0.25) events.push({ t: 'step.started', at, id: sid, task, cls: pick(['edit', 'read']), attempt: 1 + Math.floor(next() * 3), deadline: at + 60_000, tier: 'mid' })
    else if (roll < 0.4) events.push({ t: 'step.done', at, id: sid, verified: next() < 0.5 })
    else if (roll < 0.5) events.push({ t: 'step.failed', at, id: sid, why: 'timed out' })
    else if (roll < 0.65) events.push({ t: 'parked', at, id: park, task, question: 'which class?' })
    else if (roll < 0.8) events.push({ t: 'answered', at, id: park, answer: pick(['once', 'deny'] as const) })
    else if (roll < 0.85) events.push({ t: 'pause', at, reason: 'r' })
    else if (roll < 0.9) events.push({ t: 'resume', at })
    else if (roll < 0.95) events.push({ t: 'beat', at })
    else events.push({ t: 'digest', at, day: '2026-10-06' })
  }

  return events
}

describe('foldJournal', () => {
  it('agrees with the scan-per-event fold on random journals, from empty and from a checkpoint', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const events = randomJournal(seed, 600)

      expect(foldJournal(events)).toEqual(slowFold(events))

      const base = foldJournal(events.slice(0, 300))

      expect(foldJournal(events.slice(300), base)).toEqual(slowFold(events.slice(300), base))
    }
  })

  it('stays linear: 60,000 events fold in well under a second (the quadratic fold took about four)', () => {
    const events: JournalEvent[] = [{ t: 'start', at: T0, envHash: ENV_HASH, revision: 1, anatole: 'on' }]

    for (let i = 0; i < 30_000; i++) {
      events.push({ t: 'step.started', at: T0 + i, id: `s${i}`, task: `t${i}`, cls: 'edit', attempt: 1, deadline: T0 + i + 1000, tier: 'mid' })
      events.push({ t: 'step.done', at: T0 + i + 1, id: `s${i}`, verified: true })
    }

    const from = performance.now()
    const state = foldJournal(events)
    const took = performance.now() - from

    expect(state.steps).toHaveLength(400)
    expect(state.steps.every(step => step.status === 'done')).toBe(true)
    expect(took).toBeLessThan(1500)
  })

  it('keeps one step per id and never reopens a finished one', () => {
    const state = foldJournal([
      { t: 'start', at: T0, envHash: ENV_HASH, revision: 1, anatole: 'on' },
      { t: 'step.started', at: T0 + 1, id: 'a', task: 't', cls: 'edit', attempt: 1, deadline: T0 + 99, tier: 'mid' },
      { t: 'step.done', at: T0 + 2, id: 'a', verified: true },
      { t: 'step.started', at: T0 + 3, id: 'a', task: 't', cls: 'edit', attempt: 1, deadline: T0 + 99, tier: 'mid' },
      { t: 'step.failed', at: T0 + 4, id: 'a', why: 'late' },
    ])

    expect(state.steps.map((step: StepRec) => [step.id, step.status])).toEqual([['a', 'done']])
    expect(state.failures).toBe(0)
  })

  it('marks an `once` answer used by the first step of its task, and parks one open question per id', () => {
    const state = foldJournal([
      { t: 'start', at: T0, envHash: ENV_HASH, revision: 1, anatole: 'on' },
      { t: 'parked', at: T0 + 1, id: 'p', task: 't', question: 'q' },
      { t: 'parked', at: T0 + 2, id: 'p', task: 't', question: 'again' },
      { t: 'answered', at: T0 + 3, id: 'p', answer: 'once' },
      { t: 'step.started', at: T0 + 4, id: 's1', task: 't', cls: 'edit', attempt: 1, deadline: T0 + 99, tier: 'mid' },
      { t: 'step.started', at: T0 + 5, id: 's2', task: 't', cls: 'edit', attempt: 2, deadline: T0 + 99, tier: 'mid' },
    ])

    expect(state.parked.map((p: ParkedRec) => [p.id, p.answer, p.isUsed])).toEqual([['p', 'once', true]])
  })
})

describe('encodeLine', () => {
  it('writes the bytes the parse-and-restringify version wrote', () => {
    const legacy = (event: JournalEvent): string => {
      const keep = new Set(['t', 'envHash', 'hash', 'prev', 'id', 'task', 'day', 'anatole', 'answer', 'direction'])
      const clean = JSON.parse(JSON.stringify(event, (key, value: unknown) => (typeof value === 'string' && !keep.has(key) ? wash(value, 300) : value))) as JournalEvent
      const line = JSON.stringify(clean)

      return `${line.length > 2_000 ? JSON.stringify({ t: 'pause', at: event.at, reason: 'an event was too long to journal' }) : line}\n`
    }
    const samples: JournalEvent[] = [
      ...randomJournal(9, 80),
      { t: 'parked', at: T0, id: 'p1', task: 't', question: '\u001b[31mred\u001b[0m  and   spaced with key sk-ABCDEFGHIJKLMNOPQRSTUVWX' },
      { t: 'step.failed', at: T0, id: 's', why: 'x'.repeat(5000) },
    ]

    for (const event of samples) expect(encodeLine(event)).toBe(legacy(event))
  })
})

describe('replayJournal', () => {
  const text = randomJournal(11, 300).map(encodeLine).join('')

  it('is the parse and the fold, and hands the same answer back for the same text', () => {
    const first = replayJournal(text)

    expect(first.loop).toEqual(foldJournal(parseJournal(text).events))
    expect(first.bad).toBe(parseJournal(text).bad)
    expect(replayJournal(text)).toBe(first)
    expect(replayJournal(`${text}{"t":"beat","at":${T0 + 999_999}}\n`).loop.lastBeatAt).toBe(T0 + 999_999)
    expect(replayJournal(text).loop).toEqual(first.loop)
  })

  it('counts the lines that are not events', () => {
    expect(replayJournal(`${text}not json\n{"t":"nope","at":1}\n`).bad).toBe(2)
  })
})

describe('the parse memo', () => {
  const jsonl = (id: string): string => `${JSON.stringify({ type: 'user', timestamp: new Date(T0).toISOString(), message: { role: 'user', content: `task ${id}` } })}\n`
  const agentOf = (i: number): WfAgent => ({ id: `a${i}`, label: `agent ${i}`, phase: 'Build', state: 'running', transcriptPath: `/p/agent-a${i}.jsonl` }) as unknown as WfAgent

  it('keeps a live project of 340 transcripts parsed (it held 24), so a second pass parses nothing', () => {
    resetDrillIo()

    const cache = new Map<string, { mtimeMs: number; size: number; text: string }>()
    const agents = Array.from({ length: 340 }, (_, i) => agentOf(i))

    for (const [i, agent] of agents.entries()) cache.set(agent.transcriptPath as string, { mtimeMs: 1, size: 1, text: jsonl(String(i)) })

    const first = agents.map(agent => parsedOf(cache, agent))
    const parses = parsedStats().parses

    expect(parses).toBe(340)
    expect(agents.map(agent => parsedOf(cache, agent)).every((parsed, i) => parsed === first[i])).toBe(true)
    expect(parsedStats().parses).toBe(parses)
    resetDrillIo()
  })

  it('is bounded by the text it holds: the oldest go first past the budget, the newest stays', () => {
    resetDrillIo()

    const line = jsonl('x')
    const big = line.repeat(Math.ceil(9_000_000 / line.length))
    const cache = new Map<string, { mtimeMs: number; size: number; text: string }>()
    const agents = [0, 1, 2].map(agentOf)

    for (const agent of agents) cache.set(agent.transcriptPath as string, { mtimeMs: 1, size: 1, text: `${big}${agent.id}\n` })

    for (const agent of agents) parsedOf(cache, agent)

    expect(parsedStats().chars).toBeLessThanOrEqual(PARSED_BUDGET_CHARS)
    expect(parsedStats().entries).toBe(2)

    const before = parsedStats().parses

    parsedOf(cache, agents[2] as WfAgent)
    expect(parsedStats().parses).toBe(before)
    parsedOf(cache, agents[0] as WfAgent)
    expect(parsedStats().parses).toBe(before + 1)
    resetDrillIo()
  })
})

describe('the search panel on the page', () => {
  useDrill()

  it('parses nothing for a frame with no query, and once for a query however often it is drawn again', async () => {
    const world = await worldOf(liveFiles())

    // The refresh has parsed the transcripts ahead of any frame (ADR-473): this guard is about a memo that has not, so it is emptied.
    expect(parsedStats().warmed).toBeGreaterThan(0)
    resetDrillIo()
    frame(world)
    frame(world)

    // Nothing is searched, so nothing is parsed for it: at most the agent under the cursor is (the drill's own panel), never every agent of every run.
    const idle = parsedStats().parses

    expect(idle).toBeLessThanOrEqual(1)
    frame(world)
    expect(parsedStats().parses).toBe(idle)

    ;(inputOf(frame(world).tree)?.props.onInput as (v: string) => void)('ls -la')

    frame(world)

    const once = parsedStats().parses

    expect(once).toBeGreaterThan(idle)
    expect(once).toBeLessThanOrEqual(2)

    const again = frame(world)

    frame(world)
    expect(parsedStats().parses).toBe(once)
    expect(resultOf(again.env, 'ls -la')).toBe(resultOf(again.env, 'ls -la'))
    click(again.tree, 'wf-hit-tool-0')
  })

  it('finds the transcripts a refresh parsed ahead already parsed: typing a query parses nothing new, and a redraw nothing either', async () => {
    const world = await worldOf(liveFiles())
    const warm = parsedStats()

    expect(warm.warmed).toBeGreaterThan(0)

    const idle = warm.parses

    frame(world)
    ;(inputOf(frame(world).tree)?.props.onInput as (v: string) => void)('ls -la')

    const drawn = frame(world)

    expect(parsedStats().parses).toBe(idle)
    expect(resultOf(drawn.env, 'ls -la').counts.tool).toBeGreaterThan(0)
    frame(world)
    expect(parsedStats().parses).toBe(idle)
  })
})

describe('search stops parsing where its cap stops scanning', () => {
  const entry = (text: string): Parsed['entries'][number] => ({ kind: 'message', index: 0, role: 'assistant', body: { text, total: text.length, isCut: false } })
  const parsedOfText = (text: string): Parsed => ({ entries: [entry(text)], calls: [], files: [], isTail: false, dropped: 0, skipped: 0 })
  const agent = (i: number): WfAgent => ({ id: `a${i}`, label: `agent ${i}`, phase: 'Build', state: 'done', transcriptPath: `/p/agent-a${i}.jsonl` }) as unknown as WfAgent
  const run = (agents: WfAgent[]): WfRun => ({ id: 'wf_x', name: 'run', kind: 'workflow', state: 'completed', total: agents.length, done: agents.length, running: 0, failed: 0, idle: 0, phases: [{ title: 'Build', agents, done: agents.length, total: agents.length, running: 0, failed: 0 }] }) as unknown as WfRun

  it('counts the agents past the cap without asking for their parse, and says the same numbers', () => {
    const agents = [agent(0), agent(1), agent(2), agent(3)]
    const huge = parsedOfText('x'.repeat(SCAN_CHARS + 10))
    const asked: string[] = []
    const input = { runs: [run(agents)], parsed: (a: WfAgent) => (asked.push(a.id), a.id === 'a3' ? null : huge) }
    const lazy = search({ ...input, isHeld: a => a.id !== 'a3' }, 'needle')
    const askedLazy = [...asked]

    asked.length = 0

    const eager = search(input, 'needle')

    expect(lazy).toEqual(eager)
    expect(lazy.isCapped).toBe(true)
    expect(lazy.scanned).toBe(3)
    expect(lazy.unread).toBe(1)
    expect(askedLazy).toEqual(['a0', 'a1'])
    expect(asked).toEqual(['a0', 'a1', 'a2', 'a3'])
  })
})

describe('the page search over transcripts in memory', () => {
  it('looks at no run, agent or text for a query too short to search (the box is drawn on every frame)', () => {
    const env = { ctx: { state: { cache: new Map(), snapshot: null } }, get runs(): never { throw new Error('the runs were walked') } } as never

    expect(resultOf(env, '')).toMatchObject({ isSearched: false, scanned: 0, chars: 0 })
    expect(resultOf(env, ' x ')).toMatchObject({ isSearched: false })
  })

  it('parses only as far as the scan cap goes and still counts every agent it did not read', () => {
    resetDrillIo()

    const line = JSON.stringify({ type: 'user', timestamp: new Date(T0).toISOString(), message: { role: 'user', content: 'word '.repeat(1200) } })
    const huge = `${Array.from({ length: Math.ceil(SCAN_CHARS / 6000) + 20 }, () => line).join('\n')}\n`
    const small = `${line}\n`
    const agents = [huge, small, small].map((text, i) => ({ id: `a${i}`, label: `agent ${i}`, phase: 'Build', state: 'done', transcriptPath: `/p/agent-a${i}.jsonl`, text }))
    const cache = new Map(agents.map(agent => [agent.transcriptPath, { mtimeMs: 1, size: 1, text: agent.text }]))
    const wfRun = { id: 'wf_x', name: 'run', kind: 'workflow', state: 'completed', total: 3, done: 3, running: 0, failed: 0, idle: 0, phases: [{ title: 'Build', agents, done: 3, total: 3, running: 0, failed: 0 }] } as unknown as WfRun
    const env = { ctx: { state: { cache, snapshot: null } }, runs: [wfRun] } as never
    const result = resultOf(env, 'zzzz-not-there')

    expect(result.isCapped).toBe(true)
    expect(result.scanned).toBe(3)
    expect(result.unread).toBe(0)
    expect(parsedStats().parses).toBe(1)
    expect(resultOf(env, 'zzzz-not-there')).toBe(result)
    expect(parsedStats().parses).toBe(1)
    resetDrillIo()
  })
})

describe('the folder reader and a transcript over the read cap', () => {
  const CONFIG = '/home/u/.claude'
  const DIR = `${CONFIG}/projects/-work-proj/11111111-2222-3333-4444-555555555555/subagents/workflows/wf_big`
  const tail = `ial line cut by the tail read\n${JSON.stringify({ type: 'assistant', timestamp: new Date(T0).toISOString(), message: { id: 'm1', model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash' }], usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } } })}\n`
  const files: Record<string, { text: string; size: number; mtimeMs: number }> = {
    [`${DIR}/journal.jsonl`]: { text: `${JSON.stringify({ type: 'launched' })}\n${JSON.stringify({ type: 'started', key: 'v2:a1', agentId: 'a1', label: 'one', phase: 'Build' })}\n`, size: 100, mtimeMs: T0 },
    [`${DIR}/agent-a1.meta.json`]: { text: JSON.stringify({ description: 'one', workflowPhase: 'Build' }), size: 60, mtimeMs: T0 },
    [`${DIR}/agent-a1.jsonl`]: { text: '', size: 50_000_000, mtimeMs: T0 },
  }
  const dirs = (path: string): string[] => [...new Set(Object.keys(files).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1).split('/')[0] as string))]
  const fsOver = (counter: { tails: number }) => ({
    read: async (path: string) => files[path]?.text ?? Promise.reject(new Error('ENOENT')),
    stat: async (path: string) => (files[path] === undefined ? Promise.reject(new Error('ENOENT')) : { mtimeMs: files[path].mtimeMs, size: files[path].size, kind: 'file' as const }),
    list: async (path: string) => (dirs(path).length === 0 ? Promise.reject(new Error('ENOENT')) : dirs(path).map(name => ({ name, mtimeMs: files[`${path}/${name}`]?.mtimeMs ?? T0, size: files[`${path}/${name}`]?.size }))),
    readTail: async () => (counter.tails++, tail),
  })

  it('reads the tail once while the listing says the file is unchanged, again when it changes, and never trusts a listing with no mtime', async () => {
    const counter = { tails: 0 }
    const fs = fsOver(counter)
    const options = { configDir: CONFIG, cwd: '/work/proj', nowMs: T0 + 5000 }
    const read = () => readWorkflowRuns(fs as never, new Map(), options)
    const figures = (r: Awaited<ReturnType<typeof read>>) => r.runs.map(x => x.phases.map(p => p.agents.map(a => [a.tokens, a.toolCalls, a.lastTool, a.model])))
    const first = await read()

    expect(counter.tails).toBe(1)
    expect(figures(first)).toEqual([[[[10, 1, 'Bash', 'claude-sonnet-5-5']]]])

    expect(figures(await read())).toEqual(figures(first))
    expect(counter.tails).toBe(1)

    ;(files[`${DIR}/agent-a1.jsonl`] as { mtimeMs: number }).mtimeMs = T0 + 1000
    await read()
    expect(counter.tails).toBe(2)

    ;(files[`${DIR}/agent-a1.jsonl`] as { size: number }).size = 50_000_100
    await read()
    expect(counter.tails).toBe(3)

    const noMtime = { ...fs, list: async (path: string) => (await fs.list(path)).map(({ mtimeMs: _m, ...rest }) => rest) }

    await readWorkflowRuns(noMtime as never, new Map(), options)
    await readWorkflowRuns(noMtime as never, new Map(), options)
    expect(counter.tails).toBe(5)
  })
})
