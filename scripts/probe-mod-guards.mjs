#!/usr/bin/env node
// probe-mod-guards — adversarial fleet probe for every plugins/*/hooks/guard.ts verdict function.
//
// Each guard is bundled with esbuild into a private temp dir, then run in a worker thread through a fixed corpus (see
// scripts/lib/guard-probe-corpus.mjs): secrets split by invisible/bidi characters, nested 5000 levels, in object keys, 1 MB strings,
// regex-DoS inputs (each call is timed: median of 3 > --budget-ms (1000, hang/backtracking gate) fails, > --advisory-ms (50) is reported as advisory slow), encodings, and benign look-alikes (must pass). A worker that hangs is
// killed by a watchdog and reported as a failure of the probe it was in.
//
// USAGE
//   node scripts/probe-mod-guards.mjs                        # full corpus, table, exit 1 on any `must` failure
//   node scripts/probe-mod-guards.mjs --fast                 # 64 KB inputs, one timing run: the smoke-path subset
//   node scripts/probe-mod-guards.mjs --only ruflo-adr,ruflo-rvf --verbose
//   node scripts/probe-mod-guards.mjs --known-holes scripts/probe-mod-guards.known-holes.json   # only NEW holes fail
//   node scripts/probe-mod-guards.mjs --write-known-holes <file>                               # record current holes
//   node scripts/probe-mod-guards.mjs --report <path.md>     # write the markdown report; if <path.md> already has a
//                                                            # `<!-- generated below` marker, only the part below it is replaced
//   node scripts/probe-mod-guards.mjs --strict               # advisory (encoding/confusable) misses fail too
//   node scripts/probe-mod-guards.mjs --plugins-dir <dir>    # probe <dir>/*/hooks/guard.ts (used by the tests)
//
// Exit codes: 0 ok · 1 a guard failed a `must` probe (beyond --known-holes) · 2 config error · 3 nothing to probe

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { renderReport } from './lib/guard-probe-report.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const WORKER = join(HERE, 'lib', 'guard-probe-worker.mjs')

const args = (() => {
  const a = { fast: false, format: 'table', only: null, verbose: false, pluginsDir: join(REPO, 'plugins'), report: null, knownHoles: null, writeKnownHoles: null, strict: false, budgetMs: 1000, advisoryMs: 50, watchdogMs: null, concurrency: Math.max(1, Math.min(4, cpus().length >> 1)) }
  const argv = process.argv.slice(2)
  const need = i => { if (argv[i + 1] === undefined) { console.error(`probe-mod-guards: ${argv[i]} needs a value`); process.exit(2) } return argv[i + 1] }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--fast') a.fast = true
    else if (v === '--verbose') a.verbose = true
    else if (v === '--strict') a.strict = true
    else if (v === '--format') a.format = need(i++)
    else if (v === '--only') a.only = new Set(need(i++).split(',').map(s => s.trim()).filter(Boolean))
    else if (v === '--plugins-dir') a.pluginsDir = resolve(need(i++))
    else if (v === '--report') a.report = resolve(need(i++))
    else if (v === '--known-holes') a.knownHoles = resolve(argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : join(HERE, 'probe-mod-guards.known-holes.json'))
    else if (v === '--write-known-holes') a.writeKnownHoles = resolve(need(i++))
    else if (v === '--budget-ms') a.budgetMs = Number(need(i++))
    else if (v === '--advisory-ms') a.advisoryMs = Number(need(i++))
    else if (v === '--watchdog-ms') a.watchdogMs = Number(need(i++))
    else if (v === '--concurrency') a.concurrency = Number(need(i++))
    else { console.error(`probe-mod-guards: unknown argument ${v}`); process.exit(2) }
  }
  if (!['table', 'json'].includes(a.format) || !(a.budgetMs > 0) || !(a.advisoryMs >= 0) || !(a.concurrency >= 1)) { console.error('probe-mod-guards: bad --format, --budget-ms or --concurrency'); process.exit(2) }
  a.watchdogMs ??= a.fast ? 30_000 : 60_000 // a hang gate, not a speed gate: calibration alone can take seconds on a loaded box
  return a
})()

