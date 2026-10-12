/**
 * Theme Studio, adversarial: what it does with data it did not write (an AI's JSON, a corrupted or hostile saved store) and what a theme can
 * never put on the model-facing screen. Colours are six-digit hex only, names are a short allow-list, nothing unknown survives.
 * Run with: npx vitest run plugins/ruflo-console/tests/themes-adversarial.spec.ts
 */
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '../hooks/host'
import { activeTheme, loadThemes, ORBITAL_THEME, parseTheme, THEME_STORE_KEY, themeActions, themeFromText, themesOf } from '../hooks/themes'
import { newState, type Actions } from '../hooks/state'
import { viewText } from '../hooks/views/pane'

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
const good = () => JSON.parse(JSON.stringify(ORBITAL_THEME)) as typeof ORBITAL_THEME
const hostOf = (store = new Map<string, unknown>()) => ({ storeGet: vi.fn(async (key: string) => store.get(key)), storeSet: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }), invalidate: vi.fn() }) as unknown as Host & { storeSet: ReturnType<typeof vi.fn> }
const act: Actions = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_target, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy as Actions
})()
// eslint-disable-next-line no-control-regex -- the point of the test: ESC, C0, DEL, C1 and the bidi / invisible format characters.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/

describe('Theme Studio import is a closed schema', () => {
  const cases: [string, unknown][] = [
    ['an extra key at the top', { ...good(), extra: 1 }],
    ['an extra key in the palette', { ...good(), palette: { ...good().palette, accent: '#ffffff' } }],
    ['an extra key in motion', { ...good(), motion: { ...good().motion, fps: 60 } }],
    ['a missing palette role', { ...good(), palette: { head: '#ffffff', ok: '#ffffff', bad: '#ffffff', warn: '#ffffff', info: '#ffffff' } }],
    ['version 2', { ...good(), version: 2 }],
    ['a numeric name', { ...good(), name: 5 }],
    ['an empty name', { ...good(), name: '' }],
    ['a 41 character name', { ...good(), name: 'a'.repeat(41) }],
    ['a name starting with a space', { ...good(), name: ' Orbital' }],
    ['a name with ESC', { ...good(), name: 'Neo\u001b[2J' }],
    ['a name with a newline', { ...good(), name: 'Neo\nTwo' }],
    ['a name with NUL', { ...good(), name: 'Neo\u0000' }],
    ['a name with a right-to-left override', { ...good(), name: 'Neo‮Two' }],
    ['a name with a zero width joiner', { ...good(), name: 'Neo‍Two' }],
    ['a name with a C1 control', { ...good(), name: 'Neo\u009bTwo' }],
    ['a name with markup', { ...good(), name: 'Neo<b>' }],
    ['a name with a slash', { ...good(), name: 'a/b' }],
    ['a colour with an escape', { ...good(), palette: { ...good().palette, head: '#ff00\u001b' } }],
    ['a colour name', { ...good(), palette: { ...good().palette, head: 'red' } }],
    ['a three digit colour', { ...good(), palette: { ...good().palette, head: '#fff' } }],
    ['an eight digit colour', { ...good(), palette: { ...good().palette, head: '#ff0000ff' } }],
    ['a colour with CSS', { ...good(), palette: { ...good().palette, head: 'rgb(1,2,3)' } }],
    ['a colour that is a number', { ...good(), palette: { ...good().palette, head: 0xff0000 } }],
    ['speed below the bound', { ...good(), motion: { ...good().motion, speed: 0.1 } }],
    ['speed above the bound', { ...good(), motion: { ...good().motion, speed: 3 } }],
    ['speed as a string', { ...good(), motion: { ...good().motion, speed: '1' } }],
    ['speed as null', { ...good(), motion: { ...good().motion, speed: null } }],
    ['a layer as a string', { ...good(), motion: { ...good().motion, globe: 'true' } }],
    ['an array for the root', [good()]],
    ['an array for the palette', { ...good(), palette: Object.values(good().palette) }],
    ['null', null],
    ['a string', 'Orbital'],
    ['a number', 7],
  ]

  it.each(cases)('rejects %s', (_label, value) => {
    expect(parseTheme(value)).toBeNull()
    expect(themeFromText(JSON.stringify(value))).toBeNull()
  })

  it('rejects prototype keys however they arrive, and pollutes nothing', () => {
    const texts = [
      '{"__proto__":{"polluted":true},"version":1,"name":"P","palette":{"head":"#f06449","ok":"#72c79b","bad":"#ff6868","warn":"#e3ba74","info":"#c6cbc8","background":"#000000"},"motion":{"speed":1,"stars":true,"globe":true,"topology":true}}',
      '{"version":1,"name":"P","palette":{"__proto__":"#ffffff","head":"#f06449","ok":"#72c79b","bad":"#ff6868","warn":"#e3ba74","info":"#c6cbc8","background":"#000000"},"motion":{"speed":1,"stars":true,"globe":true,"topology":true}}',
      '{"version":1,"name":"P","constructor":{"prototype":{"polluted":true}},"palette":{"head":"#f06449","ok":"#72c79b","bad":"#ff6868","warn":"#e3ba74","info":"#c6cbc8","background":"#000000"},"motion":{"speed":1,"stars":true,"globe":true,"topology":true}}',
      '{"version":1,"name":"__proto__","palette":{"head":"#f06449","ok":"#72c79b","bad":"#ff6868","warn":"#e3ba74","info":"#c6cbc8","background":"#000000"},"motion":{"speed":1,"stars":true,"globe":true,"topology":true,"constructor":1}}',
    ]

    for (const text of texts) expect(themeFromText(text)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    // A name of "__proto__" is a plain string that passes the name rule, and must still be only data.
    const odd = parseTheme({ ...good(), name: 'proto' })

    expect(odd?.name).toBe('proto')
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype)
  })

  it('rejects text over 4096 characters before it is parsed, and survives depth bombs and junk', () => {
    const pad = ' '.repeat(4097)

    expect(themeFromText(`${JSON.stringify(good())}${pad}`)).toBeNull()
    expect(themeFromText(JSON.stringify(good()))).not.toBeNull()
    expect(themeFromText(`${'['.repeat(3000)}${']'.repeat(3000)}`)).toBeNull()
    expect(themeFromText(`{"a":${'{"a":'.repeat(900)}1${'}'.repeat(901)}`)).toBeNull()
    for (const junk of ['', '   ', '{', '}{', 'null', '"x"', '\u0000', '{"version":1,', '```json\n```', '```\n{}\n```', '\u001b[31m{}']) expect(themeFromText(junk)).toBeNull()
  })

  it('accepts a fenced block and normalises colours to lower case without keeping the original object', () => {
    const source = { ...good(), name: 'Fenced', palette: { ...good().palette, head: '#F06449' } }
    const theme = themeFromText(`\`\`\`json\n${JSON.stringify(source)}\n\`\`\``)

    expect(theme?.palette.head).toBe('#f06449')
    expect(theme?.palette).not.toBe(source.palette)
    expect(Object.keys(theme ?? {}).sort()).toEqual(['motion', 'name', 'palette', 'version'])
  })
})

