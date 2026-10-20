/**
 * What's new (ADR-478): the changelog parser and its bounds, the record of what was looked at, the marker, the one toast per new
 * version, the pinned breaking changes, and the page drawn from real state in both looks, with hostile files. No host, no network:
 * the fake host counts every fetch so the page is shown to make none. Run with
 *   npx vitest run plugins/ruflo-console/tests/whatsnew.spec.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { compareVersions, entriesAfter, LIMITS, parseChangelog, semverOf } from '../hooks/data/changelog'
import { newState, type State } from '../hooks/state'
import { setLook, type Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { CONSOLE_VERSION } from '../hooks/version'
import { baselineOf, encodeRecord, hasUnseen, hydrateWhatsNew, openWhatsNew, parseRecord, pinnedOf, readLogs, rowsOf, syncWhatsNew, toastLine, unseenRows, whatsnewActions, WHATSNEW_KEY } from '../hooks/whatsnew'

const ESC = '\u001b'
const file = (...blocks: string[]) => blocks.join('\n')
const entry = (version: string, date: string, ...bullets: string[]) => `## ${version} — ${date}\n${bullets.map(bullet => `- ${bullet}`).join('\n')}\n`

afterAll(() => setLook('plain'))

describe('the changelog format', () => {
  it('reads versions newest first whatever the file order, with the kind of each bullet', () => {
    const parsed = parseChangelog(file(entry('0.2.0', '2026-09-01', 'fix: a', 'feat: b'), entry('0.10.0', '2026-10-01', 'breaking: c', 'chore: d'), entry('0.9.1', '2026-09-20', 'fix: e')))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries.map(each => each.version)).toEqual(['0.10.0', '0.9.1', '0.2.0'])
    expect(parsed.entries[0]?.changes).toEqual([{ kind: 'breaking', text: 'c' }, { kind: 'chore', text: 'd' }])
    expect(parsed.entries[0]?.date).toBe('2026-10-01')
    expect(parsed.truncated).toBe(false)
  })

  it('takes an em dash, an en dash or a hyphen in the header, CRLF line ends and * bullets; anything else is ignored', () => {
    const parsed = parseChangelog('# Changelog\r\nintro text\r\n## 1.0.0 – 2026-01-02\r\n* feat: star\r\n- note: not a kind\r\n- fix:\r\n- fix: kept\r\n## 0.9.0 - 2025-12-31\r\n- chore: old\r\n## v0.8.0 — 2025-12-01\r\n- fix: no v allowed\r\n## 0.7.0-rc1 — 2025-11-01\r\n- fix: not a plain semver\r\n')

    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.entries.map(each => each.version)).toEqual(['1.0.0', '0.9.0'])
    expect(parsed.entries[0]?.changes.map(change => change.text)).toEqual(['star', 'kept'])
  })

  it('a repeated version and an impossible date start nothing, and their bullets belong to no entry', () => {
    const parsed = parseChangelog(file(entry('1.0.0', '2026-01-02', 'fix: first'), entry('1.0.0', '2026-01-03', 'fix: second'), entry('0.9.0', '2026-13-40', 'fix: third')))

    expect(parsed).toMatchObject({ ok: true, truncated: true })
    if (!parsed.ok) return
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]?.changes).toEqual([{ kind: 'fix', text: 'first' }])
  })

  it('a month or day out of range starts no entry', () => {
    for (const date of ['2026-00-10', '2026-13-01', '2026-12-32', '2026-01-00']) expect(parseChangelog(entry('1.0.0', date, 'fix: x'))).toEqual({ ok: false, reason: 'garbled' })
    expect(parseChangelog(entry('1.0.0', '2026-12-31', 'fix: x'))).toMatchObject({ ok: true })
  })

  it('a file with no entry is garbled, an empty or non-text one is empty: a reason, never a throw', () => {
    expect(parseChangelog('just some prose\n- fix: but no header')).toEqual({ ok: false, reason: 'garbled' })
    expect(parseChangelog('   \n')).toEqual({ ok: false, reason: 'empty' })
    expect(parseChangelog(undefined)).toEqual({ ok: false, reason: 'empty' })
    expect(parseChangelog({ not: 'text' })).toEqual({ ok: false, reason: 'empty' })
    expect(parseChangelog('\u0000\u0001\u0002 binary')).toEqual({ ok: false, reason: 'garbled' })
  })

  it('compares versions as numbers, and a non-version sorts before any version', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('abc', '0.0.1')).toBeLessThan(0)
    expect(semverOf('1.2.3-rc1')).toBeNull()
    expect(semverOf('12345.0.0')).toBeNull()
    expect(entriesAfter([{ version: '0.3.0', date: '', changes: [], more: 0 }, { version: '0.2.0', date: '', changes: [], more: 0 }], '0.2.0').map(each => each.version)).toEqual(['0.3.0'])
  })
})

describe('the bounds', () => {
  it('10,000 entries keep the newest 40, and the file is said to be cut', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => entry(`0.${i}.0`, '2026-01-01', 'fix: x')).join('')
    const parsed = parseChangelog(big)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries.length).toBeLessThanOrEqual(LIMITS.entries)
    expect(parsed.truncated).toBe(true)
  })

  it('bullets past the cap are counted, not kept; a line is cut to the line limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => `fix: item ${i}`)
    const parsed = parseChangelog(file(entry('1.0.0', '2026-01-01', `feat: ${'word '.repeat(1_000)}`, ...many)))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.entries[0]?.changes).toHaveLength(LIMITS.changes)
    expect(parsed.entries[0]?.more).toBe(31 - LIMITS.changes)
    expect(parsed.entries[0]?.changes[0]?.text).toHaveLength(LIMITS.line)
    expect(parsed.entries[0]?.changes.every(change => change.text.length <= LIMITS.line)).toBe(true)
  })

  it('a megabyte of file, a megabyte of one line and a million-step header all finish quickly', () => {
    const started = Date.now()

    parseChangelog(`${entry('1.0.0', '2026-01-01', 'fix: a')}${'x'.repeat(1_000_000)}`)
    parseChangelog(`## 1.0.0 — 2026-01-01\n- fix: ${' '.repeat(1_000_000)}end`)
    parseChangelog(`## ${'1.'.repeat(500_000)} — 2026-01-01\n- fix: a`)
    parseChangelog(`- fix: ${'a'.repeat(200_000)}\n`.repeat(30))
    parseChangelog('\n'.repeat(1_000_000))
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it('lines past the line limit are not parsed either, and the cut is said', () => {
    const parsed = parseChangelog(`${entry('2.0.0', '2026-01-01', 'fix: early')}${'x\n'.repeat(LIMITS.lines + 500)}${entry('9.9.9', '2026-01-01', 'fix: late')}`)

    expect(parsed.ok && parsed.entries.map(each => each.version)).toEqual(['2.0.0'])
    expect(parsed.ok && parsed.truncated).toBe(true)
  })

  it('text past the byte limit is not parsed, so an entry placed beyond it never appears', () => {
    const parsed = parseChangelog(`${entry('2.0.0', '2026-01-01', 'fix: early')}${'x'.repeat(LIMITS.bytes)}\n${entry('9.9.9', '2026-01-01', 'fix: late')}`)

    expect(parsed.ok && parsed.entries.map(each => each.version)).toEqual(['2.0.0'])
    expect(parsed.ok && parsed.truncated).toBe(true)
  })
})

describe('hostile text', () => {
  const BAD = /[\u001b\u0007\u009b\u009d‪-‮⁠-⁯؜￹-￻​-‏\u{e0000}-\u{e0fff}\u0000-\u0008\u000e-\u001f]/u

  it('escape sequences, OSC links and clipboard writes, bidi and tag characters, and control characters never survive', () => {
    const lines = [`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`, `${ESC}]52;c;ZXZpbA==\u0007clip`, `${ESC}[31mred${ESC}[0m`, '‮exe.txt', 'a\u0000b\u0001c', '\u{e0041}tag', '⁦iso⁩', 'zero​width']
    const parsed = parseChangelog(entry('1.0.0', '2026-01-01', ...lines.map(line => `fix: ${line}`)))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const change of parsed.entries[0]?.changes ?? []) expect(change.text).not.toMatch(BAD)
  })

  it('credentials are masked, and one split by a control character is still one credential', () => {
    const parsed = parseChangelog(entry('1.0.0', '2026-01-01', 'fix: leaked sk-ant-api03-AAAAAAAAAAAAAAAAAAAA here', 'fix: token=hunter2secret', `fix: ghp_AAAAAAAA\u0000BBBBBBBBBBBB`, 'fix: Authorization: Bearer abcdefghijklmnop', 'fix: mail me at someone@example.com from /home/ruv/secret'))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const text = parsed.entries[0]?.changes.map(change => change.text).join('\n') ?? ''

    expect(text).not.toMatch(/sk-ant|hunter2|ghp_|BBBBBBBB|abcdefghijklmnop|someone@example|\/home\/ruv/)
    expect(text).toContain('‹masked›')
  })

  it('markdown and html stay plain characters: nothing here is rendered as anything but text', () => {
    const parsed = parseChangelog(entry('1.0.0', '2026-01-01', 'fix: [click](https://evil.example) <script>alert(1)</script> **bold**'))

    expect(parsed.ok && parsed.entries[0]?.changes[0]?.text).toBe('[click](https://evil.example) <script>alert(1)</script> **bold**')
  })
})

/** A file system holding `files`, as the host's `fs` answers (a regular file each). */
const fsOf = (files: Record<string, string>, links: string[] = []) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] === undefined ? Promise.reject(new Error('ENOENT')) : { kind: 'file', size: (files[path] as string).length, mtimeMs: 1, isLink: links.includes(path) }),
  list: async () => [],
})

