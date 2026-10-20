// @ts-check
/**
 * ADR-458..466 benchmark: the Workflows page under load. Plain node, no fixtures on disk: every input is generated here with the shapes
 * Claude Code writes, and every page is drawn through the REAL page and slots into a recording kit (the same stand-in the other benches
 * use; the engine's own layout is not in it). Median and p99 per case, bytes allocated per call (heapUsed delta after gc(); needs
 * NODE_OPTIONS=--expose-gc, else n/a), and a digest of what the case computed so a BEFORE and an AFTER run can be compared for the same
 * ANSWER, not only the same speed.
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-workflows.mjs [--check] [--quick]
 * `--check` exits 1 when a case misses its budget (BUDGET_MS); `--quick` skips the 50 MB cases.
 * Cases: transcript parse at 1 / 3 / 5 / 50 MB; the folder reader at 1 / 20 / 200 runs on disk (cold, refreshed unchanged, one agent grown)
 * and with 5 MB / 50 MB transcripts (tail reads); a whole refresh with the page open and closed; the page frame (what one draw costs)
 * at 1 / 20 / 200 runs and with the drill open; search across every parsed transcript; a replay step; a conversation thread fed 1000 messages.
 * ADR-473 adds: 50 lines appended to a 3 MB / 5 MB / 50 MB transcript (the whole parse against the incremental one, with the answers compared), a 200-run
 * refresh in which one 2.4 MB transcript grew, and the first draw of a typed search with a cold and with a warmed parse memo. The incremental cases
 * need hooks/data/wf-incr*.ts and are skipped (printed as absent) where those do not exist, so the same script can be run on the code before.
 */
import { newState } from '../hooks/state.ts'
import { parseActivity } from '../hooks/data/wf-activity.ts'
import { allRuns, pick } from '../hooks/data/workflows-nav.ts'
import { buildTimeline, boardAt, newReplay, stepReplay } from '../hooks/data/wf-replay.ts'
import { search } from '../hooks/data/wf-search.ts'
import { addMessage, newConvo } from '../hooks/data/wf-convo.ts'
import { parseTranscript } from '../hooks/data/workflows.ts'
import { readWorkflowRuns, slugOf, TAIL_BYTES } from '../hooks/data/workflows-read.ts'
import { bindDrill, loadTranscript, parsedOf, resetDrillIo } from '../hooks/data/wf-drill-io.ts'
import { workflowsActions } from '../hooks/wf-actions.ts'
import { refreshWorkflows, workflowsModelOf } from '../hooks/wf-live.ts'
import { conversationRows } from '../hooks/views/wf-convo.ts'
import { liveOf, wireConvo } from '../hooks/wf-convo-live.ts'
import { workflowsPage } from '../hooks/views/wf-page.ts'
import { resetSlots, slotsFor } from '../hooks/views/wf-slots.ts'
import { registerDrill, setQuery } from '../hooks/views/wf-detail.ts'
import { registerSearch } from '../hooks/views/wf-search.ts'
import { sha256 } from '../hooks/data/ap-envelope.ts'
import { parsedStats } from '../hooks/data/wf-drill-io.ts'

/** The incremental parsers, where this tree has them. */
const incr = await Promise.all([import('../hooks/data/wf-incr.ts'), import('../hooks/data/wf-incr-activity.ts')]).then(([a, b]) => ({ FactsIncr: a.FactsIncr, ActivityIncr: b.ActivityIncr })).catch(() => null)

const QUICK = process.argv.includes('--quick')
const CHECK = process.argv.includes('--check')
/** `--only parse,frame` runs those sections only (parse, reader, tail, refresh, frame, drill, search, replay, convo). */
const ONLY = process.argv.includes('--only') ? (process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',') : null
/** `--iters N` overrides the iteration count of the frame cases (for a profile that the frame, not the set-up, dominates). */
const ITERS = process.argv.includes('--iters') ? Number(process.argv[process.argv.indexOf('--iters') + 1]) || 0 : 0
const want = (/** @type {string} */ name) => ONLY === null || ONLY.includes(name)
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6
const NOW = Date.parse('2026-10-06T02:00:00.000Z')
const iso = (/** @type {number} */ s) => new Date(NOW - 3_600_000 + s * 1000).toISOString()
const failed = /** @type {string[]} */ ([])
const digest = (/** @type {unknown} */ value) => sha256(JSON.stringify(value) ?? 'undefined').slice(0, 12)

