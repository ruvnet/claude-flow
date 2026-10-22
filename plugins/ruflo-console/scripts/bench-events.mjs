// @ts-check
/**
 * ADR-474 benchmark: the Events and Timeline pages under load. Plain node, no fixtures on disk: a 2 MiB events log and a 200-lane by
 * 24 h lane store are generated here, and every page is drawn through the REAL view into a recording kit (the engine's own layout is not
 * in it). Median and p99 per case; `--check` exits 1 when a case misses its budget.
 *   npx -y tsx plugins/ruflo-console/scripts/bench-events.mjs [--check]
 * Cases: load the tail of a 2 MiB log and parse it; four query shapes over a 10 000-event log (cold pipeline, then memoised); the old
 * `eventsShown` substring filter over the same log (the BEFORE); render one Events page; render one Timeline page over 200 lanes x 24 h of
 * spans; append 100 events (encode, queue, one batched write); append 100 lane samples.
 */
import { activityOf, append } from '../hooks/activity-live.ts'
import { BATCH_MAX, flush, queueLine, resetIo } from '../hooks/activity-io.ts'
import { decodeEvents, encodeEvent, EVENTS_CAP } from '../hooks/data/activity-store.ts'
import { loadRows, observe } from '../hooks/data/timeline-model.ts'
import { eventsModel, eventsUi } from '../hooks/events-ui.ts'
import { parseQuery } from '../hooks/data/event-query.ts'
import { newState } from '../hooks/state.ts'
import { timelineModel } from '../hooks/timeline-ui.ts'
import { eventsView } from '../hooks/views/events.ts'
import { timelineView } from '../hooks/views/timeline.ts'
import { eventsShown } from '../hooks/watch.ts'

const CHECK = process.argv.includes('--check')
const NOW = Date.now()
const BUDGET_MS = { 'parse 2 MiB tail': 250, 'query word (cold)': 25, 'query field+negation (cold)': 25, 'query regex (cold)': 40, 'query since+phrase (cold)': 25, 'events page frame': 20, 'timeline model rebuild (200 lanes x 24h)': 60, 'timeline page frame (200 lanes x 24h)': 20, 'append 100 events (queue+write)': 20, 'append 100 lane samples': 5 }

const el = (kind) => (props) => ({ kind, props })
const kit = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Input: el('Input') }
const ctxOf = (state, columns = 100) => ({ kit, state, nowMs: NOW, columns, pictures: new Map(), act: new Proxy({}, { get: () => new Proxy(() => undefined, { get: () => () => undefined }) }) })

const KINDS = ['swarm', 'claims', 'workflows', 'autopilot', 'anatole', 'tools', 'learning']
const LINES = ['agent coder-12 spawned (coder)', 'run wf_alpha_build finished: 3 of 3 agents done', 'step s7 failed: tests red', 'Anatole blocked Bash: rule r-exfil (high)', 'ISSUE-1234 progress 40%', '+2 patterns learned']
const mkEvents = (n) => Array.from({ length: n }, (_, i) => ({ atMs: NOW - (n - i) * 8_000, kind: KINDS[i % KINDS.length], text: `${LINES[i % LINES.length]} #${i}`, ...(i % 5 === 0 && { agentId: `agent-${i % 40}` }) }))

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)

  return { median: sorted[Math.floor(sorted.length / 2)], p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] }
}

const results = []

async function time(name, run, runs = 25) {
  const samples = []

  for (let i = 0; i < 3; i++) await run(i)

  for (let i = 0; i < runs; i++) {
    const started = performance.now()

    await run(i)
    samples.push(performance.now() - started)
  }

  const { median, p99 } = stats(samples)
  const budget = BUDGET_MS[name]

  results.push({ name, median, p99, budget })
  console.log(`${name.padEnd(44)} median ${median.toFixed(2).padStart(8)} ms   p99 ${p99.toFixed(2).padStart(8)} ms${budget === undefined ? '' : `   budget ${budget} ms ${median <= budget ? 'ok' : 'OVER'}`}`)
}

// -- a 2 MiB log
const events = mkEvents(10_000)
const text = events.map(e => encodeEvent(e, 's1')).join('')
const log = text.slice(Math.max(0, text.length - 2 * 1024 * 1024))

console.log(`log: ${(log.length / 1048576).toFixed(2)} MiB, ${events.length} events, cap ${EVENTS_CAP} bytes`)
await time('parse 2 MiB tail', () => decodeEvents(log), 10)

// -- queries over a 10 000 event log
const state = newState({})

