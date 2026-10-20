#!/usr/bin/env node
/**
 * Regenerates the machine-checkable half of the mod capability matrix
 * (v3/docs/validation/mod-capability-review-2026-10.md) as JSON on stdout.
 *
 *   node scripts/mod-capability-matrix.mjs [--plugins-dir plugins] [--counts counts.json]
 *
 * Reads only files: each plugin's .claude-plugin/plugin.json (version, userConfig keys and defaults),
 * hooks/hooks.json (modules, classic fallback) and the hooks/*.ts sources (events, commands, status
 * paths, guarded tool names). `--counts` is a JSON object `{ "<plugin>": <test count> }` measured by
 * the caller (`claude plugin test` / vitest); without it every count is null, never a guess.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Files that the per-plugin mod generator copied; the groups are the copy-drift report. */
export const SHARED_FILES = ['screen.ts', 'status.ts', 'command.ts', 'options.ts', 'guard.ts']

const EVENT_RE = /\bon\(\s*'([a-z]+\.[a-z.]+)'/g
const COMMAND_RUN_RE = /\bon\(\s*'command\.run'\s*,\s*\{\s*command:\s*'([^']+)'/g
const COMMAND_REG_RE = /command\.register\(\s*\{\s*name:\s*'([^']+)'/g
const STATUS_WRITE_RE = /STATUS_PATH\s*=\s*'([^']+)'/g
const STATUS_ANY_RE = /'(\.claude-flow\/[a-z0-9-]+-mod\/status\.json)'/g
const TOOL_RE = /['"`]((?:mcp__[a-z0-9-]+__)?[a-z][a-z0-9]*_[a-z0-9_-]*[a-z0-9])['"`]/g

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Every non-test .ts file under `dir`, recursively, as repo-relative-to-dir paths. */
export function sourceFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === 'node_modules' || name === 'tests') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

const all = (re, text) => [...text.matchAll(re)].map((m) => m[1] ?? m[2])
const uniq = (xs) => [...new Set(xs)].sort()
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** Test files of a plugin: the mod tests under tests/ plus any hooks/**\/*.test.ts. */
export function testFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === 'node_modules') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.test\.(ts|mjs|js)$/.test(name)) out.push(relative(dir, p))
    }
  }
  if (existsSync(join(dir, 'tests'))) walk(join(dir, 'tests'))
  return out
}

/** `test('name'` and `it('name'` titles in a test file: what the matrix cites as proof. */
export function testTitles(file) {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2])
}

/** Everything the matrix records about one plugin directory. */
export function scanPlugin(dir) {
  const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json')) ?? {}
  const hooksJson = readJson(join(dir, 'hooks', 'hooks.json'))
  const modules = Array.isArray(hooksJson?.modules) ? hooksJson.modules : []
  const sources = sourceFiles(join(dir, 'hooks'))
  const events = {}
  const commands = { run: [], registered: [] }
  const statusPaths = []
  const statusRefs = []
  const guardTools = []
  let loc = 0
  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(join(dir, 'hooks'), file)
    loc += text.split('\n').length
    for (const e of all(EVENT_RE, text)) (events[e] ??= []).push(rel)
    commands.run.push(...all(COMMAND_RUN_RE, text))
    commands.registered.push(...all(COMMAND_REG_RE, text))
    statusPaths.push(...all(STATUS_WRITE_RE, text))
    statusRefs.push(...all(STATUS_ANY_RE, text))
    if (/(^|\/)guard\//.test(rel) || /(^|\/)guard\.ts$/.test(rel)) guardTools.push(...all(TOOL_RE, text).filter((t) => /^(mcp__|[a-z]+_[a-z])/.test(t) && !t.startsWith('claude_')))
  }
  for (const k of Object.keys(events)) events[k] = uniq(events[k])
  const userConfig = {}
  for (const [key, spec] of Object.entries(manifest.userConfig ?? {})) userConfig[key] = { type: spec.type ?? null, default: spec.default ?? null }
  return {
    name: manifest.name ?? null,
    version: manifest.version ?? null,
    isMod: modules.length > 0,
    modules,
    classicFallback: Boolean(hooksJson?.hooks),
    events,
    commands: { run: uniq(commands.run), registered: uniq(commands.registered) },
    statusPaths: uniq(statusPaths),
    statusReads: uniq(statusRefs.filter((p) => !statusPaths.includes(p))),
    guardTools: uniq(guardTools),
    userConfig,
    sourceFiles: sources.map((f) => relative(join(dir, 'hooks'), f)).sort(),
    hookLoc: loc,
    testFiles: testFiles(dir),
  }
}

