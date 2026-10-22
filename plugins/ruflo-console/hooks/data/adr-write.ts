/**
 * Writing ADRs in the project's own convention (ADR-480): detect the style from the ADRs already there (or take the person's setting),
 * allocate the next number, render a new record, change a record's status as the smallest edit that its format allows, and show the
 * change as a diff. Pure: nothing here touches a disk. The caller (hooks/adr.ts) writes only what a person confirmed, re-reads the file
 * first and refuses if it moved since the diff was shown.
 */
import { checkLimit, type Limit } from '../full-text'
import { plain } from './parse'
import { type AdrDoc, type AdrFormat, type AdrStatus } from './adr'

export type StyleName = 'madr' | 'nygard' | 'ruflo'
export const STYLES: readonly StyleName[] = ['madr', 'nygard', 'ruflo']
export type Style = {
  name: StyleName
  /** Digits in the number of a file name (`0005` is 4). */
  width: number
  /** The file name pattern: `{n}` is the number, `{slug}` the title, and the name ends in .md. */
  pattern: string
  source: 'setting' | 'detected' | 'default'
}

export const DEFAULT_STYLE: Style = { name: 'nygard', width: 4, pattern: '{n}-{slug}.md', source: 'default' }
const PATTERN = /^[A-Za-z0-9_.{}-]{3,80}$/

/** A pattern the person typed, or null: it must hold {n} and {slug}, end in .md and use only name characters. */
export function patternOf(text: string): string | null {
  const value = text.trim()

  return PATTERN.test(value) && value.includes('{n}') && value.includes('{slug}') && value.endsWith('.md') && !value.includes('..') ? value : null
}

const FORMAT_STYLE: Record<AdrFormat, StyleName> = { madr: 'madr', nygard: 'nygard', inline: 'ruflo', bare: 'nygard' }

