// @ts-check
/**
 * Memory map cost: the data reader (`memory list` JSON -> entries), the layout, the picture and the whole section render, at 1k and
 * 10k entries (the real probe caps at MAP_LIMIT = 500; the larger sizes show what an uncapped caller would pay). Median and p99
 * wall time per call, approximate bytes allocated per call (heapUsed delta after gc(); run with --expose-gc, else n/a).
 * Embedding rows are synthetic 384-dim vectors, printed the way `memory list --embeddings` prints them (int8 + scale, base64; ADR-472),
 * so the parse row includes the decode. 500 is the real probe's size (MAP_LIMIT); the larger sizes show what an uncapped caller would pay.
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-memmap.mjs [iterations]
 */
import { encodeEmbeddingQ8 } from '../../../v3/@claude-flow/cli/src/memory/embedding-q8.ts'
import { semanticDuplicates } from '../hooks/data/memory-health.ts'
import { mapEntriesOf } from '../hooks/data/memmap.ts'
import { layout, memmapPicture, spacesOf } from '../hooks/gfx/memmap.ts'
import { newState } from '../hooks/state.ts'
import { memmapPictures, memmapRows } from '../hooks/views/memmap.ts'

const N = Math.max(5, Number(process.argv[2]) || 30)
const SPACES = ['auth', 'notes', 'patterns', 'tasks', 'claude-memories', 'feedback', 'sessions', 'routing']
const element = (/** @type {string} */ type) => (/** @type {Record<string, unknown>} */ props) => ({ type, props })
const kit = /** @type {never} */ ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster') })
const act = /** @type {never} */ (new Proxy({}, { get: () => () => undefined }))
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6

const entriesOf = (/** @type {number} */ n, /** @type {boolean} */ embedded) =>
  Array.from({ length: n }, (_, i) => ({
    key: `entry-${i}-${(i * 2654435761) % 99991}`,
    namespace: /** @type {string} */ (SPACES[i % SPACES.length]),
    hasVector: true,
    accessCount: i % 13,
    ...(embedded && { vector: Array.from({ length: 384 }, (_, d) => Math.sin(i * 0.37 + d)) }),
  }))

const time = (/** @type {() => unknown} */ fn) => {
  for (let i = 0; i < 3; i++) fn()

  const samples = []

  for (let i = 0; i < N; i++) {
    const start = process.hrtime.bigint()

    fn()
    samples.push(ms(start))
  }

  samples.sort((a, b) => a - b)

  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 10; i++) fn()
    bytes = `${Math.round((process.memoryUsage().heapUsed - before) / 10 / 1024)} KiB`
  }

  return `median ${(samples[Math.floor(N / 2)] ?? 0).toFixed(3).padStart(9)} ms · p99 ${(samples[Math.min(N - 1, Math.floor(N * 0.99))] ?? 0).toFixed(3).padStart(9)} ms · ~${bytes}`
}

const row = (/** @type {string} */ name, /** @type {() => unknown} */ fn) => console.log(`  ${name.padEnd(34)} ${time(fn)}`)

for (const size of [500, 1000, 10_000]) {
  console.log(`\n${size} entries (${N} runs each)`)

  for (const embedded of [false, true]) {
    const mode = embedded ? 'embedding' : 'hash'
    const entries = entriesOf(size, embedded)
    const json = JSON.stringify(entries.map(e => ({ key: e.key, namespace: e.namespace, hasEmbedding: true, accessCount: e.accessCount, ...(e.vector && { embeddingQ8: encodeEmbeddingQ8(e.vector) }) })))
    const { points } = layout(entries)
    const spaces = spacesOf(entries)
    const hits = new Set(points.slice(0, 20).map(p => `${p.namespace}/${p.key}`))
    const state = newState({ boot: false })

    state.probes.set('memmap', { value: entries, error: null, okAtMs: 4_000 })

    const ctx = /** @type {never} */ ({ kit, state, act, columns: 100, nowMs: 5_000, pictures: new Map() })

    console.log(`  [${mode}] stdout ${(json.length / 1000).toFixed(0)} KB`)
    row(`[${mode}] mapEntriesOf (parse)`, () => mapEntriesOf(json))
    if (embedded) row(`[${mode}] similar-by-meaning (health)`, () => semanticDuplicates([...entries]))
    // Cold rows hand a fresh array each call (layout is remembered per array); the copy is ~0.1 ms at 10k and is inside the figure.
    row(`[${mode}] layout (cold)`, () => layout([...entries]))
    row(`[${mode}] memmapPicture`, () => memmapPicture(points, spaces, hits, 100))
    row(`[${mode}] frame: pictures+rows (cold)`, () => {
      state.probes.set('memmap', { value: [...entries], error: null, okAtMs: 4_000 })
      memmapPictures(state, 100)
      memmapRows(ctx)
    })
    state.probes.set('memmap', { value: entries, error: null, okAtMs: 4_000 })
    row(`[${mode}] frame: pictures+rows (warm)`, () => {
      memmapPictures(state, 100)
      memmapRows(ctx)
    })
  }
}
