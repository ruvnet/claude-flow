/**
 * The incremental transcript parsers against the reference ones (ADR-473). Seeded random transcripts are cut at random points (mid line,
 * mid escape, mid surrogate pair), fed in growing steps, truncated, rewritten and slid as a tail window; at every step the incremental answer
 * must equal what `parseTranscript` / `parseActivity` make of the same text. The reference parsers are not touched by this change and do not
 * share the state machine, so a wrong anchor, a lost carry or a miscounted ring shows as a different answer, not as a passing echo.
 */
import { describe, expect, it } from 'vitest'

import { ENTRY_CAP, parseActivity, type Parsed } from '../hooks/data/wf-activity'
import { ActivityIncr } from '../hooks/data/wf-incr-activity'
import { FactsIncr } from '../hooks/data/wf-incr'
import { LINE_CAP, parseTranscript } from '../hooks/data/workflows'

/** mulberry32: small, seeded, the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0

    let t = a

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'Grep', 'NotebookEdit']
const WORDS = ['alpha', 'beta', 'ls -la', 'cargo test', 'sk-ant-abcdefghijklmnopqrstu', '\u001b[31mred\u001b[0m', 'café', '\u{1F600} grin', 'tab\there', '‮evil', 'line one\nline two', 'x'.repeat(40)]

/** The lines of one random transcript, as the strings that go between newlines. `calls` are the ids a later result may name. */
function linesOf(seed: number, count: number): string[] {
  const rand = rng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T
  const out: string[] = []
  const ids: string[] = []
  let t = Date.parse('2026-10-06T00:00:00.000Z')
  let msg = 0

  for (let i = 0; i < count; i++) {
    t += Math.floor(rand() * 2000)

    const at = rand() < 0.9 ? { timestamp: new Date(t).toISOString() } : {}
    const roll = rand()

    if (roll < 0.3) {
      // An assistant line: usage, text or thinking, tool calls; a streamed message repeats its id (and its calls) on several lines.
      const id = rand() < 0.4 && msg > 0 ? `m${msg}` : `m${++msg}`
      const content: unknown[] = []

      if (rand() < 0.6) content.push({ type: 'text', text: pick(WORDS) })
      if (rand() < 0.15) content.push({ type: 'thinking', thinking: pick(WORDS) })

      for (let k = Math.floor(rand() * 3); k > 0; k--) {
        const callId = rand() < 0.25 && ids.length > 0 ? pick(ids) : `t${ids.length}-${i}`
        const tool = pick(TOOLS)

        if (!ids.includes(callId)) ids.push(callId)

        content.push({ type: 'tool_use', id: callId, name: tool, input: tool === 'Bash' ? { command: pick(WORDS), description: 'run' } : { file_path: `/w/src/f${Math.floor(rand() * 12)}.ts` } })
      }

      const usage = rand() < 0.85 ? { input_tokens: Math.floor(rand() * 9), cache_creation_input_tokens: Math.floor(rand() * 500), cache_read_input_tokens: Math.floor(rand() * 90_000), output_tokens: Math.floor(rand() * 400) } : undefined

      out.push(JSON.stringify({ type: 'assistant', ...at, message: { ...(rand() < 0.9 && { id }), model: pick(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5']), role: 'assistant', content, ...(usage !== undefined && { usage }) } }))
    } else if (roll < 0.55) {
      // A user line carrying results: of a known call (early ones too), of an unknown id, an error, an empty one, an array of blocks.
      const target = rand() < 0.12 ? 'ghost-id' : ids.length > 0 ? pick(ids) : 'none'
      const content = rand() < 0.2 ? [{ type: 'text', text: pick(WORDS) }, { type: 'image' }] : rand() < 0.1 ? '' : pick(WORDS)

      out.push(JSON.stringify({ type: 'user', ...at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: target, content, ...(rand() < 0.2 && { is_error: true }) }] } }))
    } else if (roll < 0.68) out.push(JSON.stringify({ type: 'user', ...at, message: { role: 'user', content: pick(WORDS) } }))
    else if (roll < 0.74) out.push(JSON.stringify({ type: 'user', isMeta: true, ...at, message: { role: 'user', content: 'meta' } }))
    else if (roll < 0.8) out.push(JSON.stringify({ type: 'attachment', ...at }))
    else if (roll < 0.84) out.push('not json at all')
    else if (roll < 0.87) out.push('{"type":"user","message":{"content":"half')
    else if (roll < 0.9) out.push('[1,2,3]')
    else if (roll < 0.93) out.push('')
    else if (roll < 0.96) out.push(JSON.stringify({ type: 'summary', n: i }))
    else out.push(JSON.stringify({ type: 'user', ...at, message: { role: 'user', content: 'y'.repeat(7000) } }))
  }

  return out
}

/** The file text: lines joined by LF or CRLF, with or without a final newline. */
function textOf(lines: readonly string[], rand: () => number): string {
  const eol = rand() < 0.35 ? '\r\n' : '\n'
  const body = lines.join(eol)

  return rand() < 0.7 ? `${body}${eol}` : body
}

/** Increasing cut points, mostly small steps (a poll) and some big ones, at any character. */
function cuts(length: number, rand: () => number, step = 700): number[] {
  const out: number[] = []
  let at = 0

  while (at < length) {
    at = Math.min(length, at + 1 + Math.floor(rand() * (rand() < 0.2 ? step * 9 : step)))
    out.push(at)
  }

  return out
}

const factsOf = (text: string, isTail = false) => parseTranscript(text, isTail)

describe('incremental parsing equals the whole parse', () => {
  it.each(Array.from({ length: 24 }, (_, i) => i + 1))('seed %i: a whole text grown at random cut points, facts and activity at every step', seed => {
    const rand = rng(seed * 7919)
    const lines = linesOf(seed, 30 + Math.floor(rand() * 200))
    const text = textOf(lines, rand)
    const facts = new FactsIncr()
    const act = new ActivityIncr()
    let resumed = 0
    let fedTotal = 0
    let steps = 0

    for (const at of cuts(text.length, rand)) {
      const part = text.slice(0, at)
      const f = facts.update(part, false)
      const a = act.update(part, false)

      expect(f.value).toEqual(factsOf(part))
      expect(a.value).toEqual(parseActivity(part))

      steps += 1
      fedTotal += a.fed
      if (a.how === 'resumed') resumed += 1
    }

    // The point of it: most steps carried on from the last one, and the characters parsed in all stayed near the text's own length.
    expect(resumed).toBeGreaterThanOrEqual(Math.floor(steps / 2))
    // (a line cut mid-way is looked at again when it finishes: at most one line, about 7 KB here, per step)
    expect(fedTotal).toBeLessThan(text.length * 1.6 + steps * 7500)
  })

  it('beyond the entry ring: calls and their results that left it, dropped counts, re-indexed positions', () => {
    const rand = rng(99)
    const lines = linesOf(5, ENTRY_CAP * 2 + 400)
    const text = textOf(lines, rand)
    const act = new ActivityIncr()
    const facts = new FactsIncr()
    let last: Parsed | null = null

    for (const at of cuts(text.length, rand, text.length / 14)) {
      const part = text.slice(0, at)

      last = act.update(part, false).value
      expect(last).toEqual(parseActivity(part))
      expect(facts.update(part, false).value).toEqual(factsOf(part))
    }

    expect((last as Parsed).dropped).toBeGreaterThan(0)
    expect((last as Parsed).entries.length).toBe(ENTRY_CAP)
  })

  it('a result for a call that already left the ring is absorbed, not turned into a message', () => {
    const call = (id: string): string => JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] } })
    const filler = Array.from({ length: ENTRY_CAP + 50 }, (_, i) => JSON.stringify({ type: 'user', message: { content: `note ${i}` } }))
    const result = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'early', content: 'done' }] } })
    const head = `${[call('early'), ...filler].join('\n')}\n`
    const whole = `${head}${result}\n`
    const act = new ActivityIncr()

    act.update(head, false)

    const grown = act.update(whole, false)

    expect(grown.how).toBe('resumed')
    expect(grown.value).toEqual(parseActivity(whole))
    expect(grown.value.entries.some(entry => entry.kind === 'message' && entry.role === 'result')).toBe(false)
  })

  it('a text cut shorter, rewritten or replaced is parsed whole, and still equals the whole parse', () => {
    const rand = rng(31)
    const a = textOf(linesOf(1, 120), rand)
    const b = textOf(linesOf(2, 140), rand)
    const act = new ActivityIncr()
    const facts = new FactsIncr()
    const steps = [a, a.slice(0, Math.floor(a.length / 2)), a, `${a}${b}`, b, b.slice(0, 10), b, `${b.slice(0, 600)}X${b.slice(601)}`, '', a]
    const how: string[] = []

    for (const text of steps) {
      const r = act.update(text, false)

      how.push(r.how)
      expect(r.value).toEqual(parseActivity(text))
      expect(facts.update(text, false).value).toEqual(factsOf(text))
    }

    expect(how).toContain('fresh')
    expect(how).toContain('resumed')
  })

  it('an edit before the point already parsed is not carried over: in the first characters, or in the text just before it', () => {
    const line = (content: string): string => JSON.stringify({ type: 'user', message: { content } })
    const body = Array.from({ length: 70 }, (_, i) => line(`note ${i} ${'q'.repeat(80)}`))
    const a = `${[line('HEADHEAD'), ...body, line('TAILTAIL')].join('\n')}\n`
    const more = `${line('later')}\n`

    expect(a.length).toBeGreaterThan(6000)

    for (const edited of [a.replace('HEADHEAD', 'headhead'), a.replace('TAILTAIL', 'tailtail')]) {
      const act = new ActivityIncr()
      const facts = new FactsIncr()

      act.update(a, false)
      facts.update(a, false)

      const next = act.update(`${edited}${more}`, false)

      expect(next.how).toBe('fresh')
      expect(next.value).toEqual(parseActivity(`${edited}${more}`))
      expect(facts.update(`${edited}${more}`, false).value).toEqual(factsOf(`${edited}${more}`))
    }
  })

  it('an unfinished last line that is taken back leaves no trace: a result, a file, a skipped line, a message', () => {
    const call = JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { output_tokens: 3 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/a.ts' } }] } })
    const pending = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: true }] } }),
      JSON.stringify({ type: 'assistant', message: { id: 'm2', usage: { output_tokens: 9 }, content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/w/b.ts' } }, { type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'attachment' }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'late' }] } }),
    ]

    for (const last of pending) {
      const act = new ActivityIncr()
      const facts = new FactsIncr()
      const head = `${call}\n`
      const replaced = `${head}${JSON.stringify({ type: 'user', message: { content: 'something else' } })}\n`

      for (const text of [`${head}${last}`, replaced, `${head}${last}`, `${head}${last}\n`]) {
        expect(act.update(text, false).value).toEqual(parseActivity(text))
        expect(facts.update(text, false).value).toEqual(factsOf(text))
      }
    }
  })

  it('an unfinished last line that would push the ring over its cap still counts what it pushes out', () => {
    const line = (i: number): string => JSON.stringify({ type: 'user', message: { content: `note ${i}` } })
    const full = Array.from({ length: ENTRY_CAP + 5 }, (_, i) => line(i)).join('\n')
    const text = `${full}\n${line(9999)}`
    const act = new ActivityIncr()

    act.update(`${full}\n`, false)

    const grown = act.update(text, false)

    expect(grown.value).toEqual(parseActivity(text))
    expect(grown.value.dropped).toBe(6)
  })

  it('a text cut shorter than what was parsed is parsed whole', () => {
    const line = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(200) } })
    const a = `${Array.from({ length: 40 }, () => line).join('\n')}\n`
    const act = new ActivityIncr()

    act.update(a, false)

    const cut = act.update(a.slice(0, 3000), false)

    expect(cut.how).toBe('fresh')
    expect(cut.value).toEqual(parseActivity(a.slice(0, 3000)))
  })

  it('an unfinished last line is counted when it parses, and counted once when its newline arrives', () => {
    const a = JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 2 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } })
    const r = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })
    const act = new ActivityIncr()
    const facts = new FactsIncr()

    for (const text of [`${a}\n${r.slice(0, 20)}`, `${a}\n${r}`, `${a}\n${r}\n`, `${a}\n${r}\n${a}`, `${a}\n${r}\n${a}\n`]) {
      expect(act.update(text, false).value).toEqual(parseActivity(text))
      expect(facts.update(text, false).value).toEqual(factsOf(text))
    }
  })

  it('a line over the line cap is not read, by the reference and the incremental alike', () => {
    const big = JSON.stringify({ type: 'user', message: { content: 'z'.repeat(LINE_CAP + 10) } })
    const small = JSON.stringify({ type: 'user', message: { content: 'after' } })
    const text = `${small}\n${big}\n${small}\n`
    const act = new ActivityIncr()

    expect(act.update(text.slice(0, text.length - 5), false).value).toEqual(parseActivity(text.slice(0, text.length - 5)))
    expect(act.update(text, false).value).toEqual(parseActivity(text))
    expect(act.update(text, false).value.entries.length).toBe(2)
  })
})

