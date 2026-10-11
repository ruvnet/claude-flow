/**
 * Performance: the `ruflo performance` verbs and the MCP performance tools, as fixed argv checked against
 * commands/performance.ts and mcp-tools/performance-tools.ts. The CLI's `metrics`, `profile` and the wasm benchmark
 * measure in-process and write nothing, so they run at once; `performance_report`, `_bottleneck` and `_optimize` write
 * (metrics.json, a probe file), and the full benchmark stores memory entries and loads the embedding model, so those ask.
 * The CLI's own `bottleneck` and `optimize` print a fixed table, not a measurement, so the console asks the MCP tools.
 * The latency samples each run reports are kept per State here for the view's sparklines. Pure: no `$`.
 */
import { exec } from './actions'
import { jsonAfter } from './data/cli'
import { plain, recordOf } from './data/parse'
import { measureOf } from './data/safe'
import { labLines } from './mh-lab'
import { mcpReader, textLines, type Reader, type SecCost } from './secure'
import type { State } from './state'

export type PerfEntry = { id: string; name: string; about: string; label: string; cost: SecCost; args: readonly string[]; read: Reader; note?: string; timeoutMs?: number }

/** Event-loop latency per `metrics` run (ms), and the report's stored history of self-probe latency (ms), oldest first. */
export type PerfMemo = { loop: number[]; report: number[]; heapMb: number | null; atMs: number }

const memos = new WeakMap<State, PerfMemo>()
const KEEP = 40

export function perfMemo(state: State): PerfMemo {
  const held = memos.get(state)

  if (held !== undefined) return held

  const fresh: PerfMemo = { loop: [], report: [], heapMb: null, atMs: 0 }

  memos.set(state, fresh)

  return fresh
}

const BARS = '▁▂▃▄▅▆▇█'

/** A series as one row of block characters, scaled from its own minimum to its maximum; `width` newest samples. */
export function sparkline(values: readonly number[], width = 32): string {
  const shown = values.filter(value => Number.isFinite(value)).slice(-width)

  if (shown.length === 0) return ''

  const lo = Math.min(...shown)
  const span = Math.max(...shown) - lo

  return shown.map(value => BARS[span === 0 ? 3 : Math.round(((value - lo) / span) * (BARS.length - 1))] ?? '▁').join('')
}

/** Any value as one cleaned cell: numbers must be finite and sane (a hostile 1e300 is "n/a", not a display value), text goes through plain(). */
function show(value: unknown, max = 24): string {
  if (typeof value === 'number') return measureOf(value) === undefined ? 'n/a' : String(value)
  if (value === undefined || value === null) return 'n/a'

  return plain(typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : '', max) || 'n/a'
}

// Every number below is bounded where it is read (#3822): `1e999` parses as Infinity and `1e300` prints as "1e+300", neither a measurement.
const as = (value: unknown, text: (n: number) => string): string => {
  const n = measureOf(value)

  return n === undefined ? 'n/a' : text(n)
}
const ms = (value: unknown, digits = 3): string => as(value, n => `${n.toFixed(digits)}ms`)
const mb = (bytes: unknown): string => as(bytes, n => `${(n / 1024 / 1024).toFixed(1)} MB`)
const pct = (value: unknown, digits?: number): string => as(value, n => `${digits === undefined ? String(n) : n.toFixed(digits)}%`)

/** `performance metrics --format json`: memory, CPU, load and the event-loop latency, which feeds the sparkline. */
export const metricsReader: Reader = (stdout, stderr, state) => {
  const record = recordOf(jsonAfter(stdout))

  if (record === null) return textLines(stdout, stderr)

  const memory = recordOf(record.memory) ?? {}
  const cpu = recordOf(record.cpu) ?? {}
  const latency = recordOf(record.latency) ?? {}
  const cache = recordOf(record.cache) ?? {}
  const avg = measureOf(latency.avgMs) ?? null
  const heap = measureOf(memory.heapUsed)
  const memo = perfMemo(state)

  if (avg !== null) memo.loop = [...memo.loop, avg].slice(-KEEP)
  memo.heapMb = heap === undefined ? null : heap / 1024 / 1024
  memo.atMs = Date.now()

  const load = Array.isArray(cpu.loadAverage) ? cpu.loadAverage.flatMap(value => (measureOf(value) === undefined ? [] : [as(value, n => n.toFixed(2))])).join(' ') : 'n/a'

  return [
    `event-loop latency ${ms(avg)} · heap ${mb(memory.heapUsed)} of ${mb(memory.heapTotal)} · rss ${mb(memory.rss)}`,
    `system memory ${pct(memory.systemPercent)} · load ${load}`,
    `embedding cache ~${show(cache.entries)} entries · HNSW ${show(cache.hnswEntries)} entries`,
    'measured in the CLI process at the moment it ran: one sample per run',
  ]
}