describe('Theme Studio actions never apply what they refuse', () => {
  it('keeps the draft and the active theme when an import is hostile, and says so', async () => {
    const state = newState({ look: 'bbs' }), host = hostOf(), a = themeActions(state, host, vi.fn())
    const studio = themesOf(state)
    const before = JSON.stringify([studio.draft, studio.active, studio.selected, state.options.look])

    for (const text of ['{"version":1,"name":"Evil\u001b[2J"}', '{"__proto__":{"x":1}}', 'not json', '{"version":1,'.repeat(400)]) {
      a.import(text)
      expect(studio.message).toMatch(/Invalid theme JSON/)
    }
    await flush()
    expect(JSON.stringify([studio.draft, studio.active, studio.selected, state.options.look])).toBe(before)
    expect(host.storeSet).not.toHaveBeenCalled()
  })

  it('never lets a name, a colour or a layer edit smuggle a control character into the draft', () => {
    const state = newState({}), a = themeActions(state, hostOf(), vi.fn()), studio = themesOf(state)

    for (const name of ['A\u001bB', 'A‮B', 'A\nB', 'A\u0000B', '<script>', '', ' ', 'x'.repeat(41)]) {
      a.name(name)
      expect(studio.draft.name).toBe(ORBITAL_THEME.name)
    }
    for (const value of ['red', '#12345', '#1234567', '#12345\u001b', '\u001b[31m', '#gggggg', '', '#ffffff\n#000000']) {
      a.color('head', value)
      expect(studio.draft.palette.head).toBe(ORBITAL_THEME.palette.head)
    }
    a.color('__proto__' as never, '#ffffff')
    a.color('constructor' as never, '#ffffff')
    a.motion('speed', 99)
    a.motion('speed', Number.NaN)
    a.motion('speed', Infinity)
    a.motion('extra' as never, true)
    expect(studio.draft).toEqual(ORBITAL_THEME)
    expect(Object.keys(studio.draft.palette).sort()).toEqual(['background', 'bad', 'head', 'info', 'ok', 'warn'])
  })

  it('holds the twelve custom slot cap, replaces by name, and never saves an unreadable palette', async () => {
    const state = newState({}), host = hostOf(), a = themeActions(state, host, vi.fn()), studio = themesOf(state)

    for (let i = 0; i < 12; i++) {
      a.name(`Slot ${i}`)
      a.save()
      await flush()
    }
    expect(studio.saved).toHaveLength(12)
    a.name('Slot 12')
    a.save()
    await flush()
    expect(studio.saved).toHaveLength(12)
    expect(studio.message).toMatch(/Twelve custom themes/)
    a.name('Slot 3')
    a.color('head', '#79dfff')
    a.save()
    await flush()
    expect(studio.saved).toHaveLength(12)
    expect(studio.saved.find(t => t.name === 'Slot 3')?.palette.head).toBe('#79dfff')
    const stored = (host.storeSet.mock.calls.at(-1) as [string, { saved: unknown[] }])[1]

    expect(stored.saved).toHaveLength(12)
    a.name('Dim')
    a.color('head', '#050505')
    const calls = host.storeSet.mock.calls.length

    a.save()
    await flush()
    expect(host.storeSet.mock.calls.length).toBe(calls)
    expect(studio.message).toMatch(/Increase contrast/)
  })

  it('keeps the active theme when the host store throws, and when it never answers a load', async () => {
    const state = newState({ look: 'orbital' }), host = hostOf(), a = themeActions(state, host, vi.fn())

    a.select('preset:arctic')
    await flush()
    host.storeSet.mockRejectedValueOnce(new Error('disk full'))
    a.name('Fails')
    a.save()
    await flush()
    expect(activeTheme(state).name).toBe('Arctic')
    expect(themesOf(state).selected).toBe('preset:arctic')
    expect(themesOf(state).message).toMatch(/Could not save/)
    expect(themesOf(state).saving).toBe(false)
  })
})

