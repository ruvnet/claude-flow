// @ts-check
/**
 * Startup cost, plugin side and engine side, for ONE tree (run it once per tree and compare):
 *   bun plugins/ruflo-console/scripts/bench-startup.mjs [--tree <plugin dir>] [--engine] [--runs N]
 *
 * In-process (bun): import time of hooks/register.ts, one readSnapshot (cold / warm) over the in-memory fixture fs, and one
 * overview paneView. This is the work the plugin itself does.
 * --engine: copies the tree to a temp folder with a one-test probe, runs it through the engine's own child
 * (`claude plugin test --file`), and reports per run: `start` (the first $.session.start, which includes the engine
 * transpiling, scanning and linking the whole statically imported module graph before register runs), `plugin` (register
 * to the end of session.start, measured inside the hook), mount (first Pane render) and the fs/process round trips.
 * The engine refuses dynamic import(), so the graph cannot be loaded lazily: `start` grows with the AST size of what
 * hooks/register.ts reaches by value, which the `graph` line prints (modules and AST nodes, type positions not counted).
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => args.indexOf(name)
const tree = resolve(flag('--tree') >= 0 ? (args[flag('--tree') + 1] ?? '.') : join(dirname(fileURLToPath(import.meta.url)), '..'))
const runs = Math.max(2, Number(flag('--runs') >= 0 ? args[flag('--runs') + 1] : 5) || 5)
const ms = (/** @type {number} */ t) => performance.now() - t
const median = (/** @type {number[]} */ xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const row = (/** @type {string} */ name, /** @type {number[]} */ xs) => console.log(`${name.padEnd(34)} median ${median(xs).toFixed(1)} ms  min ${Math.min(...xs).toFixed(1)}  max ${Math.max(...xs).toFixed(1)}`)

/** Modules and AST nodes the entry reaches by value import: what the engine scans on every load. Needs `typescript` (the repo's). */
async function graph() {
  let ts
  try {
    ts = createRequire(import.meta.url)(process.env.TS_PATH ?? 'typescript')
  } catch {
    return console.log('graph                              (typescript not resolvable; set TS_PATH=/path/to/typescript; skipped)')
  }
  const seen = new Map()
  const walk = (/** @type {string} */ file) => {
    if (seen.has(file)) return
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true)
    let nodes = 0
    const count = (/** @type {any} */ node) => {
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
      nodes++
      ts.forEachChild(node, count)
    }

    count(sf)
    seen.set(file, nodes)
    for (const s of sf.statements) {
      if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || s.moduleSpecifier === undefined) continue
      if ((ts.isImportDeclaration(s) && s.importClause?.isTypeOnly) || (ts.isExportDeclaration(s) && s.isTypeOnly)) continue

      const spec = /** @type {any} */ (s.moduleSpecifier).text
      if (!spec.startsWith('.')) continue

      const base = resolve(dirname(file), spec)
      const hit = [`${base}.ts`, join(base, 'index.ts')].find(existsSync)

      if (hit !== undefined) walk(hit)
    }
  }

  walk(join(tree, 'hooks/register.ts'))
  console.log(`graph                              ${seen.size} modules, ${[...seen.values()].reduce((a, b) => a + b, 0)} AST nodes (value-reachable from register.ts)`)
}

