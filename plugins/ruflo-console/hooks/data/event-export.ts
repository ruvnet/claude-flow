/**
 * Exporting what the Events and Timeline pages show (ADR-474): events as markdown or JSONL, lane summaries as markdown or CSV. The
 * target is a name under `.claude-flow/console/exports/` or a path inside the project; `..`, a link on the way, a bad extension and an
 * existing file are all refused, and the text is washed and capped before it is built. The write itself is a confirm-gated fixed argv.
 */
import { isoOf } from './safe'
import type { ActionSpec } from '../actions'
import { levelOf } from './event-severity'
import { maskLine } from './event-mask'
import type { ConsoleEvent } from './events'
import { refOf } from './events'
import { EXPORT_DIR } from './activity-store'
import { checkNoLinks, dirOf, newFileArgv, type PathCheck } from './wf-file'
import { writeFlavorReady } from './write-flavor'
import { clockOf, type Concurrency, type LaneView } from './timeline-model'
import type { ReaderFs } from './files'

export type Format = 'md' | 'jsonl' | 'csv'
export const MAX_EXPORT_BYTES = 400_000
export const MAX_EXPORT_EVENTS = 2_000

const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}\.(md|jsonl|csv)$/
const bytes = (text: string): number => new TextEncoder().encode(text).length

export const formatOf = (path: string): Format | null => (/\.md$/.test(path) ? 'md' : /\.jsonl$/.test(path) ? 'jsonl' : /\.csv$/.test(path) ? 'csv' : null)

/** The absolute path a name or relative path means (a bare file name goes under the exports folder), or why it is refused. Lexical only; see `checkNoLinks` for the disk half. */
export function resolveTarget(input: string, cwd: string, allowed: readonly Format[]): PathCheck {
  const raw = input.trim()
  const root = cwd.replace(/\/+$/, '')

  if (raw === '') return { ok: false, why: 'give a file name ending in .md, .jsonl or .csv' }
  if (raw.length > 300) return { ok: false, why: 'a path over 300 characters is refused' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(raw)) return { ok: false, why: 'a path with control characters or a backslash is refused' }
  if (raw.startsWith('~')) return { ok: false, why: 'write the path out: ~ is not expanded here' }
  if (raw.split('/').includes('..')) return { ok: false, why: 'a path with .. is refused: name a file inside the project' }
  if (root === '' || !root.startsWith('/')) return { ok: false, why: 'no project folder is known, so the path cannot be placed' }

  const absolute = raw.startsWith('/') ? raw : raw.includes('/') ? `${root}/${raw}` : `${root}/${EXPORT_DIR}/${raw}`
  const parts = absolute.split('/').filter(part => part !== '' && part !== '.')
  const path = `/${parts.join('/')}`
  const name = parts[parts.length - 1] ?? ''
  const format = formatOf(name)

  if (!NAME.test(name) || format === null) return { ok: false, why: 'the file name must be letters, digits, dots, dashes, underscores or spaces, and end in .md, .jsonl or .csv' }
  if (!allowed.includes(format)) return { ok: false, why: `this export can be ${allowed.map(item => `.${item}`).join(' or ')}, not .${format}` }
  if (!path.startsWith(`${root}/`)) return { ok: false, why: `outside the project: only paths under ${root} are written` }

  // A markdown file is a command, an agent or a skill when it lands in `.claude/`, and a hook sample in `.git/`: event words are agent output, so those folders are not export targets.
  const hidden = path.slice(root.length + 1).split('/').slice(0, -1).find(part => part.startsWith('.') && part !== '.claude-flow')

  if (hidden !== undefined) return { ok: false, why: `${hidden} is a hidden folder: exports go to .claude-flow/console/exports/ or a visible folder in the project` }

  return { ok: true, path }
}

