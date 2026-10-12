/** Theme Studio stores data only. Generated presets never load executable code. */
import type { Host } from './host'
import type { State } from './state'

export const COLOR_KEYS = ['head', 'ok', 'bad', 'warn', 'info', 'background'] as const
export type ColorKey = typeof COLOR_KEYS[number]
export type ConsoleTheme = {
  version: 1
  name: string
  palette: Record<ColorKey, string>
  motion: { speed: number; stars: boolean; globe: boolean; topology: boolean }
}
export const ORBITAL_THEME: ConsoleTheme = {
  version: 1, name: 'Orbital',
  palette: { head: '#f06449', ok: '#72c79b', bad: '#ff6868', warn: '#e3ba74', info: '#c6cbc8', background: '#000000' },
  motion: { speed: 1, stars: true, globe: true, topology: true },
}
const clone = (theme: ConsoleTheme): ConsoleTheme => ({ ...theme, palette: { ...theme.palette }, motion: { ...theme.motion } })
/** Bundled palettes have stable IDs and do not consume the twelve custom preset slots. */
export const THEME_PRESETS: readonly { id: string; theme: ConsoleTheme }[] = [
  { id: 'arctic', theme: { ...clone(ORBITAL_THEME), name: 'Arctic', palette: { head: '#79dfff', ok: '#8ee6be', bad: '#ff929d', warn: '#ffd486', info: '#d6e9f2', background: '#08131f' } } },
  { id: 'synthwave', theme: { ...clone(ORBITAL_THEME), name: 'Synthwave', palette: { head: '#ed99ff', ok: '#6fe7c5', bad: '#ff899e', warn: '#ffe08a', info: '#e4d9f5', background: '#170d26' } } },
  { id: 'amber-crt', theme: { ...clone(ORBITAL_THEME), name: 'Amber CRT', palette: { head: '#ffcf73', ok: '#c6e58b', bad: '#ff9580', warn: '#ffe3a3', info: '#ead8b7', background: '#171108' } } },
  { id: 'emerald', theme: { ...clone(ORBITAL_THEME), name: 'Emerald', palette: { head: '#69e6af', ok: '#a1edb4', bad: '#ff9191', warn: '#efcf87', info: '#cde5da', background: '#081710' } } },
  { id: 'solar-flare', theme: { ...clone(ORBITAL_THEME), name: 'Solar Flare', palette: { head: '#ffab79', ok: '#b8dc91', bad: '#ff929d', warn: '#ffdf83', info: '#f1ddce', background: '#21100c' } } },
  { id: 'moonlight', theme: { ...clone(ORBITAL_THEME), name: 'Moonlight', palette: { head: '#b6c5ff', ok: '#a2d9c8', bad: '#ffa0b6', warn: '#e8d5a3', info: '#e0e4f2', background: '#101420' } } },
]
const presetOf = (id: string | null) => THEME_PRESETS.find(preset => `preset:${preset.id}` === id)?.theme
export const THEME_STORE_KEY = 'console-themes-v1'
const HEX = /^#[0-9a-f]{6}$/i
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

