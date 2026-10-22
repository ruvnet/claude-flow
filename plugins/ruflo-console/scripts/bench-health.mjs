// @ts-check
/**
 * Memory health benchmark (ADR-457): the probe reader, the analysis (analyseHealth) and the view's rows (healthRows) at 1k and
 * 10k entries, with a recording kit (the engine's layout is not in it). Median and p99 over N runs, and approximate bytes
 * allocated per call (heapUsed delta over a batch after gc(); run with NODE_OPTIONS=--expose-gc, else the column reads n/a).
 * The probe only ever reads HEALTH_CAP (1000) entries; 10k exercises the pair budget (PAIR_CAP) that bounds the worst case.
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-health.mjs [runs]
 */
import { analyseHealth, memoryHealthProbe } from '../hooks/data/memory-health.ts'
import { newState } from '../hooks/state.ts'
import { healthRows } from '../hooks/views/memory-health.ts'

const RUNS = Math.max(5, Number(process.argv[2]) || 25)
const NOW = 1_800_000_000_000
const DAY = 86_400_000
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)

/** Deterministic entries: ~1/9 share a topic stem (near duplicates), a few exact key collisions across namespaces. */
const entries = (/** @type {number} */ n) =>
  Array.from({ length: n }, (_, i) => ({
    namespace: `ns${i % 7}`,
    key: i % 50 === 0 ? `Shared/Key_${i % 100}` : `topic-${i % 90}-item-${i}${i % 9 === 0 ? '-v2' : ''}`,
    size: 50 + (i % 40),
    accessCount: i % 3,
    updatedAtMs: NOW - (i % 120) * DAY,
    createdAtMs: NOW - 200 * DAY,
  }))

const stat = (/** @type {() => unknown} */ fn) => {
  fn()
  const times = []

  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()

    fn()
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }

  times.sort((a, b) => a - b)

  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()

    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 5; i++) fn()

    bytes = `${Math.max(0, Math.round((process.memoryUsage().heapUsed - before) / 5 / 1024))} KB`
  }

  return { median: times[Math.floor(times.length / 2)] ?? 0, p99: times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0, bytes }
}

const make = (/** @type {string} */ kind) => (/** @type {Record<string, unknown>} */ props) => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = new Proxy({}, { get: () => new Proxy({}, { get: () => () => undefined }) })
const rows = []

for (const n of [1000, 10_000]) {
  const list = entries(n)
  const json = JSON.stringify(list.map(e => ({ key: e.key, namespace: e.namespace, size: e.size, accessCount: e.accessCount, createdAt: new Date(e.createdAtMs).toISOString(), updatedAt: new Date(e.updatedAtMs).toISOString(), hasEmbedding: true })))
  const sample = { listed: n, entries: list }
  const state = newState({ boot: false })

  state.probes.set('memory-health', /** @type {never} */ ({ value: sample, okAtMs: NOW, error: null, errorAtMs: null }))

  const ctx = /** @type {never} */ ({ kit, state, act, columns: 120, nowMs: NOW, pictures: new Map() })
  const report = analyseHealth(sample, NOW)

  rows.push({ what: 'probe parse', n, ...stat(() => memoryHealthProbe.parse(json)), note: 'capped at 1000 entries' })
  rows.push({ what: 'analyseHealth', n, ...stat(() => analyseHealth(sample, NOW)), note: `${report.pairsCompared} pairs, ${report.clusterCount} clusters${report.isTruncated ? ', budget hit' : ''}` })
  rows.push({ what: 'healthRows (per frame)', n, ...stat(() => healthRows(ctx)), note: 'what a render pays' })
}

console.log('what                      n       median ms   p99 ms    alloc/call   note')

for (const r of rows) console.log(`${r.what.padEnd(25)} ${String(r.n).padEnd(7)} ${r.median.toFixed(2).padStart(9)}  ${r.p99.toFixed(2).padStart(8)}  ${String(r.bytes).padStart(11)}   ${r.note}`)
