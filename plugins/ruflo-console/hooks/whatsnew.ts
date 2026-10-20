/**
 * What's new (ADR-478), the logic: which installed ruflo plugins moved since the person last looked, the bundled CHANGELOG.md of each
 * (read only when the page opens, local files, no network), the breaking changes pinned until dismissed, and the one info toast per new
 * version. The page that draws it is views/whatsnew.ts. Every read and write may fail; none throws.
 *
 * What is remembered (one JSON string under the plugin-store key `whatsnew`): the version of each plugin the person last looked at
 * (`seen`), the versions already toasted, the breaking entries still pinned and the ones dismissed, and whether to toast. Nothing else.
 * With no record yet, the first sight of the installed versions is the baseline: nothing is new, nothing is toasted.
 */
import { compareVersions, entriesAfter, parseChangelog, semverOf, type ChangeEntry, type ParsedChangelog } from './data/changelog'
import { safeInstallPath } from './data/cost-ledger'
import { readBounded, type ReadCache } from './data/files'
import { RUFLO_MARKET } from './data/snapshot'
import type { Host } from './host'
import type { State } from './state'
import { tidy } from './toast-policy'
import { CONSOLE_VERSION } from './version'

export const WHATSNEW_KEY = 'whatsnew'
export const CONSOLE_NAME = 'ruflo-console'
/** Where a person reads the whole file when this page shows only headlines. */
export const NOTES_URL = (name: string): string => `https://github.com/ruvnet/ruflo/blob/main/plugins/${name}/CHANGELOG.md`
export const RELEASES_URL = 'https://github.com/ruvnet/ruflo/releases'

const MAX_PLUGINS = 60
const MAX_RECORD = 200
const FILE_MAX = 256 * 1024
const NAME = /^[A-Za-z0-9._-]{1,80}$/
/** Names that are Object.prototype's own keys: as a key of `seen`/`toasted` they hit the prototype, so such a plugin never cleared and toasted every session. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'toLocaleString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'])
/** A plugin name the record can key: the shape ruflo uses, and never an Object.prototype key. */
const isName = (name: string): boolean => NAME.test(name) && !RESERVED.has(name)
/** A pinned or dismissed entry, `<plugin>@<x.y.z>`, whose plugin name passes the same check. */
const isEntryKey = (key: string): boolean => /^[A-Za-z0-9._-]{1,80}@\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(key) && isName(key.slice(0, key.lastIndexOf('@')))

/**
 * A plugin-name → version map with no prototype, so no lookup ever finds an inherited key, holding only valid names. Every such map in the
 * record and the page (seen, toasted, before) is made here, and read with `versionIn`.
 */
export function versionMap(entries: Iterable<readonly [string, string]> = []): Record<string, string> {
  const out = Object.create(null) as Record<string, string>

  for (const [name, version] of entries) if (isName(name)) out[name] = version

  return out
}

/** The version a map holds for a plugin: its own entry only, never an inherited one. */
export const versionIn = (map: Readonly<Record<string, string>> | null, name: string): string | undefined => (map !== null && Object.hasOwn(map, name) ? map[name] : undefined)

export type WhatsRecord = { seen: Record<string, string>; toasted: Record<string, string>; pinned: string[]; dismissed: string[]; toast: boolean }
export type Row = { name: string; version: string; path: string | null }
export type Log = { name: string; version: string; path: string | null; result: ParsedChangelog | { ok: false; reason: 'missing' | 'too-large' | 'unreadable' } }

export type WhatsNewState = {
  /** The store has been read (until then nothing is new and nothing is toasted). */
  hydrated: boolean
  /** The record; null while the store has none (the first sight of the installed versions then becomes the baseline). */
  rec: WhatsRecord | null
  /** The page is the open view. */
  isOpen: boolean
  /** The versions seen before this opening: the divider's place. Kept while the page stays open. */
  before: Record<string, string> | null
  logs: Log[]
  /** A read of the files is under way, or none has finished since the page opened. */
  isLoading: boolean
  loadedAtMs: number
  cache: ReadCache
}

export const newWhatsNew = (): WhatsNewState => ({ hydrated: false, rec: null, isOpen: false, before: null, logs: [], isLoading: false, loadedAtMs: 0, cache: new Map() })

export const emptyRecord = (): WhatsRecord => ({ seen: versionMap(), toasted: versionMap(), pinned: [], dismissed: [], toast: true })

/** A record that takes the installed versions as already seen and toasted: the first sight, so nothing is new. */
export const baselineOf = (rows: readonly { name: string; version: string }[]): WhatsRecord => {
  const named = rows.filter(row => isName(row.name))

  return { ...emptyRecord(), seen: versionMap(named.map(row => [row.name, row.version])), toasted: versionMap(named.map(row => [row.name, row.version])) }
}

function versions(value: unknown): Record<string, string> {
  const out = versionMap()

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out

  for (const [name, version] of Object.entries(value).slice(0, MAX_RECORD)) if (isName(name) && typeof version === 'string' && semverOf(version) !== null) out[name] = version

  return out
}