describe('Theme Studio reads a store it does not trust', () => {
  const load = async (value: unknown) => {
    const state = newState({ look: 'bbs' }), store = new Map<string, unknown>([[THEME_STORE_KEY, value]])

    await loadThemes(state, hostOf(store))

    return state
  }

  it('ignores a store that is not an object, or throws', async () => {
    for (const value of [null, 'x', 5, [], true, undefined]) {
      const state = await load(value)

      expect(themesOf(state).saved).toEqual([])
      expect(state.options.look).toBe('bbs')
    }
    const state = newState({ look: 'bbs' }), host = hostOf()

    host.storeGet = vi.fn(async () => { throw new Error('boom') }) as never
    await loadThemes(state, host)
    expect(state.options.look).toBe('bbs')
    expect(themesOf(state).message).toMatch(/could not be read/)
  })

  it('keeps at most twelve themes and only the valid ones, and selects nothing it does not hold', async () => {
    const saved = [...Array.from({ length: 30 }, (_, i) => ({ ...good(), name: `T${i}` })), { ...good(), name: 'Bad\u001b' }, { ...good(), extra: 1 }, null, 'x', 7]
    const state = await load({ selected: 'custom:T25', saved })

    expect(themesOf(state).saved.length).toBeLessThanOrEqual(12)
    expect(themesOf(state).saved.every(t => parseTheme(t) !== null)).toBe(true)
    expect(themesOf(state).selected).toBeNull()
    expect(state.options.look).toBe('bbs')
    for (const selected of ['preset:../../etc/passwd', 'custom:__proto__', 'custom:', 'preset:', 42, {}, '\u001b[2J']) {
      const s = await load({ selected, saved: [] })

      expect(themesOf(s).selected).toBeNull()
      expect(s.options.look).toBe('bbs')
    }
  })

  it('restores a valid look name and nothing else for the three looks', async () => {
    for (const look of ['bbs', 'plain', 'orbital']) expect((await load({ selected: look, saved: [] })).options.look).toBe(look)
    expect((await load({ selected: 'matrix', saved: [] })).options.look).toBe('bbs')
  })
})

describe('what a theme puts on the model-facing screen', () => {
  it('shows names and states on the Theme Studio page, never theme JSON or control characters, in any look', async () => {
    for (const look of ['bbs', 'plain', 'orbital'] as const) {
      const state = newState({ look, boot: false }), host = hostOf(), a = themeActions(state, host, vi.fn())

      a.name('Probe One')
      a.color('head', '#79dfff')
      a.save()
      await flush()
      state.view = 'themes'
      const text = viewText({ state, nowMs: 5_000, columns: 120, act }, 'themes')

      expect(UNSAFE.test(text.replace(/\n/g, ''))).toBe(false)
      expect(text).not.toMatch(/"palette"|"version"\s*:|"motion"\s*:/)
      // The editor rows name each role's colour (a person edits them there); that is the page's own content, not a JSON dump.
      expect(text).toContain('Probe One')
    }
  })

  it('keeps the other pages free of the active palette too', async () => {
    const state = newState({ look: 'orbital', boot: false }), a = themeActions(state, hostOf(), vi.fn())

    a.name('Probe Two')
    a.color('head', '#79dfff')
    a.save()
    await flush()
    for (const view of ['menu', 'overview', 'settings', 'swarm'] as const) {
      state.view = view
      const text = viewText({ state, nowMs: 5_000, columns: 120, act }, view)

      expect(UNSAFE.test(text.replace(/\n/g, ''))).toBe(false)
      expect(text).not.toMatch(/#79dfff/i)
    }
  })
})