/** What one draw of the page, or one timer refresh, may cost in this stand-in (ms, median): a terminal frame is ~16 ms and the page shares it with everything else. */
const BUDGET_MS = /** @type {Record<string, number>} */ ({
  'frame: page, 200 runs on disk': 6,
  'frame: page, drill open on an agent': 8,
  'frame: page, search query active': 8,
  'frame: conversation, 1000 messages': 3,
  'refresh: page closed': 0.05,
  'refresh: page open, nothing changed': 60,
  'search: miss over 360 transcripts': 120,
  'search: hit': 120,
  'replay: boardAt, 2000 agents': 12,
  // ADR-473: what one refresh may spend on a transcript that grew by 50 lines, whole file or tail window (one frame is ~16 ms).
  'append 50 lines onto 3 MB, activity: incremental': 8,
  'append 50 lines onto 3 MB, facts: incremental': 5,
  'append 50 lines onto 5 MB (400 KB tail), activity: incremental': 8,
  'append 50 lines onto 50 MB (400 KB tail), activity: incremental': 8,
  'reader 200 runs, 2.4 MB transcripts: refresh, 50 lines appended to one': 40,
  'search typed: first draw, project that fits (memo warmed)': 16,
  'refresh: warm-up tick (cold memo), slowest of 100': 60,
})
const BUDGET_P99_MS = 16

/** @type {(name: string, fn: () => unknown, iterations?: number, show?: (out: unknown) => string) => unknown} */
function bench(name, fn, iterations = 15, show = out => digest(out)) {
  let out = fn()

  for (let i = 0; i < 2; i++) out = fn()

  const times = []

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()

    out = fn()
    times.push(ms(start))
  }

  return report(name, times, out, show, () => void fn())
}

/** @type {(name: string, fn: () => Promise<unknown>, iterations?: number, show?: (out: unknown) => string) => Promise<unknown>} */
async function benchAsync(name, fn, iterations = 10, show = out => digest(out)) {
  let out = await fn()

  for (let i = 0; i < 1; i++) out = await fn()

  const times = []

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()

    out = await fn()
    times.push(ms(start))
  }

  return report(name, times, out, show, null, fn)
}

/** @type {(name: string, times: number[], out: unknown, show: (out: unknown) => string, sync: (() => void) | null, async?: () => Promise<unknown>) => Promise<unknown> | unknown} */
function report(name, times, out, show, sync, async) {
  times.sort((a, b) => a - b)

  const median = times[Math.floor(times.length / 2)] ?? 0
  const p99 = times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0
  const budget = BUDGET_MS[name]
  const over = budget !== undefined && (median > budget || p99 > Math.max(BUDGET_P99_MS, budget * 3))
  const line = (/** @type {string} */ bytes) => {
    if (over) failed.push(`${name}: median ${median.toFixed(3)} ms (budget ${budget}), p99 ${p99.toFixed(3)} ms`)

    console.log(`${name.padEnd(46)} median ${median.toFixed(3).padStart(10)} ms · p99 ${p99.toFixed(3).padStart(10)} ms · alloc/call ${bytes.padStart(10)} · digest ${show(out)}${over ? ' · OVER BUDGET' : ''}`)

    return out
  }

  if (gc === undefined) return line('n/a')

  gc()

  const before = process.memoryUsage().heapUsed

  if (sync !== null) {
    for (let i = 0; i < 3; i++) sync()

    return line(`~${Math.round(Math.max(0, process.memoryUsage().heapUsed - before) / 3 / 1024)} KiB`)
  }

  return (async () => {
    for (let i = 0; i < 3; i++) await /** @type {() => Promise<unknown>} */ (async)()

    return line(`~${Math.round(Math.max(0, process.memoryUsage().heapUsed - before) / 3 / 1024)} KiB`)
  })()
}

// ---------------------------------------------------------------------------------------------------------- generated inputs

