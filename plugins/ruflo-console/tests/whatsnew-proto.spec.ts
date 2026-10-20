/**
 * What's new (ADR-478) against plugin names that are Object.prototype keys: `__proto__`, `constructor`, `toString` and the rest never
 * enter the record (seen, toasted, pinned, dismissed) or the divider map, and no lookup finds an inherited key. Run with
 *   npx vitest run plugins/ruflo-console/tests/whatsnew-proto.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { baselineOf, encodeRecord, hydrateWhatsNew, openWhatsNew, parseRecord, rowsOf, unseenRows, versionIn, versionMap, whatsnewActions, WHATSNEW_KEY } from '../hooks/whatsnew'

const NOTES = '## 0.5.0 — 2026-10-05\n- breaking: the flag --old is gone\n- feat: the new thing\n## 0.4.0 — 2026-09-01\n- feat: older thing\n'

function fake(files: Record<string, string>, stored: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(stored))
  const host = {
    fs: {
      read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async (path: string) => (files[path] === undefined ? Promise.reject(new Error('ENOENT')) : { kind: 'file', size: (files[path] as string).length, mtimeMs: 1, isLink: false }),
      list: async () => [],
    },
    storeGet: async (key: string) => store.get(key),
    storeSet: async (key: string, value: unknown) => void store.set(key, value),
    toast: () => undefined,
    invalidate: () => undefined,
    fetchText: async () => ({ ok: true, status: 200, text: '' }),
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    pluginRoot: '/plugin',
  }

  return { host, store }
}

async function opened(files: Record<string, string>, seen: Record<string, string>, installed: Record<string, string>) {
  const world = fake(files, { [WHATSNEW_KEY]: encodeRecord({ ...baselineOf([]), seen, toasted: seen }) })
  const state = newState({})

  state.snapshot = { plugins: { installed: Object.entries(installed).map(([name, version]) => ({ id: `${name}@ruflo`, name, marketplace: 'ruflo', version, scope: 'user', installPath: `/cache/${name}/${version}` })) } } as never
  state.isInteractive = true
  await hydrateWhatsNew(state, world.host as never)
  await openWhatsNew(state, world.host as never)

  return { world, state }
}

describe('plugin names that are Object.prototype keys', () => {
  it('a plugin named like an Object.prototype key is never listed or remembered, so it cannot re-toast every session', () => {
    const state = newState({})
    const reserved = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']

    state.snapshot = { plugins: { installed: [...reserved, 'ruflo-a'].map(name => ({ id: `${name}@ruflo`, name, marketplace: 'ruflo', version: '1.0.0', scope: 'user' })) } } as never

    const rows = rowsOf(state)

    expect(rows.map(row => row.name)).toEqual(['ruflo-console', 'ruflo-a'])

    // A stored record that names one (hand-edited, or written before this check) loads without it, and the baseline then holds.
    const stored = JSON.stringify({ v: 1, seen: Object.fromEntries([...reserved, 'ruflo-a'].map(name => [name, '1.0.0'])), toasted: { ['__proto__']: '1.0.0' }, pinned: [], dismissed: [], toast: true })
    const rec = parseRecord(stored)

    expect(Object.keys(rec?.seen ?? {})).toEqual(['ruflo-a'])
    expect(Object.getPrototypeOf(rec?.toasted)).toBeNull()
    expect(unseenRows(rows, parseRecord(encodeRecord(baselineOf(rows))))).toEqual([])

    // Rows handed in directly (not through rowsOf) get the same treatment: nothing is stored under the name and nothing is new.
    const raw = [{ name: '__proto__', version: '1.0.0', path: null }, { name: 'ruflo-swarm', version: '1.0.0', path: null }]

    expect(encodeRecord(baselineOf(raw))).not.toContain('__proto__')
    expect(unseenRows(raw, parseRecord(encodeRecord(baselineOf(raw))))).toEqual([])
  })


  it('pinned, dismissed and the divider map hold no Object.prototype names, and no lookup finds an inherited key', async () => {
    const stored = JSON.stringify({ v: 1, seen: { 'ruflo-swarm': '0.4.0' }, toasted: {}, pinned: ['constructor@1.0.0', '__proto__@1.0.0', 'toString@2.0.0', 'ruflo-a@1.0.0'], dismissed: ['__proto__@1.0.0', 'prototype@1.0.0', 'ruflo-b@1.0.0'], toast: true })
    const rec = parseRecord(stored)

    expect(rec?.pinned).toEqual(['ruflo-a@1.0.0'])
    expect(rec?.dismissed).toEqual(['ruflo-b@1.0.0'])

    const { world, state } = await opened({ '/cache/ruflo-swarm/0.5.0/CHANGELOG.md': NOTES }, { 'ruflo-swarm': '0.4.0' }, { 'ruflo-swarm': '0.5.0' })
    const before = state.whatsnew.before as Record<string, string>

    expect(Object.getPrototypeOf(before)).toBeNull()
    expect('toString' in before || 'constructor' in before).toBe(false)
    expect(versionIn(before, 'ruflo-swarm')).toBe('0.4.0')
    expect(versionIn(before, '__proto__')).toBeUndefined()
    expect(Object.getPrototypeOf(state.whatsnew.rec?.seen)).toBeNull()
    expect(Object.getPrototypeOf(state.whatsnew.rec?.toasted)).toBeNull()

    // Dismissing a prototype-named key is refused: nothing is stored under it.
    whatsnewActions(state, world.host as never).dismiss('constructor@1.0.0')
    whatsnewActions(state, world.host as never).dismiss('__proto__@1.0.0')
    expect(state.whatsnew.rec?.dismissed).toEqual([])
    expect(versionMap([['__proto__', '1.0.0'], ['constructor', '1.0.0'], ['ruflo-a', '1.0.0']])).toEqual({ 'ruflo-a': '1.0.0' })
  })
})
