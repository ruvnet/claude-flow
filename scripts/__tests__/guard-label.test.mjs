#!/usr/bin/env node
/**
 * Overlapping `memory_store` guards (variant B): every guard keeps refusing a secret in any namespace, but a domain plugin that does not own
 * the target namespace must not claim the write or name itself its owner, and must never echo content. Plugin tests cannot import across
 * plugin folders, so the guards are bundled here.
 *
 * Run via:  node --test scripts/__tests__/guard-label.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const tmp = mkdtempSync(join(tmpdir(), 'guard-label-test-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

function esbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD
  const roots = [REPO]
  try { roots.push(dirname(resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()))) } catch { /* not a git checkout */ }
  for (const r of roots) { const p = join(r, 'node_modules', '.bin', 'esbuild'); if (existsSync(p)) return p }
  throw new Error('esbuild not found (set ESBUILD=/path/to/esbuild)')
}

const WITH_STATS = ['music', 'neural-trader', 'migrations', 'observability']
const NAMES = ['agentdb', 'rag-memory', ...WITH_STATS, 'rvf', 'ruvector']
const id = n => n.replace('-', '_')
const entry = NAMES.map(n => {
  const g = JSON.stringify(join(REPO, 'plugins', `ruflo-${n}`, 'hooks', 'guard.ts'))
  return WITH_STATS.includes(n)
    ? `import { verdict as v_${id(n)} } from ${g}\nimport { newStats as s_${id(n)} } from ${JSON.stringify(join(REPO, 'plugins', `ruflo-${n}`, 'hooks', 'status.ts'))}`
    : `import { verdict as v_${id(n)} } from ${g}`
}).join('\n') + `\nexport const guards = {\n${NAMES.map(n =>
  WITH_STATS.includes(n) ? `  'ruflo-${n}': (t: string, i: unknown) => v_${id(n)}(t, i, {} as never, s_${id(n)}()),` : `  'ruflo-${n}': (t: string, i: unknown) => v_${id(n)}(t, i),`
).join('\n')}\n}\n`
writeFileSync(join(tmp, 'entry.ts'), entry)
execFileSync(esbuild(), [join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${join(tmp, 'guards.mjs')}`, '--log-level=error'])
const { guards } = await import(pathToFileURL(join(tmp, 'guards.mjs')).href)

const SECRET = ['ghp', 'a1B2'.repeat(10)].join('_') // built, never a literal
const TOOL = 'mcp__plugin_ruflo-core_ruflo__memory_store'
const write = (namespace, value = SECRET) => ({ key: 'k', ...(namespace === undefined ? {} : { namespace }), value })

const OWNER = {
  'ruflo-music': 'music-briefs',
  'ruflo-neural-trader': 'trading-risk',
  'ruflo-migrations': 'migrations',
  'ruflo-observability': 'observability-traces',
  'ruflo-rvf': 'rvf-sessions',
  'ruflo-ruvector': 'vector-patterns',
}
// Wording that claims the write or the owner's domain; the foreign-namespace message must carry none of it.
const OWNER_WORDING = /this (?:call|prompt|lyrics|memory write|telemetry write)|music service|broker|migration name|database URL|span, log|vector store|shared brain/

for (const name of NAMES.map(n => `ruflo-${n}`)) {
  test(`${name}: refuses a secret in every namespace shape, and a clean write goes through`, () => {
    for (const ns of [...Object.values(OWNER), 'unowned-ns', undefined, '']) {
      for (const input of [write(ns), { input: write(ns) }]) {
        assert.ok(guards[name](TOOL, input), `${name} let a secret through (ns=${ns})`)
        assert.equal(guards[name](TOOL, input).includes(SECRET), false)
      }
      assert.equal(guards[name](TOOL, write(ns, 'a note about the weekly review')), undefined)
    }
  })
}

for (const [name, ns] of Object.entries(OWNER)) {
  test(`${name}: own namespace (${ns}) keeps its own wording`, () => {
    const reason = guards[name](TOOL, write(ns))
    assert.ok(reason.startsWith(`${name}:`) && !reason.includes('secret-shaped'), reason)
  })

  test(`${name}: a foreign or missing namespace gets a neutral message naming the target, no owner wording, no content`, () => {
    for (const other of ['unowned-ns', undefined, ...Object.values(OWNER).filter(o => o !== ns)]) {
      const reason = guards[name](TOOL, write(other))
      assert.ok(reason.startsWith(`${name}:`), reason)
      assert.match(reason, /secret-shaped value/)
      assert.match(reason, other === undefined ? /no namespace/ : new RegExp(`namespace "${other}"`))
      assert.doesNotMatch(reason, OWNER_WORDING)
      assert.match(reason, /reference/)
      assert.equal(reason.includes(SECRET), false)
    }
  })

  test(`${name}: the namespace is cut, stripped, and dropped when secret-shaped`, () => {
    assert.match(guards[name](TOOL, write('a b\u0000c' + 'z'.repeat(80))), /namespace "abc[z]{37}"/)
    const leaky = guards[name](TOOL, write(SECRET))
    assert.ok(leaky && !leaky.includes('ghp_'), leaky)
  })

  test(`${name}: the other writers keep their existing message`, () => {
    const reason = guards[name]('mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store', write('unowned-ns'))
    if (reason !== undefined) assert.doesNotMatch(reason, /secret-shaped value/)
  })
}
