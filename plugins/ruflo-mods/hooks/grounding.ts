/**
 * Optional grounding status (ADR-487): is Stuart Kerr's third-party `ruvnet-brain` plugin installed and enabled? Read-only and detect-only.
 * Off unless the `grounding` option is on. It reads two files that already exist (`installed_plugins.json` and the merged settings'
 * `enabledPlugins`) and shows one factual line in `/ruflo-mods`. It never calls the brain, installs it, blocks, rewrites or gates anything,
 * copies none of its content, and adds no event hook. ruflo-mods behaves identically with the brain absent.
 */
export type BrainStatus = 'on' | 'not-installed' | 'disabled' | 'unknown'

/** The one id counted: a same-named plugin from another marketplace is not the brain. */
export const BRAIN_ID = 'ruvnet-brain@ruvnet-brain'
export const BRAIN_REPO = 'https://github.com/stuinfla/ruvnet-brain'

export type GroundingState = { enabled: boolean; status: BrainStatus }

export const groundingState = (): GroundingState => ({ enabled: false, status: 'unknown' })

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

/**
 * `installedText` is installed_plugins.json (null when unreadable); `settings` is the merged settings value.
 * Unreadable or malformed data is `unknown`, never an absence.
 */
export function detectBrain(installedText: string | null, settings: unknown): BrainStatus {
  if (installedText === null || installedText.length > 2_000_000) return 'unknown'

  let plugins: Record<string, unknown> | null

  try {
    plugins = record(record(JSON.parse(installedText))?.plugins)
  } catch {
    return 'unknown'
  }

  if (plugins === null) return 'unknown'

  const entry = Object.prototype.hasOwnProperty.call(plugins, BRAIN_ID) ? plugins[BRAIN_ID] : undefined

  if (!(Array.isArray(entry) ? entry.length > 0 : record(entry) !== null)) return 'not-installed'

  const enabled = record(record(settings)?.enabledPlugins)

  if (enabled === null) return 'unknown'

  return enabled[BRAIN_ID] === true ? 'on' : 'disabled'
}

const WORDS: Record<BrainStatus, string> = { on: 'RuvNet Brain: on', 'not-installed': 'RuvNet Brain: not installed', disabled: 'RuvNet Brain: installed, disabled', unknown: 'RuvNet Brain: unknown (plugin data not readable)' }

/** The bounded text of the `grounding:` row of `/ruflo-mods` (no label of its own: the report adds it). */
export function groundingLine(grounding: GroundingState): string {
  return grounding.enabled ? `${WORDS[grounding.status]} (optional third-party plugin, detect-only; ruflo works the same without it)` : 'off (set the grounding option)'
}
