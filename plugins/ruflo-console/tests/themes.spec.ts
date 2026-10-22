import { describe, expect, it, vi } from 'vitest'
import { activeTheme, COLOR_KEYS, contrast, loadThemes, lowContrast, ORBITAL_THEME, parseTheme, themeActions, themeFromText, themesOf, themeLayout, THEME_PRESETS } from '../hooks/themes'
import { newState } from '../hooks/state'
import type { Host } from '../hooks/host'
import { orbitalBoot, orbitalGlobe, orbitalHeader } from '../hooks/gfx/orbital'
import { picturesOf } from '../hooks/views/frames'
import { groupOf, findPages } from '../hooks/nav-state'
import { paneView } from '../hooks/views/pane'
import { GROUPS } from '../hooks/views/menu'
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
const copy = () => JSON.parse(JSON.stringify(ORBITAL_THEME))
const hostOf = (store = new Map<string, unknown>()) => ({ storeGet: vi.fn(async (key: string) => store.get(key)), storeSet: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }), invalidate: vi.fn(), fs: { read: vi.fn(async (path: string) => path.endsWith('SKILL.md') ? 'Generate one preset.' : 'version: 1; six hex colors; motion') }, pluginRoot: '/plugin' }) as unknown as Host

describe('Theme Studio', () => {
  it('loads each bundled palette, restores its selection and leaves custom slots free', async () => {
    expect(new Set(THEME_PRESETS.map(p => p.id)).size).toBe(THEME_PRESETS.length)
    for (const { id, theme } of THEME_PRESETS) {
      expect(parseTheme(theme)).toEqual(theme)
      for (const key of COLOR_KEYS.filter(k => k !== 'background')) expect(contrast(theme.palette[key], theme.palette.background)).toBeGreaterThanOrEqual(4.5)
      const store = new Map(), host = hostOf(store), state = newState({ look: 'bbs' })
      const act = themeActions(state, host, vi.fn())
      act.select(`preset:${id}`); await flush()
      expect(state.options.look).toBe('orbital')
      expect(activeTheme(state)).toEqual(theme)
      expect(themesOf(state).saved).toHaveLength(0)
      const restored = newState({ look: 'plain' }); await loadThemes(restored, host)
      expect(activeTheme(restored)).toEqual(theme)
      expect(themesOf(restored).selected).toBe(`preset:${id}`)
      act.color('head', '#ffffff')
      expect(activeTheme(state).palette.head).toBe(theme.palette.head)
      act.save(); await flush()
      expect(themesOf(state).selected).toBe(`custom:${theme.name}`)
      expect(theme.palette.head).not.toBe('#ffffff')
      act.select('orbital'); await flush()
      expect(themesOf(state).draft).toEqual(ORBITAL_THEME)
    }
  })
  it('leaves selection and draft intact when a bundled selection cannot persist', async () => {
    const state = newState({ look: 'orbital' }), host = hostOf(), act = themeActions(state, host, vi.fn())
    act.select('preset:arctic'); await flush()
    host.storeSet = vi.fn(async () => { throw Error('denied') })
    act.select('preset:synthwave'); await flush()
    expect(activeTheme(state).name).toBe('Arctic')
    expect(themesOf(state).draft.name).toBe('Arctic')
    act.select('preset:unknown'); await flush()
    expect(themesOf(state).selected).toBe('preset:arctic')
    act.reset(); await flush()
    expect(themesOf(state).draft.name).toBe('Arctic')
    expect(themesOf(state).selected).toBe('preset:arctic')
  })
  it('is available in main menu and Tools navigation/search', () => {
    expect(groupOf('themes')).toBe('TOOLS')
    expect(findPages('color')).toContain('themes')
    expect(GROUPS.find(g => g.title === 'TOOLS')!.sections.flatMap(s => s.items).some(i => i.go === 'themes')).toBe(true)
  })
  it('opens from the real main menu and retains the existing console shell', () => {
    const state = newState({ look: 'orbital', boot: false }); state.view = 'menu'; state.pane.rows = 60
    const noop: any = new Proxy(() => undefined, { get: () => noop })
    const act = new Proxy(noop, { get: (_, key) => key === 'view' ? (view: typeof state.view) => { state.view = view } : noop })
    const kit = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Raster'].map(type => [type, (props: any) => ({ type, props })]))
    const flat = (node: any): any[] => node && typeof node === 'object' ? [node, ...(Array.isArray(node.props?.children) ? node.props.children.flatMap(flat) : flat(node.props?.children))] : []
    const draw = () => paneView({ state, kit, act, columns: 116, nowMs: 5000, pictures: picturesOf(state, 116, 5000, 5000) } as any)
    const entry = flat(draw()).find(node => node.props?.key === 'menu-go-themes')
    expect(entry).toBeDefined(); entry.props.onPress()
    expect(state.view).toBe('themes')
    const keys = flat(draw()).map(node => node.props?.key)
    for (const key of ['tabs', 'pane-icons', 'footer', 'theme-layout', 'tab-menu', 'theme-editor', 'theme-stage']) expect(keys).toContain(key)
    for (const { id } of THEME_PRESETS) expect(keys).toContain(`theme-preset-${id}`)
    flat(draw()).find(node => node.props?.key === 'tab-menu').props.onPress()
    expect(state.view).toBe('menu')
  })
  it('keeps editor and preview within one width at the breakpoint', () => {
    for (const width of [12, 20, 44, 72, 99, 100, 120, 160, 240]) {
      const layout = themeLayout(width)
      expect(layout.wide ? layout.controls + 2 + layout.preview : layout.preview).toBeLessThanOrEqual(width)
      expect(layout.wide).toBe(width >= 100)
    }
  })
  it('switches focused editors and discards only unsaved changes', async () => {
    const state = newState({ look: 'orbital' }), host = hostOf(), act = themeActions(state, host, vi.fn())
    act.tab('motion'); act.role('warn'); act.name('Saved'); act.save(); await flush()
    act.color('head', '#ffffff'); act.discard()
    expect(themesOf(state).tab).toBe('motion')
    expect(themesOf(state).role).toBe('warn')
    expect(themesOf(state).draft).toEqual(activeTheme(state))
    expect(themesOf(state).saved).toHaveLength(1)
  })
  it('accepts only bounded data and clones it', () => {
    const raw = copy(), parsed = parseTheme(raw)!
    expect(parsed).toEqual(raw)
    raw.palette.head = '#ffffff'
    expect(parsed.palette.head).toBe('#f06449')
    for (const patch of [{ version: 2 }, { script: 'eval()' }, { name: '\x1b[31m' }, { name: 'x'.repeat(41) }, { palette: {} }, { motion: { speed: 3, stars: true, globe: true, topology: true } }]) expect(parseTheme({ ...copy(), ...patch })).toBeNull()
    for (const color of ['red', '#fff', '#GG0000', '#000000\n']) expect(parseTheme({ ...copy(), palette: { ...copy().palette, head: color } })).toBeNull()
    expect(themeFromText('x'.repeat(4097))).toBeNull()
    expect(themeFromText('```json\n' + JSON.stringify(copy()) + '\n```')).toEqual(copy())
    expect(themeFromText('{}')).toBeNull()
  })
  it('previews without changing active look, saves, and restores across sessions', async () => {
    const store = new Map(), host = hostOf(store), state = newState({ look: 'bbs' }), act = themeActions(state, host, vi.fn())
    act.name('Violet'); act.color('head', '#ca9bff'); act.motion('speed', 0.5)
    expect(state.options.look).toBe('bbs')
    expect(activeTheme(state).palette.head).toBe('#f06449')
    act.save(); await flush()
    expect(state.options.look).toBe('orbital')
    expect(activeTheme(state).palette.head).toBe('#ca9bff')
    const restored = newState({ look: 'plain' }); await loadThemes(restored, host)
    expect(activeTheme(restored).name).toBe('Violet')
    expect(themesOf(restored).saved).toHaveLength(1)
    themeActions(restored, host, vi.fn()).reset(); await flush()
    expect(restored.options.look).toBe('plain')
  })
  it('keeps the prior theme on storage failure and rejects invalid/low contrast edits', async () => {
    const state = newState({ look: 'bbs' }), host = hostOf()
    host.storeSet = vi.fn(async () => { throw Error('denied') })
    const act = themeActions(state, host, vi.fn())
    act.select('orbital'); await flush(); expect(state.options.look).toBe('bbs')
    expect(themesOf(state).message).toContain('Could not save')
    act.color('head', 'bad'); expect(themesOf(state).draft.palette.head).toBe('#f06449')
    act.motion('speed', NaN); expect(themesOf(state).draft.motion.speed).toBe(1)
    act.color('info', '#000000'); act.save()
    expect(themesOf(state).message).toContain('contrast')
    expect(lowContrast(ORBITAL_THEME)).toEqual([])
  })
  it('rejects overlapping saves and does not let a late load replace user selection', async () => {
    const state = newState({}), host = hostOf(); let resolve!: (v: unknown) => void
    host.storeGet = () => new Promise(r => { resolve = r })
    const loading = loadThemes(state, host), act = themeActions(state, host, vi.fn())
    act.select('plain'); act.select('orbital'); await flush()
    resolve({ selected: 'orbital', saved: [] }); await loading
    expect(state.options.look).toBe('plain')
    expect(host.storeSet).toHaveBeenCalledTimes(1)
  })
  it('sends the bundled skill and contract to the chosen AI route only on request', async () => {
    const state = newState({}), host = hostOf(), ask = vi.fn(), act = themeActions(state, host, ask)
    act.brief('Amber stars'); expect(ask).not.toHaveBeenCalled()
    act.generate('codex'); await flush()
    expect(ask).toHaveBeenCalledWith('codex', expect.stringContaining('Amber stars'))
    expect(ask.mock.calls[0]![1]).toContain('six hex colors')
    expect(host.storeSet).not.toHaveBeenCalled()
    host.fs.read = async () => { throw Error('missing') }
    act.generate('claude'); await flush()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(themesOf(state).message).toContain('could not be read')
  })
  it('applies palette and decorative layers without losing failure checks', () => {
    const theme = copy(); theme.palette.head = '#ca9bff'; theme.palette.bad = '#ffaaaa'
    const header = orbitalHeader('swarm', 72, 1200, 16, theme)
    expect(header.cells[1]).toBe(0xca9bff)
    theme.motion.topology = false
    expect(orbitalHeader('swarm', 72, 1200, 16, theme).rows).toBe(4)
    const withStars = orbitalGlobe(72, 16, 1000, theme).encode()
    theme.motion.stars = false
    expect(orbitalGlobe(72, 16, 1000, theme).encode()).not.toBe(withStars)
    theme.motion.globe = false
    const checks = [{ area: 'module', ok: false, problems: ['missing'] }]
    const grid = orbitalBoot('demo', 72, 1500, checks, 30, theme)
    const text = Array.from({ length: grid.columns * grid.rows }, (_, i) => String.fromCodePoint(grid.cells[i * 3]!)).join('')
    expect(text).toContain('[FAIL] MODULE / missing')
    expect(grid.cells[(23 * 72) * 3 + 1]).toBe(0xffaaaa)
  })
  it('bounds previews across sizes and holds still at fps zero', () => {
    const state = newState({ look: 'orbital', fps: 0, boot: false }); state.view = 'themes'
    for (const width of [12, 20, 44, 72, 160, 240]) for (const rows of [10, 24, 60]) {
      state.pane.rows = rows
      const a = picturesOf(state, width, 1000, 1000), b = picturesOf(state, width, 9000, 9000)
      for (const key of ['theme-preview', 'theme-globe']) {
        expect(a.get(key)!.columns).toBeLessThanOrEqual(width)
        expect(a.get(key)!.encode()).toBe(b.get(key)!.encode())
      }
    }
    expect(COLOR_KEYS).toHaveLength(6)
  })
})
