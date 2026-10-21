/**
 * The Mods section (ADR-446 status files): the shape-checked parser, the order, the file and size caps, hostile content, and the folder scan.
 *   npx vitest run plugins/ruflo-console/tests/mods-section.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { readDisk, type ReaderFs } from '../hooks/data/files'
import { newState } from '../hooks/state'
import { readSnapshot } from '../hooks/data/snapshot'
import type { Actions } from '../hooks/views/common'
import { roomOf } from '../hooks/room'
import { viewText } from '../hooks/views/pane'
import { callsOf, denyClassOf, isStale, MODS_MAX_BYTES, MODS_MAX_FILES, MODS_STALE_MS, orderMods, parseModStatus, readMods, type ModRow } from '../hooks/data/mods'

const status = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, updatedMs: 1_000, calls: 5, blocked: 0, startedMs: 500, guard: true, ...extra })
const row = (name: string, blocked: number, updatedMs: number | null): ModRow => ({ name, guard: true, calls: 1, blocked, updatedMs, startedMs: null })

/** A fake project: folder name → status text (null = no status.json), plus loose files. */
function fakeFs(mods: Record<string, string | null>, loose: string[] = []): ReaderFs & { reads: string[] } {
  const reads: string[] = []

  return {
    reads,
    list: async () => [...Object.keys(mods).map(name => ({ name, kind: 'directory' })), ...loose.map(name => ({ name, kind: 'file' }))],
    stat: async path => {
      const text = mods[path.split('/').at(-2) ?? '']

      if (text === null || text === undefined) throw new Error('ENOENT')

      return { mtimeMs: 1, size: text.length }
    },
    read: async path => {
      reads.push(path)

      return mods[path.split('/').at(-2) ?? ''] ?? ''
    },
  }
}

describe('parseModStatus', () => {
  it('reads version 1 and names the mod from its folder, never from the file', () => {
    expect(parseModStatus('docs-mod', status({ mod: 'evil' }))).toEqual({ name: 'docs', guard: true, calls: 5, blocked: 0, updatedMs: 1000, startedMs: 500 })
  })

  it('refuses unknown versions and junk', () => {
    for (const text of [status({ version: 2 }), status({ version: '1' }), 'nope', '[]', '"x"', 'null', '', null]) expect(parseModStatus('docs-mod', text)).toBeNull()
  })

  it('treats hostile numbers and types as absent, not as values', () => {
    const parsed = parseModStatus('docs-mod', JSON.stringify({ version: 1, calls: -3, blocked: 'lots', updatedMs: 1e999, guard: 'yes', startedMs: null, __proto__: { x: 1 } }))

    expect(parsed).toEqual({ name: 'docs', guard: null, calls: null, blocked: 0, updatedMs: null, startedMs: null })
  })

  it('floors fractions and is stale when old or unwritten', () => {
    expect(parseModStatus('a-mod', status({ calls: 2.9 }))?.calls).toBe(2)
    expect(isStale(row('a', 0, 1000), 1000 + MODS_STALE_MS)).toBe(false)
    expect(isStale(row('a', 0, 1000), 1001 + MODS_STALE_MS)).toBe(true)
    expect(isStale(row('a', 0, null), 5)).toBe(true)
  })
})

describe('orderMods', () => {
  it('leads with blocked (most first), then newest, then name', () => {
    const ordered = orderMods([row('b', 0, 10), row('a', 0, 10), row('z', 1, 1), row('y', 4, 1), row('n', 0, 99), row('u', 0, null)])

    expect(ordered.map(mod => mod.name)).toEqual(['y', 'z', 'n', 'a', 'b', 'u'])
  })
})

