/**
 * A plugin's bundled CHANGELOG.md, parsed for the What's new page (ADR-478). Pure: no host, no network, no clock.
 *
 * The format is deliberately narrow, so a person and a machine read the same thing:
 *
 *     ## 0.38.0 — 2026-10-07
 *     - feat: What's new page
 *     - fix: a thing that was broken
 *     - breaking: something that changes what you do
 *     - chore: housekeeping
 *
 * Every line of the file is untrusted text (a plugin can ship anything). Parsing is bounded in bytes, lines, entries and bullets, uses
 * only anchored, linear patterns on a clipped line, and every kept line goes through `maskLine`: escape sequences, control and bidi
 * characters are dropped, credential-shaped text is masked, and the line is cut to a fixed width. Nothing here throws.
 */
import { maskLine } from './event-mask'

export type ChangeKind = 'fix' | 'feat' | 'breaking' | 'chore'
export const CHANGE_KINDS: readonly ChangeKind[] = ['breaking', 'feat', 'fix', 'chore']

export type Change = { kind: ChangeKind; text: string }
export type ChangeEntry = { version: string; date: string; changes: Change[]; /** Bullets past the per-entry cap, counted not kept. */ more: number }

/** The bounds. A file past `bytes` is cut there, never refused, and the cut is said (`truncated`). */
export const LIMITS = { bytes: 64 * 1024, lines: 2_000, entries: 40, changes: 12, line: 160, header: 64, bullet: 600 } as const

export type ParsedChangelog =
  | { ok: true; entries: ChangeEntry[]; /** Anything was dropped: the file is longer than the bounds, or entries repeat a version. */ truncated: boolean }
  | { ok: false; reason: 'empty' | 'garbled' }

/** `## 1.2.3 — 2026-10-07` (an em dash, an en dash or a hyphen): anchored, no nested quantifiers. */
const HEADER = /^## (\d{1,4})\.(\d{1,4})\.(\d{1,4}) [—–-] (\d{4})-(\d{2})-(\d{2})[ \t]*$/
/** `- fix: text` (a `*` bullet too). */
const BULLET = /^[-*] (fix|feat|breaking|chore):[ \t]*(.*)$/

export type Semver = readonly [number, number, number]

/** `major.minor.patch` and nothing else, as a tuple; null for anything else (a pre-release is never ordered). */
export function semverOf(text: string): Semver | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text)

  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal; a non-version sorts as older than any version. */
export function compareVersions(a: string, b: string): number {
  const x = semverOf(a)
  const y = semverOf(b)

  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1

  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)

  return 0
}

const dateOk = (month: number, day: number): boolean => month >= 1 && month <= 12 && day >= 1 && day <= 31

/** Parses `text`, newest version first. An unrecognised line is ignored, never an error; a file with no entry at all is `garbled` (or `empty`). */
export function parseChangelog(text: unknown): ParsedChangelog {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'empty' }

  const cut = text.length > LIMITS.bytes
  const lines = text.slice(0, LIMITS.bytes).split('\n', LIMITS.lines + 1)
  const entries: ChangeEntry[] = []
  const seen = new Set<string>()
  let truncated = cut || lines.length > LIMITS.lines
  let current: ChangeEntry | null = null

  for (const raw of lines.slice(0, LIMITS.lines)) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const head = line.startsWith('## ') ? HEADER.exec(line.slice(0, LIMITS.header)) : null

    if (head !== null) {
      const version = `${Number(head[1])}.${Number(head[2])}.${Number(head[3])}`

      if (seen.has(version) || !dateOk(Number(head[5]), Number(head[6]))) {
        // A repeated or impossible header starts nothing: its bullets belong to no entry.
        truncated = truncated || seen.has(version)
        current = null
        continue
      }

      if (entries.length >= LIMITS.entries) {
        truncated = true
        current = null
        break
      }

      seen.add(version)
      current = { version, date: `${head[4]}-${head[5]}-${head[6]}`, changes: [], more: 0 }
      entries.push(current)
      continue
    }

    if (current === null || line.length < 8) continue

    const bullet = BULLET.exec(line.slice(0, LIMITS.bullet))

    if (bullet === null) continue

    const words = maskLine(bullet[2], LIMITS.line)

    if (words === '') continue
    if (current.changes.length >= LIMITS.changes) current.more += 1
    else current.changes.push({ kind: bullet[1] as ChangeKind, text: words })
  }

  if (entries.length === 0) return { ok: false, reason: 'garbled' }

  // File order is the author's; the page's order is the version's (a hand-edited file may be out of order).
  entries.sort((a, b) => compareVersions(b.version, a.version))

  return { ok: true, entries, truncated }
}

/** The entries newer than `seenVersion` (every entry when it is absent or not a version). */
export const entriesAfter = (entries: readonly ChangeEntry[], seenVersion: string | undefined): ChangeEntry[] => (seenVersion === undefined ? [...entries] : entries.filter(entry => compareVersions(entry.version, seenVersion) > 0))

/** The words of a kind, as the page marks it. */
export const MARK: Readonly<Record<ChangeKind, string>> = { breaking: '‼ BREAKING', feat: '+ new', fix: '✓ fix', chore: '· chore' }
