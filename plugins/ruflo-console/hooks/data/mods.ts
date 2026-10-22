import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { jsonObject, plain, recordOf } from './parse'
import { timeOf } from './safe'

/** The most mod folders read, and the most bytes of one status file (a larger one is refused, not trimmed). */
export const MODS_MAX_FILES = 60
export const MODS_MAX_BYTES = 8192
/** A status file older than this was written by a session that has ended. */
export const MODS_STALE_MS = 6 * 3_600_000

const ROOT = '.claude-flow'
const DIR = /^[a-z0-9][a-z0-9-]{0,40}-mod$/

/** Why a mod last refused something, as a fixed class: the raw reason text (which may name a path or a secret) is never kept. */
export const DENY_CLASSES = ['secret', 'destructive', 'path', 'network', 'policy', 'other'] as const
export type DenyClass = (typeof DENY_CLASSES)[number]

/**
 * One mod's status file (ADR-446): the counters every mod writes (calls also from `seen`/`checked`/a `calls` object; lastDenied also from `lastReason`/`lastBlocked`); per-plugin counters are not read here. The last four are optional and only
 * present when the file reported them (modVersion, a one-line summary of what it guards, the class of its last refusal, the file's age source).
 */
export type ModRow = { name: string; guard: boolean | null; calls: number | null; blocked: number; updatedMs: number | null; startedMs: number | null; modVersion?: string; summary?: string; lastDenied?: DenyClass; fileMs?: number }

/** What the folder scan found: the rows kept, how many folders were refused (unknown shape, too large, unreadable), and whether the cap cut the list. */
export type ModsFacts = { rows: ModRow[]; refused: number; truncated: boolean }

export const NO_MODS: ModsFacts = { rows: [], refused: 0, truncated: false }

const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : null)

/** Most keys of a `calls` object that are summed, and the ceiling of any summed or widened count (a hostile 1e300 must not become a display value). */
const CALLS_KEYS_MAX = 64
const COUNT_CEILING = Number.MAX_SAFE_INTEGER

/**
 * How many times a mod ran, from whichever of its three shapes the file uses: a number `calls`; a `calls` object (summed over its numeric values,
 * at most 64 of them); else `seen`, else `checked`. Anything else (array, nested object, NaN, negative, a string) is not a count: null.
 */
export function callsOf(value: Record<string, unknown>): number | null {
  const direct = whole(value.calls)

  if (direct !== null) return Math.min(direct, COUNT_CEILING)

  const table = recordOf(value.calls)

  if (table !== null) {
    let sum = 0

    for (const entry of Object.values(table).slice(0, CALLS_KEYS_MAX)) sum = Math.min(sum + (whole(entry) ?? 0), COUNT_CEILING)

    return sum
  }

  const seen = whole(value.seen) ?? whole(value.checked)

  return seen === null ? null : Math.min(seen, COUNT_CEILING)
}

const SUMMARY_MAX = 120
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,15}$/
const CLASS_TESTS: readonly [DenyClass, RegExp][] = [
  ['secret', /secret|token|credential|password|api[-_ ]?key|\.env|private[-_ ]?key/i],
  ['destructive', /destruct|rm -|delete|wipe|force|reset --hard|drop /i],
  ['path', /path|travers|outside|directory|file/i],
  ['network', /network|url|host|curl|http|exfil/i],
  ['policy', /polic|permission|deny|denied|block|guard|rule/i],
]

/** A mod's own version string when it is a short plain version, else null. */
export const modVersionOf = (v: unknown): string | null => (typeof v === 'string' && VERSION.test(v) ? v : null)

/** The class of a refusal reason (never the reason itself), or null when the file reported none. */
export function denyClassOf(v: unknown): DenyClass | null {
  const text = plain(v, 200)

  return text === '' ? null : (CLASS_TESTS.find(([, test]) => test.test(text))?.[0] ?? 'other')
}

/** Parses one status file; anything that is not version 1 of an object is null (the console never guesses at a shape it does not know). */
export function parseModStatus(name: string, text: string | null, fileMs: number | null = null): ModRow | null {
  const value = jsonObject(text)

  if (value === null || value.version !== 1) return null

  const denied = denyClassOf(value.lastDenied) ?? denyClassOf(value.lastReason) ?? denyClassOf(value.lastBlocked)

  return {
    name: name.slice(0, -4),
    guard: typeof value.guard === 'boolean' ? value.guard : null,
    calls: callsOf(value),
    blocked: whole(value.blocked) ?? 0,
    updatedMs: timeOf(value.updatedMs) ?? null,
    startedMs: timeOf(value.startedMs) ?? null,
    ...(modVersionOf(value.modVersion) !== null && { modVersion: modVersionOf(value.modVersion) as string }),
    ...(plain(value.summary, SUMMARY_MAX) !== '' && { summary: plain(value.summary, SUMMARY_MAX) }),
    ...(denied !== null && { lastDenied: denied }),
    ...(fileMs !== null && fileMs >= 0 && { fileMs }),
  }
}

/** Blocked first (most blocked leading), then the most recently written, then by name. */
export function orderMods(rows: readonly ModRow[]): ModRow[] {
  return [...rows].sort((a, b) => Number(b.blocked > 0) - Number(a.blocked > 0) || b.blocked - a.blocked || (b.updatedMs ?? -1) - (a.updatedMs ?? -1) || a.name.localeCompare(b.name))
}

export const isStale = (row: ModRow, nowMs: number): boolean => row.updatedMs === null || nowMs - row.updatedMs > MODS_STALE_MS

/** Lists `.claude-flow` for `*-mod` folders and reads each `status.json`, bounded by count and size; never rejects. */
export async function readMods(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<ModsFacts> {
  const entries = await fs.list(under(cwd, ROOT)).catch(() => null)

  if (entries === null) return NO_MODS

  const names = entries.filter(entry => entry.kind !== 'file' && DIR.test(entry.name)).map(entry => entry.name).sort()
  const kept = names.slice(0, MODS_MAX_FILES)
  const reads = await Promise.all(kept.map(async name => ({ name, read: await readBounded(fs, cache, under(cwd, `${ROOT}/${name}/status.json`), MODS_MAX_BYTES, true) })))
  const rows: ModRow[] = []
  let refused = 0

  for (const { name, read } of reads) {
    if (read.text === null && read.reason === 'missing') continue

    // a link, FIFO or folder named status.json (ADR-450 T2): counted as refused, never read

    const row = parseModStatus(name, read.text, 'mtimeMs' in read ? read.mtimeMs : null)

    if (row === null) refused += 1
    else rows.push(row)
  }

  return { rows: orderMods(rows), refused, truncated: names.length > kept.length }
}
