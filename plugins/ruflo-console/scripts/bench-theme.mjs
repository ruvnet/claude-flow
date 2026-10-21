// @ts-check
/**
 * Per-tick cost of the animated pictures (header strike and sweep, rotating globe, topology preview, boot checks) for the Classic BBS look
 * and the Orbital look, narrow to wide, as the frame loop pays it: picturesOf() plus toRaster() for every picture, at the default 8 fps step.
 * Median and p99 per tick, and approximate bytes allocated per tick (heapUsed delta over a batch after gc(); run with NODE_OPTIONS=--expose-gc,
 * else that column reads n/a). Classic must cost what it did before the Orbital look existed.
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-theme.mjs [ticks]
 */
import { newState } from '../hooks/state.ts'
import { picturesOf } from '../hooks/views/frames.ts'

const N = Math.max(60, Number(process.argv[2]) || 600)
const STEP_MS = 125
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const stat = (/** @type {number[]} */ samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (/** @type {number} */ q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

  return `median ${at(0.5).toFixed(3)} ms · p99 ${at(0.99).toFixed(3)} ms`
}
const tick = (/** @type {import('../hooks/state.ts').State} */ state, /** @type {number} */ columns, /** @type {number} */ i) => {
  const t = i * STEP_MS / 1000
  let cells = 0

  for (const [id, picture] of picturesOf(state, columns, 1_000_000 + i * STEP_MS, t)) cells += picture.toRaster(id).columns

  return cells
}

console.log(`${N} ticks per case at ${STEP_MS} ms steps (8 fps)`)
for (const look of /** @type {const} */ (['bbs', 'orbital'])) {
  for (const view of /** @type {const} */ (['menu', 'swarm', 'themes'])) {
    for (const columns of [60, 100, 140]) {
      const state = newState({ look, boot: false, fps: 8 })

      state.view = view
      state.pane.viewAtMs = 1
      for (let i = 0; i < 40; i++) tick(state, columns, i)
      const samples = []

      for (let i = 0; i < N; i++) {
        const start = process.hrtime.bigint()

        tick(state, columns, i + 40)
        samples.push(ms(start))
      }
      let bytes = 'n/a'

      if (gc) {
        gc()
        const before = process.memoryUsage().heapUsed

        for (let i = 0; i < 100; i++) tick(state, columns, i + 700)
        bytes = `${Math.round((process.memoryUsage().heapUsed - before) / 100 / 1024)} KiB/tick`
      }
      console.log(`${look.padEnd(7)} ${view.padEnd(6)} ${String(columns).padStart(3)} cols: ${stat(samples)} · ${bytes}`)
    }
  }
}
