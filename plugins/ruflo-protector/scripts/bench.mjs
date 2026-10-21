/**
 * Per-call cost of Project Anatole (ADR-453 section 12: median under 1 ms added per tool call).
 *
 *   npx tsx plugins/ruflo-protector/scripts/bench.mjs [--iters 5000] [--json]
 *
 * Loads hooks/register.ts, chains its `tool.check` hooks like the engine does (a core that answers `allow`), and times the whole chain with a `$`
 * whose ops resolve at once. The numbers are the mod's own cost: no Claude Code dispatch, no real I/O. Exit 1 when a median is over the budget.
 */
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const ITERS = Number(arg('iters', 5000))
const BUDGET_US = 1000
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const special = { 'session.root': () => '/work', 'clock.now': () => 1_700_000_000_000 }
const mk = (path) => new Proxy(function () {}, {
  get: (_t, k) => (typeof k === 'string' ? mk(path ? `${path}.${k}` : k) : undefined),
  apply: (_t, _this, args) => Promise.resolve(special[path]?.(...args) ?? (path.endsWith('read') ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) : undefined)),
})
const $ = mk('')

function load(register, options) {
  const regs = []
  const on = (event, a, b) => {
    const r = b ? { event, matcher: a, hook: b } : { event, hook: a }
    regs.push(r)
    return { catch: (h) => { r.onCatch = h } }
  }
  register(on, options)
  return (event, e) => {
    const chain = regs.filter((r) => r.event === event && (!r.matcher || Object.entries(r.matcher).every(([k, v]) => e[k] === v)))
    const run = (i, ev) => (i >= chain.length ? Promise.resolve({ decision: 'allow' }) : chain[i].hook($, ev, (x) => run(i + 1, x)))
    return run(0, e)
  }
}

async function time(fn) {
  for (let i = 0; i < 300; i++) await fn()
  const s = new Float64Array(ITERS)
  for (let i = 0; i < ITERS; i++) { const t = performance.now(); await fn(); s[i] = (performance.now() - t) * 1000 }
  s.sort()
  return { median: s[Math.floor(ITERS / 2)], p99: s[Math.floor(ITERS * 0.99)] }
}

const { register } = await import(pathToFileURL(join(HERE, 'hooks', 'register.ts')).href)
const CASES = {
  'Read': { tool: 'Read', input: { file_path: '/work/src/index.ts' } },
  'Bash (git status)': { tool: 'Bash', input: { command: 'ls -la /work && git status --short' } },
  'Bash (curl, network)': { tool: 'Bash', input: { command: 'curl -s -d x=1 https://api.example.com/v1/items' } },
  'Write 200KB': { tool: 'Write', input: { file_path: '/work/src/big.txt', content: 'lorem ipsum dolor sit amet '.repeat(7500) } },
}
const out = {}
for (const mode of ['learn', 'notify', 'enforce']) {
  const dispatch = load(register, { mode })
  await dispatch('session.start', { surface: 'terminal', isInteractive: true, cwd: '/work' })
  out[mode] = {}
  for (const [name, e] of Object.entries(CASES)) out[mode][name] = await time(() => dispatch('tool.check', e))
}
const worst = Math.max(...Object.values(out).flatMap((m) => Object.values(m).map((t) => t.median)))
if (process.argv.includes('--json')) console.log(JSON.stringify({ iters: ITERS, budgetUs: BUDGET_US, worstMedianUs: worst, out }, null, 2))
else {
  console.log(`tool.check chain, median/p99 microseconds, ${ITERS} iterations (budget: median under ${BUDGET_US})`)
  for (const [mode, m] of Object.entries(out)) for (const [name, t] of Object.entries(m)) console.log(`${mode.padEnd(8)} ${name.padEnd(22)} ${t.median.toFixed(1)} / ${t.p99.toFixed(1)}`)
  console.log(`worst median: ${worst.toFixed(1)} us`)
}
process.exit(worst < BUDGET_US ? 0 : 1)
