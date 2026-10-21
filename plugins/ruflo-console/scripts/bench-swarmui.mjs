// @ts-check
/**
 * ADR-458 benchmark: the workflows page's data functions and its render at 1k and 10k items. Plain node, no fixtures on
 * disk: every input is generated here with the shapes Claude Code writes. Median and p99 wall time per case, plus
 * approximate bytes allocated per call (heapUsed delta after gc(); needs NODE_OPTIONS=--expose-gc, else n/a).
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-swarmui.mjs [runs]
 * Cases: transcript lines (parseTranscript), journal events (parseJournal), agents in one run (buildRun, groupPhases),
 * the page drawn for a run with that many agents (workflowsView, bounded to 14 rows a column), and the whole reader
 * (readWorkflowRuns) over an in-memory disk at its own caps (6 runs x 60 agents).
 */
import { newState } from '../hooks/state.ts'
import { buildRun, parseJournal, parseTranscript } from '../hooks/data/workflows.ts'
import { allRuns, newWfUi, startOn } from '../hooks/data/workflows-nav.ts'
import { readWorkflowRuns, slugOf } from '../hooks/data/workflows-read.ts'
import { workflowsView } from '../hooks/views/workflows.ts'

const RUNS = Math.max(5, Number(process.argv[2]) || 21)
const NOW = Date.parse('2026-10-06T02:00:00.000Z')
const iso = (/** @type {number} */ s) => new Date(NOW - 3_600_000 + s * 1000).toISOString()
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6

const transcriptOf = (/** @type {number} */ n) => {
  const out = [JSON.stringify({ type: 'user', timestamp: iso(0), message: { role: 'user', content: 'task' } })]

  for (let i = 0; i < n / 2; i++) {
    const base = { type: 'assistant', timestamp: iso(i), message: { id: `m${i}`, model: 'claude-sonnet-5-5', role: 'assistant', content: i % 3 === 0 ? [{ type: 'tool_use', id: `t${i}`, name: 'Bash' }] : [{ type: 'text', text: 'ok' }], usage: { input_tokens: 2, cache_creation_input_tokens: 500, cache_read_input_tokens: 100_000 + i, output_tokens: 50 } } }

    out.push(JSON.stringify({ ...base, message: { ...base.message, usage: { ...base.message.usage, output_tokens: 3 } } }), JSON.stringify(base))
  }

  return out.join('\n') + '\n'
}
const PHASES = ['Build', 'Tune', 'Review', 'Ship']
const journalOf = (/** @type {number} */ n) => [JSON.stringify({ type: 'launched' }), ...Array.from({ length: n }, (_, i) => JSON.stringify({ type: i % 2 ? 'result' : 'started', key: `v2:a${i >> 1}`, agentId: `a${i >> 1}`, label: `agent ${i >> 1}`, phase: PHASES[(i >> 1) % 4], result: 'finished the work' }))].join('\n') + '\n'
const inputOf = (/** @type {number} */ n) => ({
  id: 'wf_bench',
  journal: journalOf(n * 2),
  agents: new Map(Array.from({ length: n }, (_, i) => [`a${i}`, { meta: JSON.stringify({ description: `agent ${i}`, workflowPhase: PHASES[i % 4] }), transcript: null, isTail: false, path: `/d/agent-a${i}.jsonl` }])),
  record: null,
  script: null,
  nowMs: NOW,
})

const element = (/** @type {string} */ kind) => (/** @type {Record<string, unknown>} */ props) => ({ kind, props })
const kit = /** @type {never} */ ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster') })
const ctx = /** @type {never} */ ({ kit, state: newState({}), nowMs: NOW, columns: 110, pictures: new Map(), act: {} })

/** @type {(name: string, fn: () => unknown, iterations?: number) => void} */
function bench(name, fn, iterations = RUNS) {
  for (let i = 0; i < 3; i++) fn()

  const times = []

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()

    fn()
    times.push(ms(start))
  }

  times.sort((a, b) => a - b)

  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 5; i++) fn()
    bytes = `~${Math.round((process.memoryUsage().heapUsed - before) / 5 / 1024)} KiB`
  }

  console.log(`${name.padEnd(34)} median ${(times[Math.floor(times.length / 2)] ?? 0).toFixed(3).padStart(9)} ms · p99 ${(times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0).toFixed(3).padStart(9)} ms · alloc/call ${bytes}`)
}