type Fake = ReturnType<typeof fake>

function fake(files: Record<string, string> = {}, stored: Record<string, unknown> = {}, links: string[] = []) {
  const store = new Map<string, unknown>(Object.entries(stored))
  const log = { toasts: [] as { text: string; level: string | undefined }[], fetches: 0, invalidations: 0 }
  const host = {
    fs: fsOf(files, links),
    storeGet: async (key: string) => store.get(key),
    storeSet: async (key: string, value: unknown) => void store.set(key, value),
    toast: (text: string, _ms?: number, level?: string) => void log.toasts.push({ text, level }),
    invalidate: () => void (log.invalidations += 1),
    fetchText: async () => (log.fetches += 1, { ok: true, status: 200, text: '' }),
    run: async () => (log.fetches += 1, { exitCode: 0, stdout: '', stderr: '' }),
    pluginRoot: '/plugin',
  }

  return { host, store, log }
}

const install = (state: State, plugins: Record<string, string>) => {
  state.snapshot = { plugins: { installed: Object.entries(plugins).map(([name, version]) => ({ id: `${name}@ruflo`, name, marketplace: 'ruflo', version, scope: 'user', installPath: `/cache/${name}/${version}` })) } } as never
}

const stateWith = (plugins: Record<string, string>): State => {
  const state = newState({})

  install(state, plugins)
  state.isInteractive = true

  return state
}

