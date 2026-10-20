/**
 * The ADR registry's parser and lint (ADR-480): pure, bounded and offline. It reads the Architecture Decision Records of the
 * PROJECT the console runs in, in whatever convention that project uses: MADR (front matter `status:` / `date:`), Nygard and adr-tools
 * (a `## Status` section, `Superseded by [5. Title](0005-x.md)`), ruflo's own (`**Status**: Accepted` header lines, `ADR-099:` titles),
 * log4brains (MADR-like), and plain markdown with no status at all. A file that does not parse is a document with `format: 'bare'`
 * and a note, never an exception. Text is washed first (escapes and control characters out), a file over MAX_FILE is read to its cap,
 * and a folder over MAX_FILES keeps its first MAX_FILES names in sorted order and says so.
 *
 * Nothing here proves a change complies with an ADR: `scope` is whatever paths the document names, and the matcher in adr-scope.ts is a
 * path and keyword heuristic.
 */
import { ESCAPES, HIDDEN } from './parse'

export const MAX_FILE = 200_000
export const MAX_FILES = 500
export const MAX_SCOPE = 24
export const MAX_REFS = 20
export const MAX_LINKS = 24
export const SECTION_MAX = 1200

export const STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated', 'rejected'] as const
export type AdrStatus = (typeof STATUSES)[number] | 'unknown'
/** madr: front matter. nygard: a `## Status` section. inline: a `Status:` / `**Status**:` line. bare: no status anywhere. */
export type AdrFormat = 'madr' | 'nygard' | 'inline' | 'bare'

export type AdrDoc = {
  file: string
  number: number | null
  /** `A` in ADR-322A, `.1` in ADR-164.1: a sibling of the same number, which is not a duplicate. */
  variant: string
  title: string
  status: AdrStatus
  statusRaw: string
  date: string | null
  format: AdrFormat
  scope: string[]
  supersedes: number[]
  supersededBy: number[]
  relates: number[]
  refs: number[]
  context: string
  decision: string
  consequences: string
  size: number
  notes: string[]
  /** Relative markdown links to files in the same folder, for the broken-link lint. */
  fileLinks: string[]
}

export type Finding = { level: 'error' | 'warn' | 'info'; code: string; file: string; text: string }

/** Escapes and control characters out; tabs and newlines stay. A lone CR is a newline. */
export function wash(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(ESCAPES, '').replace(HIDDEN, char => (char === '\n' || char === '\t' ? char : ''))
}

/** One line of at most `max` code points: a cut never splits a surrogate pair, and the cap counts as checkLimit counts (ADR-481). */
const oneLine = (text: string, max: number): string => Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('')

export const FILE_NUMBER = /^(?:adr[-_ ]?)?(\d{1,6})([A-Za-z]|\.\d{1,3})?(?:[-_. ]|$)/i
export const ADR_FILE = /\.(md|markdown)$/i

/** The number a file name starts with (`0005-x.md`, `ADR-099-x.md`, `5_x.md`), else null. */
export function numberOfFile(file: string): number | null {
  const match = FILE_NUMBER.exec(file)

  return match === null ? null : Number(match[1])
}

export const variantOfFile = (file: string): string => FILE_NUMBER.exec(file)?.[2] ?? ''

