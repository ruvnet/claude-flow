/**
 * The ADR lint, the link graph and the page's filter (ADR-480). Pure and bounded; the parser they work on is data/adr.ts, which re-exports
 * this file. Errors are what a reader would be misled by, warnings are untidy, info is a note; a kind of finding is listed at most PER_CODE
 * times so one noisy kind cannot hide the rest.
 */
import type { AdrDoc, AdrStatus, Finding, Registry } from './adr'

const PER_CODE = 60

/** Both directions of every link, from what each document says about the others (declared either way, deduplicated). */
export function graphOf(registry: Registry, doc: AdrDoc): { supersedes: AdrDoc[]; supersededBy: AdrDoc[]; relates: AdrDoc[]; citedBy: AdrDoc[] } {
  const find = (numbers: number[]): AdrDoc[] => numbers.flatMap(n => registry.byNumber.get(n)?.slice(0, 1) ?? [])
  const by = (pick: (other: AdrDoc) => number[]): AdrDoc[] => (doc.number === null ? [] : registry.docs.filter(other => other !== doc && pick(other).includes(doc.number as number)))
  const unique = (list: AdrDoc[]) => [...new Set(list)]

  return {
    supersedes: unique([...find(doc.supersedes), ...by(other => other.supersededBy)]),
    supersededBy: unique([...find(doc.supersededBy), ...by(other => other.supersedes)]),
    relates: unique([...find(doc.relates)]),
    citedBy: unique(by(other => [...other.relates, ...other.supersedes, ...other.supersededBy])),
  }
}

/**
 * The lint. `files` is every file name in the folder (for broken links), `index` the text of an index file (README.md, index.md,
 * INDEX*.md) when the folder has one. Errors are what a reader would be misled by; warnings are untidy; info is a note.
 */
export function lint(registry: Registry, files: readonly string[], index: string | null = null): Finding[] {
  const out: Finding[] = []
  const names = new Set(files)
  const add = (level: Finding['level'], code: string, file: string, text: string) => void out.push({ level, code, file, text })

  for (const [number, all] of registry.byNumber) {
    for (const doc of all) {
      const same = all.filter(other => other !== doc && other.variant === doc.variant)

      if (same.length > 0) add('error', 'duplicate-number', doc.file, `number ${number} is also used by ${same.map(other => other.file).join(', ')}`)
    }
  }

  for (const doc of registry.docs) {
    for (const target of doc.supersedes) if (!registry.byNumber.has(target)) add('warn', 'dangling-supersedes', doc.file, `supersedes ${target}, which has no file`)
    for (const target of doc.supersededBy) if (!registry.byNumber.has(target)) add('warn', 'dangling-superseded-by', doc.file, `superseded by ${target}, which has no file`)

    for (const target of doc.supersedes) {
      const other = registry.byNumber.get(target)?.[0]

      if (other !== undefined && other.status !== 'superseded' && !other.supersededBy.includes(doc.number ?? -1)) add('warn', 'supersede-mismatch', doc.file, `says it supersedes ${target}, but ${other.file} is still ${other.status === 'unknown' ? 'without a status' : other.status}`)
    }
    if (doc.status === 'superseded' && doc.supersededBy.length === 0 && !registry.docs.some(other => other.supersedes.includes(doc.number ?? -1))) add('warn', 'superseded-by-nothing', doc.file, 'is superseded, but no document says by which')
    if (doc.statusRaw === '') add('warn', 'no-status', doc.file, 'has no status')
    else if (doc.status === 'unknown') add('warn', 'unknown-status', doc.file, `status “${doc.statusRaw}” is not one of proposed, accepted, superseded, deprecated, rejected`)
    if (doc.statusRaw !== '' && doc.date === null) add('warn', 'status-without-date', doc.file, 'has a status but no date')
    if (doc.number === null) add('warn', 'no-number', doc.file, 'has no number')
    for (const link of doc.fileLinks) if (!names.has(link)) add('warn', 'broken-link', doc.file, `links to ${link}, which is not in this folder`)
    for (const note of doc.notes) if (note.startsWith('longer than')) add('info', 'too-large', doc.file, note)
    if (index !== null && !mentions(index, doc)) add('warn', 'not-in-index', doc.file, 'is not listed in the folder’s index')
  }

  // A cycle in supersession (A supersedes B supersedes A) cannot be read as history. Each walk is bounded by the number of records.
  for (const doc of registry.docs) {
    if (doc.number === null) continue

    const seen = new Set<number>()
    const todo = [...doc.supersedes]

    while (todo.length > 0) {
      const number = todo.pop() as number

      if (number === doc.number) {
        add('error', 'supersede-cycle', doc.file, `supersession loops back to number ${doc.number}`)
        break
      }
      if (seen.has(number)) continue

      seen.add(number)
      todo.push(...(registry.byNumber.get(number)?.[0]?.supersedes ?? []))
    }
  }

  if (registry.truncated) add('info', 'too-many', '', `the folder holds more records than the console reads: only the first ${registry.docs.length} are listed`)

  // Bounded: at most PER_CODE findings of one kind (errors first), then a note of how many more there were, so one noisy kind cannot hide the rest.
  const order = { error: 0, warn: 1, info: 2 }
  const kept: Finding[] = []
  const seen = new Map<string, number>()

  for (const finding of [...out].sort((x, y) => order[x.level] - order[y.level])) {
    const n = (seen.get(finding.code) ?? 0) + 1

    seen.set(finding.code, n)
    if (n <= PER_CODE) kept.push(finding)
  }
  for (const [code, n] of seen) if (n > PER_CODE) kept.push({ level: 'info', code: `more-${code}`, file: '', text: `${n - PER_CODE} more ${code} findings not listed` })

  return kept.slice(0, 400)
}

function mentions(index: string, doc: AdrDoc): boolean {
  if (index.includes(doc.file)) return true
  if (doc.number === null) return false

  const n = String(doc.number)
  const padded = n.padStart(3, '0')

  return new RegExp(`(?:ADR[-_ ]?|\\|\\s*|\\[|^\\s*[-*]\\s*|\\b)0*${n}\\b|\\b${padded}\\b`, 'm').test(index)
}

export type Counts = { total: number; byStatus: Record<AdrStatus, number>; errors: number; warns: number }

export function countsOf(registry: Registry, findings: readonly Finding[]): Counts {
  const byStatus: Record<AdrStatus, number> = { proposed: 0, accepted: 0, superseded: 0, deprecated: 0, rejected: 0, unknown: 0 }

  for (const doc of registry.docs) byStatus[doc.status] += 1

  return { total: registry.docs.length, byStatus, errors: findings.filter(f => f.level === 'error').length, warns: findings.filter(f => f.level === 'warn').length }
}

/** The filter the page applies: a status (or all), a text (every word in the title, file name or scope), a scope fragment. */
export function filterDocs(docs: readonly AdrDoc[], filter: { status: AdrStatus | 'all'; text: string; scope: string }): AdrDoc[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(word => word !== '')
  const scope = filter.scope.trim().toLowerCase()

  return docs.filter(doc => {
    if (filter.status !== 'all' && doc.status !== filter.status) return false
    if (scope !== '' && !doc.scope.some(entry => entry.toLowerCase().includes(scope))) return false

    const hay = `${doc.title} ${doc.file} ${doc.number ?? ''} ${doc.scope.join(' ')}`.toLowerCase()

    return words.every(word => hay.includes(word))
  })
}
