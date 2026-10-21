/**
 * Per-event latency of every plugin mod's registered hooks (W8, mod-hook-latency).
 *
 *   npx tsx scripts/bench-mod-hooks.mjs [--iters 5000] [--json] [--only ruflo-ddd,...]
 *
 * Each plugins/<p>/hooks/register.ts is loaded, its `register(on, {})` collects the handlers, and
 * the handlers matching an event are chained exactly like the engine does (outermost first, then a
 * core that returns the event). `$` is a fake whose ops resolve instantly, so the numbers are the
 * mod's own cost: no Claude Code dispatch, no worker hop, no real I/O. Events measured:
 *   tool.call (unrelated: Read, Bash)  tool.call (watched: names harvested from the plugin's hooks)
 *   session.start  prompt.submit  command.run (the plugin's registered command)
 * Output: median / p99 in microseconds per plugin per event, and the fleet cost of one unrelated tool.call.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const ITERS = Number(arg('iters', 5000))
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const JSON_OUT = process.argv.includes('--json')
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(REPO, 'plugins')

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
/** A `$` whose ops resolve at once: the fs is empty, everything else answers undefined / a small value. */
function fakeDollar() {
  const leaf = { read: () => Promise.reject(enoent()), stat: () => Promise.reject(enoent()), list: () => Promise.resolve([]) }
  const special = { 'session.root': () => '/work', 'clock.now': () => 1_700_000_000_000, 'settings.read': () => ({}), 'tool.list': () => [] }
  const mk = (path) => new Proxy(function () {}, {
    get: (_t, k) => (typeof k === 'string' ? mk(path ? `${path}.${k}` : k) : undefined),
    apply: (_t, _this, args) => {
      if (/(^|\.)(timer|every|after|interval)(\.|$)/.test(path)) return { cancel() {}, pause() {}, resume() {} }
      const f = special[path] ?? leaf[path.split('.').pop()]
      return Promise.resolve(f ? f(...args) : undefined)
    },
  })
  return mk('')
}

function matches(m, e) {
  if (!m) return true
  return Object.entries(m).every(([k, want]) => (want instanceof RegExp ? typeof e[k] === 'string' && want.test(e[k]) : Array.isArray(want) ? want.includes(e[k]) : e[k] === want))
}

function load(register) {
  const regs = []
  const on = (event, a, b) => {
    const r = b ? { event, matcher: a, hook: b } : { event, hook: a }
    regs.push(r)
    return { catch: (h) => { r.onCatch = h } }
  }
  register(on, {})
  const $ = fakeDollar()
  const dispatch = (event, e) => {
    const chain = regs.filter((r) => r.event === event && matches(r.matcher, e))
    const frozen = Object.freeze({ ...e })
    const run = (i, ev) => {
      if (i >= chain.length) return Promise.resolve(ev)
      return chain[i].hook($, frozen, (x) => run(i + 1, x))
    }
    return run(0, frozen)
  }
  return { regs, dispatch, count: (ev) => regs.filter((r) => r.event === ev).length }
}

/** Tool names a plugin's hooks mention: snake_case / dashed identifiers in quotes, plus the memory writers. */
function watchedNames(dir) {
  const names = new Set(['memory_store', 'agentdb_hierarchical-store'])
  for (const f of readdirSync(join(dir, 'hooks'))) {
    if (!f.endsWith('.ts') || f === 'screen.ts') continue
    for (const m of readFileSync(join(dir, 'hooks', f), 'utf8').matchAll(/'((?:[a-z]+_)+[a-z-]+|mcp__[\w-]+)'/g)) names.add(m[1])
  }
  return [...names].slice(0, 12)
}

async function time(fn) {
  for (let i = 0; i < 300; i++) await fn()
  const s = new Float64Array(ITERS)
  for (let i = 0; i < ITERS; i++) { const t = performance.now(); await fn(); s[i] = (performance.now() - t) * 1000 }
  s.sort()
  return { median: s[Math.floor(ITERS / 2)], p99: s[Math.floor(ITERS * 0.99)] }
}