/** Groups plugin names by identical content of `file`; the biggest group is the generator's output, the rest drifted. */
export function duplicateGroups(pluginsDir, plugins, file) {
  const groups = new Map()
  for (const p of plugins) {
    const path = join(pluginsDir, p, 'hooks', file)
    if (!existsSync(path)) continue
    const h = sha(readFileSync(path, 'utf8'))
    groups.set(h, [...(groups.get(h) ?? []), p])
  }
  return [...groups.entries()].map(([hash, names]) => ({ hash, plugins: names.sort() })).sort((a, b) => b.plugins.length - a.plugins.length)
}

/** Names claimed by more than one plugin, for a map of `plugin -> names[]`. */
export function collisions(byPlugin) {
  const seen = new Map()
  for (const [plugin, names] of Object.entries(byPlugin)) for (const n of new Set(names)) seen.set(n, [...(seen.get(n) ?? []), plugin])
  return Object.fromEntries([...seen.entries()].filter(([, ps]) => ps.length > 1).sort(([a], [b]) => a.localeCompare(b)))
}

/** Builds the whole matrix for a plugins directory; `counts` maps plugin name to a measured test count. */
export function buildMatrix(pluginsDir, counts = {}) {
  const names = readdirSync(pluginsDir).filter((n) => !n.startsWith('.') && statSync(join(pluginsDir, n)).isDirectory()).sort()
  const rows = {}
  for (const n of names) {
    const row = scanPlugin(join(pluginsDir, n))
    row.testCount = Object.hasOwn(counts, n) ? counts[n] : null
    rows[n] = row
  }
  const mods = names.filter((n) => rows[n].isMod)
  const by = (pick) => Object.fromEntries(mods.map((n) => [n, pick(rows[n])]))
  const eventTotals = {}
  for (const n of mods) for (const e of Object.keys(rows[n].events)) eventTotals[e] = (eventTotals[e] ?? 0) + 1
  return {
    schema: 1,
    summary: {
      plugins: names.length,
      mods: mods.length,
      withoutMod: names.filter((n) => !rows[n].isMod),
      pluginsWithToolCallHook: mods.filter((n) => rows[n].events['tool.call']).length,
      eventTotals,
      testCountsSupplied: Object.keys(counts).length,
    },
    collisions: {
      commandNames: collisions(by((r) => [...r.commands.run, ...r.commands.registered])),
      statusPaths: collisions(by((r) => r.statusPaths)),
      userConfigKeys: collisions(by((r) => Object.keys(r.userConfig))),
      guardedTools: collisions(by((r) => r.guardTools)),
    },
    duplicates: Object.fromEntries(SHARED_FILES.map((f) => [f, duplicateGroups(pluginsDir, mods, f)])),
    plugins: rows,
  }
}

function parseArgs(argv) {
  const args = { pluginsDir: 'plugins', counts: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plugins-dir') args.pluginsDir = argv[++i]
    else if (argv[i] === '--counts') args.counts = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const counts = args.counts ? readJson(args.counts) : {}
  if (counts === undefined) throw new Error(`cannot read counts file: ${args.counts}`)
  process.stdout.write(`${JSON.stringify(buildMatrix(resolve(args.pluginsDir), counts), null, 2)}\n`)
}
