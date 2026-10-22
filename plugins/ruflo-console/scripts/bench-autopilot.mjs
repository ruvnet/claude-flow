// @ts-check
/**
 * ADR-466 benchmark: the autopilot's pure core under the load a loop that runs for weeks puts on it. Plain node, every input is
 * generated here, nothing touches the project. Median and p99 wall time per case, plus approximate bytes allocated per call
 * (heapUsed delta after gc(); needs NODE_OPTIONS=--expose-gc, else n/a). Every case also prints a short digest of what it
 * computed, so a BEFORE and an AFTER run can be compared for the SAME answer, not only the same speed.
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-autopilot.mjs [--check]
 * `--check` exits 1 when a case misses its budget (the budgets are in BUDGET_MS below).
 * Cases: tick (the step machine, steps/s), journal parse + fold + encode + append at 8k lines (what one refresh replays: the
 * journal is rotated at ~1.2 MB) and at 100k lines (stress: the pure functions must stay linear), one refresh with an unchanged
 * journal (what the timer does every minute) and a state of 100k events replayed from a checkpoint.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hashOf, sha256 } from '../hooks/data/ap-envelope.ts'
import { appendArgv, encodeLine, parseJournal } from '../hooks/data/ap-journal.ts'
import * as loop from '../hooks/data/ap-loop.ts'

const { foldJournal, tick, snapshotEvents, summarize } = loop
const replayJournal = /** @type {((text: string) => {loop: unknown}) | undefined} */ (/** @type {Record<string, unknown>} */ (loop).replayJournal)
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)
const ms = (/** @type {bigint} */ start) => Number(process.hrtime.bigint() - start) / 1e6
const T0 = Date.parse('2026-10-06T00:00:00.000Z')
const H = 3_600_000
const failed = /** @type {string[]} */ ([])
const check = process.argv.includes('--check')
/** Budgets a loop that wakes once a minute can afford: the work of ONE timer tick, in ms (median). */
const BUDGET_MS = { 'replay 8k lines (parse+fold)': 40, 'refresh, journal unchanged (8k)': 1, 'tick (one pass)': 0.25, 'fold 100k lines': 400, 'parse 100k lines': 400 }

const digest = (/** @type {unknown} */ value) => sha256(JSON.stringify(value)).slice(0, 12)

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

  times.sort((a, b) => a - b)

  const median = times[Math.floor(times.length / 2)] ?? 0
  let bytes = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 3; i++) fn()
    bytes = `~${Math.round(Math.max(0, process.memoryUsage().heapUsed - before) / 3 / 1024)} KiB`
  }

  const budget = /** @type {Record<string, number>} */ (BUDGET_MS)[name]
  const over = budget !== undefined && median > budget

  if (over) failed.push(`${name}: median ${median.toFixed(3)} ms > ${budget} ms`)

  console.log(`${name.padEnd(36)} median ${median.toFixed(3).padStart(10)} ms · p99 ${(times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] ?? 0).toFixed(3).padStart(10)} ms · alloc/call ${bytes.padStart(10)} · digest ${show(out)}${over ? ' · OVER BUDGET' : ''}`)

  return out
}

const ENV = { name: 'night shift', toolClasses: ['edit', 'read', 'test'], paths: ['/work/repo'], repos: ['ruvnet/ruflo'], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 2, maxDurationMs: 90 * 24 * H, verify: [['true']], acceptWithoutAnatole: false }
const envHash = hashOf(/** @type {never} */ (ENV))

/** A journal of about `n` events, shaped like weeks of running: steps that start and finish, a failure now and then, parks and answers, beats. */
function journalOf(/** @type {number} */ n) {
  const events = /** @type {import('../hooks/data/ap-journal.ts').JournalEvent[]} */ ([{ t: 'start', at: T0, envHash, revision: 1, anatole: 'on' }])
  let at = T0
  let i = 0

  while (events.length < n) {
    at += 20_000
    i += 1

    const sid = `s-${String(i).padStart(16, '0')}`
    const task = `t${i}`

    events.push({ t: 'step.started', at, id: sid, task, cls: 'edit', attempt: 1, deadline: at + 600_000, tier: 'mid', par: 1 })
    events.push(i % 11 === 0 ? { t: 'step.failed', at: at + 5000, id: sid, why: 'timed out' } : { t: 'step.done', at: at + 5000, id: sid, verified: i % 7 !== 0 })

    if (i % 13 === 0) events.push({ t: 'parked', at, id: `p-${i}`, task: `u${i}`, question: 'which class is it?' })
    if (i % 13 === 0) events.push({ t: 'answered', at: at + 1, id: `p-${i}`, answer: i % 2 ? 'once' : 'deny' })
    if (i % 5 === 0) events.push({ t: 'beat', at })
  }

  return events.slice(0, n)
}

const text8k = journalOf(8000).map(encodeLine).join('')
const events100k = journalOf(100_000)
const text100k = events100k.map(encodeLine).join('')

console.log(`node ${process.version} · journal 8k = ${(text8k.length / 1024).toFixed(0)} KiB · 100k = ${(text100k.length / 1024 / 1024).toFixed(1)} MiB (the console rotates at ~1.2 MiB)`)