async function inProcess() {
  const fx = await import(pathToFileURL(join(tree, 'tests/fixtures/ruflo-run.ts')).href)
  const importMs = []

  // One fresh process per sample would be exact; a module is cached after its first import, so the import is timed once.
  let t = performance.now()
  await import(pathToFileURL(join(tree, 'hooks/register.ts')).href)
  importMs.push(ms(t))
  console.log(`import hooks/register.ts (bun)     ${importMs[0]?.toFixed(1)} ms (cold, once)`)

  const { readSnapshot } = await import(pathToFileURL(join(tree, 'hooks/data/snapshot.ts')).href)
  const { newState } = await import(pathToFileURL(join(tree, 'hooks/state.ts')).href)
  const { paneView } = await import(pathToFileURL(join(tree, 'hooks/views/pane.ts')).href)
  const { picturesOf } = await import(pathToFileURL(join(tree, 'hooks/views/frames.ts')).href)
  const files = Object.fromEntries(Object.entries(fx.RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))
  const fs = {
    read: async (/** @type {string} */ path) => files[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async (/** @type {string} */ path) => (files[path] !== undefined ? { mtimeMs: 1, size: /** @type {string} */ (files[path]).length } : Promise.reject(new Error('ENOENT'))),
    list: async () => [],
  }
  const element = (/** @type {string} */ type) => (/** @type {any} */ props) => ({ type, props })
  const kit = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster') }
  const act = new Proxy({}, { get: () => () => undefined })
  const state = newState({})
  const cold = []
  const warm = []
  const render = []

  state.cwd = '/work'
  state.view = 'overview'
  for (let i = 0; i < 60; i++) {
    t = performance.now()
    state.snapshot = await readSnapshot(fs, new Map(), '/work', null, {}, Date.now())
    cold.push(ms(t))
    t = performance.now()
    await readSnapshot(fs, state.cache, '/work', null, {}, Date.now())
    warm.push(ms(t))
    t = performance.now()
    paneView({ kit, state, nowMs: Date.now(), columns: 110, pictures: picturesOf(state, 110, Date.now(), Date.now()), act })
    render.push(ms(t))
  }

  row('readSnapshot cold (every file)', cold)
  row('readSnapshot warm (cached)', warm)
  row('overview paneView + pictures', render)
}

function engine() {
  const dir = mkdtempSync(join(tmpdir(), 'bench-startup-'))

  try {
    for (const entry of ['hooks', 'types', 'tsconfig.json']) if (existsSync(join(tree, entry))) cpSync(join(tree, entry), join(dir, entry), { recursive: true })
    cpSync(join(tree, 'tests/fixtures'), join(dir, 'tests/fixtures'), { recursive: true })
    writeFileSync(
      join(dir, 'tests/probe.test.ts'),
      `import { describe, mock, test } from 'claude-code/testing'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, paneAt, PLUGIN, SESSION, worldOf } from './fixtures/world'
const lap = (t: number) => (performance.now() - t).toFixed(1)
describe('probe', () => {
  for (let i = 0; i < ${runs}; i++) test('run ' + i, { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    let t = performance.now()
    await $.session.start(SESSION)
    const start = lap(t)
    await $.command.run(command('overview'))
    t = performance.now()
    const pane = await $.ui.mount({ ...paneAt(160), plugin: PLUGIN })
    await pane.drawn()
    console.log('PROBE start=' + start + ' mount=' + lap(t) + ' reads=' + world.reads.length + ' stats=' + world.stats.length + ' runs=' + world.runs.length)
    await pane.unmount()
  })
})
`,
    )

    const ran = spawnSync('claude', ['plugin', 'test', dir, '--timeout', '90000'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    const out = `${ran.stdout}\n${ran.stderr}`
    const probes = [...out.matchAll(/PROBE start=([\d.]+) mount=([\d.]+) reads=(\d+) stats=(\d+) runs=(\d+)/g)]
    const col = (/** @type {number} */ n) => probes.map(m => Number(m[n]))

    if (probes.length === 0) return console.log(out.slice(-2000))
    row('engine: first session.start', col(1).slice(1)) // the first run of a fresh child also pays one-time engine warm-up
    row('engine: first session.start (run 0)', col(1).slice(0, 1))
    row('engine: mount + first draw', col(2))
    console.log(`round trips per start              fs.read ${probes[0]?.[3]} · fs.stat ${probes[0]?.[4]} · process.run ${probes[0]?.[5]}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`tree ${tree}`)
await graph()
await inProcess()
if (args.includes('--engine')) engine()