/** `performance benchmark --output json`: each operation's mean, p95 and p99. */
export const benchReader: Reader = (stdout, stderr) => {
  const record = recordOf(jsonAfter(stdout))
  const results = (Array.isArray(record?.results) ? record.results : null)?.map(recordOf).filter(row => row !== null)

  if (record === null || results === undefined) return textLines(stdout, stderr)

  return [
    `suite ${show(record.suite, 12)} · ${show(record.iterations)} iterations · ${show(record.totalTime, 12)}`,
    ...results.map(row => `${show(row.operation, 24).padEnd(24)} mean ${show(row.mean, 12)} · p95 ${show(row.p95, 12)} · p99 ${show(row.p99, 12)} · ${show(row.improvement, 24)}`),
  ]
}

/** `performance_report` (detailed): the current sample, and the stored history, whose latency feeds the sparkline. */
export const reportReader: Reader = (stdout, stderr, state) => {
  const result = recordOf(jsonAfter(stdout))
  const current = recordOf(result?.current)

  if (result === null || current === null) return mcpReader('performance_report')(stdout, stderr, state)

  const history = (Array.isArray(result.history) ? result.history : []).map(recordOf).flatMap(row => {
    const avg = recordOf(row?.latency)?.avg

    const sample = measureOf(avg)

    return sample === undefined ? [] : [sample]
  })
  const memo = perfMemo(state)
  const cpu = recordOf(current.cpu) ?? {}
  const memory = recordOf(current.memory) ?? {}
  const latency = recordOf(current.latency) ?? {}

  memo.report = history.slice(-KEEP)
  memo.atMs = Date.now()

  return [
    `cpu ${pct(cpu.usage, 1)} of ${show(cpu.cores)} cores · memory ${show(memory.used)} of ${show(memory.total)} MB · heap ${show(memory.heap)} MB`,
    `latency avg ${ms(latency.avg)} · p50 ${ms(latency.p50)} · p95 ${ms(latency.p95)} · p99 ${ms(latency.p99)}`,
    `history: ${history.length} stored sample${history.length === 1 ? '' : 's'} in .claude-flow/performance/metrics.json`,
    ...labLines('performance_report', JSON.stringify({ trends: result.trends, recommendations: result.recommendations })).slice(0, 12),
  ]
}

const LOCAL = '$0, local: measures in-process and writes nothing'
// The note is read by Claude's gate (model-tools.ts classOf). "removes" is deliberate: these entries delete the probe file they write, and the
// gate classes them 'delete' (full control). A reword that drops the word would lower the gate, so it stays and a spec pins the class.
const PROBE = '$0, local: writes and removes a 4 KB probe file in .claude-flow/performance/'

export const PERF: readonly PerfEntry[] = [
  { id: 'perf-metrics', name: 'METRICS', about: 'heap, rss, load and event-loop latency, now', label: 'performance metrics: memory, load and latency now', cost: 'read', args: ['performance', 'metrics', '--format', 'json'], read: metricsReader, note: LOCAL },
  { id: 'perf-profile', name: 'PROFILE', about: 'CPU, heap and event-loop lag over a short sample', label: 'performance profile: CPU, heap and lag over 1 s', cost: 'read', args: ['performance', 'profile', '--type', 'all', '--duration', '10'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'perf-bench-wasm', name: 'BENCH WASM', about: 'flash-attention batch search, 100 iterations', label: 'performance benchmark, wasm suite: pure compute', cost: 'read', args: ['performance', 'benchmark', '--suite', 'wasm', '--iterations', '100', '--output', 'json'], read: benchReader, note: LOCAL },
  { id: 'perf-bench-all', name: 'BENCH ALL', about: 'embeddings, search, flash attention, SONA, memory', label: 'performance benchmark, every suite (writes memory, may download a model)', cost: 'network', args: ['performance', 'benchmark', '--suite', 'all', '--iterations', '20', '--output', 'json'], read: benchReader, note: 'local CPU for a minute or more: stores entries in memory namespace benchmark, and the first embedding may download the transformers.js model (network)', timeoutMs: 300_000 },
  { id: 'perf-report', name: 'REPORT', about: 'a sample appended to the stored history, and trends', label: 'performance_report: sample, store and trend (writes metrics.json)', cost: 'writes', args: exec('performance_report', { format: 'detailed' }), read: reportReader, note: '$0, local: appends one sample to .claude-flow/performance/metrics.json (keeps 100)' },
  { id: 'perf-bottleneck', name: 'BOTTLENECK', about: 'measured disk, heap and benchmark-history hot spots', label: 'performance_bottleneck: measured hot spots', cost: 'writes', args: exec('performance_bottleneck', {}), read: mcpReader('performance_bottleneck'), note: PROBE },
  { id: 'perf-optimize', name: 'OPTIMIZE', about: 'measured recommendations, nothing aggressive applied', label: 'performance_optimize: measured recommendations', cost: 'writes', args: exec('performance_optimize', { target: 'all' }), read: mcpReader('performance_optimize'), note: PROBE },
]

/** Is a lab result one of this view's? */
export const isPerfResult = (id: string): boolean => PERF.some(entry => entry.id === id)