/** Strict, bounded schema; drop no unknown fields silently. */
export function parseTheme(value: unknown): ConsoleTheme | null {
  const root = record(value), palette = record(root?.palette), motion = record(root?.motion)
  if (!root || !palette || !motion || !exact(root, ['version', 'name', 'palette', 'motion']) || !exact(palette, COLOR_KEYS) || !exact(motion, ['speed', 'stars', 'globe', 'topology'])) return null
  if (root.version !== 1 || typeof root.name !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(root.name)) return null
  if (!COLOR_KEYS.every(key => typeof palette[key] === 'string' && HEX.test(palette[key] as string))) return null
  if (typeof motion.speed !== 'number' || !Number.isFinite(motion.speed) || motion.speed < 0.25 || motion.speed > 2 || !['stars', 'globe', 'topology'].every(key => typeof motion[key] === 'boolean')) return null
  return { version: 1, name: root.name, palette: Object.fromEntries(COLOR_KEYS.map(key => [key, (palette[key] as string).toLowerCase()])) as ConsoleTheme['palette'], motion: { speed: motion.speed, stars: motion.stars as boolean, globe: motion.globe as boolean, topology: motion.topology as boolean } }
}
export function themeFromText(text: string): ConsoleTheme | null {
  if (text.length > 4096) return null
  try { return parseTheme(JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'))) } catch { return null }
}
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722
  }
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export const lowContrast = (theme: ConsoleTheme): ColorKey[] => COLOR_KEYS.filter(key => key !== 'background' && contrast(theme.palette[key], theme.palette.background) < 3)
export const themeLayout = (columns: number) => {
  const width = Math.max(1, Math.min(200, Math.floor(columns) || 1))
  return { width, wide: width >= 100, controls: width >= 100 ? 38 : width, preview: width >= 100 ? width - 40 : width }
}
export type StudioTab = 'colors' | 'motion' | 'generate'
export type ThemeStudio = { tab: StudioTab; role: ColorKey; saved: ConsoleTheme[]; active: ConsoleTheme | null; draft: ConsoleTheme; selected: string | null; brief: string; message: string; loaded: boolean; revision: number; saving: boolean; initialLook: State['options']['look'] }
const studios = new WeakMap<State, ThemeStudio>()
export function themesOf(state: State): ThemeStudio {
  let studio = studios.get(state)
  if (!studio) {
    studio = { tab: 'colors', role: 'head', saved: [], active: null, draft: clone(ORBITAL_THEME), selected: null, brief: 'A calm cyberpunk theme with readable colors and slow orbital motion', message: '', loaded: false, revision: 0, saving: false, initialLook: state.options.look }
    studios.set(state, studio)
  }
  return studio
}
export const activeTheme = (state: State): ConsoleTheme => themesOf(state).active ?? ORBITAL_THEME
export async function loadThemes(state: State, host: Host): Promise<void> {
  const studio = themesOf(state)
  if (studio.loaded) return
  studio.loaded = true
  const revision = studio.revision
  try {
    const data = record(await host.storeGet(THEME_STORE_KEY))
    if (!data || studio.revision !== revision) return
    studio.saved = Array.isArray(data.saved) ? data.saved.slice(0, 12).map(parseTheme).filter((t): t is ConsoleTheme => t !== null) : []
    const selected = typeof data.selected === 'string' ? data.selected : null
    const theme = presetOf(selected) ?? studio.saved.find(t => `custom:${t.name}` === selected)
    if (theme) { studio.active = clone(theme); studio.draft = clone(theme); studio.selected = selected; state.options.look = 'orbital' }
    else if (selected === 'bbs' || selected === 'plain' || selected === 'orbital') { studio.selected = selected; state.options.look = selected }
    host.invalidate()
  } catch { studio.message = 'Saved themes could not be read; using the configured look.'; host.invalidate() }
}
export type ThemeActions = {
  tab: (tab: StudioTab) => void
  role: (role: ColorKey) => void
  discard: () => void
  select: (id: string) => void
  color: (key: ColorKey, value: string) => void
  name: (value: string) => void
  motion: (key: keyof ConsoleTheme['motion'], value: number | boolean) => void
  import: (text: string) => void
  save: () => void
  reset: () => void
  brief: (value: string) => void
  generate: (agent: 'claude' | 'codex') => void
}
export function themeActions(state: State, host: Host, ask: (agent: 'claude' | 'codex', prompt: string) => void): ThemeActions {
  const studio = themesOf(state)
  const tell = (message: string) => { studio.message = message; host.invalidate() }
  // Serialize writes and commit in-memory selection only after persistence succeeds.
  const persist = async (selected: string | null, saved: ConsoleTheme[], active: ConsoleTheme | null, look: State['options']['look']) => {
    if (studio.saving) return tell('A theme is being saved. Try again when it finishes.')
    studio.saving = true; studio.revision++; host.invalidate()
    try {
      await host.storeSet(THEME_STORE_KEY, { selected, saved })
      studio.selected = selected; studio.saved = saved; studio.active = active; state.options.look = look
      studio.draft = clone(active ?? ORBITAL_THEME)
      tell('Theme saved and applied.')
    } catch { tell('Could not save the theme. The active theme is unchanged.') }
    finally { studio.saving = false; host.invalidate() }
  }
  return {
    tab: tab => { if (['colors', 'motion', 'generate'].includes(tab)) { studio.tab = tab; host.invalidate() } },
    role: role => { if (COLOR_KEYS.includes(role)) { studio.role = role; host.invalidate() } },
    discard: () => { studio.draft = clone(studio.active ?? ORBITAL_THEME); tell('Draft restored to the active palette.') },
    select: id => {
      if (id === 'bbs' || id === 'plain' || id === 'orbital') { void persist(id, studio.saved, null, id); return }
      const theme = presetOf(id) ?? studio.saved.find(t => `custom:${t.name}` === id)
      if (theme) void persist(id, studio.saved, clone(theme), 'orbital')
    },
    color: (key, value) => {
      if (!COLOR_KEYS.includes(key) || !HEX.test(value.trim())) return tell('Enter a six digit hex color, for example #72c79b.')
      studio.draft.palette[key] = value.trim().toLowerCase(); tell('Preview updated. Save to apply.')
    },
    name: value => {
      const candidate = parseTheme({ ...studio.draft, name: value.trim() })
      if (!candidate) return tell('Use 1 to 40 letters, numbers, spaces, dots or underscores for the name.')
      studio.draft = candidate; tell('Preview renamed.')
    },
    motion: (key, value) => {
      const candidate = parseTheme({ ...studio.draft, motion: { ...studio.draft.motion, [key]: value } })
      if (!candidate) return tell('Invalid motion setting.')
      studio.draft = candidate; tell('Preview updated. Save to apply.')
    },
    import: text => {
      const candidate = themeFromText(text)
      if (!candidate) return tell('Invalid theme JSON. Expected version 1, name, six hex colors and motion settings; maximum 4096 characters.')
      studio.draft = candidate; tell('Theme imported into preview. Save to apply.')
    },
    save: () => {
      const theme = parseTheme(studio.draft)
      if (!theme) return tell('Invalid theme.')
      const unreadable = lowContrast(theme)
      if (unreadable.length) return tell(`Increase contrast for: ${unreadable.join(', ')}. Each needs at least 3:1 against the background.`)
      const saved = studio.saved.filter(t => t.name !== theme.name)
      if (saved.length >= 12) return tell('Twelve custom themes are saved. Reuse an existing name to replace it.')
      void persist(`custom:${theme.name}`, [...saved, clone(theme)], clone(theme), 'orbital')
    },
    reset: () => { void persist(null, studio.saved, null, studio.initialLook) },
    brief: value => { studio.brief = value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 1200); tell('Design brief ready.') },
    generate: agent => {
      void Promise.all([host.fs.read(`${host.pluginRoot}/skills/generate-console-theme/SKILL.md`), host.fs.read(`${host.pluginRoot}/skills/generate-console-theme/references/preset.md`)]).then(parts => {
        const skill = parts.join('\n\n')
        if (skill.length > 16000) return tell('Theme generator skill is too large.')
        ask(agent, `${skill}\n\nDesign brief (user input):\n${studio.brief}\n\nReturn one JSON object for Theme Studio import. Do not write files or run commands. Current draft:\n${JSON.stringify(studio.draft)}`)
      }, () => tell('The bundled generate-console-theme skill could not be read. Reinstall or update the plugin.'))
    },
  }
}