/** esbuild from the repo, else from the main checkout when this is a worktree with no node_modules. */
function findEsbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD
  const roots = [REPO]
  try { roots.push(dirname(resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()))) } catch { /* not a git checkout */ }
  for (const r of roots) { const p = join(r, 'node_modules', '.bin', 'esbuild'); if (existsSync(p)) return p }
  console.error('probe-mod-guards: esbuild not found (set ESBUILD=/path/to/esbuild)')
  process.exit(2)
}

// Shapes the generic calibration cannot guess: servers a guard matches by substring, and tools matched by prefix/regex.
const SERVERS = ['plugin_ruflo-music_cogmusic', 'plugin_ruflo-core_ruflo', 'ruflo', 'claude-flow', 'ruflo-federation', 'plugin_ruflo-chatgpt-federation_chatgpt']
const STATIC_TOOLS = ['memory_store', 'agentdb_hierarchical-store', 'agentdb_causal-edge', 'agentdb_pattern-store', 'agentdb_batch', 'hooks_intelligence_pattern-store', 'hooks_transfer', 'hooks_worker-dispatch', 'sublinear_solve', 'channel_publish', 'workflow_create', 'federation_bbs_publish', 'browser_eval', 'browser_open', 'aidefence_learn', 'autopilot_log', 'analyze_diff', 'metaharness_flywheel', 'create_production', 'embeddings_generate', 'ruvllm_hnsw_add', 'neural_train', 'daa_knowledge_share', 'github_pr_manage', 'task_create', 'terminal_execute']

