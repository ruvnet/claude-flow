/**
 * Optional grounding aid (ADR-487): detect Stuart Kerr's third-party `ruvnet-brain` plugin and say so, factually. Detect-only and read-only.
 *
 * Nothing here installs, calls, blocks, writes or gates anything on the brain's behalf, copies any of its content, or reads its output.
 * ruflo behaves identically with the brain absent: every function takes the plugin facts the snapshot already holds and answers a status
 * word, a boolean or a constant line. The only text this module can hand the model is NUDGE_LINE, a constant with no input interpolated.
 * The matcher reads untrusted text (a mission objective, a task title) but only ever returns a boolean, in one linear pass.
 */
import type { Host } from './host'
import type { PluginsFacts } from './data/snapshot'
import { settingsOf } from './settings'
import type { State } from './state'

/** The one id counted: the brain's own marketplace and plugin name. A same-named plugin from another marketplace is not the brain. */
export const BRAIN_ID = 'ruvnet-brain@ruvnet-brain'
export const BRAIN_REPO = 'https://github.com/stuinfla/ruvnet-brain'

export type BrainStatus = 'on' | 'not-installed' | 'disabled' | 'unknown'

/**
 * on: installed and enabled. disabled: installed and not enabled. not installed: the plugin list was read and does not hold it.
 * unknown: the plugin list or the settings could not be read (a missing fact is never reported as an absence).
 */
export function brainStatus(plugins: Pick<PluginsFacts, 'installed' | 'enabled' | 'enabledKnown'> | null | undefined): BrainStatus {
  if (plugins === null || plugins === undefined || plugins.installed === null || !Array.isArray(plugins.installed)) return 'unknown'
  if (!plugins.installed.some(plugin => plugin?.id === BRAIN_ID)) return 'not-installed'
  if (plugins.enabledKnown === false || !(plugins.enabled instanceof Set)) return 'unknown'

  return plugins.enabled.has(BRAIN_ID) ? 'on' : 'disabled'
}

export const brainStatusOf = (state: State): BrainStatus => brainStatus(state.snapshot?.plugins)

const WORDS: Record<BrainStatus, string> = { on: 'RuvNet Brain: on', 'not-installed': 'RuvNet Brain: not installed', disabled: 'RuvNet Brain: installed, disabled', unknown: 'RuvNet Brain: unknown (plugin data not readable)' }

/** The Overview line: the status only, no claim about what the brain does for an answer. */
export const statusLine = (status: BrainStatus): string => `${WORDS[status]} (optional third-party plugin; ruflo works the same without it)`

/** The only text this feature hands the model. A constant: nothing is interpolated into it. */
export const NUDGE_LINE = 'Ground ruvnet-stack decisions with search_ruvnet before writing code.'

/** Names of the ruvnet stack, lower case, matched as whole tokens. Curated and short; tests keep false positives out. */
const SINGLE = new Set(['ruvector', 'rvf', 'agentdb', 'ruflo', 'rulake', 'ruqu', 'rvdna', 'ruview', 'rvlite', 'agenticow', 'safla', 'qudag', 'synthlang', 'metaharness', 'ruvllm', 'ruvnet'])
/** Two-token names (`claude-flow`, `agentic flow`), matched on adjacent tokens. */
const PAIRS = new Set(['claude flow', 'agentic flow', 'ruv fann'])
/** Text longer than this is not scanned past: the matcher is O(n) in the capped length. */
export const SCAN_MAX = 8000

/** Whether the text names the ruvnet stack. One linear pass over at most SCAN_MAX characters; returns a boolean, never any of the text. */
export function mentionsStack(text: unknown): boolean {
  if (typeof text !== 'string' || text === '') return false

  const lower = text.slice(0, SCAN_MAX).toLowerCase()
  let previous = ''
  let previousEnd = -2

  for (let i = 0, start = -1; i <= lower.length; i += 1) {
    const code = i < lower.length ? lower.charCodeAt(i) : 32
    const isWord = (code >= 97 && code <= 122) || (code >= 48 && code <= 57)

    if (isWord) {
      if (start < 0) start = i
    } else if (start >= 0) {
      const token = lower.slice(start, i)

      if (SINGLE.has(token) || (start - previousEnd === 1 && PAIRS.has(`${previous} ${token}`))) return true

      previous = token
      previousEnd = i
      start = -1
    }
  }

  return false
}

/** The line to add to the hand-off, or null: the brain is on, the nudge setting is on, and the text names the stack. `sanitise` is the console's modelLine. */
export function nudgeFor(state: State, parts: readonly string[], sanitise: (raw: unknown, max: number) => string): string | null {
  if (settingsOf(state).ai.groundingNudge !== true || brainStatusOf(state) !== 'on') return null
  if (!parts.some(part => mentionsStack(part))) return null

  return sanitise(NUDGE_LINE, 200) || null
}

export const HINT_TEXT = `Optional: the RuvNet Brain plugin can ground ruvnet-stack answers (${BRAIN_REPO}). Not installed; nothing will install it for you. Turn this hint off in Settings.`

const shown = new WeakSet<object>()

/** Whether the one-time hint should be said now: the person turned it on, the plugin list was read and lacks the brain, it was not dismissed, and not yet this session. */
export function hintDue(state: State): boolean {
  return settingsOf(state).ai.groundingHint === true && settingsOf(state).ai.groundingDismissed !== true && brainStatusOf(state) === 'not-installed' && !shown.has(state)
}

/** Marks the hint as said for this session. */
export const markHintShown = (state: State): void => void shown.add(state)

/** The optional install hint: a toast said at most once per session, only when the person turned it on; never throws. */
export function sayGroundingHint(state: State, host: Pick<Host, 'toast'>): void {
  try {
    if (!hintDue(state)) return

    markHintShown(state)
    host.toast(HINT_TEXT.slice(0, 220), 10_000, 'info')
  } catch {
    // A hint that could not be shown is not an error.
  }
}