export function normaliseStatus(raw: string): AdrStatus {
  const text = raw.toLowerCase()

  if (/\bsuperse?ded\b|\breplaced\b|\bobsolete/.test(text)) return 'superseded'
  if (/\bdeprecated\b|\bwithdrawn\b|\bretired\b/.test(text)) return 'deprecated'
  if (/\brejected\b|\bdeclined\b|\bdropped\b|\babandoned\b|\bwon'?t\b/.test(text)) return 'rejected'
  if (/\baccepted\b|\bapproved\b|\badopted\b|\bimplemented\b|\bdecided\b|\bshipped\b|\bactive\b|\bdone\b|\bin force\b/.test(text)) return 'accepted'
  if (/\bproposed\b|\bdraft\b|\bpending\b|\bopen\b|\bunder review\b|\bin review\b|\brfc\b/.test(text)) return 'proposed'

  return 'unknown'
}

/** `2026-10-07` from any of `2026-10-07`, `2026/10/07`, `2026 10 07`, `2026.10.07`; null when there is no such date. */
export function dateOf(text: string): string | null {
  const match = /\b(20\d\d|19\d\d)[-/. ](0?[1-9]|1[0-2])[-/. ](0?[1-9]|[12]\d|3[01])\b/.exec(text)

  return match === null ? null : `${match[1]}-${(match[2] as string).padStart(2, '0')}-${(match[3] as string).padStart(2, '0')}`
}

type Front = { fields: Map<string, string>; body: string; end: number }

/** A leading `---` block of `key: value` lines (and `- item` lists), if there is one. */
export function frontMatter(text: string): Front | null {
  if (!text.startsWith('---\n')) return null

  const close = text.indexOf('\n---', 4)

  if (close < 0 || close > 8000) return null

  const fields = new Map<string, string>()
  let key = ''

  for (const line of text.slice(4, close).split('\n').slice(0, 80)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    const pair = /^([A-Za-z][\w -]{0,40}):\s*(.*)$/.exec(line)

    if (pair !== null) {
      key = (pair[1] as string).toLowerCase().replace(/[\s_]+/g, '-')
      fields.set(key, (pair[2] as string).trim().replace(/^["']|["']$/g, ''))
    } else if (item !== null && key !== '') fields.set(key, `${fields.get(key) ?? ''}, ${(item[1] as string).trim()}`.replace(/^, /, ''))
  }

  const end = text.indexOf('\n', close + 1)

  return { fields, body: end < 0 ? '' : text.slice(end + 1), end: end < 0 ? text.length : end + 1 }
}

/** ADR numbers named in a stretch of text: `ADR-099`, `ADR 430`, `[5. Title](0005-x.md)`, `0005-x.md`, `adr/0005`, or bare numbers after a keyword. */
export function numbersIn(text: string): number[] {
  const out = new Set<number>()
  const clean = text.replace(/\bruOS ADR[- ]?\d+/gi, '')

  for (const match of clean.matchAll(/\bADR[-_ ]?(\d{1,6})\b/gi)) out.add(Number(match[1]))
  for (const match of clean.matchAll(/\]\((?:[^)\s]{0,200}\/)?(\d{1,6})[-_.][^)\s]{0,200}\)/g)) out.add(Number(match[1]))
  for (const match of clean.matchAll(/\[(\d{1,6})[.:)]\s/g)) out.add(Number(match[1]))
  for (const match of clean.matchAll(/\b(\d{1,6})-[a-z][\w-]*\.md\b/gi)) out.add(Number(match[1]))
  // A list of bare numbers (`related 150, 174`) only where the text names no ADR the usual way; dates and versions are not numbers.
  const numbersOnly = clean.replace(/\b\d{4}[-/. ]\d{1,2}[-/. ]\d{1,2}\b/g, ' ')

  if (out.size === 0 && /^[\s\d,;&.]*(?:and[\s\d,;&.]*)*$/i.test(numbersOnly)) for (const match of numbersOnly.matchAll(/(?:^|[\s,;&])(\d{1,6})(?=[\s,;&.]|$)/g)) out.add(Number(match[1]))

  return [...out].filter(n => n >= 0 && n < 1_000_000).slice(0, MAX_LINKS)
}

const REL_LINE = /^\s*(?:[-*]\s*)?\**\s*(supersedes|superseded[- ]by|superseded in part by|replaces|replaced[- ]by|amends|amended[- ]by|builds on|extends|related(?: to)?|relates to|complements|see also|refines|depends on)(?:\s*\/\s*[a-z ]+?)?\s*\**\s*:?\**\s*(.*)$/i

type Links = { supersedes: number[]; supersededBy: number[]; relates: number[] }

function addLinks(links: Links, key: string, text: string): void {
  const numbers = numbersIn(text)
  const word = key.toLowerCase().replace(/[- ]+/g, ' ')

  if (word === 'supersedes' || word === 'replaces') links.supersedes.push(...numbers)
  else if (word === 'superseded by' || word === 'replaced by' || word === 'superseded in part by') links.supersededBy.push(...numbers)
  else links.relates.push(...numbers)
}

const uniq = (values: number[], self: number | null): number[] => [...new Set(values)].filter(value => value !== self).slice(0, MAX_LINKS)

/** The first `max` characters of the text under a heading whose title matches, to the next heading of the same or a higher level. */
export function sectionOf(body: string, names: RegExp, max = SECTION_MAX): string {
  const lines = body.split('\n')
  const start = lines.findIndex(line => /^#{1,4}\s/.test(line) && names.test(line.replace(/^#+\s*(?:\d+[.)]?\s*)?/, '').trim()))

  if (start < 0) return ''

  const level = (/^#+/.exec(lines[start] as string) as RegExpExecArray)[0].length
  const out: string[] = []

  for (const line of lines.slice(start + 1)) {
    const heading = /^(#+)\s/.exec(line)

    if (heading !== null && (heading[1] as string).length <= level) break

    out.push(line)
    if (out.join('\n').length > max * 2) break
  }

  return oneLine(out.join('\n').replace(/```[\s\S]*?```/g, ' '), max)
}

const PATH_TOKEN = /`((?:\.\/)?(?:@?[A-Za-z0-9_.-]{1,60}\/){1,12}[A-Za-z0-9_.*-]{0,60})`/g

/** Paths and packages a document names between backticks (not URLs): its working scope. */
export function pathsIn(text: string): string[] {
  const out = new Set<string>()

  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = (match[1] as string).replace(/^\.\//, '').replace(/[.,:;]+$/, '')

    if (token.length >= 3 && token.length <= 160 && !/^https?:|\/\/|\.\./.test(token) && !/\s/.test(token)) out.add(token)
    if (out.size >= MAX_SCOPE * 3) break
  }

  return [...out]
}

function scopeFrom(header: string, body: string, declared: string): string[] {
  const out: string[] = []

  for (const part of declared.split(/[,;]+/)) {
    const token = part.replace(/[`*]/g, '').trim().replace(/^\.\//, '').replace(/[.:]+$/, '')

    if (token !== '' && token.length <= 160 && !/\s/.test(token.split(':')[0] as string) && !/\.\./.test(token)) out.push(token.split(':')[0] as string)
  }

  out.push(...pathsIn(header))
  out.push(...pathsIn(body.slice(0, 20_000)))

  return [...new Set(out)].filter(entry => entry !== '').slice(0, MAX_SCOPE)
}

function refsIn(text: string): number[] {
  const out = new Set<number>()
  const noCode = text.replace(/```[\s\S]*?```/g, ' ')

  for (const match of noCode.matchAll(/(?:^|[^\w&/#[])#(\d{2,6})\b/gm)) {
    out.add(Number(match[1]))
    if (out.size >= MAX_REFS) break
  }
  for (const match of noCode.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/(\d{1,6})/g)) out.add(Number(match[1]))

  return [...out].slice(0, MAX_REFS)
}

function titleOf(front: Front | null, body: string, file: string, number: number | null): string {
  const declared = front?.fields.get('title')

  if (declared !== undefined && declared !== '') return oneLine(declared, 160)

  const heading = /^#\s+(.+)$/m.exec(body)

  if (heading !== null) {
    const cleaned = (heading[1] as string).replace(/^(?:ADR[-_ ]?\d+|\d+)\s*[.:)—–-]\s*/i, '').replace(/^ADR[-_ ]?\d+\s+/i, '').replace(/^\d+\.\s+/, '').trim()

    if (cleaned !== '') return oneLine(cleaned, 160)
  }

  const slug = file.replace(ADR_FILE, '').replace(FILE_NUMBER, '').replace(/[-_]+/g, ' ').trim()

  return oneLine(slug === '' ? `ADR ${number ?? '?'}` : slug, 160)
}

/** The status the body declares, in the order a convention places it: a `## Status` section, then a `Status:` line. */
function statusIn(body: string): { raw: string; format: AdrFormat; section: string } | null {
  const lines = body.split('\n')
  const at = lines.findIndex(line => /^#{1,4}\s*status\s*$/i.test(line.trim()))

  if (at >= 0) {
    const out: string[] = []

    for (const line of lines.slice(at + 1, at + 14)) {
      if (/^#{1,4}\s/.test(line)) break
      out.push(line)
    }

    const section = out.join('\n')
    const first = out.map(line => line.trim()).find(line => line !== '')

    return { raw: first ?? '', format: 'nygard', section }
  }

  for (const line of lines.slice(0, 60)) {
    const table = /^\s*\|\s*\**status\**\s*\|\s*(.+?)\s*\|?\s*$/i.exec(line)

    if (table !== null) return { raw: (table[1] as string).replace(/\*+/g, '').trim(), format: 'inline', section: line }

    const inline = /^\s*(?:[-*]\s*)?\**\s*status\s*\**\s*:\s*\**\s*(.+)$/i.exec(line)

    if (inline !== null) return { raw: (inline[1] as string).replace(/\*+/g, '').trim(), format: 'inline', section: line }
  }

  return null
}

/** One file's text to a document. Never throws: whatever cannot be read becomes a note. */
export function parseAdr(file: string, source: string): AdrDoc {
  const notes: string[] = []
  const size = source.length
  const text = wash(source.length > MAX_FILE ? source.slice(0, MAX_FILE) : source)

  if (size > MAX_FILE) notes.push(`longer than ${MAX_FILE} characters: read to that point`)

  const front = frontMatter(text)
  const body = front === null ? text : front.body
  const number = numberOfFile(file) ?? numberFromTitle(body)
  const links: Links = { supersedes: [], supersededBy: [], relates: [] }
  let format: AdrFormat = 'bare'
  let statusRaw = ''
  let headerText = ''

  if (front !== null && (front.fields.has('status') || front.fields.has('date') || front.fields.has('title'))) {
    format = 'madr'
    statusRaw = front.fields.get('status') ?? ''
    headerText = [...front.fields.entries()].map(([key, value]) => `${key}: ${value}`).join('\n')
    for (const [key, value] of front.fields) if (REL_LINE.test(`${key}: ${value}`)) addLinks(links, (REL_LINE.exec(`${key.replace(/-/g, ' ')}: ${value}`) as RegExpExecArray | null)?.[1] ?? key, value)
    if (statusRaw !== '' && /superse/i.test(statusRaw)) addLinks(links, 'superseded by', statusRaw)
  }

  const declared = statusIn(body.replace(/```[\s\S]*?```/g, block => block.replace(/[^\n]/g, ' ')))

  if (declared !== null && (statusRaw === '' || format === 'bare')) {
    statusRaw = statusRaw === '' ? declared.raw : statusRaw
    if (format === 'bare') format = declared.format
  }

  const head = body.split('\n').slice(0, 40)

  headerText += `\n${head.join('\n')}${declared?.format === 'nygard' ? `\n${declared.section}` : ''}`

  for (const line of [...head, ...(declared?.format === 'nygard' ? declared.section.split('\n') : [])]) {
    const rel = REL_LINE.exec(line)

    if (rel !== null) addLinks(links, rel[1] as string, rel[2] as string)
  }
  if (/superse/i.test(statusRaw)) addLinks(links, /superseded in part/i.test(statusRaw) ? 'superseded in part by' : 'superseded by', statusRaw)

  const status = normaliseStatus(statusRaw)
  const date = dateOf(front?.fields.get('date') ?? '') ?? dateOf(head.filter(line => /\bdate\b|\bupdated\b/i.test(line)).join('\n')) ?? dateOf(head.slice(0, 12).join('\n'))
  const scopeDeclared = front?.fields.get('scope') ?? head.map(line => /^\s*\**\s*scope\s*\**\s*:\s*\**\s*(.+)$/i.exec(line)?.[1]).find(value => value !== undefined) ?? ''
  const decision = sectionOf(body, /^(?:decision(?: outcome)?|the decision|resolution)\b/i)

  if (statusRaw === '') notes.push('no status')
  if (number === null) notes.push('no number in the file name or title')

  return {
    file,
    number,
    variant: variantOfFile(file),
    title: titleOf(front, body, file, number),
    status,
    statusRaw: oneLine(statusRaw, 120),
    date,
    format,
    scope: scopeFrom(headerText, body, scopeDeclared),
    supersedes: uniq(links.supersedes, number),
    supersededBy: uniq(links.supersededBy, number),
    relates: uniq(links.relates, number),
    refs: refsIn(body),
    context: sectionOf(body, /^(?:context(?: and problem statement)?|background|problem statement)\b/i),
    decision,
    consequences: sectionOf(body, /^(?:consequences|positive consequences|outcome)\b/i),
    size,
    notes,
    fileLinks: sameFolderLinks(text),
  }
}

function numberFromTitle(body: string): number | null {
  const match = /^#\s+(?:ADR[-_ ]?)?(\d{1,6})\b/im.exec(body)

  return match === null ? null : Number(match[1])
}

/** Relative markdown links that stay in the folder (`[x](0005-y.md)`): what the broken-link lint checks. */
export function sameFolderLinks(text: string): string[] {
  const out = new Set<string>()
  const noCode = text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')

  for (const match of noCode.matchAll(/\]\(([^)\s#]{1,200}\.md)(?:#[^)\s]{0,100})?(?:\s+"[^"]{0,100}")?\)/g)) {
    const target = match[1] as string

    if (!/^([a-z][a-z0-9+.-]*:|\/|\.\.)/i.test(target) && !target.includes('/')) out.add(decodeSafe(target))
    if (out.size >= MAX_LINKS) break
  }

  return [...out]
}

const decodeSafe = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Every document, newest number last; documents without a number follow in file order. */
export const sortDocs = (docs: readonly AdrDoc[]): AdrDoc[] => [...docs].sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.file.localeCompare(b.file))

export type Registry = { docs: AdrDoc[]; byNumber: Map<number, AdrDoc[]>; truncated: boolean }

export function indexOf(docs: readonly AdrDoc[], truncated = false): Registry {
  const byNumber = new Map<number, AdrDoc[]>()

  for (const doc of docs) if (doc.number !== null) byNumber.set(doc.number, [...(byNumber.get(doc.number) ?? []), doc])

  return { docs: sortDocs(docs), byNumber, truncated }
}

export * from './adr-lint'