const record = (fakeHost: Fake) => parseRecord(fakeHost.store.get(WHATSNEW_KEY))

describe('what was looked at', () => {
  it('the record survives a round trip, and anything unreadable is no record', () => {
    const rec = { ...baselineOf([{ name: 'ruflo-swarm', version: '0.4.0' }]), pinned: ['ruflo-swarm@0.4.0'], dismissed: ['ruflo-mods@0.1.0'], toast: false }

    expect(parseRecord(encodeRecord(rec))).toEqual(rec)
    expect(parseRecord('{nope')).toBeNull()
    expect(parseRecord(42)).toBeNull()
    expect(parseRecord('x'.repeat(70_000))).toBeNull()
    expect(parseRecord(JSON.stringify({ seen: { 'bad name!': '1.0.0', ok: '1.0.0', worse: '1.0' }, pinned: ['a@1.0.0', 'nope', 7] }))).toMatchObject({ seen: { ok: '1.0.0' }, pinned: ['a@1.0.0'], toast: true })
  })

  it('the first sight of the installed versions is a baseline: nothing is new and nothing is toasted', async () => {
    const world = fake()
    const state = stateWith({ 'ruflo-swarm': '0.4.0' })

    await hydrateWhatsNew(state, world.host as never)
    syncWhatsNew(state, world.host as never)
    expect(hasUnseen(state)).toBe(false)
    expect(world.log.toasts).toEqual([])
    expect(record(world)?.seen).toMatchObject({ 'ruflo-swarm': '0.4.0', 'ruflo-console': CONSOLE_VERSION })
  })

  it('a version that lands is marked new, toasted once at the info level, and not again, even after a restart', async () => {
    const world = fake()
    const state = stateWith({ 'ruflo-swarm': '0.4.0' })

    await hydrateWhatsNew(state, world.host as never)
    syncWhatsNew(state, world.host as never)
    install(state, { 'ruflo-swarm': '0.5.0' })
    expect(hasUnseen(state)).toBe(true)
    syncWhatsNew(state, world.host as never)
    syncWhatsNew(state, world.host as never)
    expect(world.log.toasts).toHaveLength(1)
    expect(world.log.toasts[0]).toMatchObject({ level: 'info' })
    expect(world.log.toasts[0]?.text).toContain('ruflo-swarm 0.5.0')
    // Still unseen (the page was not opened) but toasted: a new session does not say it again.

    const again = stateWith({ 'ruflo-swarm': '0.5.0' })
    const later = fake({}, { [WHATSNEW_KEY]: world.store.get(WHATSNEW_KEY) })

    await hydrateWhatsNew(again, later.host as never)
    syncWhatsNew(again, later.host as never)
    expect(hasUnseen(again)).toBe(true)
    expect(later.log.toasts).toEqual([])
  })

  it('the switch turns the toast off (the marker still shows) and back on; many new versions make one toast with a count', async () => {
    const world = fake()
    const state = stateWith({ a: '0.1.0', b: '0.1.0', c: '0.1.0' })

    await hydrateWhatsNew(state, world.host as never)
    syncWhatsNew(state, world.host as never)
    whatsnewActions(state, world.host as never).toggleToast()
    expect(record(world)?.toast).toBe(false)
    install(state, { a: '0.2.0', b: '0.2.0', c: '0.2.0' })
    syncWhatsNew(state, world.host as never)
    expect(world.log.toasts).toEqual([])
    expect(hasUnseen(state)).toBe(true)
    whatsnewActions(state, world.host as never).toggleToast()
    install(state, { a: '0.3.0', b: '0.3.0', c: '0.3.0' })
    syncWhatsNew(state, world.host as never)
    expect(world.log.toasts).toHaveLength(1)
    expect(world.log.toasts[0]?.text).toMatch(/and \d+ more/)
  })

  it('a session nobody can see (not interactive) toasts nothing but still records it', async () => {
    const world = fake()
    const state = stateWith({ a: '0.1.0' })

    await hydrateWhatsNew(state, world.host as never)
    syncWhatsNew(state, world.host as never)
    state.isInteractive = false
    install(state, { a: '0.2.0' })
    syncWhatsNew(state, world.host as never)
    expect(world.log.toasts).toEqual([])
    expect(record(world)?.toasted.a).toBe('0.2.0')
  })

  it('a downgrade, an equal version and a pre-release are never new', () => {
    const rec = baselineOf([{ name: 'a', version: '1.0.0' }, { name: 'ruflo-console', version: CONSOLE_VERSION }])
    const state = stateWith({ a: '0.9.0' })

    expect(unseenRows(rowsOf(state), rec).map(row => row.name)).toEqual([])
    install(state, { a: '1.0.0' })
    expect(unseenRows(rowsOf(state), rec)).toEqual([])
    install(state, { a: '1.1.0-rc1' })
    expect(unseenRows(rowsOf(state), rec)).toEqual([])
  })

  it('only ruflo-marketplace plugins with a plain version and a safe name are listed, and the console is always there', () => {
    const state = newState({})

    state.snapshot = { plugins: { installed: [{ id: 'x@other', name: 'x', marketplace: 'other', version: '1.0.0', scope: 'user' }, { id: 'ruflo-a@ruflo', name: 'ruflo-a', marketplace: 'ruflo', version: '1.0.0', scope: 'user', installPath: '/p/a' }, { id: 'bad@ruflo', name: 'bad name', marketplace: 'ruflo', version: '1.0.0', scope: 'user' }, { id: 'pre@ruflo', name: 'pre', marketplace: 'ruflo', version: '1.0.0-rc', scope: 'user' }] } } as never
    expect(rowsOf(state, '/plugin').map(row => row.name)).toEqual(['ruflo-console', 'ruflo-a'])
    expect(rowsOf(state, '/plugin')[0]).toMatchObject({ version: CONSOLE_VERSION, path: '/plugin' })
  })

  it('the toast line is one short clean line', () => {
    const line = toastLine([{ name: 'a', version: '1.0.0', path: null }, { name: 'b', version: '2.0.0', path: null }, { name: 'c', version: '3.0.0', path: null }])

    expect(line).toBe('What\'s new: a 1.0.0, b 2.0.0 and 1 more (TOOLS → What\'s new)')
    expect(line.length).toBeLessThanOrEqual(118)
  })
})

