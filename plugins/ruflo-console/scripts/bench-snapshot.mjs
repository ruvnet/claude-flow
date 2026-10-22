// @ts-check
/**
 * R4 (c): the snapshot read path. Counts the `$.fs` calls one refresh makes (each is an engine round trip) and times the
 * parse, cold (empty cache) and warm (every file unchanged), with 60 `*-mod` status folders beside the captured run.
 *   npx -y tsx plugins/ruflo-console/scripts/bench-snapshot.mjs [iterations]
 */
import { readSnapshot } from '../hooks/data/snapshot.ts'
import { RUFLO_FILES } from '../tests/fixtures/ruflo-run.ts'

const N = Math.max(20, Number(process.argv[2]) || 300)
const NOW = Date.now()
/** @type {Record<string, string>} */
const files = Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))

for (let i = 0; i < 60; i++) {
  files[`/work/.claude-flow/m${i}-mod/status.json`] = JSON.stringify({ version: 1, guard: true, calls: i, blocked: i % 5, updatedMs: NOW - i * 1000, startedMs: NOW - 60_000 })
}

const counts = { stat: 0, read: 0, list: 0 }
const fs = {
  read: async (/** @type {string} */ path) => (counts.read++, files[path] ?? Promise.reject(new Error('ENOENT'))),
  stat: async (/** @type {string} */ path) => (counts.stat++, files[path] !== undefined ? { mtimeMs: 1, size: files[path].length } : Promise.reject(new Error('ENOENT'))),
  list: async (/** @type {string} */ path) => {
    counts.list++
    const prefix = `${path.replace(/\/+$/, '')}/`
    const names = new Set(Object.keys(files).filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))

    return [...names].map(name => ({ name, kind: files[`${prefix}${name}`] !== undefined ? 'file' : 'dir' }))
  },
}
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6
const stat = (/** @type {number[]} */ samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (/** @type {number} */ q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

  return `median ${at(0.5).toFixed(3)} ms · p99 ${at(0.99).toFixed(3)} ms`
}
const one = async (/** @type {Map<string, never>} */ cache) => {
  counts.stat = counts.read = counts.list = 0
  const start = process.hrtime.bigint()

  await readSnapshot(fs, cache, '/work', null, {}, NOW)

  return { took: ms(start), ...counts }
}

const cold = await one(new Map())
const cache = new Map()

await readSnapshot(fs, cache, '/work', null, {}, NOW)

const warm = await one(cache)

console.log(`cold refresh: ${cold.stat} stat · ${cold.read} read · ${cold.list} list = ${cold.stat + cold.read + cold.list} fs calls`)
console.log(`warm refresh: ${warm.stat} stat · ${warm.read} read · ${warm.list} list = ${warm.stat + warm.read + warm.list} fs calls (unchanged files are not re-read, but are re-parsed)`)

const coldTimes = []
const warmTimes = []

for (let i = 0; i < N; i++) {
  coldTimes.push((await one(new Map())).took)
  warmTimes.push((await one(cache)).took)
}

console.log(`parse+assemble, cold ${stat(coldTimes)}`)
console.log(`parse+assemble, warm ${stat(warmTimes)}`)