state.cwd = '/work/proj'
state.loadedAtMs = NOW - 86_400_000
const act = activityOf(state)

append(act, events)
act.loaded.isLoaded = true

const ui = eventsUi(state)
const shapes = { 'query word (cold)': 'failed', 'query field+negation (cold)': 'kind:swarm -spawned level:bad', 'query regex (cold)': '/step s\\d+ failed/', 'query since+phrase (cold)': 'since:1h "tests red"' }

for (const [name, q] of Object.entries(shapes)) {
  await time(name, i => {
    ui.query = q
    ui.parsed = parseQuery(q)
    act.version++ // a cold pipeline: the memo key changes
    eventsModel(state, NOW + i)
  })
}

ui.query = 'failed'
ui.parsed = parseQuery('failed')
const warm = []

for (let i = 0; i < 25; i++) {
  const t = performance.now()

  eventsModel(state, NOW)
  warm.push(performance.now() - t)
}
console.log(`${'query word (memoised)'.padEnd(44)} median ${stats(warm).median.toFixed(3).padStart(8)} ms`)

// -- BEFORE: the old substring filter
const old = newState({})

old.events = events
const lowered = 'failed'
const before = []

for (let i = 0; i < 25; i++) {
  const t = performance.now()

  eventsShown(old)
  before.push(performance.now() - t)
  void lowered
}
console.log(`${'BEFORE: old eventsShown, no query (10k)'.padEnd(44)} median ${stats(before).median.toFixed(3).padStart(8)} ms (no level, no regex, no window, no follow; capped at 300 events in the app)`)

// -- one page
ui.query = ''
ui.parsed = parseQuery('')
await time('events page frame', i => {
  act.version += i === 0 ? 0 : 0
  eventsView(ctxOf(state))
})

// -- timeline: 200 lanes x 24 h
const tstate = newState({})

tstate.cwd = '/work/proj'
tstate.loadedAtMs = NOW - 86_400_000
const tact = activityOf(tstate)
const rows = []

for (let lane = 0; lane < 200; lane++) {
  for (let s = 0; s < 144; s++) rows.push({ k: 'span', lane: `ruflo:l${lane}`, group: ['ruflo', 'workflow', 'mission', 'autopilot'][lane % 4], label: `lane ${lane}`, fromMs: NOW - 86_400_000 + s * 600_000, toMs: NOW - 86_400_000 + s * 600_000 + 300_000, busy: s % 2 === 0 })
}

loadRows(tact.lanes, rows)
append(tact, events)
tact.loaded.isLoaded = true
tstate.snapshot = /** @type {never} */ ({})
const tui = (await import('../hooks/timeline-ui.ts')).timelineUi(tstate)

tui.window = '24h'
console.log(`lanes: 200, spans: ${tact.lanes.spans.length} (store cap 20000)`)
// A changed store (a live read, at most one per 1.5 s tick): the model is rebuilt once, then every frame reuses it.
await time('timeline model rebuild (200 lanes x 24h)', () => {
  tact.lanes.version += 1
  timelineModel(tstate, NOW, 60)
}, 15)
await time('timeline page frame (200 lanes x 24h)', () => timelineView(ctxOf(tstate, 70)), 25)

// -- appends
const memory = new Map()
const host = { fs: { stat: async () => undefined, read: async () => '', list: async () => [] }, run: async (argv, _t, stdin = '') => (argv.includes('oflag=append') && memory.set(argv[1], (memory.get(argv[1]) ?? '') + stdin), { exitCode: 0, stdout: '', stderr: '' }) }

await time('append 100 events (queue+write)', async i => {
  resetIo()
  for (let k = 0; k < 100; k++) queueLine('/work/proj/e.jsonl', EVENTS_CAP, encodeEvent({ atMs: NOW + k, kind: 'swarm', text: `agent a${k} failed ${i}` }))
  await flush(host, '/work/proj', '/work/proj/e.jsonl', NOW + i * 60_000)
})
void BATCH_MAX

const store = tact.lanes

await time('append 100 lane samples', i => {
  for (let k = 0; k < 100; k++) observe(store, 'ruflo', [{ lane: `ruflo:l${k}`, group: 'ruflo', label: `lane ${k}`, busy: (i + k) % 2 === 0 }], NOW + (i + 1) * 60_000)
})

const over = results.filter(r => r.budget !== undefined && r.median > r.budget)

if (CHECK && over.length > 0) {
  console.error(`over budget: ${over.map(r => r.name).join(', ')}`)
  process.exit(1)
}