console.log(`${RUNS} timed runs per case · 110 columns · node ${process.version}`)

for (const n of [1000, 10_000]) {
  const t = transcriptOf(n)
  const j = journalOf(n)

  bench(`parseTranscript ${n} lines`, () => parseTranscript(t))
  bench(`parseJournal ${n} events`, () => parseJournal(j))
}

for (const n of [1000, 10_000]) {
  const input = inputOf(n)
  const run = buildRun(input)
  const runs = allRuns([run], null, [], NOW)
  const ui = startOn(newWfUi(), run)

  bench(`buildRun ${n} agents`, () => buildRun(input), n > 1000 ? 9 : RUNS)
  bench(`workflowsView ${n} agents`, () => workflowsView(ctx, { runs, root: '/c', capBytes: 3_000_000, skipped: 0, more: 0 }, ui, { ask: () => undefined, show: () => undefined }))
}

// The whole reader at its own caps: 8 runs on disk (6 read), 60 agents each, transcripts of 400 lines.
const root = `/cfg/projects/${slugOf('/work')}`
const files = /** @type {Record<string, string>} */ ({})
const sessions = ['00000000-0000-0000-0000-000000000001']

for (let r = 0; r < 8; r++) {
  const dir = `${root}/${sessions[0]}/subagents/workflows/wf_r${r}`

  files[`${dir}/journal.jsonl`] = journalOf(120)

  for (let a = 0; a < 70; a++) {
    files[`${dir}/agent-a${a}.meta.json`] = JSON.stringify({ description: `agent ${a}`, workflowPhase: PHASES[a % 4] })
    files[`${dir}/agent-a${a}.jsonl`] = transcriptOf(400)
  }
}

// An indexed in-memory disk (directory → children), so the bench times the reader and not a linear-scan stand-in.
const index = /** @type {Map<string, Map<string, boolean>>} */ (new Map())

for (const file of Object.keys(files)) {
  const parts = file.split('/')

  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/') || '/'
    const kids = index.get(parent) ?? new Map()

    kids.set(/** @type {string} */ (parts[i]), i === parts.length - 1)
    index.set(parent, kids)
  }
}

const fs = {
  read: async (/** @type {string} */ path) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (/** @type {string} */ path) => (files[path] !== undefined ? { mtimeMs: 1, size: files[path].length } : Promise.reject(new Error('ENOENT'))),
  list: async (/** @type {string} */ path) => {
    const dir = path.replace(/\/+$/, '')

    return [...(index.get(dir) ?? new Map()).entries()].map(([name, isFile]) => ({ name, kind: isFile ? 'file' : 'dir', mtimeMs: 1, size: isFile ? (files[`${dir}/${name}`]?.length ?? 0) : 0 }))
  },
}
/**
 * The reader: the first read (empty read cache, empty parse memo) and the refreshes after it with nothing changed, which is
 * what the console's timer does. The parse memo lives in the module, so only the first call of a process is cold.
 */
const shared = new Map()
const times = []
let first = 0

for (let i = 0; i < 12; i++) {
  const start = process.hrtime.bigint()
  const out = await readWorkflowRuns(/** @type {never} */ (fs), /** @type {never} */ (shared), { configDir: '/cfg', cwd: '/work', nowMs: NOW })
  const took = ms(start)

  if (i === 0 && (out.runs.length !== 6 || out.runs[0]?.total !== 60)) throw new Error(`reader caps not exercised: ${out.runs.length} runs, ${out.runs[0]?.total} agents`)

  if (i === 0) first = took
  else times.push(took)
}

times.sort((a, b) => a - b)
console.log(`${'readWorkflowRuns 6x60 first'.padEnd(34)} ${first.toFixed(3).padStart(9)} ms  (in-memory fs: no disk latency in it)`)
console.log(`${'readWorkflowRuns 6x60 refresh'.padEnd(34)} median ${(times[Math.floor(times.length / 2)] ?? 0).toFixed(3).padStart(9)} ms · p99 ${(times[times.length - 1] ?? 0).toFixed(3).padStart(9)} ms  (same cache, nothing changed)`)