const UNRELATED = [
  { tool: 'Read', file_path: '/work/src/index.ts', agentId: 'main' },
  { tool: 'Bash', command: 'ls -la /work && git status --short', agentId: 'main' },
]
/** An unrelated tool with a 200 KB payload: a hook that scans or stringifies the input for a tool it does not watch shows up here. */
const LARGE = { tool: 'Write', file_path: '/work/big.txt', content: 'lorem ipsum dolor sit amet '.repeat(7500), agentId: 'main' }
const START = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const PROMPT = { prompt: 'please fix the failing test in src/index.ts and explain why it broke', origin: { kind: 'composer' } }

/** The floor: an async hook that only calls next(e), so a mod's cost is read net of the harness. */
const floor = await time(async () => ((e, next) => next(e))({ tool: 'Read' }, async (x) => x))
const rows = []
const dirs = readdirSync(PLUGINS).filter((d) => existsSync(join(PLUGINS, d, 'hooks', 'register.ts')) && (!ONLY?.length || ONLY.includes(d)))
for (const d of dirs) {
  const row = { plugin: d }
  try {
    const mod = await import(pathToFileURL(join(PLUGINS, d, 'hooks', 'register.ts')).href)
    const m = load(mod.register)
    row.hooks = { 'tool.call': m.count('tool.call'), 'session.start': m.count('session.start'), 'prompt.submit': m.count('prompt.submit'), 'command.run': m.count('command.run') }
    await m.dispatch('session.start', START)
    const cmd = m.regs.find((r) => r.event === 'command.run' && r.matcher?.command)?.matcher.command
    if (m.count('tool.call')) {
      const un = []
      for (const e of UNRELATED) un.push(await time(() => m.dispatch('tool.call', e)))
      row['tool.call unrelated 200KB'] = await time(() => m.dispatch('tool.call', LARGE))
      row['tool.call unrelated'] = un.reduce((a, b) => (b.median > a.median ? b : a))
      let worst
      for (const name of watchedNames(join(PLUGINS, d))) {
        const e = { tool: name, key: 'ddd-sample', value: 'a note about the domain', agentId: 'main' }
        const t = await time(() => m.dispatch('tool.call', e))
        if (!worst || t.median > worst.median) worst = { ...t, tool: name }
      }
      row['tool.call watched'] = worst
    }
    if (m.count('session.start')) row['session.start'] = await time(() => m.dispatch('session.start', START))
    if (m.count('prompt.submit')) row['prompt.submit'] = await time(() => m.dispatch('prompt.submit', PROMPT))
    if (cmd) row['command.run'] = await time(() => m.dispatch('command.run', { command: cmd, args: 'status', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }))
  } catch (err) {
    row.error = String(err?.message ?? err).split('\n')[0]
  }
  rows.push(row)
}

const sum = (k) => rows.reduce((a, r) => a + (r[k]?.median ?? 0), 0)
const fleet = { plugins: rows.length, 'async no-op floor median/p99 (us)': [floor.median, floor.p99], 'tool.call unrelated median sum (us)': sum('tool.call unrelated'), 'tool.call unrelated 200KB median sum (us)': sum('tool.call unrelated 200KB'), 'tool.call unrelated p99 sum (us)': rows.reduce((a, r) => a + (r['tool.call unrelated']?.p99 ?? 0), 0) }
if (JSON_OUT) console.log(JSON.stringify({ iters: ITERS, rows, fleet }, null, 2))
else {
  const f = (t) => (t ? `${t.median.toFixed(1)}/${t.p99.toFixed(1)}` : '-')
  console.log(`median/p99 us, ${ITERS} iters\nplugin | unrelated | unrelated 200KB | watched | session.start | prompt.submit | command.run`)
  for (const r of rows) console.log(`${r.plugin} | ${r.error ? 'ERR ' + r.error : [f(r['tool.call unrelated']), f(r['tool.call unrelated 200KB']), f(r['tool.call watched']), f(r['session.start']), f(r['prompt.submit']), f(r['command.run'])].join(' | ')}`)
  console.log(JSON.stringify(fleet))
}
