#!/usr/bin/env node
/**
 * Tests for scripts/probe-mod-guards.mjs against synthetic guards: a naive one (depth/size caps, values only, no invisible-character
 * stripping) that the probe must flag, and a screening one it must pass. Also pins the CLI contract (exit codes, baseline handling)
 * and that the corpus never carries a secret-shaped literal.
 *
 * Run via:  node --test scripts/__tests__/probe-mod-guards.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_SECRETS, BENIGN, SECRET_TYPES, evasionProbes, stressProbes } from '../lib/guard-probe-corpus.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'probe-mod-guards.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'probe-mod-guards-test-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

const SECRET_RE = String.raw`/(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|sk-(?:ant-)?[A-Za-z0-9_-]{24,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|api_?key\s*[:=]\s*[A-Za-z0-9/+=_.-]{16,})/i`

const NAIVE = `
const SECRET = ${SECRET_RE}
const texts = (v: unknown, depth = 0): string[] =>
  depth > 3 ? [] : typeof v === 'string' ? [v.slice(0, 5000)] : Array.isArray(v) ? v.slice(0, 20).flatMap(x => texts(x, depth + 1)) :
  typeof v === 'object' && v !== null ? Object.values(v).slice(0, 20).flatMap(x => texts(x, depth + 1)) : []
export function verdict(tool: string, input: unknown): string | undefined {
  if (tool !== 'memory_store') return undefined
  return texts(input).some(t => SECRET.test(t)) ? 'naive: secret' : undefined
}
`

const SCREENING = `
const SECRET = ${SECRET_RE}
const HIDDEN = /[\\p{Cf}\\u034f]/gu
const MAX_NODES = 20000
const MAX_CHARS = 8_000_000
export function verdict(tool: string, input: unknown): string | undefined {
  if (tool !== 'memory_store') return undefined
  const stack: unknown[] = [input]
  let nodes = 0
  let chars = 0
  while (stack.length > 0) {
    const v = stack.pop()
    if (++nodes > MAX_NODES) return 'screening: too large to screen'
    if (typeof v === 'string') {
      chars += v.length
      if (chars > MAX_CHARS) return 'screening: too large to screen'
      if (SECRET.test(v.replace(HIDDEN, ''))) return 'screening: secret'
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x)
    } else if (typeof v === 'object' && v !== null) {
      for (const k of Object.keys(v)) { stack.push(k); stack.push((v as Record<string, unknown>)[k]) }
    }
  }
  return undefined
}
`

function fixtures(dir, sources) {
  for (const [name, src] of Object.entries(sources)) {
    mkdirSync(join(dir, name, 'hooks'), { recursive: true })
    writeFileSync(join(dir, name, 'hooks', 'guard.ts'), src)
  }
  return dir
}
const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 240_000 })

test('the corpus never carries a secret-shaped literal, only builders', () => {
  const src = ['guard-probe-corpus.mjs', 'guard-probe-worker.mjs'].map(f => readFileSync(join(HERE, '..', 'lib', f), 'utf8')).join('\n')
  assert.doesNotMatch(src, /gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{24,}|xox[abprs]-[A-Za-z0-9-]{10,}|BEGIN RSA PRIVATE KEY/)
})

test('every secret type builds a distinct, non-empty value and benign look-alikes are not secrets', () => {
  const built = Object.values(SECRET_TYPES).map(f => f())
  assert.equal(new Set(built).size, built.length)
  assert.ok(built.every(s => s.length > 10))
  assert.ok(ALL_SECRETS.includes(built[0]))
  const re = new RegExp(SECRET_RE.slice(1, SECRET_RE.lastIndexOf('/')), 'i')
  for (const b of BENIGN) assert.equal(re.test(typeof b === 'string' ? b : JSON.stringify(b)), false, `benign text must not look like a secret: ${String(b).slice(0, 40)}`)
})

test('corpus ids are unique and cover every required class', () => {
  const ids = [...evasionProbes(1000), ...stressProbes(1000)].map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  const classes = new Set(evasionProbes(1000).map(p => p.cls))
  for (const c of ['invisible', 'nesting', 'keys', 'json', 'encoding', 'confusable', 'huge', 'wide', 'structured', 'budget']) assert.ok(classes.has(c), c)
  assert.ok(ids.includes('nest-obj-5000') && ids.includes('s-a') && ids.includes('s-pem-spaces'))
  assert.ok(ids.includes('pair-name-value') && ids.includes('over-node-cap-25000') && ids.includes('over-char-cap-3m'))
  const over = evasionProbes(1000).find(p => p.id === 'over-node-cap-25000').build('x')
  assert.ok(over.list.length > 20_000 && over.list.at(-1) === 'x', 'the secret sits past the walker node budget')
  assert.deepEqual(evasionProbes(1000).find(p => p.id === 'pair-name-value').build('x'), { key: 'api_key', value: 'x' })
  const deep = evasionProbes(1000).find(p => p.id === 'nest-obj-5000').build('x')
  let depth = 0
  for (let v = deep; typeof v === 'object'; v = v.k) depth++
  assert.equal(depth, 5000)
  assert.equal(stressProbes(1_048_576).find(p => p.id === 's-a').build().length, 1_048_576)
})

test('flags the naive guard on nesting, keys, invisible characters and size; passes the screening guard', () => {
  const dir = fixtures(join(tmp, 'plugins'), { naive: NAIVE, screening: SCREENING })
  const r = run('--fast', '--plugins-dir', dir, '--format', 'json')
  assert.equal(r.status, 1, r.stderr)
  const out = JSON.parse(r.stdout)
  const by = Object.fromEntries(out.rows.map(x => [x.name, x]))
  const failed = name => new Set(by[name].results.filter(x => x.status === 'fail').map(x => x.id))

  assert.equal(by.naive.meta.calibrated > 0, true)
  for (const id of ['nest-obj-12', 'nest-obj-5000', 'nest-arr-60', 'wide-array-250', 'key-name', 'key-name-nested-3', 'shy-split', 'bidi-isolate', 'after-25k-padding']) {
    assert.ok(failed('naive').has(id), `naive guard must fail ${id}`)
  }
  assert.ok(!failed('naive').has('plain'), 'the plain secret is caught: that is the control')
  assert.equal(by.naive.results.find(x => x.id === 'benign-lookalikes').status, 'pass')

  assert.deepEqual([...failed('screening')], [], `screening guard failed: ${[...failed('screening')].join(', ')}`)
  const advisory = by.screening.results.filter(x => x.status === 'info').map(x => x.id)
  assert.ok(advisory.includes('base64'), 'encodings are advisory misses, not failures')
  assert.ok(out.newHoles.every(h => h.startsWith('naive:')))
})

test('a throwing guard and a hanging-slow guard are failures; a merely slow one is advisory', () => {
  const dir = fixtures(join(tmp, 'plugins-bad'), {
    thrower: `export function verdict(tool: string, input: unknown): string | undefined {
  if (JSON.stringify(input).length > 1000) throw new RangeError('boom')
  return tool === 'memory_store' ? undefined : undefined
}`,
    sluggish: `export function verdict(tool: string, input: unknown): string | undefined {
  if (tool !== 'memory_store') return undefined
  let s = ''
  try { s = JSON.stringify(input) ?? '' } catch { /* deep */ }
  const end = Date.now() + (s.includes('":"' + 'a'.repeat(5000)) ? 25 : 0)
  while (Date.now() < end) { /* busy */ }
  return undefined
}`,
    slow: `export function verdict(tool: string, input: unknown): string | undefined {
  if (tool !== 'memory_store') return undefined
  let s = ''
  try { s = JSON.stringify(input) ?? '' } catch { /* too deep to serialise: not the slow shape */ }
  const end = Date.now() + (s.includes('":"' + 'a'.repeat(5000)) ? 80 : 0)
  while (Date.now() < end) { /* busy */ }
  return undefined
}`,
  })
  const r = run('--fast', '--plugins-dir', dir, '--format', 'json', '--budget-ms', '60', '--advisory-ms', '10')
  assert.equal(r.status, 1)
  const by = Object.fromEntries(JSON.parse(r.stdout).rows.map(x => [x.name, x]))
  const thrown = by.thrower.results.find(x => x.id === 's-a')
  assert.equal(thrown.status, 'fail')
  assert.match(thrown.note, /RangeError/)
  const slowed = by.slow.results.find(x => x.id === 's-a')
  assert.equal(slowed.status, 'fail')
  assert.ok(slowed.ms >= 60)
  const adv = by.sluggish.results.find(x => x.id === 's-a')
  assert.equal(adv.status, 'pass')
  assert.match(adv.note, /advisory slow/)
})

test('a hung guard is killed by the watchdog and reported, not waited on forever', () => {
  const dir = fixtures(join(tmp, 'plugins-hang'), {
    hang: `export function verdict(tool: string, input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null && JSON.stringify(input).length > 60000) for (;;) { /* never returns */ }
  return undefined
}`,
  })
  const t0 = Date.now()
  const r = run('--fast', '--plugins-dir', dir, '--format', 'json', '--watchdog-ms', '1500')
  assert.equal(r.status, 1)
  assert.ok(Date.now() - t0 < 120_000)
  const row = JSON.parse(r.stdout).rows[0]
  assert.ok(row.results.some(x => x.status === 'fail' && /HANG/.test(x.note)), 'a probe must be marked HANG')
})

test('a known-holes baseline makes only new holes fail, and reports holes that are now fixed', () => {
  const dir = fixtures(join(tmp, 'plugins-base'), { naive: NAIVE, screening: SCREENING })
  const base = join(tmp, 'known.json')
  const w = run('--fast', '--plugins-dir', dir, '--write-known-holes', base, '--format', 'json')
  assert.equal(w.status, 1)
  const known = JSON.parse(readFileSync(base, 'utf8'))
  assert.ok(known.naive.length > 10)
  assert.equal(known.screening, undefined)

  const ok = run('--fast', '--plugins-dir', dir, '--known-holes', base)
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /0 new/)

  writeFileSync(base, JSON.stringify({ naive: known.naive.filter(id => id !== 'key-name'), screening: ['shy-split'] }))
  const regress = run('--fast', '--plugins-dir', dir, '--known-holes', base)
  assert.equal(regress.status, 1, 'a hole missing from the baseline is a new hole')
  assert.match(regress.stdout, /FAIL\s+key-name\b/)
  assert.match(regress.stdout, /known holes that now pass/)
})

test('CLI contract: exit 2 on a bad flag, exit 3 when nothing is found', () => {
  assert.equal(run('--nope').status, 2)
  assert.equal(run('--budget-ms', '0', '--plugins-dir', tmp).status, 2)
  const empty = join(tmp, 'empty')
  mkdirSync(empty)
  assert.equal(run('--plugins-dir', empty).status, 3)
})

test('a baselined guard that stops refusing anything fails instead of reading as fixed', () => {
  const dir = fixtures(join(tmp, 'plugins-lost'), { naive: 'export function verdict(tool: string, input: unknown): string | undefined {\n  return undefined\n}' })
  const base = join(tmp, 'known-lost.json')
  writeFileSync(base, JSON.stringify({ naive: ['nest-obj-12', 'key-name'] }))
  const r = run('--fast', '--plugins-dir', dir, '--known-holes', base)
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /calibration lost/)
  assert.doesNotMatch(r.stdout, /known holes that now pass/)
})

test('--report keeps the hand-written text above the generated marker', () => {
  const dir = fixtures(join(tmp, 'plugins-report'), { screening: SCREENING })
  const out = join(tmp, 'report.md')
  writeFileSync(out, '# Findings\nhand written\n<!-- generated below: x -->\nold generated text\n')
  assert.equal(run('--fast', '--plugins-dir', dir, '--report', out).status, 0)
  const text = readFileSync(out, 'utf8')
  assert.match(text, /^# Findings\nhand written\n<!-- generated below: x -->\n/)
  assert.doesNotMatch(text, /old generated text/)
  assert.match(text, /## Per-plugin summary/)
})