describe('readMods, a status.json that is not a regular file (ADR-450 T2)', () => {
  // Observed on the live engine: stat follows a link and reports the target's size plus isLink; read follows it, even outside the project.
  const kinds: Record<string, { kind: string; isLink: boolean }> = { 'ok-mod': { kind: 'file', isLink: false }, 'link-mod': { kind: 'file', isLink: true }, 'fifo-mod': { kind: 'other', isLink: false }, 'dir-mod': { kind: 'dir', isLink: false } }

  it('never reads a link, a FIFO or a folder named status.json, and counts each as refused', async () => {
    const fs = fakeFs({ 'ok-mod': status(), 'link-mod': status(), 'fifo-mod': status(), 'dir-mod': status() })
    const stat = fs.stat

    fs.stat = async path => ({ ...(await stat(path)), ...kinds[path.split('/').at(-2) ?? ''] })

    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows.map(r => r.name)).toEqual(['ok'])
    expect(mods.refused).toBe(3)
    expect(fs.reads).toEqual(['/p/.claude-flow/ok-mod/status.json'])
  })

  it('still reads when the engine says nothing about the kind', async () => {
    const fs = fakeFs({ 'ok-mod': status() })

    expect((await readMods(fs, new Map(), '/p')).rows).toHaveLength(1)
  })

  it('drops a cached copy once the path turns into a link', async () => {
    const fs = fakeFs({ 'ok-mod': status() })
    const cache = new Map()

    expect((await readMods(fs, cache, '/p')).rows).toHaveLength(1)

    const stat = fs.stat

    fs.stat = async path => ({ ...(await stat(path)), isLink: true })

    expect(await readMods(fs, cache, '/p')).toMatchObject({ rows: [], refused: 1 })
  })
})

describe('readDisk, the agentdb mod status file (ADR-450 T2)', () => {
  const FILE = '/p/.claude-flow/agentdb-mod/status.json'
  const disk = (stat: { kind?: string; isLink?: boolean }) => {
    const reads: string[] = []
    const fs = {
      stat: async (path: string) => (path === FILE ? { mtimeMs: 1, size: 20, ...stat } : undefined),
      read: async (path: string) => { reads.push(path); return '{"version":1}' },
      list: async () => [],
    }

    return { fs, reads }
  }

  it('never reads it when it is a link, a FIFO or a folder', async () => {
    for (const stat of [{ kind: 'file', isLink: true }, { kind: 'other' }, { kind: 'dir' }]) {
      const { fs, reads } = disk(stat)
      const read = await readDisk(fs as never, new Map(), '/p', null)

      expect(reads).not.toContain(FILE)
      expect(read.project.agentdbMod).toMatchObject({ text: null })
    }
  })

  it('reads a regular file, and a file whose kind the engine does not report', async () => {
    for (const stat of [{ kind: 'file', isLink: false }, {}]) {
      const { fs, reads } = disk(stat)

      await readDisk(fs as never, new Map(), '/p', null)

      expect(reads).toContain(FILE)
    }
  })
})

describe('readMods', () => {
  it('reads only *-mod folders and skips a folder with no status file', async () => {
    const fs = fakeFs({ 'docs-mod': status({ blocked: 2 }), 'sparc-mod': status(), 'agentdb': status(), 'quiet-mod': null, 'Bad-Mod': status(), '..-mod': status() }, ['loose-mod'])
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows.map(mod => mod.name)).toEqual(['docs', 'sparc'])
    expect(mods).toMatchObject({ refused: 0, truncated: false })
    expect(fs.reads.every(path => path.startsWith('/p/.claude-flow/') && path.endsWith('/status.json'))).toBe(true)
  })

  it('caps the folders read at 60 and says so', async () => {
    const many = Object.fromEntries(Array.from({ length: 75 }, (_, i) => [`m${String(i).padStart(2, '0')}-mod`, status()]))
    const fs = fakeFs(many)
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows).toHaveLength(MODS_MAX_FILES)
    expect(fs.reads).toHaveLength(MODS_MAX_FILES)
    expect(mods.truncated).toBe(true)
  })

  it('refuses a file over 8 KB without reading it, and counts unknown shapes as refused', async () => {
    const fs = fakeFs({ 'big-mod': status({ pad: 'x'.repeat(MODS_MAX_BYTES) }), 'odd-mod': status({ version: 9 }), 'junk-mod': '{{{', 'ok-mod': status() })
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows.map(mod => mod.name)).toEqual(['ok'])
    expect(mods.refused).toBe(3)
    expect(fs.reads.some(path => path.includes('/big-mod/'))).toBe(false)
  })

  it('answers none when the folder cannot be listed', async () => {
    const fs: ReaderFs = { list: async () => Promise.reject(new Error('EACCES')), stat: async () => undefined, read: async () => '' }

    expect(await readMods(fs, new Map(), '/p')).toEqual({ rows: [], refused: 0, truncated: false })
  })
})