function toolsOf(guardSrc) {
  const out = new Set(STATIC_TOOLS)
  for (const m of guardSrc.matchAll(/['"`]([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)['"`]/g)) out.add(m[1])
  for (const m of guardSrc.matchAll(/(?:startsWith|includes)\((['"`])([a-z][a-z0-9_-]*[_-])\1\)/g)) out.add(`${m[2]}x`)
  for (const m of guardSrc.matchAll(/\^([a-z][a-z0-9]*)\[\/_-\]/g)) out.add(`${m[1]}_x`)
  for (const m of guardSrc.matchAll(/['"`]([a-z][a-z0-9]*_)['"`]/g)) out.add(`${m[1]}x`)
  return [...out]
}

function discover() {
  if (!existsSync(args.pluginsDir)) return []
  return readdirSync(args.pluginsDir)
    .filter(n => existsSync(join(args.pluginsDir, n, 'hooks', 'guard.ts')) && (!args.only || args.only.has(n)))
    .sort()
    .map(name => ({ name, dir: join(args.pluginsDir, name, 'hooks') }))
}

function bundle(esbuild, plugin, tmp) {
  const entry = join(tmp, `${plugin.name}.entry.ts`)
  const lines = [`export * as guard from ${JSON.stringify(join(plugin.dir, 'guard.ts'))}`]
  for (const f of ['options', 'status']) if (existsSync(join(plugin.dir, `${f}.ts`))) lines.push(`export * as ${f} from ${JSON.stringify(join(plugin.dir, `${f}.ts`))}`)
  writeFileSync(entry, lines.join('\n') + '\n')
  const out = join(tmp, `${plugin.name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: ['ignore', 'pipe', 'pipe'] })
  return out
}

/** Run one plugin's probes in a worker; a hung or crashed probe becomes a failure and the worker is restarted after it. */
async function runPlugin(plugin, bundled) {
  const guardSrc = readFileSync(join(plugin.dir, 'guard.ts'), 'utf8')
  const named = [...guardSrc.matchAll(/includes\((['"`])([a-z][^'"`]*)\1\)/g)].map(m => m[2])
  const job = { bundle: bundled, tools: toolsOf(guardSrc), servers: [...SERVERS, ...named], extra: [], fast: args.fast, budgetMs: args.budgetMs, advisoryMs: args.advisoryMs }
  const results = []
  const skip = []
  let meta = { calibrated: 0, chosen: [], timingTargets: 0 }
  for (let restarts = 0; restarts < 12; restarts++) {
    let current
    const outcome = await new Promise(res => {
      const w = new Worker(WORKER, { workerData: { ...job, skip }, resourceLimits: { maxOldGenerationSizeMb: 3072 } })
      let timer
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { void w.terminate(); res({ kind: 'hang' }) }, args.watchdogMs) }
      arm()
      w.on('message', m => {
        arm()
        if (m.type === 'start') current = m.id
        else if (m.type === 'result') { results.push(m); current = undefined }
        else if (m.type === 'meta') meta = m
        else if (m.type === 'fatal') { clearTimeout(timer); res({ kind: 'fatal', error: m.error }) }
        else if (m.type === 'done') { clearTimeout(timer); res({ kind: 'done' }) }
      })
      w.on('error', e => { clearTimeout(timer); res({ kind: 'crash', error: `${e?.name}: ${String(e?.message ?? e).slice(0, 100)}` }) })
      w.on('exit', () => { clearTimeout(timer); res({ kind: 'exit' }) })
    })
    if (outcome.kind === 'done') return { meta, results }
    if (outcome.kind === 'fatal') return { meta, results, fatal: outcome.error }
    if (current === undefined) return { meta, results, fatal: outcome.kind === 'hang' ? `worker hung > ${args.watchdogMs}ms before the first probe` : (outcome.error ?? 'worker exited early') }
    const note = outcome.kind === 'hang' ? `HANG: no answer within ${args.watchdogMs}ms (worker killed)` : `worker ${outcome.kind}: ${outcome.error ?? 'exited'}`
    results.push({ id: current, cls: current.startsWith('s-') ? 'stress' : 'evade', tier: 'must', status: 'fail', ms: args.watchdogMs, note })
    skip.push(current, ...results.map(r => r.id))
  }
  return { meta, results, fatal: 'too many worker restarts' }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }))
  return out
}

const plugins = discover()
if (plugins.length === 0) { console.error(`probe-mod-guards: no ${args.pluginsDir}/*/hooks/guard.ts found`); process.exit(3) }

const esbuild = findEsbuild()
const tmp = mkdtempSync(join(tmpdir(), 'probe-mod-guards-'))
const started = Date.now()
let rows
try {
  rows = await pool(plugins, args.concurrency, async p => {
    try { return { name: p.name, ...(await runPlugin(p, bundle(esbuild, p, tmp))) } } catch (e) {
      return { name: p.name, meta: { calibrated: 0, chosen: [], timingTargets: 0 }, results: [], fatal: `bundle failed: ${String(e?.stderr ?? e?.message ?? e).slice(0, 200)}` }
    }
  })
} finally { rmSync(tmp, { recursive: true, force: true }) }

// A hole is a failing `must` probe (or any failing/info probe under --strict), identified as "<plugin>:<probe>".
const isHole = r => r.status === 'fail' || (args.strict && r.status === 'info')
const holes = rows.flatMap(r => r.results.filter(isHole).map(x => `${r.name}:${x.id}`))
const known = args.knownHoles && existsSync(args.knownHoles) ? new Set(Object.entries(JSON.parse(readFileSync(args.knownHoles, 'utf8'))).flatMap(([p, ids]) => ids.map(i => `${p}:${i}`))) : new Set()
const fresh = holes.filter(h => !known.has(h))
// A baselined guard whose secret surface can no longer be found (it stopped refusing anything) must not read as 26 fixes: every evasion
// probe is then skipped. It is a failure, and "fixed" needs an actual pass.
for (const r of rows) {
  const listed = [...known].filter(k => k.startsWith(`${r.name}:`)).length
  if (listed > 0 && r.meta.calibrated === 0 && !r.fatal) r.fatal = `calibration lost: the baseline lists ${listed} holes but no secret surface was found (the guard stopped refusing secrets?)`
}
const ran = (k) => { const i = k.indexOf(':'); return rows.find(r => r.name === k.slice(0, i))?.results.some(x => x.id === k.slice(i + 1) && x.status === 'pass') }
const fixed = [...known].filter(ran)
const fatal = rows.filter(r => r.fatal)

if (args.writeKnownHoles) {
  const byPlugin = {}
  for (const h of holes) { const i = h.indexOf(':'); (byPlugin[h.slice(0, i)] ??= []).push(h.slice(i + 1)) }
  mkdirSync(dirname(args.writeKnownHoles), { recursive: true })
  writeFileSync(args.writeKnownHoles, JSON.stringify(byPlugin, null, 1) + '\n')
}
if (args.report) {
  mkdirSync(dirname(args.report), { recursive: true })
  const generated = renderReport({ rows, args: { fast: args.fast, budgetMs: args.budgetMs, advisoryMs: args.advisoryMs }, startedMs: started })
  const MARK = '<!-- generated below'
  const prior = existsSync(args.report) ? readFileSync(args.report, 'utf8') : ''
  const at = prior.indexOf(MARK)
  writeFileSync(args.report, at < 0 ? generated : `${prior.slice(0, prior.indexOf('\n', at) + 1)}\n${generated}`)
}

if (args.format === 'json') {
  console.log(JSON.stringify({ rows, holes, newHoles: fresh, fixedKnownHoles: fixed, fatal: fatal.map(f => ({ plugin: f.name, error: f.fatal })) }, null, 1))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`probe-mod-guards: ${rows.length} guards, ${args.fast ? 'fast' : 'full'} corpus, hang gate ${args.budgetMs}ms/call (median of 3), advisory ${args.advisoryMs}ms, ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  console.log(`${pad('plugin', 26)} ${pad('surface (tool.field)', 44)} ${pad('pass', 5)} ${pad('fail', 5)} ${pad('info', 5)} ${pad('skip', 5)} worst-ms`)
  for (const r of rows) {
    const c = s => r.results.filter(x => x.status === s).length
    const worst = r.results.reduce((m, x) => (x.status === 'skip' ? m : x.ms > m.ms ? x : m), { ms: 0, id: '-' })
    const surface = r.meta.chosen.length ? r.meta.chosen.map(x => x.at).join(', ') : r.fatal ? `FATAL ${r.fatal}` : 'none (policy guard / no secret surface)'
    console.log(`${pad(r.name, 26)} ${pad(surface.length > 43 ? `${surface.slice(0, 42)}…` : surface, 44)} ${pad(c('pass'), 5)} ${pad(c('fail'), 5)} ${pad(c('info'), 5)} ${pad(c('skip'), 5)} ${worst.ms.toFixed(1)} (${worst.id})`)
    for (const x of r.results) {
      if (args.verbose || x.note?.startsWith('advisory slow') || (isHole(x) && !known.has(`${r.name}:${x.id}`))) console.log(`    ${pad(x.status.toUpperCase(), 5)} ${pad(x.id, 24)} ${pad(x.ms.toFixed(1) + 'ms', 10)} ${(x.note ?? '').slice(0, 120)}`)
    }
  }
  const total = rows.reduce((n, r) => n + r.results.length, 0)
  console.log(`\n${total} probe runs · ${holes.length} holes (${holes.length - fresh.length} known, ${fresh.length} new) · ${fixed.length} known holes now fixed · ${fatal.length} fatal`)
  if (fixed.length) console.log(`known holes that now pass (remove from the baseline): ${fixed.slice(0, 10).join(', ')}${fixed.length > 10 ? ', …' : ''}`)
  if (fatal.length) for (const f of fatal) console.log(`  FATAL ${f.name}: ${f.fatal}`)
}
process.exitCode = fresh.length > 0 || fatal.length > 0 ? 1 : 0 // not process.exit(): it can truncate a large JSON write to a pipe