describe('a tail window that slides over a growing file', () => {
  /** The reference for a state started in one window: the whole parse of the file from the first line that window held complete. */
  const refFrom = (file: string, windowStart: number): { text: string } => {
    const first = file.indexOf('\n', windowStart)

    return { text: first < 0 ? file.slice(windowStart) : file.slice(first + 1) }
  }

  it.each(Array.from({ length: 16 }, (_, i) => i + 1))('seed %i: windows of a growing file equal the whole parse from the first line of the first window', seed => {
    const rand = rng(seed * 104729)
    const file = textOf(linesOf(seed + 500, 150 + Math.floor(rand() * 250)), rand)
    const win = 1500 + Math.floor(rand() * 9000)
    const act = new ActivityIncr()
    const facts = new FactsIncr()
    let start = 0
    let resumed = 0
    let steps = 0

    for (const at of cuts(file.length, rand)) {
      const from = Math.max(0, at - win)
      const part = file.slice(from, at)
      const a = act.update(part, true, String(at))
      const f = facts.update(part, true, String(at))
      void f

      // A fresh start anchors the reference at this window; a resumed one keeps the anchor of the window it began in.
      if (a.how === 'fresh') start = from

      const ref = refFrom(file.slice(0, at), start).text
      const whole = file.slice(0, at).indexOf('\n', start) < 0

      if (!whole) {
        expect(a.value).toEqual({ ...parseActivity(ref, false), isTail: true })
      }

      steps += 1
      if (a.how === 'resumed') resumed += 1
    }

    expect(resumed).toBeGreaterThan(0)
    expect(steps).toBeGreaterThan(1)
  })

  it('facts: a tail state agrees with the whole parse of the file from its anchor', () => {
    const rand = rng(8)
    const file = textOf(linesOf(77, 300), rand)
    const facts = new FactsIncr()
    let start = 0

    for (const at of cuts(file.length, rand)) {
      const from = Math.max(0, at - 6000)
      const part = file.slice(from, at)
      const f = facts.update(part, true, String(at))

      if (f.how === 'fresh') start = from

      const first = file.slice(0, at).indexOf('\n', start)

      if (first >= 0) expect(f.value).toEqual(parseTranscript(file.slice(first + 1, at), false))
    }
  })

  it('a window that slid past the anchor is parsed whole, never guessed', () => {
    const file = textOf(linesOf(3, 300), rng(3))
    const act = new ActivityIncr()

    act.update(file.slice(0, 5000), true)

    const far = act.update(file.slice(file.length - 5000), true)

    expect(far.how).toBe('fresh')
  })

  it('an ambiguous anchor (the same text twice in the window) is parsed whole', () => {
    const line = `${JSON.stringify({ type: 'user', message: { content: 'same'.repeat(300) } })}\n`
    const text = `torn start\n${line.repeat(8)}`
    const act = new ActivityIncr()

    act.update(text, true)

    expect(act.update(`${text}${line}`, true).how).toBe('fresh')
  })
})