const cell = (value: string): string => maskLine(value, 120).replace(/[|]/g, '/')
const csv = (value: string | number): string => {
  const text = String(value)
  // A leading = + - @ would be a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text

  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function capped(text: string, isPlain = false): string {
  if (bytes(text) <= MAX_EXPORT_BYTES) return text

  let head = text.slice(0, Math.floor(MAX_EXPORT_BYTES * 0.9))

  while (bytes(head) > MAX_EXPORT_BYTES - 200) head = head.slice(0, Math.floor(head.length * 0.9))

  const kept = head.slice(0, Math.max(0, head.lastIndexOf('\n')))

  return isPlain ? `${kept}\n` : `${kept}\n\n> cut here: capped at ${MAX_EXPORT_BYTES / 1000} kB\n`
}

/** The events (newest last, at most MAX_EXPORT_EVENTS of the newest) as markdown or JSONL. `title` says what the filter was. */
export function eventsText(events: readonly ConsoleEvent[], format: 'md' | 'jsonl', title: string, nowMs: number): string {
  const list = events.slice(-MAX_EXPORT_EVENTS)

  if (format === 'jsonl') return capped(list.map(event => `${JSON.stringify({ v: 1, t: event.atMs, kind: event.kind, level: levelOf(event.kind, event.text), text: maskLine(event.text, 240), ...(refOf(event) !== undefined && { ref: maskLine(refOf(event) as string, 80) }) })}\n`).join(''), true)

  return capped(
    [
      `# Events: ${cell(title)}`,
      '',
      `${list.length} of ${events.length} events, exported ${new Date(nowMs).toISOString()}. Text is washed: credentials, control characters and home paths are masked.`,
      '',
      '| time | level | kind | event |',
      '|---|---|---|---|',
      ...list.map(event => `| ${isoOf(event.atMs).slice(0, 19)}Z | ${levelOf(event.kind, event.text)} | ${event.kind} | ${cell(event.text)} |`),
      '',
    ].join('\n'),
  )
}

export type LaneExport = { lanes: readonly LaneView[]; concurrency: Concurrency; fromMs: number; toMs: number; busiest: { atMs: number; n: number } | null }

/** Lane summaries and the concurrency figures, as markdown or CSV. */
export function lanesText(data: LaneExport, format: 'md' | 'csv', nowMs: number): string {
  const rows = data.lanes.slice(0, 500)

  if (format === 'csv') return capped(['group,lane,busy_pct,busy_s,observed_s,calls,longest_busy_s,last_seen', ...rows.map(lane => [lane.group, cell(lane.label), lane.busyPct ?? '', Math.round(lane.busyMs / 1000), Math.round(lane.observedMs / 1000), lane.calls, Math.round(lane.longestMs / 1000), lane.lastAtMs > 0 ? isoOf(lane.lastAtMs) : ''].map(csv).join(',')), ''].join('\n'), true)

  return capped(
    [
      `# Timeline ${clockOf(data.fromMs, true)} to ${clockOf(data.toMs, true)}`,
      '',
      `${rows.length} lanes, exported ${new Date(nowMs).toISOString()}.`,
      '',
      `Concurrency: peak ${data.concurrency.peak}, mean ${data.concurrency.mean} lanes busy at once${data.concurrency.peakAtMs === null ? '' : ` (peak at ${clockOf(data.concurrency.peakAtMs)})`}.${data.busiest === null ? '' : ` Busiest minute ${clockOf(data.busiest.atMs)} with ${data.busiest.n} tool calls.`}`,
      '',
      '| group | lane | busy | calls | longest busy | last seen |',
      '|---|---|---|---|---|---|',
      ...rows.map(lane => `| ${lane.group} | ${cell(lane.label)} | ${lane.busyPct === null ? 'n/a' : `${lane.busyPct}%`} | ${lane.calls} | ${Math.round(lane.longestMs / 1000)} s | ${lane.lastAtMs > 0 ? clockOf(lane.lastAtMs, true) : 'n/a'} |`),
      '',
    ].join('\n'),
  )
}

/** The checked, confirm-gated write: refuses a link or an existing file before it ever asks. */
export async function exportSpecFor(fs: Pick<ReaderFs, 'stat'>, cwd: string, target: string, content: string, label: string, allowed: readonly Format[]): Promise<{ ok: true; spec: ActionSpec } | { ok: false; why: string }> {
  const placed = resolveTarget(target, cwd, allowed)

  if (!placed.ok) return placed

  const clear = await checkNoLinks(fs, placed.path, { cwd: cwd.replace(/\/+$/, '') })

  if (!clear.ok) return clear

  const hasDir = (await fs.stat(dirOf(placed.path)).catch(() => undefined)) !== undefined

  return {
    ok: true,
    spec: {
      label: `write ${label}`,
      args: [],
      argv: newFileArgv(placed.path, hasDir, await writeFlavorReady()),
      stdin: content,
      expect: `a new file at ${placed.path}`,
      declared: 'write',
      shows: `write ${placed.path} (${bytes(content)} bytes; never overwrites)`,
      note: 'writes one new file inside the project; a file that already exists makes it fail instead of replacing it; a missing folder is made first',
      timeoutMs: 10_000,
      verifyLocal: async host => (await host.fs.stat(placed.path).catch(() => undefined)) !== undefined,
    },
  }
}