describe('wider status shapes (mod-status-files recommendation 1)', () => {
  const calls = (extra: Record<string, unknown>) => parseModStatus('x-mod', JSON.stringify({ version: 1, ...extra }))?.calls

  it('sums a calls object over its numeric values and ignores the rest', () => {
    expect(calls({ calls: { route: 3, deny: 2, note: 'x', nested: { a: 9 }, neg: -4, nan: null } })).toBe(5)
    expect(calls({ calls: {} })).toBe(0)
  })

  it('reads seen, then checked, when there is no calls; a real calls wins', () => {
    expect(calls({ seen: 7, checked: 3 })).toBe(7)
    expect(calls({ checked: 3 })).toBe(3)
    expect(calls({ calls: 2, seen: 7 })).toBe(2)
    expect(calls({ calls: 'many', seen: 4 })).toBe(4)
    expect(calls({ blocked: 1 })).toBeNull()
  })

  it('is bounded and never throws on hostile shapes', () => {
    expect(calls({ calls: 1e300 })).toBe(Number.MAX_SAFE_INTEGER)
    expect(calls({ calls: { a: 1e300, b: 1e300 } })).toBe(Number.MAX_SAFE_INTEGER)
    expect(calls({ seen: 1e300 })).toBe(Number.MAX_SAFE_INTEGER)
    expect(calls({ calls: [1, 2, 3] })).toBeNull()
    expect(calls({ calls: -1 })).toBeNull()
    expect(calls({ seen: -1, checked: Number.NaN })).toBeNull()
    expect(calls({ seen: [4], checked: { a: 1 } })).toBeNull()
    expect(calls({ calls: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 1])) })).toBe(64)
    expect(callsOf(Object.create(null) as Record<string, unknown>)).toBeNull()
  })

  it('maps lastReason and lastBlocked to the refusal class, lastDenied first', () => {
    const denied = (extra: Record<string, unknown>) => parseModStatus('x-mod', JSON.stringify({ version: 1, ...extra }))?.lastDenied

    expect(denied({ lastReason: 'reads a .env file' })).toBe('secret')
    expect(denied({ lastBlocked: 'curl to a host' })).toBe('network')
    expect(denied({ lastDenied: 'rm -rf', lastReason: 'token' })).toBe('destructive')
    expect(denied({ lastReason: 42, lastBlocked: ['secret'] })).toBeUndefined()
    expect(denied({ lastReason: { a: 'secret' } })).toBeUndefined()
    expect(denied({ lastReason: '', lastBlocked: 'odd thing' })).toBe('other')
  })

  it('never keeps the raw reason text, and strips control and bidi characters before classing', () => {
    const parsed = parseModStatus('x-mod', JSON.stringify({ version: 1, lastReason: '\u202esecret\u0007 /home/me/.ssh/id_rsa ' + 'x'.repeat(5000) }))

    expect(parsed?.lastDenied).toBe('secret')
    expect(JSON.stringify(parsed)).not.toContain('id_rsa')
  })

  it('shows the three real shapes in one scan', async () => {
    const mods = await readMods(fakeFs({ 'a-mod': status(), 'b-mod': JSON.stringify({ version: 1, calls: { x: 4, y: 6 }, blocked: 1, updatedMs: 5 }), 'c-mod': JSON.stringify({ version: 1, seen: 9, blocked: 2, lastReason: 'token leak', updatedMs: 6 }) }), new Map(), '/p')

    expect(Object.fromEntries(mods.rows.map(mod => [mod.name, [mod.calls, mod.lastDenied ?? null]]))).toEqual({ a: [5, null], b: [10, null], c: [9, 'secret'] })
  })
})

describe('the Mods section on the pages', () => {
  const act = new Proxy(() => undefined, { get: () => act, apply: () => undefined }) as unknown as Actions
  const empty: ReaderFs = { read: () => Promise.reject(new Error('ENOENT')), stat: () => Promise.reject(new Error('ENOENT')), list: () => Promise.reject(new Error('ENOENT')) }
  const draw = async (view: 'room' | 'overview', rows: ModRow[], extra: { refused?: number; truncated?: boolean } = {}) => {
    const state = newState({})
    const snapshot = await readSnapshot(empty, new Map(), '/work', '/home/dev', {}, 0)

    state.snapshot = { ...snapshot, mods: { rows: orderMods(rows), refused: extra.refused ?? 0, truncated: extra.truncated ?? false } }
    state.view = view

    return viewText({ state, nowMs: 30_000_000, columns: 100, act }, view)
  }

  it('the Room leads with a blocking mod and marks a stale one', async () => {
    const text = await draw('room', [row('quiet', 0, 30_000_000 - 5000), row('docs', 3, 30_000_000 - 60_000), row('old', 0, 1000)], { refused: 2 })
    const lines = text.split('\n')

    expect(text).toContain('Mods')
    expect(text).toContain('3 reporting · 1 blocked something')
    expect(lines.findIndex(l => l.includes('docs'))).toBeLessThan(lines.findIndex(l => l.includes('quiet')))
    expect(text).toMatch(/old.*stale \(an earlier session\)/)
    expect(text).toContain('2 status files not shown')
  })

  it('says none reporting when no mod has written, and Overview carries the count and the link', async () => {
    const overview = await draw('overview', [row('docs', 1, 29_999_000)])

    expect(await draw('room', [])).toContain('No mod has written a status file')
    expect(overview).toMatch(/mods reporting\s+1 · 1 blocked something/)
    expect(overview).toContain('The Room: Mods')
  })
})