/** A transcript of about `bytes` characters: user/assistant turns, tool calls paired with results, streamed duplicates, the way Claude Code writes them. */
function transcriptOfBytes(/** @type {number} */ bytes, /** @type {number} */ salt = 0) {
  const out = /** @type {string[]} */ ([JSON.stringify({ type: 'user', timestamp: iso(0), message: { role: 'user', content: `task ${salt}` } })])
  let size = out[0]?.length ?? 0
  let i = 0

  while (size < bytes) {
    i += 1

    const usage = { input_tokens: 2, cache_creation_input_tokens: 500, cache_read_input_tokens: 100_000 + i, output_tokens: 50 }
    const call = { type: 'assistant', timestamp: iso(i), message: { id: `m${salt}-${i}`, model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: `step ${i}: look at the parser and run the tests` }, { type: 'tool_use', id: `t${salt}-${i}`, name: i % 3 ? 'Bash' : 'Read', input: i % 3 ? { command: `cargo test --lib module_${i % 40}`, description: 'run' } : { file_path: `/work/proj/src/mod_${i % 90}.ts` } }], usage } }
    const back = { type: 'user', timestamp: iso(i + 0.5), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${salt}-${i}`, content: `ok ${'line of output '.repeat(6 + (i % 9))}` }] } }

    for (const entry of [call, call, back]) {
      const text = JSON.stringify(entry)

      out.push(text)
      size += text.length + 1
    }
  }

  return `${out.join('\n')}\n`
}

const PHASES = ['Build', 'Tune', 'Review', 'Ship']
const journalOf = (/** @type {number} */ agents) => [JSON.stringify({ type: 'launched' }), ...Array.from({ length: agents }, (_, i) => JSON.stringify({ type: 'started', key: `v2:a${i}`, agentId: `a${i}`, label: `agent ${i}`, phase: PHASES[i % 4] }))].join('\n') + '\n'
const CONFIG = '/home/u/.claude'
const CWD = '/work/proj'
const ROOT = `${CONFIG}/projects/${slugOf(CWD)}`
const SESSION = '11111111-2222-3333-4444-555555555555'

/** A run on a recorded disk: the newest `heavy` runs carry `agents` transcripts of `bytes` each, the rest only a journal and tiny agent files. */
function disk(/** @type {{ runs: number; heavy: number; agents: number; bytes: number; sizeOf?: number }} */ o) {
  /** @type {Map<string, { text: string; mtimeMs: number; size: number }>} */
  const files = new Map()
  /** @type {Map<string, Map<string, boolean>>} */
  const index = new Map()
  const transcripts = new Map(Array.from({ length: Math.min(o.agents, 8) }, (_, k) => [k, transcriptOfBytes(o.bytes, k)]))
  const put = (/** @type {string} */ path, /** @type {string} */ text, /** @type {number} */ mtimeMs, /** @type {number} */ size = text.length) => {
    files.set(path, { text, mtimeMs, size })

    const parts = path.split('/')

    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/') || '/'
      const kids = index.get(parent) ?? new Map()

      kids.set(/** @type {string} */ (parts[i]), i === parts.length - 1)
      index.set(parent, kids)
    }
  }

  for (let r = 0; r < o.runs; r++) {
    const heavy = r < o.heavy
    const n = heavy ? o.agents : 3
    const dir = `${ROOT}/${SESSION}/subagents/workflows/wf_r${String(r).padStart(3, '0')}`
    const mtime = NOW - r * 60_000

    put(`${dir}/journal.jsonl`, journalOf(n), mtime)

    for (let a = 0; a < n; a++) {
      put(`${dir}/agent-a${a}.meta.json`, JSON.stringify({ description: `agent ${a}`, workflowPhase: PHASES[a % 4] }), mtime)
      put(`${dir}/agent-a${a}.jsonl`, heavy ? (transcripts.get(a % 8) ?? '') : '{"type":"user","message":{"content":"x"}}\n', mtime, heavy && o.sizeOf !== undefined ? o.sizeOf : undefined)
    }
  }

  const tail = transcriptOfBytes(TAIL_BYTES, 99)
  const fs = {
    reads: { read: 0, tail: 0 },
    read: async (/** @type {string} */ path) => (fs.reads.read++, files.get(path)?.text ?? Promise.reject(new Error('ENOENT'))),
    stat: async (/** @type {string} */ path) => {
      const held = files.get(path)

      return held !== undefined ? { mtimeMs: held.mtimeMs, size: held.size, kind: 'file' } : index.has(path) ? { mtimeMs: NOW, kind: 'directory' } : Promise.reject(new Error('ENOENT'))
    },
    list: async (/** @type {string} */ path) => [...(index.get(path.replace(/\/+$/, '')) ?? new Map()).entries()].map(([name, isFile]) => ({ name, kind: isFile ? 'file' : 'dir', mtimeMs: files.get(`${path.replace(/\/+$/, '')}/${name}`)?.mtimeMs ?? NOW - 1000, size: files.get(`${path.replace(/\/+$/, '')}/${name}`)?.size ?? 0 })),
    readTail: async (/** @type {string} */ _path, /** @type {number} */ _bytes) => (fs.reads.tail++, tail),
  }

  return { fs, files, append: (/** @type {string} */ path, /** @type {string} */ more) => { const held = files.get(path); if (held !== undefined) files.set(path, { text: `${held.text}${more}`, mtimeMs: held.mtimeMs + 1000, size: held.size + more.length }) }, grow: (/** @type {string} */ path) => { const held = files.get(path); if (held !== undefined) files.set(path, { text: `${held.text}${JSON.stringify({ type: 'user', message: { content: 'more' } })}\n`, mtimeMs: held.mtimeMs + 1000, size: held.size + 50 }) } }
}

const summary = (/** @type {import('../hooks/data/workflows.ts').WfRun[]} */ runs) => runs.map(run => [run.id, run.state, run.total, run.done, run.running, run.totalTokens, run.phases.map(p => p.agents.map(a => [a.id, a.state, a.tokens, a.toolCalls, a.lastTool]))])

// ---------------------------------------------------------------------------------------------------------- a recording kit and a page
const element = (/** @type {string} */ kind) => (/** @type {Record<string, unknown>} */ props) => ({ kind, props })
const kit = /** @type {never} */ ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input'), Raster: element('Raster') })
const noop = () => undefined
const countOf = (/** @type {unknown} */ node) => {
  let n = 0
  const walk = (/** @type {unknown} */ value) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (typeof value === 'object' && value !== null) {
      n += 1
      walk(/** @type {{props?: {children?: unknown}}} */ (value).props?.children)
    }
  }

  walk(node)

  return n
}

function hostOver(/** @type {ReturnType<typeof disk>['fs']} */ fs) {
  return /** @type {never} */ ({ fs, invalidate: noop, run: async () => ({ exitCode: 1, stdout: '' }), every: noop, toast: noop, home: async () => '/home/u' })
}

async function worldOf(/** @type {ReturnType<typeof disk>} */ d) {
  const state = newState({})
  const host = hostOver(d.fs)

  state.view = 'workflows'
  state.configDir = CONFIG
  state.cwd = CWD
  state.isInteractive = false
  wireConvo(state, host)
  await refreshWorkflows(state, host, true, NOW)

  return { state, host }
}

function frameOf(/** @type {Awaited<ReturnType<typeof worldOf>>} */ world, columns = 110) {
  const act = /** @type {never} */ ({ workflows: workflowsActions(world.state, world.host, /** @type {never} */ ({ ask: noop })), focus: noop, view: noop })
  const ctx = /** @type {never} */ ({ kit, state: world.state, nowMs: NOW, columns, pictures: new Map(), act })

  return { ctx, tree: () => workflowsPage(ctx) }
}

// ---------------------------------------------------------------------------------------------------------- run
console.log(`node ${process.version} · 110 columns · ${QUICK ? 'quick (no 50 MB)' : 'full'}`)

// 1. Transcript parse, linear in the text. The product reads a transcript whole up to 3 MB and tails 400 KB past that; bigger sizes are the stress the parsers must survive.
console.log('\n# transcript parse')

for (const mb of want('parse') ? (QUICK ? [1, 3, 5] : [1, 3, 5, 50]) : []) {
  const text = transcriptOfBytes(mb * 1_000_000)
  const runs = mb >= 50 ? 1 : 5

  bench(`parseTranscript ${mb} MB`, () => parseTranscript(text), runs)
  bench(`parseActivity ${mb} MB`, () => { const p = parseActivity(text); return [p.entries.length, p.calls.length, p.dropped, p.files.length] }, runs)
}

// 1b. Append: 50 lines onto a transcript that already has megabytes (ADR-473). The reference (whole parse) and the incremental parse see the same texts in the same order.
console.log('\n# append: 50 lines onto an existing transcript')

/** @type {(name: string, times: number[], note: string) => void} */
function seriesReport(name, times, note) {
  times.sort((a, b) => a - b)

  const median = times[Math.floor(times.length / 2)] ?? 0
  const p99 = times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0
  const budget = BUDGET_MS[name]
  const over = budget !== undefined && (median > budget || p99 > Math.max(BUDGET_P99_MS, budget * 3))

  if (over) failed.push(name + ': median ' + median.toFixed(3) + ' ms (budget ' + budget + '), p99 ' + p99.toFixed(3) + ' ms')

  console.log(name.padEnd(64) + ' median ' + median.toFixed(3).padStart(9) + ' ms · p99 ' + p99.toFixed(3).padStart(9) + ' ms · ' + note + (over ? ' · OVER BUDGET' : ''))
}

/** 50 more lines in the shapes Claude Code writes, with ids no earlier batch used. */
const batchOf = (/** @type {number} */ k) => transcriptOfBytes(30_000, 7000 + k).split('\n').slice(0, 50).join('\n') + '\n'
const ROUNDS = 14

for (const mb of want('append') ? (QUICK ? [3, 5] : [3, 5, 50]) : []) {
  const base = transcriptOfBytes(mb * 1_000_000, 1)
  const isTail = mb > 3
  const batches = Array.from({ length: ROUNDS }, (_, k) => batchOf(k))
  /** Each step's text: the whole file (3 MB, read whole) or its last 400 KB (read past the cap), flattened before timing. */
  const whole = /** @type {string[]} */ ([])
  let file = base

  for (const batch of batches) {
    file += batch
    whole.push(isTail ? file.slice(file.length - TAIL_BYTES) : file.slice(0))
    whole[whole.length - 1]?.charCodeAt(0)
  }

  const first = isTail ? base.slice(base.length - TAIL_BYTES) : base
  const where = isTail ? mb + ' MB (400 KB tail)' : mb + ' MB'
  const refA = whole.map((text, i) => ({ text, i }))

  // The reference: what a refresh used to do for every changed transcript, the whole text (the window, for a tail).
  const refAct = /** @type {unknown[]} */ ([])
  const refFacts = /** @type {unknown[]} */ ([])
  const tA = /** @type {number[]} */ ([])
  const tF = /** @type {number[]} */ ([])

  for (const { text } of refA) {
    let t = process.hrtime.bigint()

    refAct.push(parseActivity(text, isTail))
    tA.push(ms(t))
    t = process.hrtime.bigint()
    refFacts.push(parseTranscript(text, isTail))
    tF.push(ms(t))
  }

  seriesReport('append 50 lines onto ' + where + ', activity: whole parse', tA, 'parsed ' + (whole[0]?.length ?? 0) + ' chars each')
  seriesReport('append 50 lines onto ' + where + ', facts: whole parse', tF, 'parsed ' + (whole[0]?.length ?? 0) + ' chars each')

  if (incr === null) {
    console.log('(incremental parsers not in this tree)')
    continue
  }

  const act = new incr.ActivityIncr()
  const facts = new incr.FactsIncr()
  const iA = /** @type {number[]} */ ([])
  const iF = /** @type {number[]} */ ([])
  const fed = /** @type {number[]} */ ([])
  const outA = /** @type {unknown[]} */ ([])
  const outF = /** @type {unknown[]} */ ([])

  act.update(first, isTail, '0')
  facts.update(first, isTail, '0')

  for (const [i, text] of whole.entries()) {
    let t = process.hrtime.bigint()
    const a = act.update(text, isTail, String(i + 1))

    iA.push(ms(t))
    fed.push(a.fed)
    outA.push(a.value)
    t = process.hrtime.bigint()
    outF.push(facts.update(text, isTail, String(i + 1)).value)
    iF.push(ms(t))
  }

  const fedMedian = [...fed].sort((a, b) => a - b)[Math.floor(fed.length / 2)] ?? 0
  const sameA = isTail ? 'n/a (tail: compared once below)' : outA.every((v, i) => digest(v) === digest(refAct[i])) ? 'answers identical' : 'ANSWERS DIFFER'
  const sameF = isTail ? 'n/a (tail: compared once below)' : outF.every((v, i) => digest(v) === digest(refFacts[i])) ? 'answers identical' : 'ANSWERS DIFFER'

  if (sameA === 'ANSWERS DIFFER' || sameF === 'ANSWERS DIFFER') failed.push('append ' + where + ': incremental answer differs from the whole parse')

  seriesReport('append 50 lines onto ' + where + ', activity: incremental', iA, 'parsed ' + fedMedian + ' chars · ' + sameA)
  seriesReport('append 50 lines onto ' + where + ', facts: incremental', iF, sameF)

  if (isTail) {
    // A tail state carries the history of every window since it began, so it is compared with the whole parse of the file from its first complete line.
    const from = base.indexOf('\n', base.length - TAIL_BYTES) + 1
    const reference = parseActivity(file.slice(from), false)
    const got = /** @type {import('../hooks/data/wf-activity.ts').Parsed} */ (outA.at(-1))
    const same = digest({ ...reference, isTail: true }) === digest(got)

    console.log(''.padEnd(64) + ' tail state vs whole parse of the file from its anchor: ' + (same ? 'identical' : 'DIFFER'))

    if (!same) failed.push('append ' + where + ': the tail state differs from the whole parse from its anchor')
  }
}

// 2. The folder reader.
console.log('\n# folder reader (6 runs read, however many are on disk)')

for (const runs of want('reader') ? [1, 20, 200] : []) {
  const d = disk({ runs, heavy: 6, agents: 30, bytes: 60_000 })
  const cache = new Map()
  const opts = { configDir: CONFIG, cwd: CWD, nowMs: NOW }
  const read = () => readWorkflowRuns(/** @type {never} */ (d.fs), cache, opts)
  const start = process.hrtime.bigint()
  const first = await read()

  console.log(`${`reader ${runs} runs: first read (cold)`.padEnd(46)} ${ms(start).toFixed(1).padStart(10)} ms · ${first.runs.length} runs · ${first.runs[0]?.total ?? 0} agents a run · fs reads ${d.fs.reads.read}`)
  await benchAsync(`reader ${runs} runs: refresh, unchanged`, async () => summary((await read()).runs), 12)

  const victim = `${ROOT}/${SESSION}/subagents/workflows/wf_r000/agent-a0.jsonl`

  await benchAsync(`reader ${runs} runs: refresh, one agent grew`, async () => { d.grow(victim); return summary((await read()).runs) }, 12, () => 'n/a (grows)')
}

if (want('reader') && !QUICK) {
  // 200 runs on disk, the newest 6 with 8 transcripts of 2.4 MB (read whole): a refresh in which one of them grew by 50 lines.
  const d = disk({ runs: 200, heavy: 6, agents: 8, bytes: 2_400_000 })
  const cache = new Map()
  const opts = { configDir: CONFIG, cwd: CWD, nowMs: NOW }
  const read = () => readWorkflowRuns(/** @type {never} */ (d.fs), cache, opts)
  const victim = ROOT + '/' + SESSION + '/subagents/workflows/wf_r000/agent-a0.jsonl'
  let k = 0

  const start = process.hrtime.bigint()

  await read()
  console.log('reader 200 runs, 2.4 MB transcripts: first read (cold)'.padEnd(46) + ' ' + ms(start).toFixed(1).padStart(10) + ' ms')
  // The first refreshes after a page opens also parse ahead for the drill and its search (a small allowance each); measure once that has settled.
  const settle = process.hrtime.bigint()

  for (let i = 0; i < 70; i++) await read()
  console.log('reader 200 runs, 2.4 MB transcripts: 70 refreshes to settle'.padEnd(46) + ' ' + ms(settle).toFixed(1).padStart(10) + ' ms in all')
  await benchAsync('reader 200 runs, 2.4 MB transcripts: refresh, unchanged', async () => summary((await read()).runs), 12)
  await benchAsync('reader 200 runs, 2.4 MB transcripts: refresh, 50 lines appended to one', async () => { d.append(victim, batchOf(100 + k++)); return summary((await read()).runs) }, 12, () => 'n/a (grows)')
}

console.log('\n# folder reader, transcripts over the read cap (tail reads)')

for (const mb of want('tail') ? (QUICK ? [5] : [5, 50]) : []) {
  const d = disk({ runs: 6, heavy: 6, agents: 60, bytes: 2000, sizeOf: mb * 1_000_000 })
  const cache = new Map()
  const opts = { configDir: CONFIG, cwd: CWD, nowMs: NOW }
  const read = () => readWorkflowRuns(/** @type {never} */ (d.fs), cache, opts)

  await read()
  d.fs.reads.tail = 0
  await read()

  const tailReads = d.fs.reads.tail

  await benchAsync(`reader ${mb} MB x 360 agents: refresh, unchanged`, async () => summary((await read()).runs), 8)
  console.log(`${' '.repeat(46)} tail reads per refresh: ${tailReads} (each ${TAIL_BYTES / 1000} KB)`)
}

// 3. A whole refresh, open and closed.
console.log('\n# refresh through the page (clean + notices + after-read hooks)')

if (want('refresh')) {
  const d = disk({ runs: 20, heavy: 6, agents: 60, bytes: 60_000 })
  const world = await worldOf(d)
  const { state, host } = world
  let t = NOW

  for (let i = 0; i < 40; i++) await refreshWorkflows(state, host, true, (t += 1000))

  await benchAsync('refresh: page open, nothing changed', async () => { await refreshWorkflows(state, host, true, (t += 1000)); return summary(state.wf.read?.runs ?? []) }, 12)

  state.view = 'overview'
  await benchAsync('refresh: page closed', async () => { await refreshWorkflows(state, host, true, (t += 1000)); return 'closed' }, 200, () => 'closed')
  state.view = 'workflows'
}

// 4. The page frame.
console.log('\n# page frame (what one draw costs)')

for (const runs of want('frame') ? [1, 20, 200] : []) {
  resetSlots()
  registerDrill()
  registerSearch()

  const world = await worldOf(disk({ runs, heavy: Math.min(6, runs), agents: 60, bytes: 20_000 }))
  const frame = frameOf(world)

  bench(`frame: page, ${runs === 200 ? '200 runs on disk' : `${runs} run${runs === 1 ? '' : 's'}`}`, () => countOf(frame.tree()), ITERS || 40, out => String(out))
}

if (want('drill')) {
  resetSlots()
  resetDrillIo()
  registerDrill()
  registerSearch()

  const world = await worldOf(disk({ runs: 6, heavy: 6, agents: 60, bytes: 400_000 }))

  bindDrill(world.state, /** @type {never} */ ({ fs: world.host.fs, run: world.host.run, invalidate: noop }))

  const model = workflowsModelOf(world.state, NOW)
  const here = pick(world.state.wf.ui, model?.runs ?? [])

  if (here.agent === null) throw new Error('no agent to open')

  await loadTranscript(here.agent)
  world.state.wf.ui = { ...here.ui, isInspecting: true }

  const frame = frameOf(world)
  const parsed = parsedOf(world.state.cache, here.agent)
  const find = (/** @type {unknown} */ node, /** @type {string} */ key, /** @type {unknown[]} */ out = []) => {
    if (Array.isArray(node)) node.forEach(child => find(child, key, out))
    else if (typeof node === 'object' && node !== null) {
      if (/** @type {{props?: {key?: string}}} */ (node).props?.key === key) out.push(node)
      find(/** @type {{props?: {children?: unknown}}} */ (node).props?.children, key, out)
    }

    return out
  }
  const envNow = () => {
    const m = workflowsModelOf(world.state, NOW)
    const h = pick(world.state.wf.ui, m?.runs ?? [])

    return /** @type {never} */ ({ ctx: frame.ctx, runs: m?.runs ?? [], run: h.run, phase: h.phase, agent: h.agent, ui: h.ui, nowMs: NOW })
  }
  const press = (/** @type {string} */ verb) => void slotsFor('key').find(slot => slot.id === `drill-${verb}`)?.run(envNow())

  // Open the drill and walk it down to the agent's Activity, as a person does (the same presses tests/wf-drill-search.spec.ts makes).
  const open = find(frame.tree(), 'wf-drill-open')[0]

  if (open === undefined) throw new Error('the drill has no open button')

  ;/** @type {{props: {onPress: () => void}}} */ (open).props.onPress()
  press('in')
  press('in')

  console.log(`${' '.repeat(46)} agent transcript: ${parsed?.entries.length ?? 0} entries kept (${parsed?.dropped ?? 0} older dropped)`)
  bench('frame: page, drill open on an agent', () => countOf(frame.tree()), ITERS || 40, out => String(out))

  // A query typed in the search box: every frame asks for the search of all 360 transcripts. The first draw parses them (the memo is empty: a person typed
  // before any refresh parsed ahead); after it, a frame must not. Then the same with the memo warmed by 100 refresh ticks (5 minutes of a page left open at the 3 s refresh).
  const rebind = () => {
    resetDrillIo()
    bindDrill(world.state, /** @type {never} */ ({ fs: world.host.fs, run: world.host.run, invalidate: noop }))
  }

  rebind()

  const typed = process.hrtime.bigint()

  setQuery(envNow(), 'module_7')
  countOf(frame.tree())
  console.log(String('search typed: first draw (cold memo)').padEnd(46) + ' ' + ms(typed).toFixed(1).padStart(10) + ' ms · parses ' + parsedStats().parses + ' · chars held ' + parsedStats().chars)
  bench('frame: page, search query active', () => countOf(frame.tree()), ITERS || 40, out => String(out))
  rebind()

  const ticks = /** @type {number[]} */ ([])

  for (let i = 0; i < 100; i++) {
    const t = process.hrtime.bigint()

    await refreshWorkflows(world.state, world.host, true, NOW)
    ticks.push(ms(t))
  }

  ticks.sort((x, y) => x - y)
  seriesReport('refresh: warm-up tick (cold memo), slowest of 100', [ticks.at(-1) ?? 0], 'median tick ' + (ticks[50] ?? 0).toFixed(1) + ' ms · parsed ahead: ' + JSON.stringify({ warmed: parsedStats().warmed, held: parsedStats().chars }))

  const warm = process.hrtime.bigint()
  const before = parsedStats().parses

  setQuery(envNow(), 'module_8')
  countOf(frame.tree())
  console.log(String('search typed: first draw (memo warmed by 100 refreshes)').padEnd(64) + ' ' + ms(warm).toFixed(1).padStart(9) + ' ms · parses on the frame: ' + (parsedStats().parses - before) + ' (the search scans more than the 24 M memo holds)')
}

// 4b. A project whose search fits the parse memo (6 runs x 20 agents x 100 KB = 12 M characters, under its 24 M): the first draw after typing, cold and warmed (ADR-473).
console.log('\n# typed search on a project that fits the memo')

if (want('typed')) {
  resetSlots()
  resetDrillIo()
  registerDrill()
  registerSearch()

  const world = await worldOf(disk({ runs: 6, heavy: 6, agents: 20, bytes: 100_000 }))
  const frame = frameOf(world)
  const envNow = () => {
    const m = workflowsModelOf(world.state, NOW)
    const h = pick(world.state.wf.ui, m?.runs ?? [])

    return /** @type {never} */ ({ ctx: frame.ctx, runs: m?.runs ?? [], run: h.run, phase: h.phase, agent: h.agent, ui: h.ui, nowMs: NOW })
  }
  const typeOnce = (/** @type {string} */ query) => {
    const t = process.hrtime.bigint()
    const before = parsedStats().parses

    setQuery(envNow(), query)
    countOf(frame.tree())

    return { ms: ms(t), parses: parsedStats().parses - before }
  }

  resetDrillIo()

  const cold = typeOnce('module_7')

  console.log('search typed: first draw, project that fits (cold memo)'.padEnd(64) + ' ' + cold.ms.toFixed(1).padStart(9) + ' ms · parses ' + cold.parses)
  resetDrillIo()

  const ticks = /** @type {number[]} */ ([])

  for (let i = 0; i < 40; i++) {
    const t = process.hrtime.bigint()

    await refreshWorkflows(world.state, world.host, true, NOW)
    ticks.push(ms(t))
  }

  ticks.sort((x, y) => x - y)
  console.log(''.padEnd(64) + ' warm-up: 40 refresh ticks, median ' + (ticks[20] ?? 0).toFixed(1) + ' ms, slowest ' + (ticks.at(-1) ?? 0).toFixed(1) + ' ms · held ' + parsedStats().chars + ' chars')

  const warm = typeOnce('module_8')

  seriesReport('search typed: first draw, project that fits (memo warmed)', [warm.ms], 'parses on the frame: ' + warm.parses)
}

// 5. Search over every parsed transcript.
console.log('\n# search')

if (want('search')) {
  const d = disk({ runs: 6, heavy: 6, agents: 60, bytes: 200_000 })
  const world = await worldOf(d)
  const runs = allRuns(world.state.wf.read?.runs ?? [], null, [], NOW)
  const memo = new Map()
  const parsedFor = (/** @type {import('../hooks/data/workflows.ts').WfAgent} */ agent) => {
    const path = agent.transcriptPath

    if (path === undefined) return null

    const held = memo.get(path)

    if (held !== undefined) return held

    const text = d.files.get(path)?.text ?? null
    const parsed = text === null ? null : parseActivity(text)

    memo.set(path, parsed)

    return parsed
  }

  for (const run of runs) for (const phase of run.phases) for (const agent of phase.agents) parsedFor(agent)

  const brief = (/** @type {unknown} */ out) => { const r = /** @type {import('../hooks/data/wf-search.ts').SearchResult} */ (out); return `${r.scanned} scanned · ${Object.values(r.counts).join('/')} · ${r.chars} chars${r.isCapped ? ' capped' : ''}` }

  bench('search: miss over 360 transcripts', () => search({ runs, parsed: parsedFor }, 'zzqqxx-not-here'), 9, brief)
  bench('search: hit', () => search({ runs, parsed: parsedFor }, 'module_7'), 9, brief)
  bench('search: run name only (2 chars)', () => search({ runs: runs.slice(0, 1), parsed: () => null }, 'ag'), 40, brief)
}

// 6. Replay.
console.log('\n# replay')

for (const agents of want('replay') ? [60, 2000] : []) {
  const n = agents
  const input = { id: 'wf_replay', phases: PHASES }
  const run = /** @type {import('../hooks/data/workflows.ts').WfRun} */ (/** @type {unknown} */ ({
    id: input.id, name: 'replay', kind: 'workflow', state: 'completed', total: n, done: n, running: 0, failed: 0, idle: 0, totalTokens: n * 1000, isTokensPartial: false, hasRecord: true,
    phases: PHASES.map((title, p) => ({ title, done: 0, total: 0, running: 0, failed: 0, agents: Array.from({ length: Math.ceil(n / 4) }, (_, i) => { const k = i * 4 + p; return { id: `a${k}`, label: `agent ${k}`, phase: title, state: 'done', startedMs: NOW + k * 1000, elapsedMs: 30_000, tokens: 1000, toolCalls: 3, hasWorktree: false } }) })),
  }))
  const tl = buildTimeline(run)
  const mid = Math.floor(tl.events.length / 2)
  let ui = newReplay()

  bench(`replay: buildTimeline, ${agents} agents`, () => buildTimeline(run).events.length, 30, String)
  bench(`replay: boardAt, ${agents} agents`, () => { const b = boardAt(run, tl, mid); return [b.running, b.done, b.total] }, 30)
  bench(`replay: stepReplay next, ${agents} agents`, () => { ui = stepReplay(ui, tl, 'next', NOW); return ui.step > tl.events.length ? 0 : 1 }, 200, () => 'n/a')
}

// 7. A conversation thread fed 1000 messages (the thread keeps its newest 100, each up to 4000 characters).
console.log('\n# conversation')

if (want('convo')) {
  const state = newState({})
  const host = hostOver(disk({ runs: 1, heavy: 1, agents: 2, bytes: 1000 }).fs)

  wireConvo(state, host)

  const live = liveOf(state)
  const convo = newConvo()
  const body = 'a long answer with several sentences in it. '.repeat(90)

  bench('thread: add 1000 messages', () => { const c = newConvo(); for (let i = 0; i < 1000; i++) addMessage(c, 'claude', { atMs: NOW + i, who: i % 2 ? 'target' : 'you', text: `${i} ${body}`, state: i % 2 ? 'reply' : 'you', tokensIn: 10, tokensOut: 20 }); return [c.threads.get('claude')?.msgs.length, c.threads.get('claude')?.dropped] }, 15)

  for (let i = 0; i < 1000; i++) addMessage(convo, 'claude', { atMs: NOW + i, who: i % 2 ? 'target' : 'you', text: `${i} ${body}`, state: i % 2 ? 'reply' : 'you', tokensIn: 10, tokensOut: 20 })

  live.convo = convo
  live.convo.picked = 'claude'
  state.view = 'workflows'

  const act = /** @type {never} */ ({ workflows: { setUi: noop, ask: noop }, focus: noop, view: noop })
  const ctx = /** @type {never} */ ({ kit, state, nowMs: NOW, columns: 110, pictures: new Map(), act })
  const env = /** @type {never} */ ({ ctx, runs: [], run: null, phase: null, agent: null, ui: state.wf.ui, nowMs: NOW })

  bench('frame: conversation, 1000 messages', () => countOf(conversationRows(env)), 40, out => String(out))
}

if (CHECK && failed.length > 0) {
  console.error(`\nover budget:\n  ${failed.join('\n  ')}`)
  process.exit(1)
}