const mode = <T>(values: readonly T[]): T | undefined => {
  const counts = new Map<T, number>()

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/**
 * The style to write in: the person's setting first (a style name, a pattern, either or both), else what the project's ADRs do (the
 * commonest format, the width of their numbers, an `ADR-` prefix), else the default (Nygard, four digits, `0001-slug.md`).
 */
export function detectStyle(docs: readonly AdrDoc[], setting: { style: StyleName | 'auto'; pattern: string } = { style: 'auto', pattern: '' }): Style {
  const numbered = docs.filter(doc => doc.number !== null)
  const sampled = numbered.slice(-40)
  const detectedName = mode(sampled.filter(doc => doc.format !== 'bare').map(doc => FORMAT_STYLE[doc.format])) ?? (sampled.length > 0 ? 'nygard' : undefined)
  const widths = sampled.map(doc => /^(?:adr[-_ ]?)?(\d+)/i.exec(doc.file)?.[1]?.length ?? 0).filter(width => width > 0)
  const width = mode(widths) ?? DEFAULT_STYLE.width
  const prefixed = sampled.length > 0 && sampled.filter(doc => /^adr[-_ ]/i.test(doc.file)).length * 2 > sampled.length
  const detectedPattern = `${prefixed ? 'ADR-' : ''}{n}-{slug}.md`
  const pattern = patternOf(setting.pattern)
  const name = setting.style !== 'auto' ? setting.style : (detectedName ?? DEFAULT_STYLE.name)
  const isSet = setting.style !== 'auto' || pattern !== null

  return {
    name,
    width: Math.max(1, Math.min(8, width)),
    pattern: pattern ?? (sampled.length > 0 ? detectedPattern : DEFAULT_STYLE.pattern),
    source: isSet ? 'setting' : sampled.length > 0 ? 'detected' : 'default',
  }
}

/** A folder name inside the project as the person typed it, or null: relative, no `..`, no backslash or control character, name characters only. '' is "find it". */
export function adrDirText(text: string): string | null {
  const value = text.trim().replace(/\/+$/, '').replace(/^\.\//, '')

  if (value === '') return ''

  return value.length <= 120 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && !value.split('/').some(part => part === '..' || part === '.') ? value : null
}

export const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'untitled'

/** The longest title a person may give a new record: its heading and its file name (ADR-481: longer is refused with the count, never cut). */
export const ADR_TITLE_MAX = 120
/** The longest title a draft takes from a mission's objective; the shortening is said on the confirm card and the objective is in the record. */
export const DRAFT_TITLE_MAX = 100

/** A title as one safe line, whole: no control characters, no leading markdown marks, no link syntax. Never shortened. */
export const titleClean = (value: string): string => plain(value, Number.MAX_SAFE_INTEGER).replace(/^[#>\-*\s]+/, '').replace(/[[\]()`|]/g, '').replace(/\s+/g, ' ').trim()

/** Whether a title a person typed fits, counted as it would be written; over the limit, the message with the count. */
export const titleFit = (title: string): Limit => checkLimit(titleClean(title), ADR_TITLE_MAX, 'the title', 'it is the record’s heading and file name; put the rest in the record itself')

/**
 * The title of a record ALREADY in the folder, as one safe line for a link written into another record (supersede). A backstop for text
 * this console did not take from a person; a title a person types goes through `titleFit` and is never cut.
 */
export const recordTitle = (value: string): string => Array.from(titleClean(value)).slice(0, ADR_TITLE_MAX).join('')

export const padNumber = (number: number, width: number): string => String(number).padStart(width, '0')

export const fileNameFor = (style: Style, number: number, title: string): string => style.pattern.replace('{n}', padNumber(number, style.width)).replace('{slug}', slugOf(title))

/** The next free number: one above the highest in the folder (duplicates and variants included), never below 1. */
export function nextNumber(docs: readonly AdrDoc[]): number {
  return docs.reduce((high, doc) => Math.max(high, doc.number ?? 0), 0) + 1
}

const WORD: Record<AdrStatus, string> = { proposed: 'Proposed', accepted: 'Accepted', superseded: 'Superseded', deprecated: 'Deprecated', rejected: 'Rejected', unknown: 'Unknown' }
export const statusWord = (status: AdrStatus): string => WORD[status]

const label = (style: Style, number: number): string => (style.pattern.startsWith('ADR-') ? `ADR-${padNumber(number, style.width)}` : `ADR ${padNumber(number, style.width)}`)

export type NewAdr = { number: number; title: string; date: string; status?: AdrStatus; scope?: string[]; context?: string; decision?: string; titleShortenedFrom?: number }

/** A new record in the style: the same headings the project's other records use. The decision is left for the person unless one is given. */
export function renderNew(style: Style, adr: NewAdr): string {
  const status = statusWord(adr.status ?? 'proposed')
  const title = titleClean(adr.title)
  const context = adr.context ?? 'What is the issue that is motivating this decision or change?'
  const decision = adr.decision ?? 'What is the change that we are proposing or have agreed to implement?'
  const scope = (adr.scope ?? []).filter(entry => /^[\w@./*-]{1,160}$/.test(entry)).slice(0, 12)

  if (style.name === 'madr') {
    return `---\nstatus: ${status.toLowerCase()}\ndate: ${adr.date}\n---\n\n# ${title}\n\n## Context and Problem Statement\n\n${context}\n\n## Considered Options\n\n* Option 1\n* Option 2\n\n## Decision Outcome\n\n${decision}\n\n### Consequences\n\n* Good, because ...\n* Bad, because ...\n`
  }
  if (style.name === 'ruflo') {
    return `# ${label(style, adr.number).replace(' ', '-')}: ${title}\n\n**Status**: ${status}\n**Date**: ${adr.date}\n${scope.length > 0 ? `**Scope**: ${scope.map(entry => `\`${entry}\``).join(', ')}\n` : ''}\n## Context\n\n${context}\n\n## Decision\n\n${decision}\n\n## Consequences\n\nWhat becomes easier or more difficult because of this change?\n`
  }

  return `# ${adr.number}. ${title}\n\nDate: ${adr.date}\n\n## Status\n\n${status}\n\n## Context\n\n${context}\n\n## Decision\n\n${decision}\n\n## Consequences\n\nWhat becomes easier or more difficult to do because of this change?\n`
}

/** The first record of a project that has none: Nygard's own, accepted. */
export function initialRecord(style: Style, date: string): { file: string; text: string; title: string } {
  const title = 'Record architecture decisions'

  return {
    file: fileNameFor(style, 1, title),
    title,
    text: renderNew(style, { number: 1, title, date, status: 'accepted', context: 'We need to record the architectural decisions made on this project, so that a person joining it later can find what was decided, and why.', decision: 'We will keep Architecture Decision Records, as described by Michael Nygard: one short file for each decision, in this folder, numbered in order and never rewritten; a decision that changes is superseded by a new record.' }),
  }
}

export type Edit = { ok: true; text: string } | { ok: false; why: string }

const lineIndexOf = (lines: readonly string[], test: (line: string) => boolean): number => lines.findIndex(test)

const INLINE_STATUS = /^(\s*(?:[-*]\s*)?\**\s*status\s*\**\s*:\s*\**\s*)(.*?)(\**\s*)$/i
const TABLE_STATUS = /^(\s*\|\s*\**status\**\s*\|\s*)(.*?)(\s*\|?\s*)$/i

/** What the status line says after a change: `Accepted`, or `Superseded by ADR-0005` / `Superseded by [5. Title](0005-x.md)`. */
export function statusText(style: Style, to: AdrStatus, by: { number: number; title: string; file: string } | null, format: AdrFormat): string {
  if (to !== 'superseded' || by === null) return statusWord(to)
  if (format === 'nygard') return `Superseded by [${by.number}. ${recordTitle(by.title)}](${by.file})`
  if (format === 'madr') return `superseded by ADR-${padNumber(by.number, style.width)}`

  return `Superseded by ${label(style, by.number).replace(' ', '-')}`
}

/** The record with its status changed to `to`: one line replaced where the record has a status, one inserted where it has none. */
export function withStatus(text: string, doc: AdrDoc, style: Style, to: AdrStatus, by: { number: number; title: string; file: string } | null = null): Edit {
  if (to === 'unknown') return { ok: false, why: 'unknown is not a status to set' }
  if (to === 'superseded' && by === null) return { ok: false, why: 'superseded needs the record that supersedes it' }

  const value = statusText(style, to, by, doc.format)
  const lines = text.split('\n')

  if (doc.format === 'madr') {
    const close = lines.findIndex((line, index) => index > 0 && line === '---')

    if (!text.startsWith('---\n') || close < 0) return { ok: false, why: 'the front matter is not closed' }

    const at = lineIndexOf(lines.slice(0, close), line => /^status\s*:/i.test(line))

    if (at >= 0) lines[at] = `status: ${value}`
    else lines.splice(close, 0, `status: ${value}`)

    return { ok: true, text: lines.join('\n') }
  }

  if (doc.format === 'nygard') {
    const head = lineIndexOf(lines, line => /^#{1,4}\s*status\s*$/i.test(line.trim()))

    if (head < 0) return { ok: false, why: 'no Status section' }

    const first = lines.findIndex((line, index) => index > head && line.trim() !== '' && !/^#{1,4}\s/.test(line))

    if (first >= 0 && lines.slice(head + 1, first).every(line => line.trim() === '')) lines[first] = value
    else lines.splice(head + 1, 0, '', value)

    return { ok: true, text: lines.join('\n') }
  }

  if (doc.format === 'inline') {
    const at = lineIndexOf(lines.slice(0, 60), line => INLINE_STATUS.test(line) || TABLE_STATUS.test(line))

    if (at >= 0) {
      const line = lines[at] as string
      const table = TABLE_STATUS.exec(line)

      lines[at] = table !== null ? `${table[1]}${value}${table[3]}` : line.replace(INLINE_STATUS, (_all, lead: string, _old: string, tail: string) => `${lead}${value}${tail}`)

      return { ok: true, text: lines.join('\n') }
    }
  }

  // No status yet: after the title (and after the date line, if one sits right there) a `Status:` line the project's parser will read.
  const title = lineIndexOf(lines, line => /^#\s/.test(line))
  const at = title < 0 ? 0 : title + 1
  lines.splice(at, 0, '', `Status: ${value}`)

  return { ok: true, text: lines.join('\n') }
}

/** The newer record names what it replaces: a `Supersedes` line after its status (or title), unless it already says so. */
export function withSupersedes(text: string, doc: AdrDoc, style: Style, old: { number: number; title: string; file: string }): Edit {
  if (doc.supersedes.includes(old.number)) return { ok: true, text }

  const lines = text.split('\n')
  const link = doc.format === 'nygard' ? `Supersedes [${old.number}. ${recordTitle(old.title)}](${old.file})` : `${doc.format === 'inline' ? '**Supersedes**' : 'Supersedes'}: ${label(style, old.number).replace(' ', '-')}`

  if (doc.format === 'madr') {
    const close = lines.findIndex((line, index) => index > 0 && line === '---')

    if (!text.startsWith('---\n') || close < 0) return { ok: false, why: 'the front matter is not closed' }

    lines.splice(close, 0, `supersedes: ${label(style, old.number).replace(' ', '-')}`)

    return { ok: true, text: lines.join('\n') }
  }

  const status = lineIndexOf(lines.slice(0, 80), line => (doc.format === 'nygard' ? /^#{1,4}\s*status\s*$/i.test(line.trim()) : INLINE_STATUS.test(line) || TABLE_STATUS.test(line)))
  const at = status >= 0 ? (doc.format === 'nygard' ? lines.findIndex((line, index) => index > status && line.trim() !== '' && !/^#/.test(line)) + 1 : status + 1) : lineIndexOf(lines, line => /^#\s/.test(line)) + 1

  lines.splice(Math.max(at, 1), 0, ...(doc.format === 'nygard' ? ['', link] : [link]))

  return { ok: true, text: lines.join('\n') }
}

/**
 * The change from `before` to `after` as one hunk of unified-diff lines with a line of context each side. The two texts differ in a
 * run of adjacent lines (every edit above is one), so the common start and end are the context. Capped.
 */
export function lineDiff(before: string, after: string, file = 'file'): string[] {
  if (before === after) return [`${file}: no change`]

  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0

  while (head < a.length && head < b.length && a[head] === b[head]) head += 1

  let tail = 0

  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1

  const from = Math.max(0, head - 1)
  const endA = Math.min(a.length, a.length - tail + 1)
  const out = [`--- ${file}`, `+++ ${file}`, `@@ line ${from + 1} @@`]

  for (let i = from; i < head; i += 1) out.push(` ${a[i]}`)
  for (let i = head; i < a.length - tail; i += 1) out.push(`-${a[i]}`)
  for (let i = head; i < b.length - tail; i += 1) out.push(`+${b[i]}`)
  for (let i = a.length - tail; i < endA; i += 1) out.push(` ${a[i]}`)

  return out.slice(0, 40)
}

/** A draft record for a finished mission: only what the mission itself said (its goal, its tasks and their results); the decision is left to the person. */
export function draftFromMission(mission: { objective: string; tasks: readonly { title: string; result?: string }[] }, scope: readonly string[], date: string): NewAdr {
  // Counted and cut in code points, as titleFit counts: a cut never leaves half of a surrogate pair.
  const whole = titleClean(mission.objective)
  const points = Array.from(whole)
  const title = points.length > DRAFT_TITLE_MAX ? points.slice(0, DRAFT_TITLE_MAX).join('').trim() : whole
  const done = mission.tasks.slice(0, 12).map(task => `- ${titleClean(task.title)}${task.result === undefined || task.result === '' ? '' : `: ${plain(task.result, 140)}`}`)

  return {
    number: 0,
    date,
    title,
    ...(title !== whole && { titleShortenedFrom: points.length }),
    status: 'proposed',
    scope: [...scope],
    context: `A mission set out to: ${plain(mission.objective, 2_000)}`,
    decision: `Draft, written from the mission's record and to be rewritten by a person: the mission did the following.\n\n${done.join('\n')}\n\nWhat was decided, and why, is not in the record: say it here.`,
  }
}