// 1. The journal.
const parsed8 = /** @type {ReturnType<typeof parseJournal>} */ (bench('parse 8k lines', () => parseJournal(text8k), 15, out => String(/** @type {{events: unknown[]}} */ (out).events.length)))

bench('fold 8k events', () => foldJournal(parsed8.events), 15, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))
bench('replay 8k lines (parse+fold)', () => foldJournal(parseJournal(text8k).events), 15, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))

// What the timer does every minute: the read cache hands back the same text, so a journal that did not change is not replayed (absent before ADR-466 bench work: the line above is what it cost).
if (replayJournal !== undefined) bench('refresh, journal unchanged (8k)', () => replayJournal(text8k).loop, 50, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))

const parsed100 = /** @type {ReturnType<typeof parseJournal>} */ (bench('parse 100k lines', () => parseJournal(text100k), 5, out => String(/** @type {{events: unknown[]}} */ (out).events.length)))

bench('fold 100k lines', () => foldJournal(parsed100.events), 3, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))

// A checkpoint, then the next 100 events on top of it: what appendEvents does after every write.
const base = foldJournal(parsed100.events.slice(0, 99_900))

bench('fold 100 events onto a checkpoint', () => foldJournal(parsed100.events.slice(99_900), base), 30, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))

// 2. Encoding and appending.
bench('encodeLine x 1000', () => parsed100.events.slice(0, 1000).map(encodeLine).join('').length, 15, String)
bench('encodeLine x 100k', () => parsed100.events.map(encodeLine).join('').length, 3, String)

const dir = mkdtempSync(join(tmpdir(), 'ap-bench-'))

try {
  const file = join(dir, 'journal.jsonl')

  writeFileSync(file, '')

  // The console writes through `dd oflag=append` (a spawn per batch); this is the floor: the same bytes through one O_APPEND write.
  bench('append 100 events (O_APPEND floor)', () => (appendFileSync(file, parsed100.events.slice(0, 100).map(encodeLine).join('')), 100), 15, String)
  console.log(`${'append argv'.padEnd(36)} ${JSON.stringify(appendArgv('/j'))}`)
  bench('read + replay the appended file', () => foldJournal(parseJournal(readFileSync(file, 'utf8')).events), 7, out => digest(summarize(/** @type {never} */ (out), T0 + 90 * 24 * H)))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// 3. The step machine.
const facts = (/** @type {Record<string, unknown>} */ over = {}) => ({ nowMs: T0 + 5 * H, killSeen: false, envelope: ENV, anatole: 'on', spend: { hourUsd: 0, dayUsd: 0, totalUsd: 1 }, task: { id: 'tx', title: 'do tx', cls: 'edit', hardDeny: null, path: '/work/repo/src/a.ts' }, effects: {}, orphans: new Set(), tunables: { parallelism: 1, retries: 1, stepTimeoutMs: 600_000, tierOf: () => 'mid' }, preflight: {}, ...over })
const running = foldJournal([{ t: 'start', at: T0, envHash, revision: 1, anatole: 'on' }])
const busy = foldJournal(parsed8.events)

bench('tick (one pass)', () => tick(running, /** @type {never} */ (facts())), 200, out => digest(/** @type {{status: string}} */ (out).status))
bench('tick over 8k-event state', () => tick(busy, /** @type {never} */ (facts({ nowMs: T0 + 90 * 24 * H - H, task: { id: 'tz', title: 'do tz', cls: 'edit', hardDeny: null, path: '/work/repo/src/a.ts' } }))), 200, out => digest(/** @type {{status: string}} */ (out).status))

// Throughput: a tick, its events folded back, repeated; each step is done the next tick.
const throughput = (/** @type {number} */ steps) => {
  let s = running
  let at = T0 + H
  let done = 0

  for (let i = 0; i < steps; i++) {
    const open = s.steps.filter(step => step.status === 'started')
    const effects = Object.fromEntries(open.map(step => [step.id, 'done']))
    const d = tick(s, /** @type {never} */ (facts({ nowMs: at, effects, task: { id: `x${i}`, title: `do x${i}`, cls: 'edit', hardDeny: null, path: '/work/repo/src/a.ts' }, spend: { hourUsd: 0, dayUsd: 0, totalUsd: 1 } })))

    s = foldJournal(d.events, s)
    done += d.act === null ? 0 : 1
    at += 1000
  }

  return { done, phase: s.phase, steps: s.steps.length }
}
const started = process.hrtime.bigint()
const out = throughput(20_000)
const took = ms(started)

console.log(`${'step machine, tick+fold x 20000'.padEnd(36)} ${took.toFixed(1)} ms total · ${Math.round(20_000 / (took / 1000))} ticks/s · digest ${digest(out)} (${JSON.stringify(out)})`)

// 4. Memory of a long state: a replay of 100k events keeps KEEP_STEPS finished steps, not 33k.
const long = foldJournal(parsed100.events)

console.log(`${'state after 100k events'.padEnd(36)} steps kept ${long.steps.length} · parked ${long.parked.length} · receipts ${long.receipts.length} · snapshot ${snapshotEvents(long).length} events`)

if (check && failed.length > 0) {
  console.error(`over budget:\n  ${failed.join('\n  ')}`)
  process.exit(1)
}