const keys = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && isEntryKey(entry)).slice(-MAX_RECORD) : [])

/** The record from what the store held: anything unreadable is null (no record). */
export function parseRecord(value: unknown): WhatsRecord | null {
  if (typeof value !== 'string' || value.length > 64 * 1024) return null

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>

    if (typeof parsed !== 'object' || parsed === null) return null

    return { seen: versions(parsed.seen), toasted: versions(parsed.toasted), pinned: keys(parsed.pinned), dismissed: keys(parsed.dismissed), toast: parsed.toast !== false }
  } catch {
    return null
  }
}

export const encodeRecord = (rec: WhatsRecord): string => JSON.stringify({ v: 1, seen: rec.seen, toasted: rec.toasted, pinned: rec.pinned.slice(-MAX_RECORD), dismissed: rec.dismissed.slice(-MAX_RECORD), toast: rec.toast })

/** The ruflo plugins installed here, the console at the version in its own header or newer. Capped; names are validated. */
export function rowsOf(state: Pick<State, 'snapshot'>, pluginRoot: string | null = null): Row[] {
  const installed = state.snapshot?.plugins.installed ?? []
  const rows: Row[] = installed
    .filter(entry => entry.marketplace === RUFLO_MARKET && isName(entry.name) && semverOf(entry.version) !== null)
    .slice(0, MAX_PLUGINS)
    .map(entry => ({ name: entry.name, version: entry.version, path: safeInstallPath(entry.installPath) ?? null }))
  const own = rows.find(row => row.name === CONSOLE_NAME)

  // The console is always listed: it is running, even where no install record names it (a development checkout).
  if (own === undefined) rows.unshift({ name: CONSOLE_NAME, version: CONSOLE_VERSION, path: pluginRoot !== null ? (safeInstallPath(pluginRoot) ?? null) : null })
  else if (compareVersions(CONSOLE_VERSION, own.version) > 0) own.version = CONSOLE_VERSION

  return rows
}

/** The plugins whose installed version is newer than the one last looked at (a plugin never looked at counts once, at its version). */
export function unseenRows(rows: readonly Row[], rec: WhatsRecord | null): Row[] {
  if (rec === null) return []

  return rows.filter(row => isName(row.name) && (versionIn(rec.seen, row.name) === undefined || compareVersions(row.version, versionIn(rec.seen, row.name) as string) > 0))
}

/** Whether the page has anything the person has not looked at: the nav's and the menu's "new" marker. */
export const hasUnseen = (state: Pick<State, 'snapshot' | 'whatsnew'>): boolean => state.whatsnew.hydrated && unseenRows(rowsOf(state), state.whatsnew.rec).length > 0

/** The line a toast says: the first names, then a count. */
export function toastLine(rows: readonly Row[]): string {
  const named = rows.slice(0, 2).map(row => `${row.name} ${row.version}`)
  const rest = rows.length - named.length

  return tidy(`What's new: ${named.join(', ')}${rest > 0 ? ` and ${rest} more` : ''} (TOOLS → What's new)`, 118)
}

const persist = (state: State, host: Pick<Host, 'storeSet'>): void => {
  if (state.whatsnew.rec !== null) void host.storeSet(WHATSNEW_KEY, encodeRecord(state.whatsnew.rec)).catch(() => undefined)
}

/** Reads the record once per session. */
export async function hydrateWhatsNew(state: State, host: Pick<Host, 'storeGet' | 'invalidate'>): Promise<void> {
  if (state.whatsnew.hydrated) return

  state.whatsnew.rec = await host.storeGet(WHATSNEW_KEY).then(parseRecord, () => null)
  state.whatsnew.hydrated = true
  host.invalidate()
}

/**
 * Called from the controller after each disk read, and cheap when nothing moved. Takes the baseline on first sight; while the page is open
 * a version that lands is looked at at once; otherwise one info toast per version not yet toasted (never again for the same one).
 */
export function syncWhatsNew(state: State, host: Pick<Host, 'storeSet' | 'toast' | 'invalidate' | 'pluginRoot'>): void {
  const wn = state.whatsnew

  if (!wn.hydrated || state.snapshot === null) return

  const rows = rowsOf(state, host.pluginRoot)

  if (wn.rec === null) {
    wn.rec = baselineOf(rows)
    persist(state, host)

    return
  }

  const unseen = unseenRows(rows, wn.rec)

  if (unseen.length === 0) return

  if (wn.isOpen) {
    for (const row of unseen) wn.rec.seen[row.name] = row.version
    persist(state, host)
    host.invalidate()

    return
  }

  const fresh = unseen.filter(row => wn.rec !== null && (versionIn(wn.rec.toasted, row.name) === undefined || compareVersions(row.version, versionIn(wn.rec.toasted, row.name) as string) > 0))

  if (fresh.length === 0) return

  for (const row of fresh) wn.rec.toasted[row.name] = row.version
  persist(state, host)
  if (wn.rec.toast && state.isInteractive) host.toast(toastLine(fresh), 9_000, 'info')
  host.invalidate()
}

