/**
 * What the Memory Lab's runs printed, as lines worth reading: an entry's whole value wrapped, search hits by score,
 * listed entries with their size and age, AgentDB's controllers as on/off marks; anything else as the MetaHarness lab
 * reads JSON. The CLI's own warnings that change the meaning of an answer (a second store it did not read, a key not
 * found) are kept, first. And the recency binning the view draws as a timeline. Pure: strings in, strings out.
 */
import { jsonAfter } from './data/cli'
import { msOf, plain, recordOf } from './data/parse'
import { countOf, isoOf, measureOf } from './data/safe'
import { labLines } from './mh-lab'

/** An entry's value may be long: the panel scrolls (j/k), so it keeps more lines than the MetaHarness lab. */
export const MEM_MAX_LINES = 80
const WRAP = 100

const NOISE = /^(Transformers\.js loaded|✅ Using native|\[INFO\] Executing tool|Parameters:|\[OK\] Tool executed|Result:|─+$)/

/** The CLI's warnings and errors, cleaned: these say the answer is partial or did not happen, so they lead. */
function warnings(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`
    .split('\n')
    .map(line => plain(line, 200))
    .filter(line => /^\[(WARN|ERROR)\]/.test(line))
    .map(line => `⚠ ${line.replace(/^\[(WARN|ERROR)\]\s*/, '')}`)
    .slice(0, 3)
}

/** Text cut into lines of at most `width`, at spaces where it can; control characters never reach the terminal. */
export function wrap(text: string, width = WRAP): string[] {
  const out: string[] = []

  for (const paragraph of text.split('\n')) {
    let line = ''

    for (const whole of plain(paragraph, 20_000).split(' ')) {
      let word = whole

      // A word wider than the panel is cut, so a long token (a hash, a URL) still shows whole across lines.
      while (word.length > width) {
        if (line !== '') out.push(line)
        out.push(word.slice(0, width))
        word = word.slice(width)
        line = ''
      }

      if (line === '') line = word
      else if (line.length + 1 + word.length <= width) line = `${line} ${word}`
      else {
        out.push(line)
        line = word
      }
    }

    out.push(line)
  }

  return out
}

const short = (value: unknown, max: number): string => (typeof value === 'string' ? plain(value, max) : typeof value === 'number' ? String(measureOf(value) ?? 'n/a') : typeof value === 'boolean' ? String(value) : '')
const score = (value: unknown): string => measureOf(value)?.toFixed(3) ?? '  n/a'

/** One stored entry: its name, its size and access count, then the whole value. */
function entryLines(record: Record<string, unknown>): string[] {
  const value = record.content ?? record.value
  const body = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  const updated = msOf(record.updatedAt ?? record.storedAt)
  const head = `${short(record.namespace, 40)}/${short(record.key, 128)} · ${body.length} chars · read ${countOf(record.accessCount) ?? 'n/a'}× · ${record.hasEmbedding === true ? 'has a vector' : 'no vector'}${updated !== undefined ? ` · updated ${isoOf(updated).slice(0, 16).replace('T', ' ')}` : ''}`

  return [head, ...(Array.isArray(record.tags) && record.tags.length > 0 ? [`tags: ${record.tags.map(tag => short(tag, 24)).join(', ')}`] : []), '', ...wrap(body)]
}

/** Search hits, best first: score, where it lives, and the start of its text. */
function hitLines(record: Record<string, unknown>, hits: unknown[]): string[] {
  const rows = hits.map(recordOf).filter((row): row is Record<string, unknown> => row !== null)
  const head = `${rows.length} hit${rows.length === 1 ? '' : 's'}${record.searchType !== undefined ? ` · ${short(record.searchType, 20)}` : ''}${record.searchTime !== undefined ? ` · ${short(record.searchTime, 20)}` : ''}${Array.isArray(record.searchedNamespaces) ? ` · searched ${record.searchedNamespaces.map(name => short(name, 24)).join(', ')}` : ''}`
  const notes = [record.degraded === true ? `degraded: ${short(record.reason, 80)}` : '', short(record.note, 160)].filter(note => note !== '')

  if (rows.length === 0) return [head, ...notes, '(no matches)']

  return [
    head,
    ...notes,
    ...rows.slice(0, 20).map(row => {
      const where = row.namespace !== undefined ? `${short(row.namespace, 24)}/${short(row.key ?? row.id, 60)}` : short(row.key ?? row.id ?? row.pattern ?? row.nodeId, 60)
      const text = short(row.preview ?? row.content ?? row.value ?? row.pattern ?? row.text ?? '', 90)

      return `${score(row.score ?? row.similarity ?? row.confidence ?? row.distance)}  ${where}${row.source !== undefined ? ` [${short(row.source, 12)}]` : ''}${text !== '' ? `  ${text}` : ''}`
    }),
  ]
}

/** Listed entries, newest first: name, size, vector mark and age. */
function listLines(rows: unknown[]): string[] {
  const entries = rows.map(recordOf).filter((row): row is Record<string, unknown> => row !== null)

  if (entries.length === 0) return ['(no entries)']

  return [
    `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    ...entries.slice(0, 60).map(row => {
      const at = msOf(row.updatedAt ?? row.createdAt ?? row.storedAt)

      return `${row.hasEmbedding === true ? '◆' : '◇'} ${short(row.namespace, 24)}/${short(row.key, 80)} · ${countOf(row.size) ?? 'n/a'} B${at !== undefined ? ` · ${isoOf(at).slice(0, 16).replace('T', ' ')}` : ''}`
    }),
  ]
}