const NOTES = '## 0.5.0 — 2026-10-05\n- breaking: the flag --old is gone\n- feat: the new thing\n- fix: a crash\n## 0.4.0 — 2026-09-01\n- feat: older thing\n## 0.3.0 — 2026-08-01\n- chore: oldest\n'

async function opened(files: Record<string, string>, seen: Record<string, string>, installed: Record<string, string>, links: string[] = []) {
  const world = fake(files, { [WHATSNEW_KEY]: encodeRecord({ ...baselineOf([]), seen, toasted: seen }) }, links)
  const state = stateWith(installed)

  await hydrateWhatsNew(state, world.host as never)
  await openWhatsNew(state, world.host as never)

  return { world, state }
}

describe('opening the page', () => {
  it('reads each plugin changelog from its install path, keeps the divider where the last look was, then counts everything as looked at', async () => {
    const { world, state } = await opened({ '/cache/ruflo-swarm/0.5.0/CHANGELOG.md': NOTES }, { 'ruflo-swarm': '0.4.0' }, { 'ruflo-swarm': '0.5.0' })

    expect(state.whatsnew.before).toEqual({ 'ruflo-swarm': '0.4.0' })
    expect(record(world)?.seen['ruflo-swarm']).toBe('0.5.0')
    expect(hasUnseen(state)).toBe(false)

    const text = viewText({ state, nowMs: 5_000, columns: 120, act: noAct }, 'whatsnew')

    expect(text.indexOf('ruflo-swarm 0.5.0')).toBeGreaterThan(-1)
    expect(text.indexOf('ruflo-swarm 0.5.0')).toBeLessThan(text.indexOf('you last looked here'))
    expect(text.indexOf('you last looked here')).toBeLessThan(text.indexOf('ruflo-swarm 0.4.0'))
    expect(text.indexOf('ruflo-swarm 0.4.0')).toBeLessThan(text.indexOf('ruflo-swarm 0.3.0'))
    expect(text).toContain('the new thing')
    expect(world.log.fetches).toBe(0)
  })

  it('a breaking change among the new entries is pinned at the top, stays pinned in the next session, and goes only when dismissed', async () => {
    const { world, state } = await opened({ '/cache/ruflo-swarm/0.5.0/CHANGELOG.md': NOTES }, { 'ruflo-swarm': '0.4.0' }, { 'ruflo-swarm': '0.5.0' })

    expect(pinnedOf(state)).toEqual([{ key: 'ruflo-swarm@0.5.0', name: 'ruflo-swarm', version: '0.5.0', texts: ['the flag --old is gone'] }])

    const top = viewText({ state, nowMs: 5_000, columns: 120, act: noAct }, 'whatsnew')

    expect(top.indexOf('pinned until you dismiss')).toBeGreaterThan(-1)
    expect(top.indexOf('the flag --old is gone')).toBeLessThan(top.indexOf('Since you last looked'))

    // Leave, come back in a fresh session: the page opens with nothing new, and the pin is still there.
    const next = stateWith({ 'ruflo-swarm': '0.5.0' })
    const later = fake({ '/cache/ruflo-swarm/0.5.0/CHANGELOG.md': NOTES }, { [WHATSNEW_KEY]: world.store.get(WHATSNEW_KEY) })

    await hydrateWhatsNew(next, later.host as never)
    await openWhatsNew(next, later.host as never)
    expect(pinnedOf(next)).toHaveLength(1)
    whatsnewActions(next, later.host as never).dismiss('ruflo-swarm@0.5.0')
    expect(pinnedOf(next)).toEqual([])
    expect(parseRecord(later.store.get(WHATSNEW_KEY))?.dismissed).toEqual(['ruflo-swarm@0.5.0'])

    // Dismissed means dismissed: opening again never pins it back.
    const third = stateWith({ 'ruflo-swarm': '0.5.0' })
    const last = fake({ '/cache/ruflo-swarm/0.5.0/CHANGELOG.md': NOTES }, { [WHATSNEW_KEY]: encodeRecord({ ...baselineOf([]), seen: { 'ruflo-swarm': '0.4.0' }, dismissed: ['ruflo-swarm@0.5.0'] }) })

    await hydrateWhatsNew(third, last.host as never)
    await openWhatsNew(third, last.host as never)
    expect(pinnedOf(third)).toEqual([])
  })

  it('a plugin with no changelog, a garbled one, an oversize one and a symlink each say so and break nothing', async () => {
    const { state } = await opened(
      { '/cache/a/1.0.0/CHANGELOG.md': 'no entries here', '/cache/c/1.0.0/CHANGELOG.md': 'x'.repeat(300_000), '/cache/d/1.0.0/CHANGELOG.md': NOTES, '/cache/e/1.0.0/CHANGELOG.md': entry('1.0.0', '2026-01-01', 'fix: fine') },
      { e: '0.9.0' },
      { a: '1.0.0', b: '1.0.0', c: '1.0.0', d: '1.0.0', e: '1.0.0' },
      ['/cache/d/1.0.0/CHANGELOG.md'],
    )
    const text = viewText({ state, nowMs: 5_000, columns: 120, act: noAct }, 'whatsnew')

    expect(text).toContain('fine')
    expect(state.whatsnew.logs.map(log => [log.name, log.result.ok ? 'ok' : log.result.reason])).toEqual([['ruflo-console', 'missing'], ['a', 'garbled'], ['b', 'missing'], ['c', 'too-large'], ['d', 'unreadable'], ['e', 'ok']])
    expect(readLogs).toBeTypeOf('function')
  })

  it('with no changelog anywhere the page says so in one clear line instead of drawing an empty list', async () => {
    const { state } = await opened({}, { a: '1.0.0' }, { a: '1.0.0' })
    const text = viewText({ state, nowMs: 5_000, columns: 100, act: noAct }, 'whatsnew')

    expect(text).toContain('No installed ruflo plugin ships a readable CHANGELOG.md yet')
    expect(text).not.toMatch(/\bundefined\b|\[object Object\]|NaN/)
  })

  it('a newer ruflo-console known from the update check is named with where to read its notes, and the page asks nothing of the network', async () => {
    const { world, state } = await opened({}, { a: '1.0.0' }, { a: '1.0.0' })

    state.updateAvailable = '9.9.9'

    const text = viewText({ state, nowMs: 5_000, columns: 120, act: noAct }, 'whatsnew')

    expect(text).toContain('9.9.9 is published')
    expect(text).toContain('Its notes are not fetched here')
    expect(text).toContain('https://github.com/ruvnet/ruflo/releases')
    expect(world.log.fetches).toBe(0)
  })

  it('hostile files draw as clean text in both looks at narrow and wide widths', async () => {
    const evil = `## 1.0.0 — 2026-10-05\n- breaking: ${ESC}[2J${ESC}]52;c;ZXZpbA==\u0007 wipe ‮ sk-ant-api03-AAAAAAAAAAAAAAAAAAAA\n- fix: ${'w'.repeat(5_000)}\n`
    const { state } = await opened({ '/cache/ruflo-swarm/1.0.0/CHANGELOG.md': evil + Array.from({ length: 5_000 }, (_, i) => `## 0.${i}.0 — 2026-01-01\n- fix: n\n`).join('') }, { 'ruflo-swarm': '0.0.1' }, { 'ruflo-swarm': '1.0.0' })

    for (const look of ['bbs', 'plain'] as const) {
      setLook(look)

      for (const columns of [44, 100, 200]) {
        const text = viewText({ state, nowMs: 5_000, columns, act: noAct }, 'whatsnew')

        expect(text).not.toMatch(/[\u001b\u0007‮]|sk-ant/)
        expect(text.split('\n').length).toBeLessThan(400)
      }
    }
  })

  it('leaving the page forgets the divider; the toast switch shows its state', async () => {
    const { state } = await opened({}, { a: '1.0.0' }, { a: '1.0.0' })

    expect(viewText({ state, nowMs: 5_000, columns: 100, act: noAct }, 'whatsnew')).toContain('☑ toast when something new lands')
    state.whatsnew.rec = { ...(state.whatsnew.rec as NonNullable<typeof state.whatsnew.rec>), toast: false }
    expect(viewText({ state, nowMs: 5_000, columns: 100, act: noAct }, 'whatsnew')).toContain('☐ toast when something new lands')
  })
})

