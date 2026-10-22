/**
 * The shared toast policy (ADR-477): levels and the one-line washing, de-duplication, the per-source rate limit and its coalesced errors,
 * the person's setting (all, important, off) and per-source mute, recording of every toast, a host that throws, the digests' ring, and
 * that the copies of the module are byte-identical. Run with
 *   npx vitest run plugins/ruflo-console/tests/toast-policy.spec.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createToaster,
  createToastKit,
  DEDUPE_MS,
  decodeRing,
  DEFAULT_PREFS,
  encodePrefs,
  encodeRing,
  lineOf,
  parsePrefs,
  PREFIX,
  PREFS_FILE,
  pushDigest,
  RATE_MAX,
  RATE_WINDOW_MS,
  tidy,
  TOAST_DIR,
  type Digest,
  type ToastPrefs,
} from '../hooks/toast-policy'

const rig = (prefs: ToastPrefs = DEFAULT_PREFS, extra: { throws?: boolean; away?: boolean | undefined } = {}) => {
  const clock = { now: 1_000_000 }
  const drawn: string[] = []
  const records: Digest[] = []
  const timers: { at: number; fn: () => void }[] = []
  const state = { prefs }
  const toaster = createToaster({
    source: 'mods',
    now: () => clock.now,
    show: line => {
      if (extra.throws === true) throw new Error('refused')
      drawn.push(line)
    },
    prefs: () => state.prefs,
    persist: d => void records.push({ ...d }),
    away: () => extra.away,
    after: (ms, fn) => void timers.push({ at: clock.now + ms, fn }),
  })

  const advance = (ms: number) => {
    clock.now += ms
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) timer.at <= clock.now ? timer.fn() : timers.push(timer)
  }

  return { toaster, drawn, records, clock, advance, state }
}

describe('lines: level prefix and one-line washing', () => {
  it('each level has its own prefix', () => {
    expect(PREFIX).toEqual({ info: '›', ok: '✓', warn: '⚠', error: '✗' })
    expect(lineOf('ok', 'done')).toBe('✓ done')
    expect(lineOf('error', 'broke')).toBe('✗ broke')
  })

  it('strips escapes and control characters, collapses white space, and never exceeds 120 characters', () => {
    expect(tidy('a\u001b[31mred\u001b[0m\n\n b\t\tc\u0000d')).toBe('ared b cd')
    expect(tidy('word '.repeat(100))).toHaveLength(120)
    expect(tidy('word '.repeat(100)).endsWith('…')).toBe(true)
    expect(lineOf('warn', 'many '.repeat(100))).toHaveLength(120)
    expect(lineOf('info', '   \n ')).toBe('')
    expect(tidy(42)).toBe('')
    expect(tidy('x'.repeat(500))).toBe('‹masked›')
  })

  it('masks credentials, addresses and home paths; a NUL inside a key does not hide it', () => {
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA'

    expect(tidy(`failed with ${key} now`)).not.toContain('AAAAAAAA')
    expect(tidy(`sk-ant-AAAAAAAA\u0000BBBBBBBB`)).not.toContain('BBBB')
    expect(tidy('token=hunter2hunter2 ok')).not.toContain('hunter2')
    expect(tidy('mail me@example.com')).not.toContain('me@example.com')
    expect(tidy('in /home/ruv/project/x')).toBe('in ~/project/x')
    expect(tidy('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefgh')
  })
})

describe('the toaster', () => {
  it('draws once with the level prefix and records it as shown', () => {
    const { toaster, drawn, records } = rig()

    expect(toaster.toast({ level: 'warn', text: 'budget 75%' })).toBe('shown')
    expect(drawn).toEqual(['⚠ budget 75%'])
    expect(records).toEqual([{ t: 1_000_000, source: 'mods', level: 'warn', text: 'budget 75%', shown: true, why: 'shown' }])
  })

  it('an identical text inside the window is not drawn again but is recorded; after the window it is', () => {
    const { toaster, drawn, records, advance } = rig()

    expect(toaster.toast({ text: 'same' })).toBe('shown')
    advance(DEDUPE_MS - 1)
    expect(toaster.toast({ text: 'same' })).toBe('deduped')
    expect(drawn).toHaveLength(1)
    expect(records.map(r => r.why)).toEqual(['shown', 'deduped'])
    advance(2)
    expect(toaster.toast({ text: 'same' })).toBe('shown')
    expect(drawn).toHaveLength(2)
    expect(toaster.toast({ text: 'other' })).toBe('shown')
  })

  it('the same text at another level is still the same toast', () => {
    const { toaster } = rig()

    expect(toaster.toast({ level: 'info', text: 'x' })).toBe('shown')
    expect(toaster.toast({ level: 'error', text: 'x' })).toBe('deduped')
  })

  it('a source draws at most 4 a minute; the rest are rate-limited and recorded, and the window then reopens', () => {
    const { toaster, drawn, records, advance } = rig()

    for (let i = 0; i < RATE_MAX; i++) expect(toaster.toast({ text: `n${i}` })).toBe('shown')
    expect(toaster.toast({ text: 'n4' })).toBe('rate-limited')
    expect(drawn).toHaveLength(RATE_MAX)
    expect(records.at(-1)).toMatchObject({ why: 'rate-limited', shown: false, text: 'n4' })
    advance(RATE_WINDOW_MS)
    expect(toaster.toast({ text: 'n5' })).toBe('shown')
  })

  it('errors are never dropped: past the limit they are held and said once, with a count, when the window opens', () => {
    const { toaster, drawn, records, advance } = rig()

    for (let i = 0; i < RATE_MAX; i++) toaster.toast({ text: `n${i}` })
    expect(toaster.toast({ level: 'error', text: 'e1' })).toBe('coalesced')
    expect(toaster.toast({ level: 'error', text: 'e2' })).toBe('coalesced')
    expect(toaster.toast({ level: 'error', text: 'e3' })).toBe('coalesced')
    expect(drawn).toHaveLength(RATE_MAX)
    expect(records.filter(r => r.why === 'coalesced')).toHaveLength(3)
    advance(RATE_WINDOW_MS + 100)
    expect(drawn.at(-1)).toBe('✗ e1 … and 2 more')
    expect(drawn).toHaveLength(RATE_MAX + 1)
  })

  it('a lone held error is said as it is, with no count', () => {
    const { toaster, drawn, advance } = rig()

    for (let i = 0; i < RATE_MAX; i++) toaster.toast({ text: `n${i}` })
    toaster.toast({ level: 'error', text: 'only' })
    advance(RATE_WINDOW_MS + 100)
    expect(drawn.at(-1)).toBe('✗ only')
  })

  it('held errors are released by the next toast when no timer exists', () => {
    const clock = { now: 5 }
    const drawn: string[] = []
    const t = createToaster({ source: 'mods', now: () => clock.now, show: line => void drawn.push(line) })

    for (let i = 0; i < RATE_MAX; i++) t.toast({ text: `n${i}` })
    t.toast({ level: 'error', text: 'late' })
    clock.now += RATE_WINDOW_MS + 1
    t.toast({ text: 'next' })
    expect(drawn).toContain('✗ late')
  })

  it('all: every level draws; important: info and ok are filtered unless marked always; off: nothing draws', () => {
    const all = rig()
    expect(['info', 'ok', 'warn', 'error'].map(level => all.toaster.toast({ level: level as 'info', text: level }))).toEqual(['shown', 'shown', 'shown', 'shown'])

    const important = rig({ mode: 'important', muted: [] })
    expect(['info', 'ok', 'warn', 'error'].map(level => important.toaster.toast({ level: level as 'info', text: level }))).toEqual(['filtered', 'filtered', 'shown', 'shown'])
    expect(important.toaster.toast({ level: 'info', text: 'must', always: true })).toBe('shown')

    const off = rig({ mode: 'off', muted: [] })
    expect(['info', 'warn', 'error'].map(level => off.toaster.toast({ level: level as 'info', text: level, always: true }))).toEqual(['off', 'off', 'off'])
    expect(off.drawn).toEqual([])
  })

  it('a muted source draws nothing, errors included, yet every one is recorded with what became of it', () => {
    const { toaster, drawn, records } = rig({ mode: 'all', muted: ['mods'] })

    expect(toaster.toast({ level: 'error', text: 'boom' })).toBe('muted')
    expect(toaster.toast({ level: 'info', text: 'fyi' })).toBe('muted')
    expect(drawn).toEqual([])
    expect(records.map(r => [r.why, r.shown])).toEqual([['muted', false], ['muted', false]])
    expect(rig({ mode: 'all', muted: ['swarm'] }).toaster.toast({ text: 'x' })).toBe('shown')
  })

  it('off or mute drops a held error instead of saying it later', () => {
    const { toaster, drawn, advance, state } = rig()

    for (let i = 0; i < RATE_MAX; i++) toaster.toast({ text: `n${i}` })
    toaster.toast({ level: 'error', text: 'held' })
    state.prefs = { mode: 'off', muted: [] }
    advance(RATE_WINDOW_MS + 100)
    expect(drawn).not.toContain('✗ held')
  })

  it('awayOnly is held back only when the host says the person is present; with no signal it draws', () => {
    expect(rig(DEFAULT_PREFS, { away: false }).toaster.toast({ text: 'x', awayOnly: true })).toBe('away')
    expect(rig(DEFAULT_PREFS, { away: true }).toaster.toast({ text: 'x', awayOnly: true })).toBe('shown')
    expect(rig(DEFAULT_PREFS, { away: undefined }).toaster.toast({ text: 'x', awayOnly: true })).toBe('shown')
  })

  it('a host that throws is a refused toast and never reaches the caller; it is recorded unshown', () => {
    const { toaster, records } = rig(DEFAULT_PREFS, { throws: true })

    expect(toaster.toast({ level: 'error', text: 'x' })).toBe('refused')
    expect(records[0]).toMatchObject({ why: 'refused', shown: false })
  })

  it('a throwing or rejecting recorder, clock or setting never breaks the caller', async () => {
    const drawn: string[] = []
    const a = createToaster({ source: 'mods', now: () => 1, show: l => void drawn.push(l), persist: () => { throw new Error('disk') } })
    const b = createToaster({ source: 'mods', now: () => 1, show: l => void drawn.push(l), persist: () => Promise.reject(new Error('disk')) })
    const c = createToaster({ source: 'mods', now: () => Promise.reject(new Error('clock')), show: l => void drawn.push(l) })
    const d = createToaster({ source: 'mods', now: () => 1, show: l => void drawn.push(l), prefs: () => { throw new Error('prefs') } })
    const e = createToaster({ source: 'mods', now: () => { throw new Error('no clock on this engine') }, show: l => void drawn.push(l) })

    expect(a.toast({ text: 'a' })).toBe('shown')
    expect(b.toast({ text: 'b' })).toBe('shown')
    expect(await c.toast({ text: 'c' })).toBe('shown')
    expect(d.toast({ text: 'd' })).toBe('shown')
    expect(e.toast({ text: 'e' })).toBe('shown')
    await Promise.resolve()
    expect(drawn).toEqual(['› a', '› b', '› c', '› d', '› e'])
  })

  it('empty text draws and records nothing', () => {
    const { toaster, drawn, records } = rig()

    expect(toaster.toast({ text: ' \n ' })).toBe('empty')
    expect(drawn).toEqual([])
    expect(records).toEqual([])
  })

  it('an unknown level is info; an async clock and setting give the same answer', async () => {
    const drawn: string[] = []
    const t = createToaster({ source: 'mods', now: async () => 9, show: l => void drawn.push(l), prefs: async () => ({ mode: 'important', muted: [] }) })

    expect(await t.toast({ level: 'loud' as 'info', text: 'q' })).toBe('filtered')
    expect(await t.toast({ level: 'warn', text: 'w' })).toBe('shown')
    expect(drawn).toEqual(['⚠ w'])
  })
})

describe('the setting and the digests', () => {
  it('the setting round-trips and anything unreadable is the default', () => {
    expect(parsePrefs(encodePrefs({ mode: 'important', muted: ['swarm', 'mods'] }))).toEqual({ mode: 'important', muted: ['swarm', 'mods'] })
    for (const bad of [null, undefined, '', '{', '[]', '"x"', '{"mode":"loud"}', 'x'.repeat(5000)]) expect(parsePrefs(bad)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{"mode":"off","muted":["ok","BAD NAME",3,"swarm"]}')).toEqual({ mode: 'off', muted: ['ok', 'swarm'] })
  })

  it('a ring counts identical neighbours, is capped, and round-trips through its file', () => {
    const ring: Digest[] = []
    const d = (text: string, why: Digest['why'] = 'shown'): Digest => ({ t: 1, source: 'mods', level: 'warn', text, shown: why === 'shown', why })

    pushDigest(ring, d('a'))
    pushDigest(ring, d('a'))
    pushDigest(ring, d('a', 'deduped'))
    expect(ring.map(r => [r.text, r.why, r.n])).toEqual([['a', 'shown', 2], ['a', 'deduped', undefined]])
    for (let i = 0; i < 100; i++) pushDigest(ring, d(`t${i}`), 10)
    expect(ring).toHaveLength(10)
    expect(decodeRing(encodeRing(ring))).toEqual(ring.map(r => ({ ...r, shown: r.why === 'shown' })))
    expect(decodeRing('not json\n{"v":9}\n{"v":1,"t":1,"s":"mods","l":"warn","x":"ok","w":"shown"}\n{"v":1,')).toHaveLength(1)
  })

  it('a ring file is not trusted: text is washed again and a bad source is dropped', () => {
    const line = JSON.stringify({ v: 1, t: 5, s: 'mods', l: 'error', x: 'leak sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA\nnext', w: 'shown' })
    const bad = JSON.stringify({ v: 1, t: 5, s: '../x', l: 'error', x: 'a', w: 'shown' })

    expect(decodeRing(`${line}\n${bad}\n`)).toHaveLength(1)
    expect(decodeRing(`${line}\n`)[0]?.text).not.toContain('AAAAAAAA')
  })
})

describe('the kit: the console\'s setting and a ring file per source', () => {
  const files = new Map<string, string>()
  const make = (opts: { folder?: boolean; throws?: boolean } = {}) => {
    const clock = { now: 10_000 }
    const timers: (() => void)[] = []
    const drawn: string[] = []

    files.clear()
    if (opts.folder !== false) files.set('.claude-flow/console/.gitignore', '*\n')

    const toaster = createToastKit({
      source: 'swarm',
      now: () => clock.now,
      show: line => void drawn.push(line),
      after: (_ms, fn) => void timers.push(fn),
      io: {
        read: async path => {
          if (opts.throws === true) throw new Error('no')
          const text = files.get(path)

          if (text === undefined) throw new Error('missing')

          return text
        },
        write: async (path, text) => {
          if (opts.throws === true) throw new Error('no')
          files.set(path, text)
        },
        exists: async path => [...files.keys()].some(key => key === path || key.startsWith(`${path}/`)),
      },
    })

    return { toaster, drawn, clock, flush: async () => { await new Promise(r => setTimeout(r, 5)); for (const fn of timers.splice(0)) fn(); await new Promise(r => setTimeout(r, 5)) } }
  }

  it('reads the setting from the console\'s file and writes its digests beside it, muted ones too', async () => {
    const { toaster, drawn, flush } = make()

    files.set(PREFS_FILE, encodePrefs({ mode: 'off', muted: [] }))
    expect(await toaster.toast({ level: 'error', text: 'hidden but kept' })).toBe('off')
    expect(drawn).toEqual([])
    await flush()
    expect(decodeRing(files.get(`${TOAST_DIR}/swarm.jsonl`))).toMatchObject([{ source: 'swarm', level: 'error', text: 'hidden but kept', why: 'off', shown: false }])
  })

  it('no setting file means all, nothing muted; no console folder means nothing is written', async () => {
    const withFolder = make()

    expect(await withFolder.toaster.toast({ text: 'a' })).toBe('shown')
    await withFolder.flush()
    expect(files.has(`${TOAST_DIR}/swarm.jsonl`)).toBe(true)

    const alone = make({ folder: false })

    expect(await alone.toaster.toast({ text: 'a' })).toBe('shown')
    await alone.flush()
    expect(files.size).toBe(0)
  })

  it('a second session keeps the first one\'s digests in the ring, and an unreadable disk breaks nothing', async () => {
    const first = make()

    await first.toaster.toast({ text: 'one' })
    await first.flush()

    const keep = new Map(files)
    const second = make()

    for (const [k, v] of keep) files.set(k, v)
    await second.toaster.toast({ text: 'two' })
    await second.flush()
    expect(decodeRing(files.get(`${TOAST_DIR}/swarm.jsonl`)).map(d => d.text)).toEqual(['one', 'two'])

    const broken = make({ throws: true })

    expect(await broken.toaster.toast({ level: 'error', text: 'x' })).toBe('shown')
    await broken.flush()
  })

  it('believes the setting for a few seconds, then reads it again', async () => {
    const { toaster, drawn, clock } = make()

    files.set(PREFS_FILE, encodePrefs({ mode: 'off', muted: [] }))
    expect(await toaster.toast({ text: 'a' })).toBe('off')
    files.set(PREFS_FILE, encodePrefs(DEFAULT_PREFS))
    expect(await toaster.toast({ text: 'b' })).toBe('off')
    clock.now += 5_000
    expect(await toaster.toast({ text: 'c' })).toBe('shown')
    expect(drawn).toEqual(['› c'])
  })
})

describe('the copies of the module', () => {
  it('every plugin carries a byte-identical copy of the canonical file', () => {
    const plugins = join(__dirname, '..', '..')
    const canonical = readFileSync(join(plugins, 'ruflo-mods/hooks/toast/policy.ts'))

    for (const copy of ['ruflo-console/hooks/toast-policy.ts', 'ruflo-swarm/hooks/toast-policy.ts', 'ruflo-protector/hooks/toast-policy.ts']) {
      expect(readFileSync(join(plugins, copy)).equals(canonical), copy).toBe(true)
    }
  })
})