describe('through the readers', () => {
  const T = Date.parse('2026-10-06T01:30:00.000Z')
  const assistant = (n: number): string => JSON.stringify({ type: 'assistant', timestamp: new Date(T + n * 1000).toISOString(), message: { id: `g${n}`, model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: `step ${n}` }, { type: 'tool_use', id: `u${n}`, name: 'Bash', input: { command: `echo ${n}` } }], usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000 + n, output_tokens: 5 } } })

  it('a transcript that grew between two refreshes: the agent figures and the parsed activity equal a whole parse, and the second parse read only the new lines', async () => {
    const { readWorkflowRuns } = await import('../hooks/data/workflows-read')
    const { parsedOf, resetDrillIo } = await import('../hooks/data/wf-drill-io')
    const { parsedStats } = await import('../hooks/data/wf-incr-store')
    const world = await import('./fixtures/wf-drill-world')

    resetDrillIo()

    const path = `${world.RUN}/agent-a1.jsonl`
    const files = world.liveFiles({ [path]: `${Array.from({ length: 400 }, (_, i) => assistant(i)).join('\n')}\n` })
    const cache = new Map()
    const read = () => readWorkflowRuns(world.memoryFs(files), cache, { configDir: world.CONFIG, cwd: '/work/proj', nowMs: world.NOW })
    const first = await read()
    const agent = () => first.runs[0]?.phases.flatMap(p => p.agents).find(a => a.id === 'a1') as NonNullable<(typeof first.runs)[0]>['phases'][0]['agents'][0]

    expect(parsedOf(cache, agent())).toEqual(parseActivity(files[path] as string))

    const before = parsedStats()

    files[path] = `${files[path]}${assistant(400)}\n${assistant(401)}\n`

    const grown = await read()
    const grownAgent = grown.runs[0]?.phases.flatMap(p => p.agents).find(a => a.id === 'a1')

    expect(grownAgent).toMatchObject({ tokens: 1 + 10 + 1401 + 5, toolCalls: 402 })
    expect(parseTranscript(files[path] as string)).toMatchObject({ tokens: grownAgent?.tokens, toolCalls: grownAgent?.toolCalls })
    expect(parsedOf(cache, agent())).toEqual(parseActivity(files[path] as string))

    const after = parsedStats()

    // Two refreshes' worth of new lines were parsed for the activity (by the warm-up), not the 400 before them.
    expect(after.resumed).toBeGreaterThan(before.resumed)
    expect(after.fed - before.fed).toBeLessThan((files[path] as string).length / 10)
  })
  it('a tail-read transcript that grew: the facts are those of the whole text from the first complete line of the first window', async () => {
    const { readWorkflowRuns, TRANSCRIPT_CAP } = await import('../hooks/data/workflows-read')
    const { resetDrillIo } = await import('../hooks/data/wf-drill-io')
    const world = await import('./fixtures/wf-drill-world')

    resetDrillIo()

    const path = `${world.RUN}/agent-a1.jsonl`
    const lines = Array.from({ length: 500 }, (_, i) => assistant(i))
    const files = world.liveFiles()
    const textTo = (n: number): string => `${lines.slice(0, n).join('\n')}\n`
    const window = (text: string): string => text.slice(Math.max(0, text.length - 9000))
    const cache = new Map()
    const seen: { tokens?: number; toolCalls?: number }[] = []
    let first = ''

    for (let n = 200; n <= 424; n += 8) {
      files[path] = textTo(n)

      const size = TRANSCRIPT_CAP + files[path].length
      const mem = world.memoryFs(files, { size: { [path]: size } })
      const fs = { ...mem, list: async (dir: string) => (await mem.list(dir)).map(e => (`${dir}/${e.name}` === path ? { ...e, size } : e)), readTail: async () => window(files[path] as string) }
      const found = await readWorkflowRuns(fs, cache, { configDir: world.CONFIG, cwd: '/work/proj', nowMs: world.NOW })
      const agent = found.runs[0]?.phases.flatMap(p => p.agents).find(a => a.id === 'a1')

      if (first === '') first = window(files[path] as string)

      seen.push({ ...(agent?.tokens !== undefined && { tokens: agent.tokens }), ...(agent?.toolCalls !== undefined && { toolCalls: agent.toolCalls }) })
    }

    // Every window slid forward by less than itself, so the state carried on from the first: it knows every call since that window's first line.
    const startOfFirst = textTo(200).length - first.length
    const from = textTo(424).indexOf('\n', startOfFirst) + 1
    const reference = parseTranscript(textTo(424).slice(from))

    expect(seen.at(-1)).toMatchObject({ tokens: reference.tokens, toolCalls: reference.toolCalls })
  })
})
