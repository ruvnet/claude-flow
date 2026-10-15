// @ts-check
/**
 * ADR-456 benchmark: the recall feature's data functions and row render at 1k and 10k ranked entries (the neural store is
 * capped at 1000 patterns by the parser, so it is the same at both sizes). Median wall ms over N runs per step, and
 * approximate bytes allocated per call (heapUsed delta after gc(); NODE_OPTIONS=--expose-gc, else n/a).
 *   NODE_OPTIONS=--expose-gc npx -y tsx plugins/ruflo-console/scripts/bench-recall.mjs [runs] [--profile]
 * The ranked file is bounded by READ_MAX (2 MB) in the console, so the 10k size is also measured as raw text size.
 */
import { explainPrompt, lifecycleOrder, parseNeuralStore, parsePrompts, parseRanked, readRecall, wouldPrune } from '../hooks/data/recall.ts'
import { lifecycleRows, pickPrompt, recallRows } from '../hooks/views/recall-rows.ts'
import { newState } from '../hooks/state.ts'

const RUNS = Math.max(5, Number(process.argv[2]) || 30)
const NOW = 1_791_250_000_000
const VOCAB = Array.from({ length: 600 }, (_, i) => `term${(i * 7919).toString(36)}word`)
let seed = 42
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = () => VOCAB[Math.floor(rnd() * VOCAB.length)]

const rankedText = (/** @type {number} */ n) =>
  JSON.stringify({ computedAt: NOW - 5000, entries: Array.from({ length: n }, (_, i) => ({ id: `e-${i}`, summary: `pattern ${i} about ${pick()} and ${pick()}`, category: 'code', confidence: rnd(), pageRank: rnd() / 10, accessCount: i % 9, words: Array.from({ length: 12 }, pick) })) })
const neuralText = JSON.stringify({ patterns: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`p${i}`, { id: `pattern-${i}`, name: `n ${pick()}`, type: 'code', content: `content ${pick()} ${pick()}`, createdAt: new Date(NOW - i * 60_000).toISOString(), usageCount: i % 4, metadata: { verdict: 'success' } }])) })
const outcomesText = JSON.stringify({ outcomes: Array.from({ length: 500 }, (_, i) => ({ task: `task ${i % 40} ${pick()}`, agent: 'coder', success: i % 2 === 0, timestamp: new Date(NOW - i * 1000).toISOString() })) })
const PROMPT = `fix the ${pick()} handling in the ${pick()} ${pick()} module`

const median = (/** @type {number[]} */ xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const gc = /** @type {(() => void) | undefined} */ (globalThis.gc)

/** @returns {Promise<{ ms: number; kib: string }>} */
async function measure(/** @type {() => unknown} */ fn) {
  for (let i = 0; i < 3; i++) await fn()
  const times = []

  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()

    await fn()
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }

  let kib = 'n/a'

  if (gc !== undefined) {
    gc()
    const before = process.memoryUsage().heapUsed
    const reps = 10

    for (let i = 0; i < reps; i++) await fn()
    kib = `${Math.round((process.memoryUsage().heapUsed - before) / reps / 1024)}`
  }

  return { ms: median(times), kib }
}

const row = (/** @type {string} */ name, /** @type {{ ms: number; kib: string }} */ r) => console.log(`${name.padEnd(34)} median ${r.ms.toFixed(3).padStart(9)} ms · ~${r.kib.padStart(6)} KiB/call`)

const element = (/** @type {string} */ type) => (/** @type {Record<string, unknown>} */ props) => ({ type, props })
const kit = /** @type {never} */ ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input'), Raster: element('Raster') })
const act = /** @type {never} */ (new Proxy({}, { get: () => () => undefined }))

console.log(`runs per step: ${RUNS} · gc ${gc === undefined ? 'unavailable' : 'exposed'}`)

for (const size of [1000, 10_000]) {
  const text = rankedText(size)
  const ranked = parseRanked(text)

  if (ranked === null) throw new Error('ranked did not parse')

  const files = /** @type {Record<string, string>} */ ({ '/w/.claude-flow/data/ranked-context.json': text, '/w/.claude-flow/neural/models.json': neuralText, '/w/.claude-flow/routing-outcomes.json': outcomesText })
  const fs = {
    read: async (/** @type {string} */ p) => files[p] ?? Promise.reject(new Error('ENOENT')),
    stat: async (/** @type {string} */ p) => (files[p] !== undefined ? { mtimeMs: 1, size: files[p].length, kind: 'file' } : undefined),
    list: async () => [],
  }
  const cache = new Map()
  const facts = await readRecall(fs, cache, '/w')
  const state = newState({})

  state.cwd = '/w'
  state.snapshot = /** @type {never} */ ({ recall: { ...facts, ranked } })

  const ctx = /** @type {never} */ ({ kit, state, nowMs: NOW, columns: 140, pictures: new Map(), act })

  console.log(`\n== ${size} ranked entries (${(text.length / 1e6).toFixed(2)} MB of text${text.length > 2_000_000 ? ', over the 2 MB READ_MAX: the console would not read it' : ''}) ==`)
  row('parseRanked', await measure(() => parseRanked(text)))
  row('readRecall (cache warm, refresh)', await measure(() => readRecall(fs, cache, '/w')))
  let k = 0
  row('explainPrompt (same prompt, repeat)', await measure(() => explainPrompt(PROMPT, ranked.entries)))
  row('explainPrompt (new prompt each call)', await measure(() => explainPrompt(`${PROMPT} ${k++}x${pick()}`, ranked.entries)))
  row('parseNeuralStore (1000)', await measure(() => parseNeuralStore(neuralText)))
  row('parsePrompts (500)', await measure(() => parsePrompts(outcomesText)))
  row('lifecycleOrder + wouldPrune', await measure(() => { const p = parseNeuralStore(neuralText) ?? []; lifecycleOrder(p); wouldPrune(p, 1) }))
  pickPrompt(null)
  row('recallRows (no prompt picked)', await measure(() => recallRows(ctx)))
  pickPrompt(PROMPT)
  row('recallRows (prompt picked)', await measure(() => recallRows(ctx)))
  pickPrompt(null)
  row('lifecycleRows', await measure(() => lifecycleRows(ctx)))
}