describe('the Mods detail block', () => {
  const NOW = 30_000_000
  const act = new Proxy(() => undefined, { get: () => act, apply: () => undefined }) as unknown as Actions
  const empty: ReaderFs = { read: () => Promise.reject(new Error('ENOENT')), stat: () => Promise.reject(new Error('ENOENT')), list: () => Promise.reject(new Error('ENOENT')) }
  const draw = async (rows: ModRow[], open: string | null) => {
    const state = newState({})
    const snapshot = await readSnapshot(empty, new Map(), '/work', '/home/dev', {}, 0)

    state.snapshot = { ...snapshot, mods: { rows: orderMods(rows), refused: 0, truncated: false } }
    state.view = 'room'
    roomOf(state).mod = open

    return viewText({ state, nowMs: NOW, columns: 100, act }, 'room')
  }

  it('reads the optional fields and keeps only a class of the last refusal, never its text', () => {
    const parsed = parseModStatus('docs-mod', status({ modVersion: '1.2.3', summary: 'blocks writes to .env files', lastDenied: 'read of /home/u/.ssh/id_rsa private key sk-live-123' }), 7000)

    expect(parsed).toMatchObject({ modVersion: '1.2.3', summary: 'blocks writes to .env files', lastDenied: 'secret', fileMs: 7000 })
    expect(JSON.stringify(parsed)).not.toContain('id_rsa')
    expect(denyClassOf('a destructive delete')).toBe('destructive')
    expect(denyClassOf('outside the project directory')).toBe('path')
    expect(denyClassOf('xyzzy')).toBe('other')
    expect(denyClassOf('')).toBeNull()
    expect(denyClassOf(42)).toBeNull()
  })

  it('drops a hostile version and caps and cleans the summary', () => {
    const parsed = parseModStatus('docs-mod', status({ modVersion: '\u001b[31m9'.repeat(5), summary: `\u001b[31mred\u202e${'x'.repeat(5000)}` }))

    expect(parsed?.modVersion).toBeUndefined()
    expect(parsed?.summary?.length).toBeLessThanOrEqual(120)
    expect(parsed?.summary).not.toMatch(/[\u0000-\u001f\u202e]/)
  })

  it('shows nothing extra closed, and every reported field open; an unreported one says so', async () => {
    const mod: ModRow = { ...row('docs', 3, NOW - 60_000), startedMs: NOW - 3_600_000, modVersion: '1.2.3', summary: 'blocks writes to .env files', lastDenied: 'secret', fileMs: NOW - 90_000 }

    expect(await draw([mod], null)).not.toContain('last refusal')
    expect(await draw([mod], null)).toContain('▸ docs')

    const open = await draw([mod], 'docs')

    expect(open).toContain('▾ docs')
    expect(open).toMatch(/guards\s+blocks writes to .env files/)
    expect(open).toMatch(/last refusal\s+secret: it asked for a secret or credential/)
    expect(open).toMatch(/version\s+1.2.3/)
    expect(open).toMatch(/file age\s+1m/)
    expect(await draw([row('plain', 0, NOW - 1000)], 'plain')).toMatch(/guards\s+no summary reported by this mod/)
  })

  it('renders a hostile status file safely, however it was read', async () => {
    const text = JSON.stringify({ version: 1, updatedMs: NOW, guard: true, calls: 1e308, blocked: 2, modVersion: '99'.repeat(30), summary: `\u001b[2J\u202e${'A'.repeat(9000)}`, lastDenied: '\u001b]0;pwn\u0007 token' })
    const mod = parseModStatus('evil-mod', text, 5) as ModRow
    const drawn = await draw([mod], 'evil')

    expect(drawn).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\u202e]/)
    expect(drawn).toContain('secret: it asked for a secret or credential')
    expect(drawn).not.toContain('pwn')
    expect(drawn.split('\n').every(line => line.length < 400)).toBe(true)
  })
})
