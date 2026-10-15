// @ts-check
/**
 * R4 (b): per-frame render cost of the Room, Overview, Memory and Events pages under load: 300 events, 200 control-log
 * entries and 60 mod status files, rendered through paneView with a recording kit (the same stand-in scripts/bench.ts uses;
 * the engine's own layout is not in it). Median and p99 per page, plus approximate bytes allocated per render
 * (heapUsed delta over a batch after gc(); run with NODE_OPTIONS=--expose-gc, else the column reads n/a).
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-views.mjs [iterations]
 */
import { readSnapshot } from '../hooks/data/snapshot.ts'
import { newState } from '../hooks/state.ts'
import { picturesOf } from '../hooks/views/frames.ts'
import { paneView } from '../hooks/views/pane.ts'
import { CLI_OUT, RUFLO_FILES } from '../tests/fixtures/ruflo-run.ts'

const N = Math.max(50, Number(process.argv[2]) || 400)
const COLUMNS = 110
const NOW = Date.now()
const KINDS = ['swarm', 'claims', 'federation', 'learning', 'tools', 'mods', 'missions']
/** @type {Record<string, string>} */
const files = Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))

for (let i = 0; i < 60; i++) {
  files[`/work/.claude-flow/m${i}-mod/status.json`] = JSON.stringify({ version: 1, guard: true, calls: i * 3, blocked: i % 5, updatedMs: NOW - i * 1000, startedMs: NOW - 60_000 })
}

const fs = {
  read: async (/** @type {string} */ path) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (/** @type {string} */ path) => (files[path] !== undefined ? { mtimeMs: 1, size: files[path].length } : Promise.reject(new Error('ENOENT'))),
  list: async (/** @type {string} */ path) => {
    const prefix = `${path.replace(/\/+$/, '')}/`
    const names = new Set(Object.keys(files).filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))

    return [...names].map(name => ({ name, kind: files[`${prefix}${name}`] !== undefined ? 'file' : 'dir' }))
  },
}
const element = (/** @type {string} */ type) => (/** @type {Record<string, unknown>} */ props) => ({ type, props })
const kit = /** @type {never} */ ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster') })
const act = /** @type {never} */ (new Proxy({}, { get: () => () => undefined }))
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6

const state = newState({})

state.cwd = '/work'
state.activity = Array.from({ length: 60 }, (_, i) => i % 7)
state.writes = Array.from({ length: 60 }, (_, i) => i % 3)
state.events = Array.from({ length: 300 }, (_, i) => ({ atMs: NOW - i * 700, kind: /** @type {never} */ (KINDS[i % KINDS.length]), text: `event ${i}: agent-${i % 40} changed state on claim ${i % 90}`, agentId: `agent-${i % 40}` }))
state.control.log = Array.from({ length: 200 }, (_, i) => ({ atMs: NOW - i * 900, tool: 'console_run', summary: `run memory stats ${i}`, outcome: /** @type {const} */ (['ok', 'waiting', 'denied', 'error'][i % 4]), detail: `detail ${i}` }))
state.snapshot = await readSnapshot(fs, new Map(), '/work', null, {}, NOW)

if (state.snapshot.mods.rows.length !== 60) throw new Error(`expected 60 mod rows, got ${state.snapshot.mods.rows.length}`)

const stat = (/** @type {number[]} */ samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (/** @type {number} */ q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

  return `median ${at(0.5).toFixed(3)} ms · p99 ${at(0.99).toFixed(3)} ms`
}
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)

console.log(`load: ${state.events.length} events · ${state.control.log.length} control-log entries · ${state.snapshot.mods.rows.length} mod rows · ${N} renders per page · ${COLUMNS} columns`)

for (const view of /** @type {const} */ (['room', 'overview', 'memory', 'events'])) {
  state.view = view

  const draw = () => paneView({ kit, state, nowMs: NOW, columns: COLUMNS, pictures: picturesOf(state, COLUMNS, NOW, NOW), act })
  const times = []

  for (let i = 0; i < 20; i++) draw()
  for (let i = 0; i < N; i++) {
    const start = process.hrtime.bigint()

    draw()
    times.push(ms(start))
  }

  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 200; i++) draw()
    bytes = `~${Math.round((process.memoryUsage().heapUsed - before) / 200 / 1024)} KiB`
  }

  console.log(`${view.padEnd(9)} ${stat(times)} · allocated/render ${bytes} (approximate)`)
}