const breaking = (entry: ChangeEntry): boolean => entry.changes.some(change => change.kind === 'breaking')

/** Reads each plugin's bundled CHANGELOG.md (regular files only, size-bounded) and parses it. */
export async function readLogs(host: Pick<Host, 'fs'>, cache: ReadCache, rows: readonly Row[]): Promise<Log[]> {
  const one = async (row: Row): Promise<Log> => {
    if (row.path === null) return { ...row, result: { ok: false, reason: 'missing' } }

    const read = await readBounded(host.fs, cache, `${row.path.replace(/\/+$/, '')}/CHANGELOG.md`, FILE_MAX, true).catch(() => null)

    if (read === null) return { ...row, result: { ok: false, reason: 'unreadable' } }
    if (read.text === null) return { ...row, result: { ok: false, reason: read.reason === 'too-large' ? 'too-large' : read.reason === 'missing' ? 'missing' : 'unreadable' } }

    return { ...row, result: parseChangelog(read.text) }
  }
  const out: Log[] = []

  for (let i = 0; i < rows.length; i += 8) out.push(...(await Promise.all(rows.slice(i, i + 8).map(one))))

  return out
}

/**
 * The page opens: the divider stays where the last look left it, the files are read, any breaking change among the new entries is pinned
 * (and stays pinned across sessions until dismissed), and everything counts as looked at. Local reads only.
 */
export async function openWhatsNew(state: State, host: Pick<Host, 'fs' | 'storeGet' | 'storeSet' | 'invalidate' | 'pluginRoot'>): Promise<void> {
  const wn = state.whatsnew

  if (wn.isOpen) return

  wn.isOpen = true
  wn.isLoading = true
  host.invalidate()
  await hydrateWhatsNew(state, host)

  const rows = rowsOf(state, host.pluginRoot)

  if (wn.rec === null) wn.rec = baselineOf(rows)

  wn.before = versionMap(Object.entries(wn.rec.seen))

  const before = wn.before
  const rec = wn.rec
  const logs = await readLogs(host, wn.cache, rows)

  if (!wn.isOpen) return

  wn.logs = logs

  for (const log of logs) {
    if (!log.result.ok) continue

    for (const entry of entriesAfter(log.result.entries, versionIn(before, log.name))) {
      const key = `${log.name}@${entry.version}`

      if (breaking(entry) && !rec.pinned.includes(key) && !rec.dismissed.includes(key) && versionIn(before, log.name) !== undefined && isEntryKey(key)) rec.pinned.push(key)
    }
  }

  for (const row of rows) rec.seen[row.name] = row.version
  wn.isLoading = false
  wn.loadedAtMs = Date.now()
  persist(state, host as Pick<Host, 'storeSet'>)
  host.invalidate()
}

/** The page is left: the divider is forgotten. */
export function closeWhatsNew(state: State): void {
  state.whatsnew.isOpen = false
  state.whatsnew.before = null
}

/** The breaking changes still pinned: from the record, with the entry's words when its file has been read this session. */
export function pinnedOf(state: Pick<State, 'whatsnew'>): { key: string; name: string; version: string; texts: string[] }[] {
  const { rec, logs } = state.whatsnew

  if (rec === null) return []

  return rec.pinned
    .filter(key => !rec.dismissed.includes(key))
    .map(key => {
      const [name = '', version = ''] = key.split('@')
      const entry = logs.find(log => log.name === name && log.result.ok)?.result
      const found = entry !== undefined && entry.ok ? entry.entries.find(each => each.version === version) : undefined

      return { key, name, version, texts: found === undefined ? [] : found.changes.filter(change => change.kind === 'breaking').map(change => change.text) }
    })
    .slice(0, 20)
}

export type WhatsNewActions = { dismiss: (key: string) => void; dismissAll: () => void; toggleToast: () => void }

/** Dismissing is remembered: the entry is not pinned again. */
export function whatsnewActions(state: State, host: Pick<Host, 'storeSet' | 'invalidate' | 'pluginRoot'>): WhatsNewActions {
  const save = () => {
    persist(state, host)
    host.invalidate()
  }
  const dismiss = (key: string) => {
    const rec = state.whatsnew.rec

    if (rec === null || !isEntryKey(key)) return

    rec.pinned = rec.pinned.filter(each => each !== key)
    if (!rec.dismissed.includes(key)) rec.dismissed.push(key)
    save()
  }

  return {
    dismiss,
    dismissAll: () => {
      for (const pin of pinnedOf(state)) dismiss(pin.key)
    },
    toggleToast: () => {
      state.whatsnew.rec ??= baselineOf(rowsOf(state, host.pluginRoot))
      state.whatsnew.rec.toast = !state.whatsnew.rec.toast
      save()
    },
  }
}
