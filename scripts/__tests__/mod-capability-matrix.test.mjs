import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'

import { buildMatrix, collisions, duplicateGroups, scanPlugin, testTitles } from '../mod-capability-matrix.mjs'

let root

/** Writes one fake plugin: manifest, hooks.json, hook sources and a test file. */
function plugin(name, { version = '1.0.0', userConfig = {}, files = {}, modules = ['./register.ts'], tests = {} } = {}) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(dir, 'tests'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version, userConfig }))
  writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify(modules.length ? { modules } : {}))
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, 'hooks', f), text)
  for (const [f, text] of Object.entries(tests)) writeFileSync(join(dir, 'tests', f), text)
  return dir
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'mod-matrix-'))
})
after(() => rmSync(root, { recursive: true, force: true }))

describe('scanPlugin', () => {
  test('reads version, userConfig defaults, events, commands and the status path from sources', () => {
    const dir = plugin('alpha', {
      version: '0.4.2',
      userConfig: { guard: { type: 'boolean', default: true }, limit: { type: 'number' } },
      files: {
        'register.ts': `on('session.start', async ($, e, next) => next(e))
on('tool.call', async ($, e, next) => next(e))
on('command.run', { command: 'alpha-mod' }, async () => ({ text: 'x' }))
await $.command.register({ name: 'alpha-mod', description: 'd' })`,
        'status.ts': `export const STATUS_PATH = '.claude-flow/alpha-mod/status.json'`,
        'guard.ts': `const WATCHED = ['memory_store', 'mcp__ruflo__agentdb_hierarchical-store']`,
      },
    })
    const row = scanPlugin(dir)
    assert.equal(row.version, '0.4.2')
    assert.equal(row.isMod, true)
    assert.deepEqual(Object.keys(row.events).sort(), ['command.run', 'session.start', 'tool.call'])
    assert.deepEqual(row.commands, { run: ['alpha-mod'], registered: ['alpha-mod'] })
    assert.deepEqual(row.statusPaths, ['.claude-flow/alpha-mod/status.json'])
    assert.deepEqual(row.guardTools, ['mcp__ruflo__agentdb_hierarchical-store', 'memory_store'])
    assert.deepEqual(row.userConfig, { guard: { type: 'boolean', default: true }, limit: { type: 'number', default: null } })
    assert.equal(row.classicFallback, false)
  })

  test('a status path that is only mentioned is a read, not a write', () => {
    const dir = plugin('reader', { files: { 'register.ts': `const p = '.claude-flow/other-mod/status.json'` } })
    const row = scanPlugin(dir)
    assert.deepEqual(row.statusPaths, [])
    assert.deepEqual(row.statusReads, ['.claude-flow/other-mod/status.json'])
  })

  test('a plugin with no modules is not a mod, and test files are not sources', () => {
    const dir = plugin('classic', { modules: [], files: { 'x.test.ts': `on('tool.call', 1)` } })
    const row = scanPlugin(dir)
    assert.equal(row.isMod, false)
    assert.deepEqual(row.events, {})
  })
})

describe('testTitles', () => {
  test('lists test and it titles, quotes of any kind', () => {
    const dir = plugin('titled', { tests: { 'a.test.ts': `test('one', () => {})\nit("two", () => {})\ntest(\`three\`, () => {})\n// not a test(x)` } })
    assert.deepEqual(testTitles(join(dir, 'tests', 'a.test.ts')), ['one', 'two', 'three'])
  })
})

describe('collisions and duplicates', () => {
  test('collisions keeps only names claimed by two or more plugins', () => {
    assert.deepEqual(collisions({ a: ['x', 'y', 'x'], b: ['y'], c: ['z'] }), { y: ['a', 'b'] })
  })

  test('duplicateGroups puts identical copies together, largest first', () => {
    for (const n of ['p1', 'p2', 'p3']) plugin(n, { files: { 'screen.ts': n === 'p3' ? 'drifted' : 'same' } })
    const groups = duplicateGroups(root, ['p1', 'p2', 'p3'], 'screen.ts')
    assert.deepEqual(groups.map((g) => g.plugins), [['p1', 'p2'], ['p3']])
  })
})

describe('buildMatrix', () => {
  test('skips dot directories, counts mods, and takes test counts only from the counts file', () => {
    mkdirSync(join(root, '.claude-flow'), { recursive: true })
    plugin('m1', { files: { 'register.ts': `on('tool.call', 1)` } })
    plugin('plain', { modules: [] })
    const m = buildMatrix(root, { m1: 7 })
    assert.ok(!('.claude-flow' in m.plugins))
    assert.equal(m.plugins.m1.testCount, 7)
    assert.equal(m.plugins.plain.testCount, null)
    assert.ok(m.summary.withoutMod.includes('plain'))
    assert.equal(m.summary.pluginsWithToolCallHook >= 1, true)
    assert.equal(m.schema, 1)
  })

  test('the real tree: every mod exports at least session.start', () => {
    const m = buildMatrix(new URL('../../plugins', import.meta.url).pathname)
    for (const [name, row] of Object.entries(m.plugins)) if (row.isMod) assert.ok(row.events['session.start'], `${name} has no session.start`)
  })
})