/** AgentDB's controllers: an on/off mark, the name and its level. */
function controllerLines(record: Record<string, unknown>, controllers: unknown[]): string[] {
  const rows = controllers.map(recordOf).filter((row): row is Record<string, unknown> => row !== null)
  const on = rows.filter(row => row.enabled === true).length

  return [`AgentDB ${record.available === true ? 'available' : 'NOT available'} · ${on}/${rows.length} controllers on`, ...rows.map(row => `${row.enabled === true ? '✓' : '·'} ${short(row.name, 40)}${row.level !== undefined ? `  L${short(row.level, 4)}` : ''}`)]
}

/** A vector: its dimensions, norm and first values, never all 384. */
function vectorLines(record: Record<string, unknown>): string[] | null {
  const vector = Array.isArray(record.embedding) ? record.embedding : Array.isArray(record.vector) ? record.vector : null

  if (vector === null) return null

  // Only measurements count as elements (#3822): an element of 1e300 would print as "1e+300" in the head and overflow the norm.
  const numbers = vector.flatMap(value => measureOf(value) ?? [])
  const norm = Math.sqrt(numbers.reduce((sum, value) => sum + value * value, 0))

  return [`${numbers.length} dimensions · norm ${measureOf(norm)?.toFixed(3) ?? 'n/a'}${record.model !== undefined ? ` · ${short(record.model, 40)}` : ''}`, `head: ${numbers.slice(0, 8).map(value => value.toFixed(4)).join(' ')} …`]
}

/** One run's JSON as lines, by its shape; empty when nothing specific applies. */
function shaped(value: unknown): string[] {
  if (Array.isArray(value)) return listLines(value)

  const record = recordOf(value)

  if (record === null) return []
  if (record.content !== undefined || (record.value !== undefined && record.key !== undefined)) return entryLines(record)
  if (Array.isArray(record.results)) return hitLines(record, record.results)
  if (Array.isArray(record.entries) && record.total !== undefined) return listLines(record.entries)
  if (Array.isArray(record.controllers)) return controllerLines(record, record.controllers)

  return vectorLines(record) ?? []
}

/** What a Memory Lab run printed, at most MEM_MAX_LINES: its warnings, then its JSON read by shape, else the text. */
export function memLines(id: string, stdout: string, stderr = ''): string[] {
  const warned = warnings(stdout, stderr)
  const json = jsonAfter(stdout)
  const body = json === null ? [] : shaped(json)

  if (body.length > 0) return [...warned, ...body].slice(0, MEM_MAX_LINES)

  // Text output (store, delete, export print no JSON): its own lines, without the banners.
  const text = stdout
    .split('\n')
    .map(line => plain(line, 160))
    .filter(line => line !== '' && !NOISE.test(line) && !/^\[(WARN|ERROR)\]/.test(line))

  if (json === null && (text.length > 0 || warned.length > 0)) return [...warned, ...text].slice(0, MEM_MAX_LINES)

  return [...warned, ...labLines(id, stdout, stderr)].slice(0, MEM_MAX_LINES)
}

/** Times bucketed into `bins` equal spans from the oldest to now, oldest first, with the span's start. */
export function recency(times: readonly number[], nowMs: number, bins = 32): { counts: number[]; fromMs: number } | null {
  const past = times.filter(at => Number.isFinite(at) && at <= nowMs)

  if (past.length === 0) return null

  const fromMs = Math.min(...past)
  // At least an hour across, so a fresh store does not pile into one bar.
  const span = Math.max(3_600_000, nowMs - fromMs)
  const counts = Array.from({ length: bins }, () => 0)

  for (const at of past) {
    const bin = Math.min(bins - 1, Math.floor(((at - fromMs) / span) * bins))

    counts[bin] = (counts[bin] ?? 0) + 1
  }

  return { counts, fromMs }
}

const SPARK = ' ▁▂▃▄▅▆▇█'

/** Counts as one row of bars, the tallest a full block; an empty bin is a dot so the axis reads. */
export function sparkline(counts: readonly number[]): string {
  const top = Math.max(1, ...counts)

  return counts.map(n => (n === 0 ? '·' : (SPARK[Math.max(1, Math.round((n / top) * 8))] ?? '█'))).join('')
}

/** A filled share of `width` cells: ████░░░░. */
export function gauge(part: number, whole: number, width: number): string {
  const cells = Number.isFinite(width) ? Math.min(200, Math.max(0, Math.floor(width))) : 0
  const share = whole > 0 && Number.isFinite(part) && Number.isFinite(whole) ? Math.min(Math.max(part, 0), whole) / whole : 0
  const filled = Math.min(cells, Math.max(0, Math.round(share * cells)))

  return `${'█'.repeat(filled)}${'░'.repeat(cells - filled)}`
}