const noAct = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : noAct), apply: () => undefined }) as unknown as Actions

describe('the plugins’ own changelogs (ADR-478)', () => {
  const plugins = join(fileURLToPath(import.meta.url), '..', '..', '..')
  const names = readdirSync(plugins).filter(name => existsSync(join(plugins, name, '.claude-plugin', 'plugin.json')))
  const GATED = ['ruflo-console', 'ruflo-mods', 'ruflo-swarm', 'ruflo-protector']

  it('every plugin ships a CHANGELOG.md the page can read (a pre-release manifest is listed for people, not parsed)', () => {
    expect(names.length).toBeGreaterThan(20)

    for (const name of names) {
      const version = (JSON.parse(readFileSync(join(plugins, name, '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: string }).version ?? ''
      const text = existsSync(join(plugins, name, 'CHANGELOG.md')) ? readFileSync(join(plugins, name, 'CHANGELOG.md'), 'utf8') : null
      const parsed = parseChangelog(text)

      expect(text, `${name} has no CHANGELOG.md`).not.toBeNull()
      if (semverOf(version) !== null) expect(parsed.ok, `${name} CHANGELOG.md does not parse`).toBe(true)
    }
  })

  it('the plugins that bump on their own cadence have an entry for their manifest version, which is the newest', () => {
    for (const name of GATED) {
      const version = (JSON.parse(readFileSync(join(plugins, name, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version
      const parsed = parseChangelog(readFileSync(join(plugins, name, 'CHANGELOG.md'), 'utf8'))

      expect(parsed.ok && parsed.entries[0]?.version, `${name}: newest entry is not ${version}`).toBe(version)
    }
  })
})
