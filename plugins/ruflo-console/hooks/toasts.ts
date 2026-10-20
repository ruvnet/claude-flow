/**
 * Toasts (ADR-477), the console's side: the person's setting (all, important, off, and which sources are muted), kept in the plugin's
 * store and mirrored to `.claude-flow/console/toast-prefs.json` where ruflo-swarm, ruflo-protector and ruflo-mods read it; and the digests
 * those plugins leave under `.claude-flow/console/toasts/` (one ring file each), which become Events-page events. Only masked, capped
 * digests are read; nothing leaves the machine. Every read and write may fail and none throws.
 */
import { replaceFile } from './activity-io'
import { maskLine } from './data/event-mask'
import type { ConsoleEvent } from './data/events'
import type { Host } from './host'
import type { State } from './state'
import { decodeRing, DEFAULT_PREFS, encodePrefs, parsePrefs, PREFIX, PREFS_FILE, TOAST_DIR, TOAST_MODES, TOAST_SOURCES, type Digest, type ToastMode, type ToastPrefs } from './toast-policy'

export const TOASTS_KEY = 'toasts'
/** The sources a person can mute, in the order Settings lists them. */
export const MUTABLE_SOURCES: readonly string[] = TOAST_SOURCES
export const MAX_LOG = 200
/** The most files read per pass and the largest kept (a ring file is about 8 kB). */
const MAX_FILES = 12
const MAX_SEEN = 600

/** The setting from what the plugin's store held: anything else is the default. */
export function prefsFromStore(value: unknown): ToastPrefs {
  return typeof value === 'string' ? parsePrefs(value) : DEFAULT_PREFS
}

const stored = (prefs: ToastPrefs): string => encodePrefs(prefs)

/** The words a person reads: `all`, `important` or `off`, then what is muted. */
export const summaryOf = (prefs: ToastPrefs): string => `${prefs.mode}${prefs.muted.length === 0 ? '' : ` · muted: ${prefs.muted.join(', ')}`}`

/** Keeps the console's own digests for the Events pass, bounded. */
export function recordToast(state: State, digest: Digest): void {
  state.toastLog.push(digest)
  if (state.toastLog.length > MAX_LOG) state.toastLog.splice(0, state.toastLog.length - MAX_LOG)
}

/** Writes the setting to the plugin's store and to the mirror file (the problem, or null). Never throws. */
export async function saveToastPrefs(state: State, host: Host): Promise<string | null> {
  try {
    await host.storeSet(TOASTS_KEY, stored(state.toastPrefs)).catch(() => undefined)

    return await replaceFile(host, state.cwd, `${state.cwd.replace(/\/+$/, '')}/${PREFS_FILE}`, encodePrefs(state.toastPrefs))
  } catch {
    return 'the setting could not be written'
  }
}

/** Sets which levels draw (saved). */
export function setToastMode(state: State, host: Host, mode: ToastMode): void {
  if (!TOAST_MODES.includes(mode)) return

  state.toastPrefs = { ...state.toastPrefs, mode }
  host.invalidate()
  void saveToastPrefs(state, host)
}

/** Mutes a source, or unmutes it (saved). A name that is not a known source is ignored. */
export function toggleToastMute(state: State, host: Host, source: string): void {
  if (!MUTABLE_SOURCES.includes(source)) return

  const muted = state.toastPrefs.muted.includes(source) ? state.toastPrefs.muted.filter(name => name !== source) : [...state.toastPrefs.muted, source]

  state.toastPrefs = { ...state.toastPrefs, muted }
  host.invalidate()
  void saveToastPrefs(state, host)
}

/** A digest as an Events-page event: where it came from, its level glyph, its masked words, and what became of it when it did not draw. */
export function eventOf(d: Digest): ConsoleEvent {
  const flag = d.why === 'shown' ? '' : ` [${d.why}]`
  const times = d.n !== undefined && d.n > 1 ? ` ×${d.n}` : ''

  return { atMs: d.t, kind: 'notices', text: maskLine(`toast ${d.source} ${PREFIX[d.level]} ${d.text}${flag}${times}`, 200), src: 'toast' }
}

/** What has been taken in, so a ring file read again yields only what is new. */
export type ToastSeen = { keys: Set<string>; mtimes: Map<string, number>; sinceMs: number }

export const newSeen = (sinceMs: number): ToastSeen => ({ keys: new Set(), mtimes: new Map(), sinceMs })

const keyOf = (d: Digest): string => `${d.source}|${d.t}|${d.why}|${d.n ?? 1}|${d.text}`

/**
 * The digests the other plugins wrote since the console started, new ones only. A file is read when its modification time moved; one
 * from another plugin is never trusted (it is decoded and washed again), and the console's own source is skipped (it has no file).
 */
export async function pullToasts(host: Pick<Host, 'fs'>, cwd: string, seen: ToastSeen): Promise<Digest[]> {
  const dir = `${cwd.replace(/\/+$/, '')}/${TOAST_DIR}`
  const names = await host.fs.list(dir).then(
    entries => entries.filter(entry => /^[a-z][a-z0-9-]{0,23}\.jsonl$/.test(entry.name)).slice(0, MAX_FILES),
    () => [],
  )
  const out: Digest[] = []

  for (const entry of names) {
    const source = entry.name.slice(0, -'.jsonl'.length)

    if (source === 'console' || (entry.mtimeMs !== undefined && seen.mtimes.get(source) === entry.mtimeMs)) continue

    const text = await host.fs.read(`${dir}/${entry.name}`).catch(() => null)

    if (text === null) continue
    if (entry.mtimeMs !== undefined) seen.mtimes.set(source, entry.mtimeMs)

    for (const d of decodeRing(text)) {
      const key = keyOf(d)

      if (d.source !== source || d.t < seen.sinceMs || seen.keys.has(key)) continue

      seen.keys.add(key)
      out.push(d)
    }
  }

  if (seen.keys.size > MAX_SEEN) seen.keys = new Set([...seen.keys].slice(-Math.floor(MAX_SEEN / 2)))

  return out.sort((a, b) => a.t - b.t)
}
