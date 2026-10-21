// @ts-check
/**
 * ADR-455 benchmark: the Learning page's pipeline diagram and route picture. The only input that scales is the route query's
 * output (`nn-route` lines: one `or agent · N%` per runner-up), so size = lines handed to candidatesFromLines/routeModelOf. The
 * four-stage diagram is fixed-size and measured once. Median of runs, p99, and approximate bytes allocated per call
 * (heapUsed delta over a batch after gc(); run with --expose-gc, else n/a).
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-pipeline.mjs [runs]
 */
import { candidatesFromLines, pipeStagesOf, routeModelOf } from '../hooks/data/pipeline.ts'
import { pipelineDiagram, routePicture } from '../hooks/gfx/pipeline.ts'

const RUNS = Math.max(20, Number(process.argv[2]) || 200)
const NOW = Date.now()
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const linesOf = (/** @type {number} */ n) => ['→ coder · 87% · knn', ...Array.from({ length: n - 1 }, (_, i) => `  or agent-${i} · ${i % 100}%`)]
const stat = (/** @type {number[]} */ samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (/** @type {number} */ q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

  return `median ${at(0.5).toFixed(4)} ms · p99 ${at(0.99).toFixed(4)} ms`
}
const measure = (/** @type {string} */ name, /** @type {() => unknown} */ fn) => {
  for (let i = 0; i < 20; i++) fn()

  const times = []

  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint()

    fn()
    times.push(Number(process.hrtime.bigint() - start) / 1e6)
  }

  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 100; i++) fn()
    bytes = `~${Math.round((process.memoryUsage().heapUsed - before) / 100 / 1024)} KiB`
  }

  console.log(`${name.padEnd(34)} ${stat(times)} · alloc/call ${bytes}`)
}

const stages = [{ name: 'RETRIEVE', count: 120 }, { name: 'JUDGE', count: 340 }, { name: 'DISTILL', count: 12 }, { name: 'CONSOLIDATE', count: 3 }]
const at = { RETRIEVE: NOW - 60_000, JUDGE: NOW - 2 * 86_400_000, DISTILL: NOW - 5000 }

console.log(`runs ${RUNS}`)
measure('pipeStagesOf + diagram (4 stages)', () => pipelineDiagram(pipeStagesOf(stages, at, NOW), 110))

for (const n of [1000, 10_000]) {
  const lines = linesOf(n)
  const lab = { id: 'nn-route', label: 'route', lines }
  const input = { seated: true, classicOwnsRoute: false, route: null, lab }
  const model = routeModelOf(input)

  console.log(`-- ${n} route-query lines (model keeps ${model.candidates.length} candidates)`)
  measure(`candidatesFromLines ${n}`, () => candidatesFromLines(lines))
  measure(`routeModelOf ${n}`, () => routeModelOf(input))
  measure(`routePicture ${n}`, () => routePicture(model, 110).toRaster('route'))
  measure(`routeModelOf+routePicture ${n}`, () => routePicture(routeModelOf(input), 110).toRaster('route'))
}
